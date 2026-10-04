export type GuardResult = "ok" | "replan" | "stop";

/** Detects repeated identical actions, A-B-A-B-A oscillation, and repeated failures of one tool. */
export class LoopGuard {
  private sigs: { sig: string; ok: boolean }[] = [];
  private replans = 0;
  constructor(private maxRepeat = 3) {}

  record(sig: string, ok: boolean): GuardResult {
    this.sigs.push({ sig, ok });
    if (this.sigs.length > 20) this.sigs.shift();
    const n = this.sigs.length;
    const last = this.sigs.slice(-this.maxRepeat);
    const repeated = last.length === this.maxRepeat && last.every((x) => x.sig === last[0].sig);
    const s = this.sigs.map((x) => x.sig);
    const abab = n >= 5 && s[n - 1] === s[n - 3] && s[n - 3] === s[n - 5] && s[n - 2] === s[n - 4] && s[n - 1] !== s[n - 2];
    const failStreak = last.length === this.maxRepeat && last.every((x) => !x.ok && x.sig.split("|")[0] === last[0].sig.split("|")[0]);
    if (repeated || abab || failStreak) {
      this.replans++;
      this.sigs = [];
      return this.replans > 2 ? "stop" : "replan";
    }
    return "ok";
  }
  reset() { this.sigs = []; this.replans = 0; }
}
