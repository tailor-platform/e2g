import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

export interface EnvOptions {
  cols: number;
  rows: number;
  env?: Record<string, string | undefined>;
  path?: string[];
  home?: string;
  binFrom?: string;
}

// anything else from the parent (locale, XDG dirs, CI flags, tokens) would make a CLI behave
// differently on each machine, so only these are passed on; the rest must come through `env`
const INHERITED = ["TMPDIR", "USER", "LOGNAME"] as const;

function inherited(): Record<string, string | undefined> {
  return Object.fromEntries(INHERITED.map((key) => [key, process.env[key]]));
}

function binDirs(from: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(from);
  for (;;) {
    dirs.push(join(dir, "node_modules", ".bin"));
    const parent = dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

export function buildEnv(options: EnvOptions): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...inherited(),
    TERM: "xterm-256color",
    LANG: "en_US.UTF-8",
    TZ: "UTC",
    COLUMNS: String(options.cols),
    LINES: String(options.rows),
    HOME: options.home ?? homedir(),
    PATH: [...(options.path ?? []), ...binDirs(options.binFrom ?? process.cwd()), process.env.PATH]
      .filter(Boolean)
      .join(delimiter),
    ...options.env,
  };
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}
