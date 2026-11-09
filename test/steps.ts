import { test } from "@playwright/test";
import type { TestStep } from "@playwright/test/reporter";

export const EXPECT_STEPS = "expect-steps";

export interface StepNode {
  title: string;
  attachments: { name: string; contentType: string; body: string }[];
  steps: StepNode[];
}

const PNG_SIGNATURE = "89504e470d0a1a0a";

// the test.step steps of a result, with their own attachments; other steps (expect, pw:api, hooks)
// are left out and their test.step children lifted to the nearest kept parent
export function stepTree(steps: readonly TestStep[]): StepNode[] {
  return steps.flatMap((s) => {
    const steps = stepTree(s.steps);
    if (s.category !== "test.step") return steps;
    const attachments = s.attachments.map((a) => ({
      name: a.name,
      contentType: a.contentType,
      body:
        a.contentType === "image/png"
          ? a.body?.subarray(0, 8).toString("hex") === PNG_SIGNATURE
            ? "<png>"
            : "<not a png>"
          : (a.body?.toString("utf8") ?? `<path ${a.path}>`),
    }));
    return [{ title: s.title, attachments, steps }];
  });
}

// checked by test/steps-reporter.ts once the test has passed, since a test cannot read its steps
export function expectSteps(expected: StepNode[]) {
  test.info().annotations.push({ type: EXPECT_STEPS, description: JSON.stringify(expected) });
}

export const EXPECT_LOCATIONS = "expect-locations";

export interface StepLocation {
  title: string;
  file: string;
  line: number;
}

// where each test.step step was declared, in start order
export function stepLocations(steps: readonly TestStep[]): StepLocation[] {
  return steps.flatMap((s) => [
    ...(s.category === "test.step" && s.location
      ? [{ title: s.title, file: s.location.file, line: s.location.line }]
      : []),
    ...stepLocations(s.steps),
  ]);
}

// checked by test/steps-reporter.ts: the steps with these titles have these locations
export function expectLocations(expected: StepLocation[]) {
  test.info().annotations.push({ type: EXPECT_LOCATIONS, description: JSON.stringify(expected) });
}

// the line of the code that calls this
export function callerLine(): number {
  const frame = new Error().stack!.split("\n")[2]!;
  return Number(/:(\d+):\d+\)?$/.exec(frame)![1]);
}
