import type { Block, Shot, Variant } from "./types.js";

export interface MarkdownOptions {
  /** The media query of each variant a `<source>` is for; the one variant left out is the `<img>`. */
  media?: Partial<Record<Variant, string>>;
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
      const images = block.shots.map((shot) => image(shot, options, indent));
      parts.push([`${marker}${block.text}`, ...images].join("\n\n"));
    }
  }
  return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
}
