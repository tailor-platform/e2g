import { describe, expect, it } from "vitest";
import { blocksToMarkdown } from "../src/markdown.ts";
import type { Block } from "../src/types.ts";

const image = (s: { name: string }) => `img/${s.name}.png`;
const step = (text: string, name: string, alt = name): Block => ({
  kind: "step",
  text,
  shots: [{ name, alt }],
});
const say = (text: string): Block => ({ kind: "say", text });

describe("blocksToMarkdown", () => {
  it("numbers steps and continues across a say", () => {
    const out = blocksToMarkdown(
      [
        say("Intro"),
        step("Open it.", "a", "A"),
        step("Click.", "b"),
        say("Done"),
        step("Again.", "c"),
      ],
      image,
    );
    expect(out).toBe(
      "Intro\n\n1. Open it.\n\n   ![A](img/a.png)\n\n2. Click.\n\n   ![b](img/b.png)\n\nDone\n\n3. Again.\n\n   ![c](img/c.png)\n",
    );
  });

  it("a heading say resets the numbering", () => {
    const out = blocksToMarkdown(
      [step("A.", "a"), step("B.", "b"), say("## Part two"), step("C.", "c")],
      image,
    );
    expect(out).toBe(
      "1. A.\n\n   ![a](img/a.png)\n\n2. B.\n\n   ![b](img/b.png)\n\n## Part two\n\n1. C.\n\n   ![c](img/c.png)\n",
    );
  });

  it("a page starting with a say starts at 1", () => {
    const out = blocksToMarkdown([say("Intro"), step("A.", "a")], image);
    expect(out).toBe("Intro\n\n1. A.\n\n   ![a](img/a.png)\n");
  });

  it("a paragraph after a heading say does not reset again", () => {
    const out = blocksToMarkdown(
      [step("A.", "a"), say("# Title"), say("Text"), step("B.", "b")],
      image,
    );
    expect(out).toBe(
      "1. A.\n\n   ![a](img/a.png)\n\n# Title\n\nText\n\n1. B.\n\n   ![b](img/b.png)\n",
    );
  });

  it("from step 10 the images are indented by the wider marker, so they stay in the item", () => {
    const steps = Array.from({ length: 10 }, (_, i) => step(`Step ${i + 1}.`, `s${i + 1}`));
    const out = blocksToMarkdown(steps, image);
    expect(out).toContain("9. Step 9.\n\n   ![s9](img/s9.png)\n\n10. Step 10.");
    expect(out.endsWith("10. Step 10.\n\n    ![s10](img/s10.png)\n")).toBe(true);
  });

  it("a page may start with a step and end with a say", () => {
    const out = blocksToMarkdown([step("Go.", "s", "x"), say("Done.")], image);
    expect(out).toBe("1. Go.\n\n   ![x](img/s.png)\n\nDone.\n");
  });

  it("image links come from the image callback", () => {
    expect(blocksToMarkdown([step("Go.", "01-a", "x")], (s) => `../img/${s.name}.png`)).toContain(
      "![x](../img/01-a.png)",
    );
  });

  it("a step without a shot is only its numbered text", () => {
    const out = blocksToMarkdown(
      [step("Open it.", "a", "A"), { kind: "step", text: "Wait.", shots: [] }, step("Click.", "c")],
      image,
    );
    expect(out).toBe(
      "1. Open it.\n\n   ![A](img/a.png)\n\n2. Wait.\n\n3. Click.\n\n   ![c](img/c.png)\n",
    );
  });

  it("a step with several shots lists their images in order", () => {
    const out = blocksToMarkdown(
      [
        {
          kind: "step",
          text: "Open it.",
          shots: [
            { name: "a", alt: "A" },
            { name: "b", alt: "B" },
          ],
        },
        { kind: "step", text: "Wait.", shots: [] },
      ],
      image,
    );
    expect(out).toBe("1. Open it.\n\n   ![A](img/a.png)\n\n   ![B](img/b.png)\n\n2. Wait.\n");
  });

  it("no blocks gives an empty string", () => {
    expect(blocksToMarkdown([], image)).toBe("");
  });
});
