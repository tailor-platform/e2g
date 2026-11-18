import type { TestStep } from "@playwright/test/reporter";
import type { Block, Region, TakenShot } from "../../types.js";
import { readFile } from "../../core/io.js";
import { real } from "../../core/real.js";
import { PNG_PREFIX, SAY, SHOT, STEP } from "../protocol.js";

export interface ReadSteps {
  blocks: Block<TakenShot>[];
  shots: Map<string, Buffer>;
  /** Why a guide attachment could not be used; the test's page is then incomplete. */
  problem?: string;
}

type Attachment = TestStep["attachments"][number];

function body(attachment: Attachment): Buffer | undefined {
  if (attachment.body) return attachment.body;
  return attachment.path ? (readFile(attachment.path) ?? undefined) : undefined;
}

const isRegion = (value: unknown): value is Region =>
  typeof value === "object" &&
  value !== null &&
  (["x", "y", "width", "height"] as const).every(
    (key) => typeof (value as Record<string, unknown>)[key] === "number",
  );

const areRegions = (value: unknown): value is Region[] =>
  Array.isArray(value) && value.every(isRegion);

function shotOf(attachment: Attachment): TakenShot | undefined {
  const data = body(attachment);
  if (!data) return undefined;
  try {
    const { name, alt, regions } = JSON.parse(data.toString("utf8")) as Partial<
      Record<keyof TakenShot, unknown>
    >;
    return typeof name === "string" && typeof alt === "string" && areRegions(regions)
      ? { name, alt, regions }
      : undefined;
  } catch {
    return undefined;
  }
}

// absolute here; collectPages makes it relative to the rootDir
const locatedAt = (step: TestStep) =>
  step.location
    ? {
        location: {
          file: real(step.location.file),
          line: step.location.line,
          column: step.location.column,
        },
      }
    : {};

// Walks the steps depth-first in start order. Only the attachments of test.step steps are read:
// Playwright copies them into result.attachments too, and anything attached there directly is not a guide's.
export function readSteps(steps: readonly TestStep[]): ReadSteps {
  const read: ReadSteps = { blocks: [], shots: new Map() };
  const fail = (problem: string) => (read.problem ??= problem);
  const walk = (steps: readonly TestStep[]) => {
    for (const step of steps) {
      // testInfo.attach() makes a step of its own, which is never a guide's
      const attachments = step.category === "test.step" ? step.attachments : [];
      const say = attachments.find((a) => a.name === SAY);
      if (attachments.some((a) => a.name === STEP)) {
        const shots: TakenShot[] = [];
        for (const attachment of attachments) {
          if (attachment.name === SHOT) {
            const shot = shotOf(attachment);
            if (shot) shots.push(shot);
            else fail("a shot attachment could not be read");
          } else if (attachment.name.startsWith(PNG_PREFIX)) {
            const data = body(attachment);
            if (data) read.shots.set(attachment.name.slice(PNG_PREFIX.length), data);
          }
        }
        read.blocks.push({ kind: "step", text: step.title, shots, ...locatedAt(step) });
      } else if (say) {
        const data = body(say);
        if (data)
          read.blocks.push({ kind: "say", text: data.toString("utf8"), ...locatedAt(step) });
        else fail("a say attachment could not be read");
      } else walk(step.steps);
    }
  };
  walk(steps);
  return read;
}
