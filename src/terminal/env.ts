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

// the test runner's own variables would make a CLI behave differently locally and in CI
const dropped = (key: string) => key === "NODE_ENV" || key === "CI" || key.startsWith("VITEST");

function inherited(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !dropped(key)));
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
