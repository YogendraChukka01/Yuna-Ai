import { useEffect, useRef } from "react";
import { startLevelMeter } from "../voice/vad";

/** Bars driven by REAL microphone amplitude (idle ≈ 0). */
export function Waveform({ active, bars = 24 }: { active: boolean; bars?: number }) {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    if (!active) return;
    let stop: (() => void) | undefined; let dead = false;
    startLevelMeter((v) => v.forEach((x, i) => { const el = refs.current[i]; if (el) el.style.height = `${Math.max(2, Math.min(22, x * 90))}px`; }), bars)
      .then((s) => (dead ? s() : (stop = s))).catch(() => {});
    return () => { dead = true; stop?.(); };
  }, [active, bars]);
  return (
    <div className="flex h-6 items-center gap-[2px]">
      {Array.from({ length: bars }).map((_, i) => <span key={i} ref={(el) => (refs.current[i] = el)} className="w-[2px] rounded-full bg-white/80" style={{ height: 2 }} />)}
    </div>
  );
}
