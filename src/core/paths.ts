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

/** Whether `path` is below `root`; `root` itself is not, since a file cannot be its own folder. */
export function isInside(root: string, path: string): boolean {
  const p = flavor(root);
  const rel = p.relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
}
