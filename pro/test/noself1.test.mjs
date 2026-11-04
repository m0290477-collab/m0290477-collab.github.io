// noself1 checks (node test/noself1.test.mjs): no self-collision, one-death head-on, candy pickup = visible outline, clustered
// ambient food, fairness (bots == players). Each rule runs offline (Sim) AND through the worker's Room (server/index.js + sim.js).
import { Sim, C, HEAD_K, foodVisR, foodBig, magReach, moveSnake, radiusOf, turnOf, boostCost, CANDY_SCALE, FOOD_EDGE, CL_MIN, CL_MAX } from "../js/sim.js";
import { candySize2, candyBig, SPR_K, CANDY_SCALE as CS2 } from "../js/gfx/candy.js";
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
// ---- worker harness: the real Room class with the real sim.js, fake sockets, ticks driven by hand ----
const dir = mkdtempSync(join(tmpdir(), "ssp-srv-")); copyFileSync(new URL("../server/index.js", import.meta.url), join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(new URL("../js/" + f, import.meta.url), join(dir, f)); // coin1
const { Room } = await import(join(dir, "index.js"));
function room() { const R = new Room({}, {}); R.init(new URLSearchParams("bots=0&name_room=test")); R.sim.pus.length = 0; R.sim.powerups = false; R.sim.events = []; R.sim.evt = null; return R; }
function join_(R, name) { const c = { ws: { send() {}, close() {} }, snake: null, q: [], ack: 0xffff, extra: 0, name, skin: null, msgs: 0, win: Date.now(), joined: false, lastTa: 0, lastBoost: 0, out: [] };
  c.ws.send = (m) => { if (typeof m === "string") c.out.push(JSON.parse(m)); }; R.clients.add(c); R.onMsg(c, JSON.stringify({ t: "hello", name })); R.onMsg(c, JSON.stringify({ t: "spawn", seq: 0 })); c.seq = 0; return c; }
function input(R, c, ta, boost) { c.msgs = 0; const b = new ArrayBuffer(2 + 5), v = new DataView(b); v.setUint8(0, 2); v.setUint8(1, 1); c.seq = (c.seq + 1) & 0xffff;
  const q = Math.round(((ta + Math.PI) / (Math.PI * 2)) * 65536) & 0xffff; v.setUint16(2, c.seq, true); v.setUint16(4, q, true); v.setUint8(6, boost ? 1 : 0); R.onMsg(c, b); }
const place = (S, s, x, y, a, m) => { s.reset(x, y, a, m); s.bornTick = 0; };
const deaths = (R) => { const l = []; for (const c of R.clients) for (const m of c.out) if (m.t === "dead") l.push(m); const u = new Map(); for (const m of l) u.set(m.id, m); return [...u.values()]; };

// ===== 1. self-collision: never, server path =====
for (const boost of [0, 1]) { const R = room(); const c = join_(R, "Me"); const s = c.snake; place(R.sim, s, 0, 0, 0, boost ? 600 : 24); let died = false;
  for (let i = 0; i < 30 * 12; i++) { input(R, c, s.a + 1.4, boost); R.tick(); if (!s.alive) { died = true; break; } }
  ok(!died, `worker: a human holding a full-lock turn${boost ? " while boosting" : ""} for 12 s never dies (mass ${Math.round(s.m)})`); }
{ const R = room(); const c = join_(R, "Me"); const s = c.snake; R.onMsg(c, JSON.stringify({ t: "die", hit: s.id })); ok(s.alive, "worker: an old client's self-death report (hit = own id) is ignored"); }

// ===== 2. head-on: exactly one dies =====
function headOn(R, A, B, mA, mB) { place(R.sim, A, -3, 0, 0, mA); place(R.sim, B, 3, 0, Math.PI, mB); }
for (const [kind, mA, mB] of [["player vs bot", 60, 60], ["player vs bot", 60, 300], ["player vs player", 60, 60], ["player vs player", 300, 60]]) {
  const R = room(); const ca = join_(R, "A"); const A = ca.snake; let B, cb = null;
  if (kind === "player vs bot") { B = R.sim.addSnake("Cobra", {}, { bot: true, diff: 1 }); B.ai.t = 1e9; } else { cb = join_(R, "B"); B = cb.snake; }
  headOn(R, A, B, mA, mB);
  for (let i = 0; i < 90 && A.alive && B.alive; i++) { input(R, ca, 0, 0); if (cb) input(R, cb, Math.PI, 0); else B.ta = Math.PI; R.tick(); }
  for (let i = 0; i < 3; i++) { input(R, ca, 0, 0); if (cb) input(R, cb, Math.PI, 0); R.tick(); }
  const d = deaths(R).filter((m) => m.id === A.id || m.id === B.id); const W = A.alive ? A : B;
  ok(d.length === 1 && A.alive !== B.alive && d[0].by === W.id, `worker head-on ${kind} (mass ${mA} vs ${mB}): exactly one dies (${d.length}), the survivor ${W === A ? "A" : "B"} is the killer`);
}
for (const [kind, mA, mB] of [["player vs bot", 60, 60], ["player vs bot", 300, 60], ["player vs player", 60, 60], ["bot vs bot", 60, 200]]) { // offline
  const S = new Sim({ dt: 1 / 60, R: 120, seed: 5, powerups: false, events: [] }); S.snakes.length = 0; S.byId.clear(); for (let i = 0; i < S.FM; i++) if (S.fa[i]) S.removeFood(i, 0); S.drain();
  const A = S.addSnake("A", {}, { bot: kind === "bot vs bot" }); const B = S.addSnake("B", {}, { bot: kind !== "player vs player" }); for (const s of [A, B]) if (s.ai) s.ai.t = 1e9;
  place(S, A, -3, 0, 0, mA); place(S, B, 3, 0, Math.PI, mB); const ev = [];
  for (let i = 0; i < 120 && A.alive && B.alive; i++) { A.ta = 0; B.ta = Math.PI; S.step(null); for (let j = 0; j < S.evDie.length; j += 3) ev.push([S.evDie[j], S.evDie[j + 1]]); S.drain(); }
  const W = A.alive ? A : B; ok(ev.length === 1 && A.alive !== B.alive && ev[0][1] === W.id, `offline head-on ${kind} (mass ${mA} vs ${mB}): exactly one dies, the survivor is credited`);
}

// ===== 3. candy pickup = visible outline =====
{ // the sim's candy radius is the 2D sprite edge: candySize2 * SPR_K * 1.09 (measured outer extent of the widest sprite type)
  let maxErr = 0; for (const v of [1, 1.5, 2, 3, 4.2, 5, 7.5, 14]) { maxErr = Math.max(maxErr, Math.abs(foodVisR(v) - candySize2(v, candyBig(v)) * SPR_K * 1.09)); if (foodBig(v) !== candyBig(v)) maxErr = 99; }
  ok(maxErr < 1e-9 && CANDY_SCALE === CS2 && CANDY_SCALE === 1.4, `sim candy radius == drawn candy edge for every value (max err ${maxErr.toExponential(1)}), scale ${CANDY_SCALE}`); }
for (const v of [1, 2, 3, 6]) { // offline: head disc edge overlapping the candy's visual edge eats it; just outside does not
  for (const [gap, want] of [[-0.05, true], [0.12, false]]) {
    const S = new Sim({ dt: 1 / 60, R: 120, seed: 6, powerups: false, events: [] }); for (let i = 0; i < S.FM; i++) if (S.fa[i]) S.removeFood(i, 0); S.drain();
    const s = S.snakes[0] || S.addSnake("Me", {}); place(S, s, 0, 0, 0, 60); const reach = s.r * HEAD_K + foodVisR(v) + gap; const f = S.spawnFood(0, reach, v, 3); S.buildGrid(); S.eat();
    ok(!S.fa[f] === want, `offline: candy v=${v} with its edge ${gap < 0 ? "overlapping the head edge by 0.05" : "0.12 clear of the head"} -> ${want ? "eaten" : "stays"}`); } }
for (const [gap, want] of [[-0.05, true], [0.12, false]]) { // worker path: real Room tick
  const R = room(); const c = join_(R, "Me"); const s = c.snake; const S = R.sim; for (let i = 0; i < S.FM; i++) if (S.fa[i]) S.removeFood(i, 0); S.drain(); S.foodTarget = 0;
  place(S, s, 0, 0, 0, 60); for (let i = 0; i < 6; i++) input(R, c, 0, 0); const step = C.SPEED / 30;
  const v = 2, reach = s.r * HEAD_K + foodVisR(v) + gap, f = S.spawnFood(step, reach, v, 3); R.tick();
  ok(!S.fa[f] === want, `worker: candy edge ${gap < 0 ? "overlapping the head edge" : "just clear of the head"} -> ${want ? "eaten" : "stays"}`); }
{ const r = radiusOf(24), v = 2; const n = r * HEAD_K + foodVisR(v), m = magReach(r) + foodVisR(v); ok(m / n > 1.8 && m / n < 2.6, `magnet reach ${m.toFixed(2)} vs normal ${n.toFixed(2)} (x${(m / n).toFixed(2)}) at start mass`); }

// ===== 4. clustered ambient food =====
for (const [label, mk] of [["offline", () => new Sim({ dt: 1 / 60, R: 240, seed: 9, powerups: false, events: [] })], ["worker", () => room().sim]]) {
  const S = mk(); let inC = 0, sz = []; for (const q of S.clu.values()) { inC += q.n; sz.push(q.n0); } const amb = S.ambN;
  ok(Math.abs(S.fCount - S.foodTarget) <= CL_MAX, `${label}: total food ${S.fCount} ~ target ${S.foodTarget}`);
  ok(S.singles / amb <= 0.1 && inC / amb >= 0.9, `${label}: ${(inC / amb * 100).toFixed(1)}% of food in ${S.clu.size} clusters, ${(S.singles / amb * 100).toFixed(1)}% singles`);
  ok(Math.min(...sz) >= CL_MIN && Math.max(...sz) <= CL_MAX, `${label}: cluster sizes ${Math.min(...sz)}..${Math.max(...sz)}`);
  // blob size: spread of each cluster's candies = 3..6 start-head widths across (allow slack for the scaled-up big clusters)
  const hw = 2 * radiusOf(C.START_M) * HEAD_K; let bad = 0; const by = new Map(); for (let i = 0; i < S.FM; i++) if (S.fa[i] && S.fcl[i] > 0) { const L = by.get(S.fcl[i]) || []; L.push(i); by.set(S.fcl[i], L); }
  for (const L of by.values()) { let D = 0; for (const a of L) for (const b of L) D = Math.max(D, Math.hypot(S.fx[a] - S.fx[b], S.fy[a] - S.fy[b])); if (D > 6 * hw * 1.2 + 1 || D < hw) bad++; }
  ok(bad === 0, `${label}: every cluster spans 1..7 head widths (${by.size} clusters, ${bad} outliers)`);
  // eat one cluster: it retires and a new cluster appears elsewhere
  const [id, q] = [...S.clu.entries()][0]; const { x, y } = q; let left = q.n; for (let i = 0; i < S.FM && left > Math.floor(q.n0 * 0.2); i++) if (S.fa[i] && S.fcl[i] === id) { S.removeFood(i, 0); left--; } // eat 80%
  const n0 = S.clu.size; S.feed(false); const nq = [...S.clu.values()].pop();
  ok(!S.clu.has(id) && Math.hypot(nq.x - x, nq.y - y) > 10, `${label}: a mostly eaten cluster retires and respawns elsewhere (${Math.hypot(nq.x - x, nq.y - y).toFixed(0)} units away)`);
}
// ===== 5. fairness: bots and players run identical physics =====
{ const S = new Sim({ dt: 1 / 60, R: 200, seed: 2, powerups: false, events: [] }); const P = S.addSnake("P", {}), B = S.addSnake("B", {}, { bot: true }); let maxD = 0;
  for (const m of [24, 300, 3000]) { place(S, P, 0, 0, 0, m); place(S, B, 0, 0, 0, m); P.bot = false; B.bot = true;
    for (let i = 0; i < 240; i++) { const ta = Math.sin(i / 17) * 3, bo = (i >> 5) & 1; P.ta = B.ta = ta; P.boost = B.boost = bo; moveSnake(P, 1 / 60, true); moveSnake(B, 1 / 60, true); maxD = Math.max(maxD, Math.hypot(P.x - B.x, P.y - B.y), Math.abs(P.a - B.a)); } }
  ok(maxD < 1e-9, `bot and player steering/speed/boost are bit-identical (max diff ${maxD})`);
  place(S, P, 0, 0, 0, 300); place(S, B, 10, 10, 0, 300); ok(P.r === B.r && P.len === B.len, "same mass -> same radius / length / hitbox"); }

// ===== noself1b: the worker's catch-up path (a lagging human's 2nd queued input in one tick) eats, pays boost and collides like step =====
{ const R = room(); const c = join_(R, "Me"), S = R.sim, s = c.snake; place(S, s, 0, 0, 0, 60); for (let i = 0; i < S.FM; i++) if (S.fa[i]) S.removeFood(i, 0); S.drain && S.drain();
  for (let i = 0; i < 20; i++) input(R, c, 0, 0); const d = C.SPEED / 30, reach = s.r * HEAD_K + foodVisR(2);
  const fi = S.spawnFood(d - reach + 0.05, 0, 2, 1); S.fBorn[fi] = 0; S.feed = () => {}; const m0 = s.m; R.tick();
  ok(Math.abs(s.x - 2 * d) < 1e-6 && !S.fa[fi] && s.m > m0, `worker catch-up move eats a candy touched only at the intermediate position (x ${s.x.toFixed(3)}, mass ${m0}->${s.m.toFixed(2)})`); }
{ const R = room(); const c = join_(R, "Me"), S = R.sim, s = c.snake; place(S, s, 0, 0, 0, 300); const c2 = join_(R, "Ref"), s2 = c2.snake; place(S, s2, 0, 60, 0, 300); for (let i = 0; i < S.FM; i++) if (S.fa[i]) S.removeFood(i, 0); S.feed = () => {};
  for (let i = 0; i < 20; i++) input(R, c, 0, 1); for (let i = 0; i < 2; i++) input(R, c2, 0, 1); R.tick();
  const l1 = 300 - s.m, l2 = 300 - s2.m; ok(Math.abs(l1 - 2 * l2) < 1e-3 && l2 > 0, `worker catch-up move pays boost like step (2 moves cost ${l1.toFixed(4)}, 1 move ${l2.toFixed(4)})`); }
{ const R = room(); const c = join_(R, "Me"), S = R.sim, s = c.snake; const B = S.addSnake("Body", {}, { bot: true, diff: 1 }); B.ai.t = 1e9; place(S, B, 0, 10, Math.PI / 2, 400); B.ta = Math.PI / 2; S.botThink = () => {}; S.botReflex = () => {};
  let k = 0; const oc = S.collide; S.collide = function (o) { if (o) k++; return oc.call(this, o); }; for (let i = 0; i < S.FM; i++) if (S.fa[i]) S.removeFood(i, 0); S.feed = () => {};
  place(S, s, -B.r * HEAD_K - s.r * HEAD_K + 0.02 - C.SPEED / 30, 0, 0, 24); for (let i = 0; i < 20; i++) input(R, c, 0, 0); R.tick();
  const dm = deaths(R).find((m) => m.id === s.id);
  ok(k === 1 && !s.alive && dm && dm.by === B.id && dm.cause === 2, `worker catch-up move runs the body collision at the intermediate position (catch-up collide calls ${k}, died ${!s.alive}, killer ${dm && dm.by === B.id ? "Body" : dm && dm.by})`); }
console.log(fail ? `${fail} FAILED` : "ALL PASS"); process.exit(fail ? 1 : 0);
