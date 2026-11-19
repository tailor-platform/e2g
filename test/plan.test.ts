import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import type { CollectedPage } from "../src/core/collect.js";
import { plan, type PlanInput } from "../src/core/plan.js";
import type { GuideOutput, Manifest, PageInfo } from "../src/core/types.js";
import type { Page } from "../src/types.js";

const png = (s: string) => Buffer.from(s);
function page(slug: string, shots: string[] = ["menu"], locale = "en"): CollectedPage {
  return {
    slug,
    locale,
    meta: {},
    source: `e2e/${slug}.spec.ts`,
    blocks: shots.map((name) => ({
      kind: "step",
      text: name,
      items: [
        {
          kind: "shot",
          name,
          alt: name,
          images: [{ regions: [], png: png(`${slug}-${name}`) }],
        },
      ],
    })),
  };
}

const output: GuideOutput<unknown> = {
  path: (p) => `/site/docs/${p.locale}/${p.slug}.md`,
  render: (p) =>
    p.blocks
      .map((b) =>
        b.kind === "step"
          ? b.items.flatMap((s) => (s.kind === "shot" ? s.images : []).map((i) => i.src)).join("\n")
          : b.text,
      )
      .join("\n"),
};

const empty: Manifest = { schemaVersion: 1, pages: [], shots: [] };

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    scope: { partial: false },
    prune: false,
    pages: [page("intro")],
    incomplete: [],
    errors: [],
    output,
    shotPath: (p: PageInfo<unknown>, name: string, variant: string | undefined, ext = "png") =>
      `/site/assets/${p.locale}/${p.slug}/${variant ? `${variant}/` : ""}${name}.${ext}`,
    foreign: new Set(),
    manifestDir: "/site/docs",
    manifest: empty,
    current: () => null,
    same: () => false,
    ...over,
  };
}

const writes = (ops: ReturnType<typeof plan>["ops"]) =>
  ops.filter((o) => o.op === "write").map((o) => o.path);
const deletes = (ops: ReturnType<typeof plan>["ops"]) =>
  ops.filter((o) => o.op === "delete").map((o) => o.path);

describe("plan", () => {
  it("partial scope writes nothing", () => {
    const result = plan(
      input({ scope: { partial: true, reason: "the run is sharded" }, prune: true }),
    );
    expect(result).toEqual({
      ops: [],
      manifest: null,
      messages: ["wrote no guide pages because the run is sharded"],
      errors: [],
    });
  });

  it("errors write nothing and are returned apart from the messages", () => {
    const result = plan(
      input({
        errors: ["page intro/en has differing meta"],
        incomplete: ["intro/ja (a test failed, was skipped or did not run)"],
        prune: true,
      }),
    );
    expect(result).toEqual({
      ops: [],
      manifest: null,
      messages: [],
      errors: ["wrote no guide pages because page intro/en has differing meta"],
    });
  });

  it("incomplete pages and prune blockers are messages, not errors", () => {
    const result = plan(input({ incomplete: ["intro/ja"], prune: true }));
    expect(result.errors).toEqual([]);
    expect(result.messages).toEqual([
      "did not write intro/ja",
      "pruned nothing because some pages were not written",
    ]);
  });

  it("writes complete pages and their shots", () => {
    const result = plan(input());
    expect(result.ops).toEqual([
      { op: "write", path: "/site/docs/en/intro.md", data: "../../assets/en/intro/menu.png" },
      { op: "write", path: "/site/assets/en/intro/menu.png", data: png("intro-menu") },
    ]);
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      pages: ["en/intro.md"],
      shots: ["../assets/en/intro/menu.png"],
    });
    expect(result.messages).toEqual([]);
  });

  it("unchanged shots are not rewritten", () => {
    const committed = png("committed");
    const result = plan(
      input({
        current: (path) => (path.endsWith(".png") ? committed : null),
        same: (a, b) => a === committed && b.equals(png("intro-menu")),
      }),
    );
    expect(writes(result.ops)).toEqual(["/site/docs/en/intro.md"]);
    expect(result.manifest?.shots).toEqual(["../assets/en/intro/menu.png"]);
  });

  it("an unchanged page is not rewritten", () => {
    const result = plan(
      input({
        current: (path) =>
          path.endsWith(".md") ? Buffer.from("../../assets/en/intro/menu.png") : null,
      }),
    );
    expect(writes(result.ops)).toEqual(["/site/assets/en/intro/menu.png"]);
  });

  it("a corrupt committed shot is rewritten", () => {
    const result = plan(
      input({
        current: (path) => (path.endsWith(".png") ? png("not a png") : null),
        same: () => {
          throw new Error("invalid file signature");
        },
      }),
    );
    expect(writes(result.ops)).toContain("/site/assets/en/intro/menu.png");
  });

  it("incomplete pages are not written, others are", () => {
    const result = plan(
      input({ pages: [page("intro")], incomplete: ["other/en (a test failed)"] }),
    );
    expect(writes(result.ops)).toEqual([
      "/site/docs/en/intro.md",
      "/site/assets/en/intro/menu.png",
    ]);
    expect(result.messages).toEqual(["did not write other/en (a test failed)"]);
  });

  it("without prune the manifest only grows", () => {
    const old: Manifest = {
      schemaVersion: 1,
      pages: ["en/gone.md"],
      shots: ["../assets/en/gone/x.png"],
    };
    const result = plan(input({ manifest: old }));
    expect(deletes(result.ops)).toEqual([]);
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      pages: ["en/gone.md", "en/intro.md"],
      shots: ["../assets/en/gone/x.png", "../assets/en/intro/menu.png"],
    });
  });

  it("prune deletes manifest entries not produced", () => {
    const old: Manifest = {
      schemaVersion: 1,
      pages: ["en/gone.md", "en/intro.md"],
      shots: [
        "../assets/en/gone/x.png",
        "../assets/en/intro/old.png",
        "../assets/en/intro/menu.png",
      ],
    };
    const result = plan(input({ manifest: old, prune: true }));
    expect(deletes(result.ops)).toEqual([
      "/site/docs/en/gone.md",
      "/site/assets/en/gone/x.png",
      "/site/assets/en/intro/old.png",
    ]);
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      pages: ["en/intro.md"],
      shots: ["../assets/en/intro/menu.png"],
    });
  });

  it("prune with an incomplete page deletes nothing", () => {
    const old: Manifest = { schemaVersion: 1, pages: ["en/gone.md"], shots: [] };
    const result = plan(input({ manifest: old, prune: true, incomplete: ["intro/ja"] }));
    expect(deletes(result.ops)).toEqual([]);
    expect(writes(result.ops)).toContain("/site/docs/en/intro.md");
    expect(result.manifest?.pages).toEqual(["en/gone.md", "en/intro.md"]);
    expect(result.messages).toContain("pruned nothing because some pages were not written");
  });

  it("files not in the manifest are never deleted", () => {
    const result = plan(
      input({
        prune: true,
        manifest: { schemaVersion: 1, pages: ["en/intro.md"], shots: [] },
        current: () => png("hand-written"),
      }),
    );
    expect(deletes(result.ops)).toEqual([]);
  });

  it("prune with no guide pages deletes nothing", () => {
    const old: Manifest = { schemaVersion: 1, pages: ["en/gone.md"], shots: ["../assets/x.png"] };
    const result = plan(input({ prune: true, pages: [], manifest: old }));
    expect(result.ops).toEqual([]);
    expect(result.manifest).toBeNull();
    expect(result.messages).toEqual(["pruned nothing because no guide pages were found"]);
  });

  it("prune never deletes a non-normalized entry for a file it writes", () => {
    const old: Manifest = { schemaVersion: 1, pages: ["./en/intro.md"], shots: [] };
    const result = plan(input({ prune: true, manifest: old }));
    expect(deletes(result.ops)).toEqual([]);
    expect(writes(result.ops)).toContain("/site/docs/en/intro.md");
    expect(result.manifest?.pages).toEqual(["en/intro.md"]);
  });

  it("a case-only rename never deletes after writing", () => {
    const old: Manifest = { schemaVersion: 1, pages: ["en/intro.md"], shots: [] };
    const result = plan(
      input({
        prune: true,
        manifest: old,
        output: { ...output, path: (p) => `/site/docs/${p.locale}/Intro.md` },
      }),
    );
    const write = result.ops.findIndex((o) => o.path === "/site/docs/en/Intro.md");
    const remove = result.ops.findIndex((o) => o.op === "delete");
    expect(write).toBeGreaterThanOrEqual(0);
    expect(deletes(result.ops)).toEqual(["/site/docs/en/intro.md"]);
    expect(remove).toBeLessThan(write);
    expect(result.manifest?.pages).toEqual(["en/Intro.md"]);
  });

  it("a case-only rename rewrites a target that looks unchanged", () => {
    const old: Manifest = {
      schemaVersion: 1,
      pages: ["en/intro.md"],
      shots: ["../assets/en/intro/menu.png"],
    };
    const text = Buffer.from("../../assets/en/intro/Menu.png");
    const result = plan(
      input({
        prune: true,
        manifest: old,
        pages: [page("intro", ["Menu"])],
        output: { ...output, path: (p) => `/site/docs/${p.locale}/Intro.md` },
        // a case-insensitive file system returns the old file for either spelling
        current: (path) => (path.toLowerCase().endsWith(".md") ? text : png("intro-Menu")),
        same: () => true,
      }),
    );
    expect(result.ops.map((o) => [o.op, o.path])).toEqual([
      ["delete", "/site/docs/en/intro.md"],
      ["delete", "/site/assets/en/intro/menu.png"],
      ["write", "/site/docs/en/Intro.md"],
      ["write", "/site/assets/en/intro/Menu.png"],
    ]);
  });

  it("output receives a page whose images have a src and no PNG data", () => {
    const paths: PageInfo<unknown>[] = [];
    const seen: Page<unknown>[] = [];
    plan(
      input({
        output: {
          path: (p) => (paths.push(p), output.path(p)),
          render: (p) => (seen.push(p), output.render(p)),
        },
      }),
    );
    expect(paths.map((p) => Object.keys(p).sort())).toEqual([["locale", "meta", "slug", "source"]]);
    expect(seen).toHaveLength(1);
    for (const p of seen) {
      expect(Object.keys(p).sort()).toEqual(["blocks", "locale", "meta", "slug", "source"]);
      expect(p.blocks).toEqual([
        {
          kind: "step",
          text: "menu",
          items: [
            {
              kind: "shot",
              name: "menu",
              alt: "menu",
              images: [{ src: "../../assets/en/intro/menu.png", regions: [] }],
            },
          ],
        },
      ]);
    }
  });

  it("writes one PNG per variant, at the shot path of its variant", () => {
    const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const responsive: CollectedPage = {
      ...page("intro"),
      blocks: [
        {
          kind: "step",
          text: "Open",
          items: [
            {
              kind: "shot",
              name: "menu",
              alt: "Menu",
              images: [
                { variant: "desktop", regions: [], png: png("d") },
                { variant: "mobile", regions: [region], png: png("m") },
              ],
            },
          ],
        },
      ],
    };
    const seen: Page<unknown>[] = [];
    const result = plan(
      input({
        pages: [responsive],
        output: { ...output, render: (p) => (seen.push(p), output.render(p)) },
      }),
    );
    expect(result.ops).toEqual([
      {
        op: "write",
        path: "/site/docs/en/intro.md",
        data: "../../assets/en/intro/desktop/menu.png\n../../assets/en/intro/mobile/menu.png",
      },
      { op: "write", path: "/site/assets/en/intro/desktop/menu.png", data: png("d") },
      { op: "write", path: "/site/assets/en/intro/mobile/menu.png", data: png("m") },
    ]);
    expect(seen[0]!.blocks[0]).toMatchObject({
      items: [
        {
          kind: "shot",
          images: [
            { variant: "desktop", src: "../../assets/en/intro/desktop/menu.png", regions: [] },
            { variant: "mobile", src: "../../assets/en/intro/mobile/menu.png", regions: [region] },
          ],
        },
      ],
    });
  });

  it("two pages with the same path is an error", () => {
    const result = plan(
      input({
        pages: [page("a"), page("b")],
        output: { ...output, path: (p) => `/site/docs/${p.locale}/same.md` },
      }),
    );
    expect(result.ops).toEqual([]);
    expect(result.manifest).toBeNull();
    expect(result.messages).toEqual([]);
    expect(result.errors).toEqual([
      "wrote no guide pages because pages a/en and b/en both write /site/docs/en/same.md",
    ]);
  });

  it("a page that writes one path twice is an error", () => {
    const responsive: CollectedPage = {
      ...page("intro"),
      blocks: [
        {
          kind: "step",
          text: "Open",
          items: [
            {
              kind: "shot",
              name: "menu",
              alt: "Menu",
              images: [
                { variant: "desktop", regions: [], png: png("d") },
                { variant: "mobile", regions: [], png: png("m") },
              ],
            },
          ],
        },
      ],
    };
    const result = plan(
      input({
        pages: [responsive],
        shotPath: (p, name) => `/site/assets/${p.locale}/${p.slug}/${name}.png`,
      }),
    );
    expect(result.ops).toEqual([]);
    expect(result.manifest).toBeNull();
    expect(result.errors).toEqual([
      "wrote no guide pages because page intro/en writes /site/assets/en/intro/menu.png more than once; give each variant's shots their own path",
    ]);
  });

  it("an image's src is relative to the page's directory", () => {
    const result = plan(
      input({
        output: { ...output, path: (p) => `/site/docs/guides/${p.locale}/deep/${p.slug}.md` },
        shotPath: (p, name) => `/site/docs/guides/${p.locale}/deep/img/${name}.png`,
      }),
    );
    expect(result.ops[0]).toEqual({
      op: "write",
      path: "/site/docs/guides/en/deep/intro.md",
      data: "img/menu.png",
    });
  });

  it("manifest paths use forward slashes", () => {
    const result = plan(
      input({
        output: { ...output, path: (p) => win32.join("C:\\site\\docs", p.locale, `${p.slug}.md`) },
        shotPath: (p, name) => win32.join("C:\\site\\assets", p.locale, p.slug, `${name}.png`),
        manifestDir: "C:\\site\\docs",
        manifest: { schemaVersion: 1, pages: ["en/gone.md"], shots: [] },
        prune: true,
      }),
    );
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      pages: ["en/intro.md"],
      shots: ["../assets/en/intro/menu.png"],
    });
    expect(result.ops.find((o) => o.op === "write")).toMatchObject({
      data: "../../assets/en/intro/menu.png",
    });
    expect(deletes(result.ops)).toEqual(["C:\\site\\docs\\en\\gone.md"]);
  });

  describe("screens", () => {
    const withScreen = (): CollectedPage => ({
      ...page("intro", []),
      blocks: [
        {
          kind: "step",
          text: "Choose",
          items: [
            { kind: "command", command: "tool run", output: "ok" },
            {
              kind: "screen",
              name: "choose",
              alt: "choose",
              text: "ready",
              image: { svg: Buffer.from("<svg/>") },
            },
          ],
        },
      ],
    });
    const screenOutput: GuideOutput<unknown> = {
      ...output,
      render: (p) => JSON.stringify(p.blocks),
    };

    it("writes a screen svg next to the page", () => {
      const result = plan(
        input({
          pages: [withScreen()],
          output: {
            ...screenOutput,
            path: (p) => `/site/docs/${p.locale}/${p.slug}/index.md`,
          },
          shotPath: (p, name, _v, ext) => `/site/docs/${p.locale}/${p.slug}/${name}.${ext}`,
        }),
      );
      expect(result.errors).toEqual([]);
      expect(writes(result.ops)).toContain("/site/docs/en/intro/choose.svg");
      const pageOp = result.ops.find((o) => o.op === "write" && o.path.endsWith("index.md"));
      expect(pageOp).toMatchObject({
        data: expect.stringContaining('"image":{"src":"choose.svg"}'),
      });
      expect(result.manifest?.shots).toEqual(["en/intro/choose.svg"]);
    });

    it("keeps an svg whose bytes match", () => {
      const calls: string[] = [];
      const result = plan(
        input({
          pages: [withScreen()],
          output: screenOutput,
          current: (path) => (path.endsWith(".svg") ? Buffer.from("<svg/>") : null),
          same: (...args) => {
            calls.push(String(args.length));
            return true;
          },
        }),
      );
      expect(writes(result.ops).some((path) => path.endsWith(".svg"))).toBe(false);
      expect(calls).toEqual([]);
    });

    it("rewrites an svg whose bytes differ without asking same", () => {
      const result = plan(
        input({
          pages: [withScreen()],
          output: screenOutput,
          current: (path) => (path.endsWith(".svg") ? Buffer.from("<svg>old</svg>") : null),
          same: () => {
            throw new Error("same is for PNGs");
          },
        }),
      );
      expect(writes(result.ops).some((path) => path.endsWith(".svg"))).toBe(true);
    });

    it("refuses a path another manifest owns", () => {
      const result = plan(
        input({
          pages: [withScreen()],
          output: screenOutput,
          shotPath: (_p, _n, _v, ext) => `/abs/x.${ext}`,
          foreign: new Set(["/abs/x.svg"]),
        }),
      );
      expect(result.ops).toEqual([]);
      expect(result.errors).toEqual([
        "wrote no guide pages because page intro/en writes /abs/x.svg, which another manifest owns",
      ]);
    });
  });
});
