/** Mic level meter (also usable as a simple VAD: level near 0 = silence). Smoothing 0.7, 24 bars. */
export async function startLevelMeter(onBars: (bars: number[]) => void, bars = 24): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 256;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.frequencyBinCount); const prev = new Array(bars).fill(0);
  let raf = 0;
  const tick = () => {
    an.getByteFrequencyData(buf);
    const per = Math.floor(buf.length / bars);
    for (let i = 0; i < bars; i++) { let s = 0; for (let j = 0; j < per; j++) s += buf[i * per + j]; prev[i] = prev[i] * 0.7 + (s / per / 255) * 0.3; }
    onBars([...prev]); raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); };
}
