import { guidePage } from "@tailor-platform/e2g/playwright";
import { sampleApp, test } from "./fixtures.ts";

test(
  "open settings",
  guidePage("settings", { title: { en: "Change settings", ja: "設定を変える" } }),
  async ({ page, guide, guideLocale }) => {
    await page.setContent(sampleApp(guideLocale));
    await guide.step({ en: "Open the menu.", ja: "メニューを開きます。" }, async () => {
      await page.locator("#menu-button").click();
    });
    await guide.step({ en: "Choose Settings.", ja: "設定を選びます。" }, async () => {
      await page.getByRole("menuitem").nth(1).click();
      await guide.shot("settings", {
        alt: { en: "The settings panel", ja: "設定の画面" },
        crop: page.locator("#settings"),
      });
    });
  },
);
