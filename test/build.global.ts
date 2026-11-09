import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// the fixture project imports this package by name, which resolves to dist
export default function setup() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  execFileSync(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
}
