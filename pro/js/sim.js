// Super Snake Pro — shared simulation core.
// Runs unchanged in the browser (offline modes, client prediction) and in the Cloudflare Durable Object (online rooms).
// No DOM, no allocation in the hot loop: typed-array ring buffers for paths, a spatial hash rebuilt per tick, pooled food.

export const C = {
  R: 240, // arena radius (world units): online rooms + default; offline modes set their own
  SPEED: 8.6, BOOST: 17.5,
  TURN: 4.6, // max turn rate (rad/s) for the smallest snake
  ANG_ACC: 34, // angular acceleration (rad/s²) = turn inertia
  START_M: 24, MIN_BOOST_M: 18, BOOST_COST: 5.5, // mass per second while boosting
  FOOD_TARGET: 620, FOOD_MAX: 1300,
  CAP: 2048, // path ring capacity (samples, one per tick)
  CELL: 4, MAXSEG: 60000,
};
export const MASK = C.CAP - 1;
export const radiusOf = (m) => Math.min(3.4, 0.55 + 0.034 * Math.sqrt(m));
export const lengthOf = (m) => Math.min(190, 5 + 2.25 * Math.sqrt(m));
export const turnOf = (r) => C.TURN / (1 + (r - 0.6) * 0.75);
export const boostCost = (m, dt) => C.BOOST_COST * (1 + m / 1500) * dt;
// ---- body shape shared by collision AND both renderers (gfx/snake.js mirrors these numbers in GLSL) ----
// half-width of the body at fraction u (0 = head, 1 = tail tip) is r * taperAt(u); the head is a disc of r * HEAD_K.
export const HEAD_K = 1.12;
export const HIT_K = 0.98; // contact = edges touch (2% slack for the polyline sagitta between samples)
export const taperAt = (u) => { const t = Math.max(0, Math.min(1, (u - 0.58) / 0.42)); return 1 - 0.74 * t * t * (3 - 2 * t); };
export const sampleSp = (r) => Math.max(0.3, r * 0.4); // collision sample spacing: no visible gaps between discs
// power-ups: magnet, shield, speed, x2 score, ghost, freeze, mega-orb burst
export const PU = { MAG: 0, SHIELD: 1, SPEED: 2, X2: 3, GHOST: 4, FREEZE: 5, MEGA: 6, N: 7 };
export const PU_DUR = [10, 20, 6, 12, 5, 4, 0];
export const PU_TIMED = [0, 1, 2, 3, 4, 5]; // kinds with a countdown (HUD chips)
export const PU_ICON = ["🧲", "🛡", "⚡", "×2", "👻", "❄", "💎"];
// 24x24 vector glyphs (no emoji-font dependency): used by the HUD chips (inline SVG) and the 3D badges (Path2D)
export const PU_SVG = [
  "M6 3h4v9a2 2 0 0 0 4 0V3h4v9a6 6 0 0 1-12 0Z", // magnet
  "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5Z", // shield
  "M13 2 4 14h7l-1 8 9-12h-7Z", // speed bolt
  "M3 7h3l2.5 3.5L11 7h3l-4 5 4 5h-3l-2.5-3.5L6 17H3l4-5Zm12.5 3.2c0-2 1.6-3.2 3.3-3.2 1.8 0 3.2 1.2 3.2 3 0 1.4-.8 2.3-2.2 3.5L18.6 15H22v2h-6.6v-1.7l3.4-3c.9-.8 1.2-1.3 1.2-2 0-.7-.5-1.2-1.2-1.2-.8 0-1.3.6-1.3 1.3Z", // x2
  "M12 2a7 7 0 0 0-7 7v13l2.3-2 2.4 2 2.3-2 2.3 2 2.4-2L19 22V9a7 7 0 0 0-7-7Zm-2.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z", // ghost
  "M11 1h2v5.3l2.6-2.6 1.4 1.4L13 9.1V11h1.9l4-4 1.4 1.4-2.6 2.6H23v2h-5.3l2.6 2.6-1.4 1.4-4-4H13v1.9l4 4-1.4 1.4-2.6-2.6V23h-2v-5.3l-2.6 2.6L7 18.9l4-4V13H9.1l-4 4-1.4-1.4L6.3 13H1v-2h5.3L3.7 8.4 5.1 7l4 4H11V9.1l-4-4 1.4-1.4L11 6.3Z", // snowflake
  "M6 3h12l4 6-10 13L2 9Zm1.2 2L4.6 8.6h4.6L11 5Zm9.6 0H13l1.8 3.6h4.6Z", // diamond
];
export const PU_COL = ["#ff4fd8", "#4fc3ff", "#ffe14f", "#ffa13d", "#c6b8ff", "#9ff3ff", "#5dffb0"];
export const angDiff = (a, b) => { let d = a - b; d -= Math.round(d / 6.283185307179586) * 6.283185307179586; return d; };
const TAU = Math.PI * 2;

// Small fast PRNG (mulberry32) so a seed reproduces a world (daily challenge, tests)
export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const BOT_NAMES = ["Viper", "Mamba", "Cobra", "Python", "Taipan", "Krait", "Boa", "Adder", "Asp", "Sidewinder", "Anaconda", "Rattler", "Copperhead", "Kingsnake", "Basilisk", "Naga", "Jörmungandr", "Quetzal", "Medusa", "Hydra", "Orochi", "Apophis", "Ouroboros", "Nidhogg", "Wadjet", "Serpentine", "Onyx", "Zephyr", "Nova", "Blitz", "Echo", "Rogue", "Shadow", "Titan", "Raptor", "Falcon", "Jade", "Ember", "Frost", "Storm"];
// a bot name no living snake is using right now (falls back to "Name 2", "Name 3"…), so the kill feed never reads "Basilisk ⚔ Basilisk"
export function pickBotName(snakes, start) { const used = new Set(); for (const s of snakes) if (s.alive) used.add(s.name); const L = BOT_NAMES.length; start = ((start % L) + L) % L; for (let k = 0; k < L; k++) { const n = BOT_NAMES[(start + k) % L]; if (!used.has(n)) return n; } const b = BOT_NAMES[start]; let n = 2; while (used.has(b + " " + n)) n++; return b + " " + n; }

// Bot difficulty: look = look-ahead multiplier, react = ticks between decisions (at 60 Hz), hunt = hunting drive, boost = boost eagerness, err = mistake rate
export const DIFF = [
  { look: 0.75, react: 14, hunt: 0.1, boost: 0.2, err: 0.01 }, // Easy
  { look: 1.0, react: 9, hunt: 0.4, boost: 0.45, err: 0.02 }, // Normal
  { look: 1.2, react: 6, hunt: 0.7, boost: 0.7, err: 0.026 }, // Hard
  { look: 1.4, react: 4, hunt: 1.0, boost: 0.9, err: 0.03 }, // Legend
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
    this.lastA = a; this.pu = [0, 0, 0, 0, 0, 0, 0]; this.slow = 0; this.inv = 0;
    // seed a straight tail behind the head so the body exists from frame one
    const step = 0.15; const k = Math.ceil(this.len / step) + 2;
    for (let i = k; i >= 0; i--) this.push(x - Math.cos(a) * i * step, y - Math.sin(a) * i * step);
  }
  push(x, y) { this.h = (this.h + 1) & MASK; this.px[this.h] = x; this.py[this.h] = y; if (this.n < C.CAP) this.n++; }
  // sample i back from the newest (0 = head)
  sx(i) { return this.px[(this.h - i) & MASK]; }
  sy(i) { return this.py[(this.h - i) & MASK]; }
  setMass(m) { this.m = m; this.r = radiusOf(m) * (this.rk || 1); this.len = lengthOf(m) * (this.lk || 1); if (m > this.best) this.best = m; }
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
  const free = s.pu && s.pu[2] > 0; // speed power-up = free boost
  s.boosting = (!!s.boost && canBoost) || free;
  const v = (s.boosting ? C.BOOST : C.SPEED) * (s.vk || 1) * (s.slow > 0 ? 0.55 : 1);
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
    // food keeps the original density (620 orbs on r=130) at any arena size; the pool grows with it
    this.foodTarget = opt.foodTarget || Math.round(C.FOOD_TARGET * (this.R / 130) ** 2);
    const FM = Math.max(C.FOOD_MAX, Math.round(this.foodTarget * 2.1)) + 50; this.FM = FM;
    this.fgrid = new Grid(this.R, C.CELL, FM);
    // food pool
    this.fx = new Float32Array(FM); this.fy = new Float32Array(FM); this.fv = new Float32Array(FM); this.fc = new Uint8Array(FM); this.fa = new Uint8Array(FM);
    this.fid = new Uint16Array(FM); this.fFree = []; for (let i = FM - 1; i >= 0; i--) this.fFree.push(i); this.fCount = 0; this.fSeq = 1;
    this.fBorn = new Uint32Array(FM);
    // events since last drain (for net + effects); plain arrays reused
    this.evEat = []; this.evSpawn = []; this.evDie = []; this.evNew = [];
    this.tmp = new Float32Array(1200);
    this.walls = opt.walls !== false; this.diff = opt.diff ?? 1; this.botAggro = 1;
    this.netMode = !!opt.netMode;
    // power-ups on the field: {id,k,x,y,b(born tick)}. evPu = (pu, takerId|0 for expiry, frozenIds) triples; evShield = (snakeId, hitById) pairs
    this.powerups = opt.powerups !== false; this.pus = []; this.puSeq = 1; this.evPu = []; this.evPuNew = []; this.evShield = [];
    this.puTarget = opt.puTarget ?? Math.max(4, Math.round(9 * (this.R / 130) ** 2)); this.puNext = 60; this.puNear = opt.puNear ?? 9; this.puCap = 160;
    if (this.powerups) for (let i = 0; i < Math.ceil(this.puTarget * 0.6); i++) this.spawnPu();
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
  spawnPu(k, x, y) {
    if (k === undefined) { const r = this.rand(); k = r < 0.17 ? 0 : r < 0.32 ? 1 : r < 0.48 ? 2 : r < 0.64 ? 3 : r < 0.77 ? 4 : r < 0.89 ? 5 : 6; }
    if (x === undefined) [x, y] = this.randPos(this.R * 0.85);
    const p = { id: this.puSeq = (this.puSeq % 60000) + 1, k, x, y, b: this.tick }; this.pus.push(p); this.evPuNew.push(p); return p;
  }
  // apply a picked power-up to snake s; returns ids of snakes it froze
  applyPu(s, k) {
    const hit = [];
    if (k === PU.MEGA) { for (let i = 0; i < 26; i++) { const a = i / 26 * TAU + this.rand() * 0.2, d = 3 + this.rand() * 9; if (this.fCount < this.FM - 60) this.spawnFood(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 4 + this.rand() * 4, (i * 5) % 12); } }
    else if (k === PU.FREEZE) { for (const o of this.snakes) if (o !== s && o.alive && !o.god && !(this.teams && o.team === s.team)) { const dx = o.x - s.x, dy = o.y - s.y; if (dx * dx + dy * dy < 34 * 34) { o.slow = PU_DUR[5]; hit.push(o.id); } } }
    else if (k === PU.SHIELD) s.pu[1] = PU_DUR[1];
    else s.pu[k] = PU_DUR[k];
    return hit;
  }
  removeSnake(s) { const i = this.snakes.indexOf(s); if (i >= 0) this.snakes.splice(i, 1); this.byId.delete(s.id); }

  kill(s, killerId, cause) {
    if (!s.alive) return; s.alive = false; s.diedTick = this.tick;
    const k = killerId ? this.byId.get(killerId) : null; if (k && k !== s) k.kills++;
    // body becomes food (≈55% of mass), spread along the corpse
    const pts = this.tmp, sp = Math.max(0.9, s.r * 0.9), n = bodyPoints(s, 0, 0, sp, s.len, pts, 590);
    const per = Math.max(1, Math.min(14, (s.m * 0.55) / n));
    for (let j = 0; j < n; j++) {
      const ox = (this.rand() - 0.5) * s.r * 1.4, oy = (this.rand() - 0.5) * s.r * 1.4;
      if (this.fCount < this.FM - 60) this.spawnFood(pts[j * 2] + ox, pts[j * 2 + 1] + oy, per * (0.7 + this.rand() * 0.6), (s.id * 3 + j) % 12);
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
    const ai = s.ai, D = DIFF[Math.max(0, Math.min(3, ai.diff))], A = this.botAggro;
    const look = (6 + s.r * 5) * D.look * (0.85 + 0.15 * A);
    let want = null, boost = 0, risky = false;
    if (!this._heads) this._heads = [];
    this._nh = 0; const lr2 = (look * 1.6 + 6) ** 2;
    let near = null, nd = 1e9;
    for (const o of this.snakes) if (o !== s && o.alive) {
      const dx = o.x - s.x, dy = o.y - s.y, d2 = dx * dx + dy * dy;
      if (d2 < lr2) { const H = this._heads[this._nh] || (this._heads[this._nh] = {}); H.x = o.x; H.y = o.y; H.a = o.a; H.v = o.boosting ? C.BOOST : C.SPEED; H.r = o.r; this._nh++; }
      if (!o.god && !(this.teams && o.team === s.team) && d2 < nd) { nd = d2; near = o; }
    }
    nd = Math.sqrt(nd);
    // scripted prey (boss / survival hunters)
    const prey = ai.prey ? this.byId.get(ai.prey) : null;
    if (prey && prey.alive) { const lead = 3 + Math.hypot(prey.x - s.x, prey.y - s.y) * 0.35; want = Math.atan2(prey.y + Math.sin(prey.a) * lead - s.y, prey.x + Math.cos(prey.a) * lead - s.x); ai.mode = 3; boost = this.rand() < D.boost * 0.5 && s.m > 40 ? 1 : 0; risky = true; }
    // power-ups are worth a detour
    if (want === null && this.pus.length) { let bp = null, bd = 12 + D.hunt * 8; for (const p of this.pus) { const d = Math.hypot(p.x - s.x, p.y - s.y); if (d < bd) { bd = d; bp = p; } } if (bp) { want = Math.atan2(bp.y - s.y, bp.x - s.x); ai.mode = 6; boost = bd > 12 && s.m > 45 && this.rand() < D.boost ? 1 : 0; } }
    if (want === null && this.zone) { const z = this.zone, dz = Math.hypot(s.x - z.x, s.y - z.y); if (dz > z.r * 0.78) { want = Math.atan2(z.y - s.y, z.x - s.x); ai.mode = 4; boost = dz > z.r && s.m > 30 ? 1 : 0; } }
    if (want === null && this.attractPt && this.rand() < this.attractPt.w) { const Ap = this.attractPt, da = Math.hypot(s.x - Ap.x, s.y - Ap.y); if (da > Ap.r * 0.55) { want = Math.atan2(Ap.y - s.y, Ap.x - s.x) + (this.rand() - 0.5) * 0.5; ai.mode = 5; } }
    // aggression, slither-style: keep committing to an attack for a while once started
    const range = 22 + s.r * 6 + D.hunt * 14;
    if (want === null && near && nd < range && (ai.mode === 3 && ai.commit > 0 || this.rand() < (0.04 + D.hunt * 0.4) * A * Math.min(1, 3 / (1 + this._nh)) * Math.min(1.4, 11 / (this.nAlive || 11)))) {
      const o = near; ai.commit = ai.mode === 3 ? (ai.commit || 0) - 1 : 6 + ((this.rand() * 8) | 0); ai.mode = 3; risky = true;
      const big = s.m > o.m * 2.2 && s.len > nd * 2.5;
      const ca = Math.cos(o.a), sa = Math.sin(o.a);
      const rel = (s.x - o.x) * ca + (s.y - o.y) * sa; // >0: we are ahead of its head
      if (big && D.hunt > 0.3) { // encircle: orbit the smaller snake, tightening
        const ang = Math.atan2(o.y - s.y, o.x - s.x); const side = ai.side || (ai.side = this.rand() < 0.5 ? 1 : -1);
        const rad = Math.max(4, s.len / 6.283 * 0.75); want = ang + side * (nd > rad ? 1.05 : 1.6); boost = 0;
      } else { // cut off: race to a point ahead of its head, crossing its path from our side
        const lead = 5 + nd * (0.55 + D.hunt * 0.3) + o.r * 3;
        const px = -sa, py = ca, sd = ((s.x - o.x) * px + (s.y - o.y) * py) >= 0 ? 1 : -1; // which side of its path we are on
        const cross = rel > 0 ? -sd * (2 + s.r * 2) : 0; // once ahead, swing across its nose
        const tx = o.x + ca * lead + px * cross, ty = o.y + sa * lead + py * cross;
        want = Math.atan2(ty - s.y, tx - s.x);
        boost = s.m > 32 && this.rand() < D.boost * 1.1 && nd < range * 0.8 ? 1 : 0;
      }
    } else if (ai.mode === 3 && want === null) ai.mode = 0;
    // feed: best value/distance food in range, preferring what lies ahead (corpse orbs are big and pull bots into fights)
    if (want === null) {
      const fg = this.fgrid, rad = 3 + (D.hunt > 0.5 ? 1 : 0), c0 = fg.ci(s.x, s.y), dim = fg.dim; let bf = -1, bs = 0;
      for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= fg.head.length) continue; let j = fg.head[c];
        while (j >= 0) { const dx = fg.x[j] - s.x, dy = fg.y[j] - s.y, d = Math.sqrt(dx * dx + dy * dy) + 1; const fwd = (dx * Math.cos(s.a) + dy * Math.sin(s.a)) / d; const sc = fg.r[j] * fg.r[j] / d * (1.4 + fwd); if (sc > bs) { bs = sc; bf = j; } j = fg.next[j]; }
      }
      if (bf >= 0) { want = Math.atan2(fg.y[bf] - s.y, fg.x[bf] - s.x); ai.mode = 1; if (fg.r[bf] > 3.5 && this.rand() < D.boost && s.m > 45) { boost = 1; risky = true; } }
    }
    // wander, drifting back toward the centre when far out
    if (want === null) {
      if (Math.hypot(s.x, s.y) > this.R * 0.7) ai.wa = Math.atan2(-s.y, -s.x) + (this.rand() - 0.5);
      else ai.wa += (this.rand() - 0.5) * 0.9;
      want = ai.wa; ai.mode = 0;
    }
    // safety: the path toward `want` (and straight ahead) must be clear, else take the clearest ray.
    // Attackers accept more risk (short look), and every bot sometimes misjudges -> real deaths, like real players.
    const slip = D.err * (risky ? 8 : 1) * A * Math.min(1.3, 3.2 / (1.5 + this._nh)) * Math.min(1.4, 11 / (this.nAlive || 11));
    ai.slip = 1; if (this.rand() > slip) {
      ai.slip = 0; const lk = risky ? look * Math.min(1, 0.4 + 0.2 * D.look + 0.07 * this._nh) : look;
      const dw = this.rayDanger(s, want, lk), da = this.rayDanger(s, s.a, lk * 0.7);
      if (dw > 0 || da > 0) {
        let bestA = want, bestS = -1e9;
        for (let k = -6; k <= 6; k++) {
          const ang = s.a + k * 0.33, dn = this.rayDanger(s, ang, lk);
          const sc = -dn * 10 - Math.abs(angDiff(ang, want)) * 0.8 - Math.abs(k) * 0.2;
          if (sc > bestS) { bestS = sc; bestA = ang; }
        }
        want = bestA; boost = (da >= 12 && D.boost > 0.5 && s.m > 40) ? 1 : risky ? boost : 0; if (!risky) ai.mode = 2;
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
    const reactScale = (1 / 60) / dt; let na = 0; for (const s of this.snakes) if (s.alive) na++; this.nAlive = na;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const P = s.pu; for (let q = 0; q < 6; q++) if (P[q] > 0) P[q] = Math.max(0, P[q] - dt); if (s.slow > 0) s.slow = Math.max(0, s.slow - dt); if (s.inv > 0) s.inv = Math.max(0, s.inv - dt);
      if (s.bot) { if ((this.tick + s.id) % 3 === 0 && s.ai.t > 1) this.botReflex(s); if (--s.ai.t <= 0) { this.botThink(s); const D = DIFF[Math.max(0, Math.min(3, s.ai.diff))]; s.ai.t = Math.max(1, Math.round(D.react * reactScale * (0.7 + this.rand() * 0.6))); } }
      else if (inputs) { const inp = inputs(s); if (inp === false) continue; }
      const canBoost = s.m > C.MIN_BOOST_M;
      moveSnake(s, dt, canBoost);
      if (s.boosting && !(s.pu[2] > 0)) {
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
    if (this.zone) { const z = this.zone; for (const s of this.snakes) { if (!s.alive || s.god) continue; const dx = s.x - z.x, dy = s.y - z.y; if (dx * dx + dy * dy > z.r * z.r) { s.storm = (s.storm || 0) + dt; s.setMass(s.m - (2.5 + s.m * 0.07) * dt * (z.dmg || 1)); if (s.m < 10) this.kill(s, 0, 3); } else s.storm = 0; } }
    this.buildGrid();
    this.collide();
    this.eat();
    if (this.powerups) this.puStep();
    // keep the world fed
    let need = this.foodTarget - this.fCount, sp = 0;
    while (need-- > 0 && sp++ < 6) { const [x, y] = this.randPos(this.R - 3); this.spawnFood(x, y, 1 + (this.rand() * 2.2) | 0, (this.rand() * 12) | 0); }
  }
  puStep() {
    if (this.pus.length < this.puTarget && --this.puNext <= 0) { this.spawnPu(); this.puNext = Math.round((4 + this.rand() * 4) / this.dt); }
    // keep the field around every human player lively: ~puNear pickups within view (r 26), topped up twice a second
    if (this.puNear > 0 && this.tick % Math.max(1, Math.round(0.5 / this.dt)) === 0 && this.pus.length < this.puCap) {
      for (const s of this.snakes) {
        if (!s.alive || s.bot) continue; let n = 0; for (const p of this.pus) { const dx = p.x - s.x, dy = (p.y - s.y) / 0.55; if (dx * dx + dy * dy < 26 * 26) n++; } // landscape-shaped view
        for (let add = Math.min(2, this.puNear - n); add > 0; add--) { const a = this.rand() * TAU, d = 8 + this.rand() * 16; let x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d * 0.5; const L = Math.hypot(x, y), lim = this.R * 0.92; if (L > lim) { x *= lim / L; y *= lim / L; } const p = this.spawnPu(undefined, x, y); p.life = 35; }
      }
    }
    for (let i = this.pus.length - 1; i >= 0; i--) {
      const p = this.pus[i];
      if (this.tick - p.b > (p.life || 75) / this.dt) { this.pus.splice(i, 1); this.evPu.push(p, 0, null); continue; } // expires after 75 s
      for (const s of this.snakes) {
        if (!s.alive) continue; const dx = p.x - s.x, dy = p.y - s.y, rr = s.r * HEAD_K + 1.5;
        if (dx * dx + dy * dy < rr * rr) { this.pus.splice(i, 1); const hit = this.applyPu(s, p.k); this.evPu.push(p, s.id, hit); break; }
      }
    }
  }
  fixHead(s) { s.px[s.h] = s.x; s.py[s.h] = s.y; }

  buildGrid() {
    const g = this.grid; g.clear(); const pts = this.tmp;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const sp = sampleSp(s.r), n = bodyPoints(s, 0, 0, sp, s.len, pts, 590), L = Math.max(sp, (n - 1) * sp);
      g.add(pts[0], pts[1], s.r * HEAD_K, s.id, 0);
      for (let j = 1; j < n; j++) g.add(pts[j * 2], pts[j * 2 + 1], s.r * taperAt(j * sp / L), s.id, j);
    }
    const f = this.fgrid; f.clear();
    for (let i = 0; i < this.FM; i++) if (this.fa[i]) f.add(this.fx[i], this.fy[i], this.fv[i], i, 0);
  }

  // head (disc r*HEAD_K) vs every other snake's body discs (heads included -> head-on kills both). Contact = rendered edges touch.
  // Body crossing body is harmless (only heads are tested). Ghost = pass through bodies; shield absorbs one hit.
  collide() {
    const g = this.grid, dim = g.dim;
    for (const s of this.snakes) {
      if (!s.alive || s.god) continue;
      if (s.pu[4] > 0 || s.inv > 0) continue;
      const hr = s.r * HEAD_K, c0 = g.ci(s.x, s.y); let killer = 0;
      const rx = Math.max(1, Math.ceil((hr + 6.6) / g.cell));
      for (let oy = -rx; oy <= rx && !killer; oy++) for (let ox = -rx; ox <= rx && !killer; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= g.head.length) continue; let j = g.head[c];
        while (j >= 0) {
          if (g.o[j] !== s.id) { const dx = g.x[j] - s.x, dy = g.y[j] - s.y, rr = (g.r[j] + hr) * HIT_K; if (dx * dx + dy * dy < rr * rr) { const o = this.byId.get(g.o[j]); if (this.teams && o && o.team === s.team) { j = g.next[j]; continue; } killer = g.o[j]; this.lastHitSeg = g.k[j]; break; } }
          j = g.next[j];
        }
      }
      if (killer) { const k = this.byId.get(killer); if (k && k.god && !k.boss) continue;
        if (s.pu[1] > 0) { s.pu[1] = 0; s.inv = 1.2; this.evShield.push(s.id, killer); continue; }
        this.kill(s, killer, 2); }
    }
  }
  // exported so the client can run the same test against what it renders (instant self-reported death)
  static hitTest(hx, hy, hr, others, tmp) {
    const H = hr * HEAD_K;
    for (const o of others) {
      if (!o.alive) continue; const sp = sampleSp(o.r), n = bodyPoints(o, o._ro || 0, o._rf || 0, sp, o.len, tmp, 590), L = Math.max(sp, (n - 1) * sp);
      const qx = tmp[0] - hx, qy = tmp[1] - hy; if (qx * qx + qy * qy > (o.len + H + 8) ** 2) continue;
      for (let j = 0; j < n; j++) { const rb = j ? o.r * taperAt(j * sp / L) : o.r * HEAD_K, rr = (rb + H) * HIT_K; const dx = tmp[j * 2] - hx, dy = tmp[j * 2 + 1] - hy; if (dx * dx + dy * dy < rr * rr) return o.id; }
    }
    return 0;
  }

  eat() {
    const f = this.fgrid, dim = f.dim;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const mag = s.pu[0] > 0, reach = mag ? s.r + 7.5 : s.r + 0.9, x2 = s.pu[3] > 0 ? 2 : 1, c0 = f.ci(s.x, s.y), rx = Math.ceil(reach / f.cell);
      for (let oy = -rx; oy <= rx; oy++) for (let ox = -rx; ox <= rx; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= f.head.length) continue; let j = f.head[c];
        while (j >= 0) {
          const i = f.o[j];
          if (this.fa[i]) { const dx = this.fx[i] - s.x, dy = this.fy[i] - s.y; const d2 = dx * dx + dy * dy; if (d2 < reach * reach) { s.setMass(s.m + this.fv[i] * x2); s.foodEaten++; this.removeFood(i, s.id); } }
          j = f.next[j];
        }
      }
    }
  }
  drain() { this.evPu.length = 0; this.evPuNew.length = 0; this.evShield.length = 0; this.evEat.length = 0; this.evSpawn.length = 0; this.evDie.length = 0; this.evNew.length = 0; }
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
  if (typeof d.av === "string" && /^(p([0-9]|1[0-5])|f\d{1,3})$/.test(d.av)) o.av = d.av; o.fr = Math.max(0, Math.min(6, d.fr | 0)); // profile avatar + frame (HUD rows)
  return o;
}
export const cleanName = (n) => String(n || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16) || "Guest";
