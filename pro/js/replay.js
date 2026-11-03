// replay1: death replay. While playing, a ring buffer keeps the last 5 s at 20 Hz of everything near the player
// (snakes as downsampled body points, food, power-ups, storm, hill, meteors, camera). Everything lives in typed arrays
// allocated once per match; recording a sample allocates nothing. On a match-ending death the clip is played back
// through the existing 2D/3D renderers: Replay.view() fills a view object shaped exactly like Game.build()'s output,
// with proxy snakes whose sx()/sy() read the interpolated recorded points, so no drawing code is duplicated.
import { bodyPoints } from "./sim.js?v=modes1b";

const HZ = 20, STEP = 1000 / HZ, NS = 104, MAXS = 24, MAXP = 96, MAXF = 360, MAXPU = 16, MAXM = 8;
export const RP_CLIP = 3600, RP_SLOW = 800, RP_SLOWK = 0.4, RP_HOLD = 450; // ms of game time shown, slow tail, speed, end hold

class Proxy { // a recorded snake, shaped like sim Snake for bodyPoints() and the renderers
  constructor() { this.px = new Float32Array(MAXP); this.py = new Float32Array(MAXP); this.n = 0; this.id = 0; this.r = 0.6; this.len = 1; this.a = 0; this.ta = 0; this.x = 0; this.y = 0; this.m = 10; this.alive = true; this.boosting = false; this.pu = new Uint8Array(12); this.slow = 0; this.name = ""; this.team = undefined; }
  sx(i) { return this.px[i < this.n ? i : this.n - 1]; }
  sy(i) { return this.py[i < this.n ? i : this.n - 1]; }
}

export class Replay {
  constructor() {
    const N = NS * MAXS;
    this.t = new Float64Array(NS); this.cx = new Float32Array(NS); this.cy = new Float32Array(NS); this.cz = new Float32Array(NS); this.ns = new Uint8Array(NS);
    this.sid = new Int32Array(N); this.sr = new Float32Array(N); this.sl = new Float32Array(N); this.sa = new Float32Array(N); this.sm = new Float32Array(N); this.sal = new Float32Array(N); this.sfl = new Uint8Array(N); this.snp = new Uint8Array(N); this.sp = new Float32Array(N);
    this.pts = new Float32Array(N * MAXP * 2); this.views = new Array(N); for (let i = 0; i < N; i++) this.views[i] = this.pts.subarray(i * MAXP * 2, (i + 1) * MAXP * 2);
    this.fn = new Uint16Array(NS); this.fx = new Float32Array(NS * MAXF); this.fy = new Float32Array(NS * MAXF); this.fv = new Float32Array(NS * MAXF); this.fc = new Uint8Array(NS * MAXF);
    this.pn = new Uint8Array(NS); this.px = new Float32Array(NS * MAXPU); this.py = new Float32Array(NS * MAXPU); this.pk = new Uint8Array(NS * MAXPU); this.pid = new Int32Array(NS * MAXPU);
    this.zn = new Float32Array(NS * 3); this.hl = new Float32Array(NS * 3); this.mn = new Uint8Array(NS); this.mt = new Float32Array(NS * MAXM * 4);
    this.meta = new Map(); // id -> { name, nc, fn, eye, trail, fx, avt, fr, team } (filled when a snake is first seen)
    // playback objects (built once)
    this.prox = []; this.ents = []; for (let i = 0; i < MAXS; i++) { this.prox.push(new Proxy()); this.ents.push({ s: this.prox[i], o: 0, f: 0, scale: 1, alpha: 1, used: true, ox: 0, oy: 0, emo: null, emoI: 0 }); }
    this.food = { FM: 0, fa: new Uint8Array(MAXF).fill(1), fx: new Float32Array(MAXF), fy: new Float32Array(MAXF), fv: new Float32Array(MAXF), fc: new Uint8Array(MAXF) };
    this.pus = []; this._pu = []; for (let i = 0; i < MAXPU; i++) this._pu.push({ id: 0, k: 0, x: 0, y: 0 });
    this.mets = []; this._mt = []; for (let i = 0; i < MAXM; i++) this._mt.push({ x: 0, y: 0, r: 1, t: 1, T: 1 });
    this.zone = { x: 0, y: 0, r: 0 }; this.hill = { x: 0, y: 0, r: 0, c: [1, 0.8, 0.2] }; this.cam = { x: 0, y: 0, zoom: 1, snap: false };
    this.v = { snakes: [], ghosts: [], cam: this.cam, scene: "world" };
    this.reset();
  }
  reset() { this.head = -1; this.count = 0; this.last = -1e9; this.meta.clear(); this.meId = 0; }
  // one sample from the frame Game.build() just produced (entries carry the interpolation o/f the renderer used)
  record(now, v, me, force) {
    if (!force && now - this.last < STEP - 2) return; this.last = now;
    const k = this.head = (this.head + 1) % NS; if (this.count < NS) this.count++;
    const cam = v.cam, zoom = cam.zoom || 1; this.t[k] = now; this.cx[k] = cam.x; this.cy[k] = cam.y; this.cz[k] = zoom;
    const NR = 46 * zoom, hx = me ? me.x : cam.x, hy = me ? me.y : cam.y; this.meId = me ? me.id : 0;
    let n = 0; const base = k * MAXS, L = v.snakes;
    for (let pass = 0; pass < 2 && n < MAXS; pass++) for (let i = 0; i < L.length && n < MAXS; i++) {
      const e = L[i], s = e.s; if (pass === 0 ? !e.me : e.me) continue; if (!s.alive && !e.me) continue;
      if (!e.me) { const dx = s.x - hx, dy = s.y - hy, lim = NR + Math.min(s.len, 40); if (dx * dx + dy * dy > lim * lim) continue; }
      const j = base + n, r = s.r * (e.scale || 1); let sp = Math.max(r * 0.7, 0.35); if (s.len / sp > MAXP - 2) sp = s.len / (MAXP - 2);
      const out = this.views[j], np = bodyPoints(s, e.o, e.f, sp, s.len, out, MAXP);
      if (e.ox || e.oy) for (let q = 0; q < np; q++) { out[q * 2] += e.ox; out[q * 2 + 1] += e.oy; }
      this.sid[j] = s.id; this.sr[j] = s.r; this.sp[j] = sp; this.sl[j] = Math.max(0.1, (np - 1) * sp); this.sa[j] = s.ta ?? s.a; this.sm[j] = s.m; this.snp[j] = np; this.sal[j] = e.alpha ?? 1;
      const P = s.pu; this.sfl[j] = (e.boost ? 1 : 0) | (e.me ? 2 : 0) | (e.inv ? 4 : 0) | (P && P[1] > 0 ? 8 : 0) | (P && P[4] > 0 ? 16 : 0) | (e.dash ? 32 : 0) | (s.slow > 0 ? 64 : 0) | (e.gold ? 128 : 0);
      if (!this.meta.has(s.id)) this.meta.set(s.id, { name: e.name, nc: e.nc, fn: e.fn, eye: e.eye, trail: e.trail, fx: e.fx, avt: s.avt, fr: s.fr | 0, team: e.team, glow: e.glow });
      else { const M = this.meta.get(s.id); M.name = e.name; M.nc = e.nc; }
      n++;
    }
    this.ns[k] = n;
    // food near the player (nearest radius first so a dense field still fits)
    const F = v.food; let nf = 0; const fb = k * MAXF;
    if (F && F.fa) { const FR2 = (34 * zoom) * (34 * zoom); for (let i = 0; i < F.FM && nf < MAXF; i++) { if (!F.fa[i]) continue; const dx = F.fx[i] - hx, dy = F.fy[i] - hy; if (dx * dx + dy * dy > FR2) continue; const o = fb + nf++; this.fx[o] = F.fx[i]; this.fy[o] = F.fy[i]; this.fv[o] = F.fv[i]; this.fc[o] = F.fc[i]; } }
    this.fn[k] = nf;
    let np2 = 0; const pb = k * MAXPU; if (v.pus) for (let i = 0; i < v.pus.length && np2 < MAXPU; i++) { const p = v.pus[i], dx = p.x - hx, dy = p.y - hy; if (dx * dx + dy * dy > NR * NR) continue; const o = pb + np2++; this.px[o] = p.x; this.py[o] = p.y; this.pk[o] = p.k; this.pid[o] = p.id | 0; }
    this.pn[k] = np2;
    const z = v.zone; this.zn[k * 3 + 2] = z ? z.r : -1; if (z) { this.zn[k * 3] = z.x; this.zn[k * 3 + 1] = z.y; }
    const h = v.hill; this.hl[k * 3 + 2] = h ? h.r : -1; if (h) { this.hl[k * 3] = h.x; this.hl[k * 3 + 1] = h.y; }
    let nm = 0; if (v.mets) for (let i = 0; i < v.mets.length && nm < MAXM; i++) { const M = v.mets[i], o = (k * MAXM + nm++) * 4; this.mt[o] = M.x; this.mt[o + 1] = M.y; this.mt[o + 2] = M.r; this.mt[o + 3] = Math.max(0, Math.min(1, 1 - M.t / (M.T || 1.9))); }
    this.mn[k] = nm;
  }
  // the recorded samples are frozen as a clip at death; returns false when there is nothing worth replaying
  freeze(info) {
    if (this.count < 4) return false; const last = this.head, first = (this.head - this.count + 1 + NS) % NS;
    this.clip = { first, last, n: this.count, t0: this.t[first], t1: this.t[last], ...info };
    const meIdx = this._find(last, this.meId); this.clip.ix = meIdx >= 0 ? this.views[last * MAXS + meIdx][0] : this.cx[last]; this.clip.iy = meIdx >= 0 ? this.views[last * MAXS + meIdx][1] : this.cy[last];
    return true;
  }
  _find(k, id) { const b = k * MAXS, n = this.ns[k]; for (let i = 0; i < n; i++) if (this.sid[b + i] === id) return i; return -1; }
  // playback clock: returns the clip time for a playback position c (ms of game time from the clip start)
  start() { const C = this.clip; if (!C) return false; this.c = Math.max(C.t0, C.t1 - RP_CLIP); this.cStart = this.c; this.hold = 0; this.done = false; this.impactFired = false; this.cam.snap = true; this.zk = 1; this.foc = 0; return true; }
  get total() { const C = this.clip; if (!C) return 0; const span = C.t1 - this.cStart; const slow = Math.min(RP_SLOW, span); return (span - slow) + slow / RP_SLOWK + RP_HOLD; }
  progress() { const C = this.clip; if (!C) return 1; const span = C.t1 - this.cStart, slow = Math.min(RP_SLOW, span); const played = this.c >= C.t1 ? (span - slow) + slow / RP_SLOWK + this.hold : this.c < C.t1 - slow ? this.c - this.cStart : (span - slow) + (this.c - (C.t1 - slow)) / RP_SLOWK; return Math.min(1, played / this.total); }
  // advance by a real frame dt (s); speed eases from 1 to 0.4 over 200 ms before the slow tail
  advance(dt) {
    const C = this.clip; if (!C || this.done) return; const ms = dt * 1000;
    if (this.c >= C.t1) { this.hold += ms; if (this.hold >= RP_HOLD) this.done = true; return; }
    const u = (this.c - (C.t1 - RP_SLOW)) / 200, spd = u <= -1 ? 1 : u >= 0 ? RP_SLOWK : RP_SLOWK + (1 - RP_SLOWK) * -u;
    this.c = Math.min(C.t1, this.c + ms * spd);
  }
  // fill and return the replay view for the current clip time (base = the live view, for world palette fields)
  view(base, dt, t, killerId) {
    const C = this.clip, v = this.v; for (const k in base) if (!(k in v) || k === "foodPal" || k === "foodPalCss" || k === "fpsTarget") v[k] = base[k];
    v.t = t; v.dt = dt; v.scene = "world"; v.snakes.length = 0; v.ghosts = []; v.rain = v.goldRain = null; v.cores = null; v.letterbox = false; v.hideNames = false; v.tick = undefined;
    // sample pair around the clip time
    let a = C.first, b = a; for (let i = 0; i < C.n - 1; i++) { const k = (C.first + i) % NS, k2 = (k + 1) % NS; if (this.t[k2] > this.c) { a = k; b = k2; break; } a = b = k2; }
    const ta = this.t[a], tb = this.t[b], f = b === a || tb <= ta ? 0 : Math.max(0, Math.min(1, (this.c - ta) / (tb - ta)));
    const na = this.ns[a]; let meE = null;
    for (let i = 0; i < na; i++) {
      const ja = a * MAXS + i, id = this.sid[ja], ib = b === a ? -1 : this._find(b, id), jb = ib >= 0 ? b * MAXS + ib : -1, P = this.prox[i], e = this.ents[i], M = this.meta.get(id) || {};
      const A = this.views[ja], npA = this.snp[ja]; let np = npA;
      if (jb >= 0) { const B = this.views[jb], npB = this.snp[jb]; np = Math.min(npA, npB); for (let q = 0; q < np; q++) { P.px[q] = A[q * 2] + (B[q * 2] - A[q * 2]) * f; P.py[q] = A[q * 2 + 1] + (B[q * 2 + 1] - A[q * 2 + 1]) * f; }
        if (npA > np && f < 0.5) { for (let q = np; q < npA; q++) { P.px[q] = A[q * 2]; P.py[q] = A[q * 2 + 1]; } np = npA; }
        P.r = this.sr[ja] + (this.sr[jb] - this.sr[ja]) * f; P.m = this.sm[ja] + (this.sm[jb] - this.sm[ja]) * f; P.len = Math.min(this.sl[ja] + (this.sl[jb] - this.sl[ja]) * f, (np - 1) * this.sp[ja]);
        let da = this.sa[jb] - this.sa[ja]; da = Math.atan2(Math.sin(da), Math.cos(da)); P.ta = P.a = this.sa[ja] + da * f; }
      else { for (let q = 0; q < np; q++) { P.px[q] = A[q * 2]; P.py[q] = A[q * 2 + 1]; } P.r = this.sr[ja]; P.m = this.sm[ja]; P.len = this.sl[ja]; P.a = P.ta = this.sa[ja]; }
      if (np < 2) continue; P.n = np; P.id = id; P.x = P.px[0]; P.y = P.py[0]; P.alive = true; const fl = this.sfl[ja]; P.boosting = !!(fl & 1); P.pu[1] = fl & 8 ? 1 : 0; P.pu[4] = fl & 16 ? 1 : 0; P.pu[7] = fl & 32 ? 1 : 0; P.slow = fl & 64 ? 1 : 0; P.name = M.name || ""; P.avt = M.avt; P.fr = M.fr;
      e.fn = M.fn; e.eye = M.eye | 0; e.trail = M.trail | 0; e.fx = M.fx || 0; e.name = M.name || ""; e.nc = M.nc || "#fff"; e.me = !!(fl & 2); e.boost = P.boosting; e.inv = !!(fl & 4); e.dash = !!(fl & 32); e.gold = !!(fl & 128);
      e.alpha = this.sal[ja]; e.scale = 1; e.look = P.ta; e.top = false; e.team = M.team || null; e.glow = M.glow || null; e.giant = false; e.hl = false;
      if (e.me && this.c >= C.t1) e.alpha = Math.max(0.25, 1 - this.hold / RP_HOLD * 0.75); // fade the player after impact
      if (killerId && id === killerId) { e.team = HL; e.top = true; e.nc = "#ff7a66"; e.hl = true; e.inv = false; }
      if (!e.fn) continue; v.snakes.push(e); if (e.me) meE = e;
    }
    // food / pickups / storm / hill / meteors from the nearest sample (they barely move)
    const k = f < 0.5 ? a : b, F = this.food, nf = this.fn[k], fb = k * MAXF; F.FM = nf; F.fx.set(this.fx.subarray(fb, fb + nf)); F.fy.set(this.fy.subarray(fb, fb + nf)); F.fv.set(this.fv.subarray(fb, fb + nf)); F.fc.set(this.fc.subarray(fb, fb + nf)); v.food = F;
    this.pus.length = 0; for (let i = 0; i < this.pn[k]; i++) { const p = this._pu[i], o = k * MAXPU + i; p.x = this.px[o]; p.y = this.py[o]; p.k = this.pk[o]; p.id = this.pid[o]; this.pus.push(p); } v.pus = this.pus;
    const zr = this.zn[a * 3 + 2]; if (zr >= 0) { const Z = this.zone, zb = this.zn[b * 3 + 2] >= 0 ? b : a; Z.x = this.zn[a * 3] + (this.zn[zb * 3] - this.zn[a * 3]) * f; Z.y = this.zn[a * 3 + 1] + (this.zn[zb * 3 + 1] - this.zn[a * 3 + 1]) * f; Z.r = zr + (this.zn[zb * 3 + 2] - zr) * f; v.zone = Z; } else v.zone = null;
    if (this.hl[k * 3 + 2] >= 0) { const H = this.hill; H.x = this.hl[k * 3]; H.y = this.hl[k * 3 + 1]; H.r = this.hl[k * 3 + 2]; v.hill = H; } else v.hill = null;
    this.mets.length = 0; for (let i = 0; i < this.mn[k]; i++) { const M = this._mt[i], o = (k * MAXM + i) * 4; M.x = this.mt[o]; M.y = this.mt[o + 1]; M.r = this.mt[o + 2]; M.T = 1; M.t = 1 - this.mt[o + 3]; this.mets.push(M); } v.mets = this.mets;
    // camera: follow the player's head, then ease toward the impact and zoom in during the slow tail
    const cam = this.cam, z0 = this.cz[a] + (this.cz[b] - this.cz[a]) * f; let hx = meE ? meE.s.px[0] : this.cx[a] + (this.cx[b] - this.cx[a]) * f, hy = meE ? meE.s.py[0] : this.cy[a] + (this.cy[b] - this.cy[a]) * f;
    const w = Math.max(0, Math.min(1, (this.c - (C.t1 - RP_SLOW - 300)) / (RP_SLOW + 300))), e2 = w * w * (3 - 2 * w); // smoothstep over the slow tail
    cam.x = hx + (C.ix - hx) * e2 * 0.7; cam.y = hy + (C.iy - hy) * e2 * 0.7; cam.zoom = z0 * (1 - 0.26 * e2); cam.boost = false; cam.title = cam.intro = cam.victory = cam.orbit = undefined; cam.kill = null;
    v.cam = cam; return v;
  }
}
const HL = [1.0, 0.5, 0.36]; // killer highlight (outline in 2D, rim + ground ring in 3D)
