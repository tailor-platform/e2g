import { expect, guidePage, test } from "@tailor-platform/e2g/vitest";

const page = guidePage("create-a-project", {
  title: { en: "Create a project", ja: "プロジェクトを作成する" },
});

test("create a project", page, async ({ guide, terminal }) => {
  await guide.say({ en: "Create a project with mycli.", ja: "mycli でプロジェクトを作成します。" });
  await guide.step({ en: "Check the version.", ja: "バージョンを確認します。" }, async () => {
    await guide.command(await terminal.run("mycli --version"));
  });
  await guide.step({ en: "Pick a template.", ja: "テンプレートを選びます。" }, async () => {
    const session = await terminal.spawn("mycli init");
    await session.waitForText("Pick a template");
    session.press("ArrowDown");
    await session.waitForText("> full");
    await guide.screen("picker", session, {
      alt: { en: "The template picker", ja: "テンプレートの選択画面" },
    });
    session.press("Enter");
    expect(await session.waitForExit()).toBe(0);
  });
  if (process.env.GUIDES_FAIL === "1") throw new Error("the guide fails");
});
