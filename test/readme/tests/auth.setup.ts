// tests/auth.setup.ts
import { test as setup } from "@playwright/test";
import { signedIn } from "../playwright.shared";

setup("sign in", async ({ page }) => {
  await page.goto("/sign-in?as=admin");
  await page.context().storageState({ path: signedIn.storageState });
});
