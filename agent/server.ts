import "dotenv/config";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { OpenCodeLLM } from "./opencode/client";
import { MemoryStore } from "./memory/store";
import { AgentRuntime } from "./runtime/orchestrator";
import { Store } from "./runtime/store";
import type { AgentEvent } from "./runtime/types";
import { createToolkit } from "./tools";

const PORT = Number(process.env.YUNA_PORT || 47821);
const TOKEN = process.env.YUNA_TOKEN || "dev-token"; // Tauri injects a random token; "dev-token" is only for `npm run dev` in a browser.
const DATA_DIR = process.env.YUNA_DATA_DIR || path.join(os.homedir(), ".yuna");
const ORIGINS = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420"]);

const store = new Store(DATA_DIR);
store.markInterrupted();
const memory = new MemoryStore(store.db);
const { registry, browser } = createToolkit(DATA_DIR);
const clients = new Set<WebSocket>();

const log = (level: string, ...a: unknown[]) => console.log(`[${new Date().toISOString()}] ${level}`, ...a.map((x) => String(x).replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")));
const send = (ws: WebSocket, e: AgentEvent) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(e));
const emit = (e: AgentEvent) => {
  if ("taskId" in e && e.type !== "thinking") store.addEvent(e.taskId, e.type, e);
  clients.forEach((c) => send(c, e));
};

const runtime = new AgentRuntime({
  llm: new OpenCodeLLM({ apiKey: process.env.OPENCODE_API_KEY, model: process.env.OPENCODE_MODEL, baseUrl: process.env.OPENCODE_SERVER_URL }),
  store, memory, tools: registry, browser, emit, dataDir: DATA_DIR, getSettings: () => store.getSettings(),
});

const recoverable = () => ({ type: "recoverable", tasks: store.interrupted().map((t) => ({ id: t.task_id, goal: t.goal, progress: `${t.completed_steps.length} steps done` })) }) as AgentEvent;
const history = (conv?: string): AgentEvent => ({ type: "history", conversations: store.conversations(), tasks: store.tasks(), messages: conv ? store.messages(conv) : undefined });

const server = http.createServer((_, res) => { res.writeHead(404).end(); });
const wss = new WebSocketServer({ server, verifyClient: ({ origin, req }, cb) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.searchParams.get("token") !== TOKEN) return cb(false, 401, "bad token");
  if (origin && !ORIGINS.has(origin)) return cb(false, 403, "bad origin");
  cb(true);
} });

wss.on("connection", (ws) => {
  clients.add(ws);
  send(ws, { type: "connected" });
  send(ws, { type: "settings", settings: store.getSettings() });
  send(ws, history());
  send(ws, recoverable());
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
    try {
      switch (m.type) {
        case "task": {
          const text = String(m.text ?? "").trim(); if (!text) return;
          const conv = m.conversationId || randomUUID();
          store.ensureConversation(conv, text); store.addMessage(conv, "user", text, m.inputType);
          await runtime.submit({ input_type: m.inputType === "voice" ? "voice" : "chat", text, conversation_id: conv });
          break;
        }
        case "confirm": runtime.confirm(m.taskId, m.id, !!m.approve); break;
        case "pause": runtime.pause(m.taskId, !!m.paused); break;
        case "stop": runtime.stop(m.taskId); break;
        case "resume_task": await runtime.resume(m.taskId); emit(recoverable()); break;
        case "discard_task": runtime.discard(m.taskId); emit(recoverable()); break;
        case "get_history": send(ws, history(m.conversationId)); break;
        case "delete_conversation": store.deleteConversation(m.id); send(ws, history()); break;
        case "rename_conversation": store.renameConversation(m.id, String(m.title)); send(ws, history()); break;
        case "settings_set": { const s = store.setSettings(m.patch ?? {}); store.pruneHistory(s.taskHistoryDays); emit({ type: "settings", settings: s }); break; }
        case "memory_list": send(ws, { type: "memories", memories: await memory.list() }); break;
        case "memory_delete": await memory.delete(m.id); send(ws, { type: "memories", memories: await memory.list() }); break;
        case "memory_clear": await memory.clear(); send(ws, { type: "memories", memories: [] }); break;
      }
    } catch (e) { log("ERROR", "message handler:", (e as Error).message); }
  });
});

server.listen(PORT, "127.0.0.1", () => log("INFO", `Yuna agent listening on 127.0.0.1:${PORT} (data: ${DATA_DIR})`));
const shutdown = async () => {
  runtime.stopAll();
  await browser.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
process.on("uncaughtException", (e) => log("ERROR", "uncaught:", e.message));
process.on("unhandledRejection", (e) => log("ERROR", "unhandled:", (e as Error)?.message ?? e));
