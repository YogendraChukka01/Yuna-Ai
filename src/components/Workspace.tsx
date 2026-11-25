import { useEffect, useRef, useState, type FormEvent } from "react";
import { send, sendTask } from "../lib/bridge";
import { newConversation, setState, useYuna } from "../lib/store";
import { SettingsPanel } from "./Settings";
import "./workspace.css";

const paths = {
  spark: "M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z",
  plus: "M12 5v14M5 12h14",
  chat: "M20 11a7 7 0 0 1-7 7H5l2-3a7 7 0 1 1 13-4Z",
  history: "M4 11a8 8 0 1 1 2 6m-2-6V5m0 6h6m2-4v5l3 2",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  write: "m14 5 5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16l-1 4Z",
  explore: "M10 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 5 5",
  plan: "M4 6h16v14H4zM8 3v6m8-6v6M4 11h16m-12 4h3",
  mic: "M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5Zm-3 6a6 6 0 0 0 12 0m-6 6v4m-3 0h6",
  up: "M12 19V5m-6 6 6-6 6 6",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  menu: "M4 6h16M4 12h16M4 18h16",
};

function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

const ideas = [
  { title: "Write something", detail: "Find the right words", icon: "write", prompt: "Help me draft a clear, friendly email about " },
  { title: "Explore a topic", detail: "Follow your curiosity", icon: "explore", prompt: "Help me understand " },
  { title: "Make a plan", detail: "Break it into steps", icon: "plan", prompt: "Help me make a step-by-step plan for " },
] as const;

export function Workspace({ onMic }: { onMic: () => void }) {
  const s = useYuna();
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [s.messages, s.task?.steps]);

  function navigate(tab: typeof s.tab) {
    setState({ tab, chatOpen: true });
    setMenuOpen(false);
    if (tab === "history") send({ type: "get_history" });
  }

  function startChat() {
    newConversation();
    setDraft("");
    navigate("chat");
    input.current?.focus();
  }

  function openConversation(id: string) {
    setDraft("");
    setState({ conversationId: id, messages: [] });
    navigate("chat");
    send({ type: "get_history", conversationId: id });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!s.connected || s.task || !draft.trim()) return;
    sendTask(draft.trim());
    setDraft("");
  }

  function confirm(approve: boolean) {
    const request = s.confirmation;
    if (!request || !s.connected) return;
    send({ type: "confirm", taskId: request.taskId, id: request.id, approve });
    setState({ confirmation: undefined });
  }

  const title = s.tab === "chat" ? "Chat" : s.tab === "history" ? "History" : "Settings";
  return (
    <div className="workspace">
      <aside id="workspace-nav" className={menuOpen ? "workspace-sidebar is-open" : "workspace-sidebar"}>
        <div className="workspace-brand"><span className="workspace-mark"><Icon name="spark" size={20} /></span>Yuna<span>.</span></div>
        <button className="workspace-new" onClick={startChat}><Icon name="plus" /> New chat</button>
        <nav aria-label="Workspace">
          <button onClick={() => navigate("chat")} aria-current={s.tab === "chat" ? "page" : undefined}><Icon name="chat" /> Chat</button>
          <button onClick={() => navigate("history")} aria-current={s.tab === "history" ? "page" : undefined}><Icon name="history" /> History</button>
        </nav>
        <div className="workspace-recent">
          <h2>Recent chats</h2>
          {s.history.conversations.length ? s.history.conversations.slice(0, 6).map((c) => <button key={c.id} onClick={() => openConversation(c.id)} title={c.title}>{c.title || "Untitled chat"}</button>) : <p>No conversations yet</p>}
        </div>
        <nav className="workspace-bottom" aria-label="Preferences"><button onClick={() => navigate("settings")} aria-current={s.tab === "settings" ? "page" : undefined}><Icon name="settings" /> Settings</button></nav>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <div><button className="workspace-menu" type="button" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="workspace-nav" onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button>{title}</div>
          <span className="workspace-connection" role="status"><i className={s.connected ? "connected" : ""} />{s.connected ? "Agent connected" : "Agent offline"}</span>
        </header>
        <div className="workspace-content">
          {s.confirmation && <section className="workspace-notice" aria-label="Confirmation required"><strong>Yuna needs your confirmation</strong><p>{s.confirmation.reason}</p><pre>{s.confirmation.tool}{"\n"}{JSON.stringify(s.confirmation.args, null, 2)}</pre><button onClick={() => confirm(false)}>Cancel</button><button onClick={() => confirm(true)}>Confirm</button></section>}
          {s.flash && <p className="workspace-notice" role="status">{s.flash.text}</p>}
          {s.recoverable.map((task) => <section key={task.id} className="workspace-notice"><strong>{task.goal}</strong><p>Interrupted task · {task.progress}</p><button onClick={() => send({ type: "discard_task", taskId: task.id })}>Discard</button><button onClick={() => send({ type: "resume_task", taskId: task.id })}>Resume</button></section>)}
          {s.tab === "settings" && <section className="workspace-page"><h1>Settings</h1><SettingsPanel /></section>}
          {s.tab === "history" && <section className="workspace-page"><h1>History</h1>{s.history.conversations.length ? s.history.conversations.map((c) => <button className="workspace-history" key={c.id} onClick={() => openConversation(c.id)}>{c.title || "Untitled chat"}<Icon name="arrow" /></button>) : <p>Your conversations will appear here.</p>}</section>}
          {s.tab === "chat" && (s.messages.length ? <div className="workspace-messages" aria-live="polite">{s.messages.map((message) => <article key={message.id} className={message.role}><strong>{message.role === "user" ? "You" : "Yuna"}</strong><p>{message.text}</p></article>)}<div ref={end} /></div> : <div className="workspace-welcome">
            <div className="workspace-hero" aria-hidden="true"><span><Icon name="spark" size={29} /></span></div>
            <h1>What’s on your mind?</h1>
            <p>Start with a question, an idea, or something you want to get done.</p>
            <div className="workspace-ideas">{ideas.map((idea) => <button key={idea.title} onClick={() => { setDraft(idea.prompt); input.current?.focus(); }}><span className="workspace-idea-icon"><Icon name={idea.icon} /></span><span className="workspace-idea-text"><strong>{idea.title}</strong><small>{idea.detail}</small></span><Icon name="arrow" size={15} /></button>)}</div>
          </div>)}
          {s.task && <section className="workspace-notice" aria-label="Task progress"><strong>{s.task.paused ? "Paused" : s.task.thinking ? "Thinking…" : s.task.goal}</strong>{s.task.steps.map((step) => <p key={step.id}>{step.state === "done" ? "✓" : step.state === "failed" ? "✕" : "·"} {step.label}</p>)}<button onClick={() => send({ type: "pause", taskId: s.task?.id, paused: !s.task?.paused })}>{s.task.paused ? "Resume" : "Pause"}</button><button onClick={() => send({ type: "stop", taskId: s.task?.id })}>Stop</button></section>}
        </div>
        {s.tab === "chat" && <footer className="workspace-footer">
          <form className="workspace-composer" onSubmit={submit}>
            <textarea ref={input} aria-label="Message Yuna" placeholder={s.listening ? "Listening…" : "Message Yuna…"} value={s.listening ? s.partial : draft} readOnly={s.listening} rows={2} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <div className="workspace-composer-actions"><span>Shift + Enter for a new line</span><button type="button" className="workspace-mic" aria-label={s.listening ? "Stop listening" : "Start voice input"} aria-pressed={s.listening} disabled={!s.connected} onClick={onMic}><Icon name="mic" /></button><button className="workspace-send" type="submit" aria-label="Send message" disabled={!s.connected || !draft.trim() || !!s.task || s.listening}><Icon name="up" /></button></div>
          </form>
        </footer>}
      </main>
    </div>
  );
}
