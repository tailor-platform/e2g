import { defineConfig } from "@playwright/test";
import type { GuideOptions, Locale } from "@tailor-platform/e2g/playwright";
import { blocksToMarkdown } from "@tailor-platform/e2g/markdown";
import type { GuideOutput, GuidesReporterOptions } from "@tailor-platform/e2g/playwright/reporter";

const env = process.env;

const output: GuideOutput = {
  path: (page) => `site/docs/${page.locale}/${page.slug}.md`,
  render: (page, { image }) => {
    if (env.GUIDES_RENDER_THROWS === "1") throw new Error("render is broken");
    return `<!-- generated from ${page.source} -->\n\n# ${page.meta.title[page.locale]}\n\n${blocksToMarkdown(page.blocks, image)}`;
  },
};

const guides: GuidesReporterOptions = {
  output,
  shots: { dir: "site/assets", ...(env.GUIDES_SAME === "off" ? { same: false } : {}) },
  manifest: "site/docs/.guides.json",
  prune: env.GUIDES_PRUNE === "1",
};

const locales = (env.GUIDES_LOCALES ?? "en,ja").split(",") as Locale[];

// a config for writing guides: only the @guide tests, one project per locale
export default defineConfig<GuideOptions>({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  grep: env.GUIDES_GREP ? new RegExp(env.GUIDES_GREP) : /@guide/,
  forbidOnly: env.GUIDES_FORBID_ONLY !== "0",
  workers: 2,
  reporter: [
    ["list"],
    ["@tailor-platform/e2g/playwright/reporter", guides],
    ...(env.GUIDES_LOCATIONS ? [["./step-locations.ts"] as const] : []),
  ],
  projects: locales.map((locale, i) => ({
    name: locales.indexOf(locale) === i ? locale : `${locale}-${i}`,
    ...(env.GUIDES_SKIP === locale ? { testIgnore: "**/*" } : {}),
    use: {
      browserName: "chromium",
      ...(env.GUIDES_NO_LOCALE === "1" ? {} : { guideLocale: locale }),
      guideShots: env.GUIDES_SHOTS !== "0",
    },
  })),
});
