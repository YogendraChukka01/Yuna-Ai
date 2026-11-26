export type BrowserLifecycleState = "idle" | "launching" | "ready" | "crashed" | "restoring";

export class BrowserStateMachine {
  state: BrowserLifecycleState = "idle";
  retries = 0;
  private launchPromise?: Promise<unknown>;

  launch<T>(operation: () => Promise<T>): Promise<T> {
    if (this.launchPromise) return this.launchPromise as Promise<T>;
    this.state = "launching";
    this.launchPromise = operation().then((v) => {
      this.state = "ready";
      return v;
    }).catch((e) => {
      this.state = "crashed";
      throw e;
    }).finally(() => { this.launchPromise = undefined; });
    return this.launchPromise as Promise<T>;
  }

  async runWithRetry<T>(operation: () => Promise<T>, maxRetries: number): Promise<T | null> {
    for (let i = 0; i < maxRetries; i++) {
      try { return await operation(); }
      catch { this.retries++; if (i + 1 < maxRetries) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** i, 4000))); }
    }
    this.state = "crashed";
    return null;
  }

  markReady() { this.state = "ready"; }
  markCrashed() { this.state = "crashed"; }
  markRestoring() { this.state = "restoring"; }
  markIdle() { this.state = "idle"; this.retries = 0; }
}
