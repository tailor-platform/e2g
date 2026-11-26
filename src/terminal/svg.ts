import { DEFAULT_THEME, type Palette, type TerminalTheme } from "./theme.js";

export type CellColor =
  | { kind: "default" }
  | { kind: "palette"; index: number }
  | { kind: "rgb"; hex: string };

export interface Cell {
  /** Empty for the trailing half of a wide character. */
  chars: string;
  width: 0 | 1 | 2;
  fg: CellColor;
  bg: CellColor;
  bold: boolean;
  underline: boolean;
  inverse: boolean;
}

export type CellRow = Cell[];

const FONT_SIZE = 16;
const CELL_WIDTH = 9.6;
const CELL_HEIGHT = 20;
const BASELINE = 15;
const PADDING = 16;
const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const FG_VAR = "var(--e2g-fg)";
const BG_VAR = "var(--e2g-bg)";

const num = (n: number): string => n.toFixed(2);

const hex2 = (c: number): string => c.toString(16).padStart(2, "0");

const escapeText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paletteHex(index: number): string {
  if (index >= 232) {
    const v = hex2(8 + (index - 232) * 10);
    return `#${v}${v}${v}`;
  }
  const levels = [0, 95, 135, 175, 215, 255];
  const n = index - 16;
  const rgb = [Math.floor(n / 36), Math.floor(n / 6) % 6, n % 6].map((i) => hex2(levels[i]!));
  return `#${rgb.join("")}`;
}

function fill(color: CellColor): string | null {
  if (color.kind === "default") return null;
  if (color.kind === "rgb") return color.hex;
  return color.index < 16 ? `var(--e2g-${color.index})` : paletteHex(color.index);
}

function resolve(cell: Cell): { fg: string; bg: string | null } {
  const fg = fill(cell.fg);
  const bg = fill(cell.bg);
  if (cell.inverse) return { fg: bg ?? BG_VAR, bg: fg ?? FG_VAR };
  return { fg: fg ?? FG_VAR, bg };
}

function variables(palette: Palette): string {
  const vars = [`--e2g-bg:${palette.background}`, `--e2g-fg:${palette.foreground}`];
  palette.ansi.forEach((color, i) => vars.push(`--e2g-${i}:${color}`));
  return vars.join(";");
}

function backgrounds(row: CellRow, y: number): string[] {
  const out: string[] = [];
  let start = 0;
  let current: string | null = null;
  const flush = (end: number): void => {
    if (current === null) return;
    out.push(
      `<rect x="${num(start * CELL_WIDTH)}" y="${num(y * CELL_HEIGHT)}" width="${num((end - start) * CELL_WIDTH)}" height="${num(CELL_HEIGHT)}" fill="${current}"/>`,
    );
  };
  row.forEach((cell, x) => {
    const bg = resolve(cell).bg;
    if (bg !== current) {
      flush(x);
      current = bg;
      start = x;
    }
  });
  flush(row.length);
  return out;
}

interface Run {
  start: number;
  cols: number;
  text: string;
  wide: boolean;
  fg: string;
  bold: boolean;
  underline: boolean;
}

// Wide and narrow glyphs get separate runs so that textLength pins each one
// to its own columns instead of letting a font's glyph widths shift the rest.
function runs(row: CellRow): Run[] {
  const grouped: Run[] = [];
  let open: Run | null = null;
  row.forEach((cell, x) => {
    if (cell.width === 0) return;
    const { fg } = resolve(cell);
    const wide = cell.width === 2;
    if (
      open &&
      open.wide === wide &&
      open.fg === fg &&
      open.bold === cell.bold &&
      open.underline === cell.underline
    ) {
      open.text += cell.chars;
      open.cols += cell.width;
      return;
    }
    open = {
      start: x,
      cols: cell.width,
      text: cell.chars,
      wide,
      fg,
      bold: cell.bold,
      underline: cell.underline,
    };
    grouped.push(open);
  });
  // Edge blanks carry no ink; trimming them keeps underlines off blanks. They
  // are counted in cells, since a wide blank such as U+3000 spans two columns.
  return grouped.flatMap((run) => {
    const chars = [...run.text];
    const cell = run.wide ? 2 : 1;
    let from = 0;
    let to = chars.length;
    while (from < to && chars[from]!.trim() === "") from++;
    while (to > from && chars[to - 1]!.trim() === "") to--;
    if (from === to) return [];
    return [
      {
        ...run,
        text: chars.slice(from, to).join(""),
        start: run.start + from * cell,
        cols: run.cols - (from + chars.length - to) * cell,
      },
    ];
  });
}

function textElement(run: Run, y: number): string {
  const attrs = [
    `x="${num(run.start * CELL_WIDTH)}"`,
    `y="${num(y * CELL_HEIGHT + BASELINE)}"`,
    `fill="${run.fg}"`,
  ];
  if (run.bold) attrs.push('font-weight="bold"');
  if (run.underline) attrs.push('text-decoration="underline"');
  attrs.push(
    `textLength="${num(run.cols * CELL_WIDTH)}"`,
    'lengthAdjust="spacing"',
    'xml:space="preserve"',
  );
  return `<text ${attrs.join(" ")}>${escapeText(run.text)}</text>`;
}

export function bufferToSvg(
  cells: CellRow[],
  cols: number,
  theme: TerminalTheme = DEFAULT_THEME,
): string {
  const width = Math.max(cols, ...cells.map((row) => row.length));
  const height = Math.max(cells.length, 1);
  const svgWidth = num(width * CELL_WIDTH + PADDING * 2);
  const svgHeight = num(height * CELL_HEIGHT + PADDING * 2);
  const body = cells.flatMap((row, y) => [
    ...backgrounds(row, y),
    ...runs(row).map((run) => textElement(run, y)),
  ]);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="e2g-term" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">`,
    `<style>.e2g-term{${variables(theme.light)}}@media (prefers-color-scheme: dark){.e2g-term{${variables(theme.dark)}}}</style>`,
    `<rect width="${svgWidth}" height="${svgHeight}" fill="${BG_VAR}"/>`,
    `<g transform="translate(${num(PADDING)} ${num(PADDING)})">`,
    ...body,
    "</g>",
    "</svg>",
  ].join("\n");
}
