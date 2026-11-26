import type { Block, Locale, TakenShot } from "../types.js";
import type { SerializedTerminalOptions } from "./settings.js";

// how a guide test reaches the reporter: its options set `meta.e2g`, and the guide fixture adds the record
export const META_KEY = "e2g";

export interface GuideRecordMeta {
  // a screen's SVG travels in `svgs` under its name, so its image is null here
  blocks: Block<TakenShot, null>[];
  svgs: Record<string, string>;
  problem?: string;
}

export interface GuideMeta {
  slug: string;
  meta: unknown;
  record?: GuideRecordMeta;
}

declare module "vitest" {
  interface TaskMeta {
    [META_KEY]?: GuideMeta;
  }
  // what a guide project provides to its tests, and what the reporter reads back from it
  interface ProvidedContext {
    guideLocale?: Locale;
    guideTerminal?: SerializedTerminalOptions;
  }
}
