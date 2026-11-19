import type { Text } from "../types.js";

export const textsOf = (text: Text): string[] =>
  typeof text === "string" ? [text] : Object.values(text as Record<string, string>);

// a run without guideLocale is a normal test run, where a text is only shown in reports: its first locale is used
export function resolve(fn: string, text: Text, locale: string | undefined): string {
  if (typeof text === "string") return text;
  const texts = text as Record<string, string | undefined>;
  const found = locale === undefined ? Object.values(texts)[0] : texts[locale];
  if (typeof found !== "string")
    throw new Error(locale === undefined ? `${fn} has no text` : `${fn} has no "${locale}" text`);
  return found;
}

export function dedent(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
  while (lines.length > 0 && !lines.at(-1)!.trim()) lines.pop();
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)![0].length),
  );
  return lines.map((line) => line.slice(indent)).join("\n");
}

// shot and screen names become file names, so they must stay inside one directory
export function checkName(kind: "shot" | "screen", name: string): void {
  if (!/^[\w.-]+$/.test(name) || name.includes(".."))
    throw new Error(`${kind} name "${name}" may contain only letters, digits, ".", "_" and "-"`);
}
