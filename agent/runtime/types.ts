import { z } from "zod";

export type RiskLevel = "low" | "medium" | "high";

export interface ToolResult {
  success: boolean;
  data?: unknown;
  observation?: { application?: string; window?: string; url?: string; screenshot?: string; text?: string };
  error?: { type: string; message: string; recoverable: boolean };
  metadata?: Record<string, unknown>;
}

export interface ToolContext { taskId: string; dataDir: string; signal: AbortSignal }

export interface ToolDefinition<A = any> {
  name: string;
  description: string;
  /** Human/LLM readable argument signature, e.g. `{ url: string }` */
  signature: string;
  schema: z.ZodType<A, z.ZodTypeDef, any>;
  riskLevel: RiskLevel | ((args: A) => RiskLevel);
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}

const Remember = z.object({
  category: z.enum(["PROFILE", "PREFERENCE", "PROJECT", "WORKFLOW", "FACT", "EPISODIC_EVENT", "TASK_RESULT"]),
  content: z.string().min(3).max(500),
});

export const DecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_call"),
    tool: z.string(),
    arguments: z.record(z.any()).default({}),
    reason: z.string().optional(),
    expected_result: z.string().optional(),
    plan: z.array(z.string()).optional(),
    pending: z.array(z.string()).optional(),
    remember: Remember.optional(),
  }),
  z.object({ type: z.literal("completed"), message: z.string(), evidence: z.string().optional(), remember: Remember.optional() }),
  z.object({ type: z.literal("ask_user"), reason: z.string(), question: z.string().optional() }),
  z.object({ type: z.literal("retry"), strategy: z.string() }),
  z.object({ type: z.literal("blocked"), reason: z.string() }),
]);
export type Decision = z.infer<typeof DecisionSchema>;

export type TaskStatus =
  | "running" | "completed" | "blocked" | "confirmation_required"
  | "cancelled" | "timeout" | "unrecoverable_error" | "paused";

export interface StepRecord { id: string; tool: string; label: string; success: boolean; error?: string; ms: number }
export interface HistoryEntry { step: number; tool: string; args: string; ok: boolean; summary: string }
export interface BrowserSnapshot { activeIndex: number; urls: string[] }

export interface TaskSession {
  task_id: string;
  conversation_id: string;
  goal: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  active_application?: string;
  active_window?: string;
  active_browser?: string;
  active_tab?: string;
  current_step?: string;
  plan: string[];
  completed_steps: StepRecord[];
  pending_steps: string[];
  failed_steps: StepRecord[];
  artifacts: string[];
  memory_refs: string[];
  checkpoints: number;
  iteration: number;
  toolCalls: number;
  retries: number;
  summary: string;          // compressed history (context layer 3)
  history: HistoryEntry[];  // recent raw history only
  browser?: BrowserSnapshot;
}

export interface TaskRequest { input_type: "voice" | "chat"; text: string; conversation_id: string }

export interface Confirmation { id: string; taskId: string; tool: string; args: unknown; reason: string }
export interface TaskProgress { iteration: number; toolCalls: number; completed: number; failed: number; pending: string[] }

export interface Settings {
  maxIterations: number; maxToolCalls: number; maxDurationMs: number; maxRetries: number;
  compactionThreshold: number; confirmMedium: boolean; allowedRoots: string[]; speak: boolean;
  memoryEnabled: boolean; taskHistoryDays: number;
}
export const DEFAULT_SETTINGS: Settings = {
  maxIterations: 100, maxToolCalls: 300, maxDurationMs: 30 * 60_000, maxRetries: 3,
  compactionThreshold: 30, confirmMedium: false, allowedRoots: [], speak: true,
  memoryEnabled: true, taskHistoryDays: 30,
};

export type AgentEvent =
  | { type: "task_created"; taskId: string; goal: string; conversationId: string }
  | { type: "thinking"; taskId: string }
  | { type: "plan"; taskId: string; plan: string[] }
  | { type: "tool_started"; taskId: string; stepId: string; tool: string; label: string }
  | { type: "tool_completed"; taskId: string; stepId: string; tool: string; success: boolean; ms: number; error?: string }
  | { type: "observation"; taskId: string; data: unknown }
  | { type: "task_progress"; taskId: string; data: TaskProgress }
  | { type: "confirmation_required"; taskId: string; data: Confirmation }
  | { type: "task_paused"; taskId: string; paused: boolean }
  | { type: "assistant_message"; taskId: string; conversationId: string; text: string }
  | { type: "task_completed"; taskId: string; result: string }
  | { type: "task_ended"; taskId: string; status: TaskStatus; message: string }
  | { type: "task_failed"; taskId: string; error: string }
  | { type: "compaction"; taskId: string; contextChars: number }
  | { type: "recoverable"; tasks: { id: string; goal: string; progress: string }[] }
  | { type: "history"; conversations: unknown[]; tasks: unknown[]; messages?: unknown[] }
  | { type: "settings"; settings: Settings }
  | { type: "memories"; memories: unknown[] }
  | { type: "connected" };

export interface LLM {
  newSession(title: string): Promise<string>;
  prompt(sessionId: string, text: string, system?: string): Promise<string>;
}
