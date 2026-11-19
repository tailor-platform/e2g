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
const shotInfo = (name: string, alt: string) =>
  attachment(SHOT, JSON.stringify({ name, alt, regions: [] }));

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
        {
          kind: "step",
          text: "Click.",
          items: [{ kind: "shot", name: "01", alt: "One", regions: [] }],
        },
      ],
      shots: new Map([["01", Buffer.from("png")]]),
    });
  });

  it.each([
    ["not JSON", attachment(SHOT, "{ nope")],
    ["no name", attachment(SHOT, JSON.stringify({ alt: "x", regions: [] }))],
    ["a non-string alt", attachment(SHOT, JSON.stringify({ name: "01", alt: 3, regions: [] }))],
    ["no regions", attachment(SHOT, JSON.stringify({ name: "01", alt: "x" }))],
    [
      "a region without a number",
      attachment(
        SHOT,
        JSON.stringify({ name: "01", alt: "x", regions: [{ x: 0, y: 0, width: 1 }] }),
      ),
    ],
    ["no body", attachment(SHOT, undefined, "/no/such/file")],
  ])("a shot attachment with %s is a problem", (_, bad) => {
    const read = readSteps([step("Click.", [mark, bad])]);
    expect(read.problem).toBe("a shot attachment could not be read");
  });

  it("a block is located where its guide call was", () => {
    const at = (line: number) => ({ file: "/no/such/dir/a.spec.ts", line, column: 3 });
    const located = (title: string, attachments: Attachment[], line: number) =>
      ({ ...step(title, attachments), location: at(line) }) as TestStep;
    const read = readSteps([
      located("Intro", [attachment(SAY, "Intro text.")], 4),
      located("Click.", [mark], 7),
    ]);
    expect(read.blocks).toEqual([
      { kind: "say", text: "Intro text.", location: at(4) },
      { kind: "step", text: "Click.", items: [], location: at(7) },
    ]);
  });

  it("a shot keeps its regions", () => {
    const regions = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }];
    const read = readSteps([
      step("Click.", [mark, attachment(SHOT, JSON.stringify({ name: "01", alt: "One", regions }))]),
    ]);
    expect(read.blocks).toEqual([
      { kind: "step", text: "Click.", items: [{ kind: "shot", name: "01", alt: "One", regions }] },
    ]);
  });

  it("a say attachment without a body is a problem", () => {
    const read = readSteps([step("Intro", [attachment(SAY, undefined, "/no/such/file")])]);
    expect(read.problem).toBe("a say attachment could not be read");
  });
});
