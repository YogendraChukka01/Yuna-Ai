import { randomUUID } from "node:crypto";
import type { BrowserManager } from "../tools/browser/manager";
import type { MemoryStore } from "../memory/store";
import type { ToolRegistry } from "../tools/registry";
import { evaluate } from "./policy";
import { LoopGuard } from "./loop-guard";
import { parseDecision, systemPrompt } from "./prompts";
import type { Store } from "./store";
import type { AgentEvent, Decision, LLM, Settings, TaskRequest, TaskSession, TaskStatus, ToolResult } from "./types";

export interface RuntimeDeps {
  llm: LLM; store: Store; memory: MemoryStore; tools: ToolRegistry; browser: Pick<BrowserManager, "isOpen" | "state" | "snapshot" | "restore">;
  emit: (e: AgentEvent) => void; dataDir: string; getSettings: () => Settings;
}

class Run {
  abort = new AbortController();
  paused = false;
  private waiters: (() => void)[] = [];
  pending = new Map<string, (approved: boolean) => void>();
  async gate() { while (this.paused && !this.abort.signal.aborted) await new Promise<void>((r) => this.waiters.push(r)); }
  setPaused(p: boolean) { this.paused = p; if (!p) this.waiters.splice(0).forEach((r) => r()); }
  stop() { this.abort.abort(); this.setPaused(false); this.pending.forEach((res) => res(false)); }
}

function raceAbort<T>(p: Promise<T>, s: AbortSignal): Promise<T> {
  return new Promise((res, rej) => {
    if (s.aborted) return rej(new Error("aborted"));
    const on = () => rej(new Error("aborted"));
    s.addEventListener("abort", on, { once: true });
    p.then((v) => { s.removeEventListener("abort", on); res(v); }, (e) => { s.removeEventListener("abort", on); rej(e); });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `…[+${s.length - n} chars]` : s);

interface Session { id: string; seed?: string }

/**
 * ONE USER GOAL = ONE TaskSession = MANY TOOL CALLS = ONE CONTINUOUS STATE.
 * The loop never ends because a tool returned; it ends only on completed/blocked/cancelled/timeout/error/confirmation.
 */
export class AgentRuntime {
  private runs = new Map<string, Run>();
  constructor(private d: RuntimeDeps) {}

  async submit(req: TaskRequest): Promise<string> {
    const t = new Date().toISOString();
    const task: TaskSession = {
      task_id: `task_${randomUUID().slice(0, 8)}`, conversation_id: req.conversation_id, goal: req.text, status: "running",
      created_at: t, updated_at: t, plan: [], completed_steps: [], pending_steps: [], failed_steps: [], artifacts: [],
      memory_refs: [], checkpoints: 0, iteration: 0, toolCalls: 0, retries: 0, summary: "", history: [],
    };
    this.d.store.saveTask(task);
    this.d.emit({ type: "task_created", taskId: task.task_id, goal: task.goal, conversationId: task.conversation_id });
    this.start(task, false);
    return task.task_id;
  }

  async resume(taskId: string): Promise<boolean> {
    if (this.runs.has(taskId)) return false;
    const task = this.d.store.getTask(taskId);
    if (!task || ["completed", "cancelled"].includes(task.status)) return false;
    task.status = "running";
    this.d.emit({ type: "task_created", taskId, goal: task.goal, conversationId: task.conversation_id });
    this.start(task, true);
    return true;
  }
  discard(taskId: string) {
    const t = this.d.store.getTask(taskId);
    if (t) { t.status = "cancelled"; this.d.store.saveTask(t); }
  }
  pause(id: string, paused: boolean) { const r = this.runs.get(id); if (r) { r.setPaused(paused); this.d.emit({ type: "task_paused", taskId: id, paused }); } }
  stop(id: string) { this.runs.get(id)?.stop(); }
  stopAll() { this.runs.forEach((r) => r.stop()); }
  activeTaskIds() { return [...this.runs.keys()]; }
  confirm(taskId: string, confirmationId: string, approve: boolean) { this.runs.get(taskId)?.pending.get(confirmationId)?.(approve); }

  private start(task: TaskSession, resumed: boolean) {
    const run = new Run();
    this.runs.set(task.task_id, run);
    this.run(task, run, resumed)
      .catch((e) => this.end(task, "unrecoverable_error", `Internal error: ${(e as Error).message}`))
      .finally(() => this.runs.delete(task.task_id));
  }

  private end(task: TaskSession, status: TaskStatus, message: string) {
    task.status = status;
    this.d.store.saveTask(task);
    this.d.store.addMessage(task.conversation_id, "assistant", message);
    const e = this.d.emit;
    e({ type: "assistant_message", taskId: task.task_id, conversationId: task.conversation_id, text: message });
    if (status === "completed") e({ type: "task_completed", taskId: task.task_id, result: message });
    else if (status === "unrecoverable_error") e({ type: "task_failed", taskId: task.task_id, error: message });
    e({ type: "task_ended", taskId: task.task_id, status, message });
  }

  private async newSession(task: TaskSession, resumed: boolean): Promise<Session> {
    const id = await this.d.llm.newSession(`aru ${task.task_id}`);
    const S = this.d.getSettings();
    const mem = S.memoryEnabled ? await this.d.memory.search(task.goal) : [];
    task.memory_refs = mem.map((m) => m.id);
    const convo = this.d.store.recentMessages(task.conversation_id, 6).map((m) => `${m.role}: ${clip(m.text, 300)}`).join("\n");
    const seed = [
      `GOAL: ${task.goal}`,
      convo && `RECENT CONVERSATION:\n${convo}`,
      mem.length && `RELEVANT MEMORY:\n${mem.map((m) => `- [${m.category}] ${m.content}`).join("\n")}`,
      task.summary && `TASK SUMMARY SO FAR:\n${task.summary}`,
      task.pending_steps.length && `PENDING OBJECTIVES: ${task.pending_steps.join(" | ")}`,
      task.failed_steps.length && `RECENT ERRORS: ${task.failed_steps.slice(-3).map((s) => `${s.tool}: ${s.error}`).join(" | ")}`,
      task.artifacts.length && `ARTIFACTS: ${task.artifacts.join(", ")}`,
      task.history.length && `RECENT ACTIONS:\n${task.history.map((h) => `#${h.step} ${h.tool} ${h.ok ? "ok" : "FAILED"}: ${h.summary}`).join("\n")}`,
      resumed && "NOTE: this task was interrupted and is being resumed. Verify the current environment before continuing.",
    ].filter(Boolean).join("\n\n");
    return { id, seed };
  }

  private async observe(task: TaskSession): Promise<string> {
    if (!this.d.browser.isOpen()) return "";
    try {
      const st = await this.d.browser.state();
      task.active_browser = st.browser_id; task.active_tab = st.active_page;
      task.browser = await this.d.browser.snapshot();
      this.d.emit({ type: "observation", taskId: task.task_id, data: st });
      return `\nBROWSER STATE: ${JSON.stringify(st)}`;
    } catch { return ""; }
  }

  private async run(task: TaskSession, run: Run, resumed: boolean) {
    const { emit, store } = this.d;
    const S = this.d.getSettings();
    const started = Date.now();
    const guard = new LoopGuard(3);
    const system = systemPrompt(this.d.tools.list());
    let session: Session;
    try { session = await raceAbort(this.newSession(task, resumed), run.abort.signal); }
    catch (e) { return this.end(task, (e as Error).message === "aborted" ? "cancelled" : "unrecoverable_error", `Could not start session: ${(e as Error).message}`); }
    if (resumed && task.browser) { try { await this.d.browser.restore(task.browser); } catch { /* model will re-navigate */ } }

    let observation = resumed ? "Task resumed after interruption. Check the environment before continuing." : "Task started. No actions taken yet. Include a short \"plan\" in your first tool_call.";
    let invalid = 0, modelErrors = 0, verifyFails = 0, verifyingMessage = "";

    while (task.status === "running") {
      if (run.abort.signal.aborted) return this.end(task, "cancelled", "Stopped.");
      await run.gate();
      if (run.abort.signal.aborted) return this.end(task, "cancelled", "Stopped.");
      if (task.iteration >= S.maxIterations || task.toolCalls >= S.maxToolCalls || Date.now() - started > S.maxDurationMs)
        return this.end(task, "timeout", "I reached the task limit before finishing. Say 'continue' to keep going.");

      task.iteration++;
      emit({ type: "thinking", taskId: task.task_id });
      const turn = (session.seed ? session.seed + "\n\n" : "") +
        `PENDING: ${task.pending_steps.join(" | ") || "(none declared)"}\nOBSERVATION:\n${observation}\n\nNext JSON decision:`;
      let raw: string;
      try {
        raw = await raceAbort(this.d.llm.prompt(session.id, turn, system), run.abort.signal);
        session.seed = undefined; modelErrors = 0;
      } catch (e) {
        if (run.abort.signal.aborted) return this.end(task, "cancelled", "Stopped.");
        if (++modelErrors >= 3) return this.end(task, "unrecoverable_error", `The AI model is unavailable: ${(e as Error).message}`);
        task.iteration--; await sleep(1000 * modelErrors); continue;
      }

      const parsed = parseDecision(raw);
      if (!parsed.ok) {
        if (++invalid > 4) return this.end(task, "unrecoverable_error", "The model keeps returning invalid output.");
        observation = `Your last response was invalid (${parsed.error}). Reply with ONE valid JSON decision object only.`; continue;
      }
      invalid = 0;
      const d: Decision = parsed.decision;
      if ("remember" in d && d.remember && S.memoryEnabled) await this.d.memory.save(d.remember);

      switch (d.type) {
        case "tool_call": {
          if (d.plan?.length && !task.plan.length) { task.plan = d.plan; emit({ type: "plan", taskId: task.task_id, plan: d.plan }); }
          if (d.pending) task.pending_steps = d.pending;
          const r = await this.execTool(task, run, d, S);
          if (run.abort.signal.aborted) return this.end(task, "cancelled", "Stopped.");
          const g = guard.record(`${d.tool}|${JSON.stringify(d.arguments)}`, r.ok);
          observation = r.text + (await this.observe(task));
          if (g === "stop") return this.end(task, "blocked", "I can't make progress with the current strategy. How would you like me to proceed?");
          if (g === "replan") { task.retries++; observation += "\nLOOP DETECTED: you are repeating yourself. You MUST choose a materially different strategy or ask the user."; }
          store.saveTask(task); store.saveCheckpoint(task);
          emit({ type: "task_progress", taskId: task.task_id, data: { iteration: task.iteration, toolCalls: task.toolCalls, completed: task.completed_steps.length, failed: task.failed_steps.length, pending: task.pending_steps } });
          session = await this.compactIfNeeded(task, session, run, S);
          continue;
        }
        case "retry":
          task.retries++;
          if (task.retries > S.maxRetries * 3) return this.end(task, "blocked", "Too many retries without progress.");
          observation = `Retry acknowledged (${d.strategy}). Now perform the next action using that strategy.`; continue;
        case "ask_user":
          return this.end(task, "blocked", d.question ?? d.reason);
        case "blocked":
          return this.end(task, "blocked", d.reason);
        case "completed": {
          if (task.toolCalls === 0) return this.end(task, "completed", d.message);
          verifyingMessage = d.message;
          const v = await this.verify(task, session, run, d);
          if (v.ok) return this.end(task, "completed", verifyingMessage);
          if (++verifyFails >= 3) return this.end(task, "blocked", `I couldn't verify completion. Missing: ${v.missing}`);
          observation = `VERIFICATION FAILED. Missing: ${v.missing}. Continue working toward the goal.`; continue;
        }
      }
    }
  }

  private async verify(task: TaskSession, session: Session, run: Run, d: Extract<Decision, { type: "completed" }>) {
    const q = `VERIFY: You claimed the goal is complete. Claim: "${clip(d.message, 300)}". Evidence: "${clip(d.evidence ?? "none given", 300)}". ` +
      `Goal: "${task.goal}". Check the evidence against the goal and your action history. Observe the real environment via tools if unsure ` +
      `(respond with a tool_call instead). If verified, respond ONLY {"verified":true}. If not, respond ONLY {"verified":false,"missing":"..."}.`;
    try {
      const raw = await raceAbort(this.d.llm.prompt(session.id, q, systemPrompt(this.d.tools.list())), run.abort.signal);
      const m = raw.match(/\{[\s\S]*\}/);
      const j = m ? JSON.parse(m[0]) : {};
      if (j.verified === true) return { ok: true as const };
      return { ok: false as const, missing: String(j.missing ?? "unspecified") };
    } catch { return { ok: false as const, missing: "verification call failed" }; }
  }

  private async askUser(task: TaskSession, run: Run, tool: string, args: unknown, reason: string): Promise<boolean> {
    const id = randomUUID();
    task.status = "confirmation_required"; this.d.store.saveTask(task);
    this.d.emit({ type: "confirmation_required", taskId: task.task_id, data: { id, taskId: task.task_id, tool, args, reason } });
    const approved = await new Promise<boolean>((res) => run.pending.set(id, res));
    run.pending.delete(id);
    if (!run.abort.signal.aborted) task.status = "running";
    this.d.store.logPermission(task.task_id, tool, args, approved ? "approved" : "declined");
    return approved;
  }

  private async execTool(task: TaskSession, run: Run, d: Extract<Decision, { type: "tool_call" }>, S: Settings) {
    const fail = (text: string) => ({ ok: false, text });
    const tool = this.d.tools.get(d.tool);
    if (!tool) return fail(`Unknown tool "${d.tool}". Use only: ${this.d.tools.list().map((t) => t.name).join(", ")}`);
    const parsed = tool.schema.safeParse(d.arguments);
    if (!parsed.success) return fail(`Invalid arguments for ${d.tool}: ${parsed.error.message.slice(0, 300)}. Signature: ${tool.signature}`);
    const risk = typeof tool.riskLevel === "function" ? tool.riskLevel(parsed.data) : tool.riskLevel;
    const verdict = evaluate(tool.name, parsed.data, risk, S);
    if (verdict.action === "deny") { this.d.store.logPermission(task.task_id, tool.name, parsed.data, "denied"); return fail(`POLICY DENIED ${d.tool}: ${verdict.reason}. Choose a different approach or tell the user.`); }
    if (verdict.action === "confirm") {
      const ok = await this.askUser(task, run, tool.name, parsed.data, verdict.reason);
      if (!ok) return fail(`The user DECLINED ${d.tool}. Do not retry it; adapt or finish.`);
    }

    const stepId = String(++task.toolCalls);
    const label = d.reason ?? `${tool.name}`;
    task.current_step = label;
    this.d.emit({ type: "tool_started", taskId: task.task_id, stepId, tool: tool.name, label });
    const callId = this.d.store.startToolCall(task.task_id, tool.name, parsed.data);
    const t0 = Date.now();
    let result: ToolResult;
    try { result = await raceAbort(tool.execute(parsed.data, { taskId: task.task_id, dataDir: this.d.dataDir, signal: run.abort.signal }), run.abort.signal); }
    catch (e) { result = { success: false, error: { type: "exception", message: (e as Error).message, recoverable: !run.abort.signal.aborted } }; }
    const ms = Date.now() - t0;
    this.d.store.finishToolCall(callId, result.success, result, result.error?.message);
    const rec = { id: stepId, tool: tool.name, label, success: result.success, error: result.error?.message, ms };
    (result.success ? task.completed_steps : task.failed_steps).push(rec);
    task.history.push({ step: Number(stepId), tool: tool.name, args: clip(JSON.stringify(parsed.data), 160), ok: result.success, summary: clip(result.success ? JSON.stringify(result.data ?? "ok") : result.error?.message ?? "failed", 200) });
    const art = result.metadata?.artifact;
    if (typeof art === "string") { task.artifacts.push(art); this.d.store.addArtifact(task.task_id, String(result.metadata?.artifactType ?? "file"), art); }
    if (result.observation?.application) task.active_application = result.observation.application;
    if (result.observation?.window) task.active_window = result.observation.window;
    this.d.emit({ type: "tool_completed", taskId: task.task_id, stepId, tool: tool.name, success: result.success, ms, error: result.error?.message });
    this.d.store.addEvent(task.task_id, "tool_completed", rec);
    return { ok: result.success, text: `TOOL RESULT (${tool.name}):\n${clip(JSON.stringify(result), 7000)}` };
  }

  /** Context layers: compress old raw tool history into a summary, keep the last few entries, restart the LLM session from the summary. */
  private async compactIfNeeded(task: TaskSession, session: Session, run: Run, S: Settings): Promise<Session> {
    if (task.history.length < S.compactionThreshold) return session;
    const old = task.history.slice(0, -6), keep = task.history.slice(-6);
    const q = `Summarize the progress of this task in <=180 words for your own future reference. Keep: goal status, current app/tab, important results, errors and how they were solved, user instructions, what remains. ` +
      `Previous summary: ${task.summary || "(none)"}\nOlder actions:\n${old.map((h) => `#${h.step} ${h.tool} ${h.ok ? "ok" : "FAILED"} ${h.summary}`).join("\n")}\nReply with plain text only.`;
    try {
      const text = await raceAbort(this.d.llm.prompt(session.id, q), run.abort.signal);
      task.summary = clip(text.trim(), 1800); task.history = keep;
      const next = await this.newSession(task, false);
      this.d.emit({ type: "compaction", taskId: task.task_id, contextChars: task.summary.length + JSON.stringify(keep).length });
      return next;
    } catch { return session; }
  }
}
