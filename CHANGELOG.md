# @tailor-platform/e2g

## 0.3.0

### Minor Changes

- [#12](https://github.com/tailor-platform/e2g/pull/12) [`5722a4e`](https://github.com/tailor-platform/e2g/commit/5722a4e3da2149431cf1066f6dc385e478968abb) Thanks [@jackchuka](https://github.com/jackchuka)! - Each shot in a page now has `regions`: the boxes of its `highlight` elements in the image, as fractions of the image's width and height, in the order the locators were given. They are measured with the `hide` elements gone, clipped to the image and rounded to 4 decimals, so they do not depend on the device scale or on the size the image is shown at. Use them to place markers or tooltips over the screenshots, such as for a step-by-step tour; the README has a recipe. A highlight entirely outside the image now fails `guide.shot`, since the image would show neither the element nor its outline.

  A crop or highlight inside an iframe is now measured where it shows on the page, rather than at its position within the frame.

  Each `step` and `say` block now has a `location`: where its `guide.step` or `guide.say` was called, with the file relative to the config's `rootDir`. Use it to link a page to its test or to show the test's code beside it.

  `Shot` has the new required `regions` field, and `Region` and `SourceLocation` are exported.

## 0.2.0

### Minor Changes

- [#7](https://github.com/tailor-platform/e2g/pull/7) [`9660e69`](https://github.com/tailor-platform/e2g/commit/9660e6900a3ce0020751196c0ecdd2582e6ea168) Thanks [@jackchuka](https://github.com/jackchuka)! - `guide.shot` takes `hide`: locators whose elements are left out of the shot, such as rows that other tests created. Each matched element's inline `display` is set to `none` while the shot is taken and put back afterwards, so it works under a strict CSP and inside shadow roots and frames, and the crop is measured with the elements gone. A locator may match no element or several. A page rule with `display: ... !important` wins over it; hide such an element with `style`.

  The README has a new recipe on keeping shots stable between runs.

## 0.1.1

### Patch Changes

- [#3](https://github.com/tailor-platform/e2g/pull/3) [`82ec3b4`](https://github.com/tailor-platform/e2g/commit/82ec3b4a3a682a221e129d0ae31e9cf0a2799fab) Thanks [@jackchuka](https://github.com/jackchuka)! - README: install from npm.

## 0.1.0

### Minor Changes

- [`caa9fab`](https://github.com/tailor-platform/e2g/commit/caa9fab739f08f6eee8acb1c4f1a6d9b81d7e4ac) Thanks [@jackchuka](https://github.com/jackchuka)! - First release: generate localized user guide pages with screenshots from Playwright e2e tests.
