import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TestModule,
  TestProject,
  TestRunEndReason,
  TestSpecification,
  Vitest,
} from "vitest/node";
import { guidesReporter } from "../src/vitest/reporter/index.js";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// a run of one passing guide test, faked down to what the reporter reads
async function run(end: TestRunEndReason) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "e2g-interrupt-")));
  dirs.push(root);
  const file = join(root, "a.test.ts");
  writeFileSync(file, "");
  const project = {
    getProvidedContext: () => ({ guideLocale: "en" }),
    globTestFiles: async () => ({ testFiles: [file], typecheckTestFiles: [] }),
  } as unknown as TestProject;
  const vitest = {
    config: { root, watch: false, project: [] },
    viteConfig: {},
    projects: [project],
    getGlobalTestNamePattern: () => undefined,
  } as unknown as Vitest;
  const module: Record<string, unknown> = { moduleId: file, project, errors: () => [], task: {} };
  const test = {
    id: "t1",
    project,
    module,
    location: { line: 1, column: 1 },
    result: () => ({ state: "passed" }),
    meta: () => ({ e2g: { slug: "intro", meta: {}, record: { blocks: [], svgs: {} } } }),
  };
  module.children = { allTests: () => [test] };
  const logs: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    logs.push(String(chunk));
    return true;
  });
  const reporter = guidesReporter({
    output: { path: (p) => `docs/${p.slug}.md`, render: () => "# Intro\n" },
    shots: { dir: "shots" },
    manifest: "docs/manifest.json",
  });
  reporter.onInit!(vitest);
  reporter.onTestRunStart!([{ moduleId: file, project } as unknown as TestSpecification]);
  await reporter.onTestRunEnd!([module as unknown as TestModule], [], end);
  vi.restoreAllMocks();
  return { logs, page: existsSync(join(root, "docs/intro.md")) };
}

describe("guidesReporter", () => {
  it("writes nothing when the run was interrupted", async () => {
    const { logs, page } = await run("interrupted");
    expect(page).toBe(false);
    expect(logs).toContain("e2g: wrote no guide pages because the run was interrupted\n");
  });

  it("writes a complete run", async () => {
    expect((await run("passed")).page).toBe(true);
  });
});
