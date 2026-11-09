import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { relativePath } from "./paths.js";
import type { Manifest, Op } from "./types.js";

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

/** `null` when the file exists but is not a version 1 manifest, so it must be left as it is. */
export function readManifest(path: string): Manifest | null {
  const data = readFile(path);
  if (!data) return EMPTY_MANIFEST;
  try {
    const m = JSON.parse(data.toString("utf8")) as Partial<Manifest> | null;
    if (m?.schemaVersion === 1 && strings(m.pages) && strings(m.shots))
      return { schemaVersion: 1, pages: m.pages, shots: m.shots };
  } catch {}
  return null;
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

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

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
