import type { Block } from "./types.js";

export function blocksToMarkdown(
  blocks: Block[],
  image: (shot: { name: string }) => string,
): string {
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
      const images = block.shots.map((shot) => `${indent}![${shot.alt}](${image(shot)})`);
      parts.push([`${marker}${block.text}`, ...images].join("\n\n"));
    }
  }
  return parts.length === 0 ? "" : `${parts.join("\n\n")}\n`;
}
