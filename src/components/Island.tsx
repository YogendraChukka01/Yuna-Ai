import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { send } from "../lib/bridge";
import { modeOf, setState, useYuna } from "../lib/store";
import { tts } from "../voice";
import { ChatPanel } from "./ChatPanel";
import { Waveform } from "./Waveform";

function startWindowDrag(e: React.PointerEvent<HTMLDivElement>) {
  const target = e.target as HTMLElement | null;
  if (e.button !== 0 || target?.closest("button")) return;
  e.preventDefault();
  if ("__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().startDragging();
    });
  }
}

const spring = { type: "spring", stiffness: 380, damping: 34, mass: 0.8 } as const;
const fade = {
  initial: { opacity: 0, y: 8, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.97 },
  transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] },
};

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4a3 3 0 0 1 3 3v4a3 3 0 1 1-6 0V7a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21M9 21h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 18.5V7.5A2.5 2.5 0 0 1 8.5 5h7A2.5 2.5 0 0 1 18 7.5v6A2.5 2.5 0 0 1 15.5 16H9l-3 2.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

function useTtsState() {
  const [speaking, setSpeaking] = useState(tts.speaking);
  useEffect(() => {
    const sync = () => setSpeaking(tts.speaking);
    sync();
    const id = window.setInterval(sync, 180);
    return () => window.clearInterval(id);
  }, []);
  return speaking;
}

export function Island({ onMic }: { onMic: () => void }) {
  const s = useYuna();
  const mode = modeOf(s);
  const t = s.task;
  const speaking = useTtsState();
  const showSpeaking = speaking && mode !== "chat" && mode !== "confirmation" && mode !== "executing" && mode !== "listening";
  const activeMode = showSpeaking ? "speaking" : mode;
  const icon = (st: string) => (st === "done" ? <span className="text-emerald-400">✓</span> : st === "failed" ? <span className="text-red-400">✗</span> : <span className="breathe text-amber-300">◉</span>);

  return (
    <motion.div
      layout
      transition={spring}
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 8 }}
      className={[
        "yuna-island",
        activeMode === "idle" ? "yuna-island--idle" : activeMode === "chat" ? "yuna-island--wide" : "yuna-island--expanded",
      ].join(" ")}
      onPointerDown={startWindowDrag}
      onClick={() => mode === "idle" && setState({ chatOpen: true })}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {activeMode === "idle" && (
          <motion.div key="idle" {...fade} className="yuna-shell yuna-shell--compact">
            <div className="yuna-brand">
              <span className="yuna-avatar"><span className="yuna-avatar-dot" /></span>
              <div className="min-w-0">
                <div className="yuna-name">Yuna</div>
              </div>
            </div>
            <div className="yuna-actions">
              <button type="button" aria-label="Start voice input" className="yuna-button yuna-mic yuna-mic--active" onClick={(e) => { e.stopPropagation(); onMic(); }}>
                <MicIcon />
              </button>
              <button type="button" aria-label="Open chat" className="yuna-button yuna-chat" onClick={(e) => { e.stopPropagation(); setState({ chatOpen: true, tab: "chat" }); }}>
                <ChatIcon />
              </button>
            </div>
          </motion.div>
        )}

        {activeMode === "listening" && (
          <motion.div key="listening" {...fade} className="yuna-voice-panel">
            <div className="yuna-voice-copy">
              <div className="yuna-avatar"><span className="yuna-avatar-dot" /></div>
              <div className="yuna-voice-label">
                <strong>Listening</strong>
                <span className="truncate max-w-[120px]">{s.partial || "Ready"}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Waveform active mode="listening" bars={20} />
              <button type="button" aria-label="Stop listening" className="yuna-stop" onClick={(e) => { e.stopPropagation(); onMic(); }}>
                <span className="inline-flex items-center gap-1"><StopIcon /> Stop</span>
              </button>
            </div>
          </motion.div>
        )}

        {activeMode === "thinking" && (
          <motion.div key="thinking" {...fade} className="yuna-voice-panel">
            <div className="yuna-voice-copy">
              <div className="yuna-processing">
                <span className="yuna-dot" />
                <strong className="yuna-name">Thinking</strong>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Waveform active mode="processing" bars={14} />
              {t && <button type="button" aria-label="Stop task" className="yuna-stop" onClick={(e) => { e.stopPropagation(); send({ type: "stop", taskId: t.id }); }}>Stop</button>}
            </div>
          </motion.div>
        )}

        {activeMode === "speaking" && (
          <motion.div key="speaking" {...fade} className="yuna-voice-panel">
            <div className="yuna-voice-copy">
              <div className="yuna-avatar"><span className="yuna-avatar-dot" /></div>
              <div className="yuna-voice-label">
                <strong>Yuna is speaking</strong>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Waveform active mode="speaking" bars={18} />
              <button type="button" aria-label="Stop speaking" className="yuna-stop" onClick={(e) => { e.stopPropagation(); tts.cancel(); }}>
                <span className="inline-flex items-center gap-1"><StopIcon /> Stop</span>
              </button>
            </div>
          </motion.div>
        )}

        {activeMode === "executing" && t && (
          <motion.div key="executing" {...fade} className="w-[360px] px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs"><span className={`h-2 w-2 rounded-full bg-white ${t.paused ? "" : "breathe"}`} /><span className="font-medium">Yuna</span>{t.paused && <span className="text-amber-300">paused</span>}</div>
            <div className="space-y-1 text-[13px]">
              {t.steps.slice(-6).map((st) => <div key={st.id} className="flex items-center justify-between gap-3"><span className="truncate text-zinc-100">{st.label}</span>{icon(st.state)}</div>)}
              {t.pending.slice(0, 2).map((p, i) => <div key={i} className="flex items-center justify-between text-zinc-500"><span className="truncate">{p}</span><span>·</span></div>)}
            </div>
            <div className="mt-3 flex justify-between text-xs">
              <button className="rounded-full bg-white/10 px-3 py-1 hover:bg-white/20" onClick={() => send({ type: "pause", taskId: t.id, paused: !t.paused })}>{t.paused ? "Resume" : "Pause"}</button>
              <button className="rounded-full bg-white/10 px-3 py-1 hover:bg-red-500/40" onClick={() => send({ type: "stop", taskId: t.id })}>Stop</button>
            </div>
          </motion.div>
        )}

        {activeMode === "confirmation" && s.confirmation && (
          <motion.div key="confirmation" {...fade} className="w-[380px] px-4 py-3">
            <div className="mb-1 text-xs font-medium">Yuna needs your confirmation</div>
            <div className="mb-2 text-[11px] text-amber-300/90">{s.confirmation.reason}</div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-white/5 p-2 text-[11px] text-zinc-200" style={{ userSelect: "text" }}>{s.confirmation.tool}{"\n"}{JSON.stringify(s.confirmation.args, null, 2)}</pre>
            <div className="mt-3 flex justify-between text-xs">
              <button className="rounded-full bg-white/10 px-4 py-1 hover:bg-white/20" onClick={() => { send({ type: "confirm", taskId: s.confirmation!.taskId, id: s.confirmation!.id, approve: false }); setState({ confirmation: undefined }); }}>Cancel</button>
              <button className="rounded-full bg-white px-4 py-1 text-black" onClick={() => { send({ type: "confirm", taskId: s.confirmation!.taskId, id: s.confirmation!.id, approve: true }); setState({ confirmation: undefined }); }}>Confirm</button>
            </div>
          </motion.div>
        )}

        {activeMode === "success" && <motion.div key="success" {...fade} className="flex max-w-[380px] items-center gap-2 px-4 py-2.5 text-[13px]"><span className="text-emerald-400">✓</span><span className="line-clamp-2">{s.flash?.text}</span></motion.div>}
        {activeMode === "error" && <motion.div key="error" {...fade} className="flex max-w-[380px] items-center gap-2 px-4 py-2.5 text-[13px]"><span className="text-red-400">!</span><span className="line-clamp-3">{s.flash?.text}</span></motion.div>}
        {activeMode === "chat" && <motion.div key="chat" {...fade}><ChatPanel onMic={onMic} /></motion.div>}
      </AnimatePresence>
      {s.recoverable.length > 0 && mode === "idle" && null}
    </motion.div>
  );
}
