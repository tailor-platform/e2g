import { expect, guidePage, test } from "@tailor-platform/e2g/vitest";

const page = guidePage("new-project", {
  title: { en: "Start a project", ja: "プロジェクトを始める" },
});

test("start a project from a template", page, async ({ guide, terminal }) => {
  await guide.step(
    {
      en: "Run `demo new` and pick a template.",
      ja: "`demo new` を実行し、テンプレートを選びます。",
    },
    async () => {
      const session = await terminal.spawn("demo new");
      await session.waitForText("Choose a template");
      await session.press("ArrowDown");
      await guide.screen("choose-template", session, {
        alt: { en: "The template picker", ja: "テンプレートの選択画面" },
      });
      await session.press("Enter");
      await session.waitForText("Created with-auth project");
      expect(await session.waitForExit()).toBe(0);
    },
  );
});
