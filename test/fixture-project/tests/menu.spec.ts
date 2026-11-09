import { guidePage } from "@tailor-platform/e2g/playwright";
import { sampleApp, test } from "./fixtures.ts";

test(
  "open the menu",
  guidePage("menu", { title: { en: "Open the menu", ja: "メニューを開く" } }),
  async ({ page, guide, guideLocale }) => {
    await page.setContent(sampleApp(guideLocale));
    await guide.say({
      en: "The menu lists every page.",
      ja: "メニューにはすべてのページが並びます。",
    });
    await guide.step({ en: "Click Menu.", ja: "メニューをクリックします。" }, async () => {
      await page.locator("#menu-button").click();
      await guide.shot("menu", {
        alt: { en: "The open menu", ja: "開いたメニュー" },
        crop: page.locator("#menu"),
      });
    });
  },
);
