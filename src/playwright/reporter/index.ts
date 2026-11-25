import { dirname } from "node:path";
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
import { ANNOTATION } from "../protocol.js";
import type { GuideOptions } from "../use.js";
import type { ExpectedTest, TestOutcome } from "../../core/collect.js";
import { real } from "../../core/real.js";
import { readSteps } from "./read-steps.js";
import { runScope, type RunScope } from "./run-scope.js";
import { sameScreen } from "../../core/same-screen.js";
import { writeGuides, type ShotPath } from "../../core/write.js";
import type { GuideOutput, PageInfo } from "../../core/types.js";

export type { GuideOutput, PageInfo } from "../../core/types.js";
export type { Page } from "../../types.js";

export interface GuidesReporterOptions {
  // oxlint-disable-next-line typescript/no-explicit-any -- any page meta the output understands
  output: GuideOutput<any>;
  shots: {
    dir: string;
    // oxlint-disable-next-line typescript/no-explicit-any -- any page meta the output understands
    path?: (page: PageInfo<any>, name: string, variant: string | undefined, ext: "png") => string;
    /** Whether two PNGs show the same screen. `false` rewrites a shot whenever its bytes differ. */
    same?: ((a: Buffer, b: Buffer) => boolean) | false;
  };
  manifest: string;
  prune?: boolean;
}

// browser guides only take PNG screenshots; the shared writer also handles terminal SVGs
function shotPath(path: GuidesReporterOptions["shots"]["path"]): ShotPath | undefined {
  if (!path) return undefined;
  return (page, name, variant, ext) => {
    if (ext !== "png") throw new Error(`a browser guide has no .${ext} files`);
    return path(page, name, variant, ext);
  };
}

interface GuideTest {
  slug: string;
  locale: string;
  variant?: string;
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
const guideVariant = (project: FullProject) => (project.use as Partial<GuideOptions>).guideVariant;

interface GuideProjects {
  projects: FullProject[];
  locales: string[];
  variants: string[];
}

function guideProjects(config: FullConfig): GuideProjects {
  const projects = config.projects.filter((p) => guideLocale(p) !== undefined);
  const withVariant = projects.find((p) => guideVariant(p) !== undefined);
  const withoutVariant = projects.find((p) => guideVariant(p) === undefined);
  if (withVariant && withoutVariant)
    throw new Error(
      `project "${withoutVariant.name}" sets no use.guideVariant, but project "${withVariant.name}" does`,
    );
  const seen = new Map<string, FullProject>();
  for (const project of projects) {
    const locale = guideLocale(project)!;
    const variant = guideVariant(project);
    const key = `${locale}\0${variant ?? ""}`;
    const first = seen.get(key);
    if (first)
      throw new Error(
        `projects "${first.name}" and "${project.name}" both set use.guideLocale "${locale}"${variant === undefined ? "" : ` and use.guideVariant "${variant}"`}`,
      );
    seen.set(key, project);
  }
  const locales = [...new Set(projects.map((p) => guideLocale(p)!))];
  const variants = withVariant ? [...new Set(projects.map((p) => guideVariant(p)!))] : [];
  for (const locale of locales)
    for (const variant of variants)
      if (!seen.has(`${locale}\0${variant}`))
        throw new Error(`locale "${locale}" has no project with use.guideVariant "${variant}"`);
  return { projects, locales, variants };
}

function guideOf(test: TestCase, project: FullProject): GuideTest | undefined {
  const annotation = test.annotations.find((a) => a.type === ANNOTATION);
  if (!annotation?.description) return undefined;
  const { slug, meta } = JSON.parse(annotation.description) as { slug: string; meta: unknown };
  const variant = guideVariant(project);
  return {
    slug,
    locale: guideLocale(project)!,
    ...(variant === undefined ? {} : { variant }),
    meta,
  };
}

function outcome(guide: GuideTest, result: TestResult): TestOutcome {
  const { blocks, shots, problem } = readSteps(result.steps);
  return {
    ok: result.status === "passed",
    record: { schemaVersion: 1, slug: guide.slug, locale: guide.locale, meta: guide.meta, blocks },
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
      const { projects, locales, variants } = guideProjects(config);
      if (projects.length === 0) {
        this.#skip = "no project sets use.guideLocale";
        return;
      }
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
          const guide = guideOf(test, project);
          if (!guide) continue;
          const { file, line, column } = test.location;
          tests.set(test.id, guide);
          expected.push({
            id: test.id,
            slug: guide.slug,
            locale: guide.locale,
            ...(guide.variant === undefined ? {} : { variant: guide.variant }),
            locales,
            variants,
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
    return writeGuides({
      base: config.configFile ? dirname(config.configFile) : config.rootDir,
      rootDir: real(config.rootDir),
      expected,
      results: this.#results,
      scope,
      output: options.output,
      shots: { dir: options.shots.dir, path: shotPath(options.shots.path) },
      manifest: options.manifest,
      prune: options.prune ?? false,
      same: options.shots.same === false ? () => false : (options.shots.same ?? sameScreen),
      log,
    });
  }
}
