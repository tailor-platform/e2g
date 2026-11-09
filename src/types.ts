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

export interface Shot {
  name: string;
  alt: string;
}

export type Block = { kind: "say"; text: string } | { kind: "step"; text: string; shots: Shot[] };

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
