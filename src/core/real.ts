import { realpathSync } from "node:fs";

const reals = new Map<string, string>();

// a path resolved through symlinks, or as given when it cannot be resolved
export function real(path: string): string {
  let resolved = reals.get(path);
  if (resolved === undefined) {
    try {
      resolved = realpathSync(path);
    } catch {
      resolved = path;
    }
    reals.set(path, resolved);
  }
  return resolved;
}
