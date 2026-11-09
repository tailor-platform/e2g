// guides-output.ts
import { blocksToMarkdown } from "@tailor-platform/e2g/markdown";
import type { GuideOutput } from "@tailor-platform/e2g/playwright/reporter";
import { stringify } from "yaml";

export const output: GuideOutput = {
  path: (page) => `docs/${page.locale}/guides/${page.slug}.md`,
  render: (page, { image }) => {
    const frontMatter = {
      title: page.meta.title[page.locale],
      description: page.meta.description[page.locale],
    };
    return [
      `---\n${stringify(frontMatter)}---`,
      `<!-- Generated from tests/${page.source}. Edit the test, not this page. -->`,
      blocksToMarkdown(page.blocks, image),
    ].join("\n\n");
  },
};
