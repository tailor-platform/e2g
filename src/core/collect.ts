import { isDeepStrictEqual } from "node:util";
import type { Block, GuideRecord, Locale, Page, Region, TakenShot } from "../types.js";
import { relativePath } from "./paths.js";

export interface ExpectedTest {
  id: string;
  slug: string;
  locale: string;
  /** The project's guideVariant, if the projects set one. */
  variant?: string;
  locales: string[];
  /** Every guideVariant in the order of the projects; empty when they set none. */
  variants: string[];
  file: string;
  line: number;
  column: number;
}

export interface TestOutcome {
  ok: boolean;
  record: GuideRecord<unknown>;
  shots: Map<string, Buffer>;
  /** Why the test's guide attachments could not be used. */
  problem?: string;
}

export interface CollectedImage {
  variant?: string;
  regions: Region[];
  png: Buffer;
}

export interface CollectedShot {
  name: string;
  alt: string;
  images: CollectedImage[];
}

export type CollectedPage = Omit<Page<unknown>, "blocks"> & { blocks: Block<CollectedShot>[] };

interface Collected {
  pages: CollectedPage[];
  incomplete: string[];
  errors: string[];
}

// one variant of a page, as its tests took it
interface Taken {
  variant?: string;
  meta: unknown;
  blocks: Block<TakenShot>[];
  shots: Map<string, Buffer>;
}

type Built<T> = { page: T } | { incomplete: string } | { error: string };

const pageId = (slug: string, locale: string) => `${slug}/${locale}`;

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

// a locale's projects left out with --project, or ones that ran none of a guide's tests, leave that page incomplete
function missingLocales(expected: ExpectedTest[], groups: Map<string, ExpectedTest[]>): string[] {
  const pages = new Map(
    expected.flatMap((t) => t.locales.map((locale) => [pageId(t.slug, locale), locale] as const)),
  );
  return [...pages]
    .filter(([id]) => !groups.has(id))
    .map(([id, locale]) => `${id} (no test of it ran for locale ${locale})`);
}

function shotNames(records: GuideRecord<unknown>[]): string[] {
  return records.flatMap((r) =>
    r.blocks.flatMap((b) => (b.kind === "step" ? b.shots.map((s) => s.name) : [])),
  );
}

function duplicates(names: string[]): string[] {
  return [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
}

function relativeTo<S>(rootDir: string, block: Block<S>): Block<S> {
  return block.location
    ? {
        ...block,
        location: { ...block.location, file: relativePath(rootDir, block.location.file) },
      }
    : block;
}

const inVariant = (variant: string | undefined) =>
  variant === undefined ? "" : ` in variant ${variant}`;

function takeVariant(
  id: string,
  variant: string | undefined,
  tests: ExpectedTest[],
  results: Map<string, TestOutcome>,
): Built<Taken> {
  const sorted = [...tests].sort((a, b) => a.line - b.line || a.column - b.column);
  const outcomes = sorted.map((t) => results.get(t.id));
  if (outcomes.some((o) => !o?.ok))
    return { incomplete: `${id} (a test failed, was skipped or did not run${inVariant(variant)})` };
  const problem = outcomes.find((o) => o!.problem)?.problem;
  if (problem) return { incomplete: `${id} (${problem}${inVariant(variant)})` };
  const records = outcomes.map((o) => o!.record);
  const meta = records[0]!.meta;
  if (records.some((r) => !isDeepStrictEqual(r.meta, meta)))
    return { error: `page ${id} has differing meta across its tests` };
  const names = shotNames(records);
  const repeated = duplicates(names);
  if (repeated.length > 0)
    return { error: `page ${id} uses the shot name ${repeated.join(", ")} more than once` };
  const shots = new Map(outcomes.flatMap((o) => [...o!.shots]));
  if (names.some((name) => !shots.has(name)))
    return {
      incomplete: `${id} (a step has no shot attachment${inVariant(variant)}; run with guideShots on to write it)`,
    };
  return {
    page: {
      ...(variant === undefined ? {} : { variant }),
      meta,
      blocks: records.flatMap((r) => r.blocks),
      shots,
    },
  };
}

// what the variants of a page must share: everything but the images and where the code ran
const shape = (blocks: Block<TakenShot>[]) =>
  blocks.map((b) =>
    b.kind === "say"
      ? { kind: b.kind, text: b.text }
      : { kind: b.kind, text: b.text, shots: b.shots.map((s) => ({ name: s.name, alt: s.alt })) },
  );

function joinVariants(
  id: string,
  taken: Taken[],
): Built<Pick<Page<unknown>, "meta"> & { blocks: Block<CollectedShot>[] }> {
  const [first, ...rest] = taken;
  for (const other of rest) {
    const pair = `variants ${first!.variant} and ${other.variant}`;
    if (!isDeepStrictEqual(other.meta, first!.meta))
      return { error: `page ${id} has differing meta in ${pair}` };
    if (!isDeepStrictEqual(shape(other.blocks), shape(first!.blocks)))
      return { error: `page ${id} has different steps, paragraphs or shots in ${pair}` };
  }
  const blocks = first!.blocks.map((block, i): Block<CollectedShot> => {
    if (block.kind === "say") return block;
    return {
      ...block,
      shots: block.shots.map((shot, j) => ({
        name: shot.name,
        alt: shot.alt,
        images: taken.map((t) => {
          const own = t.blocks[i] as Extract<Block<TakenShot>, { kind: "step" }>;
          return {
            ...(t.variant === undefined ? {} : { variant: t.variant }),
            regions: own.shots[j]!.regions,
            png: t.shots.get(shot.name)!,
          };
        }),
      })),
    };
  });
  return { page: { meta: first!.meta, blocks } };
}

function buildPage(
  id: string,
  tests: ExpectedTest[],
  results: Map<string, TestOutcome>,
  rootDir: string,
): Built<CollectedPage> {
  const files = [...new Set(tests.map((t) => relativePath(rootDir, t.file)))].sort();
  if (files.length > 1)
    return { error: `page ${id} is built from several spec files (${files.join(", ")})` };
  const order = tests[0]!.variants;
  const missing = order.filter((v) => !tests.some((t) => t.variant === v));
  if (missing.length > 0)
    return { incomplete: `${id} (no test of it ran for variant ${missing.join(", ")})` };
  const byVariant = [...groupBy(tests, (t) => t.variant ?? "")].sort(
    ([a], [b]) => order.indexOf(a) - order.indexOf(b),
  );
  const taken: Taken[] = [];
  let incomplete: string | undefined;
  for (const [, group] of byVariant) {
    const built = takeVariant(id, group[0]!.variant, group, results);
    if ("error" in built) return built;
    if ("incomplete" in built) incomplete ??= built.incomplete;
    else taken.push(built.page);
  }
  if (incomplete) return { incomplete };
  const joined = joinVariants(id, taken);
  if (!("page" in joined)) return joined;
  const [first] = tests;
  return {
    page: {
      slug: first!.slug,
      locale: first!.locale as Locale,
      meta: joined.page.meta,
      source: files[0]!,
      blocks: joined.page.blocks.map((b) => relativeTo(rootDir, b)),
    },
  };
}

export function collectPages(
  expected: ExpectedTest[],
  results: Map<string, TestOutcome>,
  rootDir: string,
): Collected {
  const collected: Collected = { pages: [], incomplete: [], errors: [] };
  const groups = groupBy(expected, (t) => pageId(t.slug, t.locale));
  for (const [id, tests] of groups) {
    const built = buildPage(id, tests, results, rootDir);
    if ("page" in built) collected.pages.push(built.page);
    else if ("incomplete" in built) collected.incomplete.push(built.incomplete);
    else collected.errors.push(built.error);
  }
  collected.incomplete.push(...missingLocales(expected, groups));
  return collected;
}
