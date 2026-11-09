// tests/guides.d.ts
import type { Text } from "@tailor-platform/e2g";

// your guide locales and the meta of a guide page, for every file tsconfig.json includes
declare module "@tailor-platform/e2g" {
  interface Register {
    locales: "en" | "ja";
    meta: { title: Text; description: Text };
  }
}
