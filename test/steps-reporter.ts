import { isDeepStrictEqual } from "node:util";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import {
  EXPECT_LOCATIONS,
  EXPECT_STEPS,
  stepLocations,
  stepTree,
  type StepLocation,
} from "./steps.ts";

// fails the run when a passed test's steps differ from what it declared with expectSteps()
export default class StepsReporter implements Reporter {
  private declared = 0;
  private checked = 0;
  private failed: string[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    const declared = (type: string) => result.annotations.find((a) => a.type === type)?.description;
    const steps = declared(EXPECT_STEPS);
    const locations = declared(EXPECT_LOCATIONS);
    if (steps === undefined && locations === undefined) return;
    this.declared += 1;
    if (result.status !== "passed") return;
    this.checked += 1;
    const id = `[${test.parent.project()?.name}] ${test.titlePath().slice(2).join(" > ")}`;
    const differs = (expected: string, actual: unknown) => {
      if (isDeepStrictEqual(actual, JSON.parse(expected))) return;
      this.failed.push(id);
      process.stderr.write(
        `steps-reporter: ${id}\n  expected ${expected}\n  actual   ${JSON.stringify(actual)}\n`,
      );
    };
    if (steps !== undefined) differs(steps, stepTree(result.steps));
    if (locations !== undefined) {
      const titles = new Set((JSON.parse(locations) as StepLocation[]).map((l) => l.title));
      differs(
        locations,
        stepLocations(result.steps).filter((l) => titles.has(l.title)),
      );
    }
  }

  async onEnd(): Promise<{ status?: FullResult["status"] } | undefined> {
    process.stderr.write(
      `steps-reporter: checked ${this.checked} tests, ${this.failed.length} differ\n`,
    );
    // tests declared their steps but none were compared: the check itself is broken
    const unchecked = this.declared > 0 && this.checked === 0;
    if (unchecked) process.stderr.write("steps-reporter: no declared steps were checked\n");
    return this.failed.length > 0 || unchecked ? { status: "failed" } : undefined;
  }

  printsToStdio() {
    return false;
  }
}
