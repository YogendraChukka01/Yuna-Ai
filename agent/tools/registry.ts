import type { ToolDefinition, ToolResult } from "../runtime/types";

export const ok = (data?: unknown, extra: Partial<ToolResult> = {}): ToolResult => ({ success: true, data, ...extra });
export const fail = (type: string, message: string, recoverable = true): ToolResult => ({ success: false, error: { type, message, recoverable } });

/** Central registry. Native tools today; MCP tools can be adapted into ToolDefinition and registered here later. */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  register(...defs: ToolDefinition[]) { for (const d of defs) this.tools.set(d.name, d); return this; }
  get(name: string) { return this.tools.get(name); }
  list() { return [...this.tools.values()]; }
}
