import { dirname, join, resolve } from "node:path";
import { collectPages, type ExpectedTest, type TestOutcome } from "./collect.js";
import {
  caseInsensitive,
  commit,
  EMPTY_MANIFEST,
  entryOutside,
  readFile,
  readManifest,
} from "./io.js";
import { foreignPaths } from "./manifests.js";
import { outputPaths, plan, type PlanInput } from "./plan.js";
import type { GuideOutput, PageInfo, RunScope } from "./types.js";

export type ShotPath = (
  page: PageInfo<unknown>,
  name: string,
  variant: string | undefined,
  ext: "png" | "svg",
) => string;

export interface WriteGuidesInput {
  /** The directory that the relative paths in the options resolve from. */
  base: string;
  /** The directory that page sources and block locations are relative to. */
  rootDir: string;
  expected: ExpectedTest[];
  results: Map<string, TestOutcome>;
  scope: RunScope;
  output: GuideOutput<unknown>;
  shots: { dir: string; path?: ShotPath };
  manifest: string;
  prune: boolean;
  same(a: Buffer, b: Buffer): boolean;
  log(message: string): void;
}

/** @returns whether the guides have errors that fail the run */
export function writeGuides(input: WriteGuidesInput): boolean {
  const { log, output, shots } = input;
  const at = (path: string) => resolve(input.base, path);
  const shotsDir = at(shots.dir);
  const manifestPath = at(input.manifest);
  const manifestDir = dirname(manifestPath);
  const insensitive = caseInsensitive(manifestDir);
  const { pages, incomplete, errors } = collectPages(input.expected, input.results, input.rootDir);
  const paths: Pick<PlanInput, "output" | "shotPath"> = {
    output: {
      path: (page) => at(output.path(page)),
      render: (page) => output.render(page),
    },
    shotPath: (page, name, variant, ext) =>
      shots.path
        ? at(shots.path(page, name, variant, ext))
        : join(
            shotsDir,
            page.locale,
            page.slug,
            ...(variant === undefined ? [] : [variant]),
            `${name}.${ext}`,
          ),
  };
  // the directories this run writes into are where a previous run's files belong
  const roots = [shotsDir, manifestDir, ...outputPaths(pages, paths).map((p) => dirname(p))];
  const read = readManifest(manifestPath);
  const outside = read && entryOutside(read, manifestDir, roots);
  const manifest = outside === undefined ? read : null;
  const previous = manifest ?? EMPTY_MANIFEST;
  if (!read) log(`left ${manifestPath} as it is because it could not be read; fix or delete it`);
  else if (!manifest)
    log(
      `left ${manifestPath} as it is because it lists ${outside}, which is outside the guide folders; fix or delete it`,
    );
  const result = plan({
    scope: input.scope,
    prune: manifest !== null && input.prune,
    pages,
    incomplete,
    errors,
    ...paths,
    foreign: foreignPaths(manifestPath, insensitive),
    caseInsensitive: insensitive,
    manifestDir,
    manifest: previous,
    current: readFile,
    same: input.same,
  });
  for (const m of [...result.errors, ...result.messages]) log(m);
  commit({
    ops: result.ops,
    roots: [shotsDir, manifestDir],
    manifestPath: manifest ? manifestPath : null,
    previous,
    manifest: result.manifest,
  });
  const written = result.ops.filter((op) => op.op === "write").length;
  const deleted = result.ops.length - written;
  if (result.ops.length > 0) log(`wrote ${written} and deleted ${deleted} guide files`);
  return result.errors.length > 0;
}
