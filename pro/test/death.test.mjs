// Per-mode death rules on the shared sim (node test/death.test.mjs): every mode except Zen must kill the player on a
// wall hit and on another snake's body; Zen must survive both. noself1: NOBODY ever dies on its own body (slither rules),
// not even holding a full-lock turn into a tight circle, with or without boost, offline or online (netMode). Arena sizes come from the real MODES table.
import { Sim } from "../js/sim.js";
const MODES = { classic: 240, time: 205, survival: 200, zen: 200, br: 300, koth: 190, boss: 190, team: 220, online: 240 };
let fail = 0;
const tp = (s, x, y, a) => { const da = a - s.a, c = Math.cos(da), sn = Math.sin(da), ox = s.x, oy = s.y; for (let i = 0; i < s.px.length; i++) { const rx = s.px[i] - ox, ry = s.py[i] - oy; s.px[i] = x + rx * c - ry * sn; s.py[i] = y + rx * sn + ry * c; } s.x = x; s.y = y; s.a = s.ta = a; s.av = 0; }; // fix1: the body turns with the head
for (const [mode, R] of Object.entries(MODES)) for (const kind of ["wall", "body", "self", "selfboost"]) {
  const S = new Sim({ dt: mode === "online" ? 1 / 30 : 1 / 60, R, seed: 7, walls: true, netMode: mode === "online", powerups: false });
  if (mode === "team") S.teams = true;
  const me = S.addSnake("me", { k: "skin", i: 0 }, { god: mode === "zen" }); if (mode === "team") me.team = 0;
  const o = S.addSnake("bot", { k: "skin", i: 1 }, { m: 200 }); if (mode === "team") o.team = 1;
  for (let i = 0; i < 120; i++) { o.ta = 0; S.step(null); S.drain(); if (!me.alive) break; tp(me, -R * 0.5, -R * 0.5, 0); }
  tp(o, 0, 0, 0); for (let i = 0; i < 90; i++) { o.ta = 0; S.step(null); S.drain(); me.alive || (me.alive = true); tp(me, -R * 0.5, -R * 0.5, 0); }
  me.alive = true; me.pu.fill(0); me.inv = 0;
  if (kind === "wall") tp(me, R - me.r * 0.6 - 0.8, 0, 0);
  else if (kind === "self" || kind === "selfboost") { tp(me, -R * 0.3, R * 0.3, 0); me.setMass(kind === "selfboost" ? 400 : 60); }
  else { let k = 1, d = 0; while (k < o.n - 1 && d < o.len * 0.4) { d += Math.hypot(o.sx(k) - o.sx(k - 1), o.sy(k) - o.sy(k - 1)); k++; } tp(me, o.sx(k), o.sy(k) - 2.2, Math.PI / 2); o.ta = o.a; }
  let dead = false, how = null; const self = kind.startsWith("self"); for (let i = 0; i < (self ? 60 * 12 : 180) && !dead; i++) { me.ta = self ? me.a + 1.4 : me.a; me.boost = kind === "selfboost" ? 1 : 0;  /* self: hold a full-lock turn and curl into the own body */ if (kind === "body") { o.ta = o.a; o.boost = 0; } S.step(null); for (let j = 0; j < S.evDie.length; j += 3) if (S.evDie[j] === me.id) how = S.evDie[j + 1] === me.id ? "self" : S.evDie[j + 1] ? "body" : S.evDie[j + 2] === 1 ? "wall" : "cause" + S.evDie[j + 2]; S.drain(); dead = !me.alive; }
  const ok = self || mode === "zen" ? !dead : dead && how === kind; if (!ok) fail++;
  console.log((ok ? "PASS" : "FAIL") + ` ${mode} ${kind} -> ${dead ? "died (" + how + ")" : "alive"}`);
}
console.log(fail ? `FAILURES ${fail}` : "ALL PASS"); process.exit(fail ? 1 : 0);
