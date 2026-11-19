import type { ExitEvent, PtyProcess } from "./pty.js";

const QUIET_MS = 50;
const MAX_WAIT_MS = 1_000;

export interface DrainedProcess extends PtyProcess {
  // delivers exit as soon as it is reported, without waiting out the quiet window
  flush(): void;
}

// node-pty can report exit before the last output is read from the pty (seen on Linux),
// so exit is held back until the output has gone quiet
export function drained(
  proc: PtyProcess,
  { quiet = QUIET_MS, max = MAX_WAIT_MS }: { quiet?: number; max?: number } = {},
): DrainedProcess {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: ExitEvent) => void>();
  let lastData = Date.now();
  let exited: { event: ExitEvent; at: number } | undefined;
  let done = false;
  let flushing = false;
  let timer: NodeJS.Timeout | undefined;
  const finish = () => {
    if (done || !exited) return;
    done = true;
    clearTimeout(timer);
    for (const listener of exitListeners) listener(exited.event);
  };
  const check = () => {
    const now = Date.now();
    const remaining = Math.min(quiet - (now - lastData), max - (now - exited!.at));
    if (flushing || remaining <= 0) return finish();
    timer = setTimeout(check, remaining);
  };
  proc.onData((data) => {
    if (done) return;
    lastData = Date.now();
    for (const listener of dataListeners) listener(data);
  });
  proc.onExit((event) => {
    exited = { event, at: Date.now() };
    check();
  });
  return {
    pid: proc.pid,
    write: (text: string) => proc.write(text),
    kill: (signal?: string) => {
      if (!exited) proc.kill(signal);
    },
    flush: () => {
      flushing = true;
      if (exited) finish();
    },
    onData: (listener: (data: string) => void) => {
      dataListeners.add(listener);
      return { dispose: () => void dataListeners.delete(listener) };
    },
    onExit: (listener: (event: ExitEvent) => void) => {
      exitListeners.add(listener);
      return { dispose: () => void exitListeners.delete(listener) };
    },
  };
}
