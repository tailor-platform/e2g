import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { collectPages, type ExpectedTest, type TestOutcome } from "../src/core/collect.js";
import type { Block, GuideRecord } from "../src/types.js";

const ROOT = "/repo";
const png = (s: string) => Buffer.from(s);

function test_(id: string, over: Partial<ExpectedTest> = {}): ExpectedTest {
  return {
    id,
    slug: "intro",
    locale: "en",
    locales: ["en"],
    file: "/repo/e2e/intro.spec.ts",
    line: 1,
    column: 1,
    ...over,
  };
}

function passed(blocks: Block[], opts: { meta?: unknown; shots?: string[] } = {}): TestOutcome {
  const record: GuideRecord<unknown> = {
    schemaVersion: 1,
    slug: "intro",
    locale: "en",
    meta: opts.meta ?? { title: "Intro" },
    blocks,
  };
  const names =
    opts.shots ?? blocks.flatMap((b) => (b.kind === "step" ? b.shots.map((s) => s.name) : []));
  return { ok: true, record, shots: new Map(names.map((n) => [n, png(n)])) };
}

const say = (text: string): Block => ({ kind: "say", text });
const step = (text: string, name?: string): Block => ({
  kind: "step",
  text,
  shots: name ? [{ name, alt: name }] : [],
});

describe("collectPages", () => {
  it("joins blocks in source order", () => {
    const expected = [
      test_("c", { line: 9, column: 1 }),
      test_("b", { line: 3, column: 7 }),
      test_("a", { line: 3, column: 2 }),
    ];
    const results = new Map([
      ["a", passed([say("A")])],
      ["b", passed([say("B")])],
      ["c", passed([say("C")])],
    ]);
    const { pages, errors, incomplete } = collectPages(expected, results, ROOT);
    expect(errors).toEqual([]);
    expect(incomplete).toEqual([]);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.blocks).toEqual([say("A"), say("B"), say("C")]);
  });

  it("meta comes from the first test", () => {
    const expected = [test_("b", { line: 5 }), test_("a", { line: 1 })];
    const results = new Map([
      ["a", passed([say("A")], { meta: { title: "T" } })],
      ["b", passed([say("B")], { meta: { title: "T" } })],
    ]);
    const { pages } = collectPages(expected, results, ROOT);
    expect(pages[0]!.meta).toEqual({ title: "T" });
    expect(pages[0]!.slug).toBe("intro");
    expect(pages[0]!.locale).toBe("en");
  });

  it("differing meta is an error", () => {
    const expected = [test_("a", { line: 1 }), test_("b", { line: 5 })];
    const results = new Map([
      ["a", passed([say("A")], { meta: { title: "One" } })],
      ["b", passed([say("B")], { meta: { title: "Two" } })],
    ]);
    const { pages, errors } = collectPages(expected, results, ROOT);
    expect(pages).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("intro/en");
    expect(errors[0]).toContain("meta");
  });

  it("duplicate shot name in a page is an error", () => {
    const expected = [test_("a", { line: 1 }), test_("b", { line: 5 })];
    const results = new Map([
      ["a", passed([step("Open", "menu")])],
      ["b", passed([step("Again", "menu")])],
    ]);
    const { pages, errors } = collectPages(expected, results, ROOT);
    expect(pages).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("intro/en");
    expect(errors[0]).toContain("menu");
  });

  it("several spec files is an error", () => {
    const expected = [
      test_("a", { file: "/repo/e2e/one.spec.ts" }),
      test_("b", { file: "/repo/e2e/two.spec.ts" }),
    ];
    const results = new Map([
      ["a", passed([say("A")])],
      ["b", passed([say("B")])],
    ]);
    const { pages, errors } = collectPages(expected, results, ROOT);
    expect(pages).toEqual([]);
    expect(errors).toEqual([
      "page intro/en is built from several spec files (e2e/one.spec.ts, e2e/two.spec.ts)",
    ]);
  });

  it("a failed or skipped test makes the page incomplete", () => {
    const expected = [
      test_("a", { line: 1 }),
      test_("b", { line: 5 }),
      test_("c", { slug: "other", line: 1, file: "/repo/e2e/other.spec.ts" }),
    ];
    const results = new Map<string, TestOutcome>([
      ["a", passed([say("A")])],
      ["b", { ...passed([say("B")]), ok: false }],
    ]);
    const { pages, incomplete, errors } = collectPages(expected, results, ROOT);
    expect(errors).toEqual([]);
    expect(pages).toEqual([]);
    expect(incomplete).toHaveLength(2);
    expect(incomplete[0]).toMatch(/^intro\/en /);
    expect(incomplete[1]).toMatch(/^other\/en /);
  });

  it("flaky uses the last result", () => {
    // the caller keeps only the last result per test, so a flaky test arrives as one passing outcome
    const results = new Map([["a", passed([step("Open", "menu")])]]);
    results.get("a")!.shots.set("menu", png("retry"));
    const { pages } = collectPages([test_("a")], results, ROOT);
    expect(pages[0]!.shots.get("menu")).toEqual(png("retry"));
  });

  it("a page missing a locale is incomplete", () => {
    const expected = [test_("a", { locale: "en", locales: ["en", "ja"] })];
    const results = new Map([["a", passed([say("A")])]]);
    const { pages, incomplete } = collectPages(expected, results, ROOT);
    expect(pages.map((p) => `${p.slug}/${p.locale}`)).toEqual(["intro/en"]);
    expect(incomplete).toEqual(["intro/ja (no test of it ran for locale ja)"]);
  });

  it("a page without shot attachments is skipped", () => {
    const results = new Map([["a", passed([step("Open", "menu")], { shots: [] })]]);
    const { pages, incomplete, errors } = collectPages([test_("a")], results, ROOT);
    expect(errors).toEqual([]);
    expect(pages).toEqual([]);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]).toMatch(/^intro\/en /);
    expect(incomplete[0]).toContain("guideShots");
  });

  it("an unreadable guide attachment makes the page incomplete", () => {
    const results = new Map([
      ["a", { ...passed([say("A")]), problem: "a shot attachment could not be read" }],
    ]);
    const { pages, incomplete, errors } = collectPages([test_("a")], results, ROOT);
    expect(errors).toEqual([]);
    expect(pages).toEqual([]);
    expect(incomplete).toEqual(["intro/en (a shot attachment could not be read)"]);
  });

  it("a step without a shot needs no attachment", () => {
    const results = new Map([["a", passed([step("Just read")], { shots: [] })]]);
    const { pages, incomplete } = collectPages([test_("a")], results, ROOT);
    expect(incomplete).toEqual([]);
    expect(pages[0]!.blocks).toEqual([step("Just read")]);
  });

  it("source is relative to rootDir with /", () => {
    const results = new Map([["a", passed([say("A")])]]);
    const posix = collectPages(
      [test_("a", { file: "/repo/e2e/deep/intro.spec.ts" })],
      results,
      ROOT,
    );
    expect(posix.pages[0]!.source).toBe("e2e/deep/intro.spec.ts");
    const windows = collectPages(
      [test_("a", { file: win32.join("C:\\repo", "e2e", "deep", "intro.spec.ts") })],
      results,
      "C:\\repo",
    );
    expect(windows.pages[0]!.source).toBe("e2e/deep/intro.spec.ts");
  });
});
