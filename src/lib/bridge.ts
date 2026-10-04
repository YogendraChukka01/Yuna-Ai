import { getState, setState, type Step } from "./store";
import { tts } from "../voice";

let ws: WebSocket | undefined;
let flashTimer: number | undefined;
const isTauri = "__TAURI_INTERNALS__" in window;

async function config(): Promise<{ port: number; token: string }> {
  if (isTauri) { const { invoke } = await import("@tauri-apps/api/core"); return invoke("get_agent_config"); }
  return { port: 47821, token: "dev-token" }; // browser dev mode only
}
export const send = (m: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
const flash = (kind: "success" | "error", text: string, ms = 4500) => { clearTimeout(flashTimer); setState({ flash: { kind, text } }); flashTimer = window.setTimeout(() => setState({ flash: undefined }), ms); };

export async function connect() {
  const { port, token } = await config();
  const open = () => {
    ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
    ws.onopen = () => setState({ connected: true });
    ws.onclose = () => { setState({ connected: false }); setTimeout(open, 1500); };
    ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  };
  open();
}

function handle(e: any) {
  const s = getState();
  switch (e.type) {
    case "settings": setState({ settings: e.settings }); break;
    case "history": setState({ history: { conversations: e.conversations, tasks: e.tasks }, ...(e.messages ? { messages: e.messages.map((m: any) => ({ id: m.id, role: m.role, text: m.text })) } : {}) }); break;
    case "recoverable": setState({ recoverable: e.tasks }); break;
    case "memories": setState({ memories: e.memories }); break;
    case "task_created": setState({ task: { id: e.taskId, goal: e.goal, steps: [], pending: [], paused: false, thinking: true }, flash: undefined }); break;
    case "thinking": setState((st) => st.task ? { task: { ...st.task, thinking: true } } : {}); break;
    case "tool_started": setState((st) => st.task ? { task: { ...st.task, thinking: false, steps: [...st.task.steps, { id: e.stepId, label: e.label, state: "running" } as Step] } } : {}); break;
    // Only mark a step done after the REAL tool result arrives.
    case "tool_completed": setState((st) => st.task ? { task: { ...st.task, steps: st.task.steps.map((x) => x.id === e.stepId ? { ...x, state: e.success ? "done" : "failed" } : x) } } : {}); break;
    case "task_progress": setState((st) => st.task ? { task: { ...st.task, pending: e.data.pending ?? [] } } : {}); break;
    case "task_paused": setState((st) => st.task ? { task: { ...st.task, paused: e.paused } } : {}); break;
    case "confirmation_required": setState({ confirmation: e.data, chatOpen: false }); break;
    case "assistant_message":
      if (e.conversationId === s.conversationId) setState((st) => ({ messages: [...st.messages, { id: crypto.randomUUID(), role: "assistant", text: e.text }] }));
      if (s.settings.speak && e.conversationId === s.conversationId) tts.speak(e.text);
      break;
    case "task_ended":
      setState({ task: undefined, confirmation: undefined });
      if (!getState().chatOpen) flash(e.status === "completed" ? "success" : "error", e.message.slice(0, 140), e.status === "completed" ? 4000 : 7000);
      send({ type: "get_history" });
      break;
  }
}

export function sendTask(text: string, inputType: "chat" | "voice" = "chat") {
  const s = getState();
  setState((st) => ({ messages: [...st.messages, { id: crypto.randomUUID(), role: "user", text }] }));
  send({ type: "task", text, inputType, conversationId: s.conversationId });
}
