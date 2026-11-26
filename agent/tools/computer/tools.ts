import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../../runtime/types";
import { fail, ok } from "../registry";
import { executeValidatedPowerShell, validateDynamicParam } from "../shell/executor";

const M = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,int e);' -Name M -Namespace U;`;
const SK = `Add-Type -AssemblyName System.Windows.Forms;`;
const click = (n: number) => Array(n).fill("[U.M]::mouse_event(2,0,0,0,0);[U.M]::mouse_event(4,0,0,0,0);Start-Sleep -Milliseconds 70;").join("");
const NAMED: Record<string, string> = { enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}", backspace: "{BACKSPACE}", delete: "{DELETE}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", space: " " };
const MOD: Record<string, string> = { ctrl: "^", control: "^", shift: "+", alt: "%" };
export function toSendKeys(keys: string[]): string | null {
  let mods = "", key = "";
  for (const k of keys.map((x) => x.toLowerCase())) {
    if (MOD[k]) mods += MOD[k];
    else if (NAMED[k]) key = NAMED[k];
    else if (/^f([1-9]|1[0-2])$/.test(k)) key = `{${k.toUpperCase()}}`;
    else if (k.length === 1) key = /[+^%~(){}[\]]/.test(k) ? `{${k}}` : k;
    else return null; // e.g. "win" is not supported by SendKeys
  }
  return key ? (mods ? `${mods}(${key})` : key) : null;
}
const win = (fn: () => Promise<any>) => process.platform !== "win32" ? Promise.resolve(fail("unsupported_platform", "computer.* tools currently support Windows only.", false)) : fn();
const int = z.number().int().min(0).max(20000);
const run = async (script: (p: Record<string,string>) => string, params: Record<string,string>, okData: unknown) => {
  const r = await executeValidatedPowerShell(script, params);
  if ("success" in r) return r;
  return r.code === 0 ? ok(okData) : fail("input_failed", r.stderr.slice(0, 300));
};

export function computerTools(dataDir: string): ToolDefinition[] {
  const T = (name: string, signature: string, description: string, schema: z.ZodTypeAny, execute: ToolDefinition["execute"], risk: ToolDefinition["riskLevel"] = "low"): ToolDefinition =>
    ({ name, signature, description: description + " (vision/coordinate fallback — prefer browser.* or app.* when possible)", schema, execute: (a, c) => win(() => execute(a, c)), riskLevel: risk });
  return [
    T("computer.screenshot", "{}", "Capture the primary screen to a PNG file.", z.object({}), async () => {
      const dir = path.join(dataDir, "artifacts"); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `screen_${Date.now()}.png`);
      const r = await executeValidatedPowerShell((p) => `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $f=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.file}')); $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save($f); "$($b.Width)x$($b.Height)"`, { file: f });
      if ("success" in r) return r;
      return r.code === 0 && fs.existsSync(f) ? ok({ path: f, size: r.stdout.trim() }, { metadata: { artifact: f, artifactType: "screenshot" }, observation: { screenshot: f } }) : fail("screenshot_failed", r.stderr.slice(0, 300));
    }),
    T("computer.click", "{ x: int, y: int }", "Left-click at screen coordinates.", z.object({ x: int, y: int }), (a) => run((p) => `${M}$x=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.x}'));$y=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.y}'));[U.M]::SetCursorPos($x,$y);${click(1)}`, { x: String(a.x), y: String(a.y) }, a)),
    T("computer.doubleClick", "{ x: int, y: int }", "Double-click at coordinates.", z.object({ x: int, y: int }), (a) => run((p) => `${M}$x=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.x}'));$y=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.y}'));[U.M]::SetCursorPos($x,$y);${click(2)}`, { x: String(a.x), y: String(a.y) }, a)),
    T("computer.move", "{ x: int, y: int }", "Move the mouse.", z.object({ x: int, y: int }), (a) => run((p) => `${M}$x=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.x}'));$y=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.y}'));[U.M]::SetCursorPos($x,$y)`, { x: String(a.x), y: String(a.y) }, a)),
    T("computer.drag", "{ from: {x:int,y:int}, to: {x:int,y:int} }", "Drag with left button.", z.object({ from: z.object({ x: int, y: int }), to: z.object({ x: int, y: int }) }),
      (a) => run((p) => `${M}$fx=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.fx}'));$fy=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.fy}'));$tx=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.tx}'));$ty=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.ty}'));[U.M]::SetCursorPos($fx,$fy);[U.M]::mouse_event(2,0,0,0,0);Start-Sleep -Milliseconds 150;[U.M]::SetCursorPos($tx,$ty);Start-Sleep -Milliseconds 150;[U.M]::mouse_event(4,0,0,0,0)`, { fx:String(a.from.x), fy:String(a.from.y), tx:String(a.to.x), ty:String(a.to.y) }, a)),
    T("computer.scroll", "{ delta: int }", "Scroll wheel (positive up, negative down; 120 = one notch).", z.object({ delta: z.number().int().min(-12000).max(12000) }), (a) => run((p) => `${M}$d=[int][Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.delta}'));[U.M]::mouse_event(0x800,0,0,$d,0)`, { delta:String(a.delta) }, a)),
    T("computer.type", "{ text: string }", "Type text into the focused control.", z.object({ text: z.string().max(5000) }), (a) => {
      try { validateDynamicParam(a.text, "text", 5000); }
      catch (e) { return Promise.resolve(fail("invalid_parameter", (e as Error).message, false)); }
      return run((p) => `${SK}$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.text}'));$e=$t.ToCharArray()|ForEach-Object{ if('+^%~(){}[]'.Contains([string]$_)) {'{'+$_+'}' } else { $_ } };[System.Windows.Forms.SendKeys]::SendWait(-join $e)`, { text:a.text }, { typed:a.text.length });
    }, "medium"),
    T("computer.keypress", "{ key: string }", "Press one key (enter, tab, esc, f5, a…).", z.object({ key: z.string() }), (a) => {
      const k = toSendKeys([a.key]); return k ? run((p) => `${SK}$k=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.key}'));[System.Windows.Forms.SendKeys]::SendWait($k)`, { key:k }, a) : Promise.resolve(fail("unsupported_key", `Unsupported key "${a.key}"`));
    }, "medium"),
    T("computer.hotkey", "{ keys: string[] }", "Press a combination, e.g. [\"ctrl\",\"l\"].", z.object({ keys: z.array(z.string()).min(1).max(4) }), (a) => {
      const k = toSendKeys(a.keys); return k ? run((p) => `${SK}$k=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.key}'));[System.Windows.Forms.SendKeys]::SendWait($k)`, { key:k }, a) : Promise.resolve(fail("unsupported_key", `Unsupported combo ${a.keys.join("+")}`));
    }, "medium"),
    T("computer.wait", "{ ms: int }", "Wait up to 10s.", z.object({ ms: z.number().int().min(0).max(10000) }), async (a) => { await new Promise((r) => setTimeout(r, a.ms)); return ok({ waited: a.ms }); }),
  ];
}
