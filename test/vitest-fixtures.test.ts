import { test as base } from "vitest";
import { META_KEY } from "../src/vitest/protocol.js";
import { expect, guideFixtures, guidePage } from "../src/vitest/index.js";

const myTest = base.extend({ answer: 42 }).extend(guideFixtures);

myTest("gets its own fixtures next to e2g's", async ({ answer, guide, terminal }) => {
  expect(answer).toBe(42);
  expect(guide.locale).toBeUndefined();
  const { output } = await terminal.run("printf ok");
  expect(output).toContain("ok");
});

myTest.describe("in a guide run", () => {
  myTest.override({ guideLocale: "en" });

  myTest(
    "records blocks as usual",
    guidePage("own-test", { title: "Own test" }),
    async ({ answer, guide, onTestFinished }) => {
      onTestFinished(({ task }) => {
        expect(task.meta[META_KEY]?.record?.blocks).toMatchObject([
          { kind: "step", text: "Answer.", items: [{ kind: "command", output: "42" }] },
        ]);
      });
      await guide.step("Answer.", async () => {
        await guide.command({ command: "mycli answer", output: `${answer}\r\n` });
      });
    },
  );
});
