import type { ScreenshotSettings } from "./shot.js";
import type { Locale, Variant } from "../types.js";

export interface GuideShotSettings {
  highlight?: string;
  padding?: number;
  style?: string;
  screenshot?: ScreenshotSettings;
}

// the options of guideTest, set in a project's `use`; type a config with defineConfig<GuideOptions>()
export interface GuideOptions {
  /** The locale this project writes guides in. Without it the guide calls only check their arguments. */
  guideLocale?: Locale;
  /** Which image of each shot this project takes, such as a viewport or a color scheme. Pages are shared by the variants of a locale. */
  guideVariant?: Variant;
  /** Whether shots take screenshots. */
  guideShots: boolean;
  guideShot: GuideShotSettings;
  /** Where the page clock is frozen in a guide run: `"fixed"` at the time the context is made, or `false` to leave it running. */
  guideClock: "fixed" | false | Date | number;
}

export const SHOT_DEFAULTS = {
  highlight: "outline:3px solid #e5484d;outline-offset:3px;border-radius:6px",
  padding: 12,
  style: "",
  screenshot: { animations: "disabled", caret: "hide" },
} satisfies Required<GuideShotSettings>;
