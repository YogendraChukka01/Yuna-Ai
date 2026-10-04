import { useEffect } from "react";
import { send } from "../lib/bridge";
import { useAru } from "../lib/store";

export function SettingsPanel() {
  const { settings, memories } = useAru();
  useEffect(() => { send({ type: "memory_list" }); }, []);
  const set = (patch: object) => send({ type: "settings_set", patch });
  const autostart = async (on: boolean) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const m = await import("@tauri-apps/plugin-autostart"); on ? await m.enable() : await m.disable();
  };
  const Row = ({ label, children }: any) => <label className="flex items-center justify-between gap-3 py-1.5 text-[13px] text-zinc-200">{label}{children}</label>;
  const Toggle = ({ v, on }: { v: boolean; on: (b: boolean) => void }) => <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} className="h-4 w-4 accent-white" />;
  return (
    <div className="space-y-1 overflow-y-auto px-4 py-3" style={{ maxHeight: 300 }}>
      <Row label="Speak responses"><Toggle v={settings.speak} on={(b) => set({ speak: b })} /></Row>
      <Row label="Ask before medium-risk actions (write files, shell)"><Toggle v={settings.confirmMedium} on={(b) => set({ confirmMedium: b })} /></Row>
      <Row label="Memory"><Toggle v={settings.memoryEnabled} on={(b) => set({ memoryEnabled: b })} /></Row>
      <Row label="Launch ARU at startup"><Toggle v={false} on={autostart} /></Row>
      <Row label="Max task iterations"><input type="number" min={5} max={500} value={settings.maxIterations} onChange={(e) => set({ maxIterations: +e.target.value })} className="w-20 rounded bg-white/10 px-2 py-1 text-right" /></Row>
      <Row label="Context compaction threshold"><input type="number" min={10} max={200} value={settings.compactionThreshold} onChange={(e) => set({ compactionThreshold: +e.target.value })} className="w-20 rounded bg-white/10 px-2 py-1 text-right" /></Row>
      <Row label="Keep task history (days)"><input type="number" min={1} max={3650} value={settings.taskHistoryDays} onChange={(e) => set({ taskHistoryDays: +e.target.value })} className="w-20 rounded bg-white/10 px-2 py-1 text-right" /></Row>
      <div className="pt-2 text-[11px] uppercase tracking-wide text-zinc-500">Memory ({memories.length})</div>
      {memories.slice(0, 8).map((m: any) => (
        <div key={m.id} className="flex items-start justify-between gap-2 text-[12px] text-zinc-300">
          <span><span className="text-zinc-500">{m.category}</span> {m.content}</span>
          <button className="text-zinc-500 hover:text-white" onClick={() => send({ type: "memory_delete", id: m.id })}>✕</button>
        </div>
      ))}
      {memories.length > 0 && <button className="pt-1 text-[12px] text-red-300/80 hover:text-red-300" onClick={() => send({ type: "memory_clear" })}>Clear memory</button>}
      <div className="pt-2 text-[11px] text-zinc-500">API key and provider are configured in the agent's .env (never in the UI).</div>
    </div>
  );
}
