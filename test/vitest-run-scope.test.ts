import { describe, expect, it } from "vitest";
import type {
  TestModule,
  TestProject,
  TestRunEndReason,
  TestSpecification,
  Vitest,
} from "vitest/node";
import { vitestRunScope } from "../src/vitest/reporter/run-scope.js";

const ROOT = "/repo";
const FILES = [`${ROOT}/guides/a.test.ts`, `${ROOT}/guides/b.test.ts`];

function fakeProject(guide = true, files = FILES): TestProject {
  return {
    getProvidedContext: () => (guide ? { guideLocale: "en" } : {}),
    globTestFiles: async () => ({ testFiles: files, typecheckTestFiles: [] }),
  } as unknown as TestProject;
}

interface FakeRun {
  end?: TestRunEndReason;
  config?: Record<string, unknown>;
  pattern?: RegExp;
  specs?: Partial<TestSpecification>[];
  modules?: { moduleId: string; errors?: unknown[]; containsOnly?: boolean }[];
}

function scope(run: FakeRun = {}) {
  const project = fakeProject();
  const vitest = {
    config: { root: ROOT, watch: false, project: [], ...run.config },
    projects: [project],
    getGlobalTestNamePattern: () => run.pattern,
  } as unknown as Vitest;
  const specs = (run.specs ?? FILES.map((moduleId) => ({ moduleId }))).map((s) => ({
    project,
    ...s,
  })) as TestSpecification[];
  const fallback: NonNullable<FakeRun["modules"]> = FILES.map((moduleId) => ({ moduleId }));
  const modules = (run.modules ?? fallback).map((m) => ({
    project,
    moduleId: m.moduleId,
    errors: () => m.errors ?? [],
    task: { containsOnly: m.containsOnly ?? false },
  })) as unknown as TestModule[];
  return vitestRunScope(vitest, specs, modules, run.end);
}

const partial = (reason: string) => ({ partial: true, reason });

describe("vitestRunScope", () => {
  it("full run", async () => {
    expect(await scope()).toEqual({ partial: false });
  });

  it("an interrupted run", async () => {
    expect(await scope({ end: "interrupted" })).toEqual(partial("the run was interrupted"));
  });

  it("a failed run is still complete", async () => {
    expect(await scope({ end: "failed" })).toEqual({ partial: false });
  });

  it.each([
    [{ watch: true }, "it runs in watch mode"],
    [{ project: ["en"] }, "the projects are filtered with --project"],
    [{ shard: { index: 1, count: 2 } }, "the run is sharded"],
    [{ changed: true }, "--changed limits the run to changed files"],
    [{ related: ["src/a.ts"] }, "--related limits the run to related files"],
    [{ bail: 1 }, "bail stops the run early"],
    [{ tagsFilter: ["slow"] }, "the tags filter slow is set"],
  ])("config %j", async (config, reason) => {
    expect(await scope({ config })).toEqual(partial(reason));
  });

  it("a test name pattern", async () => {
    expect(await scope({ pattern: /create/ })).toEqual(
      partial("the test name filter /create/ is set"),
    );
  });

  it.each([
    [{ testLines: [3] }],
    [{ testIds: ["x"] }],
    [{ testNamePattern: /x/ }],
    [{ testTagsFilter: ["x"] }],
  ])("a specification narrowed by %j", async (narrow) => {
    const specs = [{ moduleId: FILES[0]!, ...narrow }, { moduleId: FILES[1]! }];
    expect(await scope({ specs })).toEqual(partial("only some tests in guides/a.test.ts run"));
  });

  it("a module that failed to load", async () => {
    const modules = [{ moduleId: FILES[0]! }, { moduleId: FILES[1]!, errors: [new Error("x")] }];
    expect(await scope({ modules })).toEqual(partial("guides/b.test.ts failed to load"));
  });

  it("a module with .only", async () => {
    const modules = [{ moduleId: FILES[0]!, containsOnly: true }, { moduleId: FILES[1]! }];
    expect(await scope({ modules })).toEqual(partial("guides/a.test.ts has a .only test or suite"));
  });

  it("a guide test file that did not run", async () => {
    expect(await scope({ specs: [{ moduleId: FILES[0]! }] })).toEqual(
      partial("guides/b.test.ts did not run"),
    );
  });

  it("ignores projects without a guide locale", async () => {
    const other = fakeProject(false, [`${ROOT}/other.test.ts`]);
    const vitest = {
      config: { root: ROOT, watch: false, project: [] },
      projects: [fakeProject(), other],
      getGlobalTestNamePattern: () => undefined,
    } as unknown as Vitest;
    const specs = FILES.map((moduleId) => ({ moduleId, project: vitest.projects[0] }));
    const modules = [
      { moduleId: `${ROOT}/other.test.ts`, project: other, errors: () => [new Error("x")] },
    ];
    expect(
      await vitestRunScope(
        vitest,
        specs as TestSpecification[],
        modules as unknown as TestModule[],
      ),
    ).toEqual({ partial: false });
  });
});
