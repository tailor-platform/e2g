import { describe, expect, it } from "vitest";
import { createTerminal, renderTerminal, snapshot } from "../src/terminal/render.js";
import { DEFAULT_THEME } from "../src/terminal/theme.js";

const colored =
  "\x1b[1;31merror\x1b[0m: \x1b[4mpath\x1b[0m \x1b[38;5;208mwarn\x1b[0m \x1b[48;2;1;2;3mrgb\x1b[0m";

describe("terminal svg", () => {
  it("same input gives identical bytes", async () => {
    const a = await renderTerminal(colored);
    const b = await renderTerminal(colored);
    expect(a.svg).toBe(b.svg);
  });

  it("keeps text selectable", async () => {
    const { svg } = await renderTerminal("ok");
    expect(svg).toMatch(/<text [^>]*>ok<\/text>/);
  });

  it("places wide characters on two cells", async () => {
    const { svg } = await renderTerminal("日本a");
    expect(svg).toMatch(/<text x="0\.00"[^>]*textLength="38\.40"[^>]*>日本<\/text>/);
    expect(svg).toMatch(/<text x="38\.40"[^>]*>a<\/text>/);
  });

  it("hides concealed text", async () => {
    const { svg } = await renderTerminal("\x1b[8msecret\x1b[0mok");
    expect(svg).not.toContain("secret");
    expect(svg).toMatch(/<text x="57\.60"[^>]*>ok<\/text>/);
  });

  it("trims a wide blank by its two cells", async () => {
    const { svg } = await renderTerminal("　日本\n日本\n");
    const first = /<text [^>]*>[^<]*<\/text>/.exec(svg)![0];
    expect(first).toMatch(/x="19\.20"[^>]*textLength="38\.40"[^>]*>日本</);
  });

  it("defines both color schemes", async () => {
    const { svg } = await renderTerminal("x");
    expect(svg).toContain("--e2g-bg");
    expect(svg).toContain("prefers-color-scheme: dark");
  });

  it("uses a custom theme", async () => {
    const theme = {
      ...DEFAULT_THEME,
      light: { ...DEFAULT_THEME.light, background: "#123456" },
    };
    expect((await renderTerminal("x", { theme })).svg).toContain("#123456");
  });

  it("maps attributes to svg", async () => {
    const { svg } = await renderTerminal(colored);
    expect(svg).toContain('fill="var(--e2g-1)"');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('text-decoration="underline"');
    expect(svg).toContain('fill="#ff8700"');
    expect(svg).toContain('fill="#010203"');
  });

  it("swaps colors for inverse", async () => {
    const { svg } = await renderTerminal("\x1b[7mhi\x1b[0m");
    expect(svg).toContain(
      '<rect x="0.00" y="0.00" width="19.20" height="20.00" fill="var(--e2g-fg)"/>',
    );
    expect(svg).toMatch(/<text [^>]*fill="var\(--e2g-bg\)"[^>]*>hi<\/text>/);
  });

  it("renderTerminal covers content lines and viewport covers every row", async () => {
    const content = await renderTerminal("a\nb\n\n\n");
    expect(content.svg).toContain('height="72.00"');
    const term = createTerminal({ cols: 10, rows: 5 });
    await new Promise<void>((resolve) => term.write("a", resolve));
    expect(snapshot(term, { viewport: true }).svg).toContain('height="132.00"');
    term.dispose();
  });

  it("shows replacement characters with the original attributes", async () => {
    const term = createTerminal({ cols: 20, rows: 2 });
    await new Promise<void>((resolve) => term.write("\x1b[31mabcdef\x1b[0m end", resolve));
    const { text, svg } = snapshot(term, { viewport: true, replace: [[/abcdef/, "ID"]] });
    expect(text).toBe("ID     end");
    expect(svg).toMatch(/<text x="0\.00"[^>]*fill="var\(--e2g-1\)"[^>]*>ID<\/text>/);
    expect(svg).toMatch(/<text x="67\.20"[^>]*>end<\/text>/);
    term.dispose();
  });

  it("measures replacements in columns around wide characters", async () => {
    const term = createTerminal({ cols: 20, rows: 2 });
    await new Promise<void>((resolve) => term.write("日本語 abc 末尾", resolve));
    const narrow = snapshot(term, { viewport: true, replace: [[/日本語/, "ab"]] });
    expect(narrow.text).toBe("ab     abc 末尾");
    expect(narrow.svg).toMatch(/<text x="105\.60"[^>]*>末尾<\/text>/);
    const wide = snapshot(term, { viewport: true, replace: [[/abc/, "あい"]] });
    expect(wide.text).toBe("日本語 あ  末尾");
    expect(wide.svg).toMatch(/<text x="67\.20"[^>]*textLength="19\.20"[^>]*>あ<\/text>/);
    term.dispose();
  });

  it("matches the prompt snapshot", async () => {
    const { svg } = await renderTerminal(
      "\x1b[1;32muser@host\x1b[0m:\x1b[1;34m~/project\x1b[0m$ mycli deploy\n" +
        "\x1b[33mwarning\x1b[0m: using defaults\n" +
        "\x1b[32m✔\x1b[0m deployed \x1b[2mapp\x1b[0m\n" +
        "日本語の出力 \x1b[7minverse\x1b[0m\n",
    );
    await expect(svg).toMatchFileSnapshot("__snapshots__/prompt.svg");
  });
});
