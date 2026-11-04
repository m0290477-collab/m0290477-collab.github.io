// store1: watchdog + save repair (Node, mocked browser globals). A REAL main-thread freeze (busy loop) must be detected
// and logged; a frozen game loop must be restarted; errors land in the local ring buffer (max 30); a corrupt save with
// no backup is kept aside (ssp-corrupt) instead of being lost; WebGL listener hooks fire.
const mem = new Map();
globalThis.window = globalThis; globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const L = {}; globalThis.addEventListener = (e, f) => { (L[e] = L[e] || []).push(f); };
globalThis.document = { hidden: false, addEventListener: (e, f) => { (L["doc:" + e] = L["doc:" + e] || []).push(f); }, documentElement: { lang: "en", dir: "ltr", classList: { contains: () => false, toggle() {}, add() {}, remove() {} } } };
globalThis.matchMedia = () => ({ matches: false }); globalThis.cancelAnimationFrame = () => {}; globalThis.requestAnimationFrame = () => 0;
try { globalThis.navigator = globalThis.navigator || { language: "en" }; } catch (_) {}
globalThis.sessionStorage = { getItem: () => null, setItem() {} }; globalThis.location = { reload() {} };
const { Store, KV, readErrLog, logErr } = await import("../js/store.js");
const { startWatchdog, watchCanvas, onGL } = await import("../js/watchdog.js");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --- corrupt save, NO backup: profile starts fresh but the raw text is kept aside, and it is logged
mem.clear(); mem.set("ssp-guest", '{"v":1,"name":"Molier","coins":4'); for (const [k, v] of mem) KV.set(k, v);
let S = new Store(); ok(S.repairs.includes("guest:lost"), "no-backup corruption detected (" + S.repairs + ")");
const cor = JSON.parse(KV.get("ssp-corrupt") || "null"); ok(cor && cor.k === "ssp-guest" && cor.raw.startsWith('{"v":1,"name":"Molier"'), "unreadable save kept aside in ssp-corrupt (not wiped)");
ok(readErrLog().some((e) => e.k === "save"), "corruption logged in the local error ring");
// --- ring buffer cap
for (let i = 0; i < 50; i++) logErr("t", "e" + i); const R = readErrLog(); ok(R.length === 30 && R[29].m === "e49", "error ring keeps the newest 30");
// --- watchdog: real freeze
let restarted = 0, recovered = [];
const app = { ready: true, store: { settings: { quality: "manual" } }, ui: { toast() {}, goLobby() {} }, renderer: { is2D: true },
  game: { backend: { me: {} }, mode: "classic", ended: false, matchT0: -1e9, fi: 1, lastFrame: 0, raf: 1, startLoop() { restarted++; this.fi++; }, stopMatch() {} },
  gov: { onStall: (w) => { recovered.push(w); return true; } } };
const W = startWatchdog(app); await sleep(600);
const t0 = Date.now(); while (Date.now() - t0 < 3200) {} // freeze the main thread for 3.2 s
await sleep(700);
ok(readErrLog().some((e) => e.k === "stall" && /ms in match/.test(e.m)), "3.2 s main-thread freeze detected and logged (" + (readErrLog().filter((e) => e.k === "stall").map((e) => e.m).join(",")) + ")");
ok(recovered.length === 0, "explicit quality choice: freeze only logged, no graphics change");
// frozen game loop: the frame counter stops moving -> restarted within ~5 s
app.game.fi = 7; app.game.startLoop = function () { restarted++; }; // counter stays frozen
await sleep(5600); ok(restarted >= 1 && W.restarts >= 1, "frozen game loop restarted (" + W.restarts + ")"); ok(readErrLog().some((e) => e.k === "loop"), "loop restart logged");
// errors -> ring; 5 within 20 s in a match -> back to lobby
let lobby = 0; app.ui.goLobby = () => lobby++; for (let i = 0; i < 5; i++) for (const f of L.error || []) f({ error: new Error("boom" + i) });
ok(lobby === 1 && readErrLog().filter((e) => e.k === "error").length >= 5, "error burst in a match -> safe return to the lobby");
// GL listener hooks
const H = {}; const cv = { addEventListener: (e, f) => (H[e] = f) }; const seen = []; const off = onGL((k) => seen.push(k)); watchCanvas(cv); H.webglcontextlost(); H.webglcontextrestored(); off(); H.webglcontextlost();
ok(seen.join() === "lost,restored" && readErrLog().some((e) => e.k === "gl"), "WebGL lost/restored hooks fire and log; unsubscribe works");
console.log(fail ? "FAILED " + fail : "ALL PASS"); process.exit(fail ? 1 : 0);
