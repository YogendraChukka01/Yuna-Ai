import { useCallback, useEffect, useRef } from "react";
import { Island } from "./components/Island";
import { connect, send, sendTask } from "./lib/bridge";
import { getState, setState, useAru } from "./lib/store";
import { createRecognizer, tts, WebSpeechRecognizer } from "./voice";
import type { SpeechRecognizer } from "./voice/stt";

const isTauri = "__TAURI_INTERNALS__" in window;

/** Resize the transparent native window to hug the island and keep it top-centered. */
function useWindowFit(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    if (!isTauri || !ref.current) return;
    let raf = 0;
    const fit = async () => {
      const { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor } = await import("@tauri-apps/api/window");
      const r = ref.current!.getBoundingClientRect();
      const w = Math.ceil(r.width) + 32, h = Math.ceil(r.height) + 24;
      const win = getCurrentWindow(); const m = await currentMonitor(); if (!m) return;
      const sf = m.scaleFactor;
      await win.setSize(new LogicalSize(w, h));
      await win.setPosition(new LogicalPosition(m.position.x / sf + (m.size.width / sf - w) / 2, m.position.y / sf + 6));
    };
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); });
    ro.observe(ref.current); fit();
    return () => ro.disconnect();
  }, [ref]);
}

export default function App() {
  const s = useAru();
  const wrap = useRef<HTMLDivElement>(null);
  const rec = useRef<SpeechRecognizer | null>(null);
  useWindowFit(wrap);

  const stopListening = useCallback(() => { void rec.current?.stop(); setState({ listening: false, partial: "" }); }, []);
  const startListening = useCallback(async () => {
    if (getState().listening) return stopListening();
    tts.cancel(); // user speaking interrupts ARU speaking
    if (!WebSpeechRecognizer.supported()) { setState({ flash: { kind: "error", text: "Voice input unavailable in this WebView — use chat." } }); return; }
    const r = createRecognizer(); rec.current = r;
    r.onPartial((t) => setState({ partial: t }));
    r.onFinal((t) => {
      const st = getState();
      // voice interruption: "stop" / "wait" cancels the running task
      if (st.task && /^(stop|wait|cancel|never ?mind)\b/i.test(t)) send({ type: "stop", taskId: st.task.id });
      else sendTask(t, "voice");
    });
    r.onEnd(() => setState({ listening: false, partial: "" }));
    try { await r.start(); setState({ listening: true, chatOpen: false }); } catch (e) { setState({ flash: { kind: "error", text: (e as Error).message } }); }
  }, [stopListening]);

  useEffect(() => { void connect(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === "Space") { e.preventDefault(); e.shiftKey ? setState({ chatOpen: true, tab: "chat" }) : startListening(); }
      if (e.key === "Escape") { const st = getState(); if (st.chatOpen) setState({ chatOpen: false }); }
    };
    window.addEventListener("keydown", onKey);
    let un: (() => void) | undefined;
    if (isTauri) import("@tauri-apps/api/event").then(({ listen }) => listen<string>("aru-cmd", ({ payload }) => {
      const st = getState();
      if (payload === "voice") void startListening();
      else if (payload === "chat") setState({ chatOpen: true, tab: "chat" });
      else if (payload === "settings") setState({ chatOpen: true, tab: "settings" });
      else if (payload === "pause" && st.task) send({ type: "pause", taskId: st.task.id, paused: !st.task.paused });
    })).then((u) => (un = u));
    return () => { window.removeEventListener("keydown", onKey); un?.(); };
  }, [startListening]);

  const rt = s.recoverable[0];
  return (
    <div className="flex min-h-screen flex-col items-center pt-1.5">
      <div ref={wrap} className="flex flex-col items-center gap-2 p-2">
        <Island onMic={startListening} />
        {rt && !s.task && !s.confirmation && (
          <div className="w-[320px] rounded-2xl border border-white/10 bg-black/90 px-4 py-3 text-white backdrop-blur-xl">
            <div className="text-xs font-medium">Interrupted task found</div>
            <div className="mt-1 truncate text-[13px] text-zinc-200">{rt.goal}</div>
            <div className="text-[11px] text-zinc-500">{rt.progress}</div>
            <div className="mt-2 flex justify-between text-xs">
              <button className="rounded-full bg-white/10 px-3 py-1" onClick={() => send({ type: "discard_task", taskId: rt.id })}>Discard</button>
              <button className="rounded-full bg-white px-3 py-1 text-black" onClick={() => send({ type: "resume_task", taskId: rt.id })}>Resume</button>
            </div>
          </div>)}
      </div>
    </div>
  );
}
