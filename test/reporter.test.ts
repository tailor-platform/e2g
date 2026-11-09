import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "node_modules/@playwright/test/cli.js");
const RUN_TIMEOUT = 40_000;
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// a copy of the fixture project that imports this package by name, as a user's project would
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "e2g-"));
  dirs.push(dir);
  cpSync(join(ROOT, "test/fixture-project"), dir, { recursive: true });
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(
    join(ROOT, "node_modules/@playwright"),
    join(dir, "node_modules/@playwright"),
    "junction",
  );
  mkdirSync(join(dir, "node_modules/@tailor-platform"));
  symlinkSync(ROOT, join(dir, "node_modules/@tailor-platform/e2g"), "junction");
  return dir;
}

interface Run {
  code: number | null;
  stderr: string;
  stdout: string;
}

function run(
  dir: string,
  opts: { env?: Record<string, string>; args?: string[]; cwd?: string } = {},
): Promise<Run> {
  const args = [CLI, "test", ...(opts.cwd ? ["--config", join(dir, "playwright.config.ts")] : [])];
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
  for (const key of Object.keys(env))
    if (key === "CI" || key.startsWith("PW_TEST")) delete env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args, ...(opts.args ?? [])], {
      cwd: opts.cwd ?? dir,
      env,
      timeout: RUN_TIMEOUT,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}

const NO_SHOTS = { GUIDES_SHOTS: "0" };
const PRUNE = { GUIDES_PRUNE: "1" };

const FILES = [
  "site/docs/en/menu.md",
  "site/docs/ja/menu.md",
  "site/docs/en/settings.md",
  "site/docs/ja/settings.md",
  "site/assets/en/menu/menu.png",
  "site/assets/ja/menu/menu.png",
  "site/assets/en/settings/settings.png",
  "site/assets/ja/settings/settings.png",
  "site/docs/.guides.json",
];

type Snapshot = Map<string, { mtime: number; data: string }>;

function snapshot(dir: string): Snapshot {
  return new Map(
    FILES.filter((f) => existsSync(join(dir, f))).map((f) => [
      f,
      {
        mtime: statSync(join(dir, f)).mtimeMs,
        data: readFileSync(join(dir, f)).toString("base64"),
      },
    ]),
  );
}

function ok(result: Run) {
  expect(result.code, result.stdout + result.stderr).toBe(0);
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");

// nudges one pixel of a flat area by 1, a change too faint for sameScreen to notice
function nudged(png: Buffer): Buffer {
  const image = PNG.sync.read(png);
  image.data[0] = image.data[0]! < 128 ? image.data[0]! + 1 : image.data[0]! - 1;
  return PNG.sync.write(image);
}

function centerColor(file: string): number[] {
  const png = PNG.sync.read(readFileSync(file));
  const center = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [...png.data.subarray(center, center + 3)];
}

// replaces the fixture's guides with one spec file
function withSpec(dir: string, name: string, source: string) {
  rmSync(join(dir, "tests/menu.spec.ts"));
  rmSync(join(dir, "tests/settings.spec.ts"));
  writeFileSync(join(dir, `tests/${name}.spec.ts`), source);
}

const box = (color: string) =>
  `<div id="box" style="width:40px;height:40px;background:${color}"></div>`;

describe.concurrent("GuidesReporter", { timeout: 120_000 }, () => {
  it("writes pages and shots, and a manifest", async () => {
    const dir = project();
    ok(await run(dir));
    for (const file of FILES) expect(existsSync(join(dir, file)), file).toBe(true);
    expect(read(dir, "site/docs/en/menu.md")).toBe(
      [
        "<!-- generated from menu.spec.ts -->",
        "",
        "# Open the menu",
        "",
        "The menu lists every page.",
        "",
        "1. Click Menu.",
        "",
        "   ![The open menu](../../assets/en/menu/menu.png)",
        "",
      ].join("\n"),
    );
    expect(read(dir, "site/docs/ja/settings.md")).toContain(
      "2. 設定を選びます。\n\n   ![設定の画面](../../assets/ja/settings/settings.png)",
    );
    expect(read(dir, "site/docs/.guides.json")).toBe(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          pages: ["en/menu.md", "en/settings.md", "ja/menu.md", "ja/settings.md"],
          shots: [
            "../assets/en/menu/menu.png",
            "../assets/en/settings/settings.png",
            "../assets/ja/menu/menu.png",
            "../assets/ja/settings/settings.png",
          ],
        },
        null,
        2,
      )}\n`,
    );
    const png = PNG.sync.read(readFileSync(join(dir, "site/assets/en/menu/menu.png")));
    expect(png.width).toBeGreaterThan(0);
  });

  it("grep /@guide/ in the config is a full run", async () => {
    const dir = project();
    ok(await run(dir));
    rmSync(join(dir, "tests/settings.spec.ts"));
    // plain.spec.ts has no guide, so grep leaves its file out, which does not make the run partial
    const result = await run(dir, { env: PRUNE });
    ok(result);
    expect(result.stdout).not.toContain("a plain e2e test");
    expect(result.stderr).not.toContain("wrote no guide pages");
    expect(existsSync(join(dir, "site/docs/en/settings.md"))).toBe(false);
    expect(existsSync(join(dir, "site/docs/en/menu.md"))).toBe(true);
  });

  it("a different config grep is partial", async () => {
    const dir = project();
    const result = await run(dir, { env: { GUIDES_GREP: "@guide|plain" } });
    ok(result);
    expect(result.stdout).toContain("a plain e2e test");
    expect(existsSync(join(dir, "site"))).toBe(false);
    expect(result.stderr).toContain(
      'e2g: wrote no guide pages because project "en" does not set grep: /@guide/',
    );
  });

  it("a run without guideLocale writes nothing", async () => {
    const dir = project();
    const result = await run(dir, { env: { GUIDES_NO_LOCALE: "1" } });
    ok(result);
    expect(existsSync(join(dir, "site"))).toBe(false);
    expect(result.stderr).toContain(
      "e2g: wrote no guide pages because no project sets use.guideLocale",
    );
  });

  it("two projects with the same guideLocale fail the run", async () => {
    const dir = project();
    const result = await run(dir, { env: { GUIDES_LOCALES: "en,en" } });
    expect(result.code).not.toBe(0);
    expect(existsSync(join(dir, "site"))).toBe(false);
    expect(result.stderr).toContain('e2g: projects "en" and "en-1" both set use.guideLocale "en"');
  });

  it("guideShots off writes nothing", async () => {
    const dir = project();
    ok(await run(dir));
    writeFileSync(join(dir, "site/docs/en/hand-written.md"), "kept");
    const before = snapshot(dir);
    const result = await run(dir, { env: { ...NO_SHOTS, ...PRUNE } });
    ok(result);
    expect(snapshot(dir)).toEqual(before);
    expect(read(dir, "site/docs/en/hand-written.md")).toBe("kept");
    expect(result.stderr).toContain("e2g: did not write menu/en (");
    expect(result.stderr).toContain("guideShots");
  });

  it("a second identical run rewrites nothing", async () => {
    const dir = project();
    ok(await run(dir));
    const before = snapshot(dir);
    expect(before.size).toBe(FILES.length);
    ok(await run(dir));
    expect(snapshot(dir)).toEqual(before);
  });

  it("shots.same false rewrites on any byte change", async () => {
    const dir = project();
    ok(await run(dir));
    const file = join(dir, "site/assets/en/menu/menu.png");
    const original = readFileSync(file);
    const noisy = nudged(original);
    expect(noisy.equals(original)).toBe(false);
    writeFileSync(file, noisy);
    ok(await run(dir));
    expect(readFileSync(file).equals(noisy)).toBe(true);
    ok(await run(dir, { env: { GUIDES_SAME: "off" } }));
    expect(readFileSync(file).equals(original)).toBe(true);
  });

  it("prune removes a deleted guide's page and shots", async () => {
    const dir = project();
    ok(await run(dir));
    writeFileSync(join(dir, "site/docs/en/hand-written.md"), "kept");
    rmSync(join(dir, "tests/settings.spec.ts"));
    ok(await run(dir, { env: PRUNE }));
    for (const file of FILES.filter((f) => f.includes("settings")))
      expect(existsSync(join(dir, file)), file).toBe(false);
    expect(existsSync(join(dir, "site/assets/en/settings"))).toBe(false);
    expect(existsSync(join(dir, "site/assets/ja/settings"))).toBe(false);
    expect(existsSync(join(dir, "site/docs/en/menu.md"))).toBe(true);
    expect(existsSync(join(dir, "site/assets/en/menu/menu.png"))).toBe(true);
    expect(read(dir, "site/docs/en/hand-written.md")).toBe("kept");
    expect(JSON.parse(read(dir, "site/docs/.guides.json"))).toEqual({
      schemaVersion: 1,
      pages: ["en/menu.md", "ja/menu.md"],
      shots: ["../assets/en/menu/menu.png", "../assets/ja/menu/menu.png"],
    });
  });

  it("a run without forbidOnly writes nothing, since a .only run cannot be ruled out", async () => {
    const dir = project();
    const result = await run(dir, { env: { GUIDES_FORBID_ONLY: "0" } });
    ok(result);
    expect(existsSync(join(dir, "site"))).toBe(false);
    expect(result.stderr).toContain(
      "e2g: wrote no guide pages because forbidOnly is off, so a .only run cannot be ruled out",
    );
  });

  it("a page split across two spec files fails the run and writes nothing", async () => {
    const dir = project();
    const spec = (title: string) => `import { guidePage } from "@tailor-platform/e2g/playwright";
import { test } from "./fixtures.ts";

test("${title}", guidePage("split", { title: { en: "Split", ja: "Split" } }), async ({ guide }) => {
  await guide.say({ en: "${title}", ja: "${title}" });
});
`;
    withSpec(dir, "split-one", spec("one"));
    writeFileSync(join(dir, "tests/split-two.spec.ts"), spec("two"));
    const result = await run(dir);
    expect(result.code).not.toBe(0);
    expect(existsSync(join(dir, "site"))).toBe(false);
    expect(result.stderr).toContain(
      "e2g: wrote no guide pages because page split/en is built from several spec files (split-one.spec.ts, split-two.spec.ts)",
    );
  });

  it("a project that did not run makes its pages incomplete", async () => {
    const dir = project();
    ok(await run(dir));
    rmSync(join(dir, "tests/settings.spec.ts"));
    rmSync(join(dir, "site/docs/en/menu.md"));
    rmSync(join(dir, "site/docs/ja/menu.md"));
    for (const opts of [
      { env: { ...PRUNE, GUIDES_SKIP: "ja" } },
      { env: PRUNE, args: ["--project", "en"] },
    ]) {
      const result = await run(dir, opts);
      ok(result);
      expect(result.stderr).toContain(
        "e2g: did not write menu/ja (no test of it ran for locale ja)",
      );
      expect(result.stderr).toContain("e2g: pruned nothing because some pages were not written");
      expect(existsSync(join(dir, "site/docs/en/menu.md"))).toBe(true);
      expect(existsSync(join(dir, "site/docs/ja/menu.md"))).toBe(false);
      for (const file of FILES.filter((f) => f.includes("settings")))
        expect(existsSync(join(dir, file)), file).toBe(true);
      rmSync(join(dir, "site/docs/en/menu.md"));
    }
  });

  it("-g writes nothing", async () => {
    const dir = project();
    const result = await run(dir, { args: ["-g", "menu"] });
    ok(result);
    expect(existsSync(join(dir, "site"))).toBe(false);
    expect(result.stderr).toContain("e2g: wrote no guide pages because -g was passed");
  });

  it("a spec file filter writes nothing", async () => {
    const dir = project();
    const result = await run(dir, { args: ["menu.spec.ts"] });
    ok(result);
    expect(existsSync(join(dir, "site"))).toBe(false);
    expect(result.stderr).toContain(
      "e2g: wrote no guide pages because a test file filter menu.spec.ts was passed",
    );
  });

  it("a spec file that fails to load writes nothing", async () => {
    const dir = project();
    ok(await run(dir));
    rmSync(join(dir, "tests/settings.spec.ts"));
    writeFileSync(join(dir, "tests/broken.spec.ts"), 'throw new Error("broken spec");\n');
    const before = snapshot(dir);
    const result = await run(dir, { env: PRUNE });
    expect(result.code).not.toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(result.stderr).toContain(
      "e2g: wrote no guide pages because Playwright reported an error outside the tests",
    );
  });

  it("an output error fails the run", async () => {
    const dir = project();
    const result = await run(dir, { env: { GUIDES_RENDER_THROWS: "1" } });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("e2g: render is broken");
    expect(existsSync(join(dir, "site"))).toBe(false);
  });

  it("relative options resolve from the config directory", async () => {
    const dir = project();
    const elsewhere = mkdtempSync(join(tmpdir(), "e2g-cwd-"));
    dirs.push(elsewhere);
    ok(await run(dir, { cwd: elsewhere }));
    for (const file of FILES) expect(existsSync(join(dir, file)), file).toBe(true);
    expect(read(dir, "site/docs/en/menu.md")).toMatch(/^<!-- generated from menu\.spec\.ts -->\n/);
    expect(existsSync(join(elsewhere, "site"))).toBe(false);
  });

  it("retries use the last result's steps", async () => {
    const dir = project();
    withSpec(
      dir,
      "flaky",
      `import { guidePage } from "@tailor-platform/e2g/playwright";
import { test } from "./fixtures.ts";

test.describe.configure({ retries: 1 });

test("passes on retry", guidePage("flaky", { title: { en: "Flaky", ja: "Flaky" } }), async ({ page, guide }, testInfo) => {
  const first = testInfo.retry === 0;
  await page.setContent(first ? ${JSON.stringify(box("#ff0000"))} : ${JSON.stringify(box("#0000ff"))});
  const title = first ? "First try." : "Second try.";
  await guide.step({ en: title, ja: title }, async () => {
    await guide.shot("box", { alt: { en: "A box", ja: "A box" }, crop: page.locator("#box"), padding: 0 });
  });
  if (first) throw new Error("first attempt fails");
});
`,
    );
    const result = await run(dir);
    ok(result);
    expect(result.stdout).toContain("2 flaky");
    const page = read(dir, "site/docs/en/flaky.md");
    expect(page).toContain("1. Second try.");
    expect(page).not.toContain("First try.");
    expect(centerColor(join(dir, "site/assets/en/flaky/box.png"))).toEqual([0, 0, 255]);
  });

  it("a step's attachments are read from the step, not result.attachments", async () => {
    const dir = project();
    withSpec(
      dir,
      "attach",
      `import { guidePage } from "@tailor-platform/e2g/playwright";
import { test } from "./fixtures.ts";

test("attach", guidePage("attach", { title: { en: "Attach", ja: "Attach" } }), async ({ page, guide }, testInfo) => {
  await page.setContent(${JSON.stringify(box("#ff0000"))});
  const red = await page.locator("#box").screenshot();
  await page.setContent(${JSON.stringify(box("#0000ff"))});
  await guide.step({ en: "Look at the box.", ja: "Look at the box." }, async () => {
    await guide.shot("box", { alt: { en: "A box", ja: "A box" }, crop: page.locator("#box"), padding: 0 });
  });
  await testInfo.attach("e2g/png/box", { body: red, contentType: "image/png" });
  await testInfo.attach("e2g/shot", {
    body: JSON.stringify({ name: "ghost", alt: "Ghost" }),
    contentType: "application/json",
  });
  await testInfo.attach("e2g/say", { body: "Ghost paragraph.", contentType: "text/markdown" });
});
`,
    );
    ok(await run(dir));
    expect(read(dir, "site/docs/en/attach.md")).toBe(
      [
        "<!-- generated from attach.spec.ts -->",
        "",
        "# Attach",
        "",
        "1. Look at the box.",
        "",
        "   ![A box](../../assets/en/attach/box.png)",
        "",
      ].join("\n"),
    );
    expect(centerColor(join(dir, "site/assets/en/attach/box.png"))).toEqual([0, 0, 255]);
  });

  it("steps inside helpers and hooks are found", async () => {
    const dir = project();
    withSpec(
      dir,
      "hooks",
      `import { guidePage, type Guide } from "@tailor-platform/e2g/playwright";
import { test } from "./fixtures.ts";

const both = (text: string) => ({ en: text, ja: text });
const openApp = (guide: Guide) => guide.step(both("Open the app."), async () => {});

test.beforeEach(async ({ guide }) => {
  await guide.say(both("Before each test."));
  await openApp(guide);
});

test.afterEach(async ({ guide }) => {
  await guide.step(both("Clean up."), async () => {});
});

test("hooks", guidePage("hooks", { title: both("Hooks") }), async ({ guide }) => {
  await test.step("A helper", async () => {
    await guide.step(both("From a helper."), async () => {});
  });
  await guide.say(both("Done."));
});
`,
    );
    ok(await run(dir));
    expect(read(dir, "site/docs/en/hooks.md")).toBe(
      [
        "<!-- generated from hooks.spec.ts -->",
        "",
        "# Hooks",
        "",
        "Before each test.",
        "",
        "1. Open the app.",
        "",
        "2. From a helper.",
        "",
        "Done.",
        "",
        "3. Clean up.",
        "",
      ].join("\n"),
    );
  });

  it("a test.step outside guide.step is not a guide step", async () => {
    const dir = project();
    withSpec(
      dir,
      "plain-steps",
      `import { guidePage } from "@tailor-platform/e2g/playwright";
import { test } from "./fixtures.ts";

test("plain steps", guidePage("plain-steps", { title: { en: "Steps", ja: "Steps" } }), async ({ guide }) => {
  await test.step("Not a guide step.", async () => {});
  await guide.step({ en: "A guide step.", ja: "A guide step." }, async () => {
    await test.step("Not one either.", async () => {});
  });
});
`,
    );
    ok(await run(dir));
    expect(read(dir, "site/docs/en/plain-steps.md")).toBe(
      [
        "<!-- generated from plain-steps.spec.ts -->",
        "",
        "# Steps",
        "",
        "1. A guide step.",
        "",
      ].join("\n"),
    );
  });

  it("guide.step and guide.say are located in the spec, not in the installed package", async () => {
    const dir = project();
    withSpec(
      dir,
      "located",
      `import { guidePage } from "@tailor-platform/e2g/playwright";
import { test } from "./fixtures.ts";

test("located", guidePage("located", { title: { en: "Located", ja: "Located" } }), async ({ guide }) => {
  await guide.say({ en: "A paragraph.", ja: "A paragraph." });
  await guide.step({ en: "Fails.", ja: "Fails." }, async () => {
    throw new Error("the step fails");
  });
});
`,
    );
    const locations = join(dir, "locations.json");
    const result = await run(dir, { env: { GUIDES_LOCATIONS: locations } });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("the step fails");
    const spec = realpathSync(join(dir, "tests/located.spec.ts"));
    const steps = JSON.parse(read(dir, "locations.json")) as {
      title: string;
      file: string;
      line: number;
    }[];
    const found = steps.map(({ title, file, line }) => ({ title, file: realpathSync(file), line }));
    // one test per locale project
    const located = [
      { title: "A paragraph.", file: spec, line: 5 },
      { title: "Fails.", file: spec, line: 6 },
    ];
    expect(found).toEqual([...located, ...located]);
  });

  it("an unreadable manifest is left as it is, and nothing is pruned", async () => {
    const dir = project();
    ok(await run(dir));
    const manifest = join(dir, "site/docs/.guides.json");
    writeFileSync(manifest, "{ not json");
    rmSync(join(dir, "site/docs/en/menu.md"));
    rmSync(join(dir, "tests/settings.spec.ts"));
    const result = await run(dir, { env: PRUNE });
    ok(result);
    expect(read(dir, "site/docs/.guides.json")).toBe("{ not json");
    expect(result.stderr).toContain("e2g: left ");
    expect(existsSync(join(dir, "site/docs/en/menu.md"))).toBe(true);
    for (const file of FILES.filter((f) => f.includes("settings")))
      expect(existsSync(join(dir, file)), file).toBe(true);
    expect(result.stderr).toContain(
      "site/docs/.guides.json as it is because it could not be read; fix or delete it",
    );
  });
});
