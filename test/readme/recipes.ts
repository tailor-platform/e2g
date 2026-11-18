// snippets from the README that are not whole files, kept here so `pnpm typecheck` covers them
import { defineConfig, devices, type Page } from "@playwright/test";
import {
  expect,
  guidePage,
  test,
  type Guide,
  type GuideOptions,
  type Locale,
} from "@tailor-platform/e2g/playwright";
import { blocksToMarkdown } from "@tailor-platform/e2g/markdown";
import type { GuideOutput, GuidesReporterOptions } from "@tailor-platform/e2g/playwright/reporter";
import { output } from "./guides-output";

const config = defineConfig<GuideOptions>({
  projects: [
    {
      name: "en",
      use: {
        guideLocale: "en",
        guideShots: true,
        guideShot: {
          style: ".cm-cursor { display: none; }",
        },
      },
    },
  ],
});

const guides: GuidesReporterOptions = {
  output,
  shots: {
    dir: "docs/assets/guides",
    path: (page, name) => `docs/assets/guides/${page.slug}/${page.locale}-${name}.png`,
    same: false,
  },
  manifest: "docs/.guides.json",
  prune: true,
};

// stands in for the app's own translations
const MESSAGES = {
  en: { "plans.save": "Save" },
  ja: { "plans.save": "保存" },
};
const i18n = (locale: Locale) => (key: keyof (typeof MESSAGES)["en"]) => MESSAGES[locale][key];

export async function openBilling(page: Page, guide: Guide) {
  await guide.step({ en: "Open **Billing**.", ja: "**請求** を開きます。" }, async () => {
    await page.getByTestId("nav-billing").click();
    await guide.shot("billing", { alt: { en: "Billing", ja: "請求" } });
  });
}

test.use({ guideClock: new Date("2026-01-15T09:00:00Z") });

const meta = {
  title: { en: "Choose a plan", ja: "プランを選ぶ" },
  description: { en: "Pick the plan that fits.", ja: "合うプランを選びます。" },
};

test("choose a plan", guidePage("choose-a-plan", meta), async ({ page, guide, guideLocale }) => {
  await page.goto("/");
  await openBilling(page, guide);

  await guide.say({
    en: `
      Plans are billed monthly.
      You can change plans at any time.
    `,
    ja: `
      料金は月ごとに請求されます。
      プランはいつでも変えられます。
    `,
  });

  await guide.step({ en: "Pick a plan.", ja: "プランを選びます。" }, async () => {
    await guide.shot("plans", {
      alt: { en: "The plan picker", ja: "プランの選択" },
      highlight: [page.getByTestId("plan-pro"), page.getByTestId("plan-team")],
      crop: page.getByTestId("plans"),
      mask: [page.getByTestId("card-number")],
      hide: [page.getByRole("listitem").filter({ hasText: /^test-/ })],
      style: ".promo-banner { display: none; }",
      highlightStyle: "outline: 3px dashed #0a84ff; outline-offset: 2px",
      padding: 24,
    });
  });

  const t = i18n(guideLocale ?? "en");
  await guide.step({ en: "Click **Save**.", ja: "**保存** をクリックします。" }, async () => {
    await page.getByRole("button", { name: t("plans.save") }).click();
  });

  await guide.step({ en: "Click **Continue**.", ja: "**続ける** をクリックします。" }, async () => {
    await guide.shot("continue", {
      alt: { en: "The Continue button", ja: "続けるボタン" },
      highlight: page.getByTestId("continue"),
    });
    await page.getByTestId("continue").click();
    await guide.shot("confirm", {
      alt: { en: "The confirmation", ja: "確認の画面" },
      crop: page.getByRole("dialog"),
    });
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  await guide.step(
    { en: "Open the receipt.", ja: "領収書を開きます。" },
    async () => {
      const popup = page.waitForEvent("popup");
      await page.getByTestId("receipt").click();
      await guide.shot("receipt", {
        alt: { en: "The receipt", ja: "領収書" },
        page: await popup,
      });
    },
    { timeout: 30_000 },
  );
});

export { config, guides, responsive, responsiveOutput, tour };

declare module "@tailor-platform/e2g" {
  interface Register {
    variants: "desktop" | "mobile";
  }
}

const viewports = { desktop: devices["Desktop Chrome"], mobile: devices["Pixel 7"] };

const responsive = defineConfig<GuideOptions>({
  projects: (["en", "ja"] as const).flatMap((guideLocale) =>
    (["desktop", "mobile"] as const).map((guideVariant) => ({
      name: `${guideLocale}-${guideVariant}`,
      grep: /@guide/,
      use: { ...viewports[guideVariant], guideLocale, guideVariant, guideShots: true },
    })),
  ),
});

const responsiveOutput: GuideOutput = {
  path: (page) => `docs/${page.locale}/guides/${page.slug}.md`,
  render: (page) => blocksToMarkdown(page.blocks, { media: { mobile: "(max-width: 640px)" } }),
};

test("open settings", guidePage("open-settings", meta), async ({ page, guide, guideVariant }) => {
  await page.goto("/");
  await guide.step({ en: "Open **Settings**.", ja: "**設定** を開きます。" }, async () => {
    // the menu is folded on small screens; this step is not in the page
    if (guideVariant === "mobile")
      await test.step("open the menu", () => page.getByTestId("menu-button").click());
    await page.getByTestId("settings-link").click();
    await guide.shot("settings", { alt: { en: "Settings", ja: "設定" } });
  });
});

const tour: GuideOutput = {
  path: (page) => `site/tours/${page.locale}/${page.slug}.json`,
  render: (page) => {
    const steps = page.blocks.flatMap((block) =>
      block.kind === "step" ? [{ text: block.text, shots: block.shots }] : [],
    );
    return `${JSON.stringify({ title: page.meta.title[page.locale], steps }, null, 2)}\n`;
  },
};
