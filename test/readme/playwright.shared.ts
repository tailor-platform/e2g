// playwright.shared.ts
import { devices, type PlaywrightTestConfig } from "@playwright/test";

// settings both configs use, so guides run against the same app as your e2e tests
export const shared = {
  testDir: "tests",
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3000" },
} satisfies PlaywrightTestConfig;

export const setup = { name: "setup", testMatch: /.*\.setup\.ts/ };

export const signedIn = { storageState: "playwright/.auth/admin.json" };
