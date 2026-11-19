import type { TestProjectInlineConfiguration } from "vitest/config";
import type { TerminalOptions } from "../../terminal/terminal.js";
import type { Locale } from "../../types.js";
import "../protocol.js";
import { serializeTerminal } from "../settings.js";

export interface GuideProjectsOptions {
  /** Terminal settings for every locale, or for each locale by name. */
  terminal?: TerminalOptions | Partial<Record<Locale, TerminalOptions>>;
  /** The guide test files, when they differ from the root config's `include`. */
  include?: string[];
}

const isPerLocale = (
  terminal: GuideProjectsOptions["terminal"],
  locales: Locale[],
): terminal is Partial<Record<Locale, TerminalOptions>> =>
  terminal !== undefined && Object.keys(terminal).some((key) => locales.includes(key as Locale));

/** One Vitest project per locale, each inheriting the root config and providing its locale to the tests. */
export function guideProjects(
  locales: Locale[],
  options: GuideProjectsOptions = {},
): TestProjectInlineConfiguration[] {
  const { terminal, include } = options;
  return locales.map((locale) => {
    const settings = isPerLocale(terminal, locales) ? (terminal[locale] ?? {}) : (terminal ?? {});
    return {
      extends: true,
      test: {
        name: locale,
        ...(include ? { include } : {}),
        // the reporter needs each test's line and column to order a page's tests and to locate its blocks
        includeTaskLocation: true,
        provide: { guideLocale: locale, guideTerminal: serializeTerminal(settings) },
      },
    };
  });
}
