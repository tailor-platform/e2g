import type { Cell, CellRow } from "./svg.js";

export type Replacement = [pattern: RegExp | string, replacement: string];

const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

function charWidth(char: string): 0 | 1 | 2 {
  const code = char.codePointAt(0)!;
  if ((code >= 0x300 && code <= 0x36f) || (code >= 0x200b && code <= 0x200f)) return 0;
  return WIDE_RANGES.some(([lo, hi]) => code >= lo && code <= hi) ? 2 : 1;
}

export function rowText(row: CellRow): string {
  return row.map((cell) => (cell.width === 0 ? "" : cell.chars)).join("");
}

// Mirrors translateToString(true): trailing blank cells are not content.
export function contentWidth(row: CellRow): number {
  for (let i = row.length - 1; i >= 0; i--) {
    const cell = row[i]!;
    if (cell.width > 0 && cell.chars.trim() !== "") return i + cell.width;
  }
  return 0;
}

function expand(
  template: string,
  match: string,
  groups: (string | undefined)[],
  named: Record<string, string> | undefined,
): string {
  return template.replace(/\$(\$|&|\d{1,2}|<[^>]*>)/g, (token, key: string) => {
    if (key === "$") return "$";
    if (key === "&") return match;
    if (key.startsWith("<")) return named?.[key.slice(1, -1)] ?? "";
    return groups[Number(key) - 1] ?? token;
  });
}

interface Span {
  from: number;
  to: number;
  text: string;
}

function findSpans(row: CellRow, pattern: RegExp | string, replacement: string): Span[] {
  const columnOf: number[] = [];
  let text = "";
  row.forEach((cell, col) => {
    if (cell.width === 0) return;
    for (let i = 0; i < cell.chars.length; i++) columnOf.push(col);
    text += cell.chars;
  });
  columnOf.push(row.length);

  const literal = typeof pattern === "string";
  const regex = literal ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : pattern;
  const spans: Span[] = [];
  text.replace(regex, (...args: unknown[]) => {
    const match = args[0] as string;
    const offsetAt = args.findIndex((a, i) => i > 0 && typeof a === "number");
    const offset = args[offsetAt] as number;
    const last = args[args.length - 1];
    const named =
      typeof last === "object" && last !== null ? (last as Record<string, string>) : undefined;
    const groups = args.slice(1, offsetAt) as (string | undefined)[];
    const from = columnOf[offset]!;
    const to = columnOf[offset + match.length]!;
    if (to > from) {
      spans.push({
        from,
        to,
        text: literal ? replacement : expand(replacement, match, groups, named),
      });
    }
    return match;
  });
  return spans;
}

function cellsFor(text: string, source: (index: number) => Cell, limit: number | null): Cell[] {
  const out: Cell[] = [];
  let used = 0;
  for (const char of text) {
    const width = charWidth(char);
    if (width === 0) continue;
    if (limit !== null && used + width > limit) break;
    const base = source(used);
    out.push({ ...base, chars: char, width });
    if (width === 2) out.push({ ...source(used + 1), chars: "", width: 0 });
    used += width;
  }
  if (limit !== null) {
    for (; used < limit; used++) out.push({ ...source(used), chars: " ", width: 1 });
  }
  return out;
}

// Replacement text takes the attributes of the cell at the same column, so a
// masked value keeps its color. Fixed width keeps every later cell in place;
// otherwise the row simply gets shorter or longer.
export function replaceRow(
  row: CellRow,
  replace: Replacement[],
  fixedWidth: boolean,
): { row: CellRow; end: number } {
  const end = contentWidth(row);
  let head = row.slice(0, end);
  const tail = row.slice(end);
  for (const [pattern, replacement] of replace) {
    const current = head;
    const spans = findSpans(current, pattern, replacement);
    for (const span of spans.reverse()) {
      const n = span.to - span.from;
      const source = (i: number): Cell =>
        current[Math.min(span.from + i, span.to - 1)] ?? current[span.from]!;
      head = [
        ...head.slice(0, span.from),
        ...cellsFor(span.text, source, fixedWidth ? n : null),
        ...head.slice(span.to),
      ];
    }
  }
  return { row: [...head, ...tail], end: head.length };
}
