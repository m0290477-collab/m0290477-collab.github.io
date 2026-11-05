// 2D fallback renderer (Canvas 2D): used when WebGL is missing/lost, or on devices too slow for 3D.
// Same frame(view) contract as Renderer3D so the game never knows which one it drives.
// Built for steady frame times on phones: DPR cap, cached colour strings, batched paths (shadows, highlights, food by
// colour), cached sprites for power-ups, cached ground pattern and vignette, no per-segment shadowBlur, no per-frame allocations.
import { pidFill } from "./pid.js?v=land1"; // srv2
import { stageBox } from "./stage.js?v=land1";
import { taperAt, HEAD_K, bodyPoints, PU_COL, PU_SVG, magReach, GOLD_FC, TER } from "./sim.js?v=land1";
const TUBE_STEPS = [[1, 0.28], [0.9, 0.51], [0.78, 0.85], [0.66, 1]]; // tube1: [fraction of the spine from the head, half-width / r]
import { candyBig, candyType, candySize2, drawCandySprite, drawCoinSprite, SPR_K, T_MAC, T_LOLLY, CANDY_CSS, CANDY_N } from "./gfx/candy.js?v=land1";
import { WORLDS, paintGround, worldAsset, FOOD_COLORS_CB } from "./worlds.js?v=land1";
import { EYES, SKINS, LEGEND } from "./skins.js?v=land1";
import { on as onEv } from "./events.js?v=land1";
import { gtAtlas, GT_CAP, GT_CELL } from "./gfx/gtrail.js?v=land1"; // trail1: ground trails
const NO2 = 220;
// perf2: governor levels (see gov.js): pixel-ratio cap, particle cap
const GOV_PR = [3, 2, 1.5, 1.25], GOV_PC = [300, 180, 100, 50];

const TAU = Math.PI * 2;
const CSS = new Array(32768); // 15-bit quantised rgb -> "rgb(...)" (no string building per segment)
const css = (r, g, b) => { const R = Math.max(0, Math.min(31, (r * 31 + 0.5) | 0)), G = Math.max(0, Math.min(31, (g * 31 + 0.5) | 0)), B = Math.max(0, Math.min(31, (b * 31 + 0.5) | 0)); const k = (R << 10) | (G << 5) | B; return CSS[k] || (CSS[k] = `rgb(${(R * 255 / 31) | 0},${(G * 255 / 31) | 0},${(B * 255 / 31) | 0})`); };
const lin2css = (c) => css(Math.sqrt(c[0]), Math.sqrt(c[1]), Math.sqrt(c[2]));

// aaa2: per-legendary animated surface for the 2D showcase (calm, smooth bands; no strobing)
const _hx = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const LEG2 = {}; for (const k in LEGEND) LEG2[k] = { a: _hx(LEGEND[k].tr[0]), b: _hx(LEGEND[k].tr[1]), g: _hx(LEGEND[k].glow) };
function leg2(fx, u, j, t, o) { const L = LEG2[fx]; if (!L) return; let w = 0, c = L.b;
  switch (LEGEND[fx].au || fx) {
    case 1: case 13: case 12: w = Math.pow(0.5 + 0.5 * Math.sin(u * 40 - t * 2.2), 4) * 0.75; c = L.a; break; // flowing heat
    case 2: w = (j % 7 === 3) ? 0.5 + 0.5 * Math.sin(t * 1.5 + j) : 0; c = [1, 1, 1]; break;               // stars inside
    case 3: case 11: w = Math.pow(0.5 + 0.5 * Math.sin(u * 14 - t * 1.4), 8) * 0.8; c = [1, 1, 1]; break;   // crystal glint sweep
    case 4: { const h = (u * 1.5 + t * 0.12) % 1; w = 0.45; c = [0.55 + 0.45 * Math.cos(h * 6.28), 0.55 + 0.45 * Math.cos(h * 6.28 - 2.1), 0.55 + 0.45 * Math.cos(h * 6.28 + 2.1)]; break; } // holographic sheen
    case 5: w = Math.pow(0.5 + 0.5 * Math.sin(u * 22 - t * 5), 10) * 0.9; c = [0.85, 0.97, 1]; break;      // current racing
    case 6: w = Math.pow(0.5 + 0.5 * Math.sin(u * 9 - t * 1.1), 12) * 0.7; c = [1, 0.95, 0.75]; break;     // gold glint
    case 9: w = 0.35 + 0.25 * Math.sin(u * 8 + t); c = L.a; break;
    case 10: case 8: w = 0.5 + 0.5 * Math.sin(u * 6 - t * 0.8); c = L.b; break;
    default: return;
  }
  o[0] += (c[0] - o[0]) * w; o[1] += (c[1] - o[1]) * w; o[2] += (c[2] - o[2]) * w; }

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas; this.g = canvas.getContext("2d", { alpha: false }); if (!this.g) throw new Error("2d");
    this.tmp = new Float32Array(1600); this.col = [0, 0, 0]; this.parts = []; this.pPool = []; this.rings = []; this.shakeA = 0; this.juice = true; this.reduceMotion = false;
    this.camX = 0; this.camY = 0; this.scale = 14; this.qName = "low"; this.Q = { particles: 300 }; this.is2D = true;
    this.buckets = Array.from({ length: 16 }, () => []); this.puSpr = PU_COL.map((c, k) => this._puSprite(k)); this.bgImg = null; this.vig = null; this.vigK = "";
    this.glowSpr = new Map(); // food glow sprite per colour (additive)
    this.candySpr = new Map(); this.coinSpr = null; // candy1: flat candy sprites, drawn once per (type, colour)
    this.calm = false;
    // aaa2: pooled soft orbs (typed arrays, no per-frame allocation) + event-driven fx + top-1 crown
    this.oP = new Float32Array(NO2 * 4); this.oL = new Float32Array(NO2 * 2); this.oC = new Array(NO2).fill("#fff"); this.oH = new Float32Array(NO2 * 3); this.oN = 0; this.meH = null; this.meC = "#9fe8b0"; this._fnMap = new WeakMap(); this._subFx();
    this.setWorld(0); this.resize(); this._warmCandy();
  }
  // fit1: the ~78 candy sprites used to be drawn on the first match frame (a 200-300 ms freeze at every first match start on
  // phones). Draw them in the background while the player is still on the title / lobby, a few per idle slice.
  _warmCandy() {
    const pal = CANDY_CSS, NP = pal.length, CS = this.candySpr, jobs = []; for (let ty = 0; ty < CANDY_N; ty++) for (let c = 0; c < NP; c++) jobs.push([ty, c]);
    const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 60));
    const step = (d) => { let n = 0; while (jobs.length && (n++ < 2 || d.timeRemaining() > 4)) { const [ty, c] = jobs.shift(), key = ty * 64 + c; if (!CS.has(key)) { const im = drawCandySprite(ty, pal[c], ty === T_MAC || ty === T_LOLLY ? 224 : 144); im._css = pal[c]; CS.set(key, im); } } if (jobs.length) idle(step); else if (!this.coinSpr) this.coinSpr = drawCoinSprite(160); };
    setTimeout(() => idle(step), 1500);
  }
  setQuality(q) { this.qName = q; }
  // perf2: live knobs: lower pixel ratio, fewer particles; L2+ drops the two decorative tube strokes and rain sparkles, L3 the grid and snake drop shadows
  setGov(L) { L = Math.max(0, Math.min(3, L | 0)); if (L === (this.govL | 0)) return; this.govL = L; this.resize(); }
  setOptions(o) { const lo = this.userLow; Object.assign(this, o); if (this.userLow !== lo) this.resize(); }
  setArena(R) { this.R = R; }
  setWorld(i) {
    if (i === this.worldI && this.W) return;
    this.W = WORLDS[i] || WORLDS[0]; this.bdK = ''; this.pat = null; this.worldI = i; this.gImg = null; this.gPat = null;
    // the ground is a plain colour now (calm1): no ground texture download/decode
    // lobby backdrop: the world's sky art (small webp), key art until it has loaded
    const img = new Image(); img.decoding = "async"; img.onload = () => { this.bgImg = img; this.bdK = ""; }; img.src = worldAsset(this.W, "sky", true);
    if (!this.keyImg) { const k = new Image(); k.decoding = "async"; k.onload = () => { this.keyImg = k; this.bdK = ""; }; k.src = "assets/keyart_lo.webp"; this.keyImg = null; }
  }
  // sharp1: full device pixel ratio (cap 3), no dynamic resolution. The backing store matches the canvas's exact CSS box
  // x DPR (integer), and the transform uses the real backing/CSS ratio so nothing is resampled by the compositor.
  // The buffer is only reallocated when the size really changes.
  resize() {
    const rc = this.canvas.getBoundingClientRect(), w = rc.width || innerWidth, h = rc.height || innerHeight, d = Math.max(Math.min(1, devicePixelRatio || 1), Math.min(this.userLow ? 2 : 3, GOV_PR[this.govL | 0], devicePixelRatio || 1));
    const bw = Math.max(1, Math.round(w * d)), bh = Math.max(1, Math.round(h * d)); this.w = w; this.h = h; this.dpr = d; this.kx = bw / w; this.ky = bh / h;
    if (this.canvas.width !== bw || this.canvas.height !== bh) { this.canvas.width = bw; this.canvas.height = bh; }
    this.g.imageSmoothingEnabled = true; this.g.imageSmoothingQuality = "high"; this.bdK = ""; this.vig = null;
  }
  burst(x, y, rgb, n, spd = 6, life = 0.8) { if (this.calm) return; for (let k = 0; k < Math.min(n, 40); k++) { const a = Math.random() * TAU, v = spd * (0.3 + Math.random() * 0.7); this._part(x, y, Math.cos(a) * v, Math.sin(a) * v, life, lin2css(rgb)); } }
  emit() {}
  shatter(s, fn) { if (this.calm) return; const pts = this.tmp, n = bodyPoints(s, 0, 0, Math.max(0.5, s.r * 0.8), s.len, pts, 790), col = this.col; for (let j = 0; j < n; j += Math.max(1, (n / 40) | 0)) { fn(j, n, 0, col); const a = Math.random() * TAU, v = 2 + Math.random() * 5; this._part(pts[j * 2], pts[j * 2 + 1], Math.cos(a) * v, Math.sin(a) * v, 1, css(col[0], col[1], col[2])); } }
  // pooled particles (sharp1): no object churn, capped at 300
  _part(x, y, vx, vy, l, c) { if (this.parts.length >= GOV_PC[this.govL | 0]) return; const p = this.pPool.pop() || {}; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.l = p.m = l; p.c = c; this.parts.push(p); }
  ring(x, y, rgb, R = 8) { this.rings.push({ x, y, t: 0, R, c: lin2css(rgb) }); }
  shake(a) { if (this.juice && !this.reduceMotion && !this.calm) this.shakeA = Math.min(1.2, this.shakeA + a); }
  project(x, y) { return [(x - this.camX) * this.scale + this.w / 2, (y - this.camY) * this.scale + this.h / 2, true]; }
  info() { return { calls: 0, tris: 0 }; }
  worldReady() { return true; }
  _puSprite(k) { const c = document.createElement("canvas"); c.width = c.height = 192; const x = c.getContext("2d"), col = PU_COL[k]; x.scale(3, 3);
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, col + "55"); gr.addColorStop(0.35, col + "22"); gr.addColorStop(1, col + "00"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); // soft halo
    const og = x.createRadialGradient(27, 26, 1, 32, 32, 13); og.addColorStop(0, "#ffffff"); og.addColorStop(0.35, col); og.addColorStop(1, col + "55"); x.fillStyle = og; x.beginPath(); x.arc(32, 32, 12.5, 0, TAU); x.fill(); // glassy orb
    x.save(); x.translate(32 - 7.5, 32 - 7.5); x.scale(15 / 24, 15 / 24); x.fillStyle = "rgba(255,255,255,0.95)"; x.fill(new Path2D(PU_SVG[k]), "evenodd"); x.restore(); return c; }
  _glow(c) { let s = this.glowSpr.get(c); if (!s) { s = document.createElement("canvas"); s.width = s.height = 32; const x = s.getContext("2d"), g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, c); g.addColorStop(0.3, c + "88"); g.addColorStop(1, c + "00"); x.fillStyle = g; x.fillRect(0, 0, 32, 32); this.glowSpr.set(c, s); } return s; }
  _cover(img, a) { const g = this.g, W = this.w, H = this.h, s = Math.max(W / img.width, H / img.height) * 1.05, dw = img.width * s, dh = img.height * s; g.globalAlpha = a; g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); g.globalAlpha = 1; }
  _vignette(a) { const k = this.w + "x" + this.h + a; if (this.vigK !== k) { const g = this.g, vg = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.4, this.w / 2, this.h / 2, this.w * 0.7); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, `rgba(0,0,0,${a})`); this.vig = vg; this.vigK = k; } this.g.fillStyle = this.vig; this.g.fillRect(0, 0, this.w, this.h); }

  // ---------- lobby / menus: backdrop + animated coiling showcase of the equipped skin on a glowing pedestal ----------
  _show(v) {
    const g = this.g, W = this.w, H = this.h, t = v.t || 0, sv = v.show; g.setTransform(this.kx, 0, 0, this.ky, 0, 0);
    // backdrop (sky art + shade + vignette) is painted once per size/world into a cached canvas, then blitted
    const img = this.bgImg || this.keyImg, bk = W + "x" + H + ":" + (img ? img.src : "");
    if (this.bdK !== bk) { this.bdK = bk; const c = this.bd || (this.bd = document.createElement("canvas")); c.width = this.canvas.width; c.height = this.canvas.height; const x = c.getContext("2d"); x.setTransform(this.kx, 0, 0, this.ky, 0, 0); x.imageSmoothingQuality = "high";
      x.fillStyle = "#05060b"; x.fillRect(0, 0, W, H); if (img) { const s2 = Math.max(W / img.width, H / img.height) * 1.05, dw = img.width * s2, dh = img.height * s2; x.globalAlpha = 0.5; x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); x.globalAlpha = 1; }
      const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "rgba(5,6,11,0.55)"); gr.addColorStop(0.55, "rgba(5,6,11,0.2)"); gr.addColorStop(1, "rgba(5,6,11,0.75)"); x.fillStyle = gr; x.fillRect(0, 0, W, H);
      const vg = x.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.7); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.4)"); x.fillStyle = vg; x.fillRect(0, 0, W, H); }
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.bd, 0, 0); g.setTransform(this.kx, 0, 0, this.ky, 0, 0);
    if (!sv || !sv.d || !sv.d.fn) return;
    let cx = W * (0.5 + (sv.x || 0) * 0.55), cy = H * 0.43, R = Math.min(H * 0.2, W * 0.14) * (sv.zoom || 1); const glow = sv.glow || "#ffc845";
    // fit1: in the lobby, fit head..pedestal ring (cy - 0.5R .. cy + 1.4R) into the box between the Locker button and the world thumbnails
    if (!(this._fitN = (this._fitN || 0) + 1) || this._fitN % 15 === 1) { this._fit = null; const Rc = this.canvas.getBoundingClientRect(), B = stageBox(Rc); // resp1: shared with 3D (stage.js)
      if (B) { const top = B.top + 6, bot = B.bot - 4; if (bot - top > 30) { this._fit = { top, bot }; if (B.cx !== null) this._fit.cx = B.cx; } } } /* tidy2: centred on the show column (under Locker) */
    if (this._fit && !sv.x) { const F = this._fit, box = F.bot - F.top; R = Math.min(R, box / 1.95); cy = F.top + 0.5 * R + (box - 1.9 * R) / 2; if (F.cx) cx = F.cx; }
    // pedestal
    g.save(); g.translate(cx, cy + R * 0.95); g.scale(1, 0.32);
    const pg = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.9); pg.addColorStop(0, glow + "aa"); pg.addColorStop(0.45, glow + "33"); pg.addColorStop(1, glow + "00"); g.fillStyle = pg; g.beginPath(); g.arc(0, 0, R * 1.9, 0, TAU); g.fill();
    g.strokeStyle = glow + "cc"; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R * 1.25, 0, TAU); g.stroke(); g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, R * 1.45 + Math.sin(t * 2) * 3, 0, TAU); g.stroke(); g.restore();
    // coil: a spiral seen from slightly above (y squashed); tail outside, head rising in the middle
    const n = 70, fn = sv.d.fn, col = this.col, pts = this.tmp, rad = R * 0.15, rot = t * 0.45, breathe = 1 + Math.sin(t * 1.6) * 0.03;
    for (let j = 0; j < n; j++) { const u = j / (n - 1), a = rot + u * 3.4 * Math.PI, rr = R * (0.18 + 0.95 * u) * breathe, lift = (1 - u) ** 2 * R * 0.9;
      pts[j * 2] = cx + Math.cos(a) * rr; pts[j * 2 + 1] = cy + Math.sin(a) * rr * 0.42 + R * 0.55 - lift + Math.sin(t * 2.4 - u * 9) * R * 0.025; }
    const fx = sv.d.fx | 0; if (fx) { g.save(); g.strokeStyle = glow + "33"; g.lineWidth = rad * 2.4; g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.stroke(); g.restore(); }
    g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); for (let j = n - 1; j >= 0; j -= 2) { const rr = rad * (j ? taperAt(j / (n - 1)) : HEAD_K); g.moveTo(pts[j * 2] + rr * 1.3, pts[j * 2 + 1] + rr * 0.6); g.arc(pts[j * 2] + rr * 0.3, pts[j * 2 + 1] + rr * 0.6, rr, 0, TAU); } g.fill();
    // draw back half of the coil first (depth): segments whose y is above the centre line are behind
    for (let pass = 0; pass < 2; pass++) for (let j = n - 1; j >= 0; j--) {
      const behind = pts[j * 2 + 1] < cy + R * 0.55 - (1 - j / (n - 1)) ** 2 * R * 0.9; if ((pass === 0) !== behind && j > 3) continue; if (pass === 0 && j <= 3) continue;
      const u = j / (n - 1), rr = j ? rad * Math.max(0.35, taperAt(u)) * 1.05 : rad * HEAD_K * 1.1; fn(j, n, t, col);
      if (fx) leg2(fx, u, j, t, col); else if (!this.reduceMotion) { const w = Math.pow(0.5 + 0.5 * Math.sin(u * 18 - t * 1.8), 14) * 0.45; col[0] += (1 - col[0]) * w; col[1] += (1 - col[1]) * w; col[2] += (1 - col[2]) * w; } g.globalAlpha = fx === 7 ? 0.62 : 1;
      g.fillStyle = css(col[0], col[1], col[2]); g.beginPath(); g.arc(pts[j * 2], pts[j * 2 + 1], rr, 0, TAU); g.fill(); g.globalAlpha = 1;
      g.fillStyle = "rgba(255,255,255,0.22)"; g.beginPath(); g.arc(pts[j * 2] - rr * 0.3, pts[j * 2 + 1] - rr * 0.35, rr * 0.42, 0, TAU); g.fill();
    }
    // eyes looking at the camera, with a slow blink
    const E = EYES[sv.d.eye] || EYES[0], hx = pts[0], hy = pts[1], er = rad * 0.38 * E.s, blink = (t % 4.2) < 0.12 ? 0.15 : 1;
    for (let q = 0; q < E.n; q++) { const side = E.n === 1 ? 0 : (q ? 1 : -1) * rad * 0.5, ex = hx + side, ey = hy - rad * 0.15; g.fillStyle = E.ec; g.beginPath(); g.ellipse(ex, ey, er, er * blink, 0, 0, TAU); g.fill(); if (blink > 0.5) { g.fillStyle = E.pc; g.beginPath(); g.arc(ex + Math.sin(t * 0.7) * er * 0.3, ey + er * 0.15, er * E.p, 0, TAU); g.fill(); } }
    // aaa2: legendary signature aura (parametric, no state): each legendary has its own motion
    if (fx) { const L = LEGEND[fx], c0 = L ? L.tr[0] : glow, c1 = L ? L.tr[1] : glow, base = cy + R * 0.75;
      for (let k = 0; k < 30; k++) { const h1 = ((k * 0.6180339) % 1), h2 = ((k * 0.4142135 + 0.3) % 1), ph = (t * (0.12 + h2 * 0.1) + h1) % 1, life = Math.sin(ph * Math.PI); let x = cx, y = base, r0 = 1.2 + h2 * 1.6, a = h1 * TAU, al = life;
        switch (fx) {
          case 1: case 6: case 13: { const rr = R * (0.3 + h2 * 1.0) * (fx === 13 ? 1 - ph * 0.5 : 1); a += t * 0.15; x = cx + Math.cos(a) * rr; y = base - ph * R * 2.0 + Math.sin(a) * rr * 0.4; break; }
          case 7: { const rr = R * (0.3 + h2 * 1.0); x = cx + Math.cos(a) * rr + Math.sin(t * 0.6 + k) * 4; y = base - ph * R * 1.8; r0 = 4 + h2 * 5; al = life * 0.25; break; }
          case 2: case 3: case 12: { const rr = R * (1.25 + h2 * 0.45); a += t * (0.12 + h2 * 0.08); x = cx + Math.cos(a) * rr; y = cy + R * 0.3 + Math.sin(a) * rr * 0.4 - (fx === 12 ? Math.sin(ph * Math.PI) * R * 0.35 : (h1 - 0.5) * R * 0.5); al = fx === 12 ? life : 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 1.3 + k * 2.1), 3); break; }
          case 11: { const rr = R * (0.2 + h2 * 1.5); x = cx + Math.cos(a) * rr + Math.sin(t * 0.5 + k) * 3; y = cy - R * 1.2 + ph * R * 2.3; break; }
          case 9: { const rr = R * 1.8 * (1 - ph) + R * 0.2; a += ph * 5; x = cx + Math.cos(a) * rr; y = cy + R * 0.45 + Math.sin(a) * rr * 0.4; al = ph * (1 - ph) * 3.5; break; }
          case 4: case 8: { const rr = R * (0.4 + ph * 1.6); x = cx + Math.cos(a) * rr; y = base + Math.sin(a) * rr * 0.32; al = (1 - ph) * 0.8; r0 = 1.4; break; }
          case 5: { const f = (t * 1.6 + h1) % 1, rr = R * (0.5 + h2 * 0.9); a += Math.floor(t * 1.6 + h1) * 2.4; x = cx + Math.cos(a) * rr; y = cy + R * 0.2 + Math.sin(a) * rr * 0.42 - h2 * R * 0.6; al = (1 - f) * (1 - f); r0 = 1 + (1 - f) * 1.6; break; }
          case 10: { const rr = R * 1.5; x = cx + Math.cos(a) * rr; y = cy - R * 0.1 + Math.sin(a * 3 + t * 0.7) * R * 0.25 - h2 * R * 0.6; al = 0.2 + 0.35 * h2; r0 = 2.2; break; }
        }
        g.globalAlpha = Math.max(0, Math.min(1, al)) * 0.8; g.fillStyle = k % 2 ? c0 : c1; g.beginPath(); g.arc(x, y, r0, 0, TAU); g.fill(); }
      g.globalAlpha = 1; }
    if (false) { g.fillStyle = glow; for (let k = 0; k < 14; k++) { const a = t * 0.8 + k / 14 * TAU, r2 = R * (1.15 + 0.12 * Math.sin(t * 2 + k)), x = cx + Math.cos(a) * r2, y = cy + R * 0.2 + Math.sin(a) * r2 * 0.42 - Math.sin(t + k) * R * 0.3; g.globalAlpha = 0.55; g.beginPath(); g.arc(x, y, 1.6 + (k % 3), 0, TAU); g.fill(); } g.globalAlpha = 1; }
  }

  // land1: territory. One canvas at 3 px per cell kept in sync from the Terr change log (only changed cells are rewritten, one
  // putImageData of their bounding box), drawn with one scaled drawImage under food and snakes; smoothing on, so an edge is soft
  // over a third of a cell (crisp land, no blocky pixels, no dark fringe). Own land a little stronger. Nothing per frame while
  // nothing changes; a colour change (new snake) repaints only the owned cells.
  _terr(g, D) {
    const T = D.T, K = 3; let L = this._tl;
    if (!L || L.T !== T) { const c = document.createElement("canvas"); c.width = c.height = T.dim * K; const x = c.getContext("2d"), im = x.createImageData(T.dim * K, T.dim * K); L = this._tl = { T, c, x, im, u: new Uint32Array(im.data.buffer), gen: -1, seq: 0, me: -1, cv: -1 }; }
    const me = D.me | 0, own = T.own, rgb = T.rgb, ok = T.colOk, U = L.u, d = T.dim, W = d * K; let x0 = d, y0 = d, x1 = -1, y1 = -1;
    const put = (i) => { const s = own[i], xi = i % d, yi = (i - xi) / d, c = s * 3, v = s && ok[s] ? ((s === me ? 150 : 104) << 24 | rgb[c + 2] << 16 | rgb[c + 1] << 8 | rgb[c]) >>> 0 : 0; let o = yi * K * W + xi * K;
      for (let r = 0; r < K; r++, o += W) { U[o] = v; U[o + 1] = v; U[o + 2] = v; } };
    if (L.gen !== T.gen || L.me !== me || L.cv !== T.colV || T.seq - L.seq > TER.LOG) { U.fill(0); for (let i = 0; i < T.N; i++) if (own[i]) put(i); L.gen = T.gen; L.me = me; L.cv = T.colV; L.seq = T.seq; x0 = y0 = 0; x1 = y1 = d - 1; }
    else if (T.seq !== L.seq) { for (let q = L.seq; q < T.seq; q++) { const i = T.log[q % TER.LOG], xi = i % d, yi = (i - xi) / d; put(i); if (xi < x0) x0 = xi; if (xi > x1) x1 = xi; if (yi < y0) y0 = yi; if (yi > y1) y1 = yi; } L.seq = T.seq; }
    if (x1 >= 0) L.x.putImageData(L.im, 0, 0, x0 * K, y0 * K, (x1 - x0 + 1) * K, (y1 - y0 + 1) * K);
    const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = true; g.drawImage(L.c, -T.off, -T.off, d * T.cell, d * T.cell); g.imageSmoothingEnabled = sm;
  }
  frame(v) {
    if (v.scene === "show") { this._show(v); return; }
    if (!v.food) return;
    const g = this.g, dt = Math.min(0.05, v.dt), t = v.t, W = this.W;
    const k = v.cam.snap ? 1 : 1 - Math.exp(-dt * 16); this.camX += (v.cam.x - this.camX) * k; this.camY += (v.cam.y - this.camY) * k;
    this.scale += ((Math.min(this.w, this.h) / (24 * v.cam.zoom)) - this.scale) * k;
    let sx = 0, sy = 0; if (this.shakeA > 0.01) { sx = (Math.random() - 0.5) * this.shakeA * 8; sy = (Math.random() - 0.5) * this.shakeA * 8; this.shakeA *= Math.exp(-dt * 7); }
    g.setTransform(this.kx, 0, 0, this.ky, 0, 0);
    // calm1: a plain, solid ground. One fill for the outside, one disc for the arena, two soft strokes for its edge.
    const CM = W.calm || { out: "#0c1018", ground: "#1a2230", edge: "#8090a8" };
    g.fillStyle = CM.out; g.fillRect(0, 0, this.w, this.h);
    const S = this.scale; g.save(); g.translate(this.w / 2 + sx, this.h / 2 + sy); g.scale(S, S); g.translate(-this.camX, -this.camY);
    const R = this.R || 130, vr = Math.max(this.w, this.h) / S * 0.75, vr2 = vr * vr, cx = this.camX, cy = this.camY;
    g.fillStyle = CM.ground; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    // barely visible fine grid (alpha 0.04): gives a sense of speed without any texture; one path, clipped to the arena
    // barely visible fine grid, drawn in device pixels: each line is snapped to the pixel grid and exactly 1 CSS px wide
    // (sharp1: world-space 0.08-unit lines landed between pixels and smeared into soft 2-4 px bands at DPR 3)
    const GL = this.govL | 0;
    if (GL < 3) { const G = 5, kx = this.kx, ky = this.ky, ox = (this.w / 2 + sx - cx * S) * kx, oy = (this.h / 2 + sy - cy * S) * ky, BW = this.canvas.width, BH = this.canvas.height;
      const lw = Math.max(1, Math.round(kx)), half = (lw & 1) ? 0.5 : 0, sxp = S * kx, syp = S * ky;
      const x0 = Math.ceil((-ox / sxp) / G) * G, x1 = (BW - ox) / sxp, y0 = Math.ceil((-oy / syp) / G) * G, y1 = (BH - oy) / syp;
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.beginPath(); g.arc(ox, oy, R * sxp, 0, TAU); g.clip(); g.strokeStyle = "#ffffff"; g.globalAlpha = 0.05; g.lineWidth = lw; g.beginPath();
      for (let x = x0; x <= x1; x += G) { const px = Math.round(ox + x * sxp) + half; g.moveTo(px, 0); g.lineTo(px, BH); } for (let y = y0; y <= y1; y += G) { const py = Math.round(oy + y * syp) + half; g.moveTo(0, py); g.lineTo(BW, py); } g.stroke(); g.restore(); g.globalAlpha = 1; }
    if (Math.hypot(cx, cy) + vr > R - 4) { g.strokeStyle = CM.edge; g.globalAlpha = 0.1; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, R - 1.2, 0, TAU); g.stroke(); g.globalAlpha = 0.35; g.lineWidth = 0.3; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke(); g.globalAlpha = 1; }
    // KOTH hill and BR storm: flat tints and one soft edge, no pulsing
    if (v.hill) { const h = v.hill, c = lin2css(h.c || [1, 0.8, 0.2]); g.globalAlpha = 0.14; g.fillStyle = c; g.beginPath(); g.arc(h.x, h.y, h.r, 0, TAU); g.fill(); g.globalAlpha = 0.6; g.strokeStyle = c; g.lineWidth = 0.3; g.stroke(); g.globalAlpha = 1; }
    if (v.zone) { const z = v.zone, zr = Math.max(0.5, z.r); g.save(); g.beginPath(); g.rect(cx - vr * 1.5, cy - vr * 1.5, vr * 3, vr * 3); g.arc(z.x, z.y, zr, 0, TAU, true); g.fillStyle = "rgba(40,24,64,0.45)"; g.fill("evenodd"); g.restore();
      g.strokeStyle = "#b9a6e0"; g.globalAlpha = 0.12; g.lineWidth = 2.2; g.beginPath(); g.arc(z.x, z.y, zr - 1, 0, TAU); g.stroke(); g.globalAlpha = 0.55; g.lineWidth = 0.3; g.beginPath(); g.arc(z.x, z.y, zr, 0, TAU); g.stroke(); g.globalAlpha = 1; }
    if (v.terr && v.terr.T) this._terr(g, v.terr); // land1: territory layer (one cached image, changed cells only)
    if (v.gt) this._gtrail(g, v, dt, cx, cy, vr2); // trail1: ground trail decals, on the ground under food and snakes
    // candy1: big flat candy sprites (one cached sprite per type + colour, no glow), coins in Gold Rush; eaten candy
    // shrinks and slides into the eater's mouth (ghosts), drawn under the snakes
    { const F = v.food, pal = v.foodPalCss === FOOD_COLORS_CB ? v.foodPalCss : CANDY_CSS, NP = pal.length, gold = !!v.goldMode, CS = this.candySpr;
      const spr = (ty, c) => { const css = pal[c % NP], key = ty * 64 + (c % NP); let im = CS.get(key); if (!im || im._css !== css) { im = drawCandySprite(ty, css, ty === T_MAC || ty === T_LOLLY ? 224 : 144); im._css = css; CS.set(key, im); } return im; };
      const coin = () => this.coinSpr || (this.coinSpr = drawCoinSprite(160));
      for (let i = 0; i < F.FM; i++) { if (!F.fa[i]) continue; const x = F.fx[i], y = F.fy[i]; if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > vr2) continue;
        const c = F.fc[i], age = F.age ? F.age(i) : 1, gr = age < 1 ? age * age * (3 - 2 * age) : 1;
        if (gold && c === GOLD_FC) { const h = 0.8 * SPR_K * gr; g.drawImage(coin(), x - h, y - h, h * 2, h * 2); continue; }
        const val = F.fv[i], big = candyBig(val), ty = candyType(val, c, big), h = candySize2(val, big) * SPR_K * gr; g.drawImage(spr(ty, c), x - h, y - h, h * 2, h * 2); }
      if (v.ghosts) for (const gh of v.ghosts) { const u = gh.t, e = u * u, x = gh.x + (gh.tx - gh.x) * e, y = gh.y + (gh.ty - gh.y) * e, k = 1 - u * 0.85, c = gh.c, val = gh.v ?? Math.max(1, ((gh.r - 0.22) / 0.16) ** 2);
        if (gold && c === GOLD_FC) { const h = 0.8 * SPR_K * k; g.drawImage(coin(), x - h, y - h, h * 2, h * 2); continue; }
        const big = candyBig(val), h = candySize2(val, big) * SPR_K * k; g.drawImage(spr(candyType(val, c, big), c), x - h, y - h, h * 2, h * 2); } }
    // power-up pickups: cached sprites, bobbing + pulsing so they read at a glance
    if (v.pus) for (const p of v.pus) { if ((p.x - cx) ** 2 + (p.y - cy) ** 2 > vr2) continue; const sz = 1.6; g.drawImage(this.puSpr[p.k] || this.puSpr[0], p.x - sz, p.y - sz, sz * 2, sz * 2); }
    // meteor warnings: red ring, filling disc, the falling rock and its shadow
    if (v.mets) for (const M of v.mets) { const u = Math.max(0, Math.min(1, 1 - M.t / (M.T || 1.9))); g.globalAlpha = 0.2 + 0.2 * u; g.fillStyle = "#ff4a1a"; g.beginPath(); g.arc(M.x, M.y, M.r * (0.15 + 0.85 * u), 0, TAU); g.fill();
      g.globalAlpha = 0.7; g.strokeStyle = "#e0705a"; g.lineWidth = 0.35; g.beginPath(); g.arc(M.x, M.y, M.r, 0, TAU); g.stroke();
      const f = Math.pow(1 - u, 1.4), rx = M.x + 10 * f, ry = M.y - 14 * f; g.globalAlpha = 1; g.fillStyle = "#ff8a2a"; g.beginPath(); g.arc(rx, ry, 1 + u * 0.6, 0, TAU); g.fill(); g.fillStyle = "#3a2418"; g.beginPath(); g.arc(rx - 0.2, ry - 0.2, 0.7 + u * 0.4, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    if ((v.rain || v.goldRain) && !this.calm && GL < 2) { const h = v.rain || v.goldRain; if (Math.random() < 0.3) this.burst(h.x + (Math.random() - 0.5) * 30, h.y + (Math.random() - 0.5) * 20, v.rain ? [0.8, 1, 0.3] : [1, 0.85, 0.2], 2, 1.5, 0.6); }
    // snakes
    const pts = this.tmp, col = this.col; this._palCss = v.foodPalCss === FOOD_COLORS_CB ? v.foodPalCss : CANDY_CSS; let crown = null; this._look2d(v);
    for (const d of v.snakes) {
      const s = d.s, r = s.r * (d.scale || 1); if ((s.sx(d.o) - cx) ** 2 + (s.sy(d.o) - cy) ** 2 > (vr + s.len) ** 2) continue;
      const n = bodyPoints(s, d.o, d.f, Math.max(0.3, r * 0.6), s.len, pts, 790);
      if (d.ox || d.oy) for (let j = 0; j < n; j++) { pts[j * 2] += d.ox; pts[j * 2 + 1] += d.oy; }
      this._fnMap.set(s, d.fn); if (d.me) { const H = this.meH || (this.meH = [0, 0, 0]); H[0] = pts[0]; H[1] = pts[1]; H[2] = r; d.fn(n >> 2, n, t, col); this.meC = css(Math.min(1, col[0] * 1.1 + 0.08), Math.min(1, col[1] * 1.1 + 0.08), Math.min(1, col[2] * 1.1 + 0.08)); this.meFa = n > 1 ? Math.atan2(pts[1] - pts[3], pts[0] - pts[2]) : 0; }
      const P = s.pu || null, frozen = s.slow > 0, inv = false; // fix1: ghost / invisibility retired
      d.alpha = d.alpha * (inv ? (d.me ? 0.42 : 0.12) : 1); g.globalAlpha = d.alpha;
      if (d.me && !v.showcase) { g.globalAlpha = 0.5 * d.alpha; g.strokeStyle = this.meC; g.lineWidth = r * 0.35; g.beginPath(); g.arc(pts[0], pts[1], r * 2.1, 0, TAU); g.stroke(); g.globalAlpha = d.alpha; } // look1: steady ring marks your own snake (no pulse, calm-safe)
      // soft drop shadow. perf3: one round-capped stroke along the offset spine (the same union of r*1.02 discs, same flat 0.28
      // alpha) instead of n/2 separate arc sub-paths, which was the single most expensive path to rasterise per snake
      if (GL < 3) { const ox = r * 0.45; if (n > 1) { g.strokeStyle = "rgba(0,0,0,0.28)"; g.lineWidth = r * 2.04; g.lineJoin = g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0] + ox, pts[1] + ox); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2] + ox, pts[j * 2 + 1] + ox); g.stroke(); }
        else if (n === 1) { g.fillStyle = "rgba(0,0,0,0.28)"; g.beginPath(); g.arc(pts[0] + ox, pts[1] + ox, r * 1.02, 0, TAU); g.fill(); } }
      if (P && P[7] > 0 && n > 1) { g.strokeStyle = "#5ce8ff"; g.globalAlpha = 0.38 * d.alpha; g.lineWidth = r * 2.9; g.lineJoin = g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.stroke(); g.globalAlpha = d.alpha; } // dash: soft steady cyan outline (harmless while active)
      if (n > 1) { g.strokeStyle = "rgba(0,0,0,0.38)"; g.lineWidth = r * 2.16; g.lineJoin = g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.stroke(); } // dark rim so the body reads on any ground
      if (d.team) { g.strokeStyle = lin2css(d.team); g.lineWidth = r * 0.5; g.lineJoin = g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.globalAlpha *= 0.55; g.lineWidth = r * 2.5; g.stroke(); g.globalAlpha = d.alpha; }
      // tube1: smooth body at every quality level. 1) one continuous round-joined stroke in the base colour (3 width steps for the
      // taper) gives a clean silhouette on bends; 2) the pattern bands are stroked on top as runs along the spine, ~10% thinner,
      // so colour changes never scallop the outline; 3) one cheap highlight stroke (plus a soft underside shade above Low).
      const fz = (c0) => frozen ? css(c0[0] * 0.5 + 0.35, c0[1] * 0.5 + 0.45, c0[2] * 0.5 + 0.5) : css(c0[0], c0[1], c0[2]);
      g.lineJoin = "round"; g.lineCap = "round";
      if (n > 1) { d.fn(n >> 2, n, t, col); g.strokeStyle = fz(col);
        for (const [e, w] of TUBE_STEPS) { const m = Math.max(1, Math.round(e * (n - 1))); g.lineWidth = 2 * r * w; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let j = 1; j <= m; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.stroke(); } }
      { let cur = "", cw = -1, open = false; // bands tail -> head with round caps: each band's cap overlaps the next like a scale, no wedges on bends
        for (let j = n - 1; j >= 0; j--) {
          const u = j / Math.max(1, n - 1), rr = j ? r * taperAt(u) : r * HEAD_K; d.fn(j, n, t, col);
          const c = fz(col), w = Math.round(rr / r * 10) / 10;
          if (n === 1) { g.fillStyle = c; g.beginPath(); g.arc(pts[0], pts[1], rr, 0, TAU); g.fill(); break; }
          if (c !== cur || w !== cw) { if (open) { g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.stroke(); } g.strokeStyle = cur = c; cw = w; g.lineWidth = 2 * r * Math.max(0.24, w) * 0.9; g.beginPath(); g.moveTo(pts[j * 2], pts[j * 2 + 1]); open = true; }
          else g.lineTo(pts[j * 2], pts[j * 2 + 1]);
        }
        if (open) g.stroke(); }
      if (n > 2 && GL < 2) { g.strokeStyle = "rgba(0,0,0,0.13)"; g.lineWidth = r * 0.7; g.beginPath(); g.moveTo(pts[0] + r * 0.4, pts[1] + r * 0.45); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2] + r * 0.4, pts[j * 2 + 1] + r * 0.45); g.stroke(); }
      if (n > 2) { const hm = GL < 2 ? n : Math.max(2, Math.round(n * 0.85)); g.strokeStyle = "rgba(255,255,255,0.2)"; g.lineWidth = r * 0.55; g.beginPath(); g.moveTo(pts[0] - r * 0.32, pts[1] - r * 0.38); for (let j = 1; j < hm; j++) g.lineTo(pts[j * 2] - r * 0.32, pts[j * 2 + 1] - r * 0.38); g.stroke(); } // highlight kept at Low
      if (n > 1) {
        const a = Math.atan2(pts[1] - pts[3], pts[0] - pts[2]), E = EYES[d.eye] || EYES[0], er = r * 0.42 * E.s, la = d.me && this.meLook !== undefined ? this.meLook : d.look ?? a, ca = Math.cos(a), sa = Math.sin(a);
        // head: a snout-shaped oval in the head colour, lit from the top-left, nostrils, then big glossy eyes
        d.fn(0, n, t, col); const hc = frozen ? css(col[0] * 0.5 + 0.35, col[1] * 0.5 + 0.45, col[2] * 0.5 + 0.5) : css(col[0], col[1], col[2]), hr = r * HEAD_K;
        g.save(); g.translate(pts[0] + ca * r * 0.18, pts[1] + sa * r * 0.18); g.rotate(a); g.fillStyle = "rgba(0,0,0,0.38)"; g.beginPath(); g.ellipse(0, 0, hr * 1.24, hr * 1.06, 0, 0, TAU); g.fill();
        g.fillStyle = hc; g.beginPath(); g.ellipse(0, 0, hr * 1.16, hr * 0.98, 0, 0, TAU); g.fill(); g.fillStyle = "rgba(255,255,255,0.2)"; g.beginPath(); g.ellipse(-hr * 0.15, -hr * 0.35, hr * 0.7, hr * 0.38, 0, 0, TAU); g.fill();
        g.fillStyle = "rgba(0,0,0,0.45)"; g.beginPath(); g.arc(hr * 0.98, -hr * 0.22, hr * 0.07, 0, TAU); g.arc(hr * 0.98, hr * 0.22, hr * 0.07, 0, TAU); g.fill(); g.restore();
        const bph = (t * 0.31 + (s.id % 97) * 0.173) % 1, bk = bph < 0.035 ? Math.sin(bph / 0.035 * Math.PI) : 1; // gentle blink every ~3 s
        for (let q = 0; q < E.n; q++) { const side = E.n === 1 ? 0 : (q ? 1 : -1) * r * 0.5, ex = pts[0] + ca * r * 0.42 - sa * side, ey = pts[1] + sa * r * 0.42 + ca * side;
          g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.arc(ex, ey, er * 1.18, 0, TAU); g.fill(); g.fillStyle = E.ec; g.beginPath(); g.arc(ex, ey, er, 0, TAU); g.fill(); if (bk < 0.99) { g.fillStyle = hc; g.beginPath(); g.ellipse(ex, ey, er * 1.05, er * 1.05 * (1 - bk), a, 0, TAU); g.fill(); continue; }
          const px = ex + Math.cos(la) * er * 0.38, py = ey + Math.sin(la) * er * 0.38; g.fillStyle = E.pc; g.beginPath(); g.arc(px, py, er * E.p, 0, TAU); g.fill(); g.fillStyle = "rgba(255,255,255,0.9)"; g.beginPath(); g.arc(px - er * 0.22, py - er * 0.25, er * 0.2, 0, TAU); g.fill(); }
        // power-up auras: shield bubble, magnet ring, speed streaks, x2 crown glow
        if (P) {
          if (P[0] > 0) { const mr = magReach(s.r); g.strokeStyle = "rgba(235,225,205,0.9)"; g.lineWidth = 0.1; g.globalAlpha = 0.16 * d.alpha; g.beginPath(); g.arc(pts[0], pts[1], mr, 0, TAU); g.stroke(); } // fix1: magnet reach, one faint steady ring
          if (P[1] > 0) { g.strokeStyle = PU_COL[1]; g.lineWidth = 0.18; g.globalAlpha = 0.3; g.beginPath(); g.arc(pts[0], pts[1], r * 1.75, 0, TAU); g.stroke(); } // thin shield bubble; no big magnet / x2 / giant circles (the HUD chips show them)


          if (P[7] > 0) { g.strokeStyle = PU_COL[7]; g.lineWidth = 0.2; g.globalAlpha = 0.45; g.beginPath(); for (let q = -2; q <= 2; q++) { const bx = pts[0] - Math.cos(a) * r * 1.6 - Math.sin(a) * q * r * 0.5, by = pts[1] - Math.sin(a) * r * 1.6 + Math.cos(a) * q * r * 0.5; g.moveTo(bx, by); g.lineTo(bx - Math.cos(a) * r * 4, by - Math.sin(a) * r * 4); } g.stroke(); }

          if (P[7] > 0) { const sz = Math.max(1.1, r * 1.1), iy = pts[1] - r * 2.3 - 1.5 - sz - (d.emo ? 3.6 : 0); g.globalAlpha = 0.95 * d.alpha; g.drawImage(this.puSpr[7], pts[0] - sz, iy - sz, sz * 2, sz * 2); } // dash icon over the head (static)
          g.globalAlpha = d.alpha;
        }
        if (d.top1 && s.alive && !inv) { crown = d; d._x2 = pts[0]; d._y2 = pts[1]; d._r2 = r; }
        if (d.gold) { g.strokeStyle = "#ffd23a"; g.lineWidth = 0.25; g.globalAlpha = 0.45; g.beginPath(); g.arc(pts[0], pts[1], r * 2, 0, TAU); g.stroke(); g.globalAlpha = d.alpha; }
        if (d.emo) { g.save(); g.globalAlpha = 1; g.translate(pts[0], pts[1] - r * 2.2 - 2.2); g.scale(1 / S, 1 / S); g.fillStyle = "rgba(10,14,26,0.85)"; g.strokeStyle = "rgba(255,220,140,0.95)"; g.lineWidth = 2; g.beginPath(); g.arc(0, -16, 17, 0, TAU); g.fill(); g.stroke(); g.textAlign = "center"; g.textBaseline = "middle"; g.font = d.emo === "GG" ? "800 15px sans-serif" : "20px sans-serif"; g.fillStyle = "#ffd23a"; g.fillText(d.emo, 0, -15); g.restore(); }
        if (d.name && !d.me && !inv && !v.hideNames) { g.save(); g.translate(pts[0], pts[1] - r * 2.3); g.scale(1 / S, 1 / S); g.font = "600 11.5px -apple-system, Segoe UI, sans-serif"; g.textAlign = "center"; g.fillStyle = "rgba(0,0,0,0.5)"; g.fillText(d.name, 1, 1); g.globalAlpha = (d.pt ? 0.95 : 0.85) * d.alpha; let fs = null; if (d.pt) { const w = g.measureText(d.name).width; fs = pidFill(g, d.pt, -w / 2, w / 2); } g.fillStyle = fs || d.nc || "#fff"; g.fillText(d.name, 0, 0); g.restore(); } // srv2: premium id = tier gradient // own name tag hidden
      }
      g.globalAlpha = 1;
    }
    if (crown) { const pts2 = crown; g.globalAlpha = crown.alpha ?? 1; this._crown(g, crown._x2, crown._y2, crown._r2, t); g.globalAlpha = 1; }
    this._fx2d(g, dt);
    for (let i = this.parts.length - 1; i >= 0; i--) { const p = this.parts[i]; p.l -= dt; if (p.l <= 0) { const L = this.parts, last = L.pop(); if (last !== p) L[i] = last; this.pPool.push(p); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95; g.globalAlpha = p.l / p.m; g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, 0.25, 0, TAU); g.fill(); }
    for (let i = this.rings.length - 1; i >= 0; i--) { const q = this.rings[i]; q.t += dt * 1.6; if (q.t >= 1) { this.rings.splice(i, 1); continue; } if (q.t < 0) continue; g.globalAlpha = (1 - q.t) * 0.5; g.strokeStyle = q.c || "#fff"; g.lineWidth = 0.22; g.beginPath(); g.arc(q.x, q.y, 1 + q.t * Math.min(q.R, 8), 0, TAU); g.stroke(); }
    g.globalAlpha = 1; g.restore();
  }

  // ---------- aaa2: soft fx (calm-safe: short, low-count, no flashes) ----------
  _orb(x, y, vx, vy, life, size, c, hx, hy, hk) { if (this.oN >= NO2) return; const i = this.oN++, o = i * 4; this.oP[o] = x; this.oP[o + 1] = y; this.oP[o + 2] = vx; this.oP[o + 3] = vy; this.oL[i * 2] = life; this.oL[i * 2 + 1] = life; this.oC[i] = c; this.oH[i * 3] = hx || 0; this.oH[i * 3 + 1] = hy || 0; this.oH[i * 3 + 2] = hk || 0; this.oS = this.oS || new Float32Array(NO2); this.oS[i] = size; }
  _subFx() {
    const self = this, near = (x, y, R) => (x - self.camX) ** 2 + (y - self.camY) ** 2 < R * R;
    this._unsub = [
      onEv("fx.eat", (e) => { if (!e.me || !self.meH) return; const h = self.meH, pal = self._palCss, c = pal && pal.length ? pal[(e.c | 0) % pal.length] : "#fff"; const n = self.calm ? 2 : 4; for (let k = 0; k < n; k++) { const a = Math.random() * TAU, sp = 2 + Math.random() * 3; self._orb(h[0], h[1], Math.cos(a) * sp, Math.sin(a) * sp, 0.35, e.v >= 4 ? 0.3 : 0.2, c); } if (e.v >= 4) self.rings.push({ x: h[0], y: h[1], t: 0, R: 3, c }); }),
      onEv("fx.levelup", (e) => { const h = self.meH, x = h ? h[0] : e.x, y = h ? h[1] : e.y; self.rings.push({ x, y, t: 0, R: 8, c: "#ffd98a" }); self.rings.push({ x, y, t: -0.15, R: 5, c: self.meC }); const n = self.calm ? 12 : 26; for (let k = 0; k < n; k++) { const a = (k / n) * TAU, sp = 5 + Math.random() * 3; self._orb(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.9, 0.28, k % 3 ? self.meC : "#ffe6a8"); } }),
      onEv("fx.kill", (e) => { const s = e.s; if (!s || !near(e.x, e.y, 46)) return; const pts = self.tmp, n = bodyPoints(s, 1, 1, Math.max(0.5, s.r * 0.8), s.len, pts, 790); if (n < 2) return; const col = self.col; const fn = self._fnOf(s); const cap = self.calm ? 22 : 44, st = Math.max(1, Math.ceil(n / cap));
        const fx = s.skin && s.skin.k === "skin" && SKINS[s.skin.i] ? SKINS[s.skin.i].fx | 0 : 0, gl = fx && LEGEND[fx] ? LEGEND[fx].glow : null;
        for (let j = 0; j < n; j += st) { let c = gl && (j / st) % 3 === 0 ? gl : "#ffffff"; if (fn) { fn(j, n, 0, col); c = gl && (j / st) % 3 === 0 ? gl : css(Math.min(1, col[0] * 1.15 + 0.1), Math.min(1, col[1] * 1.15 + 0.1), Math.min(1, col[2] * 1.15 + 0.1)); } const a = Math.random() * TAU, sp = 0.8 + Math.random() * 1.6; self._orb(pts[j * 2], pts[j * 2 + 1], Math.cos(a) * sp, Math.sin(a) * sp, 0.9 + Math.random() * 0.5, s.r * (0.35 + Math.random() * 0.25), c, e.kx, e.ky, e.hasK ? 2.5 : 0); }
        self.rings.push({ x: pts[0], y: pts[1], t: 0, R: 8, c: gl || "#ffffff" }); }),
      onEv("fx.win", (e) => { const h = self.meH, x = h ? h[0] : e.x, y = h ? h[1] : e.y; self.rings.push({ x, y, t: 0, R: 12, c: "#ffd98a" }); self.rings.push({ x, y, t: -0.25, R: 8, c: "#ffffff" }); for (let k = 0; k < 30; k++) { const a = Math.random() * TAU, sp = 3 + Math.random() * 6; self._orb(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 1.2, 0.3, ["#ffd23a", "#ff7a9a", "#7ad7ff", "#b6ff8a", "#ffffff"][k % 5]); } }),
    ];
  }
  _look2d(v) { const H = this.meH; this._lf = (this._lf || 0) + 1; if (!H || !v.food || this._lf % 4) return; const F = v.food, fa = this.meFa || 0, fx0 = Math.cos(fa), fz0 = Math.sin(fa); let best = 1e9, bx = 0, by = 0;
    for (let i = 0; i < F.FM; i++) { if (!F.fa[i]) continue; const dx = F.fx[i] - H[0], dy = F.fy[i] - H[1], q = dx * dx + dy * dy; if (q > 64 || q < 0.3 || dx * fx0 + dy * fz0 < 0.35 * Math.sqrt(q)) continue; if (q < best) { best = q; bx = dx; by = dy; } }
    const tgt = best < 1e9 ? Math.atan2(by, bx) : fa; if (this.meLook === undefined) this.meLook = tgt; let da = tgt - this.meLook; da -= Math.round(da / TAU) * TAU; this.meLook += da * 0.45; }
  _fnOf(s) { const e = this._fnMap && this._fnMap.get(s); return e || null; }
  _fx2d(g, dt) {
    let w = 0; const P = this.oP, L = this.oL, H = this.oH, S2 = this.oS;
    for (let i = 0; i < this.oN; i++) { const l = L[i * 2] - dt; if (l <= 0) continue; const o = i * 4; let vx = P[o + 2], vy = P[o + 3]; const dr = Math.exp(-dt * 2.2);
      if (H[i * 3 + 2] > 0) { const u = 1 - l / L[i * 2 + 1], hk = H[i * 3 + 2] * u * u * 4; vx += (H[i * 3] - P[o]) * hk * dt; vy += (H[i * 3 + 1] - P[o + 1]) * hk * dt; }
      vx *= dr; vy *= dr; const x = P[o] + vx * dt, y = P[o + 1] + vy * dt;
      if (w !== i) { const q = w * 4; L[w * 2 + 1] = L[i * 2 + 1]; this.oC[w] = this.oC[i]; H[w * 3] = H[i * 3]; H[w * 3 + 1] = H[i * 3 + 1]; H[w * 3 + 2] = H[i * 3 + 2]; S2[w] = S2[i]; }
      const q = w * 4; P[q] = x; P[q + 1] = y; P[q + 2] = vx; P[q + 3] = vy; L[w * 2] = l; const u = l / L[w * 2 + 1], a = u > 0.85 ? (1 - u) / 0.15 : u / 0.85;
      g.globalAlpha = a * 0.85; g.fillStyle = this.oC[w]; g.beginPath(); g.arc(x, y, S2[w] * (0.6 + 0.4 * a), 0, TAU); g.fill(); w++; }
    this.oN = w; g.globalAlpha = 1;
  }
  _crown(g, x, y, r, t) { const s = Math.max(0.5, r * 0.7), by = y - r * HEAD_K - 0.12 - s * 0.5; /* fix1: centred on the head, resting just above it, no bob */ g.save(); g.translate(x, by); g.scale(s, s);
    g.fillStyle = "rgba(0,0,0,0.28)"; g.beginPath(); g.ellipse(0.06, 0.62, 1.0, 0.18, 0, 0, TAU); g.fill();
    g.fillStyle = "#e8b53a"; g.beginPath(); g.moveTo(-0.95, 0.5); g.lineTo(-1.0, -0.35); g.lineTo(-0.5, 0.05); g.lineTo(0, -0.6); g.lineTo(0.5, 0.05); g.lineTo(1.0, -0.35); g.lineTo(0.95, 0.5); g.closePath(); g.fill();
    g.fillStyle = "#ffe08a"; g.beginPath(); g.moveTo(-0.95, 0.5); g.lineTo(-1.0, -0.35); g.lineTo(-0.5, 0.05); g.lineTo(0, -0.6); g.lineTo(0, 0.5); g.closePath(); g.globalAlpha *= 0.55; g.fill(); g.globalAlpha /= 0.55;
    g.fillStyle = "#b07a18"; g.fillRect(-0.95, 0.3, 1.9, 0.2); g.fillStyle = "#ff4a6a"; g.beginPath(); g.arc(0, 0.12, 0.13, 0, TAU); g.fill(); g.restore(); }
  // trail1: step the shared decal pool once per frame, then one drawImage per live decal from the cached atlas
  _gtrail(g, v, dt, cx, cy, vr2) {
    const G = v.gt, o = this._gto || (this._gto = { calm: false, low: false, gov: 0 }); o.calm = !!(this.calm || this.reduceMotion); o.low = this.qName === "low" || !!this.userLow; o.gov = this.govL | 0;
    G.step(v, v.dt, v.gtI, o); if (!G.live) return; const A = gtAtlas(); if (!A) return; const C = GT_CELL;
    for (let i = 0; i < GT_CAP; i++) { const a = G.ca[i]; if (a <= 0.004) continue; const x = G.x[i], y = G.y[i]; if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > vr2) continue;
      const h = G.sz[i] * G.cs[i], r = G.rot[i]; g.globalAlpha = a; g.translate(x, y); g.rotate(r); g.drawImage(A, G.va[i] * C, G.ty[i] * C, C, C, -h, -h, h * 2, h * 2); g.rotate(-r); g.translate(-x, -y); }
    g.globalAlpha = 1;
  }
  clearFx() { for (const p of this.parts) this.pPool.push(p); this.parts.length = 0; this.rings.length = 0; this.oN = 0; } // replay1: a clean stage for the replay
  dispose() { if (this._unsub) for (const u of this._unsub) u(); this._unsub = null; }
}
