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
  /** Where the search for `node_modules/.bin` directories starts, upward; the current directory by default. */
  binFrom?: string;
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

const GROUP_POLL = 20;

const delay = (ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
};

// The pty makes `/bin/sh` a session and process group leader. Where sh does not exec the command
// (dash on Debian and Ubuntu), the leader is not the command: it dies on the hangup right away, the
// kernel then hangs up the terminal and node-pty reports exit while the command is still running its
// shutdown handler. So dispose signals and waits for the whole group, not only the leader.
const signalGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group is already gone
  }
};

const groupAlive = (pid: number) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Resolves true once every process has exited and its group is empty, or false after `ms`. */
const allGone = async (procs: [PtyProcess, Promise<void>][], ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  const grace = delay(ms);
  const exited = await Promise.race([
    Promise.all(procs.map(([, exit]) => exit)).then(() => true),
    grace.promise.then(() => false),
  ]);
  grace.cancel();
  if (!exited) return false;
  while (procs.some(([proc]) => groupAlive(proc.pid))) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    const tick = delay(Math.min(GROUP_POLL, left));
    await tick.promise;
  }
  return true;
};

export const UNSUPPORTED_PLATFORM =
  "@tailor-platform/e2g/terminal runs commands through /bin/sh and supports macOS and Linux only";

export function checkPlatform(platform: NodeJS.Platform = process.platform): void {
  if (platform === "win32") throw new Error(UNSUPPORTED_PLATFORM);
}

export class Terminal {
  readonly options: TerminalOptions;
  /** Each live process and the promise that settles when it exits. */
  private readonly running = new Map<PtyProcess, Promise<void>>();
  private readonly sessions = new Set<Session>();
  private disposed = false;
  private disposing: Promise<void> | undefined;

  constructor(options: TerminalOptions = {}) {
    checkPlatform();
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
    // a group that ignores the hangup gets SIGKILL after a grace period, and one that survives even
    // that is left alone after a second one rather than hanging the caller
    for (const [proc] of procs) signalGroup(proc.pid, "SIGHUP");
    if (!(await allGone(procs, KILL_GRACE))) {
      for (const [proc] of procs) signalGroup(proc.pid, "SIGKILL");
      await allGone(procs, KILL_GRACE);
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
