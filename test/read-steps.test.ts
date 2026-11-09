import type { TestStep } from "@playwright/test/reporter";
import { describe, expect, it } from "vitest";
import { readSteps } from "../src/playwright/reporter/read-steps.js";
import { PNG_PREFIX, SAY, SHOT, STEP } from "../src/playwright/protocol.js";

type Attachment = TestStep["attachments"][number];

const attachment = (name: string, body?: string | Buffer, path?: string): Attachment => ({
  name,
  contentType: "application/octet-stream",
  ...(body === undefined ? {} : { body: Buffer.from(body) }),
  ...(path === undefined ? {} : { path }),
});

function step(
  title: string,
  attachments: Attachment[] = [],
  steps: TestStep[] = [],
  category = "test.step",
): TestStep {
  return { title, category, attachments, steps } as unknown as TestStep;
}

const mark = attachment(STEP, "");
const shotInfo = (name: string, alt: string) => attachment(SHOT, JSON.stringify({ name, alt }));

describe("readSteps", () => {
  it("reads guide steps and paragraphs depth-first, and only from test.step steps", () => {
    const read = readSteps([
      step("Before Hooks", [], [step("Intro", [attachment(SAY, "Intro text.")])], "hook"),
      step(
        "Helper",
        [],
        [step("Click.", [mark, shotInfo("01", "One"), attachment(PNG_PREFIX + "01", "png")])],
      ),
      step("Attach", [attachment(SAY, "Ghost.")], [], "test.attach"),
      step("Plain", [], [step("Inner plain")]),
    ]);
    expect(read).toEqual({
      blocks: [
        { kind: "say", text: "Intro text." },
        { kind: "step", text: "Click.", shots: [{ name: "01", alt: "One" }] },
      ],
      shots: new Map([["01", Buffer.from("png")]]),
    });
  });

  it.each([
    ["not JSON", attachment(SHOT, "{ nope")],
    ["no name", attachment(SHOT, JSON.stringify({ alt: "x" }))],
    ["a non-string alt", attachment(SHOT, JSON.stringify({ name: "01", alt: 3 }))],
    ["no body", attachment(SHOT, undefined, "/no/such/file")],
  ])("a shot attachment with %s is a problem", (_, bad) => {
    const read = readSteps([step("Click.", [mark, bad])]);
    expect(read.problem).toBe("a shot attachment could not be read");
  });

  it("a say attachment without a body is a problem", () => {
    const read = readSteps([step("Intro", [attachment(SAY, undefined, "/no/such/file")])]);
    expect(read.problem).toBe("a say attachment could not be read");
  });
});
