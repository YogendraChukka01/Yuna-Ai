// E2E #15: fail if the built UI bundle contains any provider secret.
import fs from "node:fs"; import path from "node:path";
const dist = path.resolve("dist"); const bad = [];
const secret = process.env.OPENCODE_API_KEY;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  const t = fs.readFileSync(p, "utf8");
  if (/OPENCODE_API_KEY\s*[=:]\s*["'`]?[A-Za-z0-9_-]{8,}/.test(t) || /VITE_OPENCODE/.test(t) || (secret && secret.length > 8 && t.includes(secret))) bad.push(p);
});
if (!fs.existsSync(dist)) { console.error("dist/ missing — run npm run build:ui first"); process.exit(2); }
walk(dist);
if (bad.length) { console.error("SECRET FOUND IN BUNDLE:", bad); process.exit(1); }
console.log("bundle clean: no API key material found");
