import { writeFileSync } from "node:fs";
import type { Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

// writes where each test.step step of each test was declared, to the file in GUIDES_LOCATIONS
export default class StepLocations implements Reporter {
  private found: { test: string; title: string; file?: string; line?: number }[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    const walk = (steps: readonly TestStep[]) => {
      for (const step of steps) {
        if (step.category === "test.step")
          this.found.push({
            test: test.title,
            title: step.title,
            file: step.location?.file,
            line: step.location?.line,
          });
        walk(step.steps);
      }
    };
    walk(result.steps);
  }

  onEnd() {
    writeFileSync(process.env.GUIDES_LOCATIONS!, JSON.stringify(this.found));
  }

  printsToStdio() {
    return false;
  }
}
