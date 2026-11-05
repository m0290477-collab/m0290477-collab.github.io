// perf2: adaptive render governor. Rendering cost only: it never touches the sim, its step size or any game rule.
// Watches the real frame interval (rAF to rAF) in rolling half-second windows and moves a "lite" level 0..3 that the
// renderers turn into cheap knobs (pixel ratio cap, particle budget, shadow refresh, contact shadows, decorative strokes).
// Down fast (two slow windows, ~1 s), up slow (12 good windows, >= 8 s since the last change) with back-off: a rise that
// is followed by a drop within 12 s doubles the wait before the next rise (cap x16, halved after two calm minutes), so it settles instead of oscillating.
// Frame-rate cap: 30 fps in menus / lobby showcase, and 30 fps when the deepest level is still far from the target for
// 10 s (sustained load: a phone that is heating). The sustained cap is retried after 30 s, doubling each time it fails.
// Only active when Settings > Quality is "auto"; an explicit quality choice is left alone (level 0, no caps).
export const GOV_LEVELS = 4;
export class Governor {
  constructor() {
    this.level = 0; this.cap = 0; this.menuCap = false; this.on = true;
    this.w = new Float32Array(30); this.wn = 0; this.s = new Float32Array(30);
    this.slow = 0; this.good = 0; this.tChange = 0; this.tRise = -1e9; this.upMul = 1; this.heavyT = 0; this.capUntil = 0; this.capWait = 30000; this.capRetryT = 0;
    this.log = []; // [t, level, cap] transitions, for QA
  }
  reset() { this.wn = 0; this.slow = 0; this.good = 0; this.heavyT = 0; }
  // frame interval in ms; ctx = { inMatch, menu, auto, target(ms at 60), apply(level) }
  sample(ms, now, ctx) {
    if (!ctx.auto) { if (this.level || this.cap || this.menuCap) { this.level = 0; this.cap = 0; this.menuCap = false; ctx.apply(0); this._log(now); } return; }
    this.menuCap = !!ctx.menu;
    if (!ctx.inMatch) { this.wn = 0; return; }
    if (ms > 1000) return; // a tab switch or a one-off stall is not load (the watchdog handles stalls)
    if (!this.wn) this.w0 = now; this.w[this.wn++] = ms; if (this.wn < this.w.length && !(this.wn >= 8 && now - this.w0 > 1000)) return; // a window = 30 frames or >= 1 s
    const N = this.wn; this.wn = 0; const s = this.s.subarray(0, N); s.set(this.w.subarray(0, N)); s.sort(); const q = (f) => s[Math.min(N - 1, Math.floor(N * f))], p50 = q(0.5), p80 = q(0.8), p90 = q(0.9);
    const tgt = this.cap ? 1000 / this.cap : ctx.target;
    if (p80 > tgt * 1.1) { this.good = 0; this.slow++; } // 3dperf: slow = 20 % of a window over ~18 ms (was ~22 ms)
    else if (p90 < tgt * 1.12) { this.slow = 0; this.good++; }
    else { this.slow = 0; this.good = 0; }
    if (this.slow >= 2 && this.level < GOV_LEVELS - 1 && now - this.tChange > 1200) {
      if (now - this.tRise < 12000) this.upMul = Math.min(16, this.upMul * 2); // the last rise did not hold
      this.level++; this.tChange = now; this.slow = 0; this.good = 0; ctx.apply(this.level); this._log(now);
    } else if (this.good >= 12 * this.upMul && this.level > 0 && now - this.tChange > 8000 * this.upMul) {
      this.level--; this.tChange = this.tRise = now; this.good = 0; ctx.apply(this.level); this._log(now);
    }
    if (this.upMul > 1 && now - this.tChange > 120000) { this.upMul = Math.max(1, this.upMul / 2); this.tChange = now; } // two calm minutes: forgive a little
    // sustained heavy load at the deepest level: pace at a steady 30 instead of a ragged 35-45
    const win = now - this.w0;
    if (!this.cap) {
      if (this.level === GOV_LEVELS - 1 && p50 > ctx.target * 1.45) this.heavyT += win; else this.heavyT = 0;
      if (this.heavyT > 10000 && now > this.capRetryT) { this.cap = 30; this.capUntil = now + this.capWait; this.heavyT = 0; this._log(now); }
    } else if (now > this.capUntil) { this.cap = 0; this.capRetryT = 0; this._probe = now; this.slow = 0; this.good = 0; this._log(now); }
    if (this._probe && !this.cap && now - this._probe < 3000 && this.slow >= 2) { this.cap = 30; this.capWait = Math.min(240000, this.capWait * 2); this.capUntil = now + this.capWait; this._probe = 0; this._log(now); }
    if (this._probe && now - this._probe >= 3000) { this._probe = 0; this.capWait = 30000; }
  }
  // effective cap: the user's (0 = none) lowered to 30 in menus or under sustained load. 0 = uncapped.
  fpsCap(userCap) { const c = Math.min(userCap || Infinity, this.menuCap ? 30 : Infinity, this.cap || Infinity); return c === Infinity ? 0 : c; }
  _log(now) { this.log.push([Math.round(now), this.level, this.cap]); if (this.log.length > 60) this.log.shift(); }
  get tier() { return "L" + this.level + (this.cap ? "@" + this.cap : this.menuCap ? "m30" : ""); }
}
