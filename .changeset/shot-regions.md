---
"@tailor-platform/e2g": minor
---

Each shot in a page now has `regions`: the boxes of its `highlight` elements in the image, as fractions of the image's width and height, in the order the locators were given. They are measured with the `hide` elements gone, clipped to the image and rounded to 4 decimals, so they do not depend on the device scale or on the size the image is shown at. Use them to place markers or tooltips over the screenshots, such as for a step-by-step tour; the README has a recipe. A highlight entirely outside the image now fails `guide.shot`, since the image would show neither the element nor its outline.

A crop or highlight inside an iframe is now measured where it shows on the page, rather than at its position within the frame.

Each `step` and `say` block now has a `location`: where its `guide.step` or `guide.say` was called, with the file relative to the config's `rootDir`. Use it to link a page to its test or to show the test's code beside it.

`Shot` has the new required `regions` field, and `Region` and `SourceLocation` are exported.
