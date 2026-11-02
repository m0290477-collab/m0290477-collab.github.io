// Super Snake Pro — shared simulation core.
// Runs unchanged in the browser (offline modes, client prediction) and in the Cloudflare Durable Object (online rooms).
// No DOM, no allocation in the hot loop: typed-array ring buffers for paths, a spatial hash rebuilt per tick, pooled food.

export const C = {
  R: 130, // arena radius (world units)
  SPEED: 8.6, BOOST: 17.5,
  TURN: 4.6, // max turn rate (rad/s) for the smallest snake
  ANG_ACC: 34, // angular acceleration (rad/s²) = turn inertia
  START_M: 24, MIN_BOOST_M: 18, BOOST_COST: 5.5, // mass per second while boosting
  FOOD_TARGET: 620, FOOD_MAX: 1300,
  CAP: 2048, // path ring capacity (samples, one per tick)
  CELL: 4, MAXSEG: 9000,
};
export const MASK = C.CAP - 1;
export const radiusOf = (m) => Math.min(3.4, 0.55 + 0.034 * Math.sqrt(m));
export const lengthOf = (m) => Math.min(190, 5 + 2.25 * Math.sqrt(m));
export const turnOf = (r) => C.TURN / (1 + (r - 0.6) * 0.75);
export const boostCost = (m, dt) => C.BOOST_COST * (1 + m / 1500) * dt;
export const angDiff = (a, b) => { let d = a - b; d -= Math.round(d / 6.283185307179586) * 6.283185307179586; return d; };
const TAU = Math.PI * 2;

// Small fast PRNG (mulberry32) so a seed reproduces a world (daily challenge, tests)
export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const BOT_NAMES = ["Viper", "Mamba", "Cobra", "Python", "Taipan", "Krait", "Boa", "Adder", "Asp", "Sidewinder", "Anaconda", "Rattler", "Copperhead", "Kingsnake", "Basilisk", "Naga", "Jörmungandr", "Quetzal", "Medusa", "Hydra", "Orochi", "Apophis", "Ouroboros", "Nidhogg", "Wadjet", "Serpentine", "Onyx", "Zephyr", "Nova", "Blitz", "Echo", "Rogue", "Shadow", "Titan", "Raptor", "Falcon", "Jade", "Ember", "Frost", "Storm"];

// Bot difficulty: look = look-ahead multiplier, react = ticks between decisions (at 60 Hz), hunt = hunting drive, boost = boost eagerness, err = mistake rate
export const DIFF = [
  { look: 0.75, react: 14, hunt: 0.05, boost: 0.15, err: 0.08 }, // Easy
  { look: 1.0, react: 9, hunt: 0.35, boost: 0.4, err: 0.03 }, // Normal
  { look: 1.25, react: 6, hunt: 0.7, boost: 0.7, err: 0.012 }, // Hard
  { look: 1.5, react: 4, hunt: 1.0, boost: 1.0, err: 0.0 }, // Legend
];

export class Snake {
  constructor(id) {
    this.id = id; this.px = new Float32Array(C.CAP); this.py = new Float32Array(C.CAP);
    this.reset(0, 0, 0, C.START_M);
  }
  reset(x, y, a, m) {
    this.x = x; this.y = y; this.a = a; this.av = 0; this.ta = a; this.boost = 0; this.boosting = false;
    this.m = m; this.r = radiusOf(m); this.len = lengthOf(m);
    this.h = 0; this.n = 0; this.alive = true; this.kills = 0; this.dropAcc = 0; this.bornTick = 0;
    this.bot = false; this.ai = null; this.god = false; this.best = m; this.foodEaten = 0;
    this.lastA = a;
    // seed a straight tail behind the head so the body exists from frame one
    const step = 0.15; const k = Math.ceil(this.len / step) + 2;
    for (let i = k; i >= 0; i--) this.push(x - Math.cos(a) * i * step, y - Math.sin(a) * i * step);
  }
  push(x, y) { this.h = (this.h + 1) & MASK; this.px[this.h] = x; this.py[this.h] = y; if (this.n < C.CAP) this.n++; }
  // sample i back from the newest (0 = head)
  sx(i) { return this.px[(this.h - i) & MASK]; }
  sy(i) { return this.py[(this.h - i) & MASK]; }
  setMass(m) { this.m = m; this.r = radiusOf(m); this.len = lengthOf(m); if (m > this.best) this.best = m; }
}

// Move one snake one tick: turn with inertia toward ta, advance, record a path sample. Deterministic given (state, ta, boost, dt).
export function moveSnake(s, dt, canBoost) {
  const tm = turnOf(s.r), d = angDiff(s.ta, s.a);
  const want = Math.max(-tm, Math.min(tm, d * 9));
  const acc = C.ANG_ACC * dt;
  s.av += Math.max(-acc, Math.min(acc, want - s.av));
  if (Math.abs(s.av * dt) > Math.abs(d) && Math.sign(s.av) === Math.sign(d)) s.av = d / dt; // no overshoot
  s.lastA = s.a;
  s.a += s.av * dt; if (s.a > Math.PI) s.a -= TAU; else if (s.a < -Math.PI) s.a += TAU;
  s.boosting = !!s.boost && canBoost;
  const v = s.boosting ? C.BOOST : C.SPEED;
  s.x += Math.cos(s.a) * v * dt; s.y += Math.sin(s.a) * v * dt;
  s.push(s.x, s.y);
}

// Walk the path from offset `o` (fractional head between sample o and o-1 by `f`) and emit body points every `sp` units up to `len`.
// Writes into out (Float32Array of x,y pairs); returns number of points. Used by collision AND rendering so they match exactly.
export function bodyPoints(s, o, f, sp, len, out, maxPts) {
  let i = o; if (i < 0) i = 0;
  let hx = s.sx(i), hy = s.sy(i);
  if (f > 0 && i > 0) { hx += (s.sx(i - 1) - hx) * f; hy += (s.sy(i - 1) - hy) * f; }
  let k = 0; out[0] = hx; out[1] = hy; k = 1;
  let px = hx, py = hy, acc = 0, need = sp, walked = 0;
  const lim = Math.min(s.n - 1, C.CAP - 1);
  while (i < lim && k < maxPts) {
    const nx = s.sx(i + 1), ny = s.sy(i + 1);
    const dx = nx - px, dy = ny - py, d = Math.sqrt(dx * dx + dy * dy);
    if (acc + d >= need) {
      const t = (need - acc) / (d || 1); px += dx * t; py += dy * t; walked += need - acc;
      out[k * 2] = px; out[k * 2 + 1] = py; k++; acc = 0; need = sp;
      if (walked >= len) break;
      continue;
    }
    acc += d; walked += d; px = nx; py = ny; i++;
    if (walked >= len) break;
  }
  return k;
}

// Spatial hash (linked lists in typed arrays, rebuilt each tick, zero allocation)
class Grid {
  constructor(R, cell, max) {
    this.cell = cell; this.dim = Math.ceil((R * 2 + 40) / cell); this.off = R + 20;
    this.head = new Int32Array(this.dim * this.dim); this.next = new Int32Array(max);
    this.x = new Float32Array(max); this.y = new Float32Array(max); this.r = new Float32Array(max); this.o = new Int32Array(max); this.k = new Int32Array(max);
    this.n = 0; this.max = max; this.head.fill(-1);
  }
  clear() { this.head.fill(-1); this.n = 0; }
  ci(x, y) { let cx = ((x + this.off) / this.cell) | 0, cy = ((y + this.off) / this.cell) | 0; if (cx < 0) cx = 0; else if (cx >= this.dim) cx = this.dim - 1; if (cy < 0) cy = 0; else if (cy >= this.dim) cy = this.dim - 1; return cy * this.dim + cx; }
  add(x, y, r, o, k) { if (this.n >= this.max) return; const j = this.n++, c = this.ci(x, y); this.x[j] = x; this.y[j] = y; this.r[j] = r; this.o[j] = o; this.k[j] = k; this.next[j] = this.head[c]; this.head[c] = j; }
}

export class Sim {
  constructor(opt = {}) {
    this._heads = []; this._nh = 0;
    this.dt = opt.dt || 1 / 60; this.R = opt.R || C.R;
    this.rand = rng(opt.seed || (Math.random() * 1e9) | 0);
    this.snakes = []; this.byId = new Map(); this.nextId = 1; this.tick = 0;
    this.grid = new Grid(this.R, C.CELL, C.MAXSEG);
    this.fgrid = new Grid(this.R, C.CELL, C.FOOD_MAX + 50);
    this.foodTarget = opt.foodTarget || Math.round(C.FOOD_TARGET * (this.R / C.R) ** 2);
    // food pool
    const FM = C.FOOD_MAX + 50; this.FM = FM;
    this.fx = new Float32Array(FM); this.fy = new Float32Array(FM); this.fv = new Float32Array(FM); this.fc = new Uint8Array(FM); this.fa = new Uint8Array(FM);
    this.fid = new Uint16Array(FM); this.fFree = []; for (let i = FM - 1; i >= 0; i--) this.fFree.push(i); this.fCount = 0; this.fSeq = 1;
    this.fBorn = new Uint32Array(FM);
    // events since last drain (for net + effects); plain arrays reused
    this.evEat = []; this.evSpawn = []; this.evDie = []; this.evNew = [];
    this.tmp = new Float32Array(1200);
    this.walls = opt.walls !== false; this.diff = opt.diff ?? 1; this.botAggro = 1;
    this.netMode = !!opt.netMode;
    for (let i = 0; i < this.foodTarget; i++) this.spawnFood(...this.randPos(this.R - 3), 1 + (this.rand() * 2.2) | 0, (this.rand() * 12) | 0);
  }
  randPos(rr) { const a = this.rand() * TAU, d = Math.sqrt(this.rand()) * rr; return [Math.cos(a) * d, Math.sin(a) * d]; }
  spawnFood(x, y, v, c) {
    if (!this.fFree.length) return -1;
    const i = this.fFree.pop(); this.fx[i] = x; this.fy[i] = y; this.fv[i] = v; this.fc[i] = c; this.fa[i] = 1; this.fCount++;
    this.fid[i] = this.fSeq; this.fSeq = (this.fSeq % 65000) + 1; this.fBorn[i] = this.tick;
    this.evSpawn.push(i); return i;
  }
  removeFood(i, by) { if (!this.fa[i]) return; this.fa[i] = 0; this.fCount--; this.fFree.push(i); this.evEat.push(i, by); }

  addSnake(name, skin, opt = {}) {
    const s = new Snake(this.nextId++); s.name = name; s.skin = skin;
    const [x, y] = opt.pos || this.safeSpawn(); const a = Math.atan2(-y, -x) + (this.rand() - 0.5) * 1.2;
    s.reset(x, y, a, opt.m || C.START_M); s.bornTick = this.tick; s.bot = !!opt.bot; s.god = !!opt.god;
    if (s.bot) s.ai = { t: 0, mode: 0, tgt: 0, wa: a, diff: opt.diff ?? this.diff, err: 0 };
    this.snakes.push(s); this.byId.set(s.id, s); this.evNew.push(s.id);
    return s;
  }
  safeSpawn() {
    let best = null, bd = -1;
    for (let k = 0; k < 14; k++) {
      const p = this.randPos(this.R * 0.82); let md = 1e9;
      for (const s of this.snakes) if (s.alive) { for (let i = 0; i < s.n; i += 12) { const dx = s.sx(i) - p[0], dy = s.sy(i) - p[1]; const d = dx * dx + dy * dy; if (d < md) md = d; } }
      if (md > 400) return p; if (md > bd) { bd = md; best = p; }
    }
    return best;
  }
  removeSnake(s) { const i = this.snakes.indexOf(s); if (i >= 0) this.snakes.splice(i, 1); this.byId.delete(s.id); }

  kill(s, killerId, cause) {
    if (!s.alive) return; s.alive = false;
    const k = killerId ? this.byId.get(killerId) : null; if (k && k !== s) k.kills++;
    // body becomes food (≈55% of mass), spread along the corpse
    const pts = this.tmp, sp = Math.max(0.9, s.r * 0.9), n = bodyPoints(s, 0, 0, sp, s.len, pts, 590);
    const per = Math.max(1, Math.min(14, (s.m * 0.55) / n));
    for (let j = 0; j < n; j++) {
      const ox = (this.rand() - 0.5) * s.r * 1.4, oy = (this.rand() - 0.5) * s.r * 1.4;
      if (this.fCount < C.FOOD_MAX) this.spawnFood(pts[j * 2] + ox, pts[j * 2 + 1] + oy, per * (0.7 + this.rand() * 0.6), (s.id * 3 + j) % 12);
    }
    this.evDie.push(s.id, killerId || 0, cause || 0);
  }

  // ---- bots ----
  // danger along a ray: 0 = clear, higher = closer obstacle (bodies of others, arena wall)
  rayDanger(s, ang, look) {
    const g = this.grid, cx = Math.cos(ang), cy = Math.sin(ang), dim = g.dim, wl = (this.R - s.r - 2) ** 2;
    for (let st = 1; st <= 5; st++) {
      const qx = s.x + cx * look * st / 5, qy = s.y + cy * look * st / 5;
      if (qx * qx + qy * qy > wl) return (6 - st) * 3;
      const tt = (look * st / 5) / (s.boosting ? C.BOOST : C.SPEED), H = this._heads;
      for (let h = 0; h < this._nh; h++) { const o = H[h], ex = o.x + Math.cos(o.a) * o.v * tt - qx, ey = o.y + Math.sin(o.a) * o.v * tt - qy, rr = o.r + s.r + 1.6; if (ex * ex + ey * ey < rr * rr) return (6 - st) * 3; }
      const c0 = g.ci(qx, qy);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= g.head.length) continue; let j = g.head[c];
        while (j >= 0) { if (g.o[j] !== s.id) { const dx = g.x[j] - qx, dy = g.y[j] - qy, rr = g.r[j] + s.r + 0.9; if (dx * dx + dy * dy < rr * rr) return (6 - st) * 3; } j = g.next[j]; }
      }
    }
    return 0;
  }
  botThink(s) {
    const ai = s.ai, D = DIFF[Math.max(0, Math.min(3, ai.diff))];
    const look = (6 + s.r * 5) * D.look * (0.85 + 0.15 * this.botAggro);
    let want = null, boost = 0;
    if (!this._heads) this._heads = [];
    this._nh = 0; const lr2 = (look * 1.6 + 6) ** 2;
    for (const o of this.snakes) if (o !== s && o.alive) { const dx = o.x - s.x, dy = o.y - s.y; if (dx * dx + dy * dy < lr2) { const H = this._heads[this._nh] || (this._heads[this._nh] = {}); H.x = o.x; H.y = o.y; H.a = o.a; H.v = o.boosting ? C.BOOST : C.SPEED; H.r = o.r; this._nh++; } }
    // hunt: cut off a nearby snake by aiming ahead of its head
    if (this.rand() < D.hunt * 0.25 * this.botAggro || (ai.mode === 3 && this.rand() < 0.85)) {
      let tgt = null, td = 1e9;
      for (const o of this.snakes) if (o !== s && o.alive && !o.god) { const dx = o.x - s.x, dy = o.y - s.y, d = dx * dx + dy * dy; if (d < td && d < 900 && (o.m < s.m * 2.5 || D.hunt > 0.6)) { td = d; tgt = o; } }
      if (tgt) {
        const lead = 4 + Math.sqrt(td) * 0.45, tx = tgt.x + Math.cos(tgt.a) * lead, ty = tgt.y + Math.sin(tgt.a) * lead;
        want = Math.atan2(ty - s.y, tx - s.x); boost = Math.sqrt(td) < 14 && this.rand() < D.boost && s.m > 30 ? 1 : 0; ai.mode = 3;
      }
    }
    // feed: best value/distance food in range, preferring what lies ahead
    if (want === null) {
      const fg = this.fgrid, rad = 3, c0 = fg.ci(s.x, s.y), dim = fg.dim; let bf = -1, bs = 0;
      for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= fg.head.length) continue; let j = fg.head[c];
        while (j >= 0) { const dx = fg.x[j] - s.x, dy = fg.y[j] - s.y, d = Math.sqrt(dx * dx + dy * dy) + 1; const fwd = (dx * Math.cos(s.a) + dy * Math.sin(s.a)) / d; const sc = fg.r[j] / d * (1.4 + fwd); if (sc > bs) { bs = sc; bf = j; } j = fg.next[j]; }
      }
      if (bf >= 0) { want = Math.atan2(fg.y[bf] - s.y, fg.x[bf] - s.x); ai.mode = 1; if (fg.r[bf] > 5 && D.boost > 0.6 && s.m > 60) boost = 1; }
    }
    // wander, drifting back toward the centre when far out
    if (want === null) {
      if (Math.hypot(s.x, s.y) > this.R * 0.7) ai.wa = Math.atan2(-s.y, -s.x) + (this.rand() - 0.5);
      else ai.wa += (this.rand() - 0.5) * 0.9;
      want = ai.wa; ai.mode = 0;
    }
    // safety: the path toward `want` (and straight ahead, since turning takes time) must be clear, else take the clearest ray
    const smart = this.rand() > D.err * 4;
    if (smart) {
      const dw = this.rayDanger(s, want, look), da = this.rayDanger(s, s.a, look * 0.7);
      if (dw > 0 || da > 0) {
        let bestA = want, bestS = -1e9;
        for (let k = -6; k <= 6; k++) {
          const ang = s.a + k * 0.33, dn = this.rayDanger(s, ang, look);
          const sc = -dn * 10 - Math.abs(angDiff(ang, want)) * 0.8 - Math.abs(k) * 0.2;
          if (sc > bestS) { bestS = sc; bestA = ang; }
        }
        want = bestA; boost = (da >= 12 && D.boost > 0.5 && s.m > 40) ? 1 : 0; ai.mode = 2;
      }
    }
    s.ta = want; s.boost = boost;
  }
  // cheap per-tick reflex between decisions: only the ray straight ahead, short range
  botReflex(s) {
    this._nh = 0;
    const D = DIFF[Math.max(0, Math.min(3, s.ai.diff))]; const look = (3 + s.r * 3) * D.look;
    if (this.rayDanger(s, s.a, look) > 0) s.ai.t = 0;
  }

  // ---- one fixed step ----
  step(inputs) {
    const dt = this.dt; this.tick++;
    const reactScale = (1 / 60) / dt;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (s.bot) { if ((this.tick + s.id) % 3 === 0 && s.ai.t > 1) this.botReflex(s); if (--s.ai.t <= 0) { this.botThink(s); const D = DIFF[Math.max(0, Math.min(3, s.ai.diff))]; s.ai.t = Math.max(1, Math.round(D.react * reactScale * (0.7 + this.rand() * 0.6))); } }
      else if (inputs) { const inp = inputs(s); if (inp === false) continue; }
      const canBoost = s.m > C.MIN_BOOST_M;
      moveSnake(s, dt, canBoost);
      if (s.boosting) {
        const cost = boostCost(s.m, dt); s.setMass(Math.max(C.MIN_BOOST_M - 0.5, s.m - cost)); s.dropAcc += cost;
        if (s.dropAcc > 2.2) { s.dropAcc -= 2.2; const o = Math.min(s.n - 1, Math.round(s.len / (C.SPEED * dt))); this.spawnFood(s.sx(o) + (this.rand() - 0.5), s.sy(o) + (this.rand() - 0.5), 1.5, (s.id * 5) % 12); }
      }
      if (this.walls) {
        const d2 = s.x * s.x + s.y * s.y, lim = this.R - s.r * 0.6;
        if (d2 > lim * lim) {
          if (s.god || s.bot && !this.walls) { const d = Math.sqrt(d2); s.x *= lim / d; s.y *= lim / d; s.a = s.ta = Math.atan2(-s.y, -s.x); s.av = 0; this.fixHead(s); }
          else this.kill(s, 0, 1);
        }
      }
    }
    this.buildGrid();
    this.collide();
    this.eat();
    // keep the world fed
    let need = this.foodTarget - this.fCount, sp = 0;
    while (need-- > 0 && sp++ < 6) { const [x, y] = this.randPos(this.R - 3); this.spawnFood(x, y, 1 + (this.rand() * 2.2) | 0, (this.rand() * 12) | 0); }
  }
  fixHead(s) { s.px[s.h] = s.x; s.py[s.h] = s.y; }

  buildGrid() {
    const g = this.grid; g.clear(); const pts = this.tmp;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const sp = Math.max(0.35, s.r * 0.6), n = bodyPoints(s, 0, 0, sp, s.len, pts, 590);
      for (let j = 0; j < n; j++) g.add(pts[j * 2], pts[j * 2 + 1], s.r, s.id, j);
    }
    const f = this.fgrid; f.clear();
    for (let i = 0; i < this.FM; i++) if (this.fa[i]) f.add(this.fx[i], this.fy[i], this.fv[i], i, 0);
  }

  // head vs every other snake's body (heads included → head-on collisions kill both)
  collide() {
    const g = this.grid, dim = g.dim;
    for (const s of this.snakes) {
      if (!s.alive || s.god) continue;
      const c0 = g.ci(s.x, s.y); let killer = 0;
      const rx = Math.max(1, Math.ceil((s.r + 3.5) / g.cell));
      for (let oy = -rx; oy <= rx && !killer; oy++) for (let ox = -rx; ox <= rx && !killer; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= g.head.length) continue; let j = g.head[c];
        while (j >= 0) {
          if (g.o[j] !== s.id) { const dx = g.x[j] - s.x, dy = g.y[j] - s.y, rr = (g.r[j] + s.r) * 0.8; if (dx * dx + dy * dy < rr * rr) { killer = g.o[j]; this.lastHitSeg = g.k[j]; break; } }
          j = g.next[j];
        }
      }
      if (killer) { const k = this.byId.get(killer); if (k && k.god) continue; this.kill(s, killer, 2); }
    }
  }
  // exported so the client can run the same test against what it renders (instant self-reported death)
  static hitTest(hx, hy, hr, others, tmp) {
    for (const o of others) {
      if (!o.alive) continue; const sp = Math.max(0.35, o.r * 0.6), n = bodyPoints(o, o._ro || 0, o._rf || 0, sp, o.len, tmp, 590);
      const rr = (o.r + hr) * 0.8, rr2 = rr * rr;
      const qx = tmp[0] - hx, qy = tmp[1] - hy; if (qx * qx + qy * qy > (o.len + hr + 4) ** 2) continue;
      for (let j = 0; j < n; j++) { const dx = tmp[j * 2] - hx, dy = tmp[j * 2 + 1] - hy; if (dx * dx + dy * dy < rr2) return o.id; }
    }
    return 0;
  }

  eat() {
    const f = this.fgrid, dim = f.dim;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const reach = s.r + 0.9, c0 = f.ci(s.x, s.y), rx = Math.ceil(reach / f.cell);
      for (let oy = -rx; oy <= rx; oy++) for (let ox = -rx; ox <= rx; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= f.head.length) continue; let j = f.head[c];
        while (j >= 0) {
          const i = f.o[j];
          if (this.fa[i]) { const dx = this.fx[i] - s.x, dy = this.fy[i] - s.y; if (dx * dx + dy * dy < reach * reach) { s.setMass(s.m + this.fv[i]); s.foodEaten++; this.removeFood(i, s.id); } }
          j = f.next[j];
        }
      }
    }
  }
  drain() { this.evEat.length = 0; this.evSpawn.length = 0; this.evDie.length = 0; this.evNew.length = 0; }
  leaderboard(n) { return this.snakes.filter((s) => s.alive).sort((a, b) => b.m - a.m).slice(0, n); }
}

// server-side check of a skin descriptor sent by a client: only known shapes and safe values survive
export function sanitizeSkin(d) {
  const o = { k: "skin", i: 0, p: 0, c: ["#18c964", "#0b7a3b", "#b8ffcf"], e: 0, t: 0, n: 0 };
  if (!d || typeof d !== "object") return o;
  if (d.k === "flag" || d.k === "skin" || d.k === "custom") o.k = d.k;
  o.i = Math.max(0, Math.min(400, d.i | 0)); o.p = Math.max(0, Math.min(11, d.p | 0));
  if (Array.isArray(d.c)) o.c = d.c.slice(0, 3).map((h) => (typeof h === "string" && /^#[0-9a-fA-F]{6}$/.test(h) ? h : "#18c964"));
  o.e = Math.max(0, Math.min(6, d.e | 0)); o.t = Math.max(0, Math.min(6, d.t | 0)); o.n = Math.max(0, Math.min(9, d.n | 0));
  return o;
}
export const cleanName = (n) => String(n || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16) || "Guest";
