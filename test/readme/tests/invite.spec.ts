// tests/invite.spec.ts
import { expect, guidePage, test } from "@tailor-platform/e2g/playwright";

const meta = {
  title: { en: "Invite a teammate", ja: "メンバーを招待する" },
  description: {
    en: "Add people to your workspace.",
    ja: "ワークスペースにメンバーを追加します。",
  },
};

test("invite by email", guidePage("invite-a-teammate", meta), async ({ page, guide }) => {
  await page.goto("/settings/members");
  await guide.say({
    en: "Admins can invite people from **Settings → Members**.",
    ja: "管理者は **設定 → メンバー** からメンバーを招待できます。",
  });

  await guide.step({ en: "Click **Invite**.", ja: "**招待** をクリックします。" }, async () => {
    const invite = page.getByTestId("invite-button");
    await guide.shot("invite-button", {
      alt: { en: "The Invite button", ja: "招待ボタン" },
      highlight: invite,
      crop: page.getByTestId("members-header"),
    });
    await invite.click();
  });

  await guide.step(
    {
      en: "Enter their email address and click **Send**.",
      ja: "メールアドレスを入力し、**送信** をクリックします。",
    },
    async () => {
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill("sam@example.com");
      await guide.shot("invite-dialog", {
        alt: { en: "The invite dialog", ja: "招待のダイアログ" },
        crop: dialog,
      });
      await dialog.getByTestId("send-button").click();
    },
  );

  await guide.step(
    { en: "The invitation appears in the list.", ja: "招待した人が一覧に表示されます。" },
    async () => {
      await expect(page.getByTestId("member-row").last()).toContainText("sam@example.com");
    },
  );
});
