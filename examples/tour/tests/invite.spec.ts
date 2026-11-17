import type { Page } from "@playwright/test";
import { expect, guidePage, test, type Guide } from "@tailor-platform/e2g/playwright";

const APP = new URL("../app.html", import.meta.url).href;

// the steps every branch starts from; a branch repeats them without guide steps
async function openDialog(page: Page, guide?: Guide) {
  await page.goto(APP);
  const invite = page.getByTestId("invite-button");
  const dialog = page.getByRole("dialog");
  if (!guide) {
    await invite.click();
    await dialog.getByLabel("Email").fill("sam@example.com");
    return;
  }
  await guide.say("Admins can invite people from **Settings → Members**.");
  await guide.step("Click **Invite**.", async () => {
    await guide.shot("invite-button", { alt: "The Invite button", highlight: invite });
    await invite.click();
  });
  await guide.step("Enter their email address.", async () => {
    const email = dialog.getByLabel("Email");
    await guide.shot("email", {
      alt: "The email field",
      highlight: email,
      crop: dialog,
      padding: 24,
    });
    await email.fill("sam@example.com");
  });
  await guide.step("Choose the role to give them.", async () => {
    await guide.shot("role", {
      alt: "The role picker",
      highlight: dialog.getByLabel("Role"),
      crop: dialog,
      padding: 24,
    });
  });
}

async function sendAndCheck(page: Page, guide: Guide, role: string) {
  const dialog = page.getByRole("dialog");
  await guide.step("Click **Send**.", async () => {
    const send = dialog.getByTestId("send-button");
    await guide.shot("send", {
      alt: "The Send button",
      highlight: send,
      crop: dialog,
      padding: 24,
    });
    await send.click();
  });
  await guide.step("The invitation appears in the list.", async () => {
    const row = page.getByTestId("member-row").last();
    await expect(row).toContainText("sam@example.com");
    await expect(row).toContainText(role);
    await guide.shot("invited", {
      alt: "The member list",
      highlight: row,
      crop: page.locator("table"),
    });
  });
}

test(
  "invite: open the dialog",
  guidePage("invite", {
    title: "Invite a teammate",
    next: [
      {
        label: "As a **Member**",
        detail: "Works in the projects you pick.",
        slug: "invite-member",
      },
      { label: "As an **Admin**", detail: "Manages billing and members.", slug: "invite-admin" },
    ],
  }),
  async ({ page, guide }) => {
    await openDialog(page, guide);
  },
);

test(
  "invite as a member",
  guidePage("invite-member", {
    title: "Invite a member",
    parent: { slug: "invite", title: "Invite a teammate" },
  }),
  async ({ page, guide }) => {
    await openDialog(page);
    const dialog = page.getByRole("dialog");
    await guide.step("Pick the projects they can work in.", async () => {
      const projects = dialog.getByLabel("Projects");
      await guide.shot("projects", {
        alt: "The project picker",
        highlight: projects,
        crop: dialog,
        padding: 24,
      });
      await projects.selectOption("Website");
    });
    await sendAndCheck(page, guide, "Member");
  },
);

test(
  "invite as an admin",
  guidePage("invite-admin", {
    title: "Invite an admin",
    parent: { slug: "invite", title: "Invite a teammate" },
  }),
  async ({ page, guide }) => {
    await openDialog(page);
    const dialog = page.getByRole("dialog");
    await guide.step("Choose **Admin**.", async () => {
      await dialog.getByLabel("Role").selectOption("Admin");
      const note = dialog.locator("#admin-note");
      await expect(note).toBeVisible();
      await guide.shot("admin", {
        alt: "The role picker set to Admin",
        highlight: [dialog.getByLabel("Role"), note],
        crop: dialog,
        padding: 24,
      });
    });
    await sendAndCheck(page, guide, "Admin");
  },
);
