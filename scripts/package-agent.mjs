import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const native = path.join(root, "src-tauri");
const sidecar = path.join(native, "sidecar");
const binaries = path.join(native, "binaries");
const targets = {
  win32: { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc" },
  darwin: { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" },
  linux: { x64: "x86_64-unknown-linux-gnu", arm64: "aarch64-unknown-linux-gnu" },
};
const target = targets[process.platform]?.[process.arch];
if (!target) throw new Error(`Unsupported Node runtime: ${process.platform}/${process.arch}`);

const license = [path.dirname(process.execPath), path.dirname(path.dirname(process.execPath))]
  .map((directory) => path.join(directory, "LICENSE"))
  .find((file) => existsSync(file));
if (!license && process.platform !== "linux") {
  throw new Error("Install Node from its official distribution so the bundled executable includes its LICENSE.");
}

rmSync(sidecar, { recursive: true, force: true });
mkdirSync(sidecar, { recursive: true });
mkdirSync(binaries, { recursive: true });
for (const directory of ["agent", "database"]) {
  cpSync(path.join(root, directory), path.join(sidecar, directory), { recursive: true });
}
for (const file of ["package.json", "package-lock.json"]) {
  copyFileSync(path.join(root, file), path.join(sidecar, file));
}
if (license) copyFileSync(license, path.join(sidecar, "NODE-LICENSE.txt"));
copyFileSync(path.join(root, "scripts", "start-agent.mjs"), path.join(sidecar, "start.mjs"));

const install = spawnSync(process.execPath, [
  process.env.npm_execpath, "ci", "--omit=dev", "--no-bin-links", "--no-audit", "--no-fund",
], { cwd: sidecar, stdio: "inherit" });
if (install.error) throw install.error;
if (install.status !== 0) throw new Error(`Sidecar dependency install exited with status ${install.status}`);

const filename = `yuna-node-${target}${process.platform === "win32" ? ".exe" : ""}`;
const runtime = path.join(binaries, filename);
copyFileSync(process.execPath, runtime);
if (process.platform !== "win32") chmodSync(runtime, 0o755);
console.log(`Packaged the agent and ${filename}`);
