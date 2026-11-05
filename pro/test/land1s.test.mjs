// land1 checks: Territory mode (shared Terr grid: paint, loop claims, enemy steal, fading land, wire format, competent bots,
// rooms tp-/t-: welcome + full map + deltas, 3-minute rounds, placement trophies only for public rooms, coins per life with
// the land share, the territory switch, matchmaking kept apart) and Skin fusion (deterministic result, server-checked
// ownership, atomic fee + ledger, idempotent retry, each pair once, owner-editable fee, fusion skins checked in rooms).
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
process.env.TZ = "UTC";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-l1s-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
const W = await import(join(dir, "index.js")), M = await import(join(dir, "sim.js")), SK = await import(join(dir, "skins.js")), E = await import(join(dir, "econ.js"));
class Sql { constructor() { this.db = new DatabaseSync(":memory:"); }
  exec(q, ...b) { const st = this.db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...b).map((r) => ({ ...r })); return { toArray: () => rows, one: () => rows[0] }; } st.run(...b); return { toArray: () => [], one: () => undefined }; } }
class FakeWs { constructor() { this.out = []; this.att = null; this.open = true; this.code = 0; this.L = {}; } send(s) { if (!this.open) throw new Error("closed"); this.out.push(typeof s === "string" ? JSON.parse(s) : s); }
  serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); } deserializeAttachment() { return this.att; } close(c) { this.open = false; this.code = c || 1000; } accept() {} addEventListener(k, f) { this.L[k] = f; } }
globalThis.WebSocketPair = function () { const a = new FakeWs(), b = new FakeWs(); return { 0: a, 1: b }; };
const R0 = globalThis.Response; globalThis.Response = class extends R0 { constructor(b, i) { super(b, i && i.status === 101 ? { ...i, status: 200 } : i); if (i && i.webSocket) this.webSocket = i.webSocket; } };
globalThis.fetch = (u) => Promise.reject(new Error("no network in tests: " + u));
const objs = new Map(); const env = { ROOMS: { idFromName: (x) => x, get: (id) => ({ fetch: (u, init) => obj(id).fetch(u instanceof Request ? u : new Request(u, init)) }) } };
const obj = (id) => { let o = objs.get(id); if (!o) { const tags = new Map(), all = [];
  o = new W.Room({ storage: { sql: new Sql() }, tags, acceptWebSocket: (ws, t) => { all.push(ws); for (const x of t) { if (!tags.has(x)) tags.set(x, []); tags.get(x).push(ws); } }, getWebSockets: (t) => (t === undefined ? all : tags.get(t) || []).filter((w) => w.open), setWebSocketAutoResponse() {} }, env); objs.set(id, o); } return o; };
const S = () => obj("social-v1"), q = () => S().sdb();
const pk = (k) => k.toString(16).padStart(32, "0"); const pidOf = async (k) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + k)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); };
const post = async (path, body) => (await W.default.fetch(new Request("https://w" + path, { method: "POST", body: JSON.stringify(body), headers: { origin: "https://billke.com" } }), env)).json();
const A = (k, o, extra = {}) => post("/s", { pk: pk(k), op: o, ...extra });
const P1 = await pidOf(pk(1)), P2 = await pidOf(pk(2)), P3 = await pidOf(pk(3));
await A(1, "w_get"); await A(2, "w_get"); await A(3, "w_get"); q().exec("UPDATE acct SET own = 1, t = ? WHERE pid = ?", Date.now() - 864e5, P1);
for (const P of [P2, P3]) q().exec("UPDATE acct SET t = ? WHERE pid = ?", W.MIG.CUT - 864e5, P); await A(2, "w_mig", { coins: 0, lv: 5 }); await A(3, "w_mig", { coins: 0, lv: 5 });

// ================= Territory: the grid =================
const fakeS = (T, list, dt = 1 / 30) => ({ snakes: list, byId: new Map(list.map((s) => [s.id, s])), dt });
const mk = (id, x, y) => { const s = new M.Snake(id); s.reset(x, y, 0, 24); return s; };
const walk = (T, F, s, pts, step = 0.29) => { for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / step); for (let i = 1; i <= n; i++) { s.x = x0 + ((x1 - x0) * i) / n; s.y = y0 + ((y1 - y0) * i) / n; T.step(F); } } };
{ const T = new M.Terr(150); const want = Math.PI * (150 / 2) ** 2; ok(Math.abs(T.total - want) / want < 0.03 && T.dim === 150, "grid: 150 x 150 cells of 2 units, " + T.total + " inside the arena (~pi r^2)");
  const a = mk(1, 0, 0), F = fakeS(T, [a]); T.step(F); const s = a.ts; ok(s > 0 && T.cnt[s] >= 25 && T.cnt[s] <= 37, "spawn: a slot and a small starting patch (" + T.cnt[s] + " cells)");
  // a diagonal run paints a 4-connected trail
  const d0 = T.cnt[s]; const path = []; walk(T, F, a, [[0, 0], [30, 30]]); const cells = []; for (let i = 0; i < T.N; i++) if (T.own[i] === s) cells.push(i);
  const set = new Set(cells), d = T.dim; let lone = 0; for (const i of cells) { if (!(set.has(i - 1) || set.has(i + 1) || set.has(i - d) || set.has(i + d))) lone++; }
  ok(T.cnt[s] > d0 + 15 && lone === 0, "diagonal run: every painted cell touches another by an edge (4-connected, " + (T.cnt[s] - d0) + " new cells)");
  // a loop out of the land and back claims what it encloses
  const T2 = new M.Terr(150), b = mk(2, 0, 0), F2 = fakeS(T2, [b]); T2.step(F2); const s2 = b.ts, c0 = T2.cnt[s2];
  walk(T2, F2, b, [[0, 0], [0, 4], [0, 24], [20, 24], [20, 0], [2, 0]]); for (let k = 0; k < 10; k++) T2.step(F2);
  { let inside = 0, mine = 0; for (let y = 2; y < 23; y += 2) for (let x = 2; x < 19; x += 2) { inside++; if (T2.own[T2.cellAt(x, y)] === s2) mine++; } ok(mine === inside && T2.cnt[s2] - c0 >= 0.9 * 10 * 12 && T2.fills >= 1, "closing a loop back onto its land claims the whole inside (" + mine + "/" + inside + " sampled cells, +" + (T2.cnt[s2] - c0) + " cells for a 20 x 24 loop, fills " + T2.fills + ")"); }
  // a loop around an enemy's cells steals them; a loop across its own fresh trail (no land touched) closes too
  const T3 = new M.Terr(150), c = mk(3, -40, -40), e = mk(4, 10, 10), F3 = fakeS(T3, [c, e]); T3.step(F3); const ec = T3.cnt[e.ts];
  walk(T3, F3, c, [[-40, -40], [0, -40], [0, 0], [20, 0], [20, 20], [0, 20], [0, -2]]); for (let k = 0; k < 10; k++) T3.step(F3);
  ok(T3.cnt[e.ts] === 0 && T3.cnt[c.ts] > 10 * 10 + 20, "a loop around another snake's land takes it (" + ec + " -> " + T3.cnt[e.ts] + ")");
  const T4 = new M.Terr(150), f = mk(5, 60, 0), F4 = fakeS(T4, [f]); T4.step(F4); const f0 = T4.cnt[f.ts];
  walk(T4, F4, f, [[60, 0], [60, 10], [60, 30], [80, 30], [80, 15], [55, 15]]); for (let k = 0; k < 10; k++) T4.step(F4);
  ok(T4.cnt[f.ts] - f0 > 70 && T4.own[T4.cellAt(70, 22)] === f.ts, "a loop across its own trail also closes (+" + (T4.cnt[f.ts] - f0) + ")");
  // dead snake: land fades over TER.DECAY s, then the slot is free
  const T5 = new M.Terr(150), g = mk(6, 0, 0), F5 = fakeS(T5, [g], 1 / 30); T5.step(F5); walk(T5, F5, g, [[0, 0], [0, 30], [20, 30], [20, 0], [1, 0]]); const sl = g.ts, before = T5.cnt[sl];
  g.alive = false; T5.step(F5); T5.step(F5); const mid = T5.cnt[sl]; for (let k = 0; k < Math.round(M.TER.DECAY * 30) + 6; k++) T5.step(F5);
  ok(before >= 150 && mid > before * 0.85 && mid < before && T5.cnt[sl] === 0 && T5.idOf[sl] === 0 && T5.evSlot.slice(-2).join() === sl + ",0", "a dead snake's land fades gradually (" + before + " -> " + mid + " after 2 ticks -> 0 after " + M.TER.DECAY + " s), slot freed");
  // wire: full + deltas reproduce the server grid on a client mirror
  const Ts = new M.Terr(150, { track: true }), h = mk(7, 0, 0), h2 = mk(8, -50, 20), Fs = fakeS(Ts, [h, h2]); Ts.step(Fs); const Tc = new M.Terr(150); Tc.applyFull(Ts.full()); Ts.take();
  let deltas = 0; for (const seg of [[[0, 0], [0, 30], [25, 30], [25, 0], [1, 0]], [[1, 0], [-30, -10], [-10, -40]]]) { walk(Ts, Fs, h, seg); const b2 = Ts.take(); if (b2) { deltas += b2.byteLength; Tc.applyDelta(b2); } }
  for (let i = 0; i < Ts.evSlot.length; i += 2) Tc.mapSlot(Ts.evSlot[i], Ts.evSlot[i + 1]);
  let same = true; for (let i = 0; i < Ts.N; i++) if (Ts.own[i] !== Tc.own[i]) { same = false; break; }
  ok(same && Tc.cnt[h.ts] === Ts.cnt[h.ts] && deltas < 4000, "client mirror = server grid after full + deltas (delta bytes " + deltas + ", full " + Ts.full().byteLength + ")");
  const Tf = new M.Terr(150); Tf.applyFull(Ts.full()); let same2 = true; for (let i = 0; i < Ts.N; i++) if (Ts.own[i] !== Tf.own[i]) same2 = false; ok(same2 && Tf.idOf[h.ts] === h.id, "a late joiner's full map matches (slots -> snakes included)"); }

// ================= Territory: rules + bots =================
{ const Sm = new M.Sim({ dt: 1 / 30, R: 150, seed: 11, netMode: true, events: false, powerups: false }); Sm.ter = new M.Terr(150, { dt: 1 / 30, rand: Sm.rand });
  const a = Sm.addSnake("a", { k: "skin", i: 0 }, { pos: [0, 0] }), b = Sm.addSnake("b", { k: "skin", i: 1 }, { pos: [40, 40] }); b.setMass(200);
  for (let k = 0; k < 5; k++) Sm.step(() => true); // a's land under b? move b's body across a's land: no harm to either
  for (let i = 0; i < 40; i++) b.push(i * 0.5 - 10, 30); b.x = 9.5; b.y = 30; Sm.step(() => true); ok(a.alive && b.alive, "land never kills (bodies over other land are harmless)");
  a.x = 4; a.y = 30.2; a.a = 0; Sm.buildGrid(); Sm.collide(); ok(!a.alive && b.alive, "snake rules kept: a head into a body dies"); }
{ const res = []; for (let r = 0; r < 2; r++) { const Sm = new M.Sim({ dt: 1 / 30, R: 150, seed: 300 + r, netMode: true, events: true }); Sm.ter = new M.Terr(150, { dt: 1 / 30, rand: Sm.rand });
    for (let i = 0; i < 16; i++) Sm.addSnake("b" + i, { k: "skin", i: i % 24 }, { bot: true, diff: [1, 1, 2, 2, 3][i % 5] }); let deaths = 0;
    for (let k = 0; k < 2700; k++) { Sm.step(() => true); deaths += Sm.evDie.length / 3; for (let i = 0; i < Sm.evDie.length; i += 3) { const s = Sm.byId.get(Sm.evDie[i]); if (s) Sm.removeSnake(s); } Sm.drain(); if (k % 30 === 0) while (Sm.snakes.filter((s) => s.alive).length < 16) Sm.addSnake("n", { k: "skin", i: 3 }, { bot: true, diff: 2 }); }
    const T = Sm.ter, top = T.top(0), sum = top.reduce((x, y) => x + y[1], 0) / T.total * 100, loops = Sm.snakes.filter((s) => s.alive && s.ai && s.ai.tp).length;
    res.push({ top: top[0][1] / T.total * 100, sum, deaths, fills: T.fills, loops, med: top[top.length >> 1][1] }); }
  ok(res.every((r) => r.top > 3 && r.sum > 25 && r.fills > 150 && r.loops >= 14), "bots play territory: loops out and back (90 s, 16 bots): top " + res.map((r) => r.top.toFixed(1) + "%").join("/") + ", map owned " + res.map((r) => r.sum.toFixed(0) + "%").join("/") + ", fills " + res.map((r) => r.fills).join("/"));
  ok(res.every((r) => r.deaths >= 2 && r.deaths <= 30), "bots still fight and die sometimes (deaths " + res.map((r) => r.deaths).join("/") + " in 90 s)"); }

// ================= Territory: rooms =================
const room = (name) => { const R = new W.Room({ storage: { sql: new Sql() } }, env); R.init(new URLSearchParams("name_room=" + name)); return R; };
{ const R = room("tp-bs-1"); ok(R.ter && R.sim.R === M.TER.R_ON && R.pub && R.ranked() && R.br === "bs", "tp-bs-1 = public territory room (R " + R.sim.R + ", ranked, bracket bs)");
  ok(R.sim.snakes.filter((s) => s.alive).length === M.TER.SNAKES && R.sim.snakes.every((s) => s.m < 40), "16 start-size snakes (no aged world in territory)");
  const P = room("t-r-abc12"); ok(P.ter && !P.ranked() && !P.pub, "t-<code> = private territory room (bots, no trophies)");
  const C = room("pub-bs-1"); ok(!C.ter && C.pub && C.ranked(), "classic public rooms unchanged (no territory)");
  // a player joins: welcome carries the round, then the whole map as one binary frame, then 15 Hz deltas + slot messages
  const res = await R.fetch(new Request("https://room/ws?name_room=tp-bs-1")); const ws = [...R.clients][0].ws; ws.L.message({ data: JSON.stringify({ t: "hello", name: "Mo", skin: { k: "skin", i: 0 } }) });
  const wel = ws.out.find((m) => m && m.t === "welcome"), full = ws.out.find((m) => m instanceof ArrayBuffer && new Uint8Array(m)[0] === 4);
  ok(wel && wel.ter && wel.ter.left > 170 && wel.ter.n === 1 && full, "join: welcome.ter (round 1, " + (wel && wel.ter.left) + " s left) + full map frame (" + (full && full.byteLength) + " bytes)");
  const c = [...R.clients][0]; ws.L.message({ data: JSON.stringify({ t: "spawn" }) }); await new Promise((r) => setTimeout(r, 5)); ok(c.snake && c.rd && c.rd.n === 1, "spawn: the human is in round 1");
  clearInterval(R.timer); R.timer = null; ws.out.length = 0; for (let k = 0; k < 60; k++) R.tick();
  const dl = ws.out.filter((m) => m instanceof ArrayBuffer && new Uint8Array(m)[0] === 5), tsl = ws.out.filter((m) => m && m.t === "tsl");
  ok(dl.length > 5 && dl.length <= 30 && tsl.length >= 1 && tsl.some((m) => m.l.some(([s, id]) => id === c.snake.id)), "2 s of play: " + dl.length + " delta frames (<= 15/s), slot message for the new snake");
  const lb = ws.out.find((m) => m && m.t === "lb"); ok(lb && Number.isFinite(lb.rl) && lb.rn === 1, "leaderboard carries the round clock (" + (lb && lb.rl) + " s)");
  // round end: placement message, everyone leaves at once (cause 7), map clears, round 2 begins and refills
  let rec = null; R.boardStub = () => ({ fetch: (u, i) => { rec = JSON.parse(i.body); return Promise.resolve(new R0(JSON.stringify({ ok: 1, tr: 120, d: rec.d, ss: "x" }))); } });
  c.pid = P2; c.rd.t0 = Date.now() - 60000; R.sim.ter.set(R.sim.ter.cellAt(c.snake.x + 6, c.snake.y), c.snake.ts); const myCells = R.ter.cnt[c.snake.ts];
  ws.out.length = 0; R.trd.end = R.sim.tick; R.tick(); await new Promise((r) => setTimeout(r, 20));
  const te = ws.out.find((m) => m && m.t === "tend"), me = ws.out.find((m) => m && m.t === "tme"), dead = ws.out.filter((m) => m && m.t === "dead"), tr = ws.out.find((m) => m && m.t === "trd");
  ok(te && te.rk.length === 5 && me && me.pl >= 1 && me.pl <= me.f && dead.length >= 16 && dead.every((d) => d.cause === 7 && !d.by), "round end: top 5 + your place (#" + (me && me.pl) + "/" + (me && me.f) + "), all snakes leave quietly (cause 7)");
  ok(rec && rec.pid === P2 && Number.isFinite(rec.d) && ws.out.some((m) => m && m.t === "tro" && m.rd === 1), "public room: placement trophies recorded once on the board (d " + (rec && rec.d) + ")");
  ok(tr && tr.n === 2 && R.trd.n === 2 && R.ter.top(0).length === 0 && R.sim.snakes.filter((s) => s.alive).length === M.TER.SNAKES - 0, "round 2 starts: map cleared, refilled with " + R.sim.snakes.filter((s) => s.alive).length + " snakes");
  // a private room never records trophies
  let rec2 = null; P.boardStub = () => ({ fetch: (u, i) => { rec2 = 1; return Promise.resolve(new R0("{}")); } }); const pc = { joined: 1, pid: P3, snake: P.sim.snakes[0], life: { t0: Date.now() - 60000, bm: 30, done: false }, rd: { n: 1, t0: Date.now() - 60000, k: 0 }, ws: new FakeWs() }; P.clients = new Set([pc]); P.trd.end = P.sim.tick; P.tick(); await new Promise((r) => setTimeout(r, 10));
  ok(!rec2 && pc.ws.out.some((m) => m && m.t === "tme"), "private territory room: round result shown, no trophies");
  // coins per life: land share counts like mass (x30) inside the same formula and caps
  let eb = null; R.env = { ROOMS: { idFromName: (x) => x, get: () => ({ fetch: (u, i) => { eb = JSON.parse(i.body); return Promise.resolve(new R0('{"ok":1,"c":1,"bal":1}')); } }) } };
  R.earn({ pid: P2 }, { id: 9, m: 40 }, { t0: Date.now() - 90000, bm: 60, pk: 20 }); ok(eb && eb.best === 600 && /^on:tp-bs-1:/.test(eb.ck), "territory life pays with best = max(mass, land% x 30) (" + (eb && eb.best) + ")");
  R.env = env; }
// land1b: players who die during a round are ranked below every survivor by land % at death, trophies from the same table
{ const R = room("tp-bs-3"); clearInterval(R.timer); R.timer = null; const T = R.ter, S2 = R.sim; for (let k = 0; k < 3; k++) R.tick();
  const recs = []; R.boardStub = () => ({ fetch: (u, i) => { const b = JSON.parse(i.body); recs.push(b); return Promise.resolve(new R0(JSON.stringify({ ok: 1, tr: 500 + b.d, d: b.d, ss: "x" }))); } });
  const sn = S2.snakes.filter((s) => s.alive), now = Date.now(), mkC = (pid, s, ago) => ({ joined: 1, pid, name: pid.slice(0, 4), tr: 500, snake: s, life: { t0: now - ago, bm: 30, done: false, best: 99, field: 2 }, rd: { n: R.trd.n, t0: now - ago, k: 0 }, ws: new FakeWs() });
  const big = sn[1], mid = sn[2], quick = sn[3]; // big: dies holding more land than any survivor; mid: dies with a little land; quick: dies after 10 s
  const paint = (s, n) => { let k = 0; for (let i = 0; i < T.N && k < n; i++) if (T.inside[i] && T.own[i] !== s.ts && !T.idOf[T.own[i]] || (T.inside[i] && T.own[i] === 0)) { T.set(i, s.ts); k++; } };
  paint(big, 3000); paint(mid, 400); paint(sn[0], 600);
  const cs = mkC("s".repeat(20), sn[0], 60000), cb = mkC("b".repeat(20), big, 60000), cm = mkC("m".repeat(20), mid, 50000), cq = mkC("q".repeat(20), quick, 10000); R.clients = new Set([cs, cb, cm, cq]);
  const pb = T.pctOf(big.id), pm = T.pctOf(mid.id);
  S2.kill(big, 0, 4); R.score(cb, big); // scored while its slot is still mapped
  S2.kill(mid, 0, 4); T.step(S2); ok(!T.slotOf.get(mid.id) && Math.abs(mid._tp - pm) < 1e-9, "a dead snake's land % at death is kept when its land starts to fade (" + pm.toFixed(2) + "%)"); R.score(cm, mid); // scored after the slot was released
  S2.kill(quick, 0, 4); R.score(cq, quick);
  ok(R.trd.dead && R.trd.dead.size === 2 && !R.trd.dead.has(cq.pid), "deaths kept for the round: 2 (the 10 s one is under LIFE_MIN and is not ranked)");
  const nAlive = S2.snakes.filter((s) => s.alive).length; R.trd.end = S2.tick; R.tick(); await new Promise((r) => setTimeout(r, 20));
  const meB = cb.ws.out.find((m) => m && m.t === "tme"), meM = cm.ws.out.find((m) => m && m.t === "tme"), meS = cs.ws.out.find((m) => m && m.t === "tme"), rb = recs.find((r) => r.pid === cb.pid), rm = recs.find((r) => r.pid === cm.pid), rs = recs.find((r) => r.pid === cs.pid);
  ok(pb > T.pct(1) || pb > 3, "setup: the dead player held more land than the survivors (" + pb.toFixed(1) + "%)");
  ok(meS && meS.pl <= nAlive && meB && meB.pl === nAlive + 1 && meM && meM.pl === nAlive + 2 && meB.f === nAlive + 2 && meB.dd === 1, "dead players placed below all " + nAlive + " survivors, by land at death: big #" + (meB && meB.pl) + ", small #" + (meM && meM.pl) + " of " + (meB && meB.f) + "; survivor #" + (meS && meS.pl));
  const want = (pl, o) => M.trophyDelta({ place: pl, field: nAlive + 2, kills: 0, life: o, t: 500, online: 1 });
  ok(rb && rm && rs && rb.d === want(nAlive + 1, 60) && rm.d === want(nAlive + 2, 50) && rb.d < 0 && rm.d <= rb.d, "dead players get placement trophies from the same table (d " + (rb && rb.d) + " / " + (rm && rm.d) + ", survivor " + (rs && rs.d) + ")");
  ok(!recs.some((r) => r.pid === cq.pid) && recs.length === 3 && cb.ws.out.some((m) => m && m.t === "tro" && m.rd === 1), "the quick death gets no placement; each counted player recorded once and told (tro rd)");
  // died, came back and is alive at the end = a survivor; died and left the room = still ranked (record without a socket)
  recs.length = 0; for (let k = 0; k < 3; k++) R.tick(); const sn2 = S2.snakes.filter((s) => s.alive), a = sn2[0], b = sn2[1], a2 = sn2[2];
  const ca = mkC("a".repeat(20), a, 40000), cl = mkC("l".repeat(20), b, 40000); R.clients = new Set([ca, cl]); S2.kill(a, 0, 4); R.score(ca, a); S2.kill(b, 0, 4); R.score(cl, b); R.clients.delete(cl);
  ca.snake = a2; ca.life = { t0: Date.now(), bm: 20, done: false, best: 99, field: 2 }; R.trd.end = S2.tick; R.tick(); await new Promise((r) => setTimeout(r, 20));
  const ra = recs.filter((r) => r.pid === ca.pid), rl = recs.filter((r) => r.pid === cl.pid), meA = ca.ws.out.filter((m) => m && m.t === "tme");
  ok(ra.length === 1 && meA.length === 1 && !meA[0].dd && rl.length === 1, "respawned and alive at the end: ranked once as a survivor; a dead player who left is still ranked (" + rl.length + ")");
  R.trd.dead = null; }
// the territory switch (owner) reaches rooms + matchmaking; offline territory claims refused while it is off
{ let r = await A(1, "a_modes", { moff: ["territory"], eoff: [], why: "test land" }); ok(r.ok && r.moff.join() === "territory", "owner can switch Territory off (existing modes toggle)");
  let u = await (await S().fetch(new Request("https://social/s/uid?pid=" + P2 + "&md=t"))).json(); ok(u.mt && u.mt.k === "off", "territory rooms refuse players while it is off");
  u = await (await S().fetch(new Request("https://social/s/uid?pid=" + P2))).json(); ok(!u.mt, "classic online rooms are not affected");
  r = await A(2, "w_claims", { l: [{ k: "match", ck: "m:" + "ab12cd34ef56", a: { mode: "territory", diff: 1, dur: 180, best: 400, kills: 2, at: Date.now() } }], cn: Date.now() }); ok(r.res && r.res[0].err === "off", "offline territory match earns nothing while it is off (as play2)");
  await A(1, "a_modes", { moff: [], eoff: [], why: "restore" }); r = await A(2, "w_claims", { l: [{ k: "match", ck: "m:" + "ab12cd34ef57", a: { mode: "territory", diff: 1, dur: 180, best: 400, kills: 2, at: Date.now() } }], cn: Date.now() });
  ok(r.res && r.res[0].c > 0 && r.res[0].c <= E.OFF.PER_MATCH, "back on: an offline territory match pays within the offline caps (" + (r.res && r.res[0].c) + ")"); }
{ const R = new Map(), P = new Map(), now = Date.now(); R.set("pub-bs-1", { room: "pub-bs-1", br: "bs", i: 1, h: 3, b: 27, t: now, md: "" }); R.set("tp-bs-1", { room: "tp-bs-1", br: "bs", i: 1, h: 2, b: 14, t: now, md: "t" });
  const a = W.mmPick(R, P, { pid: "a".repeat(20), br: "bs", now, md: "t" }), b = W.mmPick(R, P, { pid: "b".repeat(20), br: "bs", now });
  ok(a.room === "tp-bs-1" && b.room === "pub-bs-1", "matchmaker keeps territory (tp-) and classic (pub-) rooms apart");
  R.clear(); const c = W.mmPick(R, P, { pid: "c".repeat(20), br: "gp", now, md: "t" }); ok(c.room === "tp-gp-1", "a new territory room is named tp-<bracket>-<n> (" + c.room + ")"); }

// ================= Skin fusion =================
{ const F = SK.FUSABLE; ok(F.length >= 10 && F.every((i) => /^(coins|pass|chain|weekly|boss):/.test(SK.SKINS[i].src)) && !F.some((i) => /^level:/.test(SK.SKINS[i].src || "") || !SK.SKINS[i].src), "fusable: only bought / earned skins (" + F.length + "), no level-free or default skins");
  let all = true, names = new Set(), rar = new Set(), calm = true; for (let x = 0; x < F.length; x++) for (let y = x + 1; y < F.length; y++) { const d = SK.fusionDef(SK.fuIdx(F[x], F[y])), d2 = SK.fusionDef(SK.fuIdx(F[y], F[x]));
    if (!d || d !== d2 || d.key !== SK.fuKey(F[y], F[x]) || !d.c.every((h) => /^#[0-9a-f]{6}$/.test(h))) all = false; names.add(d.name); rar.add(d.rar); if (d.p === 7 || d.p === 8) calm = false; }
  const pairs = (F.length * (F.length - 1)) / 2; ok(all && names.size === pairs, "fusion result is deterministic, the same in both orders, valid colours; " + pairs + " pairs, " + names.size + " distinct names");
  ok([...rar].sort().join() === "epic,rare" && calm, "fusion rarity is Rare or Epic; no fast-animated pattern");
  ok(SK.fusionDef(SK.fuIdx(F[0], F[0])) === null && SK.fusionDef(SK.fuIdx(0, F[0])) === null, "a skin with itself / with a level skin is not a fusion");
  ok(E.validKey(SK.fuKey(F[0], F[1])) && !E.validKey("fu:emerald+ruby") && !E.validKey("fu:" + SK.SKINS[F[1]].id + "+" + SK.SKINS[F[0]].id), "item keys: fu:<a>+<b> known only in catalogue order and for fusable skins");
  ok(M.sanitizeSkin({ k: "fu", i: SK.fuIdx(F[2], F[3]) }).i === SK.fuIdx(F[2], F[3]) && M.sanitizeSkin({ k: "fu", i: 99999 }).i === 16383, "the in-game skin descriptor keeps the fusion index (clamped)"); }
{ const F = SK.FUSABLE, a = F[0], b = F[1], c = F[2], key = SK.fuKey(a, b), bal = () => q().exec("SELECT bal FROM wal WHERE pid = ?", P2).one().bal;
  let r = await A(2, "w_fuse", { a, b, rid: "aa00aa00" }); ok(r.err === "notOwned", "fusing skins you don't own is refused");
  for (const i of [a, b, c]) S().wGive(P2, SK.SKINS[i].id, "test"); r = await A(2, "w_fuse", { a, b, rid: "aa00aa01" }); ok(r.err === "noCoins" && !S().wHas(P2, key), "not enough coins: refused, nothing given");
  S().wAdd(P2, 5000, "test", "seed"); const b0 = bal();
  r = await A(2, "w_fuse", { a, b, fee: SK.FUSION_FEE, rid: "aa00aa02" }); ok(r.ok && r.key === key && bal() === b0 - 2000 && S().wHas(P2, key) && S().wHas(P2, SK.SKINS[a].id) && S().wHas(P2, SK.SKINS[b].id), "fuse: fee 2,000 paid, new skin owned, both inputs kept (" + key + ")");
  const led = q().exec("SELECT k, d, ref FROM led WHERE pid = ? AND k = 'fuse'", P2).toArray(); ok(led.length === 1 && led[0].d === -2000 && led[0].ref === key, "one ledger row (fuse, -2000, " + (led[0] && led[0].ref) + ")");
  r = await A(2, "w_fuse", { a, b, fee: 2000, rid: "aa00aa02" }); ok(r.ok && r.dup && bal() === b0 - 2000, "double tap (same request id): done once, charged once");
  r = await A(2, "w_fuse", { a: b, b: a, fee: 2000, rid: "aa00aa03" }); ok(r.err === "own" && bal() === b0 - 2000, "same pair again (other order, new request): refused, no charge — each pair once");
  r = await A(2, "w_fuse", { a, b: a, rid: "aa00aa04" }); const r2 = await A(2, "w_fuse", { a, b: 0, rid: "aa00aa05" }); const r3 = await A(2, "w_fuse", { a: "1x", b, rid: "aa00aa06" }); ok(r.err === "na" && r2.err === "na" && r3.err === "na", "a skin with itself / a level skin / a bad index: refused");
  // owner edits the fee in Economy
  r = await A(1, "a_price", { key: "fusion", price: 3000, why: "fee test" }); ok(r.ok && SK.FUSION_FEE === 3000, "owner can edit the fusion fee (Economy prices: fusion)");
  const cfg = await A(1, "a_cfg", {}); ok(cfg.prices && cfg.prices.some((p) => p.k === "fusion" && p.p === 3000 && p.b === 2000), "the fee is listed with the other prices (now 3,000, base 2,000)");
  r = await A(2, "w_fuse", { a, b: c, fee: 2000, rid: "aa00aa07" }); ok(r.err === "price" && r.fee === 3000 && bal() === b0 - 2000, "a stale fee from the device is refused (server price wins)");
  await A(1, "a_price", { key: "fusion", price: 0, why: "fee back" }); ok(SK.FUSION_FEE === 2000, "fee back to the base");
  // rooms: an equipped fusion skin is checked against the wallet (fix1 rule)
  const fu = { k: "fu", i: SK.fuIdx(a, b), e: 0, t: 0, n: 0 }; let [sk, cut] = W.verifySkin(fu, { own: new Set([key]), lv: 5 }); ok(sk.k === "fu" && !cut.length, "online: an owned fusion skin is shown as is");
  [sk, cut] = W.verifySkin({ k: "fu", i: SK.fuIdx(a, c) }, { own: new Set([key]), lv: 5 }); ok(sk.k !== "fu" && cut.includes("fusion"), "online: an unowned fusion skin falls back to the default");
  ok(W.ADM_MODES.includes("territory"), "admin modes list carries territory"); }

console.log(fail ? `FAIL ${fail}/${n}` : `PASS ${n}/${n}`); process.exit(fail ? 1 : 0);
