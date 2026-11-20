import { describe, vi } from "vitest";
import * as pty from "../src/terminal/pty.js";
import * as render from "../src/terminal/render.js";
import type { Session } from "../src/terminal/session.js";
import { META_KEY } from "../src/vitest/protocol.js";
import { expect, guidePage, test } from "../src/vitest/index.js";

vi.mock("../src/terminal/pty.js", { spy: true });
vi.mock("../src/terminal/render.js", { spy: true });

const page = guidePage("a-page", { title: "A page" });
const here = new URL(import.meta.url).pathname;

function fakeSession(text: string): Session {
  return {
    settle: vi.fn(async () => {}),
    capture: vi.fn(() => ({ text, svg: `<svg>${text}</svg>` })),
  } as unknown as Session;
}

describe("in a guide run", () => {
  test.override({ guideLocale: "en" });

  test("records steps, says and commands in order", page, async ({ guide, onTestFinished }) => {
    onTestFinished(({ task }) => {
      expect(task.meta[META_KEY]?.record).toEqual({
        blocks: [
          {
            kind: "say",
            text: "Install it.",
            location: { file: here, line: expect.any(Number), column: expect.any(Number) },
          },
          {
            kind: "step",
            text: "Check the version.",
            location: { file: here, line: expect.any(Number), column: expect.any(Number) },
            items: [{ kind: "command", command: "mycli --version", output: "mycli 1.0.0" }],
          },
        ],
        svgs: {},
      });
    });
    await guide.say("Install it.");
    await guide.step("Check the version.", async () => {
      await guide.command(
        { command: "mycli --version", output: "\x1b[32mmycli\x1b[0m 1.2.3\r\n" },
        {
          replace: [[/\d+\.\d+\.\d+/, "1.0.0"]],
        },
      );
    });
  });

  test("records screens with their svg", page, async ({ guide, onTestFinished }) => {
    onTestFinished(({ task }) => {
      const record = task.meta[META_KEY]?.record;
      expect(record?.blocks[0]).toMatchObject({
        kind: "step",
        items: [{ kind: "screen", name: "picker", alt: "The picker", text: "> one", image: null }],
      });
      expect(record?.svgs).toEqual({ picker: "<svg>> one</svg>" });
    });
    const session = fakeSession("> one");
    await guide.step("Pick one.", async () => {
      await guide.screen("picker", session, { alt: "The picker", replace: [["x", "y"]], idle: 50 });
    });
    expect(session.settle).toHaveBeenCalledWith({ idle: 50 });
    expect(session.capture).toHaveBeenCalledWith([["x", "y"]]);
  });

  test("keeps the svg of a screen named __proto__", page, async ({ guide, onTestFinished }) => {
    onTestFinished(({ task }) => {
      const svgs = task.meta[META_KEY]?.record?.svgs ?? {};
      expect(Object.entries(svgs)).toEqual([["__proto__", "<svg>> one</svg>"]]);
      expect(Object.entries(structuredClone(svgs))).toEqual([["__proto__", "<svg>> one</svg>"]]);
      expect(Object.entries(JSON.parse(JSON.stringify(svgs)))).toEqual([
        ["__proto__", "<svg>> one</svg>"],
      ]);
    });
    await guide.step("Pick one.", async () => {
      await guide.screen("__proto__", fakeSession("> one"), { alt: "The picker" });
    });
  });

  test("exposes the locale", async ({ guide }) => {
    expect(guide.locale).toBe("en");
  });

  test("rejects a repeated screen name", async ({ guide }) => {
    await guide.step("Pick one.", async () => {
      await guide.screen("picker", fakeSession(""), { alt: "a" });
      await expect(guide.screen("picker", fakeSession(""), { alt: "a" })).rejects.toThrow(
        'screen "picker" is already taken',
      );
    });
  });
});

describe("picks the locale's text", () => {
  test.override({ guideLocale: "ja" });

  test("uses the locale's text", page, async ({ guide, onTestFinished }) => {
    onTestFinished(({ task }) => {
      expect(task.meta[META_KEY]?.record?.blocks[0]).toMatchObject({ kind: "step", text: "B" });
    });
    await guide.step({ en: "A", ja: "B" }, async () => {});
  });

  test("fails without the locale's text", async ({ guide }) => {
    await expect(guide.step({ en: "A" }, async () => {})).rejects.toThrow(
      'guide.step() has no "ja" text',
    );
  });
});

test("rejects say inside a step", async ({ guide }) => {
  await guide.step("A step.", async () => {
    await expect(guide.say("Hi.")).rejects.toThrow(
      "guide.say() cannot be called inside guide.step()",
    );
  });
});

test("rejects nested steps", async ({ guide }) => {
  await guide.step("A step.", async () => {
    await expect(guide.step("Inner.", async () => {})).rejects.toThrow(
      "guide.step() cannot be called inside guide.step()",
    );
  });
});

test("rejects multi-line titles", async ({ guide }) => {
  await expect(guide.step({ en: "One", ja: "1\n2" }, async () => {})).rejects.toThrow(
    "guide.step() title must be a single line",
  );
});

test("command outside a step throws", async ({ guide }) => {
  await expect(guide.command({ command: "mycli", output: "" })).rejects.toThrow(
    "guide.command() must be called inside guide.step()",
  );
});

test("screen outside a step throws", async ({ guide }) => {
  await expect(guide.screen("picker", fakeSession(""), { alt: "a" })).rejects.toThrow(
    "guide.screen() must be called inside guide.step()",
  );
});

test("returns the step body's value", async ({ guide }) => {
  expect(await guide.step("A step.", async () => 42)).toBe(42);
});

test("normal run renders nothing", page, async ({ guide, onTestFinished }) => {
  vi.mocked(render.renderTerminal).mockClear();
  vi.mocked(pty.loadPty).mockClear();
  onTestFinished(({ task }) => {
    expect(task.meta[META_KEY]).toEqual({ slug: "a-page", meta: { title: "A page" } });
  });
  const session = fakeSession("");
  expect(guide.locale).toBeUndefined();
  await guide.step("A step.", async () => {
    await guide.command({ command: "mycli", output: "\x1b[31mx" });
    await guide.screen("picker", session, { alt: "a" });
  });
  expect(render.renderTerminal).not.toHaveBeenCalled();
  expect(pty.loadPty).not.toHaveBeenCalled();
  expect(session.settle).not.toHaveBeenCalled();
  expect(session.capture).not.toHaveBeenCalled();
});

test("guidePage keeps the caller's options", () => {
  expect(guidePage("p", { title: "T" }, { timeout: 5, meta: { other: 1 } as never })).toEqual({
    timeout: 5,
    meta: { other: 1, [META_KEY]: { slug: "p", meta: { title: "T" } } },
  });
});
