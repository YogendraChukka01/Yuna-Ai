import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

fs.rmSync("dist-agent", { recursive: true, force: true });
fs.mkdirSync("dist-agent", { recursive: true });

await build({
  entryPoints: ["agent/server.ts"],
  outfile: "dist-agent/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: false,
  banner: { js: 'import "dotenv/config";' },
});

const binaries = path.resolve("src-tauri/binaries");
fs.mkdirSync(binaries, { recursive: true });
const triple = process.env.TAURI_ENV_ARCH === "aarch64"
  ? `${process.platform === "win32" ? "aarch64-pc-windows-msvc" : process.platform === "darwin" ? "aarch64-apple-darwin" : "aarch64-unknown-linux-gnu"}`
  : `${process.platform === "win32" ? "x86_64-pc-windows-msvc" : process.platform === "darwin" ? "x86_64-apple-darwin" : "x86_64-unknown-linux-gnu"}`;
const ext = process.platform === "win32" ? ".exe" : "";
const destination = path.join(binaries, `yuna-agent-${triple}${ext}`);
fs.copyFileSync(process.execPath, destination);
fs.chmodSync(destination, 0o755);
console.log(`agent bundle: dist-agent/server.js`);
console.log(`sidecar executable: ${destination}`);
