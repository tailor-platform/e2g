import { aliased, type Alias } from "./alias.js";
import { drained } from "./drain.js";
import { buildEnv } from "./env.js";
import { loadPty, type PtyProcess } from "./pty.js";
import { createTerminal } from "./render.js";
import { Session } from "./session.js";
import type { Replacement } from "./replace.js";
import type { TerminalTheme } from "./theme.js";

export interface TerminalOptions {
  cols?: number;
  rows?: number;
  env?: Record<string, string | undefined>;
  replace?: Replacement[];
  theme?: TerminalTheme;
  idle?: number;
  path?: string[];
  home?: string;
  cwd?: string;
  // applied to the raw output, before it wraps at `cols`, which would split a long literal and defeat a Replacement
  aliases?: Alias[];
}

export interface RunResult {
  command: string;
  output: string;
  exitCode: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_IDLE = 100;
const KILL_GRACE = 2_000;

const delay = (ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
};

export class Terminal {
  readonly options: TerminalOptions;
  /** Each live process and the promise that settles when it exits. */
  private readonly running = new Map<PtyProcess, Promise<void>>();
  private readonly sessions = new Set<Session>();
  private disposed = false;
  private disposing: Promise<void> | undefined;

  constructor(options: TerminalOptions = {}) {
    this.options = options;
  }

  async run(command: string): Promise<RunResult> {
    const stream = await this.start(command);
    let output = "";
    stream.onData((data) => {
      output += data;
    });
    const exitCode = await new Promise<number>((resolve) => {
      stream.onExit((event) => resolve(event.exitCode));
    });
    return { command, output, exitCode };
  }

  async spawn(command: string): Promise<Session> {
    const stream = await this.start(command);
    const term = createTerminal({
      cols: this.options.cols ?? DEFAULT_COLS,
      rows: this.options.rows ?? DEFAULT_ROWS,
      // the pty's line discipline already translated newlines; a bare one left is a raw-mode cursor move
      convertEol: false,
    });
    const session = new Session({
      proc: stream,
      term,
      idle: this.options.idle ?? DEFAULT_IDLE,
      replace: this.options.replace ?? [],
      theme: this.options.theme,
    });
    this.sessions.add(session);
    return session;
  }

  /** Stops every process and resolves once they have exited, so their shutdown never outlives the terminal. */
  dispose(): Promise<void> {
    this.disposing ??= this.stop();
    return this.disposing;
  }

  private async stop(): Promise<void> {
    this.disposed = true;
    const procs = [...this.running];
    // a process that ignores the hangup gets SIGKILL after a grace period, and one that survives even
    // that is left alone after a second one rather than hanging the caller
    for (const [proc] of procs) proc.kill();
    const exited = Promise.all(procs.map(([, exit]) => exit));
    const grace = delay(KILL_GRACE);
    const first = await Promise.race([exited.then(() => true), grace.promise.then(() => false)]);
    grace.cancel();
    if (!first) {
      for (const [proc] of procs) if (this.running.has(proc)) proc.kill("SIGKILL");
      const last = delay(KILL_GRACE);
      await Promise.race([exited, last.promise]);
      last.cancel();
    }
    this.running.clear();
    for (const session of this.sessions) session.dispose();
    this.sessions.clear();
  }

  private async start(command: string): Promise<PtyProcess> {
    if (this.disposed) throw new Error("terminal is disposed");
    const pty = await loadPty();
    if (this.disposed) throw new Error("terminal is disposed");
    const cols = this.options.cols ?? DEFAULT_COLS;
    const rows = this.options.rows ?? DEFAULT_ROWS;
    const raw = pty.spawn("/bin/sh", ["-c", command], {
      name: "xterm-256color",
      encoding: null,
      cols,
      rows,
      cwd: this.options.cwd ?? process.cwd(),
      env: buildEnv({ ...this.options, cols, rows }),
    });
    const proc = drained(raw);
    this.running.set(
      proc,
      new Promise<void>((resolve) => {
        proc.onExit(() => {
          this.running.delete(proc);
          resolve();
        });
      }),
    );
    return aliased(proc, this.options.aliases ?? []);
  }
}
