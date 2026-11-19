const SPECIFIER = "@lydell/node-pty";

export interface Disposable {
  dispose(): void;
}

export interface ExitEvent {
  exitCode: number;
  signal?: number;
}

// The part of the optional pty package this code uses, declared here so no
// emitted type refers to a package the user may not have installed.
export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: ExitEvent) => void): Disposable;
}

// What spawn returns with `encoding: null`. `fd` and `on` are present on Unix at runtime,
// though the package's types leave them out.
export interface RawPtyProcess {
  readonly pid: number;
  readonly fd?: number;
  write(data: string): void;
  kill(signal?: string): void;
  onData(listener: (data: string | Buffer) => void): Disposable;
  onExit(listener: (event: ExitEvent) => void): Disposable;
  on?(event: "end", listener: () => void): void;
}

export interface PtySpawnOptions {
  name: string;
  encoding: null;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export interface Pty {
  spawn(file: string, args: string[], options: PtySpawnOptions): RawPtyProcess;
}

const importPty = (): Promise<Pty> => import("@lydell/node-pty");

export async function loadPty(load: () => Promise<Pty> = importPty): Promise<Pty> {
  try {
    return await load();
  } catch (error) {
    // A present package whose native binary fails to load must surface its own error.
    const notInstalled =
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" &&
      error.message.includes(SPECIFIER);
    if (!notInstalled) throw error;
    throw new Error(
      `${SPECIFIER} is not installed; add it to use terminal.run() or terminal.spawn()`,
      {
        cause: error,
      },
    );
  }
}
