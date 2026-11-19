import { describe, expect, it } from "vitest";
import { createTerminal, renderTerminal, snapshot } from "../src/terminal/render.js";

describe("renderTerminal", () => {
  it("keeps only the final state of carriage-return redraws", async () => {
    expect((await renderTerminal("10%\r55%\r100%\n")).text).toBe("100%");
  });

  it("strips colors from text", async () => {
    expect((await renderTerminal("\x1b[32mok\x1b[0m")).text).toBe("ok");
  });

  it("blanks concealed text but keeps its columns", async () => {
    expect((await renderTerminal("a\x1b[8msecret\x1b[0mb")).text).toBe("a      b");
    expect((await renderTerminal("a\x1b[8m日本\x1b[0mb")).text).toBe("a    b");
  });

  it("keeps a trailing row of painted blanks without trailing spaces in text", async () => {
    expect((await renderTerminal("\x1b[41m   \x1b[0m")).text).toBe("");
    expect((await renderTerminal("ok\n\x1b[7m  \x1b[0m\n\n")).text).toBe("ok\n");
    expect((await renderTerminal("ok\x1b[44m  \x1b[0m")).text).toBe("ok");
  });

  it("counts a painted row at the bottom of the viewport", async () => {
    const term = createTerminal({ cols: 10, rows: 4 });
    await new Promise<void>((resolve) => term.write("ok\n\x1b[41m  \x1b[0m", resolve));
    expect(snapshot(term, { viewport: true }).text).toBe("ok\n");
    term.dispose();
  });

  it("wraps at cols", async () => {
    const { text } = await renderTerminal("a".repeat(85), { cols: 80 });
    expect(text.split("\n").map((l) => l.length)).toEqual([80, 5]);
  });

  it("throws past scrollback", async () => {
    const out = Array.from({ length: 10_030 }, (_, i) => `line ${i}`).join("\n") + "\n";
    await expect(renderTerminal(out)).rejects.toThrow(/scrollback of 10000 lines/);
  });

  it("passes exactly at the scrollback limit and throws one row over", async () => {
    const opts = { rows: 3, scrollback: 5 };
    const lines = (n: number) => "x\n".repeat(n);
    await expect(renderTerminal(lines(7), opts)).resolves.toBeDefined();
    await expect(renderTerminal(lines(8), opts)).rejects.toThrow(/scrollback of 5 lines/);
  });

  it("throws when wrapped long lines exceed the limit", async () => {
    const opts = { cols: 10, rows: 3, scrollback: 5 };
    await expect(renderTerminal("a".repeat(100), opts)).rejects.toThrow(/scrollback of 5 lines/);
  });

  it("applies replacements to text", async () => {
    const { text } = await renderTerminal("done in 345ms", { replace: [[/\d+ms/g, "12ms"]] });
    expect(text).toBe("done in 12ms");
  });

  it("expands capture groups as String.prototype.replace does", async () => {
    const cases: [string, RegExp, string][] = [
      ["id", /(prefix)?id/, "$1stable"],
      ["id", /(i)d/, "$2-$1"],
      ["id", /(i)d/, "$12"],
      ["id", /id/, "$1"],
      ["id", /(?<a>x)?id/, "[$<a>]"],
    ];
    for (const [input, pattern, replacement] of cases) {
      const { text } = await renderTerminal(input, { replace: [[pattern, replacement]] });
      expect(text).toBe(input.replace(pattern, replacement));
    }
    expect((await renderTerminal("id", { replace: [[/(prefix)?id/, "$1stable"]] })).text).toBe(
      "stable",
    );
  });

  it("replaces a token that wrapped at cols", async () => {
    const { text, svg } = await renderTerminal("x".repeat(78) + "abc1234567\n", {
      replace: [[/abc\d{7}/g, "ID"]],
    });
    expect(text).toBe("x".repeat(78) + "ID");
    expect(svg).not.toContain("abc");
    expect(svg).not.toContain("4567");
  });

  it("wraps a replaced line again at its new length", async () => {
    const opts = { cols: 10 };
    const shorter = await renderTerminal("aaaaaaaa" + "token" + "bbbbbbbbb\n", {
      ...opts,
      replace: [["token", "T"]],
    });
    expect(shorter.text).toBe("aaaaaaaaTb\nbbbbbbbb");
    const longer = await renderTerminal("ab" + "token" + "cd\n", {
      ...opts,
      replace: [["token", "a-much-longer-value"]],
    });
    expect(longer.text).toBe("aba-much-l\nonger-valu\necd");
    expect(longer.svg).toContain('height="92.00"');
  });

  it("moves a wide character that no longer fits to the next row", async () => {
    const { text } = await renderTerminal("abcdefgh日本\n", { cols: 10, replace: [["a", "aa"]] });
    expect(text).toBe("aabcdefgh\n日本");
  });

  it("drops the cell a wrapped wide character left behind", async () => {
    const { text } = await renderTerminal("abcdefghi日本\n", { cols: 10, replace: [["i", ""]] });
    expect(text).toBe("abcdefgh日\n本");
  });

  it("returns an svg document", async () => {
    expect((await renderTerminal("hi")).svg).toMatch(/^<svg /);
  });
});

describe("snapshot viewport", () => {
  it("replaces per row at fixed width", async () => {
    const term = createTerminal({ cols: 20, rows: 3 });
    await new Promise<void>((resolve) => term.write("id: abcdef end\r\nzz abcdef", resolve));
    const short = snapshot(term, { viewport: true, replace: [[/abcdef/, "ID"]] });
    expect(short.text).toBe("id: ID     end\nzz ID    ");
    const long = snapshot(term, { viewport: true, replace: [[/abcdef/, "0123456789"]] });
    expect(long.text).toBe("id: 012345 end\nzz 012345");
    term.dispose();
  });
});
