import { defineConfig } from "@playwright/test";
import type { GuideOptions, Locale, Variant } from "@tailor-platform/e2g/playwright";
import { blocksToMarkdown } from "@tailor-platform/e2g/markdown";
import type { GuideOutput, GuidesReporterOptions } from "@tailor-platform/e2g/playwright/reporter";

const env = process.env;

const output: GuideOutput = {
  path: (page) => `site/docs/${page.locale}/${page.slug}.md`,
  render: (page) => {
    if (env.GUIDES_RENDER_THROWS === "1") throw new Error("render is broken");
    const body = blocksToMarkdown(page.blocks, { media: { mobile: "(max-width: 640px)" } });
    return `<!-- generated from ${page.source} -->\n\n# ${page.meta.title[page.locale]}\n\n${body}`;
  },
};

const guides: GuidesReporterOptions = {
  output,
  shots: { dir: "site/assets", ...(env.GUIDES_SAME === "off" ? { same: false } : {}) },
  manifest: "site/docs/.guides.json",
  prune: env.GUIDES_PRUNE === "1",
};

const locales = (env.GUIDES_LOCALES ?? "en,ja").split(",") as Locale[];
const variants = env.GUIDES_VARIANTS?.split(",") as Variant[] | undefined;
const devices: Record<string, object> = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true },
};
const listed = (name: string, list = "") => list.split(",").includes(name);

function project(locale: Locale, i: number, variant?: Variant, j = 0) {
  const base = locales.indexOf(locale) === i ? locale : `${locale}-${i}`;
  const suffix = variants?.indexOf(variant!) === j ? variant : `${variant}-${j}`;
  const name = variant === undefined ? base : `${base}-${suffix}`;
  return {
    name,
    ...(listed(name, env.GUIDES_SKIP) ? { testIgnore: "**/*" } : {}),
    use: {
      browserName: "chromium" as const,
      ...(variant === undefined ? {} : devices[variant]),
      ...(env.GUIDES_NO_LOCALE === "1" ? {} : { guideLocale: locale }),
      ...(variant === undefined || listed(name, env.GUIDES_NO_VARIANT)
        ? {}
        : { guideVariant: variant }),
      guideShots: env.GUIDES_SHOTS !== "0",
    },
  };
}

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
  projects: locales
    .flatMap((locale, i) =>
      variants
        ? variants.map((variant, j) => project(locale, i, variant, j))
        : [project(locale, i)],
    )
    .filter((p) => !listed(p.name, env.GUIDES_DROP)),
});
