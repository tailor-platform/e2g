import { dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceLocation } from "../types.js";
import { real } from "./real.js";

// this package's dist (or src) root, so frames in core and in every adapter are skipped wherever it is installed
const LIBRARY = real(dirname(dirname(fileURLToPath(import.meta.url)))) + sep;

const FRAME = /^\s*at (?:.*? \()?(.+?):(\d+):(\d+)\)?$/;

// the first frame of the stack outside this package: where the user called it
export function callerLocation(): SourceLocation | undefined {
  for (const line of (new Error().stack ?? "").split("\n").slice(1)) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const [, raw, row, col] = match;
    let file = raw!;
    if (file.startsWith("file://")) file = fileURLToPath(file);
    else if (!file.startsWith(sep) && !/^[A-Za-z]:[\\/]/.test(file)) continue;
    if (real(file).startsWith(LIBRARY)) continue;
    return { file, line: Number(row), column: Number(col) };
  }
  return undefined;
}
