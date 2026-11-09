import { mergeTests, test as base } from "@playwright/test";
import { guideTest, type Locale } from "@tailor-platform/e2g/playwright";

export const test = mergeTests(base, guideTest);

const TEXTS = {
  en: { menu: "Menu", settings: "Settings", profile: "Profile", save: "Save" },
  ja: { menu: "メニュー", settings: "設定", profile: "プロフィール", save: "保存" },
};

export function sampleApp(locale: Locale = "en"): string {
  const t = TEXTS[locale];
  return `
    <body style="margin:0;font:16px sans-serif;background:#fff;color:#111">
      <header style="padding:16px;border-bottom:1px solid #ccc;display:flex;gap:12px">
        <button id="menu-button" onclick="document.getElementById('menu').hidden=false">${t.menu}</button>
      </header>
      <ul id="menu" role="menu" hidden style="margin:8px 16px;padding:8px;border:1px solid #888;width:160px;list-style:none">
        <li role="menuitem">${t.profile}</li>
        <li role="menuitem" onclick="document.getElementById('settings').hidden=false">${t.settings}</li>
      </ul>
      <section id="settings" hidden style="margin:16px;padding:16px;border:1px solid #888;width:240px">
        <h2 style="margin:0 0 8px">${t.settings}</h2>
        <button>${t.save}</button>
      </section>
    </body>`;
}
