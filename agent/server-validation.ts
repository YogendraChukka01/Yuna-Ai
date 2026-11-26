import { z } from "zod";

export const Id = z.string().min(1).max(128);
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string().min(1).max(512) }),
  z.object({ type: z.literal("task"), text: z.string().trim().min(1).max(20_000), inputType: z.enum(["chat","voice"]).optional(), conversationId: Id.optional() }),
  z.object({ type: z.literal("confirm"), taskId: Id, id: Id, approve: z.boolean() }),
  z.object({ type: z.literal("pause"), taskId: Id, paused: z.boolean() }),
  z.object({ type: z.literal("stop"), taskId: Id }),
  z.object({ type: z.literal("resume_task"), taskId: Id }),
  z.object({ type: z.literal("discard_task"), taskId: Id }),
  z.object({ type: z.literal("get_history"), conversationId: Id.optional() }),
  z.object({ type: z.literal("delete_conversation"), id: Id }),
  z.object({ type: z.literal("rename_conversation"), id: Id, title: z.string().trim().min(1).max(80) }),
  z.object({ type: z.literal("settings_set"), patch: z.record(z.unknown()).refine((p) => Object.keys(p).length <= 20) }),
  z.object({ type: z.literal("memory_list") }),
  z.object({ type: z.literal("memory_delete"), id: Id }),
  z.object({ type: z.literal("memory_clear") }),
]);

export class MessageRateLimiter {
  private windowStart: number;
  private count = 0;
  constructor(private limit = 30, private windowMs = 1000, now = Date.now()) { this.windowStart = now; }
  allow(now = Date.now()) {
    if (now - this.windowStart >= this.windowMs) { this.windowStart = now; this.count = 0; }
    this.count++;
    return this.count <= this.limit;
  }
}
