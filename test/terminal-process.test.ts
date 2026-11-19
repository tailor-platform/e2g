import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderTerminal, Terminal } from "../src/terminal/index.js";

const terminals: Terminal[] = [];
function make(options?: ConstructorParameters<typeof Terminal>[0]): Terminal {
  const t = new Terminal(options);
  terminals.push(t);
  return t;
}
afterEach(async () => {
  await Promise.all(terminals.splice(0).map((t) => t.dispose()));
});

async function text(output: string): Promise<string> {
  return (await renderTerminal(output, { cols: 80 })).text.trim();
}

describe("Terminal.run", () => {
  it("runs through sh with pipes", async () => {
    const result = await make().run("echo hi | tr a-z A-Z");
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("echo hi | tr a-z A-Z");
    expect(await text(result.output)).toBe("HI");
  });

  it("reports the exit code", async () => {
    expect((await make().run("exit 3")).exitCode).toBe(3);
  });

  it("runs as a TTY", async () => {
    const result = await make().run('node -e "process.stdout.write(String(process.stdout.isTTY))"');
    expect(await text(result.output)).toBe("true");
  });

  it("sets the default env", async () => {
    const result = await make().run(
      'node -e "console.log(process.env.TERM, process.env.TZ, process.env.LANG, process.env.COLUMNS)"',
    );
    expect(await text(result.output)).toBe("xterm-256color UTC en_US.UTF-8 80");
  });

  it("applies env overrides and deletes undefined entries", async () => {
    const result = await make({ env: { MYVAR: "x", TZ: undefined } }).run(
      'node -e "console.log(process.env.MYVAR, process.env.TZ)"',
    );
    expect(await text(result.output)).toBe("x undefined");
  });

  it("finds node_modules/.bin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2g-pty-"));
    const original = process.cwd();
    try {
      mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
      writeFileSync(join(dir, "node_modules/.bin/mycli"), "#!/bin/sh\necho from-mycli\n", {
        mode: 0o755,
      });
      process.chdir(dir);
      const result = await make().run("mycli");
      expect(result.exitCode).toBe(0);
      expect(await text(result.output)).toBe("from-mycli");
    } finally {
      process.chdir(original);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps all output of a burst", async () => {
    const result = await make().run(
      "node -e \"for (let i = 1; i <= 5000; i++) console.log('line ' + i)\"",
    );
    expect(result.output).toContain("line 5000");
    expect(result.output).toContain("line 1\r\n");
  });

  it("rejects a run that races with dispose", async () => {
    const t = make();
    const pending = t.run("sleep 30");
    const disposing = t.dispose();
    await expect(pending).rejects.toThrow("disposed");
    await disposing;
  });

  it("kills a running process on dispose", async () => {
    const t = make();
    const pending = t.run("sleep 30");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await t.dispose();
    // Resolving well inside the test timeout proves the 30s sleep was killed.
    await pending;
  });

  it("dispose is safe to call twice", async () => {
    const t = make();
    await t.run("true");
    await t.dispose();
    await t.dispose();
  });
});

describe("Terminal aliases", () => {
  it("replaces a literal split across two chunks", async () => {
    const script =
      "process.stdout.write('at /tmp/some/long'); setTimeout(() => process.stdout.write('/dir/x done'), 5)";
    const result = await make({ aliases: [["/tmp/some/long/dir", "~"]] }).run(
      `node -e "${script}"`,
    );
    expect(result.output).toBe("at ~/x done");
  });

  it("flushes a held partial literal on exit", async () => {
    const result = await make({ aliases: [["/tmp/some/long/dir", "~"]] }).run(
      "printf %s /tmp/some",
    );
    expect(result.output).toBe("/tmp/some");
  });
});
