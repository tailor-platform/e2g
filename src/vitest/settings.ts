import type { Replacement } from "../terminal/replace.js";
import type { TerminalOptions } from "../terminal/terminal.js";

type SerializedPattern = { source: string; flags: string } | string;

// the terminal fixture gives each test its own home and project, and finds tools from the test file
type FixtureOwned = "home" | "cwd" | "binFrom";
const FIXTURE_OWNED: FixtureOwned[] = ["home", "cwd", "binFrom"];

/** Terminal settings for the `terminal` fixture, which sets `home`, `cwd` and `binFrom` itself. */
export type GuideTerminalOptions = Omit<TerminalOptions, FixtureOwned>;

// provide() values are structured-cloned to the workers, which cannot carry a RegExp
export interface SerializedTerminalOptions extends Omit<GuideTerminalOptions, "replace"> {
  replace?: Array<[SerializedPattern, string]>;
}

// a plain JavaScript config, or one cast past the types, would otherwise be overwritten without a word
function refuseOwned(o: object): void {
  const set = FIXTURE_OWNED.filter((key) => key in o);
  if (set.length > 0)
    throw new Error(
      `guide terminal settings cannot set ${set.join(", ")}: each test's terminal runs in its own temporary home and project, and finds tools from its test file`,
    );
}

export function serializeTerminal(o: GuideTerminalOptions): SerializedTerminalOptions {
  refuseOwned(o);
  const { replace, ...rest } = o;
  if (!replace) return rest;
  return {
    ...rest,
    replace: replace.map(([pattern, to]) => [
      typeof pattern === "string" ? pattern : { source: pattern.source, flags: pattern.flags },
      to,
    ]),
  };
}

// a test-level override is plain GuideTerminalOptions, so both shapes are accepted
export function reviveTerminal(
  o: GuideTerminalOptions | SerializedTerminalOptions,
): GuideTerminalOptions {
  refuseOwned(o);
  const { replace, ...rest } = o;
  if (!replace) return rest;
  return {
    ...rest,
    replace: (replace as Array<[RegExp | SerializedPattern, string]>).map(
      ([pattern, to]): Replacement => [
        typeof pattern === "string" || pattern instanceof RegExp
          ? pattern
          : new RegExp(pattern.source, pattern.flags),
        to,
      ],
    ),
  };
}
