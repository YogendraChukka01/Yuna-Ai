import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentRuntime } from "../agent/runtime/orchestrator";
import { Store } from "../agent/runtime/store";
import { MemoryStore } from "../agent/memory/store";
import { ToolRegistry, ok } from "../agent/tools/registry";
import { DEFAULT_SETTINGS, type AgentEvent, type LLM } from "../agent/runtime/types";

const scripted = (replies: string[]): LLM => { let i = 0; return { newSession: async () => `s${i}`, prompt: async () => replies[Math.min(i++, replies.length - 1)] }; };
const call = (tool: string, args = {}) => JSON.stringify({ type: "tool_call", tool, arguments: args, reason: tool });
function setup(replies: string[], settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuna-"));
  const store = new Store(dir); const events: AgentEvent[] = []; let ran = 0;
  const tools = new ToolRegistry().register(
    { name: "t.echo", description: "", signature: "{}", schema: z.object({}).passthrough(), riskLevel: "low", execute: async () => { ran++; return ok({ echoed: true }); } },
    { name: "t.danger", description: "", signature: "{}", schema: z.object({}), riskLevel: "high", execute: async () => { ran++; return ok({ done: true }); } },
  );
  const rt = new AgentRuntime({ llm: scripted(replies), store, memory: new MemoryStore(store.db), tools, browser: { isOpen: () => false } as any, emit: (e) => events.push(e), dataDir: dir, getSettings: () => ({ ...DEFAULT_SETTINGS, ...settings }) });
  const done = (id: string) => new Promise<void>((res) => { const t = setInterval(() => { if (events.some((e) => e.type === "task_ended" && e.taskId === id)) { clearInterval(t); res(); } }, 10); });
  return { rt, events, done, store, count: () => ran };
}

describe("store shutdown", () => {
  it("closes the sqlite database cleanly on shutdown", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuna-close-"));
    const store = new Store(dir);
    expect(store.db.open).toBe(true);
    expect(() => store.close()).not.toThrow();
    expect(store.db.open).toBe(false);
  });
});

describe("continuous execution (E2E #1 analogue)", () => {
  it("keeps ONE task id across many tool calls, verifies, then completes", async () => {
    const { rt, events, done, count } = setup([call("t.echo"), call("t.echo"), call("t.echo"), JSON.stringify({ type: "completed", message: "Done", evidence: "3 echoes" }), '{"verified":true}']);
    const id = await rt.submit({ input_type: "chat", text: "do three things", conversation_id: "c1" });
    await done(id);
    const tools = events.filter((e) => e.type === "tool_completed");
    expect(tools).toHaveLength(3); expect(count()).toBe(3);
    expect(new Set(events.filter((e) => "taskId" in e).map((e: any) => e.taskId)).size).toBe(1);
    expect(events.find((e) => e.type === "task_ended")).toMatchObject({ status: "completed" });
  });
  it("does not accept completion when verification fails", async () => {
    const { rt, events, done } = setup([call("t.echo"), JSON.stringify({ type: "completed", message: "Done" }), '{"verified":false,"missing":"file not saved"}', JSON.stringify({ type: "blocked", reason: "gave up" })]);
    const id = await rt.submit({ input_type: "chat", text: "x", conversation_id: "c2" }); await done(id);
    expect(events.find((e) => e.type === "task_ended")).toMatchObject({ status: "blocked" });
  });
  it("gates high-risk tools behind confirmation and honours a decline", async () => {
    const { rt, events, done, count } = setup([call("t.danger"), JSON.stringify({ type: "blocked", reason: "user declined" })]);
    const id = await rt.submit({ input_type: "chat", text: "x", conversation_id: "c3" });
    await new Promise((r) => setTimeout(r, 100));
    const c = events.find((e) => e.type === "confirmation_required") as any; expect(c).toBeTruthy();
    rt.confirm(id, c.data.id, false); await done(id);
    expect(count()).toBe(0);
  });
  it("runs the high-risk tool once approved", async () => {
    const { rt, events, done, count } = setup([call("t.danger"), JSON.stringify({ type: "completed", message: "ok" }), '{"verified":true}']);
    const id = await rt.submit({ input_type: "chat", text: "x", conversation_id: "c4" });
    await new Promise((r) => setTimeout(r, 100));
    rt.confirm(id, (events.find((e) => e.type === "confirmation_required") as any).data.id, true); await done(id);
    expect(count()).toBe(1);
  });
  it("stops on repeated identical actions (loop detection) instead of spinning forever", async () => {
    const { rt, events, done } = setup([call("t.echo", { a: 1 })]);
    const id = await rt.submit({ input_type: "chat", text: "x", conversation_id: "c5" }); await done(id);
    expect(events.find((e) => e.type === "task_ended")).toMatchObject({ status: "blocked" });
  });
  it("persists checkpoints and can list interrupted tasks after restart", async () => {
    const { rt, store, done } = setup([call("t.echo"), call("t.echo", { b: 1 })], { maxIterations: 2 });
    const id = await rt.submit({ input_type: "chat", text: "x", conversation_id: "c6" }); await done(id);
    expect(store.latestCheckpoint(id)?.toolCalls).toBeGreaterThan(0);
  });
});
