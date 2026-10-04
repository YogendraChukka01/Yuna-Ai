import { describe, expect, it } from "vitest";
import { evaluate } from "../agent/runtime/policy";
import { LoopGuard } from "../agent/runtime/loop-guard";
import { parseDecision } from "../agent/runtime/prompts";

const S = { confirmMedium: false, allowedRoots: [] as string[] };

describe("policy engine", () => {
  it("allows low-risk tools", () => expect(evaluate("browser.open", { url: "x" }, "low", S).action).toBe("allow"));
  it("always confirms file.delete (high)", () => expect(evaluate("file.delete", { path: process.cwd() + "/x" }, "high", S).action).toBe("confirm"));
  it("denies catastrophic shell", () => expect(evaluate("shell.execute", { command: "shutdown /s /t 0" }, "medium", S).action).toBe("deny"));
  it("confirms destructive shell", () => expect(evaluate("shell.execute", { command: "rm -rf ./build" }, "medium", S).action).toBe("confirm"));
  it("confirms purchase-looking clicks", () => expect(evaluate("browser.click", { text: "Place order" }, "low", S).action).toBe("confirm"));
  it("honours confirmMedium setting", () => expect(evaluate("shell.execute", { command: "dir" }, "medium", { ...S, confirmMedium: true }).action).toBe("confirm"));
});

describe("loop guard", () => {
  it("flags 3 identical actions", () => { const g = new LoopGuard(3); g.record("a", true); g.record("a", true); expect(g.record("a", true)).toBe("replan"); });
  it("flags A-B-A-B-A", () => { const g = new LoopGuard(3); const r = ["a", "b", "a", "b", "a"].map((s) => g.record(s, true)); expect(r[4]).toBe("replan"); });
  it("flags repeated failures of same tool with varying args", () => { const g = new LoopGuard(3); g.record("t|1", false); g.record("t|2", false); expect(g.record("t|3", false)).toBe("replan"); });
  it("escalates to stop", () => { const g = new LoopGuard(3); let last = "ok"; for (let i = 0; i < 9; i++) last = g.record("a", true); expect(last).toBe("stop"); });
});

describe("decision parsing", () => {
  it("parses a tool call wrapped in prose/fences", () => { const r = parseDecision('```json\n{"type":"tool_call","tool":"browser.open","arguments":{"url":"google.com"}}\n```'); expect(r.ok).toBe(true); });
  it("rejects garbage", () => expect(parseDecision("sure!").ok).toBe(false));
  it("rejects unknown decision type", () => expect(parseDecision('{"type":"dance"}').ok).toBe(false));
});
