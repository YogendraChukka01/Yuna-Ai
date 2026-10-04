CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, input_type TEXT, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, conversation_id TEXT, goal TEXT NOT NULL, status TEXT NOT NULL,
  current_node TEXT, active_application TEXT, active_window TEXT, browser_session_id TEXT,
  state_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_nodes (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, objective TEXT, dependencies TEXT, status TEXT, output TEXT, error TEXT, retry_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, step_number INTEGER NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, category TEXT NOT NULL, content TEXT NOT NULL, confidence REAL DEFAULT 0.8, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT, result_json TEXT, success INTEGER NOT NULL DEFAULT 0, error TEXT, started_at TEXT, completed_at TEXT);
CREATE TABLE IF NOT EXISTS permissions (id TEXT PRIMARY KEY, task_id TEXT, tool_name TEXT, arguments_json TEXT, decision TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, type TEXT, path TEXT, created_by_task TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_msgs_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tc_task ON tool_calls(task_id);
CREATE INDEX IF NOT EXISTS idx_ck_task ON checkpoints(task_id, step_number);
