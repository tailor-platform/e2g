import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { guideProjects, guidesReporter } from "@tailor-platform/e2g/vitest/reporter";
import { output } from "./cli-output.ts";

export default defineConfig({
  // so the example runs from the repo root as well as from this folder
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["guides/**/*.test.ts"],
    // the CLI is found on PATH, as it would be once installed
    projects: guideProjects(["en", "ja"], {
      // a short screen keeps captures of small prompts compact
      terminal: { path: [fileURLToPath(new URL("bin", import.meta.url))], rows: 8 },
    }),
    reporters: [
      "default",
      guidesReporter({
        output,
        shots: { dir: "docs/assets" },
        manifest: "docs/.e2g.json",
        prune: true,
      }),
    ],
  },
});
