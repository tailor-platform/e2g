// snippets from the CLI guides section of the README, kept here so `pnpm typecheck` covers them
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, vi } from "vitest";
import { expect, guidePage, test } from "@tailor-platform/e2g/vitest";
import { renderTerminal } from "@tailor-platform/e2g/terminal";

const page = guidePage("recipes", { title: { en: "Recipes", ja: "レシピ" } });
const text = (en: string) => ({ en, ja: en });
const run = promisify(execFile);

declare function runCli(argv: string[]): Promise<string>;

test("a helper's result", page, async ({ guide }) => {
  await guide.step(text("Show the version."), async () => {
    const { stdout } = await run("mycli", ["--version"]);
    await guide.command({ command: "mycli --version", output: stdout });
  });
});

vi.mock("node:os", () => ({ hostname: () => "demo-host" }));

test("an in-process run", page, async ({ guide }) => {
  await guide.step(text("Check who you are."), async () => {
    await guide.command({ command: "mycli whoami", output: await runCli(["whoami"]) });
  });
});

test("replace", page, async ({ guide, terminal }) => {
  await guide.step(text("List the files."), async () => {
    const result = await terminal.run("mycli list");
    await guide.command(result, { replace: [[/\b[0-9a-f]{7}\b/g, "abc1234"]] });
  });
});

test("a clock", page, async ({ guide, terminal }) => {
  await guide.step(text("Build."), async () => {
    await guide.command(await terminal.run("mycli build"));
  });
});

test("raw output", page, async ({ terminal }) => {
  const result = await terminal.run("mycli status");
  expect(result.output).toContain("ready");
});

test("the locale", page, async ({ guide, terminal }) => {
  await guide.step(text("Create it in your language."), async () => {
    await guide.command(await terminal.run(`mycli init demo --lang ${guide.locale ?? "en"}`));
  });
});

describe("a wide table", () => {
  test.override({ guideTerminal: { cols: 120 } });
  test("is not wrapped", page, async ({ guide, terminal }) => {
    await guide.step(text("List everything."), async () => {
      await guide.command(await terminal.run("mycli list --all"));
    });
  });
});

export const rendered = await renderTerminal("\x1b[32mdone\x1b[0m\r\n", {
  cols: 60,
  replace: [["/Users/ada/project", "~/project"]],
});
// rendered.text is "done", and rendered.svg is the picture
