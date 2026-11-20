// guides/create-a-project.test.ts
import { expect, guidePage, test } from "@tailor-platform/e2g/vitest";

const page = guidePage("create-a-project", {
  title: { en: "Create a project", ja: "プロジェクトを作成する" },
});

test("create a project", page, async ({ guide, terminal }) => {
  await guide.step({ en: "Create the project.", ja: "プロジェクトを作成します。" }, async () => {
    const result = await terminal.run("mycli init demo");
    expect(result.exitCode).toBe(0);
    await guide.command(result);
  });
  await guide.step({ en: "Pick a template.", ja: "テンプレートを選びます。" }, async () => {
    const session = await terminal.spawn("mycli new");
    await session.waitForText("Pick a template");
    session.press("ArrowDown");
    await guide.screen("picker", session, {
      alt: { en: "The template picker", ja: "テンプレートの選択画面" },
    });
    session.press("Enter");
    expect(await session.waitForExit()).toBe(0);
  });
});
