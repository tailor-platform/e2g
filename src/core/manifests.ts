import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseManifest, readFile } from "./io.js";
import { resolvePath } from "./paths.js";

/**
 * The absolute paths that other manifests in the manifest's directory list, so a Vitest and a Playwright
 * config that share a directory never write, and so never prune, each other's files.
 */
export function foreignPaths(manifestPath: string, caseInsensitive: boolean): Set<string> {
  const dir = dirname(manifestPath);
  const key = (name: string) => (caseInsensitive ? name.toLowerCase() : name);
  const own = key(basename(manifestPath));
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return new Set();
  }
  const paths = new Set<string>();
  // only JSON files, so pages and images that share the directory are not read
  for (const name of names.filter(
    (n) => key(n) !== own && (caseInsensitive ? key(n) : n).endsWith(".json"),
  )) {
    const data = readFile(join(dir, name));
    const manifest = data && parseManifest(data);
    if (!manifest) continue;
    for (const entry of [...manifest.pages, ...manifest.shots]) paths.add(resolvePath(dir, entry));
  }
  return paths;
}
