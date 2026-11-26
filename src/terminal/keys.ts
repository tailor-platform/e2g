const KEYS: Record<string, string> = {
  Enter: "\r",
  Tab: "\t",
  Escape: "\x1b",
  Backspace: "\x7f",
  Space: " ",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Delete: "\x1b[3~",
};

// In application cursor mode (DECCKM, set by \x1b[?1h) these keys are sent as SS3 instead of CSI.
const APPLICATION_CURSOR: Record<string, string> = {
  ArrowUp: "\x1bOA",
  ArrowDown: "\x1bOB",
  ArrowRight: "\x1bOC",
  ArrowLeft: "\x1bOD",
  Home: "\x1bOH",
  End: "\x1bOF",
};

export function keySequence(key: string, applicationCursor = false): string {
  const named = (applicationCursor ? APPLICATION_CURSOR[key] : undefined) ?? KEYS[key];
  if (named !== undefined) return named;
  const control = /^Control\+([A-Za-z])$/.exec(key);
  if (control) return String.fromCharCode(control[1]!.toUpperCase().charCodeAt(0) - 64);
  throw new Error(`Unknown key "${key}"`);
}
