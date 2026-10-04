import os from "node:os";
import path from "node:path";
import type { RiskLevel, Settings } from "./types";

export type Verdict = { action: "allow" | "deny" | "confirm"; reason: string };

const CATASTROPHIC = [
  /\bformat\s+[a-z]:/i, /\bdiskpart\b/i, /\bmkfs\b/i, /\bshutdown\b/i, /\brestart-computer\b/i,
  /\brm\s+-[a-z]*r[a-z]*\s+(\/|~|\*)(\s|$)/i,
  /\breg\s+(delete|add)\b/i, /\bnet\s+user\b/i, /\bcipher\s+\/w/i, /set-executionpolicy/i,
  /\bbcdedit\b/i, /\bvssadmin\b.*delete/i,
];
const DESTRUCTIVE = [
  /\brm\s+-/i, /\brmdir\b/i, /\bdel\b/i, /\berase\b/i, /remove-item/i,
  /\bgit\s+(reset\s+--hard|clean\s+-f|push\s+.*--force)/i, /\bdrop\s+(table|database)\b/i,
  /invoke-expression|\biex\b/i, /\bcurl\b.*\|\s*(sh|bash|iex|powershell)/i, /\bchmod\s+-R\b/i,
  /\btaskkill\b/i, /\bstop-process\b/i, /\bnpm\s+publish\b/i,
];
const SYSTEM_PATHS = [/^[a-z]:\\windows(\\|$)/i, /^[a-z]:\\program files/i, /^\/(etc|bin|sbin|usr|boot|sys|system)(\/|$)/i];
const RISKY_UI = /\b(buy|purchase|pay now|place order|checkout|delete account|send|publish|post|confirm payment|change password|transfer)\b/i;

export function evaluate(
  tool: string, args: any, risk: RiskLevel, s: Pick<Settings, "confirmMedium" | "allowedRoots">,
): Verdict {
  if (tool.startsWith("shell.")) {
    const cmd = String(args?.command ?? "");
    if (CATASTROPHIC.some((r) => r.test(cmd))) return { action: "deny", reason: "Command matches a catastrophic-operation pattern and is never allowed." };
    if (DESTRUCTIVE.some((r) => r.test(cmd))) return { action: "confirm", reason: "Command looks destructive." };
  }
  if (tool.startsWith("file.") && args) {
    const paths = [args.path, args.source, args.destination].filter(Boolean).map((p: string) => path.resolve(String(p)));
    if (risk !== "low" && paths.some((p) => SYSTEM_PATHS.some((r) => r.test(p)))) return { action: "deny", reason: "Modifying system directories is not allowed." };
    const roots = [os.homedir(), ...s.allowedRoots].map((r) => path.resolve(r).toLowerCase());
    if (risk !== "low" && paths.some((p) => !roots.some((r) => p.toLowerCase().startsWith(r))))
      return { action: "confirm", reason: "Target is outside your allowed folders." };
  }
  if ((tool === "browser.click" || tool === "browser.press" || tool === "computer.click") && RISKY_UI.test(JSON.stringify(args ?? {})))
    return { action: "confirm", reason: "This looks like a purchase/send/publish-type action." };
  if (risk === "high") return { action: "confirm", reason: "High-risk action requires confirmation." };
  if (risk === "medium" && s.confirmMedium) return { action: "confirm", reason: "Confirmation required for medium-risk actions (setting)." };
  return { action: "allow", reason: "Low/permitted risk." };
}
