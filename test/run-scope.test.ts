import type { FullConfig, FullProject } from "@playwright/test/reporter";
import { describe, expect, it } from "vitest";
import { runScope } from "../src/playwright/reporter/run-scope.js";

function fakeRun(
  opts: {
    argv?: string[];
    shard?: boolean;
    maxFailures?: number;
    repeatEach?: number;
    grep?: RegExp;
    grepInvert?: RegExp | null;
    forbidOnly?: boolean;
  } = {},
) {
  const project = {
    name: "en",
    grep: opts.grep ?? /@guide/,
    grepInvert: opts.grepInvert ?? null,
    repeatEach: opts.repeatEach ?? 1,
  } as unknown as FullProject;
  const config = {
    shard: opts.shard ? { current: 1, total: 2 } : null,
    maxFailures: opts.maxFailures ?? 0,
    forbidOnly: opts.forbidOnly ?? true,
    argv: ["node", "playwright", "test", ...(opts.argv ?? [])],
  } as unknown as FullConfig;
  return { config, project };
}

const scope = (opts?: Parameters<typeof fakeRun>[0]) => {
  const { config, project } = fakeRun(opts);
  return runScope(config, project);
};

describe("runScope", () => {
  it("full run", () => {
    expect(scope()).toEqual({ partial: false });
  });

  it("sharded", () => {
    expect(scope({ shard: true })).toEqual({ partial: true, reason: "the run is sharded" });
  });

  it("forbidOnly off is partial, since a .only run cannot be ruled out", () => {
    expect(scope({ forbidOnly: false })).toEqual({
      partial: true,
      reason: "forbidOnly is off, so a .only run cannot be ruled out",
    });
  });

  it("repeat-each 2", () => {
    expect(scope({ repeatEach: 2 })).toEqual({ partial: true, reason: "tests repeat 2 times" });
  });

  it.each([
    [["-g", "x"], "-g"],
    [["-gx"], "-gx"],
    [["--grep=x"], "--grep"],
    [["--grep-invert", "x"], "--grep-invert"],
    [["--last-failed"], "--last-failed"],
    [["--only-changed"], "--only-changed"],
    [["--test-list=list.txt"], "--test-list"],
    [["-G", "x"], "-G"],
    [["--test-list-invert=list.txt"], "--test-list-invert"],
    [["-x"], "-x"],
    [["--max-failures=3"], "--max-failures"],
    [["--max-failures", "3"], "--max-failures"],
    [["--debug"], "--debug"],
    [["--list"], "--list"],
  ])("argv %j", (argv, flag) => {
    expect(scope({ argv })).toEqual({ partial: true, reason: `${flag} was passed` });
  });

  it("file:line location", () => {
    expect(scope({ argv: ["a.spec.ts:3"] })).toEqual({
      partial: true,
      reason: "a test location a.spec.ts:3 was passed",
    });
  });

  it.each([
    [["menu.spec.ts"], "menu.spec.ts"],
    [["--workers", "2", "menu"], "menu"],
    [["--project=en", "menu"], "menu"],
    [["--headed", "menu"], "menu"],
    // commander takes a negative number as an operand, not an option
    [["-2"], "-2"],
    [["--headed", "-2"], "-2"],
    // an option this does not know is taken as a flag, so its value is a filter: partial by mistake, never full
    [["--some-new-option", "value"], "value"],
  ])("a test file filter in %j", (argv, filter) => {
    expect(scope({ argv })).toEqual({
      partial: true,
      reason: `a test file filter ${filter} was passed`,
    });
  });

  it.each([
    [["--project", "en", "ja"]],
    [["--project", "en", "--workers", "2"]],
    [["-c", "guides.config.ts", "-j", "2", "--reporter", "list"]],
    [["--config=guides.config.ts", "-j2"]],
    [["--shuffle", "42"]],
    [["--shuffle", "--headed"]],
    [["--update-snapshots", "all"]],
    [["--trace", "on", "--retries", "1"]],
  ])("option values in %j are not test filters", (argv) => {
    expect(scope({ argv })).toEqual({ partial: false });
  });

  it("arguments after -- are ignored", () => {
    expect(scope({ argv: ["--", "--grep=x", "a.spec.ts:3", "menu"] })).toEqual({
      partial: false,
    });
  });

  it.each([["--ui"], ["--ui-host=0.0.0.0"], ["--ui-port", "0"]])(
    "test server via %s",
    (...argv) => {
      expect(scope({ argv })).toEqual({
        partial: true,
        reason: "it runs from the test server (UI mode or an editor)",
      });
    },
  );

  it("test server is partial with the test-server subcommand", () => {
    const { config, project } = fakeRun();
    (config as { argv: string[] }).argv = ["node", "playwright", "test-server"];
    expect(runScope(config, project)).toEqual({
      partial: true,
      reason: "it runs from the test server (UI mode or an editor)",
    });
  });

  it.each([[/.*/], [/@guide/i], [/@guide|@smoke/], [/guide/]])("project grep %s", (grep) => {
    expect(scope({ grep })).toEqual({
      partial: true,
      reason: 'project "en" does not set grep: /@guide/',
    });
  });

  it("project grepInvert", () => {
    expect(scope({ grepInvert: /slow/ })).toEqual({
      partial: true,
      reason: 'project "en" sets grepInvert',
    });
  });

  it("maxFailures from the config file", () => {
    expect(scope({ maxFailures: 2 })).toEqual({
      partial: true,
      reason: "maxFailures stops the run early",
    });
  });

  it("an empty argv was not started by playwright test", () => {
    const { config, project } = fakeRun();
    (config as { argv: string[] }).argv = [];
    expect(runScope(config, project)).toEqual({
      partial: true,
      reason: 'it was not started by "playwright test"',
    });
  });

  it.each([["test-server"], ["--ui"]])("test server found only in process.argv (%s)", (arg) => {
    const original = process.argv;
    process.argv = ["node", "playwright", arg];
    try {
      expect(scope()).toEqual({
        partial: true,
        reason: "it runs from the test server (UI mode or an editor)",
      });
    } finally {
      process.argv = original;
    }
  });
});
