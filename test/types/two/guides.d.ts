import type { Text } from "@tailor-platform/e2g";

declare module "@tailor-platform/e2g" {
  interface Register {
    locales: "en" | "ja";
    variants: "desktop" | "mobile";
    meta: { title: Text; sidebar?: { order: number } };
  }
}
