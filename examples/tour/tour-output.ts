import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Block, Page } from "@tailor-platform/e2g";
import type { GuideOutput } from "@tailor-platform/e2g/playwright/reporter";

// block locations and page.source are relative to the rootDir: the testDir of this config
const ROOT = fileURLToPath(new URL("./tests/", import.meta.url));
const VIEWER = readFileSync(new URL("./viewer.html", import.meta.url), "utf8");

interface Code {
  file: string;
  start: number;
  end: number;
  /** The line of the guide.shot that took the screen. */
  shot?: number;
}

// the line where the call starting at (line, column) closes, skipping strings and comments
function callEnd(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  let i = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + column - 1;
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i);
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i) + 1;
    else if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) break;
  }
  return text.slice(0, i).split("\n").length;
}

function codeOf(block: Block, files: Record<string, string>, shot?: string): Code | undefined {
  if (!block.location) return undefined;
  const { file, line, column } = block.location;
  const text = (files[file] ??= readFileSync(join(ROOT, file), "utf8"));
  const end = callEnd(text, line, column);
  const lines = text.split("\n");
  const at = shot
    ? lines.findIndex((l, k) => k + 1 >= line && k + 1 <= end && l.includes(`"${shot}"`))
    : -1;
  return { file, start: line, end, ...(at >= 0 ? { shot: at + 1 } : {}) };
}

// one stop per shot; a step without shots and a paragraph are stops without an image
function stops(
  page: Page,
  image: (shot: { name: string }) => string,
  files: Record<string, string>,
) {
  let n = 0;
  return page.blocks.flatMap((block) => {
    if (block.kind === "say")
      return [{ kind: "say", text: block.text, code: codeOf(block, files) }];
    n += 1;
    if (block.shots.length === 0)
      return [{ kind: "step", n, text: block.text, code: codeOf(block, files) }];
    return block.shots.map((shot) => ({
      kind: "step",
      n,
      text: block.text,
      src: image(shot),
      alt: shot.alt,
      regions: shot.regions,
      code: codeOf(block, files, shot.name),
    }));
  });
}

const escapeHtml = (text: string) => text.replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;"));

export const output: GuideOutput = {
  path: (page) => `tours/${page.locale}/${page.slug}.html`,
  render: (page, { image }) => {
    const { title, next = [], parent } = page.meta;
    const files: Record<string, string> = {
      [page.source]: readFileSync(join(ROOT, page.source), "utf8"),
    };
    // the pages of one locale sit side by side, so a branch links to its page by slug
    const data = JSON.stringify({
      title,
      source: page.source,
      stops: stops(page, image, files),
      files,
      next: next.map((branch) => ({ ...branch, href: `${branch.slug}.html` })),
      parent: parent && { title: parent.title, href: `${parent.slug}.html#choose` },
    });
    return VIEWER.replace("__TITLE__", () => escapeHtml(title)).replace("__DATA__", () =>
      data.replace(/</g, "\\u003c"),
    );
  },
};
