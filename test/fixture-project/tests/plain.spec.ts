import { test } from "@playwright/test";

// not a guide: the guide config's grep leaves it out, and the reporter ignores it when it runs
test("a plain e2e test", async ({ page }) => {
  await page.setContent("<p>Hello</p>");
});
