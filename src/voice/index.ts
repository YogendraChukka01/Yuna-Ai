import { WebSpeechRecognizer, type SpeechRecognizer } from "./stt";
import { BrowserTTS, type SpeechSynth } from "./tts";
// Provider factory — swap implementations here (VAD/STT/TTS are all replaceable).
export const createRecognizer = (): SpeechRecognizer => new WebSpeechRecognizer();
export const tts: SpeechSynth = new BrowserTTS();
export { WebSpeechRecognizer };
