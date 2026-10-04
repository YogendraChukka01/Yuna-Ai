import { AnimatePresence, motion } from "motion/react";
import { send } from "../lib/bridge";
import { modeOf, setState, useAru } from "../lib/store";
import { ChatPanel } from "./ChatPanel";
import { Waveform } from "./Waveform";

const spring = { type: "spring", stiffness: 380, damping: 34, mass: 0.8 } as const;
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.14 } };

export function Island({ onMic }: { onMic: () => void }) {
  const s = useAru();
  const mode = modeOf(s);
  const t = s.task;
  const icon = (st: string) => (st === "done" ? <span className="text-emerald-400">✓</span> : st === "failed" ? <span className="text-red-400">✗</span> : <span className="breathe text-amber-300">◉</span>);
  return (
    <motion.div layout transition={spring} style={{ borderRadius: mode === "idle" ? 18 : 26 }}
      className="overflow-hidden border border-white/10 bg-black/90 text-white shadow-2xl shadow-black/50 backdrop-blur-xl"
      onClick={() => mode === "idle" && setState({ chatOpen: true })}>
      <AnimatePresence mode="popLayout" initial={false}>
        {mode === "idle" && <motion.div key="idle" {...fade} className="flex h-8 w-28 cursor-pointer items-center justify-center"><span className={`h-2 w-2 rounded-full ${s.connected ? "bg-white/80" : "bg-zinc-600"}`} /></motion.div>}
        {mode === "listening" && <motion.div key="l" {...fade} className="flex items-center gap-3 px-4 py-2.5"><Waveform active /><span className="max-w-[160px] truncate text-xs text-zinc-300">{s.partial || "Listening..."}</span></motion.div>}
        {mode === "thinking" && <motion.div key="t" {...fade} className="flex items-center gap-2.5 px-4 py-2.5"><span className="breathe h-2.5 w-2.5 rounded-full bg-white" /><span className="text-xs text-zinc-300">Thinking...</span>
          {t && <button className="ml-2 text-[11px] text-zinc-400 hover:text-white" onClick={() => send({ type: "stop", taskId: t.id })}>Stop</button>}</motion.div>}
        {mode === "executing" && t && (
          <motion.div key="e" {...fade} className="w-[360px] px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs"><span className={`h-2 w-2 rounded-full bg-white ${t.paused ? "" : "breathe"}`} /><span className="font-medium">ARU</span>{t.paused && <span className="text-amber-300">paused</span>}</div>
            <div className="space-y-1 text-[13px]">
              {t.steps.slice(-6).map((st) => <div key={st.id} className="flex items-center justify-between gap-3"><span className="truncate text-zinc-100">{st.label}</span>{icon(st.state)}</div>)}
              {t.pending.slice(0, 2).map((p, i) => <div key={i} className="flex items-center justify-between text-zinc-500"><span className="truncate">{p}</span><span>·</span></div>)}
            </div>
            <div className="mt-3 flex justify-between text-xs">
              <button className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20" onClick={() => send({ type: "pause", taskId: t.id, paused: !t.paused })}>{t.paused ? "Resume" : "Pause"}</button>
              <button className="rounded-full bg-white/10 px-3 py-1 hover:bg-red-500/40" onClick={() => send({ type: "stop", taskId: t.id })}>Stop</button>
            </div>
          </motion.div>)}
        {mode === "confirmation" && s.confirmation && (
          <motion.div key="c" {...fade} className="w-[380px] px-4 py-3">
            <div className="mb-1 text-xs font-medium">ARU needs your confirmation</div>
            <div className="mb-2 text-[11px] text-amber-300/90">{s.confirmation.reason}</div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-white/5 p-2 text-[11px] text-zinc-200" style={{ userSelect: "text" }}>{s.confirmation.tool}{"\n"}{JSON.stringify(s.confirmation.args, null, 2)}</pre>
            <div className="mt-3 flex justify-between text-xs">
              <button className="rounded-full bg-white/10 px-4 py-1 hover:bg-white/20" onClick={() => { send({ type: "confirm", taskId: s.confirmation!.taskId, id: s.confirmation!.id, approve: false }); setState({ confirmation: undefined }); }}>Cancel</button>
              <button className="rounded-full bg-white px-4 py-1 text-black" onClick={() => { send({ type: "confirm", taskId: s.confirmation!.taskId, id: s.confirmation!.id, approve: true }); setState({ confirmation: undefined }); }}>Confirm</button>
            </div>
          </motion.div>)}
        {mode === "success" && <motion.div key="s" {...fade} className="flex max-w-[380px] items-center gap-2 px-4 py-2.5 text-[13px]"><span className="text-emerald-400">✓</span><span className="line-clamp-2">{s.flash?.text}</span></motion.div>}
        {mode === "error" && <motion.div key="x" {...fade} className="flex max-w-[380px] items-center gap-2 px-4 py-2.5 text-[13px]"><span className="text-red-400">!</span><span className="line-clamp-3">{s.flash?.text}</span></motion.div>}
        {mode === "chat" && <motion.div key="chat" {...fade}><ChatPanel onMic={onMic} /></motion.div>}
      </AnimatePresence>
      {s.recoverable.length > 0 && mode === "idle" && null}
    </motion.div>
  );
}
