import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type MemoryCategory = "PROFILE" | "PREFERENCE" | "PROJECT" | "WORKFLOW" | "FACT" | "EPISODIC_EVENT" | "TASK_RESULT";
export interface Memory { id: string; category: MemoryCategory; content: string; confidence: number; created_at?: string; updated_at?: string }

const SECRET = /(api[_-]?key|password|passwd|secret|token|bearer\s+[a-z0-9]|sk-[a-z0-9]{8,}|\b\d{13,19}\b)/i;

/** Local-first memory (context layer 4). Saves only explicit/stable/useful facts; refuses anything that looks like a secret. */
export class MemoryStore {
  constructor(private db: Database.Database) {}

  async save(m: Omit<Memory, "id" | "confidence"> & { confidence?: number }): Promise<Memory | null> {
    if (SECRET.test(m.content)) return null;
    const dup = this.db.prepare(`SELECT id FROM memories WHERE lower(content)=lower(?)`).get(m.content) as any;
    if (dup) return null;
    const rec: Memory = { id: randomUUID(), category: m.category, content: m.content.trim(), confidence: m.confidence ?? 0.8 };
    const t = new Date().toISOString();
    this.db.prepare(`INSERT INTO memories(id,category,content,confidence,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
      .run(rec.id, rec.category, rec.content, rec.confidence, t, t);
    return rec;
  }
  async search(query: string, limit = 5): Promise<Memory[]> {
    const words = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))];
    if (!words.length) return [];
    const all = this.db.prepare(`SELECT * FROM memories`).all() as Memory[];
    return all
      .map((m) => ({ m, score: words.reduce((s, w) => s + (m.content.toLowerCase().includes(w) ? 1 : 0), 0) * m.confidence }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.m);
  }
  async update(id: string, patch: Partial<Memory>) {
    const cur = this.db.prepare(`SELECT * FROM memories WHERE id=?`).get(id) as Memory | undefined;
    if (!cur) return;
    const n = { ...cur, ...patch };
    this.db.prepare(`UPDATE memories SET category=?,content=?,confidence=?,updated_at=? WHERE id=?`)
      .run(n.category, n.content, n.confidence, new Date().toISOString(), id);
  }
  async delete(id: string) { this.db.prepare(`DELETE FROM memories WHERE id=?`).run(id); }
  async clear() { this.db.prepare(`DELETE FROM memories`).run(); }
  async list(): Promise<Memory[]> { return this.db.prepare(`SELECT * FROM memories ORDER BY updated_at DESC`).all() as Memory[]; }
  /** Housekeeping: remove exact duplicates. */
  async summarize() {
    this.db.prepare(`DELETE FROM memories WHERE rowid NOT IN (SELECT MIN(rowid) FROM memories GROUP BY lower(content))`).run();
  }
}
