import { blocksToMarkdown } from "@tailor-platform/e2g/markdown";
import type { GuideOutput } from "@tailor-platform/e2g/vitest/reporter";

export const output: GuideOutput = {
  path: (page) => `docs/${page.locale}/${page.slug}.md`,
  render: (page) => `# ${page.meta.title[page.locale]}\n\n${blocksToMarkdown(page.blocks)}`,
};
