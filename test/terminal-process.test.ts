import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderTerminal, Terminal } from "../src/terminal/index.js";
import { burst } from "./burst.js";

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

  it("reports a signal exit as 128 plus the signal number", async () => {
    expect((await make().run("kill -TERM $$")).exitCode).toBe(143);
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

  it("finds node_modules/.bin upward from binFrom, wherever the process runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2g-pty-"));
    try {
      mkdirSync(join(dir, "sub/node_modules/.bin"), { recursive: true });
      mkdirSync(join(dir, "sub/tests/deep"), { recursive: true });
      mkdirSync(join(dir, "elsewhere"));
      writeFileSync(join(dir, "sub/node_modules/.bin/mytool"), "#!/bin/sh\necho from-mytool\n", {
        mode: 0o755,
      });
      const result = await make({
        binFrom: join(dir, "sub/tests/deep"),
        cwd: join(dir, "elsewhere"),
      }).run("mytool");
      expect(result.exitCode).toBe(0);
      expect(await text(result.output)).toBe("from-mytool");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes on only TMPDIR, USER and LOGNAME from the parent, plus env", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      XDG_CONFIG_HOME: "/xdg",
      LC_ALL: "C",
      GITHUB_ACTIONS: "true",
      SECRET_TOKEN: "s3cret",
      NODE_ENV: "test",
      CI: "true",
      VITEST_EXTRA: "1",
      TMPDIR: "/tmp/e2g-tmp",
      USER: "someone",
      LOGNAME: "someone",
    });
    try {
      const keys = [
        "XDG_CONFIG_HOME",
        "LC_ALL",
        "GITHUB_ACTIONS",
        "SECRET_TOKEN",
        "NODE_ENV",
        "CI",
        "VITEST_EXTRA",
        "TMPDIR",
        "USER",
        "LOGNAME",
      ];
      const print = `node -e "console.log(${keys.map((k) => `process.env.${k}`).join(", ")})"`;
      expect(await text((await make().run(print)).output)).toBe(
        "undefined undefined undefined undefined undefined undefined undefined /tmp/e2g-tmp someone someone",
      );
      const back = await make({ env: { CI: "1", SECRET_TOKEN: "given", USER: undefined } }).run(
        print,
      );
      expect(await text(back.output)).toBe(
        "undefined undefined undefined given undefined 1 undefined /tmp/e2g-tmp undefined someone",
      );
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it("keeps all output of a burst", async () => {
    const result = await make().run(
      "node -e \"for (let i = 1; i <= 5000; i++) console.log('line ' + i)\"",
    );
    expect(result.output).toContain("line 5000");
    expect(result.output).toContain("line 1\r\n");
  });

  it("keeps output still unread in the pty when the process exits", async () => {
    const { command, whileBlocked } = burst();
    const pending = make().run(command);
    await whileBlocked();
    const result = await pending;
    expect(result.output).toContain("line 1\r\n");
    expect(result.output.endsWith("line 1000\r\nEND")).toBe(true);
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

  it("dispose waits for a process's shutdown handler and leaves no timers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2g-dispose-"));
    try {
      const marker = join(dir, "done");
      const script = [
        "const stop = () => setTimeout(() => {",
        `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); process.exit(0);`,
        "}, 200);",
        "process.on('SIGHUP', stop); process.on('SIGTERM', stop);",
        "setInterval(() => {}, 1000); console.log('ready');",
      ].join(" ");
      const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
      const before = timers();
      const t = make();
      const session = await t.spawn(`node -e ${JSON.stringify(script)}`);
      await session.waitForText("ready");
      const pid = session.pid;
      await Promise.all([t.dispose(), t.dispose()]);
      expect(existsSync(marker)).toBe(true);
      expect(() => process.kill(pid, 0)).toThrow();
      expect(() => process.kill(-pid, 0)).toThrow();
      // a timer left by an earlier test may finish meanwhile, so only growth is a leak
      expect(timers()).toBeLessThanOrEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dispose kills a process that ignores the hangup", async () => {
    const t = make();
    const script =
      "process.on('SIGHUP', () => {}); setInterval(() => {}, 1000); console.log('ready');";
    const session = await t.spawn(`node -e ${JSON.stringify(script)}`);
    await session.waitForText("ready");
    const pid = session.pid;
    const started = Date.now();
    await t.dispose();
    expect(Date.now() - started).toBeLessThan(4_500);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(() => process.kill(-pid, 0)).toThrow();
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
