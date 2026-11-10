import type { ElementHandle, Locator, Page, PageScreenshotOptions } from "@playwright/test";
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

export async function takeShot(page: Page, opts: TakeShotOptions): Promise<Buffer> {
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
    return crop
      ? await page.screenshot({
          ...options,
          fullPage: true,
          clip: await paddedClip([crop, ...highlight], opts.padding),
        })
      : await page.screenshot(options);
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
): Promise<Buffer> {
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
