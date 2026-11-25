import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const native = fileURLToPath(new URL("../src-tauri/", import.meta.url));
const prefix = process.platform === "win32" ? "pc-windows-msvc.exe" :
  process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const runtime = path.join(native, "binaries", `yuna-node-${arch}-${prefix}`);
const entry = path.join(native, "sidecar", "start.mjs");
const data = await mkdtemp(path.join(tmpdir(), "yuna-agent-smoke-"));
const listener = createServer().listen(0, "127.0.0.1");
await once(listener, "listening");
const { port } = listener.address();
listener.close();
await once(listener, "close");

const token = "local-smoke-token";
const child = spawn(runtime, [entry], {
  cwd: data,
  env: { ...process.env, YUNA_DATA_DIR: data, YUNA_PORT: String(port), YUNA_TOKEN: token },
  stdio: ["ignore", "pipe", "inherit"],
});
let ws;
let timer;
const exited = new Promise(resolve => child.once("close", resolve));
try {
  await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Timed out waiting for bundled agent history")), 15_000);
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Packaged agent exited with status ${code}`)));
    let startup = "";
    child.stdout.on("data", chunk => {
      if (ws) return;
      startup += chunk.toString();
      if (!startup.includes("Yuna agent listening")) return;

      ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
      ws.once("error", reject);
      ws.on("message", buffer => {
        const message = JSON.parse(buffer.toString());
        if (message.type === "history" && Array.isArray(message.conversations) && Array.isArray(message.tasks)) resolve();
      });
    });
  });
  assert.ok((await readdir(data)).includes("yuna.db"), "the agent initialized the SQLite database");
  console.log("Packaged agent smoke passed with the bundled Node runtime and an isolated working directory.");
} finally {
  clearTimeout(timer);
  ws?.terminate();
  child.kill();
  await exited;
  await rm(data, { recursive: true, force: true, maxRetries: 3 });
}
