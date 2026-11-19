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
import { afterAll, describe, expect, it } from "vitest";
import { guideProjects } from "../src/vitest/reporter/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUN_TIMEOUT = 60_000;
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// a copy of the fixture project that imports this package by name, as a user's project would
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "e2g-vitest-"));
  dirs.push(dir);
  cpSync(join(ROOT, "test/vitest-fixture-project"), dir, { recursive: true });
  mkdirSync(join(dir, "node_modules/@tailor-platform"), { recursive: true });
  symlinkSync(join(ROOT, "node_modules/vitest"), join(dir, "node_modules/vitest"), "junction");
  symlinkSync(ROOT, join(dir, "node_modules/@tailor-platform/e2g"), "junction");
  return dir;
}

interface Run {
  code: number | null;
  stderr: string;
  stdout: string;
}

function vitest(dir: string, args: string[], extra: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  // the outer Vitest's variables would make the inner one think it runs inside a worker
  for (const key of Object.keys(env)) if (key.startsWith("VITEST") || key === "CI") delete env[key];
  return spawn(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", ...args, "-c", "vitest.guides.config.ts"],
    { cwd: dir, env, timeout: RUN_TIMEOUT },
  );
}

function collect(child: ReturnType<typeof vitest>, onStderr?: (stderr: string) => void) {
  return new Promise<Run>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      onStderr?.(stderr);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}

function run(dir: string, extra: Record<string, string> = {}, args: string[] = []): Promise<Run> {
  return collect(vitest(dir, ["run", ...args], extra));
}

// watch mode never exits, so this stops it once the reporter has logged its first run
function watchFirstRun(dir: string, extra: Record<string, string> = {}): Promise<Run> {
  const child = vitest(dir, ["watch"], extra);
  return collect(child, (stderr) => {
    if (stderr.includes("e2g: ")) child.kill();
  });
}

function ok(result: Run) {
  expect(result.code, result.stdout + result.stderr).toBe(0);
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), "utf8");

const FILES = [
  "site/docs/en/create-a-project.md",
  "site/docs/ja/create-a-project.md",
  "site/docs/en/show-help.md",
  "site/docs/ja/show-help.md",
  "site/assets/en/create-a-project/picker.svg",
  "site/assets/ja/create-a-project/picker.svg",
  "site/docs/.e2g.json",
];

type Snapshot = Map<string, { mtime: number; data: string }>;

function snapshot(dir: string): Snapshot {
  return new Map(
    FILES.filter((f) => existsSync(join(dir, f))).map((f) => [
      f,
      { mtime: statSync(join(dir, f)).mtimeMs, data: read(dir, f) },
    ]),
  );
}

describe.concurrent("guidesReporter", { timeout: 180_000 }, () => {
  it("writes en and ja pages with command blocks and an svg", async () => {
    const dir = project();
    ok(await run(dir));
    for (const file of FILES) expect(existsSync(join(dir, file)), file).toBe(true);
    expect(read(dir, "site/docs/en/create-a-project.md")).toBe(
      [
        "<!-- generated from guides/create-a-project.test.ts -->",
        "",
        "# Create a project",
        "",
        "Create a project with mycli.",
        "",
        "1. Check the version.",
        "",
        "```console",
        "$ mycli --version",
        "mycli 1.0.0",
        "```",
        "",
        "2. Pick a template.",
        "",
        "![The template picker](../../assets/en/create-a-project/picker.svg)",
        "",
      ].join("\n"),
    );
    const ja = read(dir, "site/docs/ja/create-a-project.md");
    expect(ja).toContain("1. バージョンを確認します。");
    expect(ja).toContain("![テンプレートの選択画面](../../assets/ja/create-a-project/picker.svg)");
    expect(read(dir, "site/assets/en/create-a-project/picker.svg")).toMatch(/^<svg/);
    expect(JSON.parse(read(dir, "site/docs/.e2g.json"))).toEqual({
      schemaVersion: 1,
      pages: [
        "en/create-a-project.md",
        "en/show-help.md",
        "ja/create-a-project.md",
        "ja/show-help.md",
      ],
      shots: [
        "../assets/en/create-a-project/picker.svg",
        "../assets/ja/create-a-project/picker.svg",
      ],
    });
  });

  it("rerun writes nothing", async () => {
    const dir = project();
    ok(await run(dir));
    const before = snapshot(dir);
    expect(before.size).toBe(FILES.length);
    const result = await run(dir);
    ok(result);
    expect(result.stderr).not.toContain("wrote");
    expect(snapshot(dir)).toEqual(before);
  });

  it("a failing test keeps the old page", async () => {
    const dir = project();
    ok(await run(dir));
    const page = "site/docs/en/create-a-project.md";
    const old = "kept";
    writeFileSync(join(dir, page), old);
    const result = await run(dir, { GUIDES_FAIL: "1", GUIDES_PRUNE: "1" });
    expect(result.code).not.toBe(0);
    expect(read(dir, page)).toBe(old);
    expect(result.stderr).toContain("e2g: did not write create-a-project/en");
    expect(result.stderr).toContain("e2g: pruned nothing because some pages were not written");
    expect(existsSync(join(dir, "site/docs/en/show-help.md"))).toBe(true);
  });

  it("prune deletes a removed page", async () => {
    const dir = project();
    ok(await run(dir));
    rmSync(join(dir, "guides/show-help.test.ts"));
    ok(await run(dir, { GUIDES_PRUNE: "1" }));
    expect(existsSync(join(dir, "site/docs/en/show-help.md"))).toBe(false);
    expect(existsSync(join(dir, "site/docs/ja/show-help.md"))).toBe(false);
    expect(existsSync(join(dir, "site/docs/en/create-a-project.md"))).toBe(true);
    expect(JSON.parse(read(dir, "site/docs/.e2g.json")).pages).toEqual([
      "en/create-a-project.md",
      "ja/create-a-project.md",
    ]);
  });

  it("refuses a path another manifest owns", async () => {
    const dir = project();
    mkdirSync(join(dir, "site/docs"), { recursive: true });
    writeFileSync(
      join(dir, "site/docs/.guides.json"),
      JSON.stringify({ schemaVersion: 1, pages: ["en/show-help.md"], shots: [] }),
    );
    const result = await run(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      `e2g: wrote no guide pages because page show-help/en writes ${join(realpathSync(dir), "site/docs/en/show-help.md")}, which another manifest owns`,
    );
    expect(existsSync(join(dir, "site/docs/en/create-a-project.md"))).toBe(false);
  });
});

// a full run, then stale pages, so a run that writes or prunes anything changes the snapshot
async function staleProject(): Promise<{ dir: string; before: Snapshot }> {
  const dir = project();
  ok(await run(dir));
  for (const locale of ["en", "ja"])
    writeFileSync(join(dir, `site/docs/${locale}/create-a-project.md`), "stale");
  return { dir, before: snapshot(dir) };
}

const PRUNE = { GUIDES_PRUNE: "1" };

describe.concurrent("guidesReporter on a partial run", { timeout: 180_000 }, () => {
  it.each([
    [["-t", "create"], "the test name filter /create/ is set"],
    [["guides/create-a-project"], "guides/show-help.test.ts did not run"],
    [["--project", "en"], "the projects are filtered with --project"],
  ])("vitest run %j writes and deletes nothing", async (args, reason) => {
    const { dir, before } = await staleProject();
    const result = await run(dir, PRUNE, args);
    ok(result);
    expect(result.stderr).toContain(`e2g: wrote no guide pages because ${reason}`);
    expect(snapshot(dir)).toEqual(before);
  });

  it("a .only test writes and deletes nothing", async () => {
    const { dir, before } = await staleProject();
    const file = "guides/create-a-project.test.ts";
    writeFileSync(join(dir, file), read(dir, file).replace("test(", "test.only("));
    // a local run: Vitest refuses .only on CI unless allowed
    const result = await run(dir, PRUNE, ["--allowOnly"]);
    ok(result);
    expect(result.stderr).toContain(
      `e2g: wrote no guide pages because ${file} has a .only test or suite`,
    );
    expect(snapshot(dir)).toEqual(before);
  });

  it("watch mode writes and deletes nothing", async () => {
    const { dir, before } = await staleProject();
    const result = await watchFirstRun(dir, PRUNE);
    expect(result.stderr).toContain("e2g: wrote no guide pages because it runs in watch mode");
    expect(snapshot(dir)).toEqual(before);
  });

  it("a guide file with a syntax error writes and deletes nothing", async () => {
    const { dir, before } = await staleProject();
    writeFileSync(join(dir, "guides/show-help.test.ts"), "test(\n");
    const result = await run(dir, PRUNE);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      "e2g: wrote no guide pages because guides/show-help.test.ts failed to load",
    );
    expect(snapshot(dir)).toEqual(before);
  });
});

describe("guideProjects", () => {
  it("makes one project per locale that provides its locale and terminal", () => {
    const projects = guideProjects(["en", "ja"], {
      terminal: { cols: 40, replace: [[/\d+/g, "N"]] },
    });
    expect(projects).toEqual(
      ["en", "ja"].map((locale) => ({
        extends: true,
        test: {
          name: locale,
          includeTaskLocation: true,
          provide: {
            guideLocale: locale,
            guideTerminal: { cols: 40, replace: [[{ source: "\\d+", flags: "g" }, "N"]] },
          },
        },
      })),
    );
  });

  it("takes terminal settings per locale", () => {
    const [en, ja] = guideProjects(["en", "ja"], {
      terminal: { ja: { cols: 100 } },
      include: ["g/*.ts"],
    });
    expect(en!.test).toMatchObject({ include: ["g/*.ts"], provide: { guideTerminal: {} } });
    expect(ja!.test).toMatchObject({ provide: { guideTerminal: { cols: 100 } } });
  });
});
