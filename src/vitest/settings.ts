import type { Replacement } from "../terminal/replace.js";
import type { TerminalOptions } from "../terminal/terminal.js";

type SerializedPattern = { source: string; flags: string } | string;

// provide() values are structured-cloned to the workers, which cannot carry a RegExp
export interface SerializedTerminalOptions extends Omit<TerminalOptions, "replace"> {
  replace?: Array<[SerializedPattern, string]>;
}

export function serializeTerminal(o: TerminalOptions): SerializedTerminalOptions {
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

// a test-level override is plain TerminalOptions, so both shapes are accepted
export function reviveTerminal(o: TerminalOptions | SerializedTerminalOptions): TerminalOptions {
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
