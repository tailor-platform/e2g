// type tests without a Register: checked by `pnpm typecheck`, never run
import { defineConfig, test as playwrightTest } from "@playwright/test";
import {
  expect,
  guidePage,
  guideTest,
  test,
  type Guide,
  type GuideOptions,
  type Locale,
  type Meta,
  type Text,
} from "@tailor-platform/e2g/playwright";
import type { GuideOutput } from "@tailor-platform/e2g/playwright/reporter";
import { assertType, type Equal } from "./equal.ts";

assertType<Equal<Locale, string>>();
assertType<Equal<Meta, unknown>>();
assertType<Equal<Text, string | Record<string, string>>>();
assertType<Equal<typeof test, typeof guideTest>>();
assertType<Equal<typeof expect, typeof import("@playwright/test").expect>>();

guidePage("any", { anything: 1 });
guidePage("any", null);

// a project without fixtures of its own imports everything from the package
test("text", guidePage("text", null), async ({ guide, page }) => {
  await guide.say("Plain text.");
  await guide.say({ en: "Any", fr: "locale" });
  await guide.step("A step.", async () => {
    await guide.shot("01-a", { alt: { de: "Bild" }, page });
  });
  await expect(page).toHaveTitle("");
});

playwrightTest("not a guide test", async () => {});

const steps = async (guide: Guide) => {
  const n: number = await guide.step("Count.", async () => 1, { box: true, timeout: 5 });
  await guide.step("Located.", async () => {}, {
    location: { file: "a.spec.ts", line: 1, column: 1 },
  });
  return n;
};
void steps;

const output: GuideOutput = {
  path: (page) => `${page.locale}/${page.slug}.md`,
  render: (page) => {
    assertType<Equal<typeof page.meta, unknown>>();
    return "";
  },
};
void output;

defineConfig<GuideOptions>({
  use: { guideLocale: "anything", guideShots: true, guideClock: new Date(), guideShot: {} },
  projects: [
    { use: { guideClock: false } },
    { use: { guideClock: 0 } },
    { use: { guideClock: "fixed" } },
  ],
});
// @ts-expect-error guideClock is "fixed", false, a Date or a number
defineConfig<GuideOptions>({ use: { guideClock: true } });
