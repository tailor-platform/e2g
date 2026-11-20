import xterm from "@xterm/headless";
import type { IBufferCell, Terminal as HeadlessTerminal } from "@xterm/headless";
import { contentWidth, paintedWidth, replaceRow, rowText, type Replacement } from "./replace.js";
import { bufferToSvg, type Cell, type CellColor, type CellRow } from "./svg.js";
import type { TerminalTheme } from "./theme.js";

export interface RenderOptions {
  cols?: number;
  rows?: number;
  replace?: Replacement[];
  theme?: TerminalTheme;
  scrollback?: number;
}

export interface Rendered {
  text: string;
  svg: string;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_SCROLLBACK = 10_000;

export function createTerminal(
  options: Pick<RenderOptions, "cols" | "rows" | "scrollback"> & { convertEol?: boolean } = {},
): HeadlessTerminal {
  return new xterm.Terminal({
    cols: options.cols ?? DEFAULT_COLS,
    rows: options.rows ?? DEFAULT_ROWS,
    scrollback: options.scrollback ?? DEFAULT_SCROLLBACK,
    allowProposedApi: true,
    convertEol: options.convertEol ?? true,
  });
}

function readRow(term: HeadlessTerminal, y: number, scratch: IBufferCell): CellRow {
  const line = term.buffer.active.getLine(y);
  const row: CellRow = [];
  let hidWide = false;
  for (let x = 0; x < term.cols; x++) {
    const cell = line?.getCell(x, scratch);
    if (!cell) {
      hidWide = false;
      row.push(BLANK);
      continue;
    }
    // Concealed text (SGR 8) keeps its columns but shows nothing; a wide
    // character becomes two narrow blanks so the grid stays the same.
    const concealed: boolean = cell.isInvisible() !== 0 || (cell.getWidth() === 0 && hidWide);
    hidWide = concealed && cell.getWidth() === 2;
    const width = concealed ? 1 : (cell.getWidth() as 0 | 1 | 2);
    row.push({
      chars: concealed ? " " : width === 0 ? "" : cell.getChars() || " ",
      width,
      fg: readColor(cell.isFgPalette(), cell.isFgRGB(), cell.getFgColor()),
      bg: readColor(cell.isBgPalette(), cell.isBgRGB(), cell.getBgColor()),
      bold: cell.isBold() !== 0,
      underline: cell.isUnderline() !== 0,
      inverse: cell.isInverse() !== 0,
    });
  }
  return row;
}

const DEFAULT: CellColor = { kind: "default" };

const BLANK: Cell = {
  chars: " ",
  width: 1,
  fg: DEFAULT,
  bg: DEFAULT,
  bold: false,
  underline: false,
  inverse: false,
};

// A wide character that does not fit at the end of a row moves to the next
// one and leaves an unwritten cell behind, which is not part of the line.
function joinRows(term: HeadlessTerminal, ys: number[], rows: CellRow[]): CellRow {
  return rows.flatMap((row, i) => {
    const next = rows[i + 1];
    if (!next || next[0]?.width !== 2) return row;
    const last = term.buffer.active.getLine(ys[i]!)?.getCell(term.cols - 1);
    return last && last.getChars() === "" && last.getWidth() === 1 ? row.slice(0, -1) : row;
  });
}

// Painted blanks after the text wrap along with it so a colored block survives
// a replacement that changes the line's length.
function wrapRow(head: CellRow, tail: CellRow, cols: number): CellRow[] {
  const rows: CellRow[] = [];
  let current: CellRow = [];
  const painted = paintedWidth(tail);
  for (const cell of [...head, ...tail.slice(0, painted)]) {
    if (cell.width !== 0 && current.length + cell.width > cols) {
      while (current.length < cols) current.push(BLANK);
      rows.push(current);
      current = [];
    }
    current.push(cell);
  }
  current.push(...tail.slice(painted, painted + Math.max(0, cols - current.length)));
  rows.push(current);
  return rows;
}

function readColor(palette: boolean, rgb: boolean, value: number): CellColor {
  if (palette) return { kind: "palette", index: value };
  if (rgb) return { kind: "rgb", hex: `#${value.toString(16).padStart(6, "0")}` };
  return DEFAULT;
}

export function snapshot(
  term: HeadlessTerminal,
  options: { viewport: boolean; replace?: Replacement[]; theme?: TerminalTheme },
): Rendered {
  const buffer = term.buffer.active;
  const replace = options.replace ?? [];
  const start = options.viewport ? buffer.viewportY : 0;
  const end = options.viewport ? start + term.rows : buffer.length;
  const scratch = buffer.getNullCell();
  const rows: CellRow[] = [];
  for (let y = start; y < end; y++) rows.push(readRow(term, y, scratch));

  // Text and SVG come from the same replaced cells so they always agree. A
  // viewport is a character grid, so its replacements keep every column.
  if (options.viewport) {
    const replaced = rows.map((row) => replaceRow(row, replace, true));
    const lines = replaced.map((r) => rowText(r.row.slice(0, r.end)));
    while (
      lines.length > 0 &&
      lines[lines.length - 1] === "" &&
      paintedWidth(replaced[lines.length - 1]!.row) === 0
    )
      lines.pop();
    const cells = replaced.map((r) => r.row);
    return { text: lines.join("\n"), svg: bufferToSvg(cells, term.cols, options.theme) };
  }

  // Command output is replaced per logical line, so a token that wrapped at
  // `cols` is still matched, then wrapped again at its new length.
  const groups: { ys: number[]; rows: CellRow[] }[] = [];
  rows.forEach((row, i) => {
    const y = start + i;
    const last = groups[groups.length - 1];
    if (last && buffer.getLine(y)?.isWrapped) {
      last.ys.push(y);
      last.rows.push(row);
    } else groups.push({ ys: [y], rows: [row] });
  });
  while (groups.length > 0 && groups[groups.length - 1]!.rows.every((r) => paintedWidth(r) === 0))
    groups.pop();
  // The text keeps each logical line whole so a reader can copy it; only the SVG shows the wrapping.
  const lines = groups.map((group) =>
    replaceRow(joinRows(term, group.ys, group.rows), replace, false),
  );
  const cells = lines.flatMap(({ row, end }) =>
    wrapRow(row.slice(0, end), row.slice(end), term.cols),
  );
  const text = lines.map(({ row }) => rowText(row.slice(0, contentWidth(row)))).join("\n");
  return { text, svg: bufferToSvg(cells, term.cols, options.theme) };
}

export async function renderTerminal(
  output: string,
  options: RenderOptions = {},
): Promise<Rendered> {
  const scrollback = options.scrollback ?? DEFAULT_SCROLLBACK;
  // One spare line lets an eviction show up as a scrolled-off count above the
  // limit, instead of the oldest line vanishing unnoticed; this also covers
  // long lines that wrap into many rows.
  const term = createTerminal({ ...options, scrollback: scrollback + 1 });
  try {
    await new Promise<void>((resolve) => term.write(output, resolve));
    if (term.buffer.active.baseY > scrollback) {
      throw new Error(
        `Terminal output overflows the scrollback of ${scrollback} lines; raise \`scrollback\` or shorten the output`,
      );
    }
    return snapshot(term, { viewport: false, replace: options.replace, theme: options.theme });
  } finally {
    term.dispose();
  }
}
