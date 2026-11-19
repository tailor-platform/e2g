import { readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { ExitEvent, PtyProcess, RawPtyProcess } from "./pty.js";

const READ_SIZE = 64 * 1024;

// When the slave side hangs up, libuv ends the master's read stream after one partial read
// (on Linux, where a pty read returns at most 4 KiB), dropping whatever the child wrote before
// exiting that was not read yet. That rest stays readable on the master until it returns EIO,
// so it is read here, before node-pty closes the master and reports exit.
export function drained(raw: RawPtyProcess): PtyProcess {
  const decoder = new StringDecoder("utf8");
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: ExitEvent) => void>();
  let exited = false;
  const emit = (text: string) => {
    if (text && !exited) for (const listener of dataListeners) listener(text);
  };
  raw.onData((data) => emit(typeof data === "string" ? data : decoder.write(data)));
  raw.on?.("end", () => {
    if (raw.fd === undefined) return;
    const buffer = Buffer.alloc(READ_SIZE);
    for (;;) {
      let read: number;
      try {
        read = readSync(raw.fd, buffer);
      } catch {
        // EIO once drained; EAGAIN if another process still holds the slave open
        break;
      }
      if (read === 0) break;
      emit(decoder.write(buffer.subarray(0, read)));
    }
  });
  raw.onExit((event) => {
    emit(decoder.end());
    exited = true;
    for (const listener of exitListeners) listener(event);
  });
  return {
    pid: raw.pid,
    write: (text: string) => raw.write(text),
    kill: (signal?: string) => {
      if (!exited) raw.kill(signal);
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
