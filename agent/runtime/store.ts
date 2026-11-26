import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type Settings, type TaskSession } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const now = () => new Date().toISOString();

export class Store {
  db: Database.Database;
  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "yuna.db");
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, `${dbPath}.bak-${now().replace(/[:.]/g, "-")}`);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = OFF");
    this.db.exec(fs.readFileSync(path.resolve(here, "../../database/schema.sql"), "utf8"));
    this.migrateForeignKeys();
    this.db.pragma("foreign_keys = ON");
  }

  close() {
    if (this.db && this.db.open) {
      try { this.db.close(); } catch { /* ignore shutdown cleanup errors */ }
    }
  }

    private migrateForeignKeys() {
      const version = this.db.pragma("user_version", { simple: true }) as number;
      const tx = this.db.transaction(() => {
        this.db.prepare(`DELETE FROM messages WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id=messages.conversation_id)`).run();
        this.db.prepare(`DELETE FROM tasks WHERE conversation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id=tasks.conversation_id)`).run();
        this.db.prepare(`DELETE FROM task_events WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=task_events.task_id)`).run();
        this.db.prepare(`DELETE FROM checkpoints WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=checkpoints.task_id)`).run();
        this.db.prepare(`DELETE FROM tool_calls WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=tool_calls.task_id)`).run();
        this.db.prepare(`DELETE FROM permissions WHERE task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=permissions.task_id)`).run();
        this.db.prepare(`DELETE FROM artifacts WHERE created_by_task IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id=artifacts.created_by_task)`).run();
        if (version >= 1) { this.db.pragma("user_version = 1"); return; }
        this.rebuildTable("messages",
          `CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, input_type TEXT, text TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)`,
          "id,conversation_id,role,input_type,text,created_at");
        this.rebuildTable("tasks",
          `CREATE TABLE tasks (id TEXT PRIMARY KEY, conversation_id TEXT, goal TEXT NOT NULL, status TEXT NOT NULL, current_node TEXT, active_application TEXT, active_window TEXT, browser_session_id TEXT, state_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)`,
          "id,conversation_id,goal,status,current_node,active_application,active_window,browser_session_id,state_json,created_at,updated_at");
        this.rebuildTable("task_events",
          `CREATE TABLE task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE)`,
          "id,task_id,type,payload,created_at");
        this.rebuildTable("checkpoints",
          `CREATE TABLE checkpoints (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, step_number INTEGER NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE)`,
          "id,task_id,step_number,state_json,created_at");
        this.rebuildTable("tool_calls",
          `CREATE TABLE tool_calls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT, result_json TEXT, success INTEGER NOT NULL DEFAULT 0, error TEXT, started_at TEXT, completed_at TEXT, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE)`,
          "id,task_id,tool_name,arguments_json,result_json,success,error,started_at,completed_at");
        this.rebuildTable("permissions",
          `CREATE TABLE permissions (id TEXT PRIMARY KEY, task_id TEXT, tool_name TEXT, arguments_json TEXT, decision TEXT, created_at TEXT NOT NULL, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE)`,
          "id,task_id,tool_name,arguments_json,decision,created_at");
        this.rebuildTable("artifacts",
          `CREATE TABLE artifacts (id TEXT PRIMARY KEY, type TEXT, path TEXT, created_by_task TEXT, created_at TEXT NOT NULL, FOREIGN KEY(created_by_task) REFERENCES tasks(id) ON DELETE CASCADE)`,
          "id,type,path,created_by_task,created_at");
        this.db.pragma("user_version = 1");
      });
      tx();
    }

    private rebuildTable(table: string, createSql: string, columns: string) {
      const foreignKeys = this.db.prepare(`PRAGMA foreign_key_list(${table})`).all() as unknown[];
      if (foreignKeys.length > 0) return;
      const legacy = `__legacy_${table}`;
      this.db.exec(`DROP TABLE IF EXISTS ${legacy}; ALTER TABLE ${table} RENAME TO ${legacy}; ${createSql}; INSERT OR IGNORE INTO ${table} (${columns}) SELECT ${columns} FROM ${legacy}; DROP TABLE ${legacy};`);
    }

  // conversations / messages
  ensureConversation(id: string, title: string) {
    this.db.prepare(`INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`).run(id, title.slice(0, 80), now(), now());
  }
  addMessage(conversationId: string, role: "user" | "assistant", text: string, inputType?: string) {
    this.db.prepare(`INSERT INTO messages(id,conversation_id,role,input_type,text,created_at) VALUES(?,?,?,?,?,?)`)
      .run(randomUUID(), conversationId, role, inputType ?? null, text, now());
  }
  recentMessages(conversationId: string, n = 6): { role: string; text: string }[] {
    return (this.db.prepare(`SELECT role,text FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(conversationId, n) as any[]).reverse();
  }
  messages(conversationId: string) {
    return this.db.prepare(`SELECT id,role,text,created_at FROM messages WHERE conversation_id=? ORDER BY created_at`).all(conversationId);
  }
  conversations() { return this.db.prepare(`SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100`).all(); }
  deleteConversation(id: string) {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM tasks WHERE conversation_id=?`).run(id);
      this.db.prepare(`DELETE FROM conversations WHERE id=?`).run(id);
    });
    tx();
  }
  renameConversation(id: string, title: string) { this.db.prepare(`UPDATE conversations SET title=? WHERE id=?`).run(title, id); }

  // tasks
  saveTask(t: TaskSession) {
    t.updated_at = now();
    if (t.conversation_id) {
      this.db.prepare(`INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(id) DO NOTHING`).run(t.conversation_id, t.goal.slice(0,80), t.created_at, t.updated_at);
    }
    this.db.prepare(`INSERT INTO tasks(id,conversation_id,goal,status,current_node,active_application,active_window,browser_session_id,state_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,current_node=excluded.current_node,
      active_application=excluded.active_application,active_window=excluded.active_window,browser_session_id=excluded.browser_session_id,
      state_json=excluded.state_json,updated_at=excluded.updated_at`)
      .run(t.task_id, t.conversation_id, t.goal, t.status, t.current_step ?? null, t.active_application ?? null,
        t.active_window ?? null, t.active_browser ?? null, JSON.stringify(t), t.created_at, t.updated_at);
  }
  getTask(id: string): TaskSession | undefined {
    const r = this.db.prepare(`SELECT state_json FROM tasks WHERE id=?`).get(id) as any;
    return r ? JSON.parse(r.state_json) : undefined;
  }
  tasks(limit = 100) {
    return this.db.prepare(`SELECT id,conversation_id,goal,status,created_at,updated_at FROM tasks ORDER BY updated_at DESC LIMIT ?`).all(limit);
  }
  /** Called on startup: anything left "running" belonged to a previous process. */
  markInterrupted() {
    this.db.prepare(`UPDATE tasks SET status='paused' WHERE status IN ('running','confirmation_required')`).run();
    for (const r of this.db.prepare(`SELECT id,state_json FROM tasks WHERE status='paused'`).all() as any[]) {
      const t = JSON.parse(r.state_json) as TaskSession; t.status = "paused";
      this.db.prepare(`UPDATE tasks SET state_json=? WHERE id=?`).run(JSON.stringify(t), r.id);
    }
  }
  interrupted(): TaskSession[] {
    return (this.db.prepare(`SELECT state_json FROM tasks WHERE status='paused' ORDER BY updated_at DESC`).all() as any[]).map((r) => JSON.parse(r.state_json));
  }
  pruneHistory(days: number) {
    if (days <= 0) return;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    this.db.prepare(`DELETE FROM task_events WHERE created_at<?`).run(cutoff);
    this.db.prepare(`DELETE FROM tool_calls WHERE started_at<?`).run(cutoff);
    this.db.prepare(`DELETE FROM checkpoints WHERE created_at<?`).run(cutoff);
  }

  // events / tool calls / checkpoints / artifacts
  addEvent(taskId: string, type: string, payload: unknown) {
    this.db.prepare(`INSERT INTO task_events(task_id,type,payload,created_at) VALUES(?,?,?,?)`).run(taskId, type, JSON.stringify(payload), now());
  }
  startToolCall(taskId: string, tool: string, args: unknown): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO tool_calls(id,task_id,tool_name,arguments_json,success,started_at) VALUES(?,?,?,?,0,?)`)
      .run(id, taskId, tool, JSON.stringify(args), now());
    return id;
  }
  finishToolCall(id: string, success: boolean, result: unknown, error?: string) {
    this.db.prepare(`UPDATE tool_calls SET success=?,result_json=?,error=?,completed_at=? WHERE id=?`)
      .run(success ? 1 : 0, JSON.stringify(result).slice(0, 20000), error ?? null, now(), id);
  }
  saveCheckpoint(t: TaskSession) {
    t.checkpoints++;
    this.db.prepare(`INSERT INTO checkpoints(id,task_id,step_number,state_json,created_at) VALUES(?,?,?,?,?)`)
      .run(randomUUID(), t.task_id, t.toolCalls, JSON.stringify(t), now());
  }
  latestCheckpoint(taskId: string): TaskSession | undefined {
    const r = this.db.prepare(`SELECT state_json FROM checkpoints WHERE task_id=? ORDER BY step_number DESC, created_at DESC LIMIT 1`).get(taskId) as any;
    return r ? JSON.parse(r.state_json) : undefined;
  }
  addArtifact(taskId: string, type: string, p: string) {
    this.db.prepare(`INSERT INTO artifacts(id,type,path,created_by_task,created_at) VALUES(?,?,?,?,?)`).run(randomUUID(), type, p, taskId, now());
  }
  logPermission(taskId: string, tool: string, args: unknown, decision: string) {
    this.db.prepare(`INSERT INTO permissions(id,task_id,tool_name,arguments_json,decision,created_at) VALUES(?,?,?,?,?,?)`)
      .run(randomUUID(), taskId, tool, JSON.stringify(args).slice(0, 4000), decision, now());
  }

  // settings
  getSettings(): Settings {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key='app'`).get() as any;
    return { ...DEFAULT_SETTINGS, ...(r ? JSON.parse(r.value) : {}) };
  }
  setSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.getSettings(), ...patch };
    this.db.prepare(`INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(next));
    return next;
  }
}
