import { defineConfig } from "@playwright/test";
import type { GuideOptions } from "./src/playwright/index.ts";

export default defineConfig<GuideOptions>({
  testDir: "test",
  testMatch: "**/*.spec.ts",
  testIgnore: ["fixture-project/**", "readme/**"],
  outputDir: "test-results",
  timeout: 60_000,
  reporter: [["list"], ["./test/steps-reporter.ts"]],
  projects: [
    // a normal e2e run: no guideLocale, so the guide functions attach nothing
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "en",
      testMatch: "guides.spec.ts",
      use: {
        browserName: "chromium",
        guideLocale: "en",
        guideShots: true,
        guideShot: { padding: 20 },
      },
    },
    {
      name: "ja",
      testMatch: "guides.spec.ts",
      use: { browserName: "chromium", guideLocale: "ja" },
    },
  ],
});
