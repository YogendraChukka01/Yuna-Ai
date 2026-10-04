import { useEffect, useRef, useState } from "react";
import { send, sendTask } from "../lib/bridge";
import { newConversation, setState, useAru } from "../lib/store";
import { SettingsPanel } from "./Settings";

export function ChatPanel({ onMic }: { onMic: () => void }) {
  const s = useAru();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [s.messages.length, s.task?.steps.length]);
  const submit = () => { const t = text.trim(); if (!t) return; setText(""); sendTask(t, "chat"); };
  const Tab = ({ id, label }: { id: "chat" | "history" | "settings"; label: string }) => (
    <button onClick={() => { setState({ tab: id }); if (id === "history") send({ type: "get_history" }); }} className={`rounded-full px-3 py-1 text-[12px] ${s.tab === id ? "bg-white/15 text-white" : "text-zinc-400 hover:text-white"}`}>{label}</button>
  );
  return (
    <div className="flex w-[520px] flex-col text-white" style={{ height: 420 }}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${s.connected ? "bg-emerald-400" : "bg-zinc-500"}`} /><span className="text-sm font-medium">ARU</span>
          <div className="ml-3 flex gap-1"><Tab id="chat" label="Chat" /><Tab id="history" label="History" /><Tab id="settings" label="Settings" /></div></div>
        <div className="flex gap-3 text-zinc-400"><button title="New conversation" onClick={newConversation}>＋</button><button title="Close" onClick={() => setState({ chatOpen: false })}>✕</button></div>
      </div>
      {s.tab === "settings" && <SettingsPanel />}
      {s.tab === "history" && (
        <div className="flex-1 space-y-1 overflow-y-auto px-4 py-2 text-[13px]">
          {s.history.conversations.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5">
              <button className="truncate text-left text-zinc-200" onClick={() => { setState({ conversationId: c.id, tab: "chat" }); send({ type: "get_history", conversationId: c.id }); }}>{c.title || "Untitled"}</button>
              <button className="text-zinc-500 hover:text-red-300" onClick={() => send({ type: "delete_conversation", id: c.id })}>🗑</button>
            </div>))}
          {s.history.tasks.slice(0, 10).map((t: any) => (
            <div key={t.id} className="flex justify-between px-2 py-1 text-[12px] text-zinc-500"><span className="truncate">{t.goal}</span><span>{t.status}</span></div>))}
        </div>)}
      {s.tab === "chat" && (<>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-2 text-[13px] leading-relaxed" style={{ userSelect: "text" }}>
          {s.messages.length === 0 && <div className="pt-10 text-center text-zinc-500">Tell ARU what you want done.</div>}
          {s.messages.map((m) => (<div key={m.id}><div className="text-[11px] text-zinc-500">{m.role === "user" ? "You" : "ARU"}</div><div className="whitespace-pre-wrap text-zinc-100">{m.text}</div></div>))}
          {s.task && (<div className="space-y-0.5 text-zinc-300">{s.task.steps.map((st) => <div key={st.id}>{st.state === "done" ? "✓" : st.state === "failed" ? "✗" : "◉"} {st.label}</div>)}{s.task.thinking && <div className="text-zinc-500">Thinking…</div>}</div>)}
          <div ref={end} />
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2.5">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Message ARU…" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-zinc-500" autoFocus />
          <button onClick={onMic} title="Push to talk" className="text-lg">🎙</button>
          <button onClick={submit} className="rounded-full bg-white px-2.5 py-1 text-sm text-black">↑</button>
        </div></>)}
    </div>
  );
}
