import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/build.global.ts"],
    passWithNoTests: true,
    // each reporter test launches Playwright with its own browsers
    maxConcurrency: 3,
  },
});
