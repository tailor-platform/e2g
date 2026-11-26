import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // the fixture project's guides run in a Vitest of their own
    exclude: ["test/vitest-fixture-project/**", "test/readme/cli/**"],
    globalSetup: ["test/build.global.ts"],
    passWithNoTests: true,
    // each reporter test launches Playwright with its own browsers
    maxConcurrency: 3,
  },
});
