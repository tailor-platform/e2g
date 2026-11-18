import { describe, expect, it } from "vitest";
import { blocksToMarkdown } from "../src/markdown.ts";
import type { Block, Shot } from "../src/types.ts";

const shot = (name: string, alt = name): Shot => ({
  name,
  alt,
  images: [{ src: `img/${name}.png`, regions: [] }],
});
const step = (text: string, name: string, alt = name): Block => ({
  kind: "step",
  text,
  shots: [shot(name, alt)],
});
const say = (text: string): Block => ({ kind: "say", text });

const responsive = (name: string, alt = name): Shot => ({
  name,
  alt,
  images: [
    { variant: "desktop", src: `img/desktop/${name}.png`, regions: [] },
    { variant: "mobile", src: `img/mobile/${name}.png`, regions: [] },
  ],
});
const MEDIA = { media: { mobile: "(max-width: 640px)" } };

describe("blocksToMarkdown", () => {
  it("numbers steps and continues across a say", () => {
    const out = blocksToMarkdown([
      say("Intro"),
      step("Open it.", "a", "A"),
      step("Click.", "b"),
      say("Done"),
      step("Again.", "c"),
    ]);
    expect(out).toBe(
      "Intro\n\n1. Open it.\n\n   ![A](img/a.png)\n\n2. Click.\n\n   ![b](img/b.png)\n\nDone\n\n3. Again.\n\n   ![c](img/c.png)\n",
    );
  });

  it("a heading say resets the numbering", () => {
    const out = blocksToMarkdown([
      step("A.", "a"),
      step("B.", "b"),
      say("## Part two"),
      step("C.", "c"),
    ]);
    expect(out).toBe(
      "1. A.\n\n   ![a](img/a.png)\n\n2. B.\n\n   ![b](img/b.png)\n\n## Part two\n\n1. C.\n\n   ![c](img/c.png)\n",
    );
  });

  it("a page starting with a say starts at 1", () => {
    const out = blocksToMarkdown([say("Intro"), step("A.", "a")]);
    expect(out).toBe("Intro\n\n1. A.\n\n   ![a](img/a.png)\n");
  });

  it("a paragraph after a heading say does not reset again", () => {
    const out = blocksToMarkdown([step("A.", "a"), say("# Title"), say("Text"), step("B.", "b")]);
    expect(out).toBe(
      "1. A.\n\n   ![a](img/a.png)\n\n# Title\n\nText\n\n1. B.\n\n   ![b](img/b.png)\n",
    );
  });

  it("from step 10 the images are indented by the wider marker, so they stay in the item", () => {
    const steps = Array.from({ length: 10 }, (_, i) => step(`Step ${i + 1}.`, `s${i + 1}`));
    const out = blocksToMarkdown(steps);
    expect(out).toContain("9. Step 9.\n\n   ![s9](img/s9.png)\n\n10. Step 10.");
    expect(out.endsWith("10. Step 10.\n\n    ![s10](img/s10.png)\n")).toBe(true);
  });

  it("a page may start with a step and end with a say", () => {
    const out = blocksToMarkdown([step("Go.", "s", "x"), say("Done.")]);
    expect(out).toBe("1. Go.\n\n   ![x](img/s.png)\n\nDone.\n");
  });

  it("image links are the shot's src", () => {
    const linked: Block = {
      kind: "step",
      text: "Go.",
      shots: [{ name: "01-a", alt: "x", images: [{ src: "../img/01-a.png", regions: [] }] }],
    };
    expect(blocksToMarkdown([linked])).toContain("![x](../img/01-a.png)");
  });

  it("a step without a shot is only its numbered text", () => {
    const out = blocksToMarkdown([
      step("Open it.", "a", "A"),
      { kind: "step", text: "Wait.", shots: [] },
      step("Click.", "c"),
    ]);
    expect(out).toBe(
      "1. Open it.\n\n   ![A](img/a.png)\n\n2. Wait.\n\n3. Click.\n\n   ![c](img/c.png)\n",
    );
  });

  it("a step with several shots lists their images in order", () => {
    const out = blocksToMarkdown([
      { kind: "step", text: "Open it.", shots: [shot("a", "A"), shot("b", "B")] },
      { kind: "step", text: "Wait.", shots: [] },
    ]);
    expect(out).toBe("1. Open it.\n\n   ![A](img/a.png)\n\n   ![B](img/b.png)\n\n2. Wait.\n");
  });

  it("no blocks gives an empty string", () => {
    expect(blocksToMarkdown([])).toBe("");
  });

  it("a shot in several variants is a picture whose variant without media is the img", () => {
    const out = blocksToMarkdown(
      [{ kind: "step", text: "Open it.", shots: [responsive("a", "A")] }],
      MEDIA,
    );
    expect(out).toBe(
      [
        "1. Open it.",
        "",
        "   <picture>",
        '     <source media="(max-width: 640px)" srcset="img/mobile/a.png">',
        '     <img src="img/desktop/a.png" alt="A">',
        "   </picture>",
        "",
      ].join("\n"),
    );
  });

  it("sources keep the order of the images", () => {
    const shot: Shot = {
      name: "a",
      alt: "A",
      images: [
        { variant: "phone", src: "p.png", regions: [] },
        { variant: "desktop", src: "d.png", regions: [] },
        { variant: "tablet", src: "t.png", regions: [] },
      ],
    };
    const out = blocksToMarkdown([{ kind: "step", text: "Go.", shots: [shot] }], {
      media: { tablet: "(max-width: 1024px)", phone: "(max-width: 640px)" },
    });
    expect(out).toContain(
      '<source media="(max-width: 640px)" srcset="p.png">\n     <source media="(max-width: 1024px)" srcset="t.png">\n     <img src="d.png" alt="A">',
    );
  });

  it("escapes the alt and links of a picture", () => {
    const shot: Shot = {
      name: "a",
      alt: 'The "Save" & <Close> buttons',
      images: [
        { variant: "desktop", src: "a&b.png", regions: [] },
        { variant: "mobile", src: 'm".png', regions: [] },
      ],
    };
    const out = blocksToMarkdown([{ kind: "step", text: "Go.", shots: [shot] }], MEDIA);
    expect(out).toContain('srcset="m&quot;.png"');
    expect(out).toContain(
      '<img src="a&amp;b.png" alt="The &quot;Save&quot; &amp; &lt;Close> buttons">',
    );
  });

  it("a shot in several variants needs exactly one variant without media", () => {
    const blocks: Block[] = [{ kind: "step", text: "Go.", shots: [responsive("a")] }];
    expect(() => blocksToMarkdown(blocks)).toThrow(
      'shot "a" has images for variants desktop, mobile; give media for all but one of them',
    );
    expect(() =>
      blocksToMarkdown(blocks, {
        media: { desktop: "(min-width: 641px)", mobile: "(max-width: 640px)" },
      }),
    ).toThrow(
      'shot "a" has images for variants desktop, mobile; give media for all but one of them',
    );
  });
});
