import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apply,
  caseInsensitive,
  commit,
  type ProbeFs,
  readFile,
  readManifest,
  writeManifest,
} from "../src/core/io.js";
import { foreignPaths } from "../src/core/manifests.js";
import type { PageInfo } from "../src/core/types.js";
import { writeGuides } from "../src/core/write.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "io-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const empty = { schemaVersion: 1, pages: [], shots: [] };

describe("io", () => {
  it("a missing file reads as null", () => {
    expect(readFile(join(dir, "missing.png"))).toBeNull();
  });

  it("a missing manifest is empty", () => {
    expect(readManifest(join(dir, ".guides.json"))).toEqual(empty);
  });

  it("an unparsable manifest reads as null", () => {
    const path = join(dir, ".guides.json");
    for (const text of ["{", '{"schemaVersion":2,"pages":[],"shots":[]}', '{"pages":[1]}']) {
      writeFileSync(path, text);
      expect(readManifest(path)).toBeNull();
    }
  });

  it("writes the manifest as indented JSON", () => {
    const path = join(dir, "docs/.guides.json");
    const manifest = { schemaVersion: 1 as const, pages: ["en/a.md"], shots: [] };
    writeManifest(path, manifest);
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(readManifest(path)).toEqual(manifest);
  });

  it("writes into new directories and removes the directories deletes leave empty", () => {
    const shots = join(dir, "assets");
    const docs = join(dir, "docs");
    mkdirSync(join(shots, "en/old"), { recursive: true });
    mkdirSync(join(docs, "en"), { recursive: true });
    writeFileSync(join(shots, "en/old/a.png"), "a");
    writeFileSync(join(shots, "en/old/b.png"), "b");
    writeFileSync(join(docs, "en/old.md"), "old");
    apply(
      [
        { op: "delete", path: join(shots, "en/old/a.png") },
        { op: "delete", path: join(shots, "en/old/b.png") },
        { op: "delete", path: join(docs, "en/old.md") },
        { op: "write", path: join(docs, "ja/new.md"), data: "new" },
      ],
      [shots, docs],
    );
    expect(existsSync(join(shots, "en"))).toBe(false);
    expect(existsSync(shots)).toBe(true);
    expect(existsSync(join(docs, "en"))).toBe(false);
    expect(readFileSync(join(docs, "ja/new.md"), "utf8")).toBe("new");
  });

  it("never removes a directory outside the roots", () => {
    const outside = join(dir, "elsewhere");
    mkdirSync(outside);
    writeFileSync(join(outside, "a.png"), "a");
    apply([{ op: "delete", path: join(outside, "a.png") }], [join(dir, "assets")]);
    expect(existsSync(outside)).toBe(true);
  });

  // the directory a shot goes into is a file, so writing the shot fails
  function brokenShotDir() {
    const docs = join(dir, "docs");
    mkdirSync(join(docs, "en"), { recursive: true });
    writeFileSync(join(docs, "en/intro.md"), "old page");
    writeFileSync(join(dir, "assets"), "not a directory");
    return {
      docs,
      ops: [
        { op: "write", path: join(dir, "shots-ok/en/intro/a.png"), data: Buffer.from("a") },
        { op: "write", path: join(docs, "en/intro.md"), data: "new page" },
        { op: "write", path: join(dir, "assets/en/intro/b.png"), data: Buffer.from("b") },
      ] as const,
    };
  }

  it("a shot write that fails leaves the page untouched", () => {
    const { docs, ops } = brokenShotDir();
    expect(() => apply([...ops], [docs])).toThrow();
    expect(readFileSync(join(docs, "en/intro.md"), "utf8")).toBe("old page");
    expect(readFileSync(join(dir, "shots-ok/en/intro/a.png"), "utf8")).toBe("a");
  });

  it("writes leave no temp file and replace the old file", () => {
    const path = join(dir, "docs/en/intro.md");
    apply([{ op: "write", path, data: "one" }], []);
    apply([{ op: "write", path, data: "two" }], []);
    expect(readFileSync(path, "utf8")).toBe("two");
    expect(readdirSync(join(dir, "docs/en"))).toEqual(["intro.md"]);
  });

  it("with a failing shot write, the manifest lists the files about to be written", () => {
    const { docs, ops } = brokenShotDir();
    const manifestPath = join(docs, ".guides.json");
    const previous = { schemaVersion: 1 as const, pages: ["en/old.md"], shots: [] };
    const final = { schemaVersion: 1 as const, pages: ["en/intro.md"], shots: [] };
    expect(() =>
      commit({ ops: [...ops], roots: [docs], manifestPath, previous, manifest: final }),
    ).toThrow();
    expect(readManifest(manifestPath)).toEqual({
      schemaVersion: 1,
      pages: ["en/intro.md", "en/old.md"],
      shots: ["../assets/en/intro/b.png", "../shots-ok/en/intro/a.png"],
    });
  });

  it("commit ends with the plan's manifest", () => {
    const docs = join(dir, "docs");
    const manifestPath = join(docs, ".guides.json");
    const final = { schemaVersion: 1 as const, pages: ["en/intro.md"], shots: [] };
    commit({
      ops: [{ op: "write", path: join(docs, "en/intro.md"), data: "page" }],
      roots: [docs],
      manifestPath,
      previous: { schemaVersion: 1, pages: ["en/old.md"], shots: [] },
      manifest: final,
    });
    expect(readManifest(manifestPath)).toEqual(final);
  });

  it("commit without a manifest path leaves the manifest alone", () => {
    const docs = join(dir, "docs");
    mkdirSync(docs);
    writeFileSync(join(docs, ".guides.json"), "{");
    commit({
      ops: [{ op: "write", path: join(docs, "en/intro.md"), data: "page" }],
      roots: [docs],
      manifestPath: null,
      previous: empty as never,
      manifest: null,
    });
    expect(readFileSync(join(docs, ".guides.json"), "utf8")).toBe("{");
    expect(readFileSync(join(docs, "en/intro.md"), "utf8")).toBe("page");
  });
});

describe("foreignPaths", () => {
  it("lists what the other parseable manifests in the directory own", () => {
    const docs = join(dir, "docs");
    mkdirSync(docs);
    writeManifest(join(docs, ".e2g.json"), { schemaVersion: 1, pages: ["en/own.md"], shots: [] });
    writeManifest(join(docs, ".guides.json"), {
      schemaVersion: 1,
      pages: ["en/other.md"],
      shots: ["../assets/en/other/a.png"],
    });
    writeFileSync(join(docs, "broken.json"), "{ not json");
    const manifestLike = JSON.stringify({ schemaVersion: 1, pages: ["x.md"], shots: [] });
    writeFileSync(join(docs, "page.md"), manifestLike);
    expect(foreignPaths(join(docs, ".e2g.json"), false)).toEqual(
      new Set([join(docs, "en/other.md"), join(dir, "assets/en/other/a.png")]),
    );
  });

  it("treats its own manifest under another spelling as its own on a case-insensitive file system", () => {
    writeManifest(join(dir, ".cli.json"), { schemaVersion: 1, pages: ["own.md"], shots: [] });
    expect(foreignPaths(join(dir, ".CLI.json"), true)).toEqual(new Set());
    expect(foreignPaths(join(dir, ".CLI.json"), false)).toEqual(new Set([join(dir, "own.md")]));
  });

  it("is empty when the directory does not exist", () => {
    expect(foreignPaths(join(dir, "missing/.e2g.json"), false)).toEqual(new Set());
  });
});

describe("caseInsensitive", () => {
  it("matches whether the file system finds a file under another spelling", () => {
    writeFileSync(join(dir, "probe"), "");
    expect(caseInsensitive(dir)).toBe(existsSync(join(dir, "PROBE")));
  });

  it("probes the nearest existing ancestor of a missing directory", () => {
    expect(caseInsensitive(join(dir, "missing/docs"))).toBe(caseInsensitive(dir));
  });

  it("leaves no probe file behind", () => {
    caseInsensitive(dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  // A case-insensitive volume at /mnt/c under a case-sensitive root.
  function mountedFs(writable = true): ProbeFs & { files: Set<string> } {
    const dirs = new Set(["/", "/mnt", "/mnt/c", "/mnt/c/docs", "/home", "/home/docs"]);
    const files = new Set<string>();
    const canonical = (path: string) =>
      path === "/mnt/c" || path.startsWith("/mnt/c/")
        ? `/mnt/c${path.slice(6).toLowerCase()}`
        : path;
    const ids = new Map<string, number>();
    const id = (path: string) => {
      if (!ids.has(path)) ids.set(path, ids.size + 1);
      return ids.get(path)!;
    };
    return {
      files,
      statSync(path) {
        const key = canonical(path);
        if (!dirs.has(key) && !files.has(key)) throw new Error(`ENOENT ${path}`);
        return { ino: id(key), dev: 1, isDirectory: () => dirs.has(key) };
      },
      writeFileSync(path) {
        if (!writable) throw new Error("EROFS");
        files.add(canonical(path));
      },
      rmSync(path) {
        files.delete(canonical(path));
      },
    };
  }

  it("judges a mounted volume by its own rules, not its ancestors'", () => {
    const fs = mountedFs();
    expect(caseInsensitive("/mnt/c/docs", fs)).toBe(true);
    expect(caseInsensitive("/mnt/c/docs/missing/deeper", fs)).toBe(true);
    expect(caseInsensitive("/home/docs", fs)).toBe(false);
    expect(caseInsensitive("/home/missing", fs)).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it("compares the directory's own name when it cannot write a probe", () => {
    const fs = mountedFs(false);
    expect(caseInsensitive("/mnt/c/docs", fs)).toBe(true);
    expect(caseInsensitive("/home/docs", fs)).toBe(false);
  });
});

describe("writeGuides", () => {
  const run = (
    prune: boolean,
    log: string[],
    path: (p: PageInfo<unknown>) => string = (p) => `docs/${p.locale}/${p.slug}.md`,
  ) =>
    writeGuides({
      base: dir,
      rootDir: dir,
      expected: [
        {
          id: "t",
          slug: "intro",
          locale: "en",
          locales: ["en"],
          variants: [],
          file: join(dir, "intro.test.ts"),
          line: 1,
          column: 1,
        },
      ],
      results: new Map([
        [
          "t",
          {
            ok: true,
            record: {
              schemaVersion: 1,
              slug: "intro",
              locale: "en",
              meta: {},
              blocks: [{ kind: "say", text: "Hello" }],
            },
            shots: new Map(),
          },
        ],
      ]),
      scope: { partial: false },
      output: { path, render: () => "page\n" },
      shots: { dir: "docs/assets" },
      manifest: "docs/.guides.json",
      prune,
      same: () => false,
      log: (m) => log.push(m),
    });

  it("ignores and keeps manifest entries outside the manifest's directory", () => {
    const outside = join(dir, "important.txt");
    writeFileSync(outside, "keep");
    mkdirSync(join(dir, "docs", "en"), { recursive: true });
    const old = join(dir, "docs", "en", "old.md");
    writeFileSync(old, "old");
    const manifestPath = join(dir, "docs", ".guides.json");
    writeManifest(manifestPath, {
      schemaVersion: 1,
      pages: ["../important.txt", "en/old.md"],
      shots: [],
    });
    const log: string[] = [];
    expect(run(true, log)).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe("keep");
    expect(existsSync(old)).toBe(false);
    expect(log).toContain(
      `ignored ../important.txt in ${manifestPath}: it is outside ${join(dir, "docs")}`,
    );
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual({
      schemaVersion: 1,
      pages: ["en/intro.md"],
      shots: [],
    });
  });

  it("writes nothing when a page is outside the manifest's directory", () => {
    const log: string[] = [];
    expect(run(true, log, () => "site/intro.md")).toBe(true);
    expect(existsSync(join(dir, "site"))).toBe(false);
    expect(existsSync(join(dir, "docs", ".guides.json"))).toBe(false);
    expect(log).toEqual([
      `wrote no guide pages because page intro/en writes ${join(dir, "site", "intro.md")}, outside ${join(dir, "docs")} where the manifest is; put the manifest in the top folder of the generated files`,
    ]);
  });

  it("prunes a manifest whose entries stay in the guide folders", () => {
    mkdirSync(join(dir, "docs", "en"), { recursive: true });
    const old = join(dir, "docs", "en", "old.md");
    writeFileSync(old, "old");
    writeManifest(join(dir, "docs", ".guides.json"), {
      schemaVersion: 1,
      pages: ["en/old.md"],
      shots: [],
    });
    const log: string[] = [];
    run(true, log);
    expect(existsSync(old)).toBe(false);
  });
});
