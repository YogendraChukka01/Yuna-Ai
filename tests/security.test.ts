import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { containsSecret, MemoryStore } from "../agent/memory/store";
import { Store } from "../agent/runtime/store";
import { validateDynamicParam } from "../agent/tools/shell/executor";
import { ClientMessage, MessageRateLimiter } from "../agent/server-validation";
import { toSendKeys } from "../agent/tools/computer/tools";

describe("memory secret filtering", () => {
  it("rejects API keys, tokens, private keys and passwords on save", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuna-memory-"));
    const store = new Store(dir);
    const memory = new MemoryStore(store.db);
    for (const content of [
      "api_key=abcdefghijkl",
      "bearer abcdefghijkl",
      "-----BEGIN PRIVATE KEY-----",
      "my password is hunter2",
      "sk-live_abcdefghijkl",
    ]) {
      expect(await memory.save({ category:"FACT", content })).toBeNull();
    }
    store.close();
  });

  it("rejects secrets on update", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuna-memory-update-"));
    const store = new Store(dir);
    const memory = new MemoryStore(store.db);
    const saved = await memory.save({ category:"FACT", content:"Likes concise answers" });
    expect(saved).not.toBeNull();
    await memory.update(saved!.id, { content:"password=hunter2" });
    expect((await memory.list())[0].content).toBe("Likes concise answers");
    store.close();
  });

  it("uses one secret predicate", () => {
    expect(containsSecret("API_KEY=abc")).toBe(true);
    expect(containsSecret("A normal preference")).toBe(false);
  });
});

describe("PowerShell dynamic parameters", () => {
  it("rejects quotes, shell metacharacters and control characters", () => {
    for (const value of ["a';exit 1", '$(Get-Process)', "`danger", "semi;dir"]) {
      expect(() => validateDynamicParam(value, "name")).not.toThrow();
    }
    expect(() => validateDynamicParam("line1\nline2", "name")).toThrow();
  });
  it("rejects unsafe SendKeys names and combinations", () => {
    for (const value of ["a';exit 1", "$(Get-Process)", "`danger", "a\nb", "win"]) {
      expect(toSendKeys([value])).toBeNull();
    }
  });
});

describe("WebSocket message validation", () => {
  it("rejects malformed shapes and unknown types", () => {
    expect(ClientMessage.safeParse({ type:"unknown" }).success).toBe(false);
    expect(ClientMessage.safeParse({ type:"task", text:42 }).success).toBe(false);
    expect(ClientMessage.safeParse({ type:"stop", taskId:12 }).success).toBe(false);
  });
  it("accepts valid messages and rejects oversized text", () => {
    expect(ClientMessage.safeParse({ type:"task", text:"hello", inputType:"chat" }).success).toBe(true);
    expect(ClientMessage.safeParse({ type:"task", text:"x".repeat(20_001) }).success).toBe(false);
  });
  it("rate limits floods", () => {
    const limiter = new MessageRateLimiter(3, 1000, 100);
    expect(limiter.allow(100)).toBe(true);
    expect(limiter.allow(101)).toBe(true);
    expect(limiter.allow(102)).toBe(true);
    expect(limiter.allow(103)).toBe(false);
    expect(limiter.allow(1200)).toBe(true);
  });
});
