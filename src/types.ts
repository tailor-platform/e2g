// what a project registers with `declare module "@tailor-platform/e2g" { interface Register { ... } }`:
// `locales`, the union of its guide locales, `variants`, the union of its guide variants,
// and `meta`, the meta its guide pages take
export interface Register {}

export type Locale = Register extends { locales: infer L extends string } ? L : string;
export type Variant = Register extends { variants: infer V extends string } ? V : string;
export type Meta = Register extends { meta: infer M } ? M : unknown;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

// a text in every registered locale; a single locale needs no record
export type Text = Register extends { locales: infer L extends string }
  ? true extends IsUnion<L>
    ? Record<L, string>
    : string
  : string | Record<string, string>;

// a highlighted element's box in the image, as fractions of the image's width and height
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

// a shot as one test run took it, before the variants of its page are put together
export interface TakenShot {
  name: string;
  alt: string;
  regions: Region[];
}

export interface ShotImage {
  /** The `guideVariant` of the project that took it; absent when no project sets one. */
  variant?: Variant;
  /** The PNG's path relative to the page's directory, with `/` separators. */
  src: string;
  /** The boxes of the shot's `highlight` elements in this image, in their order. */
  regions: Region[];
}

export interface Shot {
  name: string;
  alt: string;
  /** One image per variant, in the order of the projects. */
  images: ShotImage[];
}

// where a guide.step or guide.say was called; `file` is relative to the config's rootDir, with `/` separators
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface CommandItem {
  kind: "command";
  command: string;
  output: string;
}

export interface ScreenImage {
  src: string;
}

export interface ScreenItem<I = ScreenImage> {
  kind: "screen";
  name: string;
  alt: string;
  text: string;
  image: I;
}

export type ShotItem<S = Shot> = { kind: "shot" } & S;

export type Item<S = Shot, I = ScreenImage> = ShotItem<S> | CommandItem | ScreenItem<I>;

export const isShot = <S, I>(item: Item<S, I>): item is ShotItem<S> => item.kind === "shot";

export type Block<S = Shot, I = ScreenImage> =
  | { kind: "say"; text: string; location?: SourceLocation }
  | { kind: "step"; text: string; items: Item<S, I>[]; location?: SourceLocation };

export interface GuideRecord<M = unknown> {
  schemaVersion: 1;
  slug: string;
  locale: string;
  meta: M;
  // a screen's SVG travels beside the record, so its image is null here
  blocks: Block<TakenShot, null>[];
}

export interface Page<M = Meta> {
  slug: string;
  locale: Locale;
  meta: M;
  source: string;
  blocks: Block[];
}
