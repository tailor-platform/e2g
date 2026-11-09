import { globSync } from "node:fs";
import { dirname } from "node:path";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";
import { expect, guidePage, test, type Guide, type GuideOptions } from "../src/playwright/index.ts";
import { captureShot, type ShotOptions } from "../src/playwright/shot.ts";
import { ANNOTATION, PNG_PREFIX, SAY, SHOT, STEP, TAG } from "../src/playwright/protocol.ts";
import { callerLine, expectLocations, expectSteps, type StepNode } from "./steps.ts";

const SAMPLE_PAGE = `
  <body style="margin:0;font:16px sans-serif;background:#fff;color:#111">
    <header style="padding:16px;border-bottom:1px solid #ccc"><h1 style="margin:0">Dashboard</h1></header>
    <main style="padding:24px;display:flex;gap:16px">
      <button style="padding:8px 16px;border:2px solid #222;border-radius:12px;background:#fff">Save changes</button>
      <button style="padding:8px 16px;border:2px solid #06c;border-radius:24px;background:#06c;color:#fff">Publish</button>
      <div id="card" style="width:200px;height:80px;background:#fff;border:1px solid #888">Card</div>
      <div id="note" style="width:200px;height:80px;background:#fff;border:1px solid #888">Note</div>
    </main>
  </body>`;

// renders the page's clock as it loads
const CLOCK_PAGE = "data:text/html,<script>document.write('<p id=now>'+Date.now()+'</p>')</script>";

const use = () => test.info().project.use as Partial<GuideOptions>;
// "plain" is the chromium project: a normal e2e run without guideLocale
const mode = () =>
  use().guideLocale === undefined ? "plain" : use().guideShots ? "shots" : "info";
// the text a record shows in the running project: its guideLocale, else its first locale
const shown = (texts: Record<string, string>) =>
  texts[use().guideLocale ?? Object.keys(texts)[0]!]!;

const SAVE = { en: "Click **Save changes**", ja: "**Save changes** をクリックします" };
const SAVE_ALT = { en: "The save button", ja: "保存ボタン" };
const OPEN = { en: "Open the dashboard.", ja: "ダッシュボードを開きます。" };
const RED = [0xe5, 0x48, 0x4d];

const stepMark = { name: STEP, contentType: "text/plain", body: "" };
const shotInfo = (name: string, alt: string) => ({
  name: SHOT,
  contentType: "application/json",
  body: JSON.stringify({ name, alt }),
});
const png = (name: string) => ({
  name: PNG_PREFIX + name,
  contentType: "image/png",
  body: "<png>",
});
const marked = () => (mode() === "plain" ? [] : [stepMark]);

// what one shot attaches to its step in the running project
function shotAttachments(name: string, alt: string) {
  if (mode() === "plain") return [];
  return mode() === "shots" ? [shotInfo(name, alt), png(name)] : [shotInfo(name, alt)];
}

function attachedPng(name: string): Buffer {
  const found = test.info().attachments.filter((a) => a.name === PNG_PREFIX + name);
  expect(found).toHaveLength(1);
  return found[0]!.body!;
}

function pixel(png: Buffer, x: number, y: number) {
  const img = PNG.sync.read(png);
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

// caught right away, so no rejection goes unhandled
const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: Error) => e.message,
  );

test.describe("outside its running test", () => {
  test.describe.configure({ mode: "serial" });
  let saved: Guide | undefined;

  test("keeps its guide", async ({ guide }) => {
    saved = guide;
  });

  test("a guide used after its test fails", async () => {
    const guide = saved!;
    expect(await rejected(guide.step("Go.", async () => {}))).toBe(
      "guide.step() must be called while its test runs",
    );
    expect(await rejected(guide.say("Hello."))).toBe(
      "guide.say() must be called while its test runs",
    );
    expect(await rejected(guide.shot("01-x", { alt: "x" }))).toBe(
      "guide.shot() must be called while its test runs",
    );
  });
});

test.describe("texts", () => {
  test("a record shows the guideLocale's text, else its first one", async ({ guide }) => {
    await guide.step({ en: "Hi.", ja: "やあ。" }, async () => {});
    await guide.step({ ja: "やあ。", en: "Hi." }, async () => {});
    await guide.say({ en: "Hello.", ja: "こんにちは。" });
    const say = (body: string) =>
      mode() === "plain" ? [] : [{ name: SAY, contentType: "text/markdown", body }];
    const hello = shown({ en: "Hello.", ja: "こんにちは。" });
    expectSteps([
      { title: shown({ en: "Hi.", ja: "やあ。" }), attachments: marked(), steps: [] },
      { title: shown({ ja: "やあ。", en: "Hi." }), attachments: marked(), steps: [] },
      { title: hello, attachments: say(hello), steps: [] },
    ]);
  });

  test("a string is shown as it is", async ({ guide }) => {
    await guide.step("Plain.", async () => {});
    expectSteps([{ title: "Plain.", attachments: marked(), steps: [] }]);
  });

  test("a record without the guideLocale's text fails", async ({ guide }) => {
    const locale = use().guideLocale;
    test.skip(locale === undefined, "a normal e2e run shows the first text");
    const other = { [locale === "en" ? "ja" : "en"]: "Other." };
    await expect(guide.step(other, async () => {})).rejects.toThrow(
      `guide.step() has no "${locale}" text`,
    );
    await expect(guide.say(other)).rejects.toThrow(`guide.say() has no "${locale}" text`);
    await guide.step("Go.", async () => {
      await expect(guide.shot("01-x", { alt: other })).rejects.toThrow(
        `guide.shot() alt has no "${locale}" text`,
      );
    });
  });

  test("an empty record fails in every run", async ({ guide }) => {
    await expect(guide.step({}, async () => {})).rejects.toThrow("guide.step() has no");
  });
});

// Playwright adds where each annotation was declared
const annotations = () =>
  test.info().annotations.map(({ type, description }) => ({ type, description }));

test.describe("guidePage", () => {
  const META = { title: { en: "Sample guide", ja: "サンプルガイド" }, order: 3 };
  const annotation = {
    type: ANNOTATION,
    description: JSON.stringify({ slug: "sample", meta: META }),
  };

  test(
    "guidePage() tags the test and annotates its slug and meta",
    guidePage("sample", META),
    () => {
      expect(test.info().tags).toEqual([TAG]);
      expect(annotations()).toEqual([annotation]);
    },
  );

  test(
    "guidePage() keeps a tag string and an annotation object",
    guidePage("sample", META, { tag: "@smoke", annotation: { type: "issue", description: "#1" } }),
    () => {
      expect(test.info().tags).toEqual(["@smoke", TAG]);
      expect(annotations()).toEqual([{ type: "issue", description: "#1" }, annotation]);
    },
  );

  test(
    "guidePage() keeps a tag array and an annotation array",
    guidePage("sample", META, {
      tag: ["@smoke", "@slow"],
      annotation: [{ type: "issue", description: "#1" }, { type: "slow" }],
    }),
    () => {
      expect(test.info().tags).toEqual(["@smoke", "@slow", TAG]);
      expect(annotations()).toEqual([
        { type: "issue", description: "#1" },
        { type: "slow" },
        annotation,
      ]);
    },
  );

  test("guidePage() adds @guide once and leaves the given details alone", () => {
    const details = { tag: ["@guide", "@smoke"] };
    expect(guidePage("s", null, details)).toEqual({
      tag: ["@guide", "@smoke"],
      annotation: [{ type: ANNOTATION, description: JSON.stringify({ slug: "s", meta: null }) }],
    });
    expect(details).toEqual({ tag: ["@guide", "@smoke"] });
  });
});

test.describe("guide.step, guide.shot and guide.say", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(SAMPLE_PAGE);
  });

  test("steps carry their marker, shot info and pngs only in a guide project", async ({
    page,
    guide,
  }) => {
    await guide.say(OPEN);
    await guide.step(SAVE, async () => {
      await guide.shot("01-save", {
        alt: SAVE_ALT,
        highlight: page.getByRole("button", { name: "Save changes" }),
      });
      await guide.shot("02-publish", { alt: "Publish" });
    });
    await guide.step("Wait.", async () => {});
    const text = shown(OPEN);
    expectSteps([
      {
        title: text,
        attachments:
          mode() === "plain" ? [] : [{ name: SAY, contentType: "text/markdown", body: text }],
        steps: [],
      },
      {
        title: shown(SAVE),
        attachments: [
          ...marked(),
          ...shotAttachments("01-save", shown(SAVE_ALT)),
          ...shotAttachments("02-publish", "Publish"),
        ],
        steps: [],
      },
      { title: "Wait.", attachments: marked(), steps: [] },
    ]);
    if (mode() === "plain") expect(test.info().attachments).toEqual([]);
  });

  test("guide.step returns what its body returns", async ({ guide }) => {
    expect(await guide.step("Count.", async () => 42)).toBe(42);
  });

  test("guide.step and guide.shot work from helpers and plain steps", async ({ guide }) => {
    const capture = () => test.step("Inner", () => guide.shot("01-helper", { alt: "Helper" }));
    await test.step("Prepare", async () => {
      await guide.step("From a helper.", capture);
    });
    expectSteps([
      {
        title: "Prepare",
        attachments: [],
        steps: [
          {
            title: "From a helper.",
            attachments: [...marked(), ...shotAttachments("01-helper", "Helper")],
            steps: [{ title: "Inner", attachments: [], steps: [] }],
          },
        ],
      },
    ]);
  });

  test("guide.shot outside a guide step fails", async ({ guide }) => {
    await expect(guide.shot("01-save", { alt: "x" })).rejects.toThrow(
      "guide.shot() must be called inside guide.step()",
    );
    await test.step("Plain", async () => {
      await expect(guide.shot("01-save", { alt: "x" })).rejects.toThrow(
        "guide.shot() must be called inside guide.step()",
      );
    });
  });

  test("a guide step inside a guide step fails, and the next one works", async ({ guide }) => {
    await expect(guide.step("Outer.", () => guide.step("Inner.", async () => {}))).rejects.toThrow(
      "guide.step() cannot be called inside guide.step()",
    );
    expect(await guide.step("Next.", async () => "ok")).toBe("ok");
  });

  test("sibling guide steps may run at the same time", async ({ guide }) => {
    const [a, b] = await Promise.all([
      guide.step("Left.", async () => {
        await guide.shot("01-left", { alt: "Left" });
        return "a";
      }),
      guide.step("Right.", async () => {
        await guide.shot("02-right", { alt: "Right" });
        return "b";
      }),
    ]);
    expect([a, b]).toEqual(["a", "b"]);
    expectSteps([
      {
        title: "Left.",
        attachments: [...marked(), ...shotAttachments("01-left", "Left")],
        steps: [],
      },
      {
        title: "Right.",
        attachments: [...marked(), ...shotAttachments("02-right", "Right")],
        steps: [],
      },
    ]);
  });

  test("a guide step called from a helper inside a guide step fails", async ({ guide }) => {
    const helper = () => test.step("Helper", () => guide.step("Inner.", async () => {}));
    await expect(guide.step("Outer.", () => helper())).rejects.toThrow(
      "guide.step() cannot be called inside guide.step()",
    );
  });

  test("a guide step whose body threw leaves no state behind", async ({ guide }) => {
    await expect(
      guide.step("Fails.", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await guide.step("Next.", async () => {
      await guide.shot("01-next", { alt: "x" });
      await guide.step("Inner.", async () => {}).catch(() => {});
    });
    expect(await guide.step("Last.", async () => "ok")).toBe("ok");
  });

  test("a shot that runs after its guide step finished fails", async ({ guide }) => {
    let late: Promise<string | undefined> | undefined;
    await guide.step("Done.", async () => {
      late = rejected(
        new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
          guide.shot("01-late", { alt: "x" }),
        ),
      );
    });
    expect(await late).toBe("guide.shot() was called after its guide.step() finished");
    // the finished step no longer counts as open
    expect(await guide.step("After.", async () => "ok")).toBe("ok");
  });

  test("a guide step title must be a single line in every locale", async ({ guide }) => {
    for (const title of [
      "Two\nlines.",
      "Two\r\nlines.",
      "Ends with a newline.\n",
      { en: "One line.", ja: "二行の\n手順" },
    ])
      await expect(guide.step(title, async () => {})).rejects.toThrow(
        "guide.step() title must be a single line",
      );
  });

  test("say inside a guide step fails, and the next say works", async ({ guide }) => {
    await expect(guide.step("Outer.", () => guide.say("Inside."))).rejects.toThrow(
      "guide.say() cannot be called inside guide.step()",
    );
    await guide.say("After.");
  });

  test("say without text fails", async ({ guide }) => {
    for (const text of ["", "   ", "\n  \n", { en: "Text.", ja: "  " }])
      await expect(guide.say(text)).rejects.toThrow("guide.say() needs some text");
  });

  test("a shot name is used once per test", async ({ guide }) => {
    await guide.step("One.", () => guide.shot("01-save", { alt: "x" }));
    await expect(guide.step("Two.", () => guide.shot("01-save", { alt: "x" }))).rejects.toThrow(
      'shot "01-save" is already taken',
    );
  });

  test("the same shot name may be used again in another test", async ({ guide }) => {
    await guide.step("One.", () => guide.shot("01-save", { alt: "x" }));
  });

  test("a shot name may contain only letters, digits, dots, underscores and hyphens", async ({
    guide,
  }) => {
    for (const name of ["a/b", "a\\b", "../x", "a..b", "", "a b"])
      await expect(guide.step("Go.", () => guide.shot(name, { alt: "x" }))).rejects.toThrow(
        `shot name "${name}" may contain only letters, digits, ".", "_" and "-"`,
      );
    await guide.step("Go.", () => guide.shot("01-a.b_C", { alt: "x" }));
  });

  test("say removes the indentation and is titled by its first line", async ({ guide }) => {
    await guide.say(`
      First line of the paragraph,
        indented more.
      Last.
    `);
    const body = "First line of the paragraph,\n  indented more.\nLast.";
    expectSteps([
      {
        title: "First line of the paragraph,",
        attachments: mode() === "plain" ? [] : [{ name: SAY, contentType: "text/markdown", body }],
        steps: [],
      },
    ] satisfies StepNode[]);
  });

  test("a shot of a hidden element fails in a guide project", async ({ page, guide }) => {
    test.skip(mode() === "plain", "a normal e2e run does no browser work in shot");
    test.setTimeout(10_000);
    await expect(
      guide.step("Go.", () =>
        guide.shot("01-hidden", { alt: "x", highlight: page.locator("#missing") }),
      ),
    ).rejects.toThrow();
  });

  test("shot does no browser work in a normal e2e run", async ({ page, guide }) => {
    test.skip(mode() !== "plain", "only a normal e2e run skips the browser");
    await page.close();
    await guide.step("Go.", () =>
      guide.shot("01-gone", {
        alt: "x",
        highlight: page.locator("#missing"),
        crop: page.locator("#missing"),
      }),
    );
  });

  test("guideShots pngs are the highlighted screen, kept in memory only", async ({
    page,
    guide,
  }) => {
    test.skip(mode() !== "shots", "only the project with guideShots takes pngs");
    const button = page.getByRole("button", { name: "Save changes" });
    const box = (await button.boundingBox())!;
    await guide.step("Save.", async () => {
      await guide.shot("01-full", { alt: "x", highlight: button });
      await guide.shot("02-crop", { alt: "x", crop: button });
    });
    expect(pixel(attachedPng("01-full"), box.x - 4.5, box.y + box.height / 2)).toEqual(RED);
    await expect(button).not.toHaveAttribute("data-guides-highlight");
    // the en project sets guideShot.padding to 20
    expect(
      Math.abs(attachedPng("02-crop").readUInt32BE(16) - (box.width + 40)),
    ).toBeLessThanOrEqual(1);
    expect(test.info().attachments.every((a) => a.path === undefined)).toBe(true);
    expect(globSync("**/*.png", { cwd: dirname(test.info().file) })).toEqual([]);
    expect(globSync("**/*.png", { cwd: test.info().outputDir })).toEqual([]);
  });

  test("opts.page shoots another page", async ({ context, guide }) => {
    test.skip(mode() !== "shots", "only the project with guideShots takes pngs");
    const other = await context.newPage();
    await other.setContent('<body style="margin:0;background:rgb(0,0,200)"></body>');
    await guide.step("Look elsewhere.", () => guide.shot("01-other", { alt: "x", page: other }));
    expect(pixel(attachedPng("01-other"), 100, 100)).toEqual([0, 0, 200]);
  });
});

test.describe("step locations", () => {
  test("guide.step and guide.say are located where they are called", async ({ guide }) => {
    const file = test.info().file;
    const sayLine = callerLine() + 1;
    await guide.say("Here.");
    const stepLine = callerLine() + 1;
    await guide.step("There.", async () => {});
    const helper = () => guide.step("In a helper.", async () => {});
    const helperLine = callerLine() - 1;
    await helper();
    expectLocations([
      { title: "Here.", file, line: sayLine },
      { title: "There.", file, line: stepLine },
      { title: "In a helper.", file, line: helperLine },
    ]);
  });

  test("a location given to guide.step wins", async ({ guide }) => {
    const location = { file: "/elsewhere/guide.spec.ts", line: 7, column: 3 };
    await guide.step("Mine.", async () => {}, { location });
    expectLocations([{ title: "Mine.", file: location.file, line: 7 }]);
  });
});

test.describe("guideClock", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CLOCK_PAGE);
  });

  const rendered = async (page: Page) => Number(await page.locator("#now").textContent());

  test("a guide run freezes the clock before a beforeEach navigates", async ({ page, guide }) => {
    await guide.step("Look at the clock.", async () => {});
    const shownAt = await rendered(page);
    await page.waitForTimeout(1100);
    const now = await page.evaluate(() => Date.now());
    if (mode() === "plain") expect(now).toBeGreaterThan(shownAt + 1000);
    else expect(now).toBe(shownAt);
  });

  test("the clock is frozen in a guide run without the guide fixture", async ({ page }) => {
    const shownAt = await rendered(page);
    await page.waitForTimeout(1100);
    const now = await page.evaluate(() => Date.now());
    if (mode() === "plain") expect(now).toBeGreaterThan(shownAt + 1000);
    else expect(now).toBe(shownAt);
  });

  test.describe("at a date", () => {
    const at = new Date("2030-01-02T03:04:05Z");
    test.use({ guideClock: at });

    test("guideClock stops the clock at that instant", async ({ page }) => {
      if (mode() === "plain") expect(await rendered(page)).not.toBe(at.getTime());
      else expect(await rendered(page)).toBe(at.getTime());
    });
  });

  test.describe("at an epoch number", () => {
    test.use({ guideClock: Date.UTC(2031, 0, 1) });

    test("guideClock stops the clock at that instant", async ({ page }) => {
      if (mode() === "plain") expect(await rendered(page)).not.toBe(Date.UTC(2031, 0, 1));
      else expect(await rendered(page)).toBe(Date.UTC(2031, 0, 1));
    });
  });

  test.describe("off", () => {
    test.use({ guideClock: false });

    test("guideClock false leaves the clock running", async ({ page }) => {
      const shownAt = await rendered(page);
      await page.waitForTimeout(1100);
      expect(await page.evaluate(() => Date.now())).toBeGreaterThan(shownAt + 1000);
    });
  });
});

// the capture shot() runs with the project's guideShot; settings are varied here by calling it directly
test.describe("captureShot", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(mode() !== "plain", "the capture does not depend on the project");
    await page.setContent(SAMPLE_PAGE);
  });

  const capture = (
    page: Page,
    opts: Omit<ShotOptions, "alt" | "page">,
    guideShot?: GuideOptions["guideShot"],
  ) => captureShot(page, opts, guideShot);

  test("a crop is padded so the highlight's outline fits", async ({ page }) => {
    const button = page.getByRole("button", { name: "Publish" });
    const box = (await button.boundingBox())!;
    const png = await capture(page, { highlight: button, crop: button });
    expect(Math.abs(png.readUInt32BE(16) - (box.width + 24))).toBeLessThanOrEqual(1);
    expect(Math.abs(png.readUInt32BE(20) - (box.height + 24))).toBeLessThanOrEqual(1);
  });

  test("the highlight is outlined only while the shot is taken", async ({ page }) => {
    const button = page.getByRole("button", { name: "Save changes" });
    const box = (await button.boundingBox())!;
    const png = await capture(page, { highlight: button });
    // the outline is 3px wide, 3px out from the button's edge
    expect(pixel(png, box.x - 4.5, box.y + box.height / 2)).toEqual(RED);
    await expect(button).not.toHaveAttribute("data-guides-highlight");
  });

  test("mask and style reach the screenshot", async ({ page }) => {
    const card = page.locator("#card");
    const box = (await card.boundingBox())!;
    const png = await capture(page, {
      mask: [card],
      style: "body{background:rgb(0,128,0)!important}",
    });
    expect(pixel(png, box.x + box.width / 2, box.y + box.height / 2)).toEqual([255, 0, 255]);
    expect(pixel(png, 2, 700)).toEqual([0, 128, 0]);
  });

  test("two highlights are both outlined and inside the crop", async ({ page }) => {
    const save = page.getByRole("button", { name: "Save changes" });
    const publish = page.getByRole("button", { name: "Publish" });
    const s = (await save.boundingBox())!;
    const p = (await publish.boundingBox())!;
    const png = await capture(page, { highlight: [save, publish], crop: save });
    const left = s.x - 12;
    const top = Math.min(s.y, p.y) - 12;
    expect(Math.abs(png.readUInt32BE(16) - (p.x + p.width + 12 - left))).toBeLessThanOrEqual(1);
    expect(pixel(png, s.x - 4.5 - left, s.y + s.height / 2 - top)).toEqual(RED);
    expect(pixel(png, p.x - 4.5 - left, p.y + p.height / 2 - top)).toEqual(RED);
    await expect(save).not.toHaveAttribute("data-guides-highlight");
    await expect(publish).not.toHaveAttribute("data-guides-highlight");
  });

  test("guideShot.style applies to every shot, before the shot's style", async ({ page }) => {
    const card = (await page.locator("#card").boundingBox())!;
    const note = (await page.locator("#note").boundingBox())!;
    const png = await capture(
      page,
      { style: "#note{background:rgb(0,0,200)!important}" },
      { style: "#card,#note{background:rgb(200,0,0)!important}" },
    );
    expect(pixel(png, card.x + 150, card.y + 60)).toEqual([200, 0, 0]);
    expect(pixel(png, note.x + 150, note.y + 60)).toEqual([0, 0, 200]);
  });

  test("guideShot.style keeps the default highlight", async ({ page }) => {
    const button = page.getByRole("button", { name: "Save changes" });
    const box = (await button.boundingBox())!;
    const png = await capture(page, { highlight: button }, { style: "#card{color:red}" });
    expect(pixel(png, box.x - 4.5, box.y + box.height / 2)).toEqual(RED);
  });

  test("guideShot sets the highlight and the padding of every shot", async ({ page }) => {
    const guideShot = {
      highlight: "outline:3px solid rgb(0,0,255);outline-offset:3px",
      padding: 20,
    };
    const button = page.getByRole("button", { name: "Save changes" });
    const box = (await button.boundingBox())!;
    const full = await capture(page, { highlight: button }, guideShot);
    const crop = await capture(page, { crop: button }, guideShot);
    expect(pixel(full, box.x - 4.5, box.y + box.height / 2)).toEqual([0, 0, 255]);
    expect(Math.abs(crop.readUInt32BE(16) - (box.width + 40))).toBeLessThanOrEqual(1);
  });

  test("guideShot keys set to undefined keep their defaults", async ({ page }) => {
    const guideShot = {
      highlight: undefined,
      padding: undefined,
      style: undefined,
      screenshot: { caret: undefined },
    };
    const button = page.getByRole("button", { name: "Save changes" });
    const box = (await button.boundingBox())!;
    const full = await capture(page, { highlight: button }, guideShot);
    const crop = await capture(page, { crop: button }, guideShot);
    expect(pixel(full, box.x - 4.5, box.y + box.height / 2)).toEqual(RED);
    expect(Math.abs(crop.readUInt32BE(16) - (box.width + 24))).toBeLessThanOrEqual(1);
  });

  test("a shot's highlightStyle and padding override guideShot", async ({ page }) => {
    const guideShot = {
      highlight: "outline:3px solid rgb(0,0,255);outline-offset:3px",
      padding: 20,
    };
    const button = page.getByRole("button", { name: "Save changes" });
    const box = (await button.boundingBox())!;
    const highlightStyle = "outline:3px solid rgb(0,160,0);outline-offset:3px";
    const full = await capture(page, { highlight: button, highlightStyle }, guideShot);
    const crop = await capture(page, { crop: button, padding: 4 }, guideShot);
    expect(pixel(full, box.x - 4.5, box.y + box.height / 2)).toEqual([0, 160, 0]);
    expect(Math.abs(crop.readUInt32BE(16) - (box.width + 8))).toBeLessThanOrEqual(1);
  });

  test.describe("at deviceScaleFactor 2", () => {
    test.use({ deviceScaleFactor: 2 });

    test("a shot is taken at device scale by default", async ({ page }) => {
      expect((await capture(page, {})).readUInt32BE(16)).toBe(2560);
    });

    test("guideShot.screenshot reaches the screenshot", async ({ page }) => {
      expect((await capture(page, {}, { screenshot: { scale: "css" } })).readUInt32BE(16)).toBe(
        1280,
      );
    });
  });
});
