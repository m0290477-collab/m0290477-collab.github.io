// popq: achievement pop-ups queue while the results card is up and show one by one after it is dismissed.
// Unit test of js/achq.js with a fake clock + source checks that ui.js routes every achievement pop-up through the queue.
import { readFileSync } from "node:fs";
const { makeAchQueue } = await import("../js/achq.js");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };

// fake clock
let now = 0, timers = []; const later = (f, ms) => { const id = timers.length + 1; timers.push({ at: now + ms, f, id }); return id; };
const run = (ms) => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const x = timers[0]; if (!x || x.at > end) break; timers.shift(); now = x.at; x.f(); } now = end; };

let card = true, hud = false; const shown = [];
const Q = makeAchQueue({ blocked: () => card, show: (a) => shown.push({ id: a.id, t: now }), gap: () => (hud ? 3900 : 650), later });
const A4 = [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }];
Q.addAll(A4); run(10000);
ok(shown.length === 0 && Q.size === 4, "4 achievements at match end: nothing pops up while the results card is up");
Q.drain(); run(0); ok(shown.length === 0, "drain while the card is still up shows nothing");
card = false; Q.drain(); run(5000);
ok(shown.map((s) => s.id).join() === "a1,a2,a3,a4", "after dismiss all 4 show, in unlock order");
ok(shown.every((s, i) => i === 0 || s.t - shown[i - 1].t === 650), "menus: one every 650 ms (" + shown.map((s) => s.t).join(",") + ")");
ok(Q.size === 0, "queue empty after drain");

// dismissed into a new match (HUD on: one toast at a time) -> spaced by a full toast life so none evicts another
shown.length = 0; card = true; Q.addAll([{ id: "b1" }, { id: "b2" }]); card = false; hud = true; Q.drain(); run(10000);
ok(shown.length === 2 && shown[1].t - shown[0].t === 3900, "in a match: spaced 3.9 s (toast lives 3.5 s + 0.32 s fade)");

// card comes back mid-drain (e.g. watch killer -> back to results): the rest waits again
shown.length = 0; hud = false; card = false; Q.addAll([{ id: "c1" }, { id: "c2" }, { id: "c3" }]); run(0);
ok(shown.length === 1, "no card: the first shows at once (old behaviour outside results)");
card = true; run(5000); ok(shown.length === 1 && Q.size === 2, "card back up: the rest waits");
card = false; Q.drain(); run(5000); ok(shown.map((s) => s.id).join() === "c1,c2,c3", "dismissed again: the rest shows");

// a single unlock in a menu (no card) still shows immediately
shown.length = 0; Q.add({ id: "d1" }); run(0); ok(shown.length === 1 && shown[0].id === "d1", "single unlock in a menu: immediate");

// ui.js wiring (source checks)
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
const sr = ui.slice(ui.indexOf("  showResults(r) {"), ui.indexOf("\n  }\n", ui.indexOf("  showResults(r) {")));
ok(sr.length > 100 && !/this\.toast\([^)]*achUnlocked/.test(sr) && /this\.achQ\.addAll\(r\.ach\)/.test(sr), "showResults queues achievements instead of toasting them");
ok(/r-extra/.test(sr) && /for \(const a of r\.ach\) ex\.push/.test(sr), "achievements are still listed inside the results card");
ok((ui.match(/achUnlocked/g) || []).length === 1, "ui.js has exactly one achievement pop-up path (the queue's show)");
ok(/checkAch\(\) \{ for \(const a of this\.S\.checkAch\(\)\) \{ this\.achQ\.add\(a\)/.test(ui), "checkAch() goes through the queue");
ok(/hideResults\(\) \{[^\n]*this\.achQ\.drain\(\)/.test(ui) && /goLobby\(\) \{[^\n]*this\.achQ\.drain\(\)/.test(ui) && /"r-again"[^\n]*this\.achQ\.drain\(\)/.test(ui), "drained on lobby, play again and watch-killer");
const st = readFileSync(new URL("../js/store.js", import.meta.url), "utf8");
ok(/checkAch\(\) \{ const out = \[\]; for \(const \[id, ic, f, r\] of Store\.ACH\) if \(!this\.p\.ach\[id\] && f\(this\.p, this\)\) \{ this\.p\.ach\[id\] = Date\.now\(\); const c = ACH_COINS\[id\] \?\? r; this\.p\.coins \+= c; claim\("ach"/.test(st), "coin grant in Store.checkAch unchanged (pop-up timing only)");
console.log(fail ? "FAIL " + fail : "PASS"); process.exit(fail ? 1 : 0);
