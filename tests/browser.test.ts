import { describe, expect, it } from "vitest";
import { BrowserStateMachine } from "../agent/tools/browser/state";

describe("browser state machine", () => {
  it("shares one launch promise for concurrent ensure calls", async () => {
    const sm = new BrowserStateMachine();
    let resolves = 0;
    const launch = sm.launch(async () => { await new Promise((r) => setTimeout(r,5)); resolves++; return "ready"; });
    const concurrent = sm.launch(async () => "duplicate");
    expect(await Promise.all([launch, concurrent])).toEqual(["ready","ready"]);
    expect(resolves).toBe(1);
  });
  it("moves from ready to crashed and restoring", () => {
    const sm = new BrowserStateMachine();
    sm.markReady(); expect(sm.state).toBe("ready");
    sm.markCrashed(); expect(sm.state).toBe("crashed");
    sm.markRestoring(); expect(sm.state).toBe("restoring");
    sm.markReady(); expect(sm.state).toBe("ready");
  });
  it("bounds retries and marks clean shutdown", async () => {
    const sm = new BrowserStateMachine();
    expect(await sm.runWithRetry(async () => { throw new Error("failed"); }, 3)).toBeNull();
    expect(sm.retries).toBe(3);
    sm.markIdle(); expect(sm.state).toBe("idle");
  });
});
