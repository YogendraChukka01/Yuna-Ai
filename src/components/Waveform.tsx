import { useEffect, useRef } from "react";
import { startLevelMeter } from "../voice/vad";

type WaveformMode = "listening" | "speaking" | "processing";

export function Waveform({ active, mode = "listening", bars = 24 }: { active: boolean; mode?: WaveformMode; bars?: number }) {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!active) {
      refs.current.forEach((el) => {
        if (el) el.style.height = "6px";
      });
      return;
    }

    if (mode === "listening") {
      let stop: (() => void) | undefined; let dead = false;
      startLevelMeter((v) => {
        v.forEach((x, i) => {
          const el = refs.current[i];
          if (el) el.style.height = `${Math.max(6, Math.min(28, x * 100 + 6))}px`;
        });
      }, bars)
        .then((s) => (dead ? s() : (stop = s))).catch(() => {});
      return () => { dead = true; stop?.(); };
    }

    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const now = performance.now();
      const t = (now - start) / 700;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const phase = t + i / (bars * 0.9);
        const amp = mode === "speaking" ? 0.85 : 0.55;
        const h = mode === "speaking"
          ? 8 + Math.abs(Math.sin(phase * 2.8)) * 20 * amp + (i % 4 === 0 ? 3 : 0)
          : 6 + Math.abs(Math.sin(phase * 2.2 + i * 0.55)) * 12 * amp + 2;
        el.style.height = `${Math.max(6, Math.min(26, h))}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [active, bars, mode]);

  return (
    <div className="yuna-wave" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} ref={(el) => (refs.current[i] = el)} className="yuna-wave-bar" style={{ height: 6 }} />
      ))}
    </div>
  );
}
