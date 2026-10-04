import type { LLM } from "../runtime/types";

// OpenCode ships its own built-in tools (bash/edit/write/...). Yuna must be the ONLY executor so that the
// policy engine can gate every action; we therefore disable them on every prompt.
const DISABLE_BUILTIN_TOOLS: Record<string, boolean> = Object.fromEntries(
  ["bash", "edit", "write", "read", "grep", "glob", "list", "patch", "webfetch", "todowrite", "todoread", "task"].map((k) => [k, false]),
);

export interface OpenCodeOptions { apiKey?: string; model?: string; baseUrl?: string }

/** Thin wrapper around @opencode-ai/sdk. The API key lives only in this (local, trusted) process. */
export class OpenCodeLLM implements LLM {
  private client: any;
  private server?: { close(): void };
  private starting?: Promise<void>;
  constructor(private o: OpenCodeOptions) {}

  private async ensure() {
    if (this.client) return;
    this.starting ??= (async () => {
      const sdk: any = await import("@opencode-ai/sdk");
      if (this.o.baseUrl) {
        this.client = sdk.createOpencodeClient({ baseUrl: this.o.baseUrl });
      } else {
        if (!this.o.apiKey) throw new Error("OPENCODE_API_KEY is not set (add it to .env for the agent process).");
        const config: any = { provider: { opencode: { options: { apiKey: this.o.apiKey } } } };
        const { client, server } = await sdk.createOpencode({ config });
        this.client = client; this.server = server;
      }
    })();
    try { await this.starting; } catch (e) { this.starting = undefined; throw e; }
  }

  async newSession(title: string): Promise<string> {
    await this.ensure();
    const res = await this.client.session.create({ body: { title } });
    const id = res?.data?.id;
    if (!id) throw new Error("OpenCode session.create returned no id");
    return id;
  }

  async prompt(sessionId: string, text: string, system?: string): Promise<string> {
    await this.ensure();
    const [providerID, ...rest] = (this.o.model ?? "").split("/");
    const model = this.o.model && rest.length ? { providerID, modelID: rest.join("/") } : undefined;
    const res = await this.client.session.prompt({
      path: { id: sessionId },
      body: { ...(model && { model }), ...(system && { system }), tools: DISABLE_BUILTIN_TOOLS, parts: [{ type: "text", text }] },
    });
    const parts: any[] = res?.data?.parts ?? [];
    const out = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n").trim();
    if (!out) throw new Error(res?.error ? JSON.stringify(res.error).slice(0, 300) : "Empty model response");
    return out;
  }

  close() { try { this.server?.close(); } catch { /* ignore */ } }
}
