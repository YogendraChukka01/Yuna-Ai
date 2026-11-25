import { useCallback, useEffect, useRef } from "react";
import { Island } from "./components/Island";
import { Workspace } from "./components/Workspace";
import { connect, openQuickChat, send, sendTask } from "./lib/bridge";
import { getState, setState, updatePetPreferences, useYuna } from "./lib/store";
import { FloatingPet, type PetPress } from "./pet/FloatingPet";
import { useDesktopWindow } from "./pet/useDesktopWindow";
import { createRecognizer, tts, WebSpeechRecognizer } from "./voice";
import type { SpeechRecognizer } from "./voice/stt";

const isTauri = "__TAURI_INTERNALS__" in window;

export default function App() {
  const s = useYuna();
  const wrap = useRef<HTMLDivElement>(null);
  const rec = useRef<SpeechRecognizer | null>(null);
  const petSurface = useRef<HTMLButtonElement>(null);
  const petPress = useRef<PetPress | null>(null);
  const recovery = s.recoverable[0];
  const showRecovery = !!recovery && !s.task && !s.confirmation;
  const compactPet = isTauri && s.pet.enabled && !s.chatOpen && !showRecovery;
  useDesktopWindow({ native: isTauri, enabled: s.pet.enabled, compact: compactPet, wrap, surface: petSurface, press: petPress });

  const stopListening = useCallback(() => { void rec.current?.stop(); setState({ listening: false, partial: "" }); }, []);
  const startListening = useCallback(async () => {
    if (getState().listening) return stopListening();
    tts.cancel(); // user speaking interrupts Yuna speaking
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
      if (e.ctrlKey && e.code === "Space") { e.preventDefault(); e.shiftKey ? openQuickChat() : startListening(); }
      if (isTauri && e.key === "Escape") {
        const st = getState();
        if (st.chatOpen) setState({ chatOpen: false });
        else if (st.listening) stopListening();
      }
    };
    window.addEventListener("keydown", onKey);
    let un: (() => void) | undefined;
    let disposed = false;
    if (isTauri) import("@tauri-apps/api/event").then(({ listen }) => listen<string>("yuna-cmd", ({ payload }) => {
      const st = getState();
      if (payload === "voice") void startListening();
      else if (payload === "chat") openQuickChat();
      else if (payload === "toggle-pet") updatePetPreferences({ enabled: !st.pet.enabled });
      else if (payload === "settings") setState({ chatOpen: true, tab: "settings" });
      else if (payload === "pause" && st.task) send({ type: "pause", taskId: st.task.id, paused: !st.task.paused });
    })).then((dispose) => {
      if (disposed) dispose();
      else un = dispose;
    });
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKey);
      un?.();
    };
  }, [startListening, stopListening]);

  if (!isTauri) return <Workspace onMic={startListening} />;

  return (
    <div className={`flex min-h-screen flex-col items-center ${compactPet ? "" : "pt-1.5"}`}>
      <div ref={wrap} className={`flex flex-col items-center gap-2 ${compactPet ? "p-1" : "p-2"}`}>
        {compactPet ? <FloatingPet surface={petSurface} press={petPress} /> : <Island onMic={startListening} />}
        {showRecovery && (
          <div className="w-[320px] rounded-2xl border border-white/10 bg-black/90 px-4 py-3 text-white backdrop-blur-xl">
            <div className="text-xs font-medium">Interrupted task found</div>
            <div className="mt-1 truncate text-[13px] text-zinc-200">{recovery.goal}</div>
            <div className="text-[11px] text-zinc-500">{recovery.progress}</div>
            <div className="mt-2 flex justify-between text-xs">
              <button className="rounded-full bg-white/10 px-3 py-1" onClick={() => send({ type: "discard_task", taskId: recovery.id })}>Discard</button>
              <button className="rounded-full bg-white px-3 py-1 text-black" onClick={() => send({ type: "resume_task", taskId: recovery.id })}>Resume</button>
            </div>
          </div>)}
      </div>
    </div>
  );
}
