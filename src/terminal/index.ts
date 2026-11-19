export { renderTerminal, type RenderOptions, type Rendered } from "./render.js";
export type { Replacement } from "./replace.js";
export type { Alias } from "./alias.js";
export { DEFAULT_THEME, type Palette, type TerminalTheme } from "./theme.js";
export { Terminal, type TerminalOptions, type RunResult } from "./terminal.js";
// sessions come from terminal.spawn(); constructing one needs internals that are not public
export type { Session } from "./session.js";
