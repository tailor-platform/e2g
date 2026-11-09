// the "after" side of the README's retrofit diff
import { guidePage } from "@tailor-platform/e2g/playwright";
import { expect, test } from "./fixtures";

const meta = {
  title: { en: "Archive a project", ja: "プロジェクトをアーカイブする" },
  description: { en: "Hide a project you no longer use.", ja: "使わないプロジェクトを隠します。" },
};
const details = guidePage("archive-project", meta, { tag: "@smoke" });

test("archive a project", details, async ({ page, project, guide }) => {
  await page.goto(`/projects/${project}/settings`);
  await guide.step({ en: "Open **Danger zone**.", ja: "**危険な操作** を開きます。" }, async () => {
    await page.getByTestId("danger-zone").click();
    await guide.shot("danger-zone", {
      alt: { en: "The danger zone", ja: "危険な操作" },
      highlight: page.getByTestId("archive-button"),
    });
  });
  await test.step("confirm", async () => {
    await page.getByTestId("archive-button").click();
    await page.getByRole("dialog").getByTestId("confirm").click();
  });
  await expect(page.getByTestId("archived-badge")).toBeVisible();
});
