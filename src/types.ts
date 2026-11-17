// what a project registers with `declare module "@tailor-platform/e2g" { interface Register { ... } }`:
// `locales`, the union of its guide locales, and `meta`, the meta its guide pages take
export interface Register {}

export type Locale = Register extends { locales: infer L extends string } ? L : string;
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

export interface Shot {
  name: string;
  alt: string;
  /** The boxes of the shot's `highlight` elements, in their order. */
  regions: Region[];
}

// where a guide.step or guide.say was called; `file` is relative to the config's rootDir, with `/` separators
export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export type Block =
  | { kind: "say"; text: string; location?: SourceLocation }
  | { kind: "step"; text: string; shots: Shot[]; location?: SourceLocation };

export interface GuideRecord<M = unknown> {
  schemaVersion: 1;
  slug: string;
  locale: string;
  meta: M;
  blocks: Block[];
}

export interface Page<M = Meta> {
  slug: string;
  locale: Locale;
  meta: M;
  source: string;
  blocks: Block[];
}
