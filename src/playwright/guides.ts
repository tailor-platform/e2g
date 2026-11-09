import { AsyncLocalStorage } from "node:async_hooks";
import {
  expect,
  test as base,
  type Location,
  type Page,
  type TestDetails,
  type TestInfo,
  type TestStepInfo,
} from "@playwright/test";
import { callerLocation } from "./location.js";
import { captureShot, type ShotOptions } from "./shot.js";
import { ANNOTATION, PNG_PREFIX, SAY, SHOT, STEP, TAG } from "./protocol.js";
import type { Locale, Meta, Text } from "../types.js";
import type { GuideOptions, GuideShotSettings } from "./use.js";

export interface GuideStepDetails {
  box?: boolean;
  timeout?: number;
  location?: Location;
}

export interface Guide {
  /** A numbered step of the guide page; shots taken in its body belong to it. */
  step<T>(title: Text, body: () => Promise<T>, details?: GuideStepDetails): Promise<T>;
  /** A paragraph of the guide page, between steps. */
  say(text: Text): Promise<void>;
  /** A screenshot of the page, shown under the running step. */
  shot(name: string, opts: ShotOptions): Promise<void>;
}

interface RunningStep {
  step: TestStepInfo;
  info: TestInfo;
  done: boolean;
}

// set inside a guide step's body, so only calls made from within it see it, not concurrent siblings
const running = new AsyncLocalStorage<RunningStep>();

export function guidePage(slug: string, meta: Meta, details: TestDetails = {}): TestDetails {
  const tag = [details.tag ?? []].flat();
  return {
    ...details,
    tag: tag.includes(TAG) ? tag : [...tag, TAG],
    annotation: [
      ...[details.annotation ?? []].flat(),
      { type: ANNOTATION, description: JSON.stringify({ slug, meta }) },
    ],
  };
}

const textsOf = (text: Text): string[] =>
  typeof text === "string" ? [text] : Object.values(text as Record<string, string>);

// a run without guideLocale is a normal e2e run, where a text is only shown in reports: its first locale is used
function resolve(fn: string, text: Text, locale: string | undefined): string {
  if (typeof text === "string") return text;
  const texts = text as Record<string, string | undefined>;
  const found = locale === undefined ? Object.values(texts)[0] : texts[locale];
  if (typeof found !== "string")
    throw new Error(locale === undefined ? `${fn} has no text` : `${fn} has no "${locale}" text`);
  return found;
}

function dedent(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
  while (lines.length > 0 && !lines.at(-1)!.trim()) lines.pop();
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)![0].length),
  );
  return lines.map((line) => line.slice(indent)).join("\n");
}

const located = (location: Location | undefined) => (location ? { location } : {});

interface GuideContext {
  info: TestInfo;
  page: Page;
  locale: Locale | undefined;
  shots: boolean;
  shotSettings: GuideShotSettings;
}

function createGuide({ info, page, locale, shots, shotSettings }: GuideContext): Guide {
  const names = new Set<string>();
  const inGuideRun = locale !== undefined;

  const check = (fn: string) => {
    let now: TestInfo | undefined;
    try {
      now = base.info();
    } catch {
      now = undefined;
    }
    if (now !== info) throw new Error(`${fn} must be called while its test runs`);
  };
  const openStep = () => {
    const step = running.getStore();
    return step && step.info === info && !step.done ? step : undefined;
  };

  return {
    async step(title, body, details = {}) {
      const location = details.location ?? callerLocation();
      check("guide.step()");
      if (openStep()) throw new Error("guide.step() cannot be called inside guide.step()");
      // the title is one numbered list item in the page, in every locale
      if (textsOf(title).some((t) => /[\r\n]/.test(t)))
        throw new Error("guide.step() title must be a single line");
      const text = resolve("guide.step()", title, locale);
      return base.step(
        text,
        (step) => {
          const current: RunningStep = { step, info, done: false };
          return running.run(current, async () => {
            try {
              if (inGuideRun) await step.attach(STEP, { body: "", contentType: "text/plain" });
              return await body();
            } finally {
              current.done = true;
            }
          });
        },
        { ...details, ...located(location) },
      );
    },

    async say(text) {
      const location = callerLocation();
      check("guide.say()");
      // a paragraph closes the numbered list, so it cannot sit inside a step
      if (openStep()) throw new Error("guide.say() cannot be called inside guide.step()");
      if (textsOf(text).some((t) => !t.trim())) throw new Error("guide.say() needs some text");
      const body = dedent(resolve("guide.say()", text, locale));
      await base.step(
        body.split("\n")[0]!,
        async (step) => {
          if (inGuideRun) await step.attach(SAY, { body, contentType: "text/markdown" });
        },
        { box: true, ...located(location) },
      );
    },

    async shot(name, opts) {
      check("guide.shot()");
      const current = running.getStore();
      if (!current || current.info !== info)
        throw new Error("guide.shot() must be called inside guide.step()");
      if (current.done) throw new Error("guide.shot() was called after its guide.step() finished");
      if (!/^[\w.-]+$/.test(name) || name.includes(".."))
        throw new Error(`shot name "${name}" may contain only letters, digits, ".", "_" and "-"`);
      if (names.has(name)) throw new Error(`shot "${name}" is already taken`);
      const alt = resolve("guide.shot() alt", opts.alt, locale);
      if (!inGuideRun) {
        names.add(name);
        return;
      }
      for (const l of [opts.highlight ?? []].flat()) await expect(l).toBeVisible();
      if (opts.crop) await expect(opts.crop).toBeVisible();
      names.add(name);
      await current.step.attach(SHOT, {
        body: JSON.stringify({ name, alt }),
        contentType: "application/json",
      });
      if (!shots) return;
      const png = await captureShot(opts.page ?? page, opts, shotSettings);
      await current.step.attach(PNG_PREFIX + name, { body: png, contentType: "image/png" });
    },
  };
}

export const guideTest = base.extend<{ guide: Guide } & GuideOptions>({
  guideLocale: [undefined, { option: true }],
  guideShots: [false, { option: true }],
  guideShot: [{}, { option: true }],
  guideClock: ["fixed", { option: true }],
  // frozen as the context is made, before any hook or test opens a page in it
  context: async ({ context, guideLocale, guideClock }, use) => {
    if (guideLocale !== undefined && guideClock !== false)
      await context.clock.setFixedTime(guideClock === "fixed" ? Date.now() : guideClock);
    await use(context);
  },
  guide: async ({ page, guideLocale, guideShots, guideShot }, use, info) => {
    await use(
      createGuide({ info, page, locale: guideLocale, shots: guideShots, shotSettings: guideShot }),
    );
  },
});
