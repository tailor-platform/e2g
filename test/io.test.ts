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
import { apply, commit, readFile, readManifest, writeManifest } from "../src/core/io.js";

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
