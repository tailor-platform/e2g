import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import type { GuideOptions } from "@tailor-platform/e2g/playwright";
import type { GuidesReporterOptions } from "@tailor-platform/e2g/playwright/reporter";
import { output } from "./tour-output.ts";

const guides: GuidesReporterOptions = {
  output,
  shots: { dir: "tours/assets" },
  manifest: "tours/.guides.json",
  prune: true,
};

// Playwright resolves a reporter's name from its own install, which does not see this repo's
// own package; in a project that installs @tailor-platform/e2g, the name alone is enough
const reporter = fileURLToPath(import.meta.resolve("@tailor-platform/e2g/playwright/reporter"));

export default defineConfig<GuideOptions>({
  testDir: "tests",
  forbidOnly: true,
  reporter: [["list"], [reporter, guides]],
  projects: [
    {
      name: "en",
      grep: /@guide/,
      use: {
        browserName: "chromium",
        guideLocale: "en",
        guideShots: true,
        // the tour draws its own highlight over the shot
        guideShot: { highlight: "outline:none" },
      },
    },
  ],
});
