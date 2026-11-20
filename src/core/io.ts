import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { relativePath, resolvePath } from "./paths.js";
import type { Manifest, Op } from "./types.js";

const swapCase = (name: string) =>
  name.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));

export interface ProbeFs {
  statSync(path: string): { ino: number | bigint; dev: number | bigint; isDirectory(): boolean };
  writeFileSync(path: string, data: string, options: { flag: "wx" }): void;
  rmSync(path: string, options: { force: true }): void;
}

const nodeFs: ProbeFs = { statSync, writeFileSync, rmSync };

function nearestDir(dir: string, fs: ProbeFs): string | null {
  for (let at = dir; ; at = dirname(at)) {
    try {
      if (fs.statSync(at).isDirectory()) return at;
    } catch {}
    if (dirname(at) === at) return null;
  }
}

function sameFile(a: string, b: string, fs: ProbeFs): boolean {
  try {
    const x = fs.statSync(a);
    const y = fs.statSync(b);
    return x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}

/**
 * Whether the file system holding `dir`, or its nearest existing ancestor, treats paths that differ only in
 * case as one file. Only names inside that directory are probed, so a volume mounted under a root with other
 * rules is judged by its own.
 */
export function caseInsensitive(dir: string, fs: ProbeFs = nodeFs): boolean {
  const fallback = process.platform === "darwin" || process.platform === "win32";
  const at = nearestDir(dir, fs);
  if (at === null) return fallback;
  const probe = join(at, `.e2g-case-${process.pid}-${Math.random().toString(36).slice(2)}-Probe`);
  try {
    fs.writeFileSync(probe, "", { flag: "wx" });
  } catch {
    // a read-only directory: compare its own name under another spelling, keeping its parent as it is
    const name = basename(at);
    const other = join(dirname(at), swapCase(name));
    return other === at ? fallback : sameFile(at, other, fs);
  }
  try {
    return sameFile(probe, join(at, swapCase(basename(probe))), fs);
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

export const EMPTY_MANIFEST: Manifest = { schemaVersion: 1, pages: [], shots: [] };

export function readFile(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

export function parseManifest(data: Buffer): Manifest | null {
  try {
    const m = JSON.parse(data.toString("utf8")) as Partial<Manifest> | null;
    if (m?.schemaVersion === 1 && strings(m.pages) && strings(m.shots))
      return { schemaVersion: 1, pages: m.pages, shots: m.shots };
  } catch {}
  return null;
}

/** `null` when the file exists but is not a version 1 manifest, so it must be left as it is. */
export function readManifest(path: string): Manifest | null {
  const data = readFile(path);
  return data ? parseManifest(data) : EMPTY_MANIFEST;
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/**
 * The first entry that resolves outside every root, since a prune deletes whatever an entry names and a
 * hand-edited manifest could otherwise reach any file.
 */
export function entryOutside(
  manifest: Manifest,
  manifestDir: string,
  roots: string[],
): string | undefined {
  return [...manifest.pages, ...manifest.shots].find((entry) => {
    const path = resolvePath(manifestDir, entry);
    return !roots.some((root) => inside(root, path));
  });
}

// a crash mid-write leaves the old file or the new one, never half of either
function writeAtomic(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

export function writeManifest(path: string, manifest: Manifest): void {
  writeAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

// null when the directory is already gone, as after an earlier delete in the same directory
function isEmpty(dir: string): boolean | null {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return null;
  }
}

// removes the directories a delete left empty, up to but never including a root
function removeEmptyParents(file: string, roots: string[]): void {
  for (let dir = dirname(file); roots.some((root) => inside(root, dir)); dir = dirname(dir)) {
    const empty = isEmpty(dir);
    if (empty === false) return;
    if (empty) rmdirSync(dir);
  }
}

type Write = Extract<Op, { op: "write" }>;

// plan renders pages as text and passes shots as PNG bytes
const isPage = (op: Write) => typeof op.data === "string";

/** Deletes, then shots, then pages, so a page never points at a shot that was not written. */
export function apply(ops: Op[], roots: string[]): void {
  const writes = ops.filter((op): op is Write => op.op === "write");
  for (const op of ops) if (op.op === "delete") rmSync(op.path, { force: true });
  for (const op of ops) if (op.op === "delete") removeEmptyParents(op.path, roots);
  for (const op of writes.filter((w) => !isPage(w))) writeAtomic(op.path, op.data);
  for (const op of writes.filter(isPage)) writeAtomic(op.path, op.data);
}

function withWrites(manifest: Manifest, ops: Op[], manifestDir: string): Manifest {
  const writes = ops.filter((op): op is Write => op.op === "write");
  const merge = (old: string[], added: Write[]) =>
    [...new Set([...old, ...added.map((w) => relativePath(manifestDir, w.path))])].sort();
  return {
    schemaVersion: 1,
    pages: merge(manifest.pages, writes.filter(isPage)),
    shots: merge(
      manifest.shots,
      writes.filter((w) => !isPage(w)),
    ),
  };
}

const sameEntries = (a: Manifest, b: Manifest) =>
  JSON.stringify([a.pages, a.shots]) === JSON.stringify([b.pages, b.shots]);

export interface Commit {
  ops: Op[];
  roots: string[];
  /** `null` leaves the manifest file as it is. */
  manifestPath: string | null;
  previous: Manifest;
  manifest: Manifest | null;
}

/**
 * Lists every file about to be written in the manifest first, so a crash part way through leaves no
 * written file that a later prune cannot find; the plan's manifest replaces it once all ops are done.
 */
export function commit({ ops, roots, manifestPath, previous, manifest }: Commit): void {
  if (manifestPath) {
    const pending = withWrites(previous, ops, dirname(manifestPath));
    if (!sameEntries(pending, previous)) writeManifest(manifestPath, pending);
  }
  apply(ops, roots);
  if (manifestPath && manifest) writeManifest(manifestPath, manifest);
}
