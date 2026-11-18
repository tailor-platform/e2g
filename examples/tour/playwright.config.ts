import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
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
  use: {
    guideLocale: "en",
    guideShots: true,
    // the tour draws its own highlight over the shot
    guideShot: { highlight: "outline:none" },
  },
  // one project per screen size; the tour shows the shots of the one that fits the reader's screen
  projects: [
    {
      name: "en-desktop",
      grep: /@guide/,
      use: { ...devices["Desktop Chrome"], guideVariant: "desktop" },
    },
    {
      name: "en-mobile",
      grep: /@guide/,
      use: { ...devices["Pixel 7"], guideVariant: "mobile" },
    },
  ],
});
