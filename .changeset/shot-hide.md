---
"@tailor-platform/e2g": minor
---

`guide.shot` takes `hide`: locators whose elements are left out of the shot with `display: none`, such as rows that other tests created. A locator may match no element or several, and the crop is measured with them hidden. The README has a new recipe on keeping shots stable between runs.
