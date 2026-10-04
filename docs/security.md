# Security
- Provider key only in agent env (`.env`); UI gets only a per-launch random local token via Tauri IPC.
- WebSocket binds 127.0.0.1, requires token, rejects foreign Origins.
- Policy engine (deterministic): shell catastrophic patterns denied; destructive shell, file.delete, outside-home writes, purchase/send/publish-looking clicks require confirmation; system dirs are never modified.
- OpenCode built-in tools are disabled per prompt so Yuna's policy layer cannot be bypassed.
- Untrusted content rule is in the system prompt; the policy layer does not depend on model compliance.
- Logs redact `sk-…` patterns; memory refuses secret-looking content.
- Yuna uses its own browser profile and never kills the user's normal Chrome.
