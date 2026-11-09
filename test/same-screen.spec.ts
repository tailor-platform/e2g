import { expect, test, type Page } from "@playwright/test";
import { NOISE_PIXELS, sameScreen } from "../src/core/same-screen.ts";
import { perturbed, SAMPLE_PAGE, type Where } from "./perturb.ts";

test("tells anti-aliasing noise from a changed screen", async ({ page }) => {
  await page.setContent(SAMPLE_PAGE);
  const shot = await page.screenshot();
  const same = async (where: Where, by: number, count?: number) =>
    sameScreen(shot, await perturbed(page, shot, where, by, count));

  // as measured: every edge 1-2 levels, a few corner pixels up to 20, and a glyph's fringe up to 7
  expect(await same("all", 2)).toBe(true);
  expect(await same("edge", 20, NOISE_PIXELS)).toBe(true);
  expect(await same("fringe", 7, 3)).toBe(true);
  expect(sameScreen(shot, shot)).toBe(true);

  expect(await same("all", 3)).toBe(false);
  expect(await same("edge", 20, NOISE_PIXELS + 1)).toBe(false);
  expect(await same("flat", 20, 1)).toBe(false);
  expect(await same("edge", 33, 1)).toBe(false);
});

test("a screenshot of a different size is another screen", async ({ page }) => {
  await page.setContent(SAMPLE_PAGE);
  const shot = await page.screenshot();
  await page.setViewportSize({ width: 500, height: 300 });
  expect(sameScreen(shot, await page.screenshot())).toBe(false);
});

// the algorithm as it ran in the page, decoding with createImageBitmap
async function browserVerdict(page: Page, a: Buffer, b: Buffer): Promise<boolean> {
  return page.evaluate(
    async ({ a, b, faint, level, pixels, edge, reach }) => {
      const decode = async (src: string) => {
        const bytes = Uint8Array.from(atob(src), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes]), {
          colorSpaceConversion: "none",
          premultiplyAlpha: "none",
        });
        const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const [x, y] = await Promise.all([decode(a), decode(b)]);
      if (x.width !== y.width || x.height !== y.height) return false;
      const { width, height } = x;
      const delta = (p: Uint8ClampedArray, q: Uint8ClampedArray, i: number, j: number) => {
        let d = 0;
        for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(p[i + c] - q[j + c]));
        return d;
      };
      const onEdge = (img: Uint8ClampedArray, px: number, py: number) => {
        for (let dy = -reach; dy <= reach; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height)
              if (delta(img, img, (py * width + px) * 4, (ny * width + nx) * 4) >= edge)
                return true;
          }
        return false;
      };
      let differing = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const d = delta(x.data, y.data, i, i);
        if (d <= faint) continue;
        if (d > level || ++differing > pixels) return false;
        const px = (i / 4) % width;
        const py = Math.floor(i / 4 / width);
        if (!onEdge(x.data, px, py) || !onEdge(y.data, px, py)) return false;
      }
      return true;
    },
    {
      a: a.toString("base64"),
      b: b.toString("base64"),
      faint: 2,
      level: 32,
      pixels: NOISE_PIXELS,
      edge: 16,
      reach: 2,
    },
  );
}

test("matches the browser decoder on real shots", async ({ page }) => {
  await page.setContent(SAMPLE_PAGE);
  const shot = await page.screenshot();
  const cases: [Where, number, number?][] = [
    ["all", 2],
    ["all", 3],
    ["edge", 20, NOISE_PIXELS],
    ["edge", 20, NOISE_PIXELS + 1],
    ["edge", 33, 1],
    ["fringe", 7, 3],
    ["fringe", 40, 3],
    ["flat", 20, 1],
  ];
  const verdicts = new Set<boolean>();
  for (const [where, by, count] of cases) {
    const other = await perturbed(page, shot, where, by, count);
    const expected = await browserVerdict(page, shot, other);
    verdicts.add(expected);
    expect(sameScreen(shot, other), `${where} ${by} ${count}`).toBe(expected);
  }
  expect(verdicts.size).toBe(2);
});
