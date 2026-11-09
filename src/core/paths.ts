import { posix, win32 } from "node:path";

const flavor = (path: string) => (/^[A-Za-z]:[\\/]|^\\\\/.test(path) ? win32 : posix);

export function relativePath(from: string, to: string): string {
  const path = flavor(from);
  return path.relative(from, to).split(path.sep).join("/");
}

export function resolvePath(dir: string, relative: string): string {
  return flavor(dir).resolve(dir, relative);
}

export function directoryOf(path: string): string {
  return flavor(path).dirname(path);
}
