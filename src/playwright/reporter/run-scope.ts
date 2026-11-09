import type { FullConfig, FullProject } from "@playwright/test/reporter";

import type { RunScope } from "../../core/types.js";

export type { RunScope };

const FILTER_FLAG =
  /^(-g|-G|--grep|--grep-invert|--last-failed|--only-changed|--test-list|--test-list-invert|-x|--max-failures|--debug|--list)(=|$)|^-[gG]./;
const TEST_SERVER_FLAG = /^(--ui|--ui-host|--ui-port)(=|$)|^test-server$/;

// the options of `playwright test` that take a value, by how commander reads it
const WITH_VALUE = new Set([
  "--add-reporter",
  "--browser",
  "-c",
  "--config",
  "-g",
  "--grep",
  "-G",
  "--grep-invert",
  "--global-timeout",
  "-j",
  "--workers",
  "--last-failed-file",
  "--max-failures",
  "--output",
  "--project",
  "--repeat-each",
  "--reporter",
  "--retries",
  "--run-agents",
  "--shard",
  "--test-list",
  "--test-list-invert",
  "--timeout",
  "--trace",
  "--tsconfig",
  "--ui-host",
  "--ui-port",
  "--update-source-method",
]);
const WITH_OPTIONAL_VALUE = new Set([
  "--debug",
  "--only-changed",
  "--shuffle",
  "-u",
  "--update-snapshots",
]);
const WITH_VALUES = new Set(["--project"]);

// commander reads a negative number as an operand, so `playwright test -2` filters files
const NEGATIVE_NUMBER = /^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/;
const isOption = (arg: string) =>
  arg.length > 1 && arg.startsWith("-") && !NEGATIVE_NUMBER.test(arg);

function isGuideGrep(grep: FullProject["grep"]): boolean {
  return grep instanceof RegExp && grep.source === "@guide" && grep.flags === "";
}

function beforeSeparator(argv: string[]): string[] {
  const end = argv.indexOf("--");
  return end < 0 ? argv : argv.slice(0, end);
}

// The test-filter arguments, found the way commander parses `playwright test`. An option not listed
// above is read as a flag, so a value given to it counts as a filter: the run is then partial by
// mistake, never full by mistake.
function testFilters(args: string[]): string[] {
  const filters: string[] = [];
  let variadic = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (variadic && !isOption(arg)) continue;
    variadic = false;
    if (!isOption(arg)) filters.push(arg);
    else if (WITH_VALUE.has(arg)) {
      i += 1;
      variadic = WITH_VALUES.has(arg);
    } else if (WITH_OPTIONAL_VALUE.has(arg) && i + 1 < args.length && !isOption(args[i + 1]!))
      i += 1;
  }
  return filters;
}

// command-line filters reach the runner but not FullProject.grep, so argv is the only trace of them
function cliFilter(args: string[]): string | undefined {
  const flag = args.find((arg) => FILTER_FLAG.test(arg));
  if (flag) return `${flag.split("=")[0]} was passed`;
  const [filter] = testFilters(args);
  if (filter === undefined) return undefined;
  return /:\d+(:\d+)?$/.test(filter)
    ? `a test location ${filter} was passed`
    : `a test file filter ${filter} was passed`;
}

// The test server fills FullConfig.argv only for `playwright test --ui`; an editor's server leaves it
// empty, but it runs the reporter in the same process, so process.argv names the subcommand.
function fromTestServer(config: FullConfig): boolean {
  return [config.argv, process.argv].some((argv) =>
    beforeSeparator(argv).some((arg) => TEST_SERVER_FLAG.test(arg)),
  );
}

/**
 * Decides whether the run covers only part of a guide project's tests, so the reporter must not write
 * or delete pages. `test.only` is not detectable from a reporter, so a run counts as full only when
 * `config.forbidOnly` rules it out.
 */
export function runScope(config: FullConfig, project: FullProject): RunScope {
  const partial = (reason: string): RunScope => ({ partial: true, reason });
  if (config.shard) return partial("the run is sharded");
  // each repeat is its own test with the same annotation, so its blocks would appear repeatEach times
  if (project.repeatEach > 1) return partial(`tests repeat ${project.repeatEach} times`);
  if (fromTestServer(config)) return partial("it runs from the test server (UI mode or an editor)");
  const start = config.argv.indexOf("test");
  if (start < 0) return partial('it was not started by "playwright test"');
  if (config.maxFailures > 0) return partial("maxFailures stops the run early");
  const cli = cliFilter(beforeSeparator(config.argv.slice(start + 1)));
  if (cli) return partial(cli);
  // a guide config runs only the guide tests, so any other grep may leave some of them out
  if (!isGuideGrep(project.grep))
    return partial(`project "${project.name}" does not set grep: /@guide/`);
  if (project.grepInvert) return partial(`project "${project.name}" sets grepInvert`);
  if (!config.forbidOnly) return partial("forbidOnly is off, so a .only run cannot be ruled out");
  return { partial: false };
}
