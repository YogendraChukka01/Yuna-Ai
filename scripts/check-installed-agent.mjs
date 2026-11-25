import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const [executable, ...args] = process.argv.slice(2);
if (!executable) throw new Error("Pass the absolute path to the installed Yuna executable.");
const endpoint = `http://127.0.0.1:${process.env.YUNA_PORT ?? 47821}/`;

async function agentResponds() {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(750) });
    await response.body?.cancel();
    return response.status === 404;
  } catch {
    return false;
  }
}

if (await agentResponds()) throw new Error("Stop the existing Yuna agent before testing an installed copy.");
const data = await mkdtemp(path.join(tmpdir(), "yuna-install-smoke-"));
const child = spawn(path.resolve(executable), {
  cwd: data,
  env: { ...process.env, YUNA_DATA_DIR: data },
  detached: process.platform !== "win32",
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const closed = new Promise(resolve => child.once("close", resolve));
let startupError;
let output = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", chunk => { output = (output + chunk.toString()).slice(-3000); });
}
child.once("error", error => { startupError = error; });
child.on("exit", (code, signal) => {
  if (signal || code !== 0) startupError ??= new Error(`App exited with ${signal ?? code}`);
});

try {
  const deadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Installed Yuna exited with status ${child.exitCode}`);
    if (await agentResponds()) {
      await access(path.join(data, "yuna.db"));
      console.log("Installed Yuna launched its bundled agent and initialized a fresh database.");
      ready = true;
      break;
    }
    await delay(400);
  }
  if (!ready) throw new Error("Installed Yuna did not start its local agent within 45 seconds.");
} catch (error) {
  const failure = `${error.message}${output ? `\n${output}` : ""}`;
  if (process.env.GITHUB_ACTIONS === "true") {
    console.error(`::error::${failure.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);
  }
  throw error;
} finally {
  if (child.pid) {
    if (process.platform === "win32") {
      const taskkill = path.join(process.env.SystemRoot, "System32", "taskkill.exe");
      await promisify(execFile)(taskkill, ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  await closed;
  await rm(data, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
