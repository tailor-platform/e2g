import { guidePage, test } from "@tailor-platform/e2g/vitest";

const page = guidePage("show-help", { title: { en: "Show help", ja: "ヘルプを表示する" } });

test("show help", page, async ({ guide, terminal }) => {
  await guide.step({ en: "Show the commands.", ja: "コマンドの一覧を表示します。" }, async () => {
    await guide.command(await terminal.run("mycli --help"));
  });
});
