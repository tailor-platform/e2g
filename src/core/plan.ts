import {
  isShot,
  type Block,
  type Item,
  type ShotImage,
  type ShotItem,
  type Shot,
} from "../types.js";
import type { CollectedPage, CollectedShot, CollectedSvg } from "./collect.js";
import { directoryOf, relativePath, resolvePath } from "./paths.js";
import type { GuideOutput, Manifest, Op, PageInfo, RunScope } from "./types.js";

export interface PlanInput {
  scope: RunScope;
  prune: boolean;
  pages: CollectedPage[];
  incomplete: string[];
  errors: string[];
  output: GuideOutput<unknown>;
  shotPath(
    page: PageInfo<unknown>,
    name: string,
    variant: string | undefined,
    ext: "png" | "svg",
  ): string;
  /** Absolute paths other manifests own, which this one must not write. */
  foreign: Set<string>;
  /** Whether the file system treats paths that differ only in case as one file. */
  caseInsensitive: boolean;
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

function targetsOf({ blocks, ...info }: CollectedPage, input: PlanInput): Target[] {
  const owner = `${info.slug}/${info.locale}`;
  const path = input.output.path(info);
  const dir = directoryOf(path);
  const shots: Target[] = [];
  const place = (shot: CollectedShot): ShotItem<Shot> => ({
    kind: "shot",
    name: shot.name,
    alt: shot.alt,
    images: shot.images.map(({ png, ...image }) => {
      const at = input.shotPath(info, shot.name, image.variant, "png");
      shots.push({ owner, path: at, data: png, kind: "shots" });
      // a variant is one the projects set, so one of the registered ones
      return { ...image, src: relativePath(dir, at) } as ShotImage;
    }),
  });
  const placeItem = (item: Item<CollectedShot, CollectedSvg>): Item => {
    if (isShot(item)) return place(item);
    if (item.kind === "command") return item;
    const at = input.shotPath(info, item.name, undefined, "svg");
    shots.push({ owner, path: at, data: item.image.svg, kind: "shots" });
    return { ...item, image: { src: relativePath(dir, at) } };
  };
  const placed = blocks.map((b): Block =>
    b.kind === "say" ? b : { ...b, items: b.items.map(placeItem) },
  );
  const page = { ...info, blocks: placed };
  return [{ owner, path, data: input.output.render(page), kind: "pages" }, ...shots];
}

/** Every path the pages would write, without rendering them. */
export function outputPaths(
  pages: CollectedPage[],
  input: Pick<PlanInput, "output" | "shotPath">,
): string[] {
  return pages.flatMap(({ blocks, ...info }) => [
    input.output.path(info),
    ...blocks.flatMap((b) =>
      b.kind === "say"
        ? []
        : b.items.flatMap((item) => {
            if (isShot(item))
              return item.images.map((image) =>
                input.shotPath(info, item.name, image.variant, "png"),
              );
            if (item.kind === "command") return [];
            return [input.shotPath(info, item.name, undefined, "svg")];
          }),
    ),
  ]);
}

function collisions(targets: Target[], id: Identity): string[] {
  const owners = new Map<string, { owner: string; path: string }>();
  const errors: string[] = [];
  for (const { owner, path } of targets) {
    const first = owners.get(id(path));
    if (first === undefined) owners.set(id(path), { owner, path });
    else if (first.path !== path)
      errors.push(
        first.owner === owner
          ? `page ${owner} writes ${first.path} and ${path}, which are the same file on this file system`
          : `pages ${first.owner} and ${owner} write ${first.path} and ${path}, which are the same file on this file system`,
      );
    else if (first.owner !== owner)
      errors.push(`pages ${first.owner} and ${owner} both write ${path}`);
    // a shots.path that ignores the variant would put every variant's image in one file
    else
      errors.push(
        `page ${owner} writes ${path} more than once; give each variant's shots their own path`,
      );
  }
  return errors;
}

function foreignWrites(targets: Target[], foreign: Set<string>, id: Identity): string[] {
  const owned = new Set([...foreign].map(id));
  return targets
    .filter((t) => owned.has(id(t.path)))
    .map((t) => `page ${t.owner} writes ${t.path}, which another manifest owns`);
}

function unchanged(target: Target, input: PlanInput): boolean {
  const old = input.current(target.path);
  if (!old) return false;
  if (typeof target.data === "string") return old.toString("utf8") === target.data;
  if (old.equals(target.data)) return true;
  // sameScreen reads PNGs only; an SVG differs when its bytes do
  if (target.path.endsWith(".svg")) return false;
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

type Identity = (path: string) => string;

// a target keeps its exact spelling so a case-only rename deletes the old name; another manifest's file is
// the same file under any spelling the file system treats as one
function stale(
  old: Manifest,
  targets: Target[],
  manifestDir: string,
  foreign: Set<string>,
  id: Identity,
): Op[] {
  const keep = new Set(targets.map((t) => fileKey(t.path)));
  const owned = new Set([...foreign].map(id));
  return [...new Set([...old.pages, ...old.shots])]
    .map((entry) => resolvePath(manifestDir, entry))
    .filter((path) => !keep.has(fileKey(path)) && !owned.has(id(path)))
    .map((path) => ({ op: "delete", path }));
}

// a file another manifest also lists is theirs to keep, so this manifest lets go of it
function relinquish(
  manifest: Manifest,
  manifestDir: string,
  foreign: Set<string>,
  id: Identity,
): Manifest {
  const owned = new Set([...foreign].map(id));
  const mine = (entries: string[]) =>
    entries.filter((entry) => !owned.has(id(resolvePath(manifestDir, entry))));
  return { schemaVersion: 1, pages: mine(manifest.pages), shots: mine(manifest.shots) };
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
  const id: Identity = input.caseInsensitive ? caseKey : fileKey;
  const targets = input.pages.flatMap((page) => targetsOf(page, input));
  const clashes = [...collisions(targets, id), ...foreignWrites(targets, input.foreign, id)];
  if (clashes.length > 0) return nothing([], because(clashes));

  const messages = input.incomplete.map((entry) => `did not write ${entry}`);
  const blocker = pruneBlocker(input);
  if (blocker) messages.push(blocker);
  const pruning = input.prune && !blocker;
  const deletes = pruning
    ? stale(input.manifest, targets, input.manifestDir, input.foreign, id)
    : [];
  // on a case-insensitive file system the delete removes the target too, so it must be written again
  const deleted = new Set(deletes.map((d) => id(d.path)));
  const writes: Op[] = targets
    .filter((t) => deleted.has(id(t.path)) || !unchanged(t, input))
    .map(({ path, data }) => ({ op: "write", path, data }));
  const made = produced(targets, input.manifestDir);
  const next = pruning
    ? made
    : union(relinquish(input.manifest, input.manifestDir, input.foreign, id), made);
  const manifest = sameManifest(input.manifest, next) ? null : next;
  return { ops: [...deletes, ...writes], manifest, messages, errors: [] };
}
