import type { Block } from "@tailor-platform/e2g";
import type { GuideOutput } from "@tailor-platform/e2g/vitest/reporter";

function body(blocks: Block[]): string[] {
  let n = 0;
  return blocks.map((block) => {
    if (block.kind === "say") return block.text;
    n += 1;
    const items = block.items.map((item) => {
      if (item.kind === "command")
        return ["```console", `$ ${item.command}`, item.output, "```"].join("\n");
      if (item.kind === "screen") return `![${item.alt}](${item.image.src})`;
      return `![${item.alt}](${item.images[0]!.src})`;
    });
    return [`${n}. ${block.text}`, ...items].join("\n\n");
  });
}

export const output: GuideOutput = {
  path: (page) => `site/docs/${page.locale}/${page.slug}.md`,
  render: (page) =>
    `${[`<!-- generated from ${page.source} -->`, `# ${page.meta.title[page.locale]}`, ...body(page.blocks)].join("\n\n")}\n`,
};
