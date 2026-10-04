import { exec } from "node:child_process";
import os from "node:os";
import { z } from "zod";
import type { ToolDefinition } from "../../runtime/types";
import { fail, ok } from "../registry";
import { expand } from "../files/tools";

export function runPS(script: string, signal?: AbortSignal, timeout = 30000): Promise<{ stdout: string; stderr: string; code: number }> {
  const enc = Buffer.from(script, "utf16le").toString("base64");
  return run(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${enc}`, process.cwd(), timeout, signal);
}
function run(cmd: string, cwd: string, timeout: number, signal?: AbortSignal) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const c = exec(cmd, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal }, (err, stdout, stderr) =>
      resolve({ stdout: String(stdout), stderr: String(stderr), code: err ? ((err as any).code ?? 1) : 0 }));
    void c;
  });
}
const out = (r: { stdout: string; stderr: string; code: number }) =>
  r.code === 0 ? ok({ stdout: r.stdout.slice(0, 8000), stderr: r.stderr.slice(0, 2000), exitCode: 0 })
    : fail("command_failed", `exit ${r.code}: ${(r.stderr || r.stdout).slice(0, 1500)}`);

export function shellTools(): ToolDefinition[] {
  const S = z.object({ command: z.string().min(1).max(4000), cwd: z.string().optional() });
  return [
    { name: "shell.execute", signature: "{ command: string, cwd?: string }", description: "Run a shell command (cmd/sh), 60s timeout. Policy-gated; destructive commands need confirmation.", riskLevel: "medium", schema: S,
      async execute(a, ctx) { return out(await run(a.command, a.cwd ? expand(a.cwd) : os.homedir(), 60000, ctx.signal)); } },
    { name: "shell.executePowerShell", signature: "{ command: string, cwd?: string }", description: "Run a PowerShell command (Windows), 60s timeout. Policy-gated.", riskLevel: "medium", schema: S,
      async execute(a, ctx) {
        if (process.platform !== "win32") return fail("unsupported_platform", "PowerShell tools require Windows", false);
        const cwd = a.cwd ? expand(a.cwd) : os.homedir();
        return out(await runPS(`Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; ${a.command}`, ctx.signal, 60000)); } },
    { name: "shell.workingDirectory", signature: "{}", description: "Return the default working directory.", riskLevel: "low", schema: z.object({}),
      async execute() { return ok({ cwd: os.homedir() }); } },
  ];
}
