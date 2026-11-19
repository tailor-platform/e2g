import { aliased, type Alias } from "./alias.js";
import { drained, type DrainedProcess } from "./drain.js";
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

export class Terminal {
  readonly options: TerminalOptions;
  private readonly running = new Set<DrainedProcess>();
  private readonly sessions = new Set<Session>();
  private disposed = false;

  constructor(options: TerminalOptions = {}) {
    this.options = options;
  }

  async run(command: string): Promise<RunResult> {
    const { proc, stream } = await this.start(command);
    let output = "";
    stream.onData((data) => {
      output += data;
    });
    const exitCode = await new Promise<number>((resolve) => {
      stream.onExit((event) => resolve(event.exitCode));
    });
    this.running.delete(proc);
    return { command, output, exitCode };
  }

  async spawn(command: string): Promise<Session> {
    const { proc, stream } = await this.start(command);
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
    proc.onExit(() => this.running.delete(proc));
    return session;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const proc of this.running) {
      proc.kill();
      proc.flush();
    }
    this.running.clear();
    for (const session of this.sessions) session.dispose();
    this.sessions.clear();
  }

  private async start(command: string): Promise<{ proc: DrainedProcess; stream: PtyProcess }> {
    if (this.disposed) throw new Error("terminal is disposed");
    const pty = await loadPty();
    if (this.disposed) throw new Error("terminal is disposed");
    const cols = this.options.cols ?? DEFAULT_COLS;
    const rows = this.options.rows ?? DEFAULT_ROWS;
    const raw = pty.spawn("/bin/sh", ["-c", command], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: this.options.cwd ?? process.cwd(),
      env: buildEnv({ ...this.options, cols, rows }),
    });
    const proc = drained(raw);
    this.running.add(proc);
    return { proc, stream: aliased(proc, this.options.aliases ?? []) };
  }
}
