// vitest.guides.config.ts
import { defineConfig } from "vitest/config";
import { guideProjects, guidesReporter } from "@tailor-platform/e2g/vitest/reporter";
import { output } from "./cli-output";

export default defineConfig({
  test: {
    include: ["guides/**/*.test.ts"],
    projects: guideProjects(["en", "ja"], {
      terminal: { cols: 80, rows: 12, env: { NO_COLOR: "1" } },
    }),
    reporters: [
      "default",
      guidesReporter({
        output,
        shots: { dir: "docs/assets/guides" },
        manifest: "docs/.cli-guides.json",
        prune: true,
      }),
    ],
  },
});
