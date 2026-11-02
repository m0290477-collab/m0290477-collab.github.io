// 2D fallback renderer (Canvas 2D): used when WebGL is missing/lost, or on devices too slow for 3D.
// Same frame(view) contract as Renderer3D so the game never knows which one it drives.
// Built for steady frame times on phones: DPR cap, cached colour strings, batched paths (shadows, highlights, food by
// colour), cached sprites for power-ups, cached ground pattern and vignette, no per-segment shadowBlur, no per-frame allocations.
import { taperAt, HEAD_K, bodyPoints, PU_COL, PU_SVG } from "./sim.js?v=m2clean";
import { WORLDS, paintGround, worldAsset } from "./worlds.js?v=m2clean";
import { EYES } from "./skins.js?v=m2clean";

const TAU = Math.PI * 2;
const CSS = new Array(32768); // 15-bit quantised rgb -> "rgb(...)" (no string building per segment)
const css = (r, g, b) => { const R = Math.max(0, Math.min(31, (r * 31 + 0.5) | 0)), G = Math.max(0, Math.min(31, (g * 31 + 0.5) | 0)), B = Math.max(0, Math.min(31, (b * 31 + 0.5) | 0)); const k = (R << 10) | (G << 5) | B; return CSS[k] || (CSS[k] = `rgb(${(R * 255 / 31) | 0},${(G * 255 / 31) | 0},${(B * 255 / 31) | 0})`); };
const lin2css = (c) => css(Math.sqrt(c[0]), Math.sqrt(c[1]), Math.sqrt(c[2]));

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas; this.g = canvas.getContext("2d", { alpha: false }); if (!this.g) throw new Error("2d");
    this.tmp = new Float32Array(1600); this.col = [0, 0, 0]; this.parts = []; this.rings = []; this.shakeA = 0; this.juice = true; this.reduceMotion = false;
    this.camX = 0; this.camY = 0; this.scale = 14; this.qName = "low"; this.Q = { particles: 300 }; this.is2D = true;
    this.buckets = Array.from({ length: 16 }, () => []); this.puSpr = PU_COL.map((c, k) => this._puSprite(k)); this.bgImg = null; this.vig = null; this.vigK = "";
    this.glowSpr = new Map(); // food glow sprite per colour (additive)
    this.motes = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), z: 0.35 + Math.random() * 0.5, s: 0.6 + Math.random() * 1.4, p: Math.random() * 6.28 })); // parallax dust
    this.setWorld(0); this.resize();
  }
  setQuality(q) { this.qName = q; }
  setOptions(o) { Object.assign(this, o); }
  setArena(R) { this.R = R; }
  setWorld(i) {
    this.W = WORLDS[i] || WORLDS[0]; this.pat = null; this.worldI = i; this.gImg = null; this.gPat = null;
    const gi = new Image(); gi.decoding = "async"; gi.onload = () => { if (this.W === WORLDS[i] || this.worldI === i) { this.gImg = gi; this.gPat = null; } }; gi.src = worldAsset(this.W, "g", true); // the 3D ground texture: rich, real depth
    // lobby backdrop: the world's sky art (small webp), key art until it has loaded
    const img = new Image(); img.decoding = "async"; img.onload = () => { this.bgImg = img; }; img.src = worldAsset(this.W, "sky", true);
    if (!this.keyImg) { const k = new Image(); k.decoding = "async"; k.onload = () => { this.keyImg = k; }; k.src = "assets/keyart_lo.webp"; this.keyImg = null; }
  }
  resize() { const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight; this.w = w; this.h = h; this.dpr = Math.min(this.qName === "low" ? 1.5 : 2, devicePixelRatio || 1); this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr); this.vig = null; }
  burst(x, y, rgb, n, spd = 6, life = 0.8) { for (let k = 0; k < Math.min(n, 40); k++) { const a = Math.random() * TAU, v = spd * (0.3 + Math.random() * 0.7); this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: life, m: life, c: lin2css(rgb) }); } if (this.parts.length > 300) this.parts.splice(0, this.parts.length - 300); }
  emit() {}
  shatter(s, fn) { const pts = this.tmp, n = bodyPoints(s, 0, 0, Math.max(0.5, s.r * 0.8), s.len, pts, 790), col = this.col; for (let j = 0; j < n; j += Math.max(1, (n / 40) | 0)) { fn(j, n, 0, col); const a = Math.random() * TAU, v = 2 + Math.random() * 5; this.parts.push({ x: pts[j * 2], y: pts[j * 2 + 1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 1, m: 1, c: css(col[0], col[1], col[2]) }); } }
  ring(x, y, rgb, R = 8) { this.rings.push({ x, y, t: 0, R, c: lin2css(rgb) }); }
  shake(a) { if (this.juice && !this.reduceMotion) this.shakeA = Math.min(1.2, this.shakeA + a); }
  project(x, y) { return [(x - this.camX) * this.scale + this.w / 2, (y - this.camY) * this.scale + this.h / 2, true]; }
  info() { return { calls: 0, tris: 0 }; }
  worldReady() { return true; }
  _puSprite(k) { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), col = PU_COL[k];
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, col + "aa"); gr.addColorStop(0.35, col + "40"); gr.addColorStop(1, col + "00"); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); // soft halo
    const og = x.createRadialGradient(27, 26, 1, 32, 32, 13); og.addColorStop(0, "#ffffff"); og.addColorStop(0.35, col); og.addColorStop(1, col + "55"); x.fillStyle = og; x.beginPath(); x.arc(32, 32, 12.5, 0, TAU); x.fill(); // glassy orb
    x.save(); x.translate(32 - 7.5, 32 - 7.5); x.scale(15 / 24, 15 / 24); x.fillStyle = "rgba(255,255,255,0.95)"; x.shadowColor = "rgba(0,0,0,0.45)"; x.shadowBlur = 3; x.fill(new Path2D(PU_SVG[k]), "evenodd"); x.restore(); return c; }
  _glow(c) { let s = this.glowSpr.get(c); if (!s) { s = document.createElement("canvas"); s.width = s.height = 32; const x = s.getContext("2d"), g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, c); g.addColorStop(0.3, c + "88"); g.addColorStop(1, c + "00"); x.fillStyle = g; x.fillRect(0, 0, 32, 32); this.glowSpr.set(c, s); } return s; }
  _cover(img, a) { const g = this.g, W = this.w, H = this.h, s = Math.max(W / img.width, H / img.height) * 1.05, dw = img.width * s, dh = img.height * s; g.globalAlpha = a; g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); g.globalAlpha = 1; }
  _vignette(a) { const k = this.w + "x" + this.h + a; if (this.vigK !== k) { const g = this.g, vg = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.4, this.w / 2, this.h / 2, this.w * 0.7); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, `rgba(0,0,0,${a})`); this.vig = vg; this.vigK = k; } this.g.fillStyle = this.vig; this.g.fillRect(0, 0, this.w, this.h); }

  // ---------- lobby / menus: backdrop + animated coiling showcase of the equipped skin on a glowing pedestal ----------
  _show(v) {
    const g = this.g, W = this.w, H = this.h, t = v.t || 0, sv = v.show; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#05060b"; g.fillRect(0, 0, W, H);
    const img = this.bgImg || this.keyImg; if (img) this._cover(img, 0.55);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "rgba(5,6,11,0.55)"); gr.addColorStop(0.55, "rgba(5,6,11,0.15)"); gr.addColorStop(1, "rgba(5,6,11,0.75)"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (!sv || !sv.d || !sv.d.fn) { this._vignette(0.5); return; }
    const cx = W * (0.5 + (sv.x || 0) * 0.55), cy = H * 0.43, R = Math.min(H * 0.2, W * 0.14) * (sv.zoom || 1), glow = sv.glow || "#ffc845";
    // pedestal
    g.save(); g.translate(cx, cy + R * 0.95); g.scale(1, 0.32);
    const pg = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.9); pg.addColorStop(0, glow + "aa"); pg.addColorStop(0.45, glow + "33"); pg.addColorStop(1, glow + "00"); g.fillStyle = pg; g.beginPath(); g.arc(0, 0, R * 1.9, 0, TAU); g.fill();
    g.strokeStyle = glow + "cc"; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R * 1.25, 0, TAU); g.stroke(); g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, R * 1.45 + Math.sin(t * 2) * 3, 0, TAU); g.stroke(); g.restore();
    // coil: a spiral seen from slightly above (y squashed); tail outside, head rising in the middle
    const n = 70, fn = sv.d.fn, col = this.col, pts = this.tmp, rad = R * 0.15, rot = t * 0.45, breathe = 1 + Math.sin(t * 1.6) * 0.03;
    for (let j = 0; j < n; j++) { const u = j / (n - 1), a = rot + u * 3.4 * Math.PI, rr = R * (0.18 + 0.95 * u) * breathe, lift = (1 - u) ** 2 * R * 0.9;
      pts[j * 2] = cx + Math.cos(a) * rr; pts[j * 2 + 1] = cy + Math.sin(a) * rr * 0.42 + R * 0.55 - lift + Math.sin(t * 2.4 - u * 9) * R * 0.025; }
    const fx = sv.d.fx | 0; if (fx) { g.save(); g.shadowColor = glow; g.shadowBlur = 24; g.strokeStyle = glow + "55"; g.lineWidth = rad * 1.6; g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.stroke(); g.restore(); }
    g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); for (let j = n - 1; j >= 0; j -= 2) { const rr = rad * (j ? taperAt(j / (n - 1)) : HEAD_K); g.moveTo(pts[j * 2] + rr * 1.3, pts[j * 2 + 1] + rr * 0.6); g.arc(pts[j * 2] + rr * 0.3, pts[j * 2 + 1] + rr * 0.6, rr, 0, TAU); } g.fill();
    // draw back half of the coil first (depth): segments whose y is above the centre line are behind
    for (let pass = 0; pass < 2; pass++) for (let j = n - 1; j >= 0; j--) {
      const behind = pts[j * 2 + 1] < cy + R * 0.55 - (1 - j / (n - 1)) ** 2 * R * 0.9; if ((pass === 0) !== behind && j > 3) continue; if (pass === 0 && j <= 3) continue;
      const u = j / (n - 1), rr = j ? rad * Math.max(0.35, taperAt(u)) * 1.05 : rad * HEAD_K * 1.1; fn(j, n, t, col);
      g.fillStyle = css(col[0], col[1], col[2]); g.beginPath(); g.arc(pts[j * 2], pts[j * 2 + 1], rr, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,0.22)"; g.beginPath(); g.arc(pts[j * 2] - rr * 0.3, pts[j * 2 + 1] - rr * 0.35, rr * 0.42, 0, TAU); g.fill();
    }
    // eyes looking at the camera, with a slow blink
    const E = EYES[sv.d.eye] || EYES[0], hx = pts[0], hy = pts[1], er = rad * 0.38 * E.s, blink = (t % 4.2) < 0.12 ? 0.15 : 1;
    for (let q = 0; q < E.n; q++) { const side = E.n === 1 ? 0 : (q ? 1 : -1) * rad * 0.5, ex = hx + side, ey = hy - rad * 0.15; g.fillStyle = E.ec; g.beginPath(); g.ellipse(ex, ey, er, er * blink, 0, 0, TAU); g.fill(); if (blink > 0.5) { g.fillStyle = E.pc; g.beginPath(); g.arc(ex + Math.sin(t * 0.7) * er * 0.3, ey + er * 0.15, er * E.p, 0, TAU); g.fill(); } }
    // legendary sparkle orbit
    if (fx) { g.fillStyle = glow; for (let k = 0; k < 14; k++) { const a = t * 0.8 + k / 14 * TAU, r2 = R * (1.15 + 0.12 * Math.sin(t * 2 + k)), x = cx + Math.cos(a) * r2, y = cy + R * 0.2 + Math.sin(a) * r2 * 0.42 - Math.sin(t + k) * R * 0.3; g.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + k)); g.beginPath(); g.arc(x, y, 1.6 + (k % 3), 0, TAU); g.fill(); } g.globalAlpha = 1; }
    this._vignette(0.45);
  }

  frame(v) {
    if (v.scene === "show") { this._show(v); return; }
    if (!v.food) return;
    const g = this.g, dt = Math.min(0.05, v.dt), t = v.t, W = this.W;
    const k = 1 - Math.exp(-dt * 9); this.camX += (v.cam.x - this.camX) * k; this.camY += (v.cam.y - this.camY) * k;
    this.scale += ((Math.min(this.w, this.h) / (24 * v.cam.zoom)) - this.scale) * k;
    let sx = 0, sy = 0; if (this.shakeA > 0.01) { sx = (Math.random() - 0.5) * this.shakeA * 8; sy = (Math.random() - 0.5) * this.shakeA * 8; this.shakeA *= Math.exp(-dt * 7); }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = W.bg || "#05070d"; g.fillRect(0, 0, this.w, this.h);
    if (!this.pat) { this.pat = g.createPattern(paintGround(W, 256), "repeat"); }
    if (this.gImg && !this.gPat) this.gPat = g.createPattern(this.gImg, "repeat");
    const S = this.scale; g.save(); g.translate(this.w / 2 + sx, this.h / 2 + sy); g.scale(S, S); g.translate(-this.camX, -this.camY);
    const R = this.R || 130, vr = Math.max(this.w, this.h) / S * 0.75, vr2 = vr * vr, cx = this.camX, cy = this.camY;
    g.save(); g.beginPath(); g.arc(0, 0, R, 0, TAU); g.clip();
    if (this.gPat) { const T = 22, iw = this.gImg.width; g.save(); g.scale(T / iw, T / iw); g.globalAlpha = 0.5; g.fillStyle = this.gPat; g.fillRect((cx - this.w / S) * iw / T, (cy - this.h / S) * iw / T, (2 * this.w / S) * iw / T, (2 * this.h / S) * iw / T); g.restore(); g.globalAlpha = 1; }
    else { g.save(); g.scale(9 / 256, 9 / 256); g.globalAlpha = 0.45; g.fillStyle = this.pat; g.fillRect((cx - this.w / S) * 256 / 9, (cy - this.h / S) * 256 / 9, (2 * this.w / S) * 256 / 9, (2 * this.h / S) * 256 / 9); g.restore(); g.globalAlpha = 1; }
    g.restore();
    // outside the arena: dark; the wall is a soft glow band, not a hard line
    g.save(); g.beginPath(); g.rect(cx - vr * 1.5, cy - vr * 1.5, vr * 3, vr * 3); g.arc(0, 0, R, 0, TAU, true); g.fillStyle = "rgba(0,0,0,0.6)"; g.fill("evenodd"); g.restore();
    g.strokeStyle = W.rim; g.globalAlpha = 0.12; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R - 1, 0, TAU); g.stroke(); g.globalAlpha = 0.35; g.lineWidth = 0.35; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke(); g.globalAlpha = 1;
    // KOTH hill and BR storm
    if (v.hill) { const h = v.hill, c = lin2css(h.c || [1, 0.8, 0.2]); g.globalAlpha = 0.16 + 0.06 * Math.sin(t * 3); g.fillStyle = c; g.beginPath(); g.arc(h.x, h.y, h.r, 0, TAU); g.fill(); g.globalAlpha = 0.9; g.strokeStyle = c; g.lineWidth = 0.35; g.setLineDash([1.2, 0.8]); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
    if (v.zone) { // storm: darker violet tint outside + a soft glowing gradient wall (no hard 1px line)
      const z = v.zone, zr = Math.max(0.5, z.r); g.save(); g.beginPath(); g.rect(cx - vr * 1.5, cy - vr * 1.5, vr * 3, vr * 3); g.arc(z.x, z.y, zr, 0, TAU, true); g.fillStyle = "rgba(34,8,64,0.5)"; g.fill("evenodd"); g.restore();
      const w = 7, gr = g.createRadialGradient(z.x, z.y, Math.max(0, zr - w), z.x, z.y, zr + 2.5); gr.addColorStop(0, "rgba(150,80,255,0)"); gr.addColorStop(0.62, "rgba(160,90,255,0.16)"); gr.addColorStop(0.8, "rgba(200,150,255," + (0.42 + 0.1 * Math.sin(t * 3)).toFixed(2) + ")"); gr.addColorStop(1, "rgba(60,20,110,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(z.x, z.y, zr + 2.5, 0, TAU); g.arc(z.x, z.y, Math.max(0, zr - w), 0, TAU, true); g.fill("evenodd"); }
    // food: bucketed by colour -> 2 fills per colour instead of 2 per orb
    const F = v.food, pal = v.foodPalCss, B = this.buckets, NB = Math.min(B.length, pal.length); for (let b = 0; b < NB; b++) B[b].length = 0;
    for (let i = 0; i < F.FM; i++) { if (!F.fa[i]) continue; const x = F.fx[i], y = F.fy[i]; if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > vr2) continue; B[F.fc[i] % NB].push(i); }
    g.globalCompositeOperation = "lighter"; // additive glow halos (cached sprite per colour)
    for (let b = 0; b < NB; b++) { const L = B[b]; if (!L.length) continue; const spr = this._glow(pal[b]); g.globalAlpha = 0.6;
      for (const i of L) { const r = (0.18 + Math.sqrt(F.fv[i]) * 0.12) * 3.4, tw = 1 + 0.12 * Math.sin(t * 3 + i); g.drawImage(spr, F.fx[i] - r * tw, F.fy[i] - r * tw, r * 2 * tw, r * 2 * tw); } }
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    for (let b = 0; b < NB; b++) { const L = B[b]; if (!L.length) continue; g.fillStyle = pal[b]; g.beginPath(); for (const i of L) { const r = 0.17 + Math.sqrt(F.fv[i]) * 0.11; g.moveTo(F.fx[i] + r, F.fy[i]); g.arc(F.fx[i], F.fy[i], r, 0, TAU); } g.fill(); }
    g.fillStyle = "rgba(255,255,255,0.75)"; g.beginPath(); for (let b = 0; b < NB; b++) for (const i of B[b]) { if (F.fv[i] < 2.5) continue; const r = 0.06 + Math.sqrt(F.fv[i]) * 0.04; g.moveTo(F.fx[i] + r, F.fy[i]); g.arc(F.fx[i], F.fy[i], r, 0, TAU); } g.fill();
    // power-up pickups: cached sprites, bobbing + pulsing so they read at a glance
    if (v.pus) for (const p of v.pus) { if ((p.x - cx) ** 2 + (p.y - cy) ** 2 > vr2) continue; const sz = 1.75 + Math.sin(t * 2.5 + p.id) * 0.12; g.drawImage(this.puSpr[p.k] || this.puSpr[0], p.x - sz, p.y - sz - Math.sin(t * 2 + p.id) * 0.18, sz * 2, sz * 2); }
    // meteor warnings: red ring, filling disc, the falling rock and its shadow
    if (v.mets) for (const M of v.mets) { const u = Math.max(0, Math.min(1, 1 - M.t / (M.T || 1.9))); g.globalAlpha = 0.2 + 0.2 * u; g.fillStyle = "#ff4a1a"; g.beginPath(); g.arc(M.x, M.y, M.r * (0.15 + 0.85 * u), 0, TAU); g.fill();
      g.globalAlpha = 0.65 + 0.3 * Math.sin(t * 18); g.strokeStyle = "#ff3b2a"; g.lineWidth = 0.35; g.beginPath(); g.arc(M.x, M.y, M.r, 0, TAU); g.stroke();
      const f = Math.pow(1 - u, 1.4), rx = M.x + 10 * f, ry = M.y - 14 * f; g.globalAlpha = 1; g.fillStyle = "#ff8a2a"; g.beginPath(); g.arc(rx, ry, 1 + u * 0.6, 0, TAU); g.fill(); g.fillStyle = "#3a2418"; g.beginPath(); g.arc(rx - 0.2, ry - 0.2, 0.7 + u * 0.4, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    if (v.rain || v.goldRain) { const h = v.rain || v.goldRain; if (Math.random() < 0.8) this.burst(h.x + (Math.random() - 0.5) * 30, h.y + (Math.random() - 0.5) * 20, v.rain ? [0.8, 1, 0.3] : [1, 0.85, 0.2], 2, 1.5, 0.6); }
    // snakes
    const pts = this.tmp, col = this.col;
    for (const d of v.snakes) {
      const s = d.s, r = s.r * (d.scale || 1); if ((s.sx(d.o) - cx) ** 2 + (s.sy(d.o) - cy) ** 2 > (vr + s.len) ** 2) continue;
      const n = bodyPoints(s, d.o, d.f, Math.max(0.3, r * 0.6), s.len, pts, 790);
      if (d.ox || d.oy) for (let j = 0; j < n; j++) { pts[j * 2] += d.ox; pts[j * 2 + 1] += d.oy; }
      const P = s.pu || null, ghost = P && P[4] > 0, frozen = s.slow > 0, inv = d.inv;
      d.alpha = d.alpha * (inv ? (d.me ? 0.42 : 0.1 + 0.05 * Math.sin(t * 7)) : 1); g.globalAlpha = d.alpha * (ghost ? 0.45 + 0.1 * Math.sin(t * 10) : 1);
      g.fillStyle = "rgba(0,0,0,0.28)"; g.beginPath(); for (let j = n - 1; j >= 0; j -= 2) { g.moveTo(pts[j * 2] + r * 1.45, pts[j * 2 + 1] + r * 0.45); g.arc(pts[j * 2] + r * 0.45, pts[j * 2 + 1] + r * 0.45, r * 1.02, 0, TAU); } g.fill(); // soft drop shadow
      if (n > 1) { g.strokeStyle = "rgba(0,0,0,0.38)"; g.lineWidth = r * 2.16; g.lineJoin = g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.stroke(); } // dark rim so the body reads on any ground
      if (d.team) { g.strokeStyle = lin2css(d.team); g.lineWidth = r * 0.5; g.lineJoin = g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2], pts[j * 2 + 1]); g.globalAlpha *= 0.55; g.lineWidth = r * 2.5; g.stroke(); g.globalAlpha = d.alpha; }
      // body: consecutive segments of the same colour share one path
      let cur = "", open = false;
      for (let j = n - 1; j >= 0; j--) {
        const u = j / Math.max(1, n - 1), rr = j ? r * taperAt(u) : r * HEAD_K; d.fn(j, n, t, col);
        const c = frozen ? css(col[0] * 0.5 + 0.35, col[1] * 0.5 + 0.45, col[2] * 0.5 + 0.5) : css(col[0], col[1], col[2]);
        if (c !== cur) { if (open) g.fill(); g.fillStyle = cur = c; g.beginPath(); open = true; }
        g.moveTo(pts[j * 2] + rr, pts[j * 2 + 1]); g.arc(pts[j * 2], pts[j * 2 + 1], rr, 0, TAU);
      }
      if (open) g.fill();
      // tube shading: a soft specular stripe on top + subtle scale bands
      if (n > 2) { g.strokeStyle = "rgba(255,255,255,0.2)"; g.lineWidth = r * 0.55; g.lineCap = "round"; g.beginPath(); g.moveTo(pts[0] - r * 0.32, pts[1] - r * 0.38); for (let j = 1; j < n; j++) g.lineTo(pts[j * 2] - r * 0.32, pts[j * 2 + 1] - r * 0.38); g.stroke();
        g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = r * 0.2; g.stroke(); g.fillStyle = "rgba(0,0,0,0.13)"; g.beginPath(); for (let j = 3; j < n; j += 3) { const u = j / (n - 1), rr = r * taperAt(u) * 0.55; g.moveTo(pts[j * 2] + rr, pts[j * 2 + 1]); g.arc(pts[j * 2], pts[j * 2 + 1], rr, 0, TAU); } g.fill(); }
      if (n > 1) {
        const a = Math.atan2(pts[1] - pts[3], pts[0] - pts[2]), E = EYES[d.eye] || EYES[0], er = r * 0.42 * E.s, la = d.look ?? a, ca = Math.cos(a), sa = Math.sin(a);
        // head: a snout-shaped oval in the head colour, lit from the top-left, nostrils, then big glossy eyes
        d.fn(0, n, t, col); const hc = frozen ? css(col[0] * 0.5 + 0.35, col[1] * 0.5 + 0.45, col[2] * 0.5 + 0.5) : css(col[0], col[1], col[2]), hr = r * HEAD_K;
        g.save(); g.translate(pts[0] + ca * r * 0.18, pts[1] + sa * r * 0.18); g.rotate(a); g.fillStyle = "rgba(0,0,0,0.38)"; g.beginPath(); g.ellipse(0, 0, hr * 1.24, hr * 1.06, 0, 0, TAU); g.fill();
        g.fillStyle = hc; g.beginPath(); g.ellipse(0, 0, hr * 1.16, hr * 0.98, 0, 0, TAU); g.fill(); g.fillStyle = "rgba(255,255,255,0.2)"; g.beginPath(); g.ellipse(-hr * 0.15, -hr * 0.35, hr * 0.7, hr * 0.38, 0, 0, TAU); g.fill();
        g.fillStyle = "rgba(0,0,0,0.45)"; g.beginPath(); g.arc(hr * 0.98, -hr * 0.22, hr * 0.07, 0, TAU); g.arc(hr * 0.98, hr * 0.22, hr * 0.07, 0, TAU); g.fill(); g.restore();
        for (let q = 0; q < E.n; q++) { const side = E.n === 1 ? 0 : (q ? 1 : -1) * r * 0.5, ex = pts[0] + ca * r * 0.42 - sa * side, ey = pts[1] + sa * r * 0.42 + ca * side;
          g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.arc(ex, ey, er * 1.18, 0, TAU); g.fill(); g.fillStyle = E.ec; g.beginPath(); g.arc(ex, ey, er, 0, TAU); g.fill();
          const px = ex + Math.cos(la) * er * 0.38, py = ey + Math.sin(la) * er * 0.38; g.fillStyle = E.pc; g.beginPath(); g.arc(px, py, er * E.p, 0, TAU); g.fill(); g.fillStyle = "rgba(255,255,255,0.9)"; g.beginPath(); g.arc(px - er * 0.22, py - er * 0.25, er * 0.2, 0, TAU); g.fill(); }
        // power-up auras: shield bubble, magnet ring, speed streaks, x2 crown glow
        if (P) {
          if (P[1] > 0) { g.strokeStyle = PU_COL[1]; g.lineWidth = 0.18; g.globalAlpha = 0.3 + 0.12 * Math.sin(t * 5); g.beginPath(); g.arc(pts[0], pts[1], r * 1.75, 0, TAU); g.stroke(); } // thin shield bubble; no big magnet / x2 / giant circles (the HUD chips show them)


          if (P[7] > 0) { g.strokeStyle = PU_COL[7]; g.lineWidth = 0.2; g.globalAlpha = 0.45; g.beginPath(); for (let q = -2; q <= 2; q++) { const bx = pts[0] - Math.cos(a) * r * 1.6 - Math.sin(a) * q * r * 0.5, by = pts[1] - Math.sin(a) * r * 1.6 + Math.cos(a) * q * r * 0.5; g.moveTo(bx, by); g.lineTo(bx - Math.cos(a) * r * 4, by - Math.sin(a) * r * 4); } g.stroke(); }

          g.globalAlpha = d.alpha;
        }
        if (d.gold) { g.strokeStyle = "#ffd23a"; g.lineWidth = 0.25; g.globalAlpha = 0.45 + 0.2 * Math.sin(t * 6); g.beginPath(); g.arc(pts[0], pts[1], r * 2, 0, TAU); g.stroke(); g.globalAlpha = d.alpha; }
        if (d.emo) { g.save(); g.globalAlpha = 1; g.translate(pts[0], pts[1] - r * 2.2 - 2.2); g.scale(1 / S, 1 / S); g.fillStyle = "rgba(10,14,26,0.85)"; g.strokeStyle = "rgba(255,220,140,0.95)"; g.lineWidth = 2; g.beginPath(); g.arc(0, -16, 17, 0, TAU); g.fill(); g.stroke(); g.textAlign = "center"; g.textBaseline = "middle"; g.font = d.emo === "GG" ? "800 15px sans-serif" : "20px sans-serif"; g.fillStyle = "#ffd23a"; g.fillText(d.emo, 0, -15); g.restore(); }
        if (d.name && !d.me && !inv) { g.save(); g.translate(pts[0], pts[1] - r * 2.3); g.scale(1 / S, 1 / S); g.font = "600 11.5px -apple-system, Segoe UI, sans-serif"; g.textAlign = "center"; g.fillStyle = "rgba(0,0,0,0.5)"; g.fillText(d.name, 1, 1); g.globalAlpha = 0.85 * d.alpha; g.fillStyle = d.nc || "#fff"; g.fillText(d.name, 0, 0); g.restore(); } // own name tag hidden
      }
      g.globalAlpha = 1;
    }
    for (let i = this.parts.length - 1; i >= 0; i--) { const p = this.parts[i]; p.l -= dt; if (p.l <= 0) { this.parts.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95; g.globalAlpha = p.l / p.m; g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, 0.25, 0, TAU); g.fill(); }
    for (let i = this.rings.length - 1; i >= 0; i--) { const q = this.rings[i]; q.t += dt * 1.6; if (q.t >= 1) { this.rings.splice(i, 1); continue; } g.globalAlpha = (1 - q.t) * 0.5; g.strokeStyle = q.c || "#fff"; g.lineWidth = 0.22; g.beginPath(); g.arc(q.x, q.y, 1 + q.t * Math.min(q.R, 8), 0, TAU); g.stroke(); }
    g.globalAlpha = 1; g.restore();
    // parallax dust: drifts slower than the ground, gives depth without clutter
    if (!this.reduceMotion) { g.fillStyle = W.rim; for (const m of this.motes) { let x = (m.x * this.w - this.camX * S * m.z * 0.5) % this.w, y = (m.y * this.h - this.camY * S * m.z * 0.5 + t * 4 * m.z) % this.h; if (x < 0) x += this.w; if (y < 0) y += this.h; g.globalAlpha = 0.06 + 0.06 * Math.sin(t * 1.3 + m.p); g.beginPath(); g.arc(x, y, m.s, 0, TAU); g.fill(); } g.globalAlpha = 1; }
    this._vignette(0.62);
  }
  dispose() {}
}
