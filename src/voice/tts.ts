export interface SpeechSynth { speak(text: string): void; cancel(): void; readonly speaking: boolean }
export class BrowserTTS implements SpeechSynth {
  get speaking() { return window.speechSynthesis?.speaking ?? false; }
  speak(text: string) { if (!window.speechSynthesis) return; this.cancel(); const u = new SpeechSynthesisUtterance(text.slice(0, 600)); u.rate = 1.05; window.speechSynthesis.speak(u); }
  cancel() { window.speechSynthesis?.cancel(); }
}
