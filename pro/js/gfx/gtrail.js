// trail1: ground trails. Cosmetic only: never read by sim.js, collisions or the server. One pooled ring buffer of decals
// (hard cap 120, fewer on Low / under the frame governor), spawned along the player's own path near the head and just
// behind it; each decal lives 0.6-1.5 s on the ground and fades out. Both renderers draw the same pool: 2D with one
// cached sprite atlas (drawImage per decal), 3D with one InstancedMesh (one draw call) using the same atlas as a texture.
// Calm mode / reduced motion: static, low-alpha decals (no growth, no flicker, nothing bright), spawned less often.
import { GTRAILS } from "../skins.js?v=fastload";
export const GT_CAP = 120, GT_CELL = 64, GT_VARS = 4;
const TAU = Math.PI * 2;
// per-type motion: spawn spacing (x snake radius), growth style (0 none, 1 ripple ring, 2 sprout, 3 split open, 4 shrink)
const MOT = { dust: [0.55, 0], ripples: [0.95, 1], sparks: [0.4, 4], flowers: [0.85, 2], snow: [0.6, 0], toxic: [0.7, 0], cracks: [0.6, 3], electric: [1.0, 0], lava: [0.6, 3], gold: [0.45, 4] };

// ---------- sprite atlas (10 rows x 4 variants, 64 px cells), drawn once ----------
let ATLAS = null;
function rnd(seed) { let h = seed | 0; return () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x6d2b79f5) | 0; return ((h >>> 0) % 100000) / 100000; }; }
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
function blob(g, x, y, r, hex, a) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(hex, a)); gr.addColorStop(0.55, rgba(hex, a * 0.55)); gr.addColorStop(1, rgba(hex, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function jag(g, R, x, y, ang, len, seg, wob) { g.moveTo(x, y); for (let k = 1; k <= seg; k++) { ang += (R() - 0.5) * wob; x += Math.cos(ang) * len / seg; y += Math.sin(ang) * len / seg; g.lineTo(x, y); } return [x, y, ang]; }
function drawCell(g, id, c, v) {
  const R = rnd(v * 7919 + id.length * 131 + id.charCodeAt(0) * 17), C = 32; g.lineCap = g.lineJoin = "round";
  if (id === "dust") { const n = 4 + (v % 2); for (let k = 0; k < n; k++) blob(g, C + (R() - 0.5) * 26, C + (R() - 0.5) * 22, 9 + R() * 9, k % 2 ? c[1] : c[0], 0.55); }
  else if (id === "ripples") { const n = 2 + (v % 2); g.lineWidth = 2.2; for (let k = 0; k < n; k++) { g.strokeStyle = rgba(c[k % 2], 0.85 - k * 0.22); g.beginPath(); g.ellipse(C, C, 27 - k * 8, 23 - k * 7, 0, 0, TAU); g.stroke(); } }
  else if (id === "sparks") { for (let k = 0; k < 6; k++) { const x = C + (R() - 0.5) * 40, y = C + (R() - 0.5) * 40; blob(g, x, y, 5 + R() * 3, c[1], 0.5); g.fillStyle = rgba(c[0], 0.95); g.beginPath(); g.arc(x, y, 1.4 + R() * 1.1, 0, TAU); g.fill(); }
    g.strokeStyle = rgba(c[0], 0.7); g.lineWidth = 1.4; for (let k = 0; k < 3; k++) { const a = R() * TAU, x = C + Math.cos(a) * 8, y = C + Math.sin(a) * 8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); g.stroke(); } }
  else if (id === "flowers") { const blooms = v < 2 ? [[C, C, 20]] : [[C - 11, C - 7, 14], [C + 12, C + 10, 12]]; const pet = [c[0], c[2], "#c9a7ff", c[0]][v];
    g.fillStyle = rgba("#3f9a4a", 0.85); for (let k = 0; k < 2; k++) { const a = R() * TAU; g.beginPath(); g.ellipse(C + Math.cos(a) * 20, C + Math.sin(a) * 20, 8, 3.5, a, 0, TAU); g.fill(); }
    for (const [x, y, r] of blooms) { g.fillStyle = rgba(pet, 0.95); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + v; g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, TAU); g.fill(); } g.fillStyle = rgba(c[1], 1); g.beginPath(); g.arc(x, y, r * 0.24, 0, TAU); g.fill(); } }
  else if (id === "snow") { blob(g, C, C, 28, c[0], 0.5); blob(g, C + (R() - 0.5) * 14, C + (R() - 0.5) * 14, 16, c[1], 0.35);
    const fl = v % 2 ? [[C, C, 12]] : [[C - 9, C - 5, 8], [C + 10, C + 8, 6]]; g.strokeStyle = rgba(c[0], 0.95); g.lineWidth = 1.5;
    for (const [x, y, r] of fl) { g.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU, ex = x + Math.cos(a) * r, ey = y + Math.sin(a) * r; g.moveTo(x, y); g.lineTo(ex, ey); const mx = x + Math.cos(a) * r * 0.6, my = y + Math.sin(a) * r * 0.6; for (const s of [-1, 1]) { g.moveTo(mx, my); g.lineTo(mx + Math.cos(a + s * 0.8) * r * 0.32, my + Math.sin(a + s * 0.8) * r * 0.32); } } g.stroke(); } }
  else if (id === "toxic") { g.fillStyle = rgba(c[1], 0.75); g.beginPath(); for (let k = 0; k < 6; k++) { const a = R() * TAU, d = R() * 10; g.moveTo(C + Math.cos(a) * d + 12, C + Math.sin(a) * d); g.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, 10 + R() * 6, 0, TAU); } g.fill();
    g.fillStyle = rgba(c[0], 0.7); g.beginPath(); for (let k = 0; k < 4; k++) { const a = R() * TAU, d = R() * 7; g.moveTo(C + Math.cos(a) * d + 8, C + Math.sin(a) * d); g.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, 7 + R() * 4, 0, TAU); } g.fill();
    g.strokeStyle = rgba("#d8ffb0", 0.6); g.lineWidth = 1.2; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(C + (R() - 0.5) * 18, C + (R() - 0.5) * 18, 1.5 + R() * 2.5, 0, TAU); g.stroke(); } }
  else if (id === "cracks") { const st = (v * 31 + 7) | 0;
    const draw = (w, col) => { const R2 = rnd(st); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); const a0 = R2() * TAU; jag(g, R2, C - Math.cos(a0) * 24, C - Math.sin(a0) * 24, a0, 48, 7, 1.1); for (let k = 0; k < 2; k++) { const sx = C + (R2() - 0.5) * 16, sy = C + (R2() - 0.5) * 16; jag(g, R2, sx, sy, R2() * TAU, 14, 3, 1.2); } g.stroke(); };
    draw(4.5, rgba(c[1], 0.5)); draw(2.2, rgba(c[0], 0.95)); }
  else if (id === "electric") { const st = (v * 53 + 3) | 0; const draw = (w, col) => { const R2 = rnd(st); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); const a0 = R2() * TAU; jag(g, R2, C - Math.cos(a0) * 22, C - Math.sin(a0) * 22, a0, 44, 6, 1.6); jag(g, R2, C + (R2() - 0.5) * 10, C + (R2() - 0.5) * 10, R2() * TAU, 14, 3, 1.4); g.stroke(); };
    draw(6, rgba(c[1], 0.32)); draw(2, rgba(c[0], 0.95)); }
  else if (id === "lava") { blob(g, C, C, 28, c[1], 0.6); const st = (v * 71 + 11) | 0;
    const draw = (w, col, blur) => { const R2 = rnd(st); g.shadowColor = rgba(c[0], 0.8); g.shadowBlur = blur; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); const a0 = R2() * TAU; jag(g, R2, C - Math.cos(a0) * 22, C - Math.sin(a0) * 22, a0, 44, 6, 1.0); for (let k = 0; k < 2; k++) jag(g, R2, C + (R2() - 0.5) * 14, C + (R2() - 0.5) * 14, R2() * TAU, 13, 3, 1.1); g.stroke(); g.shadowBlur = 0; };
    draw(3.2, rgba(c[0], 0.9), 6); draw(1.1, rgba(c[2], 0.95), 0); }
  else if (id === "gold") { for (let k = 0; k < 9; k++) { g.fillStyle = rgba(k % 3 ? c[0] : c[1], 0.9); g.beginPath(); g.arc(C + (R() - 0.5) * 44, C + (R() - 0.5) * 44, 0.9 + R() * 1.6, 0, TAU); g.fill(); }
    const n = 1 + (v % 2); for (let k = 0; k < n; k++) { const x = C + (R() - 0.5) * 22, y = C + (R() - 0.5) * 22, r = 7 + R() * 4; blob(g, x, y, r, c[0], 0.45); g.fillStyle = rgba(c[1], 0.95); g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.18, y - r * 0.18); g.lineTo(x + r, y); g.lineTo(x + r * 0.18, y + r * 0.18); g.lineTo(x, y + r); g.lineTo(x - r * 0.18, y + r * 0.18); g.lineTo(x - r, y); g.lineTo(x - r * 0.18, y - r * 0.18); g.closePath(); g.fill(); } }
}
export function gtAtlas() {
  if (ATLAS || typeof document === "undefined") return ATLAS;
  const c = document.createElement("canvas"); c.width = GT_CELL * GT_VARS; c.height = GT_CELL * GTRAILS.length; const g = c.getContext("2d");
  GTRAILS.forEach((T, row) => { for (let v = 0; v < GT_VARS; v++) { g.save(); g.translate(v * GT_CELL, row * GT_CELL); g.beginPath(); g.rect(0, 0, GT_CELL, GT_CELL); g.clip(); drawCell(g, T.id, T.c, v); g.restore(); } });
  ATLAS = c; return c;
}
const URLS = new Map();
// one cell as a data URL (shop card previews)
export function gtCellUrl(ty, v) { const k = ty * 8 + v; let u = URLS.get(k); if (u) return u; const A = gtAtlas(); if (!A) return ""; const c = document.createElement("canvas"); c.width = c.height = GT_CELL; c.getContext("2d").drawImage(A, v * GT_CELL, ty * GT_CELL, GT_CELL, GT_CELL, 0, 0, GT_CELL, GT_CELL); u = c.toDataURL("image/png"); URLS.set(k, u); return u; }

// ---------- the decal pool ----------
export class GTrail {
  constructor() {
    const N = GT_CAP; this.x = new Float32Array(N); this.y = new Float32Array(N); this.rot = new Float32Array(N); this.sz = new Float32Array(N);
    this.age = new Float32Array(N); this.life = new Float32Array(N); this.ty = new Int8Array(N); this.va = new Int8Array(N);
    this.cs = new Float32Array(N); this.ca = new Float32Array(N); // current scale / alpha (written by step, read by the renderers)
    this.head = 0; this.live = 0; this.acc = 0; this.hx = NaN; this.hy = 0; this.sid = -1; this.cap = N;
    for (let i = 0; i < N; i++) this.life[i] = 0;
  }
  clear() { this.life.fill(0); this.age.fill(0); this.live = 0; this.hx = NaN; this.acc = 0; this.sid = -1; if (this.st) this.st.clear(); }
  // v: the game view; ty: equipped trail index (-1 none); o: { calm, low, gov }
  step(v, dt, ty, o) {
    const cap = o.gov >= 3 ? 0 : o.low ? 40 : o.gov >= 2 ? 60 : GT_CAP; this.cap = cap; dt = Math.min(0.05, Math.max(0, dt));
    // spawn from the player's own live snake (ty) and, online (srv1), from other players whose skin carries a trail (d.gti),
    // nearest 8 to the camera only, a little sparser than the own trail; all share the one capped pool
    const SN = v && v.snakes, cam = v && v.cam, seen = this._seen || (this._seen = new Set()); seen.clear();
    if (cap > 0 && SN) { let others = 0;
      for (let k = 0; k < SN.length; k++) { const d = SN[k]; if (!d.s || !d.s.alive) continue; const ti = d.me ? ty : d.gti; if (!(ti >= 0) || !GTRAILS[ti]) continue;
        const s = d.s, o0 = d.o | 0, x = s.sx(o0), y = s.sy(o0);
        if (!d.me) { if (others >= 8 || (cam && (x - cam.x) ** 2 + (y - cam.y) ** 2 > 2500)) continue; others++; }
        seen.add(s.id); this._spawnFrom(s, x, y, ti, d.me ? 1 : 1.4, o); } }
    if (this.st) for (const id of this.st.keys()) if (!seen.has(id)) this.st.delete(id);
    // age + envelope
    let live = 0; const calm = !!o.calm;
    for (let i = 0; i < GT_CAP; i++) { const L = this.life[i]; if (L <= 0) { this.ca[i] = 0; continue; }
      const a = (this.age[i] += dt); if (a >= L) { this.life[i] = 0; this.ca[i] = 0; continue; }
      const u = a / L, T = GTRAILS[this.ty[i]], M = MOT[T.id] || MOT.dust; live++;
      if (calm) { this.ca[i] = Math.min(0.22, T.a * 0.45) * (1 - u); this.cs[i] = 1; continue; } // static, low alpha
      this.ca[i] = T.a * Math.min(1, u / 0.1) * (1 - u * u * u);
      const g = M[1]; this.cs[i] = g === 1 ? 0.45 + 0.85 * u : g === 2 ? 0.3 + 0.7 * Math.min(1, u / 0.3) : g === 3 ? 0.6 + 0.4 * Math.min(1, u / 0.25) : g === 4 ? 1 - 0.35 * u : 1; }
    this.live = live;
  }
  _spawnFrom(s, x, y, ty, sparse, o) {
    const st = this.st || (this.st = new Map()); let e = st.get(s.id); const r = Math.max(0.35, s.r || 0.7);
    if (!e) { e = { hx: x, hy: y, acc: 0 }; st.set(s.id, e); return; }
    const dx = x - e.hx, dy = y - e.hy, dl = Math.hypot(dx, dy);
    if (dl > 8) { e.hx = x; e.hy = y; e.acc = 0; return; } // teleport / respawn: no streak across the map
    if (dl <= 1e-4) return; const T = GTRAILS[ty], M = MOT[T.id] || MOT.dust, gap = r * M[0] * (o.calm ? 1.7 : 1) * (o.low ? 1.5 : 1) * sparse, ux = dx / dl, uy = dy / dl;
    e.acc += dl; let guard = 0;
    while (e.acc >= gap && guard++ < 4) { e.acc -= gap; const back = r * (0.3 + Math.random() * 1.2), q = Math.random(), side = (q < 0.5 ? -1 : 1) * r * (q < 0.2 || q > 0.8 ? Math.random() * 0.6 : 0.7 + Math.random() * 1.2); // most beside the body, where they show
      this._add(x - ux * back - uy * side, y - uy * back + ux * side, r * T.sz * (0.8 + Math.random() * 0.45), T.life * (0.85 + Math.random() * 0.3), ty); }
    if (e.acc > gap) e.acc = gap; e.hx = x; e.hy = y;
  }
  _add(x, y, sz, life, ty) {
    // ring buffer: the oldest slot is reused once the (quality) cap is reached
    let i = this.head; this.head = (this.head + 1) % Math.max(1, this.cap);
    this.x[i] = x; this.y[i] = y; this.sz[i] = sz; this.life[i] = life; this.age[i] = 0; this.ty[i] = ty; this.va[i] = (Math.random() * GT_VARS) | 0; this.rot[i] = Math.random() * TAU; this.cs[i] = 0; this.ca[i] = 0;
  }
}
