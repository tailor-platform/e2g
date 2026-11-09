// `test` is guideTest, for a project without fixtures of its own: import { test, expect } from "@tailor-platform/e2g/playwright"
export {
  guidePage,
  guideTest,
  guideTest as test,
  type Guide,
  type GuideStepDetails,
} from "./guides.js";
export { expect } from "@playwright/test";
export type { ShotOptions } from "./shot.js";
export type { GuideOptions, GuideShotSettings } from "./use.js";
// the types a spec file needs, so it imports from one place; Register is augmented on "@tailor-platform/e2g"
export type { Block, Locale, Meta, Page, Shot, Text } from "../types.js";
