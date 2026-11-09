import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const blocks = [...readme.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((m) => m[1]!);
// the new side of a diff: its context and added lines
const diffs = [...readme.matchAll(/^```diff\n([\s\S]*?)^```$/gm)].map((m) =>
  m[1]!
    .split("\n")
    .filter((line) => !line.startsWith("-"))
    .map((line) => line.slice(1))
    .join("\n"),
);

// the README's examples live in test/readme, where `pnpm typecheck` covers them
const sources = [
  ...globSync("test/readme/**/*.ts", { cwd: root }),
  ...globSync("src/**/*.ts", { cwd: root }),
].map((file) => readFileSync(join(root, file), "utf8"));

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim().replace(/^export /, ""))
    .filter(Boolean);

function appearsIn(chunk: string, source: string): boolean {
  const want = lines(chunk);
  const have = lines(source);
  return have.some((_, i) => want.every((line, j) => have[i + j] === line));
}

describe("README", () => {
  it("has TypeScript examples", () => {
    expect(blocks.length).toBeGreaterThan(5);
  });

  for (const diff of diffs) {
    it(`has a checked diff: ${lines(diff)[0]}`, () => {
      expect(sources.some((source) => appearsIn(diff, source))).toBe(true);
    });
  }

  for (const block of blocks) {
    const file = /^\/\/ (\S+\.ts)\n/.exec(block)?.[1];
    if (file) {
      it(`shows ${file} as it is in test/readme`, () => {
        expect(block).toBe(readFileSync(join(root, "test/readme", file), "utf8"));
      });
      continue;
    }
    for (const chunk of block.split(/\n\s*\n/).filter((c) => c.trim())) {
      it(`has a checked snippet: ${lines(chunk)[0]}`, () => {
        expect(sources.some((source) => appearsIn(chunk, source))).toBe(true);
      });
    }
  }
});
