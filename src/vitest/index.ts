// `test` is guideTest, for a project without fixtures of its own: import { test, expect } from "@tailor-platform/e2g/vitest"
export {
  guideFixtures,
  guidePage,
  guideTest,
  guideTest as test,
  type CommandOptions,
  type CommandResult,
  type Guide,
  type GuideFixtureDefinitions,
  type GuideFixtures,
  type ScreenOptions,
} from "./guide.js";
export { reviveTerminal, serializeTerminal, type SerializedTerminalOptions } from "./settings.js";
export { META_KEY, type GuideMeta, type GuideRecordMeta } from "./protocol.js";
export { expect } from "vitest";
// the types a test file needs, so it imports from one place; Register is augmented on "@tailor-platform/e2g"
export type {
  Block,
  CommandItem,
  Item,
  Locale,
  Meta,
  Page,
  ScreenImage,
  ScreenItem,
  SourceLocation,
  Text,
} from "../types.js";
