// M2 sim checks: new power-ups (dash, giant, food rain; invisibility retired in fix1) and arena events (gold rain, meteors, bounty).
import { Sim, PU, PU_DUR, GIANT_K, GOLD_FC, radiusOf } from "../js/sim.js";
let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
const run = (S, sec) => { for (let i = 0; i < sec * 60; i++) S.step(null); };

{ // dash: faster, free, passes through bodies
  const S = new Sim({ dt: 1 / 60, R: 200, seed: 3, powerups: false, events: [] }); const a = S.addSnake("A", {}, { pos: [0, 0], m: 60 }); a.reset(0, 0, 0, 60); /* fix1: heading and seeded tail agree (a bare a.a = 0 could point the head back into its own tail) */
  const x0 = a.x; run(S, 0.5); const v0 = (a.x - x0) / 0.5; S.applyPu(a, PU.DASH); const x1 = a.x, m1 = a.m; run(S, 0.5); const v1 = (a.x - x1) / 0.5;
  ok(v1 > v0 * 2.5, `dash speed ${v0.toFixed(1)} -> ${v1.toFixed(1)}`); ok(a.m >= m1 - 0.01, "dash costs no mass");
  run(S, 1.5); ok(a.pu[PU.DASH] === 0, "dash ends");
}
{ // giant: radius x1.6 for 10 s, then back
  const S = new Sim({ dt: 1 / 60, R: 200, seed: 4, powerups: false, events: [] }); const a = S.addSnake("A", {}, { pos: [0, 0], m: 100 }); const r0 = a.r;
  S.applyPu(a, PU.GIANT); ok(Math.abs(a.r / r0 - GIANT_K) < 0.01, `giant radius x${(a.r / r0).toFixed(2)}`);
  run(S, PU_DUR[PU.GIANT] + 0.2); ok(Math.abs(a.r - radiusOf(a.m)) < 0.01, "giant restores radius");
}
{ // food rain: ~100 orbs around the head
  const S = new Sim({ dt: 1 / 60, R: 200, seed: 5, powerups: false, events: [] }); const a = S.addSnake("A", {}, { pos: [0, 0], m: 60 }); a.god = true;
  const n0 = S.fCount; S.applyPu(a, PU.RAIN); run(S, 2.5); ok(S.fCount - n0 > 60, `food rain spawned ${S.fCount - n0}`);
}
{ // fix1: invisibility retired: applying it does nothing, it never spawns
  const S = new Sim({ dt: 1 / 60, R: 200, seed: 6, powerups: false, events: [] }); const me = S.addSnake("Me", {}, { pos: [0, 0], m: 40 });
  S.applyPu(me, 8); ok(me.pu[8] === 0, "invisibility has no effect");
}
{ // meteor: an impact kills a head inside the circle, shield saves, food drops
  const S = new Sim({ dt: 1 / 60, R: 200, seed: 7, powerups: false, events: [] }); const a = S.addSnake("A", {}, { pos: [10, 10], m: 60 }); const b = S.addSnake("B", {}, { pos: [-60, -60], m: 60 }); b.pu[PU.SHIELD] = 20;
  a.vk = 0.0001; b.vk = 0.0001; S.addMeteor(a.x, a.y); S.addMeteor(b.x, b.y); let cause = -1; for (let i = 0; i < 150; i++) { S.step(null); for (let j = 0; j < S.evDie.length; j += 3) if (S.evDie[j] === a.id) cause = S.evDie[j + 2]; S.drain(); }
  ok(!a.alive && cause === 6, "meteor kills (cause 6)"); ok(b.alive && b.pu[PU.SHIELD] === 0, "shield absorbs a meteor");
}
{ // events cycle: rain drops gold near the human, meteor + bounty run, bounty claim announced
  const S = new Sim({ dt: 1 / 60, R: 200, seed: 8, /* long1: seed 9 now starts rain as the 3rd event, so the loop exits before any rain gold; seed 8 rolls all three with rain first */  powerups: false, events: true, evtFirst: 1 }); const me = S.addSnake("Me", {}, { pos: [0, 0], m: 60 }); me.god = true;
  for (let i = 0; i < 12; i++) S.addSnake("Bot" + i, {}, { bot: true, m: 80 + i * 10, diff: 1 });
  const seen = new Set(); let gold = 0, mets = 0, claim = null;
  for (let i = 0; i < 60 * 400 && seen.size < 3; i++) { S.step(null); for (const e of S.evEvt) { if (e.ph === "start") seen.add(e.k); if (e.ph === "claim") claim = e; if (e.k === "bounty" && e.ph === "start") { const bb = S.byId.get(e.id); if (bb) S.kill(bb, me.id, 2); } }
    for (const fi of S.evSpawn) if (S.fc[fi] === GOLD_FC) gold++; mets += S.evMet.length; S.drain(); }
  ok(seen.has("rain") && gold > 50, `gold rain (${gold} gold orbs)`); ok(seen.has("meteor") && mets > 10, `meteor shower (${mets} meteors)`); ok(seen.has("bounty") && claim && claim.by === me.id, "bounty started and claimed by the killer");
}
console.log(fail ? `${fail} FAILED` : "ALL PASS"); process.exit(fail ? 1 : 0);
