import type {
  TestModule,
  TestProject,
  TestRunEndReason,
  TestSpecification,
  Vitest,
} from "vitest/node";
import { relativePath } from "../../core/paths.js";
import { real } from "../../core/real.js";
import type { RunScope } from "../../core/types.js";

export const isGuideProject = (project: TestProject) =>
  project.getProvidedContext().guideLocale !== undefined;

const narrowed = (spec: TestSpecification) =>
  Boolean(
    spec.testLines?.length ||
    spec.testIds?.length ||
    spec.testNamePattern ||
    spec.testTagsFilter?.length,
  );

// The runner turns an `only` mode into `run` before the reporter sees it, so the public options never
// show it. The file task's containsOnly flag is what Vitest's own partial-run check reads.
const hasOnly = (module: TestModule) =>
  (module as unknown as { task?: { containsOnly?: boolean } }).task?.containsOnly === true;

/**
 * Decides whether the run covers only part of the guide projects' tests, so the reporter must not
 * write or delete pages. Everything comes from Vitest's resolved config and run state, not argv.
 */
export async function vitestRunScope(
  vitest: Vitest,
  specifications: readonly TestSpecification[],
  modules: readonly TestModule[],
  end: TestRunEndReason = "passed",
): Promise<RunScope> {
  const partial = (reason: string): RunScope => ({ partial: true, reason });
  // a cancelled run (Ctrl+C, cancelCurrentRun) stops before every test has run
  if (end === "interrupted") return partial("the run was interrupted");
  const { config } = vitest;
  const file = (path: string) => relativePath(real(config.root), real(path));
  if (config.watch) return partial("it runs in watch mode");
  // Vitest resolves only the projects that pass the filter, so a guide project it left out is unknowable
  if (config.project.length > 0) return partial("the projects are filtered with --project");
  if (config.shard) return partial("the run is sharded");
  if (config.changed) return partial("--changed limits the run to changed files");
  if (config.related?.length) return partial("--related limits the run to related files");
  if (config.bail) return partial("bail stops the run early");
  const pattern = vitest.getGlobalTestNamePattern();
  if (pattern) return partial(`the test name filter ${pattern} is set`);
  if (config.tagsFilter?.length)
    return partial(`the tags filter ${config.tagsFilter.join(" ")} is set`);

  const specs = specifications.filter((s) => isGuideProject(s.project));
  const cut = specs.find(narrowed);
  if (cut) return partial(`only some tests in ${file(cut.moduleId)} run`);
  const guideModules = modules.filter((m) => isGuideProject(m.project));
  const broken = guideModules.find((m) => m.errors().length > 0);
  if (broken) return partial(`${file(broken.moduleId)} failed to load`);
  const only = guideModules.find(hasOnly);
  if (only) return partial(`${file(only.moduleId)} has a .only test or suite`);

  // a file filter or a programmatic run leaves files out without a trace in the config
  for (const project of vitest.projects.filter(isGuideProject)) {
    const ran = new Set(specs.filter((s) => s.project === project).map((s) => s.moduleId));
    const { testFiles } = await project.globTestFiles();
    const missing = testFiles.find((f) => !ran.has(f));
    if (missing !== undefined) return partial(`${file(missing)} did not run`);
  }
  return { partial: false };
}
