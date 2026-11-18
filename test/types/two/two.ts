// type tests with two registered locales and a meta: checked by `pnpm typecheck`, never run
import { defineConfig, mergeTests, test as base } from "@playwright/test";
import {
  guidePage,
  guideTest,
  type GuideOptions,
  type Locale,
  type Meta,
  type Text,
  type Variant,
} from "@tailor-platform/e2g/playwright";
import { blocksToMarkdown } from "@tailor-platform/e2g/markdown";
import type { GuideOutput, Page } from "@tailor-platform/e2g/playwright/reporter";
import { assertType, type Equal } from "../equal.ts";

assertType<Equal<Locale, "en" | "ja">>();
assertType<Equal<Text, Record<"en" | "ja", string>>>();
assertType<Equal<Variant, "desktop" | "mobile">>();
assertType<Equal<Meta, { title: Text; sidebar?: { order: number } }>>();

const test = mergeTests(base, guideTest);

test(
  "two locales",
  guidePage("two", { title: { en: "Rename", ja: "名前を変える" }, sidebar: { order: 1 } }),
  async ({ guide, guideLocale, guideVariant }) => {
    assertType<Equal<typeof guideLocale, "en" | "ja" | undefined>>();
    assertType<Equal<typeof guideVariant, "desktop" | "mobile" | undefined>>();
    await guide.say({ en: "Hello.", ja: "こんにちは。" });
    // @ts-expect-error the ja text is missing
    await guide.say({ en: "Hello." });
    // @ts-expect-error a plain string is not in every locale
    await guide.step("Save.", async () => {});
    await guide.step({ en: "Save.", ja: "保存します。" }, async () => {
      // @ts-expect-error the alt has no ja text
      await guide.shot("01-save", { alt: { en: "Save" } });
    });
  },
);

// @ts-expect-error the meta needs a title
guidePage("two", { sidebar: { order: 1 } });
// @ts-expect-error the title needs every locale
guidePage("two", { title: { en: "Rename" } });

const output: GuideOutput = {
  path: (page) => `${page.locale}/${page.slug}.md`,
  render: (page) => {
    assertType<Equal<typeof page, Page<Meta>>>();
    for (const block of page.blocks)
      if (block.kind === "step")
        for (const image of block.shots.flatMap((s) => s.images))
          assertType<Equal<typeof image.variant, "desktop" | "mobile" | undefined>>();
    blocksToMarkdown(page.blocks, { media: { mobile: "(max-width: 640px)" } });
    // @ts-expect-error tablet is not a registered variant
    blocksToMarkdown(page.blocks, { media: { tablet: "(max-width: 1024px)" } });
    const title: string = page.meta.title[page.locale];
    const order: number | undefined = page.meta.sidebar?.order;
    return `${title} ${order}`;
  },
};
void output;

defineConfig<GuideOptions>({
  use: { guideLocale: "ja" },
  projects: [{ name: "en", use: { guideLocale: "en" } }],
});
// @ts-expect-error fr is not a registered locale
defineConfig<GuideOptions>({ use: { guideLocale: "fr" } });
// @ts-expect-error fr is not a registered locale
defineConfig<GuideOptions>({ projects: [{ use: { guideLocale: "fr" } }] });

defineConfig<GuideOptions>({
  projects: [{ name: "en-mobile", use: { guideLocale: "en", guideVariant: "mobile" } }],
});
// @ts-expect-error tablet is not a registered variant
defineConfig<GuideOptions>({ projects: [{ use: { guideLocale: "en", guideVariant: "tablet" } }] });
