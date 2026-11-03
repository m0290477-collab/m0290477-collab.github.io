// fix1 sim checks (node test/fix1.test.mjs): self-collision death, ghost/invisibility gone, magnet pull, steering response.
import { Sim, C, PU, PU_DUR, PU_TIMED, HEAD_K, magReach, moveSnake, angDiff, selfNeck, turnOf, radiusOf } from "../js/sim.js";
import { readFileSync } from "node:fs";
let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
const mk = (o = {}) => new Sim({ dt: 1 / 60, R: 200, seed: 11, powerups: false, events: [], ...o });
const add = (S, m, o = {}) => { const s = S.addSnake("A", {}, { pos: [0, 0], m, ...o }); s.reset(0, 0, 0, m); s.bot = !!o.bot; if (s.bot) s.ai = { t: 99999, mode: 0, wa: 0, diff: 1 }; return s; };
const deathOf = (S, id) => { for (let j = 0; j < S.evDie.length; j += 3) if (S.evDie[j] === id) return [S.evDie[j + 1], S.evDie[j + 2]]; return null; };

// ---- self-collision ----
for (const m of [24, 60, 300, 3000]) {
  const S = mk(); const a = add(S, m); let died = null, t = 0;
  for (let i = 0; i < 60 * 12 && a.alive; i++) { a.ta = a.a + 1.4; S.step(null); const d = deathOf(S, a.id); if (d) died = d; S.drain(); t++; }
  ok(!a.alive && died && died[0] === a.id && died[1] === 2, `player (mass ${m}) holding a full-lock turn curls into its own body and dies (self-credited, cause 2) after ${(t / 60).toFixed(2)} s`);
}
{ const S = mk(); const a = add(S, 300); let alive = true; // U-turn then straight back alongside the own body: no contact, no death
  for (let i = 0; i < 60 * 4; i++) { a.ta = i < 60 * 0.6 ? Math.PI : Math.PI; S.step(null); S.drain(); alive = alive && a.alive; }
  ok(alive, "a held 180° U-turn back alongside the own body is safe");
  const S2 = mk(); const b = add(S2, 300); let al2 = true; for (let i = 0; i < 60 * 6; i++) { b.ta = Math.sin(i / 20) * 0.9; S2.step(null); S2.drain(); al2 = al2 && b.alive; } ok(al2, "weaving left/right never self-kills");
  const S3 = mk(); const c = add(S3, 3000); c.slow = 99; let al3 = true; for (let i = 0; i < 60 * 1.2; i++) { c.ta = Math.PI; S3.step(null); S3.drain(); al3 = al3 && c.alive; } ok(al3, "a frozen (slow) big snake can still U-turn without touching its neck");
}
{ const S = mk(); const a = add(S, 300, { bot: true }); for (let i = 0; i < 60 * 6; i++) { a.ta = a.a + 1.4; a.boost = 0; S.step(null); S.drain(); } ok(a.alive, "bots keep slither rules (no self-collision)"); }
{ const S = mk(); const a = add(S, 60); a.pu[PU.SHIELD] = 20; let saved = false; for (let i = 0; i < 60 * 8 && a.alive; i++) { a.ta = a.a + 1.4; S.step(null); if (S.evShield.length) saved = true; S.drain(); }
  ok(saved && !a.alive, "a shield absorbs the first self-hit, the next one kills"); }
{ const S = mk(); const a = add(S, 60); a.god = true; for (let i = 0; i < 60 * 6; i++) { a.ta = a.a + 1.4; S.step(null); S.drain(); } ok(a.alive, "Zen (god) never self-kills"); }
{ const S = mk(); const a = add(S, 300); a.pu[PU.DASH] = 9; for (let i = 0; i < 60 * 6 && a.alive; i++) { a.ta = a.a + 1.4; a.pu[PU.DASH] = 9; S.step(null); S.drain(); } ok(!a.alive, "dash still dies on the own body"); }
{ // client-side Sim.selfHit (online instant self-report) agrees with the server's collide
  let agree = 0, n = 0; for (const m of [40, 300]) { const S = mk(); const a = add(S, m); const tmp = new Float32Array(1400);
    for (let i = 0; i < 60 * 10 && a.alive; i++) { a.ta = a.a + 1.4; const pre = Sim.selfHit(a, tmp); S.buildGrid(); const was = a.alive; S.collide(); n++; if (pre === (was && !a.alive)) agree++; if (!a.alive) break; moveSnake(a, S.dt, false); } }
  ok(agree === n, `Sim.selfHit matches collide on ${agree}/${n} ticks`); }
// ---- ghost / invisibility removed ----
{ const S = new Sim({ dt: 1 / 60, R: 200, seed: 12, powerups: false, events: [] }); const k = new Array(11).fill(0); for (let i = 0; i < 6000; i++) { const p = S.spawnPu(); k[p.k]++; S.pus.length = 0; }
  ok(k[4] === 0 && k[8] === 0, `6000 spawns: ghost ${k[4]}, invisibility ${k[8]}`);
  ok(Math.abs(k[0] / 6000 - 25 / 105) < 0.03, `magnet share ${(k[0] / 60).toFixed(1)}% (ghost's 10 added to magnet's 15 of 105)`);
  const p = S.spawnPu(4, 0, 0); ok(p.k === PU.MAG, "a forced ghost spawn turns into a magnet"); }
{ const S = mk(); const a = add(S, 60); S.applyPu(a, 4); S.applyPu(a, 8); ok(a.pu[4] === 0 && a.pu[8] === 0 && PU_DUR[4] === 0 && PU_DUR[8] === 0, "ghost / invisibility have no effect when given");
  ok(!PU_TIMED.includes(4) && !PU_TIMED.includes(8), "no HUD chip for ghost / invisibility");
  const i18n = readFileSync(new URL("../js/i18n.js", import.meta.url), "utf8"); ok(!/\bpu_4\b|\bpu_8\b/.test(i18n), "ghost / invisibility translations removed");
  const S2 = mk(); const B = S2.addSnake("B", {}, { pos: [0, 0], m: 200 }); B.reset(0, 0, 0, 200); const A = S2.addSnake("A", {}, { pos: [-B.len * 0.4, 0.2], m: 24 }); A.reset(-B.len * 0.4, 0.2, Math.PI / 2, 24); A.pu[4] = 5;
  S2.buildGrid(); S2.collide(); ok(!A.alive, "a stale ghost timer no longer passes through bodies"); }
// ---- magnet ----
{ const S = mk(); const a = add(S, 300); for (let i = 0; i < S.FM; i++) if (S.fa[i]) S.removeFood(i, 0); S.drain();
  const R0 = magReach(a.r); ok(Math.abs(R0 - Math.max(2.5 * HEAD_K * a.r, a.r + 2.2)) < 1e-9, `magnet reach = 2.5 x head radius (min r + 2.2): ${R0.toFixed(2)} at r ${a.r.toFixed(2)}`);
  const f1 = S.spawnFood(a.x, a.y + R0 * 0.9, 2, 1), f2 = S.spawnFood(a.x, a.y - (R0 + 0.6), 2, 1); const m0 = a.m;
  a.vk = 0.0001; S.buildGrid(); S.eat(); ok(S.fa[f1] && S.fa[f2], "without magnet: food at 0.9 x reach stays");
  S.applyPu(a, PU.MAG); ok(Math.abs(a.pu[PU.MAG] - 6) < 1e-9 && PU_DUR[PU.MAG] === 6, "magnet lasts 6 s");
  S.buildGrid(); S.eat(); ok(!S.fa[f1] && S.fa[f2] && a.m > m0, "with magnet: food inside the reach is pulled in and eaten, food outside stays");
  for (let i = 0; i < 6.1 * 60; i++) { a.ta = a.a; S.step(null); S.drain(); } ok(a.pu[PU.MAG] === 0, "magnet ends after 6 s"); }
// ---- steering ----
{ for (const m of [24, 3000]) { const S = mk(); const a = add(S, m); const D = 10 * Math.PI / 180; a.ta = D; let t = -1; for (let i = 0; i < 120; i++) { moveSnake(a, 1 / 60, false); if (Math.abs(angDiff(D, a.a)) < 2 * Math.PI / 180) { t = (i + 1) / 60; break; } }
    ok(t > 0 && t <= 0.07, `10° correction lands within 2° in ${Math.round(t * 1000)} ms (mass ${m}); was 183 ms`); }
  const S = mk(); const a = add(S, 60); a.ta = Math.PI / 2; let over = 0; for (let i = 0; i < 120; i++) { moveSnake(a, 1 / 60, false); over = Math.max(over, -angDiff(Math.PI / 2, a.a)); } ok(over < 1e-6, "no overshoot / wobble on a 90° turn"); }
console.log(fail ? `${fail} FAILED` : "ALL PASS"); process.exit(fail ? 1 : 0);
