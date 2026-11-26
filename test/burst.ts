import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/burst.mjs", import.meta.url));
const MAX_BLOCK_MS = 1_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The burst's command, and a function that blocks the event loop while it is written and the
// child exits, which leaves the whole burst unread in the pty when the slave hangs up.
export function burst(): { command: string; whileBlocked: () => Promise<void> } {
  const dir = mkdtempSync(join(tmpdir(), "e2g-burst-"));
  return {
    command: `exec node ${fixture} ${dir}`,
    async whileBlocked() {
      try {
        while (!existsSync(join(dir, "pid"))) await new Promise((r) => setTimeout(r, 10));
        const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
        writeFileSync(join(dir, "go"), "");
        // where the pty buffer is smaller than the burst (macOS), the child waits for a read instead
        const until = Date.now() + MAX_BLOCK_MS;
        while (alive(pid) && Date.now() < until);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
