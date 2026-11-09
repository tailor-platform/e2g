import { type Page } from "@playwright/test";

export type Where = "edge" | "fringe" | "flat" | "all";

export const SAMPLE_PAGE = `
    <body style="margin:0;font:16px sans-serif;background:#fff;color:#111">
      <header style="padding:16px;border-bottom:1px solid #ccc"><h1 style="margin:0">Dashboard</h1></header>
      <main style="padding:24px;display:flex;gap:16px;flex-wrap:wrap">
        <button style="padding:8px 16px;border:2px solid #222;border-radius:12px;background:#fff">Save changes</button>
        <button style="padding:8px 16px;border:2px solid #06c;border-radius:24px;background:#06c;color:#fff">Publish</button>
        <div style="width:200px;padding:16px;border:1px solid #888;border-radius:8px;box-shadow:0 2px 6px #0004">
          <p style="margin:0">Rounded card with some text inside it.</p>
        </div>
      </main>
    </body>`;

// re-encodes a png with `count` pixels shifted by `by` in every colour channel: pixels on a strong edge
// (as anti-aliasing noise falls), pixels one off a strong edge (as a glyph's fringe), pixels in a flat
// area with no edge within 2, or every pixel
export async function perturbed(
  page: Page,
  png: Buffer,
  where: Where,
  by: number,
  count = Infinity,
): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ src, where, by, count }) => {
      const blob = new Blob([Uint8Array.from(atob(src), (c) => c.charCodeAt(0))]);
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      const d = img.data;
      const w = bmp.width;
      const h = bmp.height;
      const contrast = (i: number, reach: number) => {
        const x = (i / 4) % w;
        const y = Math.floor(i / 4 / w);
        let m = 0;
        for (let dy = -reach; dy <= reach; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
            const j = i + (dy * w + dx) * 4;
            for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(d[i + c] - d[j + c]));
          }
        return m;
      };
      // farther apart than the 2 pixels sameScreen looks around one, in both directions
      const apart = (p: number, i: number) =>
        Math.abs(((p / 4) % w) - ((i / 4) % w)) > 4 ||
        Math.abs(Math.floor(p / 4 / w) - Math.floor(i / 4 / w)) > 4;
      const fits = (i: number) => {
        if (where === "all") return true;
        if (where === "edge") return contrast(i, 1) >= 96;
        if (where === "flat") return contrast(i, 2) === 0;
        return contrast(i, 1) === 0 && contrast(i, 2) >= 96;
      };
      const picked: number[] = [];
      for (let i = w * 4 * 2; i < d.length && picked.length < count; i += 4) {
        if (fits(i) && (where === "all" || picked.every((p) => apart(p, i)))) picked.push(i);
      }
      for (const i of picked)
        for (let c = 0; c < 3; c++) d[i + c] = d[i + c] < 128 ? d[i + c] + by : d[i + c] - by;
      ctx.putImageData(img, 0, 0);
      const out = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      let bin = "";
      for (let i = 0; i < out.length; i += 0x8000)
        bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    {
      src: png.toString("base64"),
      where,
      by,
      count: Number.isFinite(count) ? count : Number.MAX_SAFE_INTEGER,
    },
  );
  return Buffer.from(b64, "base64");
}
