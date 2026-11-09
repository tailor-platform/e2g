// playwright.config.ts
import { defineConfig } from "@playwright/test";
import { setup, shared, signedIn } from "./playwright.shared";

export default defineConfig({
  ...shared,
  projects: [setup, { name: "chromium", dependencies: ["setup"], use: signedIn }],
});
