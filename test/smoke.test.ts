import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect as playwrightExpect } from "@playwright/test";
import { expect, test } from "vitest";
import * as root from "../src/index.ts";
import * as lib from "../src/playwright/index.ts";

const SRC = join(import.meta.dirname, "../src");

test("the root entry point has types only", () => {
  expect(Object.keys(root)).toEqual([]);
});

test("the playwright entry point loads", () => {
  expect(Object.keys(lib).sort()).toEqual(["expect", "guidePage", "guideTest", "test"]);
  expect(typeof lib.guidePage).toBe("function");
});

test("test is guideTest and expect is Playwright's", () => {
  expect(lib.test).toBe(lib.guideTest);
  expect(lib.expect).toBe(playwrightExpect);
});

test("only src/playwright imports Playwright", () => {
  const runnerFree = readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts") && !path.startsWith("playwright"))
    .filter((path) => readFileSync(join(SRC, path), "utf8").includes("@playwright/"));
  expect(runnerFree).toEqual([]);
});
