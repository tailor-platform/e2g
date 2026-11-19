import { afterEach, describe, expect, it, vi } from "vitest";
import { drained } from "../src/terminal/drain.js";
import type { ExitEvent, PtyProcess } from "../src/terminal/pty.js";

function fakePty() {
  let onData: (data: string) => void = () => {};
  let onExit: (event: ExitEvent) => void = () => {};
  const kill = vi.fn();
  const proc: PtyProcess = {
    pid: 1,
    write: () => {},
    kill,
    onData: (listener) => {
      onData = listener;
      return { dispose: () => {} };
    },
    onExit: (listener) => {
      onExit = listener;
      return { dispose: () => {} };
    },
  };
  return {
    proc,
    kill,
    data: (d: string) => onData(d),
    exit: (code = 0) => onExit({ exitCode: code }),
  };
}

function record(proc: PtyProcess) {
  const events: string[] = [];
  proc.onData((d) => events.push(d));
  proc.onExit((e) => events.push(`exit ${e.exitCode}`));
  return events;
}

describe("drained", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers output that arrives after exit before the exit itself", () => {
    vi.useFakeTimers();
    const pty = fakePty();
    const events = record(drained(pty.proc, { quiet: 50, max: 1_000 }));
    pty.exit(0);
    vi.advanceTimersByTime(30);
    pty.data("late");
    vi.advanceTimersByTime(30);
    expect(events).toEqual(["late"]);
    vi.advanceTimersByTime(20);
    expect(events).toEqual(["late", "exit 0"]);
    pty.data("after");
    expect(events).toEqual(["late", "exit 0"]);
  });

  it("stops waiting for quiet at the cap", () => {
    vi.useFakeTimers();
    const pty = fakePty();
    const events = record(drained(pty.proc, { quiet: 50, max: 200 }));
    pty.exit(2);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(25);
      pty.data(".");
    }
    expect(events.at(-1)).toBe("exit 2");
    expect(events.filter((e) => e === ".")).toHaveLength(7);
  });

  it("flush delivers exit as soon as it is reported and leaves no timer", () => {
    vi.useFakeTimers();
    const pty = fakePty();
    const proc = drained(pty.proc);
    const events = record(proc);
    proc.flush();
    pty.exit(0);
    expect(events).toEqual(["exit 0"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not kill a process that already exited", () => {
    const pty = fakePty();
    const proc = drained(pty.proc);
    pty.exit(0);
    proc.kill();
    expect(pty.kill).not.toHaveBeenCalled();
    proc.flush();
  });
});
