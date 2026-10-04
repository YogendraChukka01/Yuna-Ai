import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../../runtime/types";
import { fail, ok } from "../registry";

export const expand = (p: string) => {
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = path.join(os.homedir(), p.slice(1));
  const m = p.match(/^(desktop|documents|downloads)([\\/].*)?$/i);
  if (m) p = path.join(os.homedir(), m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), m[2] ?? "");
  return path.resolve(p);
};
const wrap = async (fn: () => Promise<any> | any) => {
  try { return await fn(); } catch (e: any) { return fail(e.code === "ENOENT" ? "not_found" : e.code === "EACCES" ? "permission_denied" : "fs_error", e.message, e.code !== "EACCES"); }
};
const P = z.object({ path: z.string() });

export function fileTools(): ToolDefinition[] {
  return [
    { name: "file.list", signature: "{ path: string }", description: "List a directory (name, type, size).", riskLevel: "low", schema: P,
      execute: (a) => wrap(() => ok(fs.readdirSync(expand(a.path), { withFileTypes: true }).slice(0, 200).map((d) => ({ name: d.name, type: d.isDirectory() ? "dir" : "file", size: d.isFile() ? fs.statSync(path.join(expand(a.path), d.name)).size : undefined })))) },
    { name: "file.search", signature: "{ query: string, root?: string }", description: "Find files whose name contains query (depth<=5, max 50).", riskLevel: "low",
      schema: z.object({ query: z.string(), root: z.string().optional() }),
      execute: (a) => wrap(() => {
        const out: string[] = []; const q = a.query.toLowerCase();
        const walk = (d: string, depth: number) => { if (depth > 5 || out.length >= 50) return; let es: fs.Dirent[] = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
          for (const e of es) { if (e.name.startsWith(".") || e.name === "node_modules") continue; const f = path.join(d, e.name); if (e.name.toLowerCase().includes(q)) out.push(f); if (e.isDirectory()) walk(f, depth + 1); } };
        walk(expand(a.root ?? "~"), 0); return ok(out); }) },
    { name: "file.read", signature: "{ path: string }", description: "Read a text file (first 100KB).", riskLevel: "low", schema: P,
      execute: (a) => wrap(() => { const b = fs.readFileSync(expand(a.path)); return ok({ text: b.subarray(0, 100_000).toString("utf8"), truncated: b.length > 100_000, bytes: b.length }); }) },
    { name: "file.exists", signature: "{ path: string }", description: "Check whether a path exists.", riskLevel: "low", schema: P,
      execute: (a) => wrap(() => ok({ exists: fs.existsSync(expand(a.path)) })) },
    { name: "file.write", signature: "{ path: string, content: string }", description: "Write (overwrite) a text file, creating folders. Verifies the result.", riskLevel: "medium",
      schema: z.object({ path: z.string(), content: z.string() }),
      execute: (a) => wrap(() => { const p = expand(a.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, a.content, "utf8");
        const verified = fs.existsSync(p) && fs.statSync(p).size === Buffer.byteLength(a.content, "utf8");
        return verified ? ok({ path: p, bytes: fs.statSync(p).size, verified }, { metadata: { artifact: p } }) : fail("verification_failed", `Wrote ${p} but verification failed`); }) },
    { name: "file.create", signature: "{ path: string }", description: "Create an empty file if it does not exist. Verifies the result.", riskLevel: "medium", schema: P,
      execute: (a) => wrap(() => { const p = expand(a.path); fs.mkdirSync(path.dirname(p), { recursive: true }); if (!fs.existsSync(p)) fs.writeFileSync(p, ""); return fs.existsSync(p) ? ok({ path: p, verified: true }, { metadata: { artifact: p } }) : fail("verification_failed", "File not created"); }) },
    { name: "file.copy", signature: "{ source: string, destination: string }", description: "Copy a file.", riskLevel: "medium",
      schema: z.object({ source: z.string(), destination: z.string() }),
      execute: (a) => wrap(() => { const d = expand(a.destination); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(expand(a.source), d); return ok({ destination: d, verified: fs.existsSync(d) }); }) },
    { name: "file.move", signature: "{ source: string, destination: string }", description: "Move/rename a file.", riskLevel: "medium",
      schema: z.object({ source: z.string(), destination: z.string() }),
      execute: (a) => wrap(() => { const d = expand(a.destination); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.renameSync(expand(a.source), d); return ok({ destination: d, verified: fs.existsSync(d) && !fs.existsSync(expand(a.source)) }); }) },
    { name: "file.delete", signature: "{ path: string }", description: "Delete a file or folder (ALWAYS requires user confirmation).", riskLevel: "high", schema: P,
      execute: (a) => wrap(() => { const p = expand(a.path); fs.rmSync(p, { recursive: true, force: false }); return fs.existsSync(p) ? fail("verification_failed", "Still exists") : ok({ deleted: p, verified: true }); }) },
  ];
}
