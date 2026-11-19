import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "../src/terminal/index.js";

const picker = fileURLToPath(new URL("./fixtures/picker.mjs", import.meta.url));

const terminals: Terminal[] = [];
function make(options?: ConstructorParameters<typeof Terminal>[0]): Terminal {
  const t = new Terminal(options);
  terminals.push(t);
  return t;
}
afterEach(async () => {
  await Promise.all(terminals.splice(0).map((t) => t.dispose()));
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("Session", () => {
  it("presses keys and reads the screen", async () => {
    const session = await make().spawn(`node ${picker}`);
    await session.waitForText("Choose");
    session.press("ArrowDown");
    await session.settle();
    expect(session.screen()).toContain("❯ b");
    session.press("Enter");
    expect(await session.waitForExit()).toBe(0);
    expect(session.screen()).toContain("chose b");
  });

  it("waitForText times out with the screen in the message", async () => {
    const session = await make().spawn(`node ${picker}`);
    await session.waitForText("Choose");
    const error = await session.waitForText("nope", { timeout: 300 }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/waiting for "nope"/);
    expect((error as Error).message).toContain("❯ a");
  });

  it("waitForText accepts a RegExp", async () => {
    const session = await make().spawn(`node ${picker}`);
    await session.waitForText(/Cho+se/);
  });

  it("waitForText fails fast when the process exits without the text", async () => {
    const session = await make().spawn(`node -e "console.log('bye')"`);
    const started = Date.now();
    const error = await session.waitForText("never", { timeout: 4_000 }).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/exited with code 0/);
    expect((error as Error).message).toMatch(/waiting for "never"/);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("waitForText sees text printed in the last chunk before exit", async () => {
    const session = await make().spawn(
      `node -e "process.stdout.write('filler\\n'.repeat(5000)); process.stdout.write('READY')"`,
    );
    await session.waitForText("READY");
    expect(await session.waitForExit()).toBe(0);
  });

  it("screen settle times out", async () => {
    const session = await make().spawn(
      `node -e "setInterval(() => process.stdout.write('.'), 20)"`,
    );
    // Node startup can outlast the idle window, which would settle before any output.
    await session.waitForText(".");
    await expect(session.settle({ idle: 200, timeout: 500 })).rejects.toThrow(/did not settle/);
  });

  it("dispose kills running sessions", async () => {
    const terminal = make();
    const session = await terminal.spawn(`node -e "setInterval(()=>{},1000)"`);
    const pid = session.pid;
    expect(alive(pid)).toBe(true);
    await terminal.dispose();
    await expect.poll(() => alive(pid)).toBe(false);
  });

  it("capture uses fixed-width replacements", async () => {
    const session = await make().spawn(`echo "id 1a2b3c"`);
    await session.waitForExit();
    expect(session.capture([[/[0-9a-f]{6}/, "XXXXXX"]]).text).toContain("id XXXXXX");
  });

  it("moves down without a carriage return on a bare newline", async () => {
    const session = await make().spawn(`stty -onlcr; printf 'ab\\ncd'`);
    await session.waitForExit();
    expect(session.screen().split("\n")[1]).toBe("  cd");
  });

  it("answers a cursor position query", async () => {
    const script = [
      'process.stdin.setRawMode(true); let got = "";',
      'process.stdin.on("data", (d) => { got += d; const m = /\\x1b\\[(\\d+);(\\d+)R/.exec(got);',
      'if (m) { console.log("cursor at " + m[1] + "," + m[2]); process.exit(0); } });',
      'process.stdout.write("ab\\x1b[6n");',
    ].join(" ");
    const session = await make().spawn(`node -e '${script}'`);
    await session.waitForText("cursor at 1,3", { timeout: 3_000 });
  });

  it("settle waits for a redraw after a key even when the screen was idle", async () => {
    const script = [
      'process.stdin.setRawMode(true); process.stdout.write("ready");',
      'process.stdin.on("data", () => setTimeout(() => process.stdout.write("\\rredrawn"), 50));',
    ].join(" ");
    const session = await make().spawn(`node -e '${script}'`);
    await session.waitForText("ready");
    await new Promise((resolve) => setTimeout(resolve, 250));
    session.press("Space");
    await session.settle();
    expect(session.screen()).toContain("redrawn");
  });

  it("applies terminal replacements in capture", async () => {
    const session = await make({ replace: [["secret", "......"]] }).spawn(`echo "a secret"`);
    await session.waitForExit();
    expect(session.capture().text).toContain("a ......");
  });
});

describe("Session with aliases", () => {
  it("shows a prompt ending in a prefix of the literal without more output", async () => {
    const script = 'process.stdout.write("path/"); process.stdin.resume()';
    const session = await make({ aliases: [["path/to/home", "~"]] }).spawn(`node -e '${script}'`);
    await session.waitForText("path/", { timeout: 1000 });
  });
});
