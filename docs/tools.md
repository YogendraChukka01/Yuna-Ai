# Tools
browser.open/new_tab/switch_tab/close_tab/back/forward/refresh/click/type/press/scroll/find/extract/screenshot/current_state
computer.screenshot/click/doubleClick/move/drag/scroll/type/keypress/hotkey/wait (Windows, PowerShell)
app.list/open/close/focus/minimize/maximize/activeWindow (Windows)
file.list/search/read/exists/write/create/copy/move/delete(high)
shell.execute / shell.executePowerShell / shell.workingDirectory
Add tools by creating a `ToolDefinition` (zod schema + riskLevel) and registering it in `agent/tools/index.ts`. MCP tools can be adapted into `ToolDefinition` and registered the same way.
