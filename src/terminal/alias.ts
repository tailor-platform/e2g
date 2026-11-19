import type { ExitEvent, PtyProcess } from "./pty.js";

const FLUSH_MS = 20;

export type Alias = [literal: string, display: string];

// holds back a trailing partial literal, so one split across two chunks is still replaced
function heldLength(text: string, aliases: Alias[]): number {
  let held = 0;
  for (const [literal] of aliases) {
    for (let k = Math.min(literal.length - 1, text.length); k > held; k--) {
      if (text.endsWith(literal.slice(0, k))) {
        held = k;
        break;
      }
    }
  }
  return held;
}

export function aliased(proc: PtyProcess, aliases: Alias[]): PtyProcess {
  const active = aliases.filter(([literal]) => literal !== "");
  if (active.length === 0) return proc;
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: ExitEvent) => void>();
  let tail = "";
  let timer: NodeJS.Timeout | undefined;
  const emit = (text: string) => {
    if (text) for (const listener of dataListeners) listener(text);
  };
  proc.onData((data) => {
    clearTimeout(timer);
    let text = tail + data;
    for (const [literal, display] of active) text = text.split(literal).join(display);
    const held = heldLength(text, active);
    tail = text.slice(text.length - held);
    emit(text.slice(0, text.length - held));
    if (held > 0) {
      // nothing may wait for a chunk that never comes, e.g. a prompt ending in a prefix of the literal
      timer = setTimeout(() => {
        emit(tail);
        tail = "";
      }, FLUSH_MS);
      timer.unref();
    }
  });
  proc.onExit((event) => {
    clearTimeout(timer);
    emit(tail);
    tail = "";
    for (const listener of exitListeners) listener(event);
  });
  return {
    pid: proc.pid,
    write: (text: string) => proc.write(text),
    kill: (signal?: string) => proc.kill(signal),
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
