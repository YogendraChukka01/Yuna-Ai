import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

describe("file path policy", () => {
  it("does not match sibling-prefix directories", () => {
    const root = path.join(os.tmpdir(), "yuna-root");
    expect(evaluate("file.write", { path: path.join(root + "-sibling", "a.txt") }, "medium", { confirmMedium: false, allowedRoots: [root] }).action).toBe("confirm");
  });

  it("rejects traversal outside an allowed root", () => {
    const root = path.join(os.tmpdir(), "yuna-root");
    expect(evaluate("file.write", { path: path.join(root, "..", "outside.txt") }, "medium", { confirmMedium: false, allowedRoots: [root] }).action).toBe("confirm");
  });

  it("accepts a child, root itself, and trailing slash", () => {
    const root = path.join(os.tmpdir(), "yuna-root");
    expect(evaluate("file.read", { path: path.join(root, "child.txt") }, "medium", { confirmMedium: false, allowedRoots: [root] }).action).not.toBe("deny");
    expect(evaluate("file.read", { path: root + path.sep }, "medium", { confirmMedium: false, allowedRoots: [root] }).action).not.toBe("deny");
  });

  it("handles mixed separators and Windows drive casing", () => {
    expect(evaluate("file.write", { path: "C:\\Users\\Test\\Docs/../a.txt" }, "medium", { confirmMedium: false, allowedRoots: ["c:\\users\\test"] }).action).not.toBe("deny");
  });

  it("rejects symlinks that escape an allowed root", () => {
    if (process.platform === "win32") return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yuna-policy-"));
    const root = path.join(dir, "root");
    const outside = path.join(dir, "outside");
    fs.mkdirSync(root); fs.mkdirSync(outside);
    const link = path.join(root, "escape");
    try { fs.symlinkSync(outside, link, "dir"); }
    catch { return; }
    expect(evaluate("file.write", { path: path.join(link, "secret.txt") }, "medium", { confirmMedium: false, allowedRoots: [root] }).action).toBe("confirm");
  });
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
