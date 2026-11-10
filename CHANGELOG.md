# @tailor-platform/e2g

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
