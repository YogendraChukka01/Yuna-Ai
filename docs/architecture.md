# Architecture

```
Tauri 2 shell (Rust)  ── spawns ──►  Agent process (Node/TS, agent/server.ts)
 • transparent top-center window        • WebSocket 127.0.0.1:47821 (random token + Origin allow-list)
 • tray, Ctrl+Space hotkeys, autostart  • AgentRuntime (planner/executor/verifier loop)
        ▲  aru-cmd events                • OpenCode SDK session per task (builtin tools disabled)
        │                                • ToolRegistry → Browser(Playwright) / Computer / App / File / Shell
React UI (Dynamic Island) ◄── events ──  • Policy engine • LoopGuard • Checkpoints • Memory • SQLite (~/.aru/aru.db)
```
Voice and chat both produce the same `task` message → same `AgentRuntime.submit()`.

**Loop** (`agent/runtime/orchestrator.ts`): observe → LLM decision (JSON, zod-validated) → policy → execute → persist state+checkpoint → loop-guard → compaction check → repeat; ends on completed (after a verification turn) / blocked / cancelled / timeout / unrecoverable / confirmation.

**Context layers:** live message • working memory (pending, current tab) • compressed task summary (`task.summary`, history compacted at `compactionThreshold` and the LLM session re-seeded) • long-term memory (`memories` table, explicit/stable facts only, secret-filtered).

**Recovery:** failed tool → structured error → model told to change strategy (click ladder CSS→role→text→label); 3 same-signature repeats / A-B-A-B-A / 3 same-tool failures → forced re-plan, then stop. Browser crash → `BrowserManager.ensure()` relaunches the profile and restores tabs from the last snapshot. App restart → interrupted tasks surface a "Resume task?" card, resumed from stored state.
