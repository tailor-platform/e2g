import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test as plain } from "vitest";
import { renderTerminal } from "../src/terminal/index.js";
import type { Replacement } from "../src/terminal/replace.js";
import { guideProjects } from "../src/vitest/reporter/index.js";
import { reviveTerminal, serializeTerminal } from "../src/vitest/settings.js";
import { guidePage, test } from "../src/vitest/index.js";

async function text(output: string, replace?: Replacement[]) {
  return (await renderTerminal(output, { cols: 80, replace })).text.trim();
}

const homes: string[] = [];

test("runs in its own home and project", async ({ terminal }) => {
  const { output } = await terminal.run("pwd");
  expect(await text(output, terminal.options.replace)).toBe("~/project");
});

test.concurrent("two tests get different homes (a)", async ({ terminal }) => {
  homes.push(await text((await terminal.run("printf %s $HOME | rev")).output));
});
test.concurrent("two tests get different homes (b)", async ({ terminal }) => {
  homes.push(await text((await terminal.run("printf %s $HOME | rev")).output));
});
test("the homes differed", () => {
  expect(homes).toHaveLength(2);
  expect(homes[0]).not.toBe(homes[1]);
});

describe("leftover processes", () => {
  let pid = 0;
  let home = "";
  test("starts a never-ending process", async ({ terminal }) => {
    await terminal.spawn("echo $$ > pid; exec sleep 1000");
    home = terminal.options.home!;
    for (let i = 0; i < 100 && !pid; i++) {
      try {
        pid = Number(readFileSync(`${home}/project/pid`, "utf8"));
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    expect(pid).toBeGreaterThan(0);
  });
  test("the process is gone and its home removed", async () => {
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    expect(() => readFileSync(`${home}/project/pid`)).toThrow();
  });
});

describe("scoped settings", () => {
  test.override({ guideTerminal: { cols: 40 } });
  test("apply", async ({ terminal }) => {
    const { output } = await terminal.run(
      'node -e "process.stdout.write(String(process.stdout.columns))"',
    );
    expect(await text(output)).toBe("40");
  });
});

test("finds tools from the test file's directory", ({ terminal }) => {
  expect(terminal.options.binFrom).toBe(dirname(fileURLToPath(import.meta.url)));
});

plain("guide terminal settings cannot set what the fixture owns", () => {
  const message = /cannot set home, cwd: each test's terminal runs in its own temporary home/;
  // @ts-expect-error the fixture sets home and cwd
  expect(() => guideProjects(["en"], { terminal: { home: "/x", cwd: "/y" } })).toThrow(message);
  // @ts-expect-error the fixture sets binFrom
  expect(() => serializeTerminal({ binFrom: "/x" })).toThrow(/cannot set binFrom/);
  // a provided value is structured-cloned, so it reaches the worker as plain data
  const provided = JSON.parse('{"cols":40,"home":"/x","cwd":"/y"}');
  expect(() => reviveTerminal(provided)).toThrow(message);
});

plain("serialize round-trips RegExp", () => {
  const options = {
    cols: 50,
    replace: [
      [/a+/gi, "x"],
      ["lit", "y"],
    ] as Replacement[],
  };
  const wire = JSON.parse(JSON.stringify(serializeTerminal(options)));
  expect(wire.replace[0][0]).toEqual({ source: "a+", flags: "gi" });
  expect(reviveTerminal(wire)).toEqual(options);
  expect(reviveTerminal(options)).toEqual(options);
});

describe("in a guide run", () => {
  test.override({ guideLocale: "en" });
  test(
    "a command shows the home as ~ at the default width",
    guidePage("home", { title: "Home" }),
    async ({ terminal, guide, onTestFinished }) => {
      onTestFinished(({ task }) => {
        expect(task.meta.e2g?.record?.blocks[0]).toMatchObject({
          items: [{ kind: "command", command: "pwd", output: "~/project" }],
        });
      });
      await guide.step("Look around.", async () => {
        await guide.command(await terminal.run("pwd"));
      });
    },
  );

  test(
    "a command line gets the home alias and the replacements",
    guidePage("command-line", { title: "Command line" }),
    async ({ terminal, guide, onTestFinished }) => {
      onTestFinished(({ task }) => {
        expect(task.meta.e2g?.record?.blocks[0]).toMatchObject({
          items: [
            { kind: "command", command: "ls ~/project/build-XXXX", output: "~/project/build-XXXX" },
            { kind: "command", command: "echo masked", output: "masked" },
          ],
        });
      });
      await guide.step("Look around.", async () => {
        const command = `mkdir build-1234 && ls -d ${terminal.options.cwd}/build-1234`;
        const result = await terminal.run(command);
        await guide.command(
          { command: `ls ${terminal.options.cwd}/build-1234`, output: result.output },
          { replace: [[/build-\d+/g, "build-XXXX"]] },
        );
        await guide.command(
          { command: "echo secret", output: "secret\r\n" },
          { replace: [["secret", "masked"]] },
        );
      });
    },
  );

  test("a screen that never settles names itself in the error", async ({ terminal, guide }) => {
    const session = await terminal.spawn(
      `node -e "setInterval(() => process.stdout.write('.'), 20)"`,
    );
    await session.waitForText(".");
    const error = await guide
      .step("Watch it.", () =>
        guide.screen("dots", session, { alt: "Dots", idle: 200, timeout: 500 }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /^guide\.screen\("dots"\): screen did not settle within 500ms/,
    );
  });
});
