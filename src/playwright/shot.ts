import type { ElementHandle, Locator, Page, PageScreenshotOptions } from "@playwright/test";
import type { Region, Text } from "../types.js";
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
  hide?: Locator[];
  style?: string;
  highlightStyle?: string;
  padding?: number;
}

export interface TakeShotOptions {
  highlight: Locator[];
  crop?: Locator;
  mask?: Locator[];
  hide?: Locator[];
  highlightStyle: string;
  padding: number;
  style: string;
  screenshot: ScreenshotSettings;
}

type Rect = { x: number; y: number; width: number; height: number };

// In page coordinates, so a crop taken from the full page may lie off screen. boundingBox()
// is relative to the main frame's viewport, unlike getBoundingClientRect(), so an element
// in an iframe is placed where it shows on the page.
async function pageRect(l: Locator, scroll: { x: number; y: number }): Promise<Rect> {
  const box = await l.boundingBox();
  if (!box) throw new Error("guide.shot() could not measure an element; is it still on the page?");
  return { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height };
}

// the crop and the highlights together, so no outline is cut off
function paddedClip(rects: Rect[], padding: number): Rect {
  const left = Math.max(0, Math.min(...rects.map((r) => r.x)) - padding);
  const top = Math.max(0, Math.min(...rects.map((r) => r.y)) - padding);
  const right = Math.max(...rects.map((r) => r.x + r.width)) + padding;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Rounded so that subpixel layout differences between runs do not rewrite the page.
const fraction = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;

// The image's size comes from the PNG rather than the clip, since Playwright trims
// a clip that runs past the page, and fractions keep regions independent of the
// device scale and of the size the image is shown at.
function regionsIn(png: Buffer, cssPerPx: number, origin: { x: number; y: number }, rects: Rect[]) {
  const width = png.readUInt32BE(16) * cssPerPx;
  const height = png.readUInt32BE(20) * cssPerPx;
  return rects.map((r): Region => {
    const x = fraction((r.x - origin.x) / width);
    const y = fraction((r.y - origin.y) / height);
    return {
      x,
      y,
      width: fraction(fraction((r.x + r.width - origin.x) / width) - x),
      height: fraction(fraction((r.y + r.height - origin.y) / height) - y),
    };
  });
}

// Hidden through each element's own style, not a stylesheet: a page's CSP may
// block an injected <style>, a document's stylesheet does not reach shadow roots
// or frames, and the screenshot's style applies only after the crop is measured.
// A hide locator may match no element or several, unlike a highlight. The same
// elements are restored, in reverse so an element matched twice gets its own
// display back, even if the locators match other elements by then.
async function conceal(hide: Locator[]): Promise<() => Promise<void>> {
  // hide locators point at elements, which carry a style
  const handles = (
    await Promise.all(hide.map((l) => l.elementHandles()))
  ).flat() as ElementHandle<HTMLElement>[];
  const hidden: { handle: ElementHandle<HTMLElement>; display: string; styled: boolean }[] = [];
  const restore = async () => {
    for (const { handle, display, styled } of hidden.reverse()) {
      await handle.evaluate(
        (el, [display, styled]) => {
          el.style.display = display as string;
          // leave no empty style attribute on an element that had none
          if (!styled && el.getAttribute("style") === "") el.removeAttribute("style");
        },
        [display, styled] as const,
      );
    }
    await Promise.all(handles.map((handle) => handle.dispose()));
  };
  try {
    for (const handle of handles) {
      const before = await handle.evaluate((el) => {
        const styled = el.hasAttribute("style");
        const { style } = el;
        const display = style.display;
        style.display = "none";
        return { display, styled };
      });
      hidden.push({ handle, ...before });
    }
  } catch (error) {
    await restore();
    throw error;
  }
  return restore;
}

export interface Capture {
  png: Buffer;
  regions: Region[];
}

export async function takeShot(page: Page, opts: TakeShotOptions): Promise<Capture> {
  const { highlight, crop, mask, hide = [] } = opts;
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
  let restore: (() => Promise<void>) | undefined;
  try {
    restore = await conceal(hide);
    // measured with the hidden elements gone, as the screenshot sees the page
    const view = await page.evaluate(() => ({ x: scrollX, y: scrollY, dpr: devicePixelRatio }));
    const rects = await Promise.all(highlight.map((l) => pageRect(l, view)));
    const cssPerPx = opts.screenshot.scale === "css" ? 1 : 1 / view.dpr;
    const clip = crop && paddedClip([await pageRect(crop, view), ...rects], opts.padding);
    const png = clip
      ? await page.screenshot({ ...options, fullPage: true, clip })
      : await page.screenshot(options);
    const regions = regionsIn(png, cssPerPx, clip ?? view, rects);
    // the image would show neither the element nor its outline
    const outside = regions.findIndex((r) => r.width === 0 || r.height === 0);
    if (outside >= 0)
      throw new Error(
        `guide.shot() highlight ${outside + 1} is outside the shot; scroll it into view or crop to it`,
      );
    return { png, regions };
  } finally {
    await restore?.();
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
): Promise<Capture> {
  const { screenshot, ...settings } = { ...SHOT_DEFAULTS, ...defined(guideShot) };
  return takeShot(page, {
    highlight: [opts.highlight ?? []].flat(),
    crop: opts.crop,
    mask: opts.mask,
    hide: opts.hide,
    highlightStyle: opts.highlightStyle ?? settings.highlight,
    padding: opts.padding ?? settings.padding,
    style: [settings.style, opts.style].filter(Boolean).join("\n"),
    screenshot: { ...SHOT_DEFAULTS.screenshot, ...defined(screenshot) },
  });
}
