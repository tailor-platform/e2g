// tests/fixtures.ts
import { mergeTests, test as base } from "@playwright/test";
import { guideTest } from "@tailor-platform/e2g/playwright";

// your own fixtures, as before
const app = base.extend<{ project: string }>({
  project: ["demo", { option: true }],
});

export const test = mergeTests(app, guideTest);
export { expect } from "@playwright/test";
