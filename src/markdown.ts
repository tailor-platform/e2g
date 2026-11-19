import type { Block, Item, Shot, Variant } from "./types.js";

export interface MarkdownOptions {
  /** The media query of each variant a `<source>` is for; the one variant left out is the `<img>`. */
  media?: Partial<Record<Variant, string>>;
  /** How a terminal screen appears: as its image (default) or as a `text` block of what it showed. */
  screen?: "image" | "text";
}

const attr = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function image(shot: Shot, options: MarkdownOptions, indent: string): string {
  const [only, ...rest] = shot.images;
  if (only && rest.length === 0) return `${indent}![${shot.alt}](${only.src})`;
  const media = (options.media ?? {}) as Record<string, string | undefined>;
  const sources = shot.images.filter((i) => i.variant !== undefined && media[i.variant]);
  const fallback = shot.images.filter((i) => !sources.includes(i));
  if (fallback.length !== 1)
    throw new Error(
      `shot "${shot.name}" has images for variants ${shot.images.map((i) => i.variant).join(", ")}; give media for all but one of them`,
    );
  return [
    "<picture>",
    ...sources.map((i) => `  <source media="${attr(media[i.variant!]!)}" srcset="${attr(i.src)}">`),
    `  <img src="${attr(fallback[0]!.src)}" alt="${attr(shot.alt)}">`,
    "</picture>",
  ]
    .map((line) => indent + line)
    .join("\n");
}

// a line of the content that starts with backticks could close a shorter fence
const fence = (info: string, lines: string[], indent: string) => {
  const longest = Math.max(0, ...lines.map((line) => /^\s*(`*)/.exec(line)![1]!.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return [
    `${indent}${ticks}${info}`,
    ...lines.map((line) => (line ? indent + line : line)),
    `${indent}${ticks}`,
  ].join("\n");
};

function item(it: Item, options: MarkdownOptions, indent: string): string {
  if (it.kind === "shot") return image(it, options, indent);
  if (it.kind === "command")
    return fence(
      "console",
      [`$ ${it.command}`, ...(it.output ? it.output.split("\n") : [])],
      indent,
    );
  if (options.screen === "text") return fence("text", it.text.split("\n"), indent);
  return `${indent}![${it.alt}](${it.image.src})`;
}

export function blocksToMarkdown(blocks: Block[], options: MarkdownOptions = {}): string {
  const parts: string[] = [];
  let n = 0;
  for (const block of blocks) {
    if (block.kind === "say") {
      if (block.text.startsWith("#")) n = 0;
      parts.push(block.text);
    } else {
      n += 1;
      const marker = `${n}. `;
      const indent = " ".repeat(marker.length);
      const items = block.items.map((it) => item(it, options, indent));
      parts.push([`${marker}${block.text}`, ...items].join("\n\n"));
    }
  }
  return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
}
