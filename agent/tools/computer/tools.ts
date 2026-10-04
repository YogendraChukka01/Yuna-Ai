import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../../runtime/types";
import { fail, ok } from "../registry";
import { runPS } from "../shell/tools";

const M = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,int e);' -Name M -Namespace U;`;
const SK = `Add-Type -AssemblyName System.Windows.Forms;`;
const click = (n: number) => Array(n).fill("[U.M]::mouse_event(2,0,0,0,0);[U.M]::mouse_event(4,0,0,0,0);Start-Sleep -Milliseconds 70;").join("");
const NAMED: Record<string, string> = { enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}", backspace: "{BACKSPACE}", delete: "{DELETE}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", space: " " };
const MOD: Record<string, string> = { ctrl: "^", control: "^", shift: "+", alt: "%" };
function toSendKeys(keys: string[]): string | null {
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
const run = async (script: string, okData: unknown) => { const r = await runPS(script); return r.code === 0 ? ok(okData) : fail("input_failed", r.stderr.slice(0, 300)); };

export function computerTools(dataDir: string): ToolDefinition[] {
  const T = (name: string, signature: string, description: string, schema: z.ZodTypeAny, execute: ToolDefinition["execute"], risk: ToolDefinition["riskLevel"] = "low"): ToolDefinition =>
    ({ name, signature, description: description + " (vision/coordinate fallback — prefer browser.* or app.* when possible)", schema, execute: (a, c) => win(() => execute(a, c)), riskLevel: risk });
  return [
    T("computer.screenshot", "{}", "Capture the primary screen to a PNG file.", z.object({}), async () => {
      const dir = path.join(dataDir, "artifacts"); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `screen_${Date.now()}.png`);
      const r = await runPS(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${f.replace(/'/g, "''")}'); "$($b.Width)x$($b.Height)"`);
      return r.code === 0 && fs.existsSync(f) ? ok({ path: f, size: r.stdout.trim() }, { metadata: { artifact: f, artifactType: "screenshot" }, observation: { screenshot: f } }) : fail("screenshot_failed", r.stderr.slice(0, 300));
    }),
    T("computer.click", "{ x: int, y: int }", "Left-click at screen coordinates.", z.object({ x: int, y: int }), (a) => run(`${M}[U.M]::SetCursorPos(${a.x},${a.y});${click(1)}`, a)),
    T("computer.doubleClick", "{ x: int, y: int }", "Double-click at coordinates.", z.object({ x: int, y: int }), (a) => run(`${M}[U.M]::SetCursorPos(${a.x},${a.y});${click(2)}`, a)),
    T("computer.move", "{ x: int, y: int }", "Move the mouse.", z.object({ x: int, y: int }), (a) => run(`${M}[U.M]::SetCursorPos(${a.x},${a.y})`, a)),
    T("computer.drag", "{ from: {x:int,y:int}, to: {x:int,y:int} }", "Drag with left button.", z.object({ from: z.object({ x: int, y: int }), to: z.object({ x: int, y: int }) }),
      (a) => run(`${M}[U.M]::SetCursorPos(${a.from.x},${a.from.y});[U.M]::mouse_event(2,0,0,0,0);Start-Sleep -Milliseconds 150;[U.M]::SetCursorPos(${a.to.x},${a.to.y});Start-Sleep -Milliseconds 150;[U.M]::mouse_event(4,0,0,0,0)`, a)),
    T("computer.scroll", "{ delta: int }", "Scroll wheel (positive up, negative down; 120 = one notch).", z.object({ delta: z.number().int().min(-12000).max(12000) }), (a) => run(`${M}[U.M]::mouse_event(0x800,0,0,${a.delta},0)`, a)),
    T("computer.type", "{ text: string }", "Type text into the focused control.", z.object({ text: z.string().max(5000) }), (a) => {
      const b64 = Buffer.from(a.text, "utf8").toString("base64");
      return run(`${SK}$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); [System.Windows.Forms.SendKeys]::SendWait(($t -replace '([+^%~(){}\\[\\]])','{$1}'))`, { typed: a.text.length });
    }, "medium"),
    T("computer.keypress", "{ key: string }", "Press one key (enter, tab, esc, f5, a…).", z.object({ key: z.string() }), (a) => {
      const k = toSendKeys([a.key]); return k ? run(`${SK}[System.Windows.Forms.SendKeys]::SendWait('${k.replace(/'/g, "''")}')`, a) : Promise.resolve(fail("unsupported_key", `Unsupported key "${a.key}"`));
    }, "medium"),
    T("computer.hotkey", "{ keys: string[] }", "Press a combination, e.g. [\"ctrl\",\"l\"].", z.object({ keys: z.array(z.string()).min(1).max(4) }), (a) => {
      const k = toSendKeys(a.keys); return k ? run(`${SK}[System.Windows.Forms.SendKeys]::SendWait('${k.replace(/'/g, "''")}')`, a) : Promise.resolve(fail("unsupported_key", `Unsupported combo ${a.keys.join("+")}`));
    }, "medium"),
    T("computer.wait", "{ ms: int }", "Wait up to 10s.", z.object({ ms: z.number().int().min(0).max(10000) }), async (a) => { await new Promise((r) => setTimeout(r, a.ms)); return ok({ waited: a.ms }); }),
  ];
}
