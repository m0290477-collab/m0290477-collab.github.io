// perf2: render governor settles (no oscillation), steps down fast, caps 30 under sustained load, ignores non-auto
import { Governor } from "../js/gov.js";
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function run(cost, secs, opt = {}) { const G = new Governor(); let L = 0, t = 0, firstDrop = 0; const lv = [];
  while (t < secs * 1000) { let ms = Math.max(16.7, cost[L] * (0.9 + rnd() * 0.25)); const cap = G.fpsCap(60); if (cap) ms = Math.max(ms, 1000 / cap); t += ms;
    G.sample(ms, t, { auto: opt.auto !== false, inMatch: true, menu: !!opt.menu, target: 16.7, apply: (l) => { L = l; if (!firstDrop && l > 0) firstDrop = t; } }); lv.push(L); }
  return { G, L, firstDrop, lv }; }
{ const r = run([30, 22, 16.2, 14], 600); const late = r.G.log.filter((x) => x[0] > 120000).length;
  ok(r.firstDrop > 0 && r.firstDrop < 2500, "steps down within 2.5 s of slow frames (" + Math.round(r.firstDrop) + " ms)");
  ok(late <= 6, "settles: " + late + " level changes in minutes 2-10 (probes at most every ~2 min)"); ok(r.L >= 1, "ends at a level that holds (L" + r.L + ")"); }
{ const r = run([14, 14, 14, 14], 60); ok(r.G.log.length === 0 && r.L === 0, "fast device never changes level"); }
{ const r = run([60, 50, 45, 40], 60); ok(r.L === 3 && r.G.log.some((x) => x[2] === 30), "sustained heavy load -> L3 + 30 fps cap"); }
{ const r = run([60, 50, 45, 40], 30, { auto: false }); ok(r.L === 0 && r.G.log.length === 0 && r.G.fpsCap(60) === 60, "explicit quality: governor idle"); }
{ const G = new Governor(); G.sample(16, 1, { auto: true, menu: true, inMatch: false, target: 16.7, apply() {} }); ok(G.fpsCap(60) === 30 && G.fpsCap(0) === 30, "menus capped at 30"); G.sample(16, 2, { auto: true, menu: false, inMatch: true, target: 16.7, apply() {} }); ok(G.fpsCap(0) === 0 && G.fpsCap(60) === 60, "match uncapped / user cap kept"); }
console.log(fail ? "FAILED " + fail : "ALL PASS");
