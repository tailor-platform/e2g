import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, type TestContext, type TestOptions } from "vitest";
import { callerLocation } from "../core/location.js";
import { real } from "../core/real.js";
import { checkName, dedent, resolve, textsOf } from "../core/text.js";
import { renderTerminal } from "../terminal/render.js";
import type { Replacement } from "../terminal/replace.js";
import type { Session } from "../terminal/session.js";
import { Terminal, type TerminalOptions } from "../terminal/terminal.js";
import type { Block, Item, Locale, Meta, SourceLocation, TakenShot, Text } from "../types.js";
import { META_KEY, type GuideMeta, type GuideRecordMeta } from "./protocol.js";
import { reviveTerminal, type SerializedTerminalOptions } from "./settings.js";

export interface CommandResult {
  command: string;
  output: string;
}

export interface CommandOptions {
  /** Replacements for this call, applied after `guideTerminal.replace`. */
  replace?: Replacement[];
}

export interface ScreenOptions {
  alt: Text;
  /** Replacements for this call, applied after the session's own. */
  replace?: Replacement[];
  /** How long the screen must stay unchanged before it is taken, in milliseconds. */
  idle?: number;
  /** How long to wait for the screen to stop changing, in milliseconds. */
  timeout?: number;
}

export interface Guide {
  /** The locale of this guide run; undefined in a normal test run. */
  readonly locale: Locale | undefined;
  /** A numbered step of the guide page; commands and screens recorded in its body belong to it. */
  step<T>(title: Text, body: () => Promise<T>): Promise<T>;
  /** A paragraph of the guide page, between steps. */
  say(text: Text): Promise<void>;
  /** A command and its output, shown under the running step; the output may hold raw terminal escapes. */
  command(result: CommandResult, options?: CommandOptions): Promise<void>;
  /** The session's current screen, shown under the running step once it stops changing. */
  screen(name: string, session: Session, options: ScreenOptions): Promise<void>;
}

export interface GuideFixtures {
  guide: Guide;
  guideLocale: Locale | undefined;
  /** Terminal settings; override with plain options, while the injected value is the serialized form. */
  guideTerminal: TerminalOptions | SerializedTerminalOptions;
  /** A terminal in its own temporary home, with `~` standing for it in recorded output. */
  terminal: Terminal;
}

type Step = Extract<Block<TakenShot, null>, { kind: "step" }>;

interface RunningStep {
  owner: object;
  block: Step;
  done: boolean;
}

// set inside a guide step's body, so only calls made from within it see it, not concurrent tests
const running = new AsyncLocalStorage<RunningStep>();

export function guidePage(slug: string, meta: Meta, options: TestOptions = {}): TestOptions {
  const guide: GuideMeta = { slug, meta };
  return { ...options, meta: { ...options.meta, [META_KEY]: guide } };
}

const located = (location: SourceLocation | undefined) =>
  location ? { location: { ...location, file: real(location.file) } } : {};

interface Recorder {
  guide: Guide;
  finish(): GuideRecordMeta;
}

function createGuide(locale: Locale | undefined, terminal: TerminalOptions): Recorder {
  const owner = {};
  const blocks: Block<TakenShot, null>[] = [];
  const svgs: Record<string, string> = {};
  const names = new Set<string>();
  const inGuideRun = locale !== undefined;
  let open = 0;
  let finished = false;

  const check = (fn: string) => {
    if (finished) throw new Error(`${fn} must be called while its test runs`);
  };
  const openStep = () => {
    const step = running.getStore();
    return step && step.owner === owner && !step.done ? step : undefined;
  };
  const currentStep = (fn: string) => {
    const step = running.getStore();
    if (!step || step.owner !== owner) throw new Error(`${fn} must be called inside guide.step()`);
    if (step.done) throw new Error(`${fn} was called after its guide.step() finished`);
    return step;
  };
  const add = (step: RunningStep, item: Item<TakenShot, null>) => {
    // the step may end while an unawaited call is still rendering, and its item would then be lost
    if (step.done) throw new Error("a guide call finished after its guide.step() did");
    step.block.items.push(item);
  };

  const guide: Guide = {
    locale,

    async step(title, body) {
      const location = callerLocation();
      check("guide.step()");
      if (openStep()) throw new Error("guide.step() cannot be called inside guide.step()");
      // the title is one numbered list item in the page, in every locale
      if (textsOf(title).some((t) => /[\r\n]/.test(t)))
        throw new Error("guide.step() title must be a single line");
      const block: Step = {
        kind: "step",
        text: resolve("guide.step()", title, locale),
        items: [],
        ...located(location),
      };
      if (inGuideRun) blocks.push(block);
      const current: RunningStep = { owner, block, done: false };
      open++;
      try {
        return await running.run(current, body);
      } finally {
        current.done = true;
        open--;
      }
    },

    async say(text) {
      const location = callerLocation();
      check("guide.say()");
      // a paragraph closes the numbered list, so it cannot sit inside a step
      if (openStep()) throw new Error("guide.say() cannot be called inside guide.step()");
      if (textsOf(text).some((t) => !t.trim())) throw new Error("guide.say() needs some text");
      const body = dedent(resolve("guide.say()", text, locale));
      if (inGuideRun) blocks.push({ kind: "say", text: body, ...located(location) });
    },

    async command(result, options = {}) {
      check("guide.command()");
      const step = currentStep("guide.command()");
      if (typeof result?.command !== "string" || typeof result.output !== "string")
        throw new Error("guide.command() needs a string command and output");
      if (!inGuideRun) return;
      const { text } = await renderTerminal(result.output, {
        cols: terminal.cols,
        rows: terminal.rows,
        theme: terminal.theme,
        replace: [...(terminal.replace ?? []), ...(options.replace ?? [])],
      });
      add(step, { kind: "command", command: result.command, output: text });
    },

    async screen(name, session, options) {
      check("guide.screen()");
      const step = currentStep("guide.screen()");
      checkName("screen", name);
      if (names.has(name)) throw new Error(`screen "${name}" is already taken`);
      const alt = resolve("guide.screen() alt", options.alt, locale);
      names.add(name);
      if (!inGuideRun) return;
      const settle: { idle?: number; timeout?: number } = {};
      if (options.idle !== undefined) settle.idle = options.idle;
      if (options.timeout !== undefined) settle.timeout = options.timeout;
      try {
        await session.settle(settle);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`guide.screen("${name}"): ${message}`, { cause: error });
      }
      const { text, svg } = session.capture(options.replace);
      add(step, { kind: "screen", name, alt, text, image: null });
      svgs[name] = svg;
    },
  };

  return {
    guide,
    finish() {
      finished = true;
      return {
        blocks,
        svgs,
        ...(open > 0 ? { problem: "a guide.step() was still running when its test ended" } : {}),
      };
    },
  };
}

type Use<T> = (value: T) => Promise<void>;
type Injected<T> = [T, { injected: true }];

// Spelled out because vitest does not export its Fixtures type. The injected
// options are typed as their plain values: `.extend()` infers a fixture's type
// from both a [value, options] tuple and its value, which would widen it.
export interface GuideFixtureDefinitions {
  guideLocale: GuideFixtures["guideLocale"];
  guideTerminal: GuideFixtures["guideTerminal"];
  terminal: (context: Pick<GuideFixtures, "guideTerminal">, use: Use<Terminal>) => Promise<void>;
  guide: (
    context: Pick<GuideFixtures, "guideLocale" | "guideTerminal"> & Pick<TestContext, "task">,
    use: Use<Guide>,
  ) => Promise<void>;
}

type Definitions = Omit<GuideFixtureDefinitions, "guideLocale" | "guideTerminal"> & {
  guideLocale: Injected<GuideFixtures["guideLocale"]>;
  guideTerminal: Injected<GuideFixtures["guideTerminal"]>;
};

const definitions: Definitions = {
  guideLocale: [undefined, { injected: true }],
  guideTerminal: [{}, { injected: true }],
  terminal: async ({ guideTerminal }, use) => {
    const settings = reviveTerminal(guideTerminal);
    // realpath, so the replacement matches what processes print where tmpdir is a symlink
    const home = await realpath(await mkdtemp(join(tmpdir(), "e2g-terminal-")));
    const cwd = join(home, "project");
    await mkdir(cwd);
    const terminal = new Terminal({
      ...settings,
      home,
      cwd,
      aliases: [[home, "~"], ...(settings.aliases ?? [])],
    });
    try {
      await use(terminal);
    } finally {
      await terminal.dispose();
      await rm(home, { recursive: true, force: true });
    }
  },
  guide: async ({ task, guideLocale, guideTerminal }, use) => {
    const recorder = createGuide(guideLocale, reviveTerminal(guideTerminal));
    try {
      await use(recorder.guide);
    } finally {
      const record = recorder.finish();
      // fixture teardown runs before the test is reported, so the reporter sees the record in the test's meta;
      // task.meta is a shallow copy of the options' meta, so the page entry is replaced, not mutated
      const page = task.meta[META_KEY];
      if (guideLocale !== undefined && page) task.meta[META_KEY] = { ...page, record };
    }
  },
};

/** e2g's fixtures, for a project that adds them to its own extended test with `.extend(guideFixtures)`. */
export const guideFixtures = definitions as unknown as GuideFixtureDefinitions;

export const guideTest = base.extend(guideFixtures);
