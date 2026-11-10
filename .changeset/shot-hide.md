---
"@tailor-platform/e2g": minor
---

`guide.shot` takes `hide`: locators whose elements are left out of the shot, such as rows that other tests created. Each matched element's inline `display` is set to `none` while the shot is taken and put back afterwards, so it works under a strict CSP and inside shadow roots and frames, and the crop is measured with the elements gone. A locator may match no element or several. A page rule with `display: ... !important` wins over it; hide such an element with `style`.

The README has a new recipe on keeping shots stable between runs.
