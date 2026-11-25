import { useSyncExternalStore } from "react";
import { readPetPreferences, savePetPreferences, type PetPreferences } from "../pet/preferences";

export interface Step { id: string; label: string; state: "running" | "done" | "failed" }
export interface Msg { id: string; role: "user" | "assistant"; text: string }
export interface Confirm { id: string; taskId: string; tool: string; args: unknown; reason: string }
export interface Settings { maxIterations: number; confirmMedium: boolean; speak: boolean; memoryEnabled: boolean; compactionThreshold: number; taskHistoryDays: number; [k: string]: unknown }
export interface YunaState {
  pet: PetPreferences;
  petOutcome?: { kind: "ready" | "blocked"; message: string; conversationId?: string };
  connected: boolean; conversationId: string; messages: Msg[];
  task?: { id: string; conversationId: string; goal: string; steps: Step[]; pending: string[]; paused: boolean; thinking: boolean };
  confirmation?: Confirm; listening: boolean; partial: string;
  flash?: { kind: "success" | "error"; text: string };
  chatOpen: boolean; tab: "chat" | "history" | "settings";
  recoverable: { id: string; goal: string; progress: string }[];
  history: { conversations: any[]; tasks: any[] }; memories: any[];
  settings: Settings;
}
const newConv = () => crypto.randomUUID();
let state: YunaState = {
  pet: readPetPreferences(),
  connected: false, conversationId: newConv(), messages: [], listening: false, partial: "", chatOpen: false, tab: "chat",
  recoverable: [], history: { conversations: [], tasks: [] }, memories: [],
  settings: { maxIterations: 100, confirmMedium: false, speak: true, memoryEnabled: true, compactionThreshold: 30, taskHistoryDays: 30 },
};
const subs = new Set<() => void>();
export const getState = () => state;
export function setState(update: Partial<YunaState> | ((s: YunaState) => Partial<YunaState>)) {
  const patch = typeof update === "function" ? update(state) : update;
  state = { ...state, ...patch };
  if (patch.chatOpen || patch.pet?.enabled === false) state.petOutcome = undefined;
  subs.forEach((listener) => listener());
}

export function updatePetPreferences(patch: Partial<PetPreferences>) {
  const pet = { ...state.pet, ...patch };
  savePetPreferences(pet);
  setState({ pet });
}
export const useYuna = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, getState);
export const newConversation = () => setState({ conversationId: newConv(), messages: [], tab: "chat" });

export type Mode = "idle" | "listening" | "thinking" | "executing" | "confirmation" | "success" | "error" | "chat";
export function modeOf(s: YunaState): Mode {
  if (s.confirmation) return "confirmation";
  if (s.chatOpen) return "chat";
  if (s.listening) return "listening";
  if (s.task) return s.task.steps.length ? "executing" : "thinking";
  if (s.flash) return s.flash.kind;
  return "idle";
}
