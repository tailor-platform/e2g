export interface Palette {
  background: string;
  foreground: string;
  /** The 16 ANSI colors: 8 normal followed by 8 bright. */
  ansi: string[];
}

export interface TerminalTheme {
  light: Palette;
  dark: Palette;
}

export const DEFAULT_THEME: TerminalTheme = {
  light: {
    background: "#ffffff",
    foreground: "#1f2328",
    ansi: [
      "#24292f",
      "#cf222e",
      "#116329",
      "#4d2d00",
      "#0969da",
      "#8250df",
      "#1b7c83",
      "#6e7781",
      "#57606a",
      "#a40e26",
      "#1a7f37",
      "#633c01",
      "#218bff",
      "#a475f9",
      "#3192aa",
      "#8c959f",
    ],
  },
  dark: {
    background: "#0d1117",
    foreground: "#e6edf3",
    ansi: [
      "#484f58",
      "#ff7b72",
      "#3fb950",
      "#d29922",
      "#58a6ff",
      "#bc8cff",
      "#39c5cf",
      "#b1bac4",
      "#6e7681",
      "#ffa198",
      "#56d364",
      "#e3b341",
      "#79c0ff",
      "#d2a8ff",
      "#56d4dd",
      "#f0f6fc",
    ],
  },
};
