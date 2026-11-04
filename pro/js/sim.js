// Super Snake Pro — shared simulation core.
// Runs unchanged in the browser (offline modes, client prediction) and in the Cloudflare Durable Object (online rooms).
// No DOM, no allocation in the hot loop: typed-array ring buffers for paths, a spatial hash rebuilt per tick, pooled food.

export const C = {
  R: 240, // arena radius (world units): online rooms + default; offline modes set their own
  SPEED: 8.6, BOOST: 17.5,
  TURN: 6.2, // max turn rate (rad/s) for the smallest snake (fix1: 4.6 -> 6.2, high-precision steering)
  ANG_ACC: 140, // angular acceleration (rad/s²) = turn inertia (fix1: 34 -> 140: no lag, no wobble)
  TURN_GAIN: 30, // heading error -> turn rate gain (fix1: 9 -> 30: small corrections land in ~2 ticks)
  START_M: 24, MIN_BOOST_M: 18, BOOST_COST: 5.5, // mass per second while boosting
  FOOD_TARGET: 620, FOOD_MAX: 1300,
  CAP: 2048, // path ring capacity (samples, one per tick)
  CELL: 4, MAXSEG: 60000,
};
export const MASK = C.CAP - 1;
// long1: snakes grow LONG, not fat. Length ~ m^0.8 (was sqrt: 24->43 mass gave only +24% length); radius grows ~30% slower.
// Start size unchanged (m=24: len 16.0, r 0.718). Cap 200 stays inside the 2048-sample path ring at normal speed (293 units).
export const radiusOf = (m) => Math.min(2.6, 0.6 + 0.024 * Math.sqrt(m));
export const lengthOf = (m) => Math.min(200, 16 * Math.pow(m / 24, 0.8));
export const turnOf = (r) => C.TURN / (1 + Math.max(0, r - 0.6) * 0.6);
// noself1 (fairness): bots steer with exactly the player's physics (turnOf, TURN_GAIN, ANG_ACC); fix1 had left bots on the old, slower response.
export const boostCost = (m, dt) => C.BOOST_COST * (1 + m / 1500) * dt;
// ---- body shape shared by collision AND both renderers (gfx/snake.js mirrors these numbers in GLSL) ----
// half-width of the body at fraction u (0 = head, 1 = tail tip) is r * taperAt(u); the head is a disc of r * HEAD_K.
export const HEAD_K = 1.12;
export const HIT_K = 0.98; // contact = edges touch (2% slack for the polyline sagitta between samples)
export const taperAt = (u) => { const t = Math.max(0, Math.min(1, (u - 0.58) / 0.42)); return 1 - 0.74 * t * t * (3 - 2 * t); };
export const sampleSp = (r) => Math.max(0.3, r * 0.4); // collision sample spacing: no visible gaps between discs
// noself1: candy is drawn 1.4x bigger than candy1 (CANDY_SCALE, used by gfx/candy.js too) and the pickup radius follows the
// drawing: a food is eaten as soon as its visible outline touches the visible head disc (r * HEAD_K). foodVisR(v) = outer edge
// of the largest 2D candy sprite (2D candy is drawn larger than 3D, so it bounds both). Gold Rush coins keep COIN_VIS.
// Mirrors gfx/candy.js candyBig / candySize2 * SPR_K * 1.09 (measured sprite extent); test/noself1.test.mjs checks they agree.
// noself1 head-on: true = snake a (relative depth da, mass ma, id ia) dies, false = it survives (b dies instead)
export const headOnLoses = (da, ma, ia, db, mb, ib) => { if (Math.abs(da - db) > 1e-6) return da > db; if (ma !== mb) return ma < mb; return ia > ib; };
export const CANDY_SCALE = 1.4, FOOD_EDGE = 1.35 * 1.09, COIN_VIS = 0.95, FOOD_VIS_MAX = 1.25 * 1.4 * 1.35 * 1.09;
export const foodBig = (v) => v >= 4 || (v !== (v | 0) && v !== 1.5);
export const foodVisR = (v) => { const s = (0.15 + Math.sqrt(v) * 0.1) * 2.2 * CANDY_SCALE; return (foodBig(v) ? Math.min(1.25 * CANDY_SCALE, Math.max(0.82 * CANDY_SCALE, s * 1.3)) : s) * FOOD_EDGE; };
// noself1: ambient food spawns in clusters of 6..14 candies (loose blob 3..6 head widths across); <= ~8% stays as sparse singles.
// A cluster whose food is mostly gone (< 25% left) is retired; its leftovers count as singles and a new cluster spawns elsewhere.
export const CL_MIN = 6, CL_MAX = 14, CL_SINGLE = 0.07, CL_RETIRE = 0.25;
// power-ups: magnet, shield, speed, x2 score, (4 retired: ghost), freeze, mega-orb burst, dash, (8 retired: invisibility), giant, food rain
// fix1: ghost and invisibility removed for good (never spawn, no effect if an old peer sends them); their slots stay so kind ids keep their meaning online.
export const PU = { MAG: 0, SHIELD: 1, SPEED: 2, X2: 3, GHOST: 4, FREEZE: 5, MEGA: 6, DASH: 7, INVIS: 8, GIANT: 9, RAIN: 10, N: 11 };
export const PU_DUR = [6, 20, 6, 12, 0, 4, 0, 1.6, 0, 10, 0];
export const PU_TIMED = [0, 1, 2, 3, 5, 7, 9]; // kinds with a countdown (HUD chips)
const PU_W = [25, 13, 13, 13, 0, 10, 7, 9, 0, 8, 7]; // spawn weights (fix1: magnet 15 + ghost's 10; ghost/invisibility 0 = never)
export const PU_RETIRED = (k) => k === 4 || k === 8;
export const MAG_K = 2.5; // magnet: food within MAG_K x head radius (min r + 2.2) is pulled into the mouth
export const magReach = (r) => Math.max(MAG_K * HEAD_K * r, r + 2.2);
export const PU_ICON = ["🧲", "🛡", "⚡", "×2", "👻", "❄", "💎", "💨", "◌", "⬆", "☔"];
export const GIANT_K = 1.6, DASH_V = 1.55; // giant radius multiplier, dash speed (× boost)
// tick a snake's power-up timers; giant mode ends cleanly (radius back to normal)
export function puTick(s, dt) { const P = s.pu; for (let i = 0; i < PU_TIMED.length; i++) { const q = PU_TIMED[i]; if (P[q] > 0) { P[q] -= dt; if (P[q] <= 0) { P[q] = 0; if (q === 9) { s.gk = 1; s.setMass(s.m); } } } } if (s.slow > 0) s.slow = Math.max(0, s.slow - dt); if (s.inv > 0) s.inv = Math.max(0, s.inv - dt); }
// start a timed power-up on a snake (shared by the sim, the online client and its mirrors)
export function puGive(s, k) { if (PU_RETIRED(k)) return; if (PU_DUR[k] > 0) s.pu[k] = PU_DUR[k]; if (k === 9) { s.gk = GIANT_K; s.setMass(s.m); } }
// 24x24 vector glyphs (no emoji-font dependency): used by the HUD chips (inline SVG) and the 3D badges (Path2D)
export const PU_SVG = [
  "M6 3h4v9a2 2 0 0 0 4 0V3h4v9a6 6 0 0 1-12 0Z", // magnet
  "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5Z", // shield
  "M13 2 4 14h7l-1 8 9-12h-7Z", // speed bolt
  "M3 7h3l2.5 3.5L11 7h3l-4 5 4 5h-3l-2.5-3.5L6 17H3l4-5Zm12.5 3.2c0-2 1.6-3.2 3.3-3.2 1.8 0 3.2 1.2 3.2 3 0 1.4-.8 2.3-2.2 3.5L18.6 15H22v2h-6.6v-1.7l3.4-3c.9-.8 1.2-1.3 1.2-2 0-.7-.5-1.2-1.2-1.2-.8 0-1.3.6-1.3 1.3Z", // x2
  "M12 2a7 7 0 0 0-7 7v13l2.3-2 2.4 2 2.3-2 2.3 2 2.4-2L19 22V9a7 7 0 0 0-7-7Zm-2.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z", // ghost
  "M11 1h2v5.3l2.6-2.6 1.4 1.4L13 9.1V11h1.9l4-4 1.4 1.4-2.6 2.6H23v2h-5.3l2.6 2.6-1.4 1.4-4-4H13v1.9l4 4-1.4 1.4-2.6-2.6V23h-2v-5.3l-2.6 2.6L7 18.9l4-4V13H9.1l-4 4-1.4-1.4L6.3 13H1v-2h5.3L3.7 8.4 5.1 7l4 4H11V9.1l-4-4 1.4-1.4L11 6.3Z", // snowflake
  "M6 3h12l4 6-10 13L2 9Zm1.2 2L4.6 8.6h4.6L11 5Zm9.6 0H13l1.8 3.6h4.6Z", // diamond
  "M2 5h3.5l7 7-7 7H2l7-7Zm9 0h3.5l7 7-7 7H11l7-7Z", // dash (double chevron)
  "M12 5c5 0 9 4.4 10 7-1 2.6-5 7-10 7S3 14.6 2 12c1-2.6 5-7 10-7Zm0 3.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6ZM3.4 2 22 20.6 20.6 22 2 3.4Z", // invisible (eye, slashed)
  "M3 3h7v2.4H7.1l4.1 4.1-1.7 1.7-4.1-4.1V10H3Zm18 18h-7v-2.4h2.9l-4.1-4.1 1.7-1.7 4.1 4.1V14H21ZM14 3h7v7h-2.4V7.1l-4.1 4.1-1.7-1.7 4.1-4.1H14ZM3 14h2.4v2.9l4.1-4.1 1.7 1.7-4.1 4.1H10V21H3Z", // giant (expand)
  "M7 14a4.5 4.5 0 0 1 .4-9A6 6 0 0 1 18.6 6.5 3.8 3.8 0 0 1 18 14Zm.5 2h2l-1.6 5.5h-2Zm5 0h2l-1.6 5.5h-2Zm5 0h2l-1.6 5.5h-2Z", // food rain (cloud + drops)
];
export const PU_COL = ["#d49ab6", "#4fc3ff", "#ffe14f", "#ffa13d", "#c6b8ff", "#9ff3ff", "#5dffb0", "#00ffd5", "#eef2ff", "#ff5a36", "#c3ff3d"];
// arena events: golden food rain, meteor shower (warned impact circles), golden bounty bot
export const EVENTS = ["rain", "drops", "bounty"]; // drops1: meteor shower removed -> power-up drops
export const GOLD_FC = 12; // food colour index 12 = gold (both palettes carry it)
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
    this.lastA = a; this.pu = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; this.slow = 0; this.inv = 0; this.gk = 1; this.rainT = 0; this.bounty = false;
    // seed a straight tail behind the head so the body exists from frame one
    const step = 0.15; const k = Math.ceil(this.len / step) + 2;
    for (let i = k; i >= 0; i--) this.push(x - Math.cos(a) * i * step, y - Math.sin(a) * i * step);
  }
  push(x, y) { this.h = (this.h + 1) & MASK; this.px[this.h] = x; this.py[this.h] = y; if (this.n < C.CAP) this.n++; }
  // sample i back from the newest (0 = head)
  sx(i) { return this.px[(this.h - i) & MASK]; }
  sy(i) { return this.py[(this.h - i) & MASK]; }
  setMass(m) { this.m = m; this.r = radiusOf(m) * (this.rk || 1) * (this.gk || 1); this.len = lengthOf(m) * (this.lk || 1); if (m > this.best) this.best = m; }
}

// Move one snake one tick: turn with inertia toward ta, advance, record a path sample. Deterministic given (state, ta, boost, dt).
export function moveSnake(s, dt, canBoost) {
  const tm = turnOf(s.r), d = angDiff(s.ta, s.a);
  const want = Math.max(-tm, Math.min(tm, d * C.TURN_GAIN));
  const acc = C.ANG_ACC * dt;
  s.av += Math.max(-acc, Math.min(acc, want - s.av));
  if (Math.abs(s.av * dt) > Math.abs(d) && Math.sign(s.av) === Math.sign(d)) s.av = d / dt; // no overshoot
  s.lastA = s.a;
  s.a += s.av * dt; if (s.a > Math.PI) s.a -= TAU; else if (s.a < -Math.PI) s.a += TAU;
  const dash = s.pu && s.pu[7] > 0, free = s.pu && (s.pu[2] > 0 || dash); // speed power-up / dash = free boost
  s.boosting = (!!s.boost && canBoost) || free;
  const v = (s.boosting ? C.BOOST : C.SPEED) * (dash ? DASH_V : 1) * (s.vk || 1) * (s.slow > 0 ? 0.55 : 1);
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
    this.fcl = new Int32Array(FM); this.clu = new Map(); this.cluSeq = 0; this.singles = 0; this.ambN = 0; // noself1: ambient cluster id per food (0 = not ambient, -2 = single)
    // events since last drain (for net + effects); plain arrays reused
    this.evEat = []; this.evSpawn = []; this.evDie = []; this.evNew = [];
    this.tmp = new Float32Array(1200);
    this.walls = opt.walls !== false; this.diff = opt.diff ?? 1; this.botAggro = 1;
    this.netMode = !!opt.netMode;
    // power-ups on the field: {id,k,x,y,b(born tick)}. evPu = (pu, takerId|0 for expiry, frozenIds) triples; evShield = (snakeId, hitById) pairs
    this.powerups = opt.powerups !== false; this.pus = []; this.puSeq = 1; this.evPu = []; this.evPuNew = []; this.evShield = [];
    this.puTarget = opt.puTarget ?? Math.max(3, Math.round(3.2 * (this.R / 130) ** 2)); this.puNext = 60; this.puNear = opt.puNear ?? 3; this.puCap = 60; // calm field: ~3 pickups in view
    this.PU_GAP = 11; // minimum spacing between pickups
    if (this.powerups) for (let i = 0; i < Math.ceil(this.puTarget * 0.6); i++) this.spawnPu();
    // arena events (opt.events = list of allowed kinds). evEvt = {k, ph, ...} announcements, evMet = new meteors, evImpact = impacts
    this.events = Array.isArray(opt.events) ? opt.events.filter((k) => EVENTS.includes(k)) : opt.events === true ? EVENTS.slice() : [];
    this.evt = null; this.evtNext = opt.evtFirst ?? 40; this.evtLast = ""; this.mets = []; this.feasts = []; this.metSeq = 1; this.evEvt = []; this.evMet = []; this.evImpact = []; this.bountyId = 0;
    this.feed(true);
  }
  randPos(rr) { const a = this.rand() * TAU, d = Math.sqrt(this.rand()) * rr; return [Math.cos(a) * d, Math.sin(a) * d]; }
  spawnFood(x, y, v, c) {
    if (!this.fFree.length) return -1;
    const i = this.fFree.pop(); this.fx[i] = x; this.fy[i] = y; this.fv[i] = v; this.fc[i] = c; this.fa[i] = 1; this.fCount++; this.fcl[i] = 0;
    this.fid[i] = this.fSeq; this.fSeq = (this.fSeq % 65000) + 1; this.fBorn[i] = this.tick;
    this.evSpawn.push(i); return i;
  }
  removeFood(i, by) { if (!this.fa[i]) return; this.fa[i] = 0; this.fCount--; this.fFree.push(i); this.evEat.push(i, by); this._unclu(i); }
  _unclu(i) { const id = this.fcl[i]; if (!id) return; this.fcl[i] = 0; this.ambN--; if (id === -2) { this.singles--; return; } const q = this.clu.get(id); if (!q) { this.singles--; return; } // leftover of a retired cluster = single
    if (--q.n < q.n0 * CL_RETIRE) { this.clu.delete(id); this.singles += q.n; } }

  addSnake(name, skin, opt = {}) {
    const s = new Snake(this.nextId++); s.name = name; s.skin = skin;
    const [x, y] = opt.pos || this.safeSpawn(); const a = Math.atan2(-y, -x) + (this.rand() - 0.5) * 1.2;
    s.reset(x, y, a, opt.m || C.START_M); s.bornTick = this.tick; s.bot = !!opt.bot; s.god = !!opt.god;
    if (s.bot) s.ai = { t: 0, mode: 0, tgt: 0, wa: a, diff: opt.diff ?? this.diff, err: 0, per: s.id % 3 }; // ai1: 0 fighter, 1 trickster, 2 builder
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
    if (k === undefined) { let w = 0; for (const x of PU_W) w += x; let r = this.rand() * w; k = 0; while (k < PU_W.length - 1 && (r -= PU_W[k]) >= 0) k++; }
    if (x === undefined) { for (let tr = 0; tr < 8; tr++) { [x, y] = this.randPos(this.R * 0.85); if (this.puFree(x, y)) break; } }
    if (PU_RETIRED(k)) k = PU.MAG; const p = { id: this.puSeq = (this.puSeq % 60000) + 1, k, x, y, b: this.tick }; this.pus.push(p); this.evPuNew.push(p); return p;
  }
  puFree(x, y) { const g2 = this.PU_GAP * this.PU_GAP; for (const p of this.pus) { const dx = p.x - x, dy = p.y - y; if (dx * dx + dy * dy < g2) return false; } return true; }
  // apply a picked power-up to snake s; returns ids of snakes it froze
  applyPu(s, k) {
    const hit = [];
    if (k === PU.MEGA) { for (let i = 0; i < 26; i++) { const a = i / 26 * TAU + this.rand() * 0.2, d = 3 + this.rand() * 9; if (this.fCount < this.FM - 60) this.spawnFood(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 4 + this.rand() * 4, (i * 5) % 12); } }
    else if (k === PU.FREEZE) { for (const o of this.snakes) if (o !== s && o.alive && !o.god && !(this.teams && o.team === s.team)) { const dx = o.x - s.x, dy = o.y - s.y; if (dx * dx + dy * dy < 34 * 34) { o.slow = PU_DUR[5]; hit.push(o.id); } } }
    else if (k === PU.RAIN) s.rainT = 2.2; // orbs fall around the head for ~2 s (see step)
    else puGive(s, k);
    return hit;
  }
  removeSnake(s) { const i = this.snakes.indexOf(s); if (i >= 0) this.snakes.splice(i, 1); this.byId.delete(s.id); }

  kill(s, killerId, cause) {
    if (!s.alive) return; s.alive = false; s.diedTick = this.tick; s.killedBy = killerId || 0;
    const k = killerId ? this.byId.get(killerId) : null; if (k && k !== s) k.kills++;
    // body becomes food (≈55% of mass), spread along the corpse
    const pts = this.tmp, sp = Math.max(0.9, s.r * 0.9), n = bodyPoints(s, 0, 0, sp, s.len, pts, 590);
    const per = Math.max(1, Math.min(14, (s.m * 0.55) / n));
    for (let j = 0; j < n; j++) {
      const ox = (this.rand() - 0.5) * s.r * 1.4, oy = (this.rand() - 0.5) * s.r * 1.4;
      if (this.fCount < this.FM - 60) this.spawnFood(pts[j * 2] + ox, pts[j * 2 + 1] + oy, per * (0.7 + this.rand() * 0.6), (s.id * 3 + j) % 12);
    }
    if (s.bounty) { s.bounty = false; this.bountyId = 0; // the golden bounty drops a pile of gold and announces who claimed it
      for (let j = 0; j < 36; j++) { const a = this.rand() * TAU, d = 1 + this.rand() * 7; if (this.fCount < this.FM - 60) this.spawnFood(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 5 + this.rand() * 3, GOLD_FC); }
      this.evEvt.push({ k: "bounty", ph: "claim", id: s.id, by: k && k !== s ? k.id : 0 }); if (this.evt && this.evt.k === "bounty") { this.evt = null; this.evtNext = 55 + this.rand() * 30; } }
    // feast1: remember where the body fell (head, middle, tail) so nearby bots race to eat it
    if (n > 0 && s.m > 14) { const F = this.feasts, mid = (n >> 1) * 2, tl = (n - 1) * 2; F.push({ x: pts[0], y: pts[1], m: s.m, t: this.tick, id: s.id }, { x: pts[mid], y: pts[mid + 1], m: s.m, t: this.tick, id: s.id }, { x: pts[tl], y: pts[tl + 1], m: s.m, t: this.tick, id: s.id }); if (F.length > 18) F.splice(0, F.length - 18); }
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
      for (let mi = 0; mi < this.mets.length; mi++) { const M = this.mets[mi]; if (M.t < 2.2) { const ex = M.x - qx, ey = M.y - qy, rr = M.r + s.r + 1; if (ex * ex + ey * ey < rr * rr) return (6 - st) * 3; } }
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
    // feast1: a snake died nearby -> rush to its body before the food is gone (the bigger the corpse, the farther they come)
    if (want === null && this.feasts.length && !(ai.mode === 3 && ai.commit > 0)) { let bf = null, bs = 0;
      for (let i = this.feasts.length - 1; i >= 0; i--) { const F = this.feasts[i]; if (this.tick - F.t > (7 + Math.min(6, F.m / 60)) / this.dt) { this.feasts.splice(i, 1); continue; }
        const d = Math.hypot(F.x - s.x, F.y - s.y), reach = 45 + s.r * 8 + Math.min(60, F.m * 0.25) + D.hunt * 25; if (d > reach || d < 6) continue; if (F.cl && F.cl.length >= 3 + Math.min(3, F.m / 90) && !F.cl.includes(s.id)) continue; const sc = F.m / (d + 8); if (sc > bs) { bs = sc; bf = F; } }
      // challenge: a rival bot racing for the same body gets cut off instead (bots fight over the food)
      if (bf && near && near.bot && !near.boss && nd < 16 + s.r * 3 && this.rand() < (0.2 + D.hunt * 0.35) * A) { ai.mode = 3; ai.commit = 5 + ((this.rand() * 5) | 0); bf = null; }
      if (bf) { (bf.cl || (bf.cl = [])).includes(s.id) || bf.cl.push(s.id); const d = Math.hypot(bf.x - s.x, bf.y - s.y); want = Math.atan2(bf.y - s.y, bf.x - s.x); ai.mode = 7; boost = d > 14 && s.m > 30 && this.rand() < D.boost * 1.2 ? 1 : 0; } }
    // aggression, slither-style: keep committing to an attack for a while once started
    const range = 22 + s.r * 6 + D.hunt * 14;
    if (want === null && near && nd < range && (ai.mode === 3 && ai.commit > 0 || this.rand() < (0.04 + D.hunt * 0.4) * A * (near.bot ? 1 : 1.7) * (ai.per === 0 ? 1.35 : ai.per === 2 ? 0.7 : 1) * Math.min(1, 3 / (1 + this._nh)) * Math.min(1.4, 11 / (this.nAlive || 11)))) {
      const o = near; ai.commit = ai.mode === 3 ? (ai.commit || 0) - 1 : 6 + ((this.rand() * 8) | 0); ai.mode = 3; risky = true;
      const big = s.m > o.m * (ai.per === 2 ? 1.6 : 2.2) && s.len > nd * 2.5; // builder coils earlier
      const ca = Math.cos(o.a), sa = Math.sin(o.a);
      const rel = (s.x - o.x) * ca + (s.y - o.y) * sa; // >0: we are ahead of its head
      if (big && D.hunt > 0.3) { // encircle: orbit the smaller snake, tightening
        const ang = Math.atan2(o.y - s.y, o.x - s.x); const side = ai.side || (ai.side = this.rand() < 0.5 ? 1 : -1);
        const rad = Math.max(4, s.len / 6.283 * 0.75); want = ang + side * (nd > rad ? 1.05 : 1.6); boost = 0;
      } else { // cut off: race to a point ahead of its head, crossing its path from our side
        const lead = 5 + nd * (0.55 + D.hunt * 0.3) + o.r * 3;
        const px = -sa, py = ca, sd = ((s.x - o.x) * px + (s.y - o.y) * py) >= 0 ? 1 : -1; // which side of its path we are on
        const cross = rel > 0 ? -sd * (2 + s.r * 2) : ai.per === 1 ? sd * (3 + s.r * 2) : 0; // once ahead, swing across its nose; trickster shadows alongside until then
        const tx = o.x + ca * lead + px * cross, ty = o.y + sa * lead + py * cross;
        want = Math.atan2(ty - s.y, tx - s.x);
        boost = s.m > 32 && this.rand() < D.boost * (ai.per === 1 ? (rel > -2 ? 1.6 : 0.3) : 1.1) && nd < range * 0.8 ? 1 : 0; // trickster: sudden burst once level
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
    const slip = D.err * (risky ? 5 : 0.45) * A * Math.min(1.3, 3.2 / (1.5 + this._nh)) * Math.min(1.4, 11 / (this.nAlive || 11));
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
    const D = DIFF[Math.max(0, Math.min(3, s.ai.diff))]; const look = (4 + s.r * 4) * D.look;
    if (this.rayDanger(s, s.a, look) > 0 || this.rayDanger(s, s.ta ?? s.a, look * 0.8) > 0) s.ai.t = 0; // ai1: also the way it is turning
  }

  // ---- one fixed step ----
  step(inputs) {
    const dt = this.dt; this.tick++;
    const reactScale = (1 / 60) / dt; let na = 0; for (const s of this.snakes) if (s.alive) na++; this.nAlive = na;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      puTick(s, dt);
      if (s.rainT > 0) { s.rainT -= dt; s.rainAcc = (s.rainAcc || 0) + dt * 48; while (s.rainAcc >= 1) { s.rainAcc -= 1; const a = s.a + (this.rand() - 0.5) * 3.2, d = 3 + this.rand() * 16; if (this.fCount < this.FM - 80) this.spawnFood(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 1.6 + this.rand() * 1.8, (this.rand() * 12) | 0); } }
      if (s.bot) { if ((this.tick + s.id) % 3 === 0 && s.ai.t > 1) this.botReflex(s); if (--s.ai.t <= 0) { this.botThink(s); const D = DIFF[Math.max(0, Math.min(3, s.ai.diff))]; s.ai.t = Math.max(1, Math.round(D.react * reactScale * (0.7 + this.rand() * 0.6))); if (s.ai.mode === 2) s.ai.t = Math.min(s.ai.t, Math.round(3 * reactScale)); } }
      else if (inputs) { const inp = inputs(s); if (inp === false) continue; }
      this.moveOne(s, dt);
    }
    if (this.zone) { const z = this.zone; for (const s of this.snakes) { if (!s.alive || s.god) continue; const dx = s.x - z.x, dy = s.y - z.y; if (dx * dx + dy * dy > z.r * z.r) { s.storm = (s.storm || 0) + dt; s.setMass(s.m - (2.5 + s.m * 0.07) * dt * (z.dmg || 1)); if (s.m < 10) this.kill(s, 0, 3); } else s.storm = 0; } }
    this.buildGrid();
    this.collide();
    this.eat();
    if (this.powerups) this.puStep();
    if (this.events.length || this.mets.length) this.eventStep(dt);
    // keep the world fed
    this.feed(false);
  }
  // one move of one snake with its per-move rules: turn + advance, boost cost + boost drop, arena wall
  moveOne(s, dt) {
    const canBoost = s.m > C.MIN_BOOST_M;
    moveSnake(s, dt, canBoost);
    if (s.boosting && !(s.pu[2] > 0) && !(s.pu[7] > 0)) {
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
  // noself1b: the server's catch-up move (a lagging human's extra queued input applied before step) runs the same rules as step:
  // move + boost cost + wall, then body collision and eating for THAT snake at the intermediate position (head-on rule included)
  extraMove(s) {
    if (!s.alive) return; this.moveOne(s, this.dt); if (!s.alive) return;
    this.buildGrid(); this.collide(s); if (s.alive) this.eat(s);
  }
  puStep() {
    if (this.pus.length < this.puTarget && --this.puNext <= 0) { this.spawnPu(); this.puNext = Math.round((4 + this.rand() * 4) / this.dt); }
    // keep a few pickups around every human player: ~puNear within view, one at a time every 2 s, spaced out, never on top of the head
    if (this.puNear > 0 && this.tick % Math.max(1, Math.round(2 / this.dt)) === 0 && this.pus.length < this.puCap) {
      for (const s of this.snakes) {
        if (!s.alive || s.bot) continue; let n = 0; for (const p of this.pus) { const dx = p.x - s.x, dy = (p.y - s.y) / 0.6; if (dx * dx + dy * dy < 30 * 30) n++; } // landscape-shaped view
        if (n >= this.puNear) continue;
        for (let tr = 0; tr < 6; tr++) { const a = s.a + (this.rand() - 0.5) * 3.6, d = 13 + this.rand() * 15; let x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d * 0.6; const L = Math.hypot(x, y), lim = this.R * 0.92; if (L > lim) { x *= lim / L; y *= lim / L; }
          if (!this.puFree(x, y)) continue; const p = this.spawnPu(undefined, x, y); p.life = 35; break; }
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
  // ---- arena events ----
  humansAlive() { const H = this._hum || (this._hum = []); H.length = 0; for (const s of this.snakes) if (s.alive && !s.bot) H.push(s); return H; }
  startEvent(kind) {
    const pool = this.events.filter((k) => k !== this.evtLast); kind = kind || pool[(this.rand() * pool.length) | 0] || this.events[0]; if (!kind) return;
    if (kind === "bounty") { let best = null; for (const s of this.snakes) if (s.alive && s.bot && !s.boss && !s.god && s.m > 40 && (!best || s.m > best.m)) best = s; if (!best) { this.evtNext = 10; return; } best.bounty = true; this.bountyId = best.id; this.evt = { k: kind, t: 45, id: best.id }; this.evEvt.push({ k: kind, ph: "start", id: best.id, d: 45 }); }
    else { this.evt = { k: kind, t: kind === "rain" ? 12 : 14, acc: 0 }; this.evEvt.push({ k: kind, ph: "start", d: this.evt.t }); }
    this.evtLast = kind;
  }
  endEvent() { const e = this.evt; if (!e) return; if (e.k === "bounty") { const b = this.byId.get(e.id); if (b) b.bounty = false; this.bountyId = 0; } this.evEvt.push({ k: e.k, ph: "end", id: e.id || 0 }); this.evt = null; this.evtNext = 50 + this.rand() * 35; }
  eventStep(dt) {
    if (this.events.length && !this.evt) { this.evtNext -= dt; if (this.evtNext <= 0) this.startEvent(); }
    const e = this.evt;
    if (e) {
      e.t -= dt; if (e.t <= 0) this.endEvent();
      else if (e.k === "rain") { e.acc += dt; while (e.acc >= 0.3) { e.acc -= 0.3; // gold orbs land around every player (and a few anywhere); ai1: fewer and wider
          for (const h of this.humansAlive()) for (let q = 0; q < 2; q++) { const a = h.a + (this.rand() - 0.5) * 5, d = 10 + this.rand() * 36; if (this.fCount < this.FM - 80) this.spawnFood(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, 4.5 + this.rand() * 2, GOLD_FC); }
          for (let q = 0; q < 2; q++) { const [x, y] = this.randPos(this.R - 4); if (this.fCount < this.FM - 80) this.spawnFood(x, y, 4.5, GOLD_FC); } } }
      else if (e.k === "drops") { e.acc += dt; while (e.acc >= 1.6) { e.acc -= 1.6; // drops1: power-ups land near every player (never harmful)
          if (this.powerups && this.pus.length < (this.puCap || 40) + 10) for (const h of this.humansAlive()) { for (let tr = 0; tr < 6; tr++) { const a = h.a + (this.rand() - 0.5) * 3, d = 9 + this.rand() * 22, x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d; if (Math.hypot(x, y) < this.R - 6 && this.puFree(x, y)) { this.spawnPu(undefined, x, y).life = 20; break; } } } } }
      else if (e.k === "bounty") { const b = this.byId.get(e.id); if (!b || !b.alive) { this.evt = null; this.evtNext = 50 + this.rand() * 30; } }
    }
    for (let i = this.mets.length - 1; i >= 0; i--) { const M = this.mets[i]; M.t -= dt; if (M.t > 0) continue; this.mets.splice(i, 1); this.impact(M); }
  }
  addMeteor(x, y) { const L = Math.hypot(x, y), lim = this.R - 5; if (L > lim) { x *= lim / L; y *= lim / L; } const M = { id: this.metSeq = (this.metSeq % 60000) + 1, x, y, r: 4.6, t: 1.9, T: 1.9 }; this.mets.push(M); this.evMet.push(M); return M; }
  impact(M) {
    this.evImpact.push(M.x, M.y, M.r);
    for (const s of this.snakes) { if (!s.alive || s.god || s.pu[7] > 0 || s.inv > 0) continue; const dx = s.x - M.x, dy = s.y - M.y, rr = M.r + s.r * HEAD_K;
      if (dx * dx + dy * dy < rr * rr) { if (s.pu[1] > 0) { s.pu[1] = 0; s.inv = 1.2; this.evShield.push(s.id, 0); } else this.kill(s, 0, 6); } }
    for (let j = 0; j < 8; j++) { const a = this.rand() * TAU, d = 1 + this.rand() * M.r; if (this.fCount < this.FM - 60) this.spawnFood(M.x + Math.cos(a) * d, M.y + Math.sin(a) * d, 2 + this.rand() * 2, 9); }
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

  // head (disc r*HEAD_K) vs every other snake's body discs (heads included). Contact = rendered edges touch.
  // Body crossing body is harmless (only heads are tested). Dash = pass through other bodies; shield absorbs one hit.
  // noself1: slither rules for everyone: a snake can NEVER die on its own body (no self-collision, offline or online).
  // noself1 head-on rule: two snakes whose heads are each in the other's discs on the same tick -> only ONE dies: the one
  // whose head went in deeper, depth relative to its own head radius ((rr - d) / (r * HEAD_K)); exact tie -> smaller mass
  // (then the higher id) dies. The survivor gets the kill + the drop. Same rule in Sim.hitTest (client) via headOnLoses().
  collide(only = null) {
    const g = this.grid, dim = g.dim, H = this._hits || (this._hits = new Map()); H.clear();
    for (const s of this.snakes) {
      if (!s.alive || s.god || s.inv > 0 || s.pu[7] > 0) continue;
      const hr = s.r * HEAD_K, c0 = g.ci(s.x, s.y); let killer = 0, best = -1, seg = 0;
      const rx = Math.max(1, Math.ceil((hr + 6.6) / g.cell));
      for (let oy = -rx; oy <= rx; oy++) for (let ox = -rx; ox <= rx; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= g.head.length) continue; let j = g.head[c];
        while (j >= 0) {
          if (g.o[j] !== s.id) { const dx = g.x[j] - s.x, dy = g.y[j] - s.y, rr = (g.r[j] + hr) * HIT_K, d2 = dx * dx + dy * dy;
            if (d2 < rr * rr) { const o = this.byId.get(g.o[j]); if (!(this.teams && o && o.team === s.team) && !(o && o.pu && o.pu[7] > 0)) { /* dash: a dashing snake is harmless to others */ const dep = (rr - Math.sqrt(d2)) / hr; if (dep > best) { best = dep; killer = g.o[j]; seg = g.k[j]; } } } }
          j = g.next[j];
        }
      }
      if (killer) H.set(s.id, { k: killer, dep: best, seg });
    }
    for (const [id, h] of H) {
      const s = this.byId.get(id), k = this.byId.get(h.k); if (!s || !s.alive || !k || k === s || (only && s !== only)) continue;
      const back = H.get(h.k); // mutual contact this tick (head-on, or each head inside the other): only the deeper one dies
      if (back && back.k === id && headOnLoses(h.dep, s.m, s.id, back.dep, k.m, k.id) === false) continue;
      if (k.god && !k.boss) continue;
      if (s.pu[1] > 0) { s.pu[1] = 0; s.inv = 1.2; this.evShield.push(s.id, h.k); continue; }
      this.lastHitSeg = h.seg; this.kill(s, h.k, 2);
    }
  }
  // exported so the client can run the same test against what it renders (instant self-reported death)
  static hitTest(hx, hy, hr, others, tmp, me = null, tmp2 = null) {
    const H = hr * HEAD_K; let id = 0, best = -1, mut = false;
    for (const o of others) {
      if (!o.alive || o === me || (o.pu && o.pu[7] > 0)) continue; /* dash: harmless while active (same as collide) */ const sp = sampleSp(o.r), n = bodyPoints(o, o._ro || 0, o._rf || 0, sp, o.len, tmp, 590), L = Math.max(sp, (n - 1) * sp);
      const qx = tmp[0] - hx, qy = tmp[1] - hy; if (qx * qx + qy * qy > (o.len + H + 8) ** 2) continue;
      let dep = -1; for (let j = 0; j < n; j++) { const rb = j ? o.r * taperAt(j * sp / L) : o.r * HEAD_K, rr = (rb + H) * HIT_K; const dx = tmp[j * 2] - hx, dy = tmp[j * 2 + 1] - hy, d2 = dx * dx + dy * dy; if (d2 < rr * rr) { const e = (rr - Math.sqrt(d2)) / H; if (e > dep) dep = e; } }
      if (dep < 0) continue;
      // noself1 head-on rule (same as collide): when o's head is also inside my body, only the deeper head dies
      let mu = false; if (me) { const od = Sim.headDepth(tmp[0], tmp[1], o.r, me, tmp2 || (Sim._t2 || (Sim._t2 = new Float32Array(1200)))); if (od >= 0) { if (headOnLoses(dep, me.m, me.id, od, o.m, o.id) === false) continue; mu = true; } }
      if (dep > best) { best = dep; id = o.id; mut = mu; }
    }
    Sim.mutual = mut; // the returned hit was a mutual head-on (the other head is inside me too)
    return id;
  }
  // deepest relative depth of a head (hx, hy, radius r*HEAD_K) inside snake t's discs (as rendered at t._ro/_rf); -1 = no contact
  static headDepth(hx, hy, r, t, tmp) {
    const H = r * HEAD_K, sp = sampleSp(t.r), n = bodyPoints(t, t._ro || 0, t._rf || 0, sp, t.len, tmp, 590), L = Math.max(sp, (n - 1) * sp); let dep = -1;
    for (let j = 0; j < n; j++) { const rb = j ? t.r * taperAt(j * sp / L) : t.r * HEAD_K, rr = (rb + H) * HIT_K, dx = tmp[j * 2] - hx, dy = tmp[j * 2 + 1] - hy, d2 = dx * dx + dy * dy; if (d2 < rr * rr) { const e = (rr - Math.sqrt(d2)) / H; if (e > dep) dep = e; } }
    return dep;
  }


  eat(only = null) {
    const f = this.fgrid, dim = f.dim, gold = !!this.goldCoins;
    for (const s of this.snakes) {
      if (!s.alive || (only && s !== only)) continue;
      // noself1: head disc (r * HEAD_K) vs the candy's visible outline; the magnet ring (magReach) reaches the outline too
      const mag = s.pu[0] > 0, hr = mag ? magReach(s.r) : s.r * HEAD_K, x2 = s.pu[3] > 0 ? 2 : 1, c0 = f.ci(s.x, s.y), rx = Math.ceil((hr + FOOD_VIS_MAX) / f.cell);
      for (let oy = -rx; oy <= rx; oy++) for (let ox = -rx; ox <= rx; ox++) {
        const c = c0 + oy * dim + ox; if (c < 0 || c >= f.head.length) continue; let j = f.head[c];
        while (j >= 0) {
          const i = f.o[j];
          if (this.fa[i]) { const dx = this.fx[i] - s.x, dy = this.fy[i] - s.y, d2 = dx * dx + dy * dy, reach = hr + (gold && this.fc[i] === GOLD_FC ? COIN_VIS : foodVisR(this.fv[i])); if (d2 < reach * reach) { s.setMass(s.m + this.fv[i] * x2); s.foodEaten++; this.removeFood(i, s.id); } }
          j = f.next[j];
        }
      }
    }
  }
  // noself1: ambient food. One cluster = 6..14 candies in a loose blob (Poisson-ish rejection, min spacing 1.5) whose
  // diameter is 3..6 head widths of a starting snake (scaled up a little for bigger clusters so they never stack).
  spawnCluster(n) {
    const hw = 2 * radiusOf(C.START_M) * HEAD_K; let cx = 0, cy = 0, best = -1;
    for (let k = 0; k < 6; k++) { const [x, y] = this.randPos(this.R - 8); let md = 1e9; for (const q of this.clu.values()) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < md) md = d; } if (md > best) { best = md; cx = x; cy = y; } if (md > 400) break; }
    const id = this.cluSeq = (this.cluSeq % 2000000000) + 1, rad = hw * (1.5 + this.rand() * 1.5) * Math.max(1, Math.sqrt(n / 10)), q = { x: cx, y: cy, n0: n, n: 0 };
    this.clu.set(id, q); const px = [], py = [];
    for (let k = 0; k < n; k++) { let x = cx, y = cy;
      for (let t = 0; t < 8; t++) { const a = this.rand() * TAU, d = Math.sqrt(this.rand()) * rad; x = cx + Math.cos(a) * d; y = cy + Math.sin(a) * d; let ok = true; for (let m = 0; m < px.length; m++) if ((px[m] - x) ** 2 + (py[m] - y) ** 2 < 2.25) { ok = false; break; } if (ok) break; }
      px.push(x); py.push(y); const i = this.spawnFood(x, y, 1 + (this.rand() * 2.2) | 0, (this.rand() * 12) | 0); if (i < 0) break; this.fcl[i] = id; q.n++; }
    this.ambN += q.n; return q.n;
  }
  spawnSingle() { const [x, y] = this.randPos(this.R - 3); const i = this.spawnFood(x, y, 1 + (this.rand() * 2.2) | 0, (this.rand() * 12) | 0); if (i >= 0) { this.fcl[i] = -2; this.singles++; this.ambN++; } }
  // keep the field fed: retire spent clusters, then top up (at most one new cluster + one single per tick)
  feed(initial) {
    const T = this.foodTarget, maxS = Math.max(1, Math.round(T * CL_SINGLE));
    if (initial) { while (this.fCount < T - CL_MAX && this.fFree.length > CL_MAX) this.spawnCluster(CL_MIN + ((this.rand() * (CL_MAX - CL_MIN + 1)) | 0)); while (this.fCount < T && this.singles < maxS) this.spawnSingle(); return; }
    const need = T - this.fCount; if (need <= 0) return;
    if (need >= CL_MIN && this.fCount < this.FM - 80) { this.spawnCluster(Math.min(need, CL_MIN + ((this.rand() * (CL_MAX - CL_MIN + 1)) | 0))); return; }
    if (this.singles < maxS) this.spawnSingle();
  }
  drain() { this.evEvt.length = 0; this.evMet.length = 0; this.evImpact.length = 0; this.evPu.length = 0; this.evPuNew.length = 0; this.evShield.length = 0; this.evEat.length = 0; this.evSpawn.length = 0; this.evDie.length = 0; this.evNew.length = 0; }
  leaderboard(n) { return this.snakes.filter((s) => s.alive).sort((a, b) => b.m - a.m).slice(0, n); }
}

// server-side check of a skin descriptor sent by a client: only known shapes and safe values survive
export function sanitizeSkin(d) {
  const o = { k: "skin", i: 0, p: 0, c: ["#18c964", "#0b7a3b", "#b8ffcf"], e: 0, t: 0, n: 0 };
  if (!d || typeof d !== "object") return o;
  if (d.k === "flag" || d.k === "skin" || d.k === "custom") o.k = d.k;
  o.i = Math.max(0, Math.min(400, d.i | 0)); o.p = Math.max(0, Math.min(15, d.p | 0));
  if (Array.isArray(d.c)) o.c = d.c.slice(0, 3).map((h) => (typeof h === "string" && /^#[0-9a-fA-F]{6}$/.test(h) ? h : "#18c964"));
  o.e = Math.max(0, Math.min(11, d.e | 0)); o.t = Math.max(0, Math.min(12, d.t | 0)); o.n = Math.max(0, Math.min(19, d.n | 0));
  if (typeof d.av === "string" && /^(p([0-9]|1[0-9]|2[0-3])|f\d{1,3})$/.test(d.av)) o.av = d.av; o.fr = Math.max(0, Math.min(17, d.fr | 0)); /* comp1: 15..17 competition frames */ // profile avatar + frame (HUD rows)
  if (typeof d.gt === "string" && GT_IDS.includes(d.gt)) o.gt = d.gt; // srv1: equipped ground trail (one of the 10 known ids), shown to other players online
  return o;
}
export const cleanName = (n) => String(n || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16) || "Guest";

// ---------- comp1: trophies, leagues, seasons, contests. Shared by the client and the online server (pure, no DOM). ----------
// Online the server alone computes the delta from what IT saw (placement, kills, life); offline the same rule runs at half
// weight with a per-match / per-day cap and a ceiling (Diamond and above need online play).
export const LEAGUES = [{ id: "bronze", t0: 0, step: 80 }, { id: "silver", t0: 400, step: 120 }, { id: "gold", t0: 1000, step: 160 }, { id: "platinum", t0: 1800, step: 200 }, { id: "diamond", t0: 2800, step: 260 }, { id: "crown", t0: 4100, step: 340 }];
export const TROPHY = { ON_MAX: 40, ON_MIN: -16, OFF_MAX: 12, OFF_DAY: 120, OFF_CEIL: 2800, LIFE_MIN: 15, SAFE: 300, CONQ_N: 50, CONQ_MIN: 4100, MAX: 99999 };
export function leagueOf(t) {
  t = Math.max(0, Math.min(TROPHY.MAX, Math.floor(+t || 0))); let li = 0; while (li < LEAGUES.length - 1 && t >= LEAGUES[li + 1].t0) li++;
  const L = LEAGUES[li], d = Math.min(4, Math.floor((t - L.t0) / L.step)), lo = L.t0 + d * L.step, hi = d < 4 ? lo + L.step : li < LEAGUES.length - 1 ? LEAGUES[li + 1].t0 : 0;
  return { li, id: L.id, tier: 5 - d, div: li * 5 + d, lo, hi, t }; // tier 5 = V (lowest) .. 1 = I; hi 0 = open-ended (Crown I)
}
// one finished life / match -> trophy change. place 1 = best; field = snakes in the match
export function trophyDelta(o) {
  const f = Math.max(2, Math.min(200, o.field | 0)), pl = Math.max(1, Math.min(f, o.place | 0 || f)), k = Math.max(0, Math.min(40, o.kills | 0)), q = (pl - 1) / (f - 1), t = Math.max(0, o.t | 0);
  let d = pl === 1 ? 22 : pl <= 3 ? 15 : q <= 0.2 ? 9 : q <= 0.4 ? 4 : q <= 0.6 ? 0 : q <= 0.8 ? -5 : -9;
  d += Math.min(16, k * 2);
  if ((+o.life || 0) < TROPHY.LIFE_MIN && d > 0) d = 0; // a quick death never gains
  const li = leagueOf(t).li;
  if (d < 0) d = t < TROPHY.SAFE ? 0 : Math.round(d * (1 + li * 0.12)); else d = Math.round(d * (1 - li * 0.06)); // higher leagues: gain a bit less, lose a bit more
  if (!o.online) d = d > 0 ? Math.min(TROPHY.OFF_MAX, Math.round(d * 0.5)) : Math.round(d * 0.5);
  d = Math.max(TROPHY.ON_MIN, Math.min(TROPHY.ON_MAX, d)); return Math.max(-t, d);
}
// monthly season soft reset: everything above 1,000 trophies is halved
export const seasonCarry = (t) => { t = Math.max(0, Math.floor(+t || 0)); return t <= 1000 ? t : 1000 + Math.floor((t - 1000) * 0.5); };
export const seasonId = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0"); };
export const weekId = (ms) => { const d = new Date(ms), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = Date.UTC(t.getUTCFullYear(), 0, 1); return t.getUTCFullYear() + "-W" + String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0"); };
export const periodId = (per, ms) => (per === "w" ? weekId(ms) : seasonId(ms));
// end of the current period (UTC): week = next Monday 00:00, month = the 1st 00:00
export function periodEnd(per, ms) { const d = new Date(ms); if (per === "w") { const day = d.getUTCDay() || 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 8 - day); } return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
export const periodStart = (per, ms) => { const d = new Date(ms); if (per === "w") { const day = d.getUTCDay() || 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1 - day); } return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
export const prevPeriodId = (per, ms) => periodId(per, periodStart(per, ms) - 1000);
// contests: per = w (weekly) | m (monthly); met = tr (trophies gained) | kl (kills) | sc (best single-match score)
export const CONTESTS = [{ id: "w_rush", per: "w", met: "tr" }, { id: "w_hunt", per: "w", met: "kl" }, { id: "w_score", per: "w", met: "sc" }, { id: "m_rush", per: "m", met: "tr" }, { id: "m_hunt", per: "m", met: "kl" }, { id: "m_score", per: "m", met: "sc" }];
// bots get a stable league from their index (online + offline), close to the player's own league offline
export const botTrophies = (i, near) => { let h = (i * 2654435761) >>> 0; h ^= h >>> 15; const r = (h % 1000) / 1000; return near == null ? Math.round(r * r * 4600) : Math.max(0, Math.round(near + (r - 0.5) * 900)); };

// ---------- srv1: social rules shared by the client and the online server (pure, no DOM) ----------
// ground trail ids (same order as skins.js GTRAILS); the server only relays one of these
export const GT_IDS = ["dust", "ripples", "sparks", "flowers", "snow", "toxic", "cracks", "electric", "lava", "gold"];
// public player ids: 7 random digits (server-assigned), "1" = the founder, 5-digit special ids sold in the shop for coins
export const ID_PRICES = { rep: 300000, seq: 150000, std: 50000 };
export function idKind(n) {
  n = String(n); if (!/^[1-9]\d{4}$/.test(n)) return "";
  if (/^(\d)\1{4}$/.test(n)) return "rep";
  const d = [...n].map(Number); let up = true, dn = true; for (let i = 1; i < 5; i++) { if (d[i] !== d[i - 1] + 1) up = false; if (d[i] !== d[i - 1] - 1) dn = false; }
  return up || dn ? "seq" : "std";
}
export const idPrice = (n) => ID_PRICES[idKind(n)] || 0;
export const SPECIAL_REP = ["11111", "22222", "33333", "44444", "55555", "66666", "77777", "88888", "99999"];
export const SPECIAL_SEQ = ["12345", "23456", "34567", "45678", "56789", "98765", "87654", "76543", "65432", "54321"];
// chat: 200 characters, last 100 kept per conversation. Filter: links, phone numbers / long digit runs, a short EN + AR
// bad-word list (whole words; Arabic matched without diacritics / tatweel) -> "***"
export const MSG_MAX = 200, CHAT_KEEP = 100;
const BAD_EN = ["fuck", "fucking", "fucker", "shit", "bitch", "bastard", "asshole", "dick", "pussy", "cunt", "whore", "slut", "nigger", "nigga", "faggot", "retard", "motherfucker", "porn", "sex"];
const BAD_AR = ["كس", "كسمك", "كس امك", "زب", "زبي", "شرموط", "شرموطة", "منيوك", "منيوكة", "قحبة", "قحبه", "عاهرة", "عاهره", "خول", "متناك", "نيك", "انيك", "طيز", "ابن الكلب", "كلب", "حمار", "حيوان", "ابن الحرام", "لوطي", "سكس"];
const normW = (s) => s.toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}]/gu, "");
const BAD1 = new Set(), BAD2 = new Set(); for (const w of [...BAD_EN, ...BAD_AR]) { const k = w.split(" ").map(normW); (k.length > 1 ? BAD2 : BAD1).add(k.join(" ")); }
const RX_URL = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(com|net|org|io|me|gg|ly|co|app|xyz|info|ru|tk|link|site|online|store|ir|iq|sa|ae)\b\S*/gi;
const RX_TEL = /\+?[\d\u0660-\u0669][\d\u0660-\u0669\s().-]{6,}[\d\u0660-\u0669]/g;
export function filterText(s) {
  let o = String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MSG_MAX), hit = false; const rep = () => { hit = true; return "***"; };
  o = o.replace(RX_URL, rep).replace(RX_TEL, (m) => (m.replace(/[^\d\u0660-\u0669]/g, "").length >= 7 ? rep() : m));
  const w = o.split(" "), n = w.map(normW); // whole words only (EN + AR, Arabic compared without diacritics / tatweel / hamza forms)
  for (let i = 0; i < w.length; i++) { if (i + 1 < w.length && BAD2.has(n[i] + " " + n[i + 1])) { w[i] = "***"; w[i + 1] = ""; n[i + 1] = ""; hit = true; i++; continue; }
    if (n[i] && (BAD1.has(n[i]) || (/^[\u0600-\u06FF]/.test(n[i]) && n[i].length > 3 && (n[i].startsWith("ال") || n[i].startsWith("يا") || n[i].startsWith("و")) && BAD1.has(n[i].replace(/^(ال|يا|و)/, ""))))) { w[i] = w[i].replace(/[\p{L}\p{N}\u064B-\u065F\u0640]+/u, "***"); hit = true; } }
  return { t: w.filter((x) => x !== "").join(" "), hit };
}
