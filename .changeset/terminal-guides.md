---
"@tailor-platform/e2g": minor
---

Guides can now document command-line tools. Under Vitest, `guide.command` shows a command and its output in a step, and `guide.screen` takes the screen of an interactive session as an SVG that is also kept as text. `terminal.run` and `terminal.spawn` run a command in a pseudo-terminal, in a throwaway home directory that shows as `~`. `renderTerminal` turns raw terminal output into text and SVG without Vitest. Set up the guide projects with `guideProjects(locales)` and write the pages with `guidesReporter`, both from `@tailor-platform/e2g/vitest/reporter`; a run that may not include every guide writes nothing. `blocksToMarkdown` renders commands as `console` blocks and screens as images, or as `text` blocks with `{ screen: "text" }`. The pseudo-terminal comes from the optional peer dependency `@lydell/node-pty`. A project with its own extended `test` adds the fixtures with `.extend(guideFixtures)`. The `vitest` entries need Vitest 5 or later. The README has a "CLI guides" section.

Breaking changes:

- A step's `shots` are now `items`, which also hold commands and screens. A shot is `{ kind: "shot", name, alt, images }`, so filter on `kind` where you read a step's shots.
- The Playwright reporter's `shots.path(page, name, variant)` gets the file extension as a fourth argument, `ext`.
- Both reporters keep generated files under the manifest's directory. A page, screenshot or screen SVG outside it fails the run and nothing is written, so put the manifest in the top folder of the generated files. A manifest entry outside it is never deleted; it is dropped from the manifest with a warning.
