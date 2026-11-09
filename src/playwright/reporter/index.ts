import { dirname, join, resolve } from "node:path";
import type {
  FullConfig,
  FullProject,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter";
import type { Page } from "../../types.js";
import { ANNOTATION } from "../protocol.js";
import type { GuideOptions } from "../use.js";
import { collectPages, type ExpectedTest, type TestOutcome } from "../../core/collect.js";
import { real } from "../../core/real.js";
import { commit, EMPTY_MANIFEST, readFile, readManifest } from "../../core/io.js";
import { readSteps } from "./read-steps.js";
import { plan } from "../../core/plan.js";
import { runScope, type RunScope } from "./run-scope.js";
import { sameScreen } from "../../core/same-screen.js";
import type { GuideOutput } from "../../core/types.js";

export type { GuideOutput } from "../../core/types.js";
export type { Page } from "../../types.js";

export interface GuidesReporterOptions {
  // oxlint-disable-next-line typescript/no-explicit-any -- any page meta the output understands
  output: GuideOutput<any>;
  shots: {
    dir: string;
    // oxlint-disable-next-line typescript/no-explicit-any -- any page meta the output understands
    path?: (page: Page<any>, name: string) => string;
    /** Whether two PNGs show the same screen. `false` rewrites a shot whenever its bytes differ. */
    same?: ((a: Buffer, b: Buffer) => boolean) | false;
  };
  manifest: string;
  prune?: boolean;
}

interface GuideTest {
  slug: string;
  locale: string;
  meta: unknown;
}

interface Run {
  config: FullConfig;
  scope: RunScope;
  expected: ExpectedTest[];
  tests: Map<string, GuideTest>;
}

const PREFIX = "e2g: ";

function log(message: string) {
  process.stderr.write(`${PREFIX}${message}\n`);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const guideLocale = (project: FullProject) => (project.use as Partial<GuideOptions>).guideLocale;

function guideProjects(config: FullConfig): FullProject[] {
  const projects = config.projects.filter((p) => guideLocale(p) !== undefined);
  const byLocale = new Map<string, FullProject>();
  for (const project of projects) {
    const locale = guideLocale(project)!;
    const first = byLocale.get(locale);
    if (first)
      throw new Error(
        `projects "${first.name}" and "${project.name}" both set use.guideLocale "${locale}"`,
      );
    byLocale.set(locale, project);
  }
  return projects;
}

function guideOf(test: TestCase, locale: string): GuideTest | undefined {
  const annotation = test.annotations.find((a) => a.type === ANNOTATION);
  if (!annotation?.description) return undefined;
  const { slug, meta } = JSON.parse(annotation.description) as { slug: string; meta: unknown };
  return { slug, locale, meta };
}

function outcome(guide: GuideTest, result: TestResult): TestOutcome {
  const { blocks, shots, problem } = readSteps(result.steps);
  return {
    ok: result.status === "passed",
    record: { schemaVersion: 1, ...guide, blocks },
    shots,
    ...(problem ? { problem } : {}),
  };
}

export default class GuidesReporter implements Reporter {
  readonly #options: GuidesReporterOptions;
  readonly #results = new Map<string, TestOutcome>();
  #run?: Run;
  #skip?: string;
  #outsideError = false;
  #error?: unknown;

  constructor(options: GuidesReporterOptions) {
    this.#options = options;
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.#guard(() => {
      const projects = guideProjects(config);
      if (projects.length === 0) {
        this.#skip = "no project sets use.guideLocale";
        return;
      }
      const locales = projects.map((p) => guideLocale(p)!);
      // a project left out with --project ran none of its pages, so they come out incomplete
      const selected = projects.filter((p) =>
        config.filteredProjects.some((f) => f.name === p.name),
      );
      const scope = selected.map((p) => runScope(config, p)).find((s) => s.partial) ?? {
        partial: false,
      };
      const expected: ExpectedTest[] = [];
      const tests = new Map<string, GuideTest>();
      for (const project of selected) {
        const projectSuite = suite.suites.find((s) => s.project()?.name === project.name);
        for (const test of projectSuite?.allTests() ?? []) {
          const guide = guideOf(test, guideLocale(project)!);
          if (!guide) continue;
          const { file, line, column } = test.location;
          tests.set(test.id, guide);
          expected.push({
            id: test.id,
            slug: guide.slug,
            locale: guide.locale,
            locales,
            file: real(file),
            line,
            column,
          });
        }
      }
      this.#run = { config, scope, expected, tests };
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.#guard(() => {
      const guide = this.#run?.tests.get(test.id);
      if (!guide) return;
      // a retried test ends once per attempt; the last attempt decides
      this.#results.set(test.id, outcome(guide, result));
    });
  }

  // an error outside any test, such as a spec file that failed to load, may have dropped guides from the run
  onError(_error: TestError): void {
    this.#outsideError = true;
  }

  async onEnd(_result: FullResult): Promise<{ status?: FullResult["status"] } | undefined> {
    try {
      if (this.#error) throw this.#error;
      if (this.#skip) log(`wrote no guide pages because ${this.#skip}`);
      else if (this.#run && this.#write(this.#run)) return { status: "failed" };
      return undefined;
    } catch (error) {
      log(messageOf(error));
      return { status: "failed" };
    }
  }

  #guard(fn: () => void) {
    if (this.#error) return;
    try {
      fn();
    } catch (error) {
      this.#error = error;
    }
  }

  /** @returns whether the guides have errors that fail the run */
  #write({ config, scope: testScope, expected }: Run): boolean {
    const scope: RunScope =
      this.#outsideError && !testScope.partial
        ? { partial: true, reason: "Playwright reported an error outside the tests" }
        : testScope;
    const options = this.#options;
    const base = config.configFile ? dirname(config.configFile) : config.rootDir;
    const at = (path: string) => resolve(base, path);
    const shotsDir = at(options.shots.dir);
    const manifestPath = at(options.manifest);
    const manifestDir = dirname(manifestPath);
    const same = options.shots.same === false ? () => false : (options.shots.same ?? sameScreen);
    const manifest = readManifest(manifestPath);
    const previous = manifest ?? EMPTY_MANIFEST;
    if (!manifest)
      log(`left ${manifestPath} as it is because it could not be read; fix or delete it`);
    const { pages, incomplete, errors } = collectPages(
      expected,
      this.#results,
      real(config.rootDir),
    );
    const result = plan({
      scope,
      prune: manifest !== null && (options.prune ?? false),
      pages,
      incomplete,
      errors,
      output: {
        path: (page) => at(options.output.path(page)),
        render: (page, ctx) => options.output.render(page, ctx),
      },
      shotPath: (page, name) =>
        options.shots.path
          ? at(options.shots.path(page, name))
          : join(shotsDir, page.locale, page.slug, `${name}.png`),
      manifestDir,
      manifest: previous,
      current: readFile,
      same,
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
}
