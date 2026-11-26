import { z } from "zod";
import type { ToolDefinition } from "../../runtime/types";
import { fail, ok } from "../registry";
import { executeValidatedPowerShell } from "../shell/executor";

const FRIENDLY: Record<string, string> = { chrome: "chrome", "google chrome": "chrome", vscode: "code", "vs code": "code", code: "code", notepad: "notepad", "file explorer": "explorer", explorer: "explorer", terminal: "wt", spotify: "spotify", discord: "discord", calc: "calc", calculator: "calc" };
const win = (fn: () => Promise<any>) => process.platform !== "win32" ? Promise.resolve(fail("unsupported_platform", "Application tools currently support Windows only.", false)) : fn();
const WIN32 = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);' -Name A -Namespace U;`;
const Name = z.object({ name: z.string().min(1) });

export function appTools(): ToolDefinition[] {
  const show = (code: number) => (a: { name: string }) => win(async () => {
    const r = await executeValidatedPowerShell((p) => `${WIN32}$name=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.name}'));$p=Get-Process|Where-Object{$_.MainWindowHandle-ne 0-and($_.ProcessName-like("*"+$name+"*")-or$_.MainWindowTitle-like("*"+$name+"*"))}|Select-Object -First 1;if(-not$p){Write-Error 'no window';exit 3};[U.A]::ShowWindowAsync($p.MainWindowHandle, ${code})|Out-Null;[U.A]::SetForegroundWindow($p.MainWindowHandle)|Out-Null`, { name:a.name });
    if ("success" in r) return r;
    return r.code === 0 ? ok({ name: a.name }) : fail("window_not_found", `No window matching "${a.name}"`);
  });
  return [
    { name: "app.list", signature: "{}", description: "List running apps that have visible windows.", riskLevel: "low", schema: z.object({}),
      execute: () => win(async () => { const r = await executeValidatedPowerShell(() => `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress`, {}); if ("success" in r) return r; try { return ok(JSON.parse(r.stdout || "[]")); } catch { return fail("parse_error", r.stderr || "could not list apps"); } }) },
    { name: "app.open", signature: "{ name: string }", description: "Launch an installed desktop app by name (chrome, vscode, notepad, explorer, terminal, spotify, discord…). For web work prefer browser.open.", riskLevel: "low", schema: Name,
      execute: (a) => win(async () => { const exe = FRIENDLY[a.name.toLowerCase()] ?? a.name;
        const r = await executeValidatedPowerShell((p) => `try {$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.exe}'));Start-Process -FilePath $exe -ErrorAction Stop;Start-Sleep -Milliseconds 800;'ok'}catch{Write-Error $_.Exception.Message;exit 2}`, { exe });
        if ("success" in r) return r;
        return r.code === 0 ? ok({ launched: exe }, { observation: { application: a.name } }) : fail("app_not_found", `Could not launch "${a.name}" (is it installed?): ${r.stderr.slice(0, 200)}`); }) },
    { name: "app.close", signature: "{ name: string }", description: "Politely close an app's main window.", riskLevel: "medium", schema: Name,
      execute: (a) => win(async () => { const r = await executeValidatedPowerShell((p) => `${WIN32}$name=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p.name}'));$p=Get-Process|Where-Object{$_.MainWindowHandle-ne 0-and($_.ProcessName-like("*"+$name+"*")-or$_.MainWindowTitle-like("*"+$name+"*"))}|Select-Object -First 1;if(-not$p){Write-Error 'no window';exit 3};$p.CloseMainWindow()|Out-Null`, { name:a.name }); if ("success" in r) return r; return r.code === 0 ? ok({ closed: a.name }) : fail("window_not_found", `No window matching "${a.name}"`); }) },
    { name: "app.focus", signature: "{ name: string }", description: "Bring an app window to the foreground.", riskLevel: "low", schema: Name, execute: show(9) },
    { name: "app.minimize", signature: "{ name: string }", description: "Minimize an app window.", riskLevel: "low", schema: Name, execute: show(6) },
    { name: "app.maximize", signature: "{ name: string }", description: "Maximize an app window.", riskLevel: "low", schema: Name, execute: show(3) },
    { name: "app.activeWindow", signature: "{}", description: "Title of the foreground window.", riskLevel: "low", schema: z.object({}),
      execute: () => win(async () => { const r = await executeValidatedPowerShell(() => `${WIN32}$s = New-Object System.Text.StringBuilder 256; [U.A]::GetWindowText([U.A]::GetForegroundWindow(), $s, 256) | Out-Null; $s.ToString()`, {}); if ("success" in r) return r; return ok({ title: r.stdout.trim() }, { observation: { window: r.stdout.trim() } }); }) },
  ];
}
