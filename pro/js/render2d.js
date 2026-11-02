// 2D fallback renderer (Canvas 2D): used when WebGL is missing/lost, or on devices too slow for 3D.
// Same frame(view) contract as Renderer3D so the game never knows which one it drives.
import { taperAt, HEAD_K, bodyPoints } from "./sim.js?v=f1";
import { WORLDS, paintGround } from "./worlds.js?v=f1";
import { EYES } from "./skins.js?v=f1";

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas; this.g = canvas.getContext("2d", { alpha: false }); if (!this.g) throw new Error("2d");
    this.tmp = new Float32Array(1600); this.col = [0, 0, 0]; this.parts = []; this.rings = []; this.shakeA = 0; this.juice = true; this.reduceMotion = false;
    this.camX = 0; this.camY = 0; this.scale = 14; this.qName = "low"; this.Q = { particles: 300 }; this.is2D = true;
    this.setWorld(0); this.resize();
  }
  setQuality(q) { this.qName = q; }
  setOptions(o) { Object.assign(this, o); }
  setArena(R) { this.R = R; }
  setWorld(i) { this.W = WORLDS[i] || WORLDS[0]; this.pat = null; this.worldI = i; }
  resize() { const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight; this.w = w; this.h = h; this.dpr = Math.min(1.5, devicePixelRatio || 1); this.canvas.width = w * this.dpr; this.canvas.height = h * this.dpr; }
  burst(x, y, rgb, n, spd = 6, life = 0.8) { for (let k = 0; k < Math.min(n, 40); k++) { const a = Math.random() * 6.28, v = spd * (0.3 + Math.random() * 0.7); this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: life, m: life, c: rgb }); } if (this.parts.length > 300) this.parts.splice(0, this.parts.length - 300); }
  emit() {}
  shatter(s, fn) { const pts = this.tmp, n = bodyPoints(s, 0, 0, Math.max(0.5, s.r * 0.8), s.len, pts, 790), col = this.col; for (let j = 0; j < n; j += Math.max(1, (n / 40) | 0)) { fn(j, n, 0, col); const a = Math.random() * 6.28, v = 2 + Math.random() * 5; this.parts.push({ x: pts[j * 2], y: pts[j * 2 + 1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 1, m: 1, c: [col[0] * col[0], col[1] * col[1], col[2] * col[2]] }); } }
  ring(x, y, rgb, R = 8) { this.rings.push({ x, y, t: 0, R, c: rgb }); }
  shake(a) { if (this.juice && !this.reduceMotion) this.shakeA = Math.min(1.2, this.shakeA + a); }
  project(x, y) { return [(x - this.camX) * this.scale + this.w / 2, (y - this.camY) * this.scale + this.h / 2, true]; }
  info() { return { calls: 0, tris: 0 }; }
  frame(v) {
    if (v.scene === "show") { const g = this.g, W = this.w * this.dpr, H = this.h * this.dpr; const gr = g.createRadialGradient(W * 0.5, H * 0.6, 10, W * 0.5, H * 0.6, W * 0.7); gr.addColorStop(0, "#1a2c55"); gr.addColorStop(1, "#05060b"); g.fillStyle = gr; g.fillRect(0, 0, W, H); return; }
    if (!v.food) return;
    const g = this.g, dt = Math.min(0.05, v.dt), t = v.t, W = this.W;
    const k = 1 - Math.exp(-dt * 9); this.camX += (v.cam.x - this.camX) * k; this.camY += (v.cam.y - this.camY) * k;
    this.scale += ((Math.min(this.w, this.h) / (24 * v.cam.zoom)) - this.scale) * k;
    let sx = 0, sy = 0; if (this.shakeA > 0.01) { sx = (Math.random() - 0.5) * this.shakeA * 8; sy = (Math.random() - 0.5) * this.shakeA * 8; this.shakeA *= Math.exp(-dt * 7); }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = W.fog; g.fillRect(0, 0, this.w, this.h);
    if (!this.pat) { this.pat = g.createPattern(paintGround(W, 256), "repeat"); }
    const S = this.scale; g.save(); g.translate(this.w / 2 + sx, this.h / 2 + sy); g.scale(S, S); g.translate(-this.camX, -this.camY);
    const R = this.R || 130;
    g.save(); g.beginPath(); g.arc(0, 0, R, 0, 6.283); g.clip(); g.save(); g.scale(9 / 256, 9 / 256); g.fillStyle = this.pat; g.fillRect((this.camX - this.w / S) * 256 / 9, (this.camY - this.h / S) * 256 / 9, (2 * this.w / S) * 256 / 9, (2 * this.h / S) * 256 / 9); g.restore(); g.restore();
    g.strokeStyle = W.rim; g.lineWidth = 0.6; g.shadowColor = W.rim; g.shadowBlur = 12; g.beginPath(); g.arc(0, 0, R, 0, 6.283); g.stroke(); g.shadowBlur = 0;
    const vr = Math.max(this.w, this.h) / S * 0.75, vr2 = vr * vr, cx = this.camX, cy = this.camY;
    // food
    const F = v.food, pal = v.foodPalCss;
    for (let i = 0; i < F.FM; i++) { if (!F.fa[i]) continue; const x = F.fx[i], y = F.fy[i]; if ((x - cx) ** 2 + (y - cy) ** 2 > vr2) continue; const r = 0.22 + Math.sqrt(F.fv[i]) * 0.16; g.fillStyle = pal[F.fc[i] % pal.length]; g.globalAlpha = 0.25; g.beginPath(); g.arc(x, y, r * 2.4, 0, 6.283); g.fill(); g.globalAlpha = 1; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); }
    // snakes
    const pts = this.tmp, col = this.col;
    for (const d of v.snakes) {
      const s = d.s, r = s.r * (d.scale || 1); if ((s.sx(d.o) - cx) ** 2 + (s.sy(d.o) - cy) ** 2 > (vr + s.len) ** 2) continue;
      const n = bodyPoints(s, d.o, d.f, Math.max(0.3, r * 0.6), s.len, pts, 790);
      if (d.ox || d.oy) for (let j = 0; j < n; j++) { pts[j * 2] += d.ox; pts[j * 2 + 1] += d.oy; }
      g.globalAlpha = d.alpha;
      g.fillStyle = "rgba(0,0,0,0.25)"; for (let j = n - 1; j >= 0; j -= 2) { g.beginPath(); g.arc(pts[j * 2] + r * 0.3, pts[j * 2 + 1] + r * 0.3, r, 0, 6.283); g.fill(); }
      for (let j = n - 1; j >= 0; j--) {
        const u = j / Math.max(1, n - 1), rr = j ? r * taperAt(u) : r * HEAD_K; d.fn(j, n, t, col);
        const c = `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`; g.fillStyle = c; g.beginPath(); g.arc(pts[j * 2], pts[j * 2 + 1], rr, 0, 6.283); g.fill();
        g.fillStyle = "rgba(255,255,255,0.18)"; g.beginPath(); g.arc(pts[j * 2] - rr * 0.3, pts[j * 2 + 1] - rr * 0.3, rr * 0.45, 0, 6.283); g.fill();
      }
      if (n > 1) {
        const a = Math.atan2(pts[1] - pts[3], pts[0] - pts[2]), E = EYES[d.eye] || EYES[0], er = r * 0.36 * E.s, la = d.look ?? a;
        for (let q = 0; q < E.n; q++) { const side = E.n === 1 ? 0 : (q ? 1 : -1) * r * 0.46, ex = pts[0] + Math.cos(a) * r * 0.45 - Math.sin(a) * side, ey = pts[1] + Math.sin(a) * r * 0.45 + Math.cos(a) * side;
          g.fillStyle = E.ec; g.beginPath(); g.arc(ex, ey, er, 0, 6.283); g.fill(); g.fillStyle = E.pc; g.beginPath(); g.arc(ex + Math.cos(la) * er * 0.4, ey + Math.sin(la) * er * 0.4, er * E.p, 0, 6.283); g.fill(); }
        if (d.name) { g.save(); g.translate(pts[0], pts[1] - r * 2.2); g.scale(1 / S, 1 / S); g.font = "600 13px -apple-system, Segoe UI, sans-serif"; g.textAlign = "center"; g.fillStyle = d.nc || "#fff"; g.fillText(d.name, 0, 0); g.restore(); }
      }
      g.globalAlpha = 1;
    }
    for (let i = this.parts.length - 1; i >= 0; i--) { const p = this.parts[i]; p.l -= dt; if (p.l <= 0) { this.parts.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95; g.globalAlpha = p.l / p.m; g.fillStyle = `rgb(${(Math.sqrt(p.c[0]) * 255) | 0},${(Math.sqrt(p.c[1]) * 255) | 0},${(Math.sqrt(p.c[2]) * 255) | 0})`; g.beginPath(); g.arc(p.x, p.y, 0.25, 0, 6.283); g.fill(); }
    for (let i = this.rings.length - 1; i >= 0; i--) { const q = this.rings[i]; q.t += dt * 1.6; if (q.t >= 1) { this.rings.splice(i, 1); continue; } g.globalAlpha = 1 - q.t; g.strokeStyle = "#fff"; g.lineWidth = 0.3; g.beginPath(); g.arc(q.x, q.y, 1 + q.t * q.R, 0, 6.283); g.stroke(); }
    g.globalAlpha = 1; g.restore();
    const vg = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.4, this.w / 2, this.h / 2, this.w * 0.7); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.45)"); g.fillStyle = vg; g.fillRect(0, 0, this.w, this.h);
  }
  dispose() {}
}
