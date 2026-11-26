import { expect, guidePage, test } from "@tailor-platform/e2g/vitest";

const page = guidePage("greet", { title: { en: "Greet someone", ja: "あいさつする" } });

test("greet", page, async ({ guide, terminal }) => {
  await guide.step({ en: "Create the config.", ja: "設定ファイルを作成します。" }, async () => {
    const result = await terminal.run("demo init");
    expect(result.exitCode).toBe(0);
    await guide.command(result);
  });
  await guide.step({ en: "Greet someone.", ja: "あいさつします。" }, async () => {
    await guide.command(await terminal.run("demo greet Ada"));
  });
});
