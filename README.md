# ARU Desktop

Dynamic-Island-style autonomous desktop assistant (voice + chat). Tauri 2 · React/TS/Tailwind/Motion · OpenCode SDK · Playwright · SQLite.

## Prerequisites (Windows)
Node 20+, Rust (MSVC toolchain), Microsoft C++ Build Tools, WebView2 runtime, Google Chrome (or run `npm run browsers` for bundled Chromium and set `ARU_BROWSER_CHANNEL=chromium`).

## Setup
```
npm install
npm run browsers            # optional Chromium fallback
npx tauri icon app-icon.png # generates src-tauri/icons/* (required once)
cp .env.example .env        # set OPENCODE_API_KEY (+ OPENCODE_MODEL, format provider/model)
```
## Run
- Desktop app: `npm run tauri:dev` (Rust spawns the agent sidecar for you)
- Browser-only dev (UI + agent, no native window): `npm run dev`, open http://localhost:1420
- Tests / checks: `npm test`, `npm run typecheck`, `npm run build:ui && npm run check:bundle`
- Installer: `npm run tauri:build` (NSIS + MSI)

## Use
Ctrl+Space = push-to-talk · Ctrl+Shift+Space = chat · tray menu for everything else. Say or type e.g. “Open Google, open a new tab, go to ChatGPT and search AI agents.” Say “stop” to interrupt.

## Status / known gaps (read this)
This is a complete first implementation of the MVP architecture, **written without network access, so it has not been compiled, installed or run end-to-end**. Expect to fix small type/API mismatches on first `npm install && npm run typecheck`. Specifically verify:
1. `@opencode-ai/sdk` call shapes in `agent/opencode/client.ts` against the version installed (session.create / session.prompt, `tools` map, `system`).
2. Web Speech API availability in WebView2 (may need a different `SpeechRecognizer` provider — interface in `src/voice/stt.ts`).
3. Production packaging: the agent currently runs as `node --import tsx agent/server.ts` from the repo root (fine for dev/personal use). For a distributable installer, bundle it (e.g. esbuild + Node sidecar via Tauri `externalBin`).
4. Wake word, vision-based control (screenshots are saved but not sent to the model yet), MCP adapters, task-graph UI = Phase 2 per the PRD.
