import { isDeepStrictEqual } from "node:util";
import type { GuideRecord, Locale, Page } from "../types.js";
import { relativePath } from "./paths.js";

export interface ExpectedTest {
  id: string;
  slug: string;
  locale: string;
  locales: string[];
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

export type CollectedPage = Page<unknown> & { shots: Map<string, Buffer> };

interface Collected {
  pages: CollectedPage[];
  incomplete: string[];
  errors: string[];
}

type Built = { page: CollectedPage } | { incomplete: string } | { error: string };

const pageId = (slug: string, locale: string) => `${slug}/${locale}`;

function groupByPage(expected: ExpectedTest[]): Map<string, ExpectedTest[]> {
  const groups = new Map<string, ExpectedTest[]>();
  for (const test of expected) {
    const id = pageId(test.slug, test.locale);
    groups.set(id, [...(groups.get(id) ?? []), test]);
  }
  return groups;
}

// a locale's project left out with --project, or one that ran none of a guide's tests, leaves that page incomplete
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

function buildPage(
  id: string,
  tests: ExpectedTest[],
  results: Map<string, TestOutcome>,
  rootDir: string,
): Built {
  const files = [...new Set(tests.map((t) => relativePath(rootDir, t.file)))].sort();
  if (files.length > 1)
    return { error: `page ${id} is built from several spec files (${files.join(", ")})` };
  const sorted = [...tests].sort((a, b) => a.line - b.line || a.column - b.column);
  const outcomes = sorted.map((t) => results.get(t.id));
  if (outcomes.some((o) => !o?.ok))
    return { incomplete: `${id} (a test failed, was skipped or did not run)` };
  const problem = outcomes.find((o) => o!.problem)?.problem;
  if (problem) return { incomplete: `${id} (${problem})` };
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
      incomplete: `${id} (a step has no shot attachment; run with guideShots on to write it)`,
    };
  const [first] = sorted;
  return {
    page: {
      slug: first!.slug,
      locale: first!.locale as Locale,
      meta,
      source: files[0]!,
      blocks: records.flatMap((r) => r.blocks),
      shots: new Map(names.map((name) => [name, shots.get(name)!])),
    },
  };
}

export function collectPages(
  expected: ExpectedTest[],
  results: Map<string, TestOutcome>,
  rootDir: string,
): Collected {
  const groups = groupByPage(expected);
  const collected: Collected = { pages: [], incomplete: [], errors: [] };
  for (const [id, tests] of groups) {
    const built = buildPage(id, tests, results, rootDir);
    if ("page" in built) collected.pages.push(built.page);
    else if ("incomplete" in built) collected.incomplete.push(built.incomplete);
    else collected.errors.push(built.error);
  }
  collected.incomplete.push(...missingLocales(expected, groups));
  return collected;
}
