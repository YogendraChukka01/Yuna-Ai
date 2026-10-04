import { z } from "zod";
import type { Page } from "playwright";
import type { ToolDefinition } from "../../runtime/types";
import { fail, ok } from "../registry";
import type { BrowserManager } from "./manager";

const norm = (u: string) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`);

/** Strategy ladder: each rung is a genuinely different way to locate the element. */
async function resolveClick(page: Page, a: { selector?: string; text?: string }): Promise<string> {
  const t = 4000;
  const label = a.text ?? a.selector ?? "";
  const rungs: [string, () => Promise<unknown>][] = [];
  if (a.selector) rungs.push(["css", () => page.locator(a.selector!).first().click({ timeout: t })]);
  if (label) {
    rungs.push(["role:button", () => page.getByRole("button", { name: label }).first().click({ timeout: t })]);
    rungs.push(["role:link", () => page.getByRole("link", { name: label }).first().click({ timeout: t })]);
    rungs.push(["text", () => page.getByText(label, { exact: false }).first().click({ timeout: t })]);
    rungs.push(["label/placeholder", () => page.getByLabel(label).or(page.getByPlaceholder(label)).first().click({ timeout: t })]);
  }
  const errs: string[] = [];
  for (const [name, fn] of rungs) { try { await fn(); return name; } catch (e) { errs.push(`${name}: ${(e as Error).message.split("\n")[0]}`); } }
  throw new Error(errs.join(" | "));
}

export function browserTools(bm: BrowserManager, dataDir: string): ToolDefinition[] {
  const withPage = async <T>(fn: (p: Page) => Promise<T>) => fn(await bm.activePage());
  const obs = async (p: Page) => ({ url: p.url(), text: await p.title().catch(() => "") });
  const wrap = (name: string, e: unknown) => {
    const m = (e as Error).message;
    return fail(/Timeout|not found|resolved to 0|strict mode/i.test(m) ? "element_not_found" : /closed|crash|disconnected/i.test(m) ? "browser_lost" : "browser_error", m.slice(0, 500), true);
  };
  const defs: ToolDefinition[] = [
    { name: "browser.open", signature: "{ url: string }", description: "Open ARU's browser (if needed) and navigate the ACTIVE tab to url.", riskLevel: "low",
      schema: z.object({ url: z.string().min(1) }),
      async execute({ url }) { try { return await withPage(async (p) => { await p.goto(norm(url), { waitUntil: "domcontentloaded", timeout: 30000 }); await bm.snapshot(); return ok({ url: p.url(), title: await p.title() }, { observation: { ...(await obs(p)), application: "ARU Browser" } }); }); } catch (e) { return wrap("open", e); } } },
    { name: "browser.new_tab", signature: "{ url?: string }", description: "Open a new tab (optionally at url) and make it active.", riskLevel: "low",
      schema: z.object({ url: z.string().optional() }),
      async execute({ url }) { try { const id = await bm.newTab(url ? norm(url) : undefined); return ok({ page_id: id }); } catch (e) { return wrap("new_tab", e); } } },
    { name: "browser.switch_tab", signature: "{ tabId: string }", description: "Activate a tab by id (see browser.current_state).", riskLevel: "low",
      schema: z.object({ tabId: z.string() }),
      async execute({ tabId }) { return bm.switchTo(tabId) ? ok({ active: tabId }) : fail("tab_not_found", `No tab ${tabId}`); } },
    { name: "browser.close_tab", signature: "{ tabId: string }", description: "Close a tab.", riskLevel: "low",
      schema: z.object({ tabId: z.string() }),
      async execute({ tabId }) { return (await bm.closeTab(tabId)) ? ok({ closed: tabId }) : fail("tab_not_found", `No tab ${tabId}`); } },
    ...(["back", "forward", "refresh"] as const).map((k): ToolDefinition => ({
      name: `browser.${k}`, signature: "{}", description: `Navigate ${k} in the active tab.`, riskLevel: "low", schema: z.object({}),
      async execute() { try { return await withPage(async (p) => { await (k === "back" ? p.goBack() : k === "forward" ? p.goForward() : p.reload()); return ok({ url: p.url() }); }); } catch (e) { return wrap(k, e); } } })),
    { name: "browser.click", signature: "{ selector?: string, text?: string }", description: "Click an element. Tries CSS, role, visible text, label in turn. Use browser.extract first to see what exists.", riskLevel: "low",
      schema: z.object({ selector: z.string().optional(), text: z.string().optional() }).refine((a) => a.selector || a.text, "selector or text required"),
      async execute(a) { try { return await withPage(async (p) => { const how = await resolveClick(p, a); await p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {}); await bm.snapshot(); return ok({ clicked: a.text ?? a.selector, strategy: how, url: p.url() }); }); } catch (e) { return wrap("click", e); } } },
    { name: "browser.type", signature: "{ text: string, selector?: string, submit?: boolean }", description: "Type text into an input (selector optional: finds the first visible search/text input or contenteditable). submit=true presses Enter.", riskLevel: "low",
      schema: z.object({ text: z.string(), selector: z.string().optional(), submit: z.boolean().optional() }),
      async execute({ text, selector, submit }) {
        try { return await withPage(async (p) => {
          const auto = 'textarea:visible, input[type=search]:visible, input[type=text]:visible, input:not([type]):visible, [role=searchbox]:visible, [role=combobox]:visible, [contenteditable=true]:visible';
          const loc = p.locator(selector ?? auto).first();
          await loc.waitFor({ state: "visible", timeout: 5000 });
          try { await loc.fill(text, { timeout: 4000 }); } catch { await loc.click(); await p.keyboard.type(text, { delay: 15 }); }
          if (submit) await p.keyboard.press("Enter");
          return ok({ typed: text.length + " chars", submitted: !!submit });
        }); } catch (e) { return wrap("type", e); } } },
    { name: "browser.press", signature: "{ key: string }", description: "Press a key (e.g. Enter, Tab, Control+L).", riskLevel: "low", schema: z.object({ key: z.string() }),
      async execute({ key }) { try { return await withPage(async (p) => { await p.keyboard.press(key); return ok({ pressed: key }); }); } catch (e) { return wrap("press", e); } } },
    { name: "browser.scroll", signature: "{ amount: number }", description: "Scroll the page vertically by amount pixels (negative = up).", riskLevel: "low", schema: z.object({ amount: z.number() }),
      async execute({ amount }) { try { return await withPage(async (p) => { await p.mouse.wheel(0, amount); return ok({ scrolled: amount }); }); } catch (e) { return wrap("scroll", e); } } },
    { name: "browser.find", signature: "{ text: string }", description: "Find visible elements containing text; returns up to 8 snippets.", riskLevel: "low", schema: z.object({ text: z.string() }),
      async execute({ text }) { try { return await withPage(async (p) => { const l = p.getByText(text, { exact: false }); const n = await l.count(); const out: string[] = []; for (let i = 0; i < Math.min(n, 8); i++) out.push((await l.nth(i).innerText().catch(() => "")).slice(0, 120)); return n ? ok({ count: n, matches: out }) : fail("element_not_found", `No element with text "${text}"`); }); } catch (e) { return wrap("find", e); } } },
    { name: "browser.extract", signature: "{ maxChars?: number }", description: "Extract the page: title, url, visible text, links, form fields. Primary way to observe the page.", riskLevel: "low", schema: z.object({ maxChars: z.number().int().min(500).max(20000).optional() }),
      async execute({ maxChars }) {
        try { return await withPage(async (p) => {
          await p.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
          const d = await p.evaluate(() => {
            const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const links = [...document.querySelectorAll("a[href]")].filter(vis).slice(0, 40).map((a) => ({ text: (a.textContent || "").trim().slice(0, 90), href: (a as HTMLAnchorElement).href }));
            const fields = [...document.querySelectorAll("input,textarea,select,button,[contenteditable=true],[role=searchbox]")].filter(vis).slice(0, 25).map((e) => ({ tag: e.tagName.toLowerCase(), type: e.getAttribute("type"), name: e.getAttribute("name"), id: e.id || null, placeholder: e.getAttribute("placeholder"), aria: e.getAttribute("aria-label"), text: (e.textContent || "").trim().slice(0, 40) }));
            return { title: document.title, text: document.body?.innerText ?? "", links, fields };
          });
          return ok({ url: p.url(), title: d.title, text: d.text.replace(/\n{3,}/g, "\n\n").slice(0, maxChars ?? 6000), links: d.links, fields: d.fields }, { observation: { url: p.url(), text: d.title } });
        }); } catch (e) { return wrap("extract", e); } } },
    { name: "browser.screenshot", signature: "{}", description: "Save a screenshot of the active tab; returns the file path.", riskLevel: "low", schema: z.object({}),
      async execute() { try { return await withPage(async (p) => { const fs = await import("node:fs"); const path = await import("node:path"); const dir = path.join(dataDir, "artifacts"); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `shot_${Date.now()}.png`); await p.screenshot({ path: f }); return ok({ path: f }, { metadata: { artifact: f, artifactType: "screenshot" }, observation: { screenshot: f } }); }); } catch (e) { return wrap("screenshot", e); } } },
    { name: "browser.current_state", signature: "{}", description: "List tabs (ids, urls, titles) and the active tab.", riskLevel: "low", schema: z.object({}),
      async execute() { try { return ok(await bm.state()); } catch (e) { return wrap("state", e); } } },
  ];
  return defs;
}
