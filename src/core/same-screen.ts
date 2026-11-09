import { PNG } from "pngjs";

// Chromium does not rasterize anti-aliased edges bit for bit the same on every page load, even with an
// identical layout. Measured over nine runs of every guide: rounded corners and shadows move by 1-2
// levels along their edges (up to 56 pixels), and the arc ends of round buttons by up to 20 levels on
// at most 6 pixels. In the Linux image a glyph's fringe also reaches one pixel past it, moving by up
// to 7 levels. So a shot is the same screen, and the committed file is kept, when no pixel moves by
// more than 32 levels and at most 12 move by more than 2, each of those near an edge in both shots (a
// pixel at most 2 away that is at least 16 levels apart), since flat areas are never noisy. Anything
// else rewrites the file; deleting a PNG always re-takes it.
const FAINT = 2;
const NOISE_LEVEL = 32;
export const NOISE_PIXELS = 12;
const EDGE = 16;
const REACH = 2;

export function sameScreen(a: Buffer, b: Buffer): boolean {
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return false;
  const { width, height } = x;
  const delta = (p: Uint8Array, q: Uint8Array, i: number, j: number) => {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(p[i + c]! - q[j + c]!));
    return d;
  };
  const onEdge = (img: Uint8Array, px: number, py: number) => {
    for (let dy = -REACH; dy <= REACH; dy++)
      for (let dx = -REACH; dx <= REACH; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height)
          if (delta(img, img, (py * width + px) * 4, (ny * width + nx) * 4) >= EDGE) return true;
      }
    return false;
  };
  let differing = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    const d = delta(x.data, y.data, i, i);
    if (d <= FAINT) continue;
    if (d > NOISE_LEVEL || ++differing > NOISE_PIXELS) return false;
    const px = (i / 4) % width;
    const py = Math.floor(i / 4 / width);
    if (!onEdge(x.data, px, py) || !onEdge(y.data, px, py)) return false;
  }
  return true;
}
