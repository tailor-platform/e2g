import type { TestStep } from "@playwright/test/reporter";
import type { Block, Shot } from "../../types.js";
import { readFile } from "../../core/io.js";
import { PNG_PREFIX, SAY, SHOT, STEP } from "../protocol.js";

export interface ReadSteps {
  blocks: Block[];
  shots: Map<string, Buffer>;
  /** Why a guide attachment could not be used; the test's page is then incomplete. */
  problem?: string;
}

type Attachment = TestStep["attachments"][number];

function body(attachment: Attachment): Buffer | undefined {
  if (attachment.body) return attachment.body;
  return attachment.path ? (readFile(attachment.path) ?? undefined) : undefined;
}

function shotOf(attachment: Attachment): Shot | undefined {
  const data = body(attachment);
  if (!data) return undefined;
  try {
    const { name, alt } = JSON.parse(data.toString("utf8")) as Partial<Record<keyof Shot, unknown>>;
    return typeof name === "string" && typeof alt === "string" ? { name, alt } : undefined;
  } catch {
    return undefined;
  }
}

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
        const shots: Shot[] = [];
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
        read.blocks.push({ kind: "step", text: step.title, shots });
      } else if (say) {
        const data = body(say);
        if (data) read.blocks.push({ kind: "say", text: data.toString("utf8") });
        else fail("a say attachment could not be read");
      } else walk(step.steps);
    }
  };
  walk(steps);
  return read;
}
