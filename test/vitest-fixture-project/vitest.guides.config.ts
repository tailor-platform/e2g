import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { guideProjects, guidesReporter } from "@tailor-platform/e2g/vitest/reporter";
import { output } from "./guide-output.ts";

export default defineConfig({
  test: {
    include: ["guides/**/*.test.ts"],
    projects: guideProjects(["en", "ja"], {
      terminal: { cols: 60, rows: 8, path: [fileURLToPath(new URL("bin", import.meta.url))] },
    }),
    reporters: [
      "default",
      guidesReporter({
        output,
        shots: { dir: "site/assets" },
        manifest: "site/docs/.e2g.json",
        prune: process.env.GUIDES_PRUNE === "1",
      }),
    ],
  },
});
