---
"@tailor-platform/e2g": minor
---

Guides can now show a screenshot per variant, such as desktop and mobile, or light and dark. Set `use.guideVariant` on a project, give every locale a project for each variant, and register the variants as `Register["variants"]`. The variants of a locale share one page, whose shots carry one image per variant; `blocksToMarkdown(blocks, { media })` renders them as a `<picture>` that shows the image for the reader's screen. A page is written only when every variant passed, and the run fails when the variants differ in steps, paragraphs, shot names, `alt`s or `meta`. A test can read the `guideVariant` fixture to do what only one layout needs inside a `test.step`, which stays out of the page. The README has a recipe.

Breaking changes:

- `render(page)` no longer takes an `image()` callback. Each shot has `images: { variant?, src, regions }[]` in place of `regions`, with `src` relative to the page's directory.
- `blocksToMarkdown(blocks, options?)` takes options in place of the `image` callback.
- `output.path(page)` and `shots.path(page, name, variant)` get the page without `blocks` (`PageInfo`). `shots.path` also gets the shot's variant.
