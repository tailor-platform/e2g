# Interactive tour

A guide rendered as a click-through tour instead of a Markdown page. The reader clicks the highlighted element on each screenshot to move on, picks a path where the flow branches, and sees the test the tour comes from beside it, with the current step's lines marked. On a phone, the tour shows screenshots taken on a phone.

Everything here is built on what e2g already gives `render`; nothing is specific to e2g:

- `image.regions` places the clickable areas over each screenshot.
- `guideVariant` takes every shot on desktop and on mobile, and `shot.images` gives the tour both, so it shows the one that fits the reader's screen.
- `block.location` points the code panel at the `guide.step` behind each screen.
- `page.meta` links pages at a branch: `next` on the page that branches, `parent` on each branch.

## Run it

From the repository root:

```sh
pnpm install
pnpm exec playwright install chromium
pnpm example:tour
```

Then open `examples/tour/tours/en/invite.html` in a browser. Make the window narrower than 640px to see the mobile screenshots.

## Files

| File                   | What it is                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `app.html`             | The app under test: a members page with an invite dialog, laid out for desktop and for phones.                                 |
| `tests/invite.spec.ts` | Three guide pages: the shared start, then one page per role. Each branch repeats the start without steps.                      |
| `tests/guides.d.ts`    | The locale, the variants and the meta of a page, registered with e2g.                                                          |
| `tour-output.ts`       | The `GuideOutput`: one tour stop per shot, with its images and the source lines of its step, written into the viewer.          |
| `viewer.html`          | The tour page itself: plain HTML, CSS and JavaScript, with light and dark themes. It shows the mobile images up to 640px wide. |
| `playwright.config.ts` | A desktop and a mobile project with screenshots on, and no highlight baked into them, since the tour draws its own.            |

## Notes

- Write each `guide.shot` before the action it shows, and `highlight` the element the reader acts on: the tour turns that element into the place to click.
- A branch is a page of its own, so a failing branch test leaves that page unwritten while the page that links to it is still written. Check for broken links in CI if you publish a tour.
- The code panel finds the end of a `guide.step(...)` call by matching parentheses outside strings and comments, which is enough for ordinary spec files.
