// the README's "Already have your own `test`?" snippet, kept here so `pnpm typecheck` covers it
import { test as base } from "vitest";
import { guideFixtures } from "@tailor-platform/e2g/vitest";

export const test = base.extend({ answer: 42 }).extend(guideFixtures);

test("own fixtures next to e2g's", async ({ answer, guide, terminal }) => {
  const sum: number = answer;
  const locale: string | undefined = guide.locale;
  await terminal.run("mycli status");
  void sum;
  void locale;
});
