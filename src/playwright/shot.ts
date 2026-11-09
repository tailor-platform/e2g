import type { Locator, Page, PageScreenshotOptions } from "@playwright/test";
import type { Text } from "../types.js";
import { SHOT_DEFAULTS, type GuideShotSettings } from "./use.js";

const HIGHLIGHT = "data-guides-highlight";

export type ScreenshotSettings = Omit<
  PageScreenshotOptions,
  "path" | "clip" | "fullPage" | "style" | "mask" | "type" | "quality"
>;

export interface ShotOptions {
  alt: Text;
  /** The page to shoot, when it is not the test's `page`. */
  page?: Page;
  highlight?: Locator | Locator[];
  crop?: Locator;
  mask?: Locator[];
  style?: string;
  highlightStyle?: string;
  padding?: number;
}

export interface TakeShotOptions {
  highlight: Locator[];
  crop?: Locator;
  mask?: Locator[];
  highlightStyle: string;
  padding: number;
  style: string;
  screenshot: ScreenshotSettings;
}

// page coordinates of the crop and the highlights together, so no outline is cut off
async function paddedClip(boxes: Locator[], padding: number) {
  const rects = await Promise.all(
    boxes.map((l) =>
      l.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
      }),
    ),
  );
  const left = Math.max(0, Math.min(...rects.map((r) => r.x)) - padding);
  const top = Math.max(0, Math.min(...rects.map((r) => r.y)) - padding);
  const right = Math.max(...rects.map((r) => r.x + r.w)) + padding;
  const bottom = Math.max(...rects.map((r) => r.y + r.h)) + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export async function takeShot(page: Page, opts: TakeShotOptions): Promise<Buffer> {
  const { highlight, crop, mask } = opts;
  const options: PageScreenshotOptions = {
    ...opts.screenshot,
    mask,
    style: [`[${HIGHLIGHT}]{${opts.highlightStyle}}`, opts.style].filter(Boolean).join("\n"),
  };
  const mark = (on: boolean) =>
    Promise.all(
      highlight.map((l) =>
        l.evaluate(
          (el, [name, on]) => el.toggleAttribute(name as string, on as boolean),
          [HIGHLIGHT, on],
        ),
      ),
    );

  await mark(true);
  try {
    return crop
      ? await page.screenshot({
          ...options,
          fullPage: true,
          clip: await paddedClip([crop, ...highlight], opts.padding),
        })
      : await page.screenshot(options);
  } finally {
    await mark(false);
  }
}

// a key set to undefined is left out, so it keeps the default under it
const defined = <T extends object>(value: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

// a shot's own options over the project's guideShot settings over the defaults
export function captureShot(
  page: Page,
  opts: Omit<ShotOptions, "alt" | "page">,
  guideShot: GuideShotSettings = {},
): Promise<Buffer> {
  const { screenshot, ...settings } = { ...SHOT_DEFAULTS, ...defined(guideShot) };
  return takeShot(page, {
    highlight: [opts.highlight ?? []].flat(),
    crop: opts.crop,
    mask: opts.mask,
    highlightStyle: opts.highlightStyle ?? settings.highlight,
    padding: opts.padding ?? settings.padding,
    style: [settings.style, opts.style].filter(Boolean).join("\n"),
    screenshot: { ...SHOT_DEFAULTS.screenshot, ...defined(screenshot) },
  });
}
