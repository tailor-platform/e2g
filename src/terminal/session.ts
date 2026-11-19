import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import { keySequence } from "./keys.js";
import { snapshot, type Rendered } from "./render.js";
import type { Replacement } from "./replace.js";
import type { PtyProcess } from "./pty.js";
import type { TerminalTheme } from "./theme.js";

export interface SessionConfig {
  proc: PtyProcess;
  term: HeadlessTerminal;
  idle: number;
  replace: Replacement[];
  theme?: TerminalTheme;
}

const DEFAULT_TIMEOUT = 5_000;
const DEFAULT_EXIT_TIMEOUT = 30_000;
const POLL_MS = 10;

export class Session {
  private code: number | undefined;
  private readonly proc: PtyProcess;
  private readonly term: HeadlessTerminal;
  private readonly idle: number;
  private readonly replace: Replacement[];
  private readonly theme?: TerminalTheme;
  private pending = 0;
  private lastData = Date.now();
  private flushed = false;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(config: SessionConfig) {
    this.proc = config.proc;
    this.term = config.term;
    this.idle = config.idle;
    this.replace = config.replace;
    this.theme = config.theme;
    this.proc.onData((data) => {
      if (this.disposed) return;
      this.lastData = Date.now();
      this.pending++;
      this.term.write(data, () => {
        this.pending--;
        this.lastData = Date.now();
        this.notify();
      });
    });
    this.proc.onExit((event) => {
      this.code = event.exitCode;
      // Output already queued in the parser still belongs on the screen.
      if (this.disposed) return this.notify();
      this.term.write("", () => {
        this.flushed = true;
        this.notify();
      });
    });
  }

  get exitCode(): number | undefined {
    return this.code;
  }

  get pid(): number {
    return this.proc.pid;
  }

  write(text: string): void {
    this.proc.write(text);
  }

  press(key: string): void {
    this.proc.write(keySequence(key));
  }

  screen(): string {
    return this.disposed ? "" : snapshot(this.term, { viewport: true }).text;
  }

  capture(replace: Replacement[] = []): Rendered {
    if (this.disposed) throw new Error("session is disposed");
    return snapshot(this.term, {
      viewport: true,
      replace: [...this.replace, ...replace],
      theme: this.theme,
    });
  }

  kill(): void {
    if (this.exitCode === undefined) this.proc.kill();
  }

  waitForText(text: string | RegExp, options: { timeout?: number } = {}): Promise<void> {
    const label = typeof text === "string" ? text : text.source;
    const matches = (screen: string) =>
      typeof text === "string" ? screen.includes(text) : new RegExp(text).test(screen);
    return this.wait(
      () => matches(this.screen()),
      options.timeout ?? DEFAULT_TIMEOUT,
      () => `waiting for "${label}"; screen:\n${this.screen()}`,
      () =>
        !this.flushed
          ? undefined
          : `process exited with code ${this.code} while waiting for "${label}"; screen:\n${this.screen()}`,
    );
  }

  async waitForExit(options: { timeout?: number } = {}): Promise<number> {
    await this.wait(
      () => this.flushed,
      options.timeout ?? DEFAULT_EXIT_TIMEOUT,
      () => `waiting for exit; screen:\n${this.screen()}`,
    );
    return this.exitCode!;
  }

  settle(options: { idle?: number; timeout?: number } = {}): Promise<void> {
    const idle = options.idle ?? this.idle;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const now = Date.now();
        if (this.pending === 0 && now - this.lastData >= idle) return resolve();
        if (now - started >= timeout) {
          return reject(
            new Error(`screen did not settle within ${timeout}ms; screen:\n${this.screen()}`),
          );
        }
        setTimeout(check, POLL_MS);
      };
      check();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.term.dispose();
    this.notify();
  }

  private wait(
    done: () => boolean,
    timeout: number,
    message: () => string,
    failEarly: () => string | undefined = () => undefined,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.listeners.delete(check);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (done()) return finish();
        const early = failEarly();
        if (early !== undefined) finish(new Error(early));
        else if (this.disposed) finish(new Error(`Session disposed ${message()}`));
      };
      const timer = setTimeout(() => finish(new Error(`Timed out ${message()}`)), timeout);
      this.listeners.add(check);
      check();
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
