// playwright.guides.config.ts
import { defineConfig } from "@playwright/test";
import type { GuideOptions } from "@tailor-platform/e2g/playwright";
import type { GuidesReporterOptions } from "@tailor-platform/e2g/playwright/reporter";
import { output } from "./guides-output";
import { setup, shared, signedIn } from "./playwright.shared";

const guides: GuidesReporterOptions = {
  output,
  shots: { dir: "docs/assets/guides" },
  manifest: "docs/.guides.json",
  prune: true,
};

export default defineConfig<GuideOptions>({
  ...shared,
  forbidOnly: true,
  reporter: [["list"], ["@tailor-platform/e2g/playwright/reporter", guides]],
  use: { ...shared.use, guideShots: true },
  projects: [
    // no grep here: the setup project runs its tests as usual
    setup,
    {
      name: "en",
      grep: /@guide/,
      dependencies: ["setup"],
      use: { ...signedIn, guideLocale: "en", locale: "en-US", timezoneId: "UTC" },
    },
    {
      name: "ja",
      grep: /@guide/,
      dependencies: ["setup"],
      use: { ...signedIn, guideLocale: "ja", locale: "ja-JP", timezoneId: "Asia/Tokyo" },
    },
  ],
});
