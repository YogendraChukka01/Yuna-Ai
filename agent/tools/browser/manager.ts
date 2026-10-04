import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { BrowserSnapshot } from "../../runtime/types";

/**
 * Owns ONE dedicated, persistent Yuna browser profile (never the user's normal Chrome).
 * Tracks pages by stable ids; relaunches + restores tabs if the browser dies mid-task.
 */
export class BrowserManager {
  private ctx?: BrowserContext;
  private pages = new Map<string, Page>();
  private active?: string;
  private n = 0;
  private lastSnap: BrowserSnapshot = { activeIndex: 0, urls: [] };
  private closing = false;
  constructor(private profileDir: string, private channel = process.env.YUNA_BROWSER_CHANNEL || "chrome", private headless = false) {}

  isOpen() { return !!this.ctx; }

  private track(p: Page) {
    const id = `page_${++this.n}`;
    this.pages.set(id, p);
    this.active = id;
    p.on("close", () => {
      this.pages.delete(id);
      if (this.active === id) this.active = [...this.pages.keys()].pop();
    });
    return id;
  }

  async ensure(): Promise<BrowserContext> {
    if (this.ctx) return this.ctx;
    const { chromium } = await import("playwright");
    fs.mkdirSync(this.profileDir, { recursive: true });
    const opts = { headless: this.headless, viewport: null as null, args: ["--start-maximized"] };
    try { this.ctx = await chromium.launchPersistentContext(this.profileDir, { ...opts, ...(this.channel !== "chromium" && { channel: this.channel }) }); }
    catch { this.ctx = await chromium.launchPersistentContext(this.profileDir, opts); } // fall back to bundled Chromium
    this.pages.clear();
    this.ctx.on("page", (p) => this.track(p));
    this.ctx.on("close", () => { if (!this.closing) { this.ctx = undefined; this.pages.clear(); this.active = undefined; } });
    const existing = this.ctx.pages();
    if (existing.length) existing.forEach((p) => this.track(p)); else this.track(await this.ctx.newPage());
    // crash recovery: restore tabs from the last known snapshot
    if (this.lastSnap.urls.length) await this.restore(this.lastSnap);
    return this.ctx;
  }

  async restore(snap: BrowserSnapshot) {
    const ctx = this.ctx ?? (await this.ensure());
    if (!snap.urls.length) return;
    this.lastSnap = { urls: [], activeIndex: 0 }; // prevent recursion from ensure()
    const ids: string[] = [];
    for (const [i, url] of snap.urls.entries()) {
      const page = i === 0 && this.pages.size === 1 ? [...this.pages.values()][0] : await ctx.newPage();
      if (url && url !== "about:blank") await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      ids.push([...this.pages.entries()].find(([, p]) => p === page)![0]);
    }
    this.active = ids[Math.min(snap.activeIndex, ids.length - 1)];
    await this.pages.get(this.active)?.bringToFront().catch(() => {});
  }

  async activePage(): Promise<Page> {
    await this.ensure();
    let p = this.active ? this.pages.get(this.active) : undefined;
    if (!p || p.isClosed()) { p = await this.ctx!.newPage(); }
    return p;
  }
  async newTab(url?: string) {
    const ctx = await this.ensure();
    const p = await ctx.newPage();
    if (url) await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.snapshot();
    return [...this.pages.entries()].find(([, v]) => v === p)![0];
  }
  switchTo(id: string) { const p = this.pages.get(id); if (!p) return false; this.active = id; p.bringToFront().catch(() => {}); return true; }
  async closeTab(id: string) { const p = this.pages.get(id); if (!p) return false; await p.close(); return true; }

  async snapshot(): Promise<BrowserSnapshot> {
    const ids = [...this.pages.keys()];
    const snap = { activeIndex: Math.max(0, ids.indexOf(this.active ?? "")), urls: ids.map((i) => this.pages.get(i)!.url()) };
    this.lastSnap = snap;
    return snap;
  }
  async state() {
    const pages = await Promise.all([...this.pages.entries()].map(async ([id, p]) => ({ id, url: p.url(), title: await p.title().catch(() => "") })));
    return { browser_id: "browser_1", profile: path.basename(this.profileDir), active_page: this.active ?? null, pages };
  }
  async close() { this.closing = true; await this.ctx?.close().catch(() => {}); this.ctx = undefined; this.closing = false; }
}
