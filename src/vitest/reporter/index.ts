import { dirname } from "node:path";
import type { SerializedError } from "vitest";
import type {
  Reporter,
  TestCase,
  TestModule,
  TestProject,
  TestRunEndReason,
  TestSpecification,
  Vitest,
} from "vitest/node";
import type { ExpectedTest, TestOutcome } from "../../core/collect.js";
import { real } from "../../core/real.js";
import { writeGuides } from "../../core/write.js";
import type { GuideOutput, PageInfo, RunScope } from "../../core/types.js";
import { META_KEY, type GuideMeta } from "../protocol.js";
import { isGuideProject, vitestRunScope } from "./run-scope.js";

export type { GuideOutput, PageInfo } from "../../core/types.js";
export type { Page } from "../../types.js";
export { guideProjects, type GuideProjectsOptions } from "./projects.js";

export interface GuidesReporterOptions {
  // oxlint-disable-next-line typescript/no-explicit-any -- any page meta the output understands
  output: GuideOutput<any>;
  shots: {
    dir: string;
    // oxlint-disable-next-line typescript/no-explicit-any -- any page meta the output understands
    path?: (page: PageInfo<any>, name: string, ext: "svg") => string;
  };
  manifest: string;
  prune?: boolean;
}

const PREFIX = "e2g: ";

function log(message: string) {
  process.stderr.write(`${PREFIX}${message}\n`);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const localeOf = (project: TestProject) => project.getProvidedContext().guideLocale;

function* testsOf(modules: ReadonlyArray<TestModule>): Generator<[TestCase, GuideMeta]> {
  for (const module of modules)
    for (const test of module.children.allTests()) {
      const guide = test.meta()[META_KEY];
      if (guide) yield [test, guide];
    }
}

function outcome(test: TestCase, guide: GuideMeta, locale: string): TestOutcome {
  const record = guide.record ?? { blocks: [], svgs: {} };
  return {
    ok: test.result().state === "passed",
    record: { schemaVersion: 1, slug: guide.slug, locale, meta: guide.meta, blocks: record.blocks },
    shots: new Map(Object.entries(record.svgs).map(([name, svg]) => [name, Buffer.from(svg)])),
    ...(record.problem ? { problem: record.problem } : {}),
  };
}

class GuidesReporter implements Reporter {
  readonly #options: GuidesReporterOptions;
  #vitest?: Vitest;
  #specifications: readonly TestSpecification[] = [];

  constructor(options: GuidesReporterOptions) {
    this.#options = options;
  }

  onInit(vitest: Vitest): void {
    this.#vitest = vitest;
  }

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    this.#specifications = specifications;
  }

  async onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
    reason: TestRunEndReason,
  ): Promise<void> {
    try {
      const vitest = this.#vitest!;
      const scope = await this.#scope(vitest, testModules, unhandledErrors, reason);
      if (this.#write(vitest, testModules, scope)) process.exitCode = 1;
    } catch (error) {
      log(messageOf(error));
      process.exitCode = 1;
    }
  }

  // the one place that decides whether this run may write
  #scope(
    vitest: Vitest,
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
    reason: TestRunEndReason,
  ): Promise<RunScope> | RunScope {
    if (unhandledErrors.length > 0)
      return { partial: true, reason: "Vitest reported an error outside the tests" };
    return vitestRunScope(vitest, this.#specifications, testModules, reason);
  }

  /** @returns whether the guides have errors that fail the run */
  #write(vitest: Vitest, testModules: ReadonlyArray<TestModule>, scope: RunScope): boolean {
    const projects = vitest.projects.filter(isGuideProject);
    if (projects.length === 0) {
      log("wrote no guide pages because no project provides guideLocale");
      return false;
    }
    const locales = [...new Set(projects.map((p) => localeOf(p)!))];
    const rootDir = real(vitest.config.root);
    const expected: ExpectedTest[] = [];
    const results = new Map<string, TestOutcome>();
    for (const [test, guide] of testsOf(testModules)) {
      const locale = localeOf(test.project);
      if (locale === undefined) continue;
      expected.push({
        id: test.id,
        slug: guide.slug,
        locale,
        locales,
        variants: [],
        file: real(test.module.moduleId),
        line: test.location?.line ?? 0,
        column: test.location?.column ?? 0,
      });
      results.set(test.id, outcome(test, guide, locale));
    }
    const options = this.#options;
    const { path } = options.shots;
    const configFile = vitest.viteConfig.configFile;
    return writeGuides({
      base: configFile ? dirname(configFile) : vitest.config.root,
      rootDir,
      expected,
      results,
      scope,
      output: options.output,
      shots: {
        dir: options.shots.dir,
        // a Vitest guide has no variants and its only images are screens, which are SVG
        ...(path ? { path: (page, name) => path(page, name, "svg") } : {}),
      },
      manifest: options.manifest,
      prune: options.prune ?? false,
      // screens compare by bytes only, so there is no looser comparison to make
      same: () => false,
      log,
    });
  }
}

/** A Vitest reporter that writes a guide page per locale from the guide tests, once they all pass. */
export function guidesReporter(options: GuidesReporterOptions): Reporter {
  return new GuidesReporter(options);
}
