// type tests with one registered locale: checked by `pnpm typecheck`, never run
import { defineConfig } from "@playwright/test";
import {
  guidePage,
  test,
  type GuideOptions,
  type Locale,
  type Meta,
  type Text,
} from "@tailor-platform/e2g/playwright";
import { assertType, type Equal } from "../equal.ts";

assertType<Equal<Locale, "en">>();
assertType<Equal<Text, string>>();
assertType<Equal<Meta, unknown>>();

test("one locale", guidePage("one", {}), async ({ guide }) => {
  await guide.say("A plain string.");
  // @ts-expect-error one locale takes a plain string
  await guide.step({ en: "Not a record." }, async () => {});
});

defineConfig<GuideOptions>({ use: { guideLocale: "en" } });
// @ts-expect-error only the registered locale
defineConfig<GuideOptions>({ use: { guideLocale: "ja" } });
