export interface SpeechRecognizer {
  start(): Promise<void>; stop(): Promise<void>;
  onPartial(cb: (t: string) => void): void; onFinal(cb: (t: string) => void): void; onEnd(cb: () => void): void;
}

/** Provider #1: browser Web Speech API. Replace with a streaming Whisper/Deepgram/etc provider by implementing SpeechRecognizer. */
export class WebSpeechRecognizer implements SpeechRecognizer {
  private r: any; private p: (t: string) => void = () => {}; private f: (t: string) => void = () => {}; private e: () => void = () => {};
  static supported() { return "SpeechRecognition" in window || "webkitSpeechRecognition" in window; }
  async start() {
    const C = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!C) throw new Error("Speech recognition is not available in this WebView. Plug in another SpeechRecognizer provider.");
    this.r = new C(); this.r.lang = navigator.language || "en-US"; this.r.interimResults = true; this.r.continuous = false;
    this.r.onresult = (ev: any) => { let interim = "", fin = ""; for (const res of ev.results) (res.isFinal ? (fin += res[0].transcript) : (interim += res[0].transcript)); if (fin) this.f(fin.trim()); else this.p(interim); };
    this.r.onend = () => this.e(); this.r.onerror = () => this.e();
    this.r.start();
  }
  async stop() { try { this.r?.stop(); } catch { /* noop */ } }
  onPartial(cb: (t: string) => void) { this.p = cb; } onFinal(cb: (t: string) => void) { this.f = cb; } onEnd(cb: () => void) { this.e = cb; }
}
