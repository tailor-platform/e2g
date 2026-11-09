import { dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Location } from "@playwright/test";
import { real } from "../core/real.js";

// this package's own directory, so its frames are skipped wherever it is installed
const LIBRARY = real(dirname(fileURLToPath(import.meta.url))) + sep;

const FRAME = /^\s*at (?:.*? \()?(.+?):(\d+):(\d+)\)?$/;

// the first frame of the stack outside this package: where the user called it
export function callerLocation(): Location | undefined {
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
