import { runPS } from "./tools";
import type { ToolResult } from "../../runtime/types";
import { fail } from "../registry";

export const validateDynamicParam = (value: unknown, label: string, maxLength = 2000): string => {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value.length > maxLength) throw new Error(`${label} is too long`);
  if (/[\0-\x08\x0b\x0c\x0e-\x1f]/.test(value) || /\r|\n/.test(value))
    throw new Error(`${label} contains prohibited control characters`);
  return value;
};

export const psBase64Param = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64");

export async function executeValidatedPowerShell(
  buildScript: (p: Record<string, string>) => string,
  params: Record<string, string>,
  signal?: AbortSignal,
  timeout = 30000,
): Promise<{ stdout: string; stderr: string; code: number } | ToolResult> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    try { safe[key] = psBase64Param(validateDynamicParam(value, key)); }
    catch (e) { return fail("invalid_parameter", (e as Error).message, false); }
  }
  const script = buildScript(safe);
  return runPS(script, signal, timeout);
}
