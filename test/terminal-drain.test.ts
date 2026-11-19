import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drained } from "../src/terminal/drain.js";
import type { ExitEvent, PtyProcess, RawPtyProcess } from "../src/terminal/pty.js";

function fakePty(fd?: number) {
  let onData: (data: string | Buffer) => void = () => {};
  let onExit: (event: ExitEvent) => void = () => {};
  let onEnd: () => void = () => {};
  const kill = vi.fn();
  const proc: RawPtyProcess = {
    pid: 1,
    fd,
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
    on: (_event, listener) => {
      onEnd = listener;
    },
  };
  return {
    proc,
    kill,
    data: (d: string | Buffer) => onData(d),
    end: () => onEnd(),
    exit: (code = 0) => onExit({ exitCode: code }),
  };
}

function record(proc: PtyProcess) {
  const events: string[] = [];
  proc.onData((d) => events.push(d));
  proc.onExit((e) => events.push(`exit ${e.exitCode}`));
  return events;
}

const dirs: string[] = [];
function fileWith(content: Buffer): number {
  const dir = mkdtempSync(join(tmpdir(), "e2g-drain-"));
  dirs.push(dir);
  writeFileSync(join(dir, "rest"), content);
  return openSync(join(dir, "rest"), "r");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("drained", () => {
  it("reads what is left on the fd when the stream ends early, before exit", () => {
    const fd = fileWith(Buffer.from("rest of the output"));
    const pty = fakePty(fd);
    const events = record(drained(pty.proc));
    pty.data(Buffer.from("first "));
    pty.end();
    pty.exit(0);
    closeSync(fd);
    expect(events.join("")).toBe("first rest of the outputexit 0");
  });

  it("decodes a character split between a chunk and the drained rest", () => {
    const bytes = Buffer.from("é");
    const fd = fileWith(bytes.subarray(1));
    const pty = fakePty(fd);
    const events = record(drained(pty.proc));
    pty.data(bytes.subarray(0, 1));
    pty.end();
    closeSync(fd);
    expect(events).toEqual(["é"]);
  });

  it("drops output reported after exit", () => {
    const pty = fakePty();
    const events = record(drained(pty.proc));
    pty.exit(2);
    pty.data("late");
    expect(events).toEqual(["exit 2"]);
  });

  it("does not kill a process that already exited", () => {
    const pty = fakePty();
    const proc = drained(pty.proc);
    pty.exit(0);
    proc.kill();
    expect(pty.kill).not.toHaveBeenCalled();
  });
});
