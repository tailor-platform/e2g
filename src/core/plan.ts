import type { Page } from "../types.js";
import type { CollectedPage } from "./collect.js";
import { directoryOf, relativePath, resolvePath } from "./paths.js";
import type { GuideOutput, Manifest, Op, RunScope } from "./types.js";

export interface PlanInput {
  scope: RunScope;
  prune: boolean;
  pages: CollectedPage[];
  incomplete: string[];
  errors: string[];
  output: GuideOutput<unknown>;
  shotPath(page: Page<unknown>, name: string): string;
  manifestDir: string;
  manifest: Manifest;
  current(path: string): Buffer | null;
  same(a: Buffer, b: Buffer): boolean;
}

export interface Plan {
  ops: Op[];
  manifest: Manifest | null;
  /** What the run left out or kept, for information. */
  messages: string[];
  /** Mistakes in the guides themselves, which fail the run. */
  errors: string[];
}

interface Target {
  owner: string;
  path: string;
  data: string | Buffer;
  kind: "pages" | "shots";
}

const because = (reasons: string[]) =>
  reasons.map((reason) => `wrote no guide pages because ${reason}`);

const nothing = (messages: string[], errors: string[] = []): Plan => ({
  ops: [],
  manifest: null,
  messages,
  errors,
});

function targetsOf({ shots: taken, ...page }: CollectedPage, input: PlanInput): Target[] {
  const owner = `${page.slug}/${page.locale}`;
  const path = input.output.path(page);
  const dir = directoryOf(path);
  const image = (shot: { name: string }) => relativePath(dir, input.shotPath(page, shot.name));
  const shots = [...taken].map(([name, data]): Target => ({
    owner,
    path: input.shotPath(page, name),
    data,
    kind: "shots",
  }));
  return [{ owner, path, data: input.output.render(page, { image }), kind: "pages" }, ...shots];
}

function collisions(targets: Target[]): string[] {
  const owners = new Map<string, string>();
  const errors: string[] = [];
  for (const { owner, path } of targets) {
    const first = owners.get(path);
    if (first === undefined) owners.set(path, owner);
    else if (first !== owner) errors.push(`pages ${first} and ${owner} both write ${path}`);
  }
  return errors;
}

function unchanged(target: Target, input: PlanInput): boolean {
  const old = input.current(target.path);
  if (!old) return false;
  if (typeof target.data === "string") return old.toString("utf8") === target.data;
  if (old.equals(target.data)) return true;
  try {
    return input.same(old, target.data);
  } catch {
    return false;
  }
}

function produced(targets: Target[], manifestDir: string): Manifest {
  const entries = (kind: Target["kind"]) =>
    targets
      .filter((t) => t.kind === kind)
      .map((t) => relativePath(manifestDir, t.path))
      .sort();
  return { schemaVersion: 1, pages: entries("pages"), shots: entries("shots") };
}

function union(a: Manifest, b: Manifest): Manifest {
  const merge = (x: string[], y: string[]) => [...new Set([...x, ...y])].sort();
  return { schemaVersion: 1, pages: merge(a.pages, b.pages), shots: merge(a.shots, b.shots) };
}

// deletes run before writes, so a case-only rename may delete the old name and then write the new one
const fileKey = (path: string) => resolvePath(path, ".");
const caseKey = (path: string) => fileKey(path).toLowerCase();

function stale(old: Manifest, targets: Target[], manifestDir: string): Op[] {
  const keep = new Set(targets.map((t) => fileKey(t.path)));
  return [...new Set([...old.pages, ...old.shots])]
    .map((entry) => resolvePath(manifestDir, entry))
    .filter((path) => !keep.has(fileKey(path)))
    .map((path) => ({ op: "delete", path }));
}

const sameManifest = (a: Manifest, b: Manifest) =>
  a.pages.join("\n") === b.pages.join("\n") && a.shots.join("\n") === b.shots.join("\n");

function pruneBlocker(input: PlanInput): string | undefined {
  if (!input.prune) return undefined;
  if (input.incomplete.length > 0) return "pruned nothing because some pages were not written";
  if (input.pages.length === 0) return "pruned nothing because no guide pages were found";
  return undefined;
}

export function plan(input: PlanInput): Plan {
  if (input.scope.partial) return nothing(because([input.scope.reason]));
  if (input.errors.length > 0) return nothing([], because(input.errors));
  const targets = input.pages.flatMap((page) => targetsOf(page, input));
  const clashes = collisions(targets);
  if (clashes.length > 0) return nothing([], because(clashes));

  const messages = input.incomplete.map((entry) => `did not write ${entry}`);
  const blocker = pruneBlocker(input);
  if (blocker) messages.push(blocker);
  const pruning = input.prune && !blocker;
  const deletes = pruning ? stale(input.manifest, targets, input.manifestDir) : [];
  // on a case-insensitive file system the delete removes the target too, so it must be written again
  const deleted = new Set(deletes.map((d) => caseKey(d.path)));
  const writes: Op[] = targets
    .filter((t) => deleted.has(caseKey(t.path)) || !unchanged(t, input))
    .map(({ path, data }) => ({ op: "write", path, data }));
  const made = produced(targets, input.manifestDir);
  const next = pruning ? made : union(input.manifest, made);
  const manifest = sameManifest(input.manifest, next) ? null : next;
  return { ops: [...deletes, ...writes], manifest, messages, errors: [] };
}
