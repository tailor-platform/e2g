import { describe, expect, it } from "vitest";
import { renderTerminal } from "../src/terminal/index.js";
import { loadPty } from "../src/terminal/pty.js";
import { checkPlatform, Terminal, UNSUPPORTED_PLATFORM } from "../src/terminal/terminal.js";

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("loadPty", () => {
  it("maps a missing package to the install hint and keeps the cause", async () => {
    const cause = failure("ERR_MODULE_NOT_FOUND", "Cannot find package '@lydell/node-pty'");
    const error = await loadPty(() => Promise.reject(cause)).catch((e: unknown) => e);
    expect((error as Error).message).toContain("@lydell/node-pty is not installed");
    expect((error as Error).cause).toBe(cause);
  });

  it("rethrows other load failures unchanged", async () => {
    const cause = failure("ERR_DLOPEN_FAILED", "native binary failed to load");
    await expect(loadPty(() => Promise.reject(cause))).rejects.toBe(cause);
  });

  it("does not hide a missing transitive module as not installed", async () => {
    const cause = failure("ERR_MODULE_NOT_FOUND", "Cannot find package 'other'");
    await expect(loadPty(() => Promise.reject(cause))).rejects.toBe(cause);
  });
});

describe("platform", () => {
  it("refuses Windows and accepts macOS and Linux", () => {
    expect(() => checkPlatform("win32")).toThrow(UNSUPPORTED_PLATFORM);
    expect(() => checkPlatform("darwin")).not.toThrow();
    expect(() => checkPlatform("linux")).not.toThrow();
  });

  it("throws on construction on Windows, while renderTerminal still works", async () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...original, value: "win32" });
    try {
      expect(() => new Terminal()).toThrow(
        "@tailor-platform/e2g/terminal runs commands through /bin/sh and supports macOS and Linux only",
      );
      expect((await renderTerminal("hi\r\n")).text.trim()).toBe("hi");
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });
});
