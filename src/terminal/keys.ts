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

export function keySequence(key: string): string {
  const named = KEYS[key];
  if (named !== undefined) return named;
  const control = /^Control\+([A-Za-z])$/.exec(key);
  if (control) return String.fromCharCode(control[1]!.toUpperCase().charCodeAt(0) - 64);
  throw new Error(`Unknown key "${key}"`);
}
