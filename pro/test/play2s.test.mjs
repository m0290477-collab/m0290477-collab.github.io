// play2 server checks: crown bounty (room #1, paid on kill within the online day cap), weekend mutators (schedule, owner override, sim rules), offline claims refused for a switched-off mode, flag price editable
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
process.env.TZ = "UTC";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-p2s-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
const W = await import(join(dir, "index.js")); const E = await import(join(dir, "econ.js")); const SK = await import(join(dir, "skins.js"));
class Sql { constructor() { this.db = new DatabaseSync(":memory:"); }
  exec(q, ...b) { const st = this.db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...b).map((r) => ({ ...r })); return { toArray: () => rows, one: () => rows[0] }; } st.run(...b); return { toArray: () => [], one: () => undefined }; } }
class FakeWs { constructor() { this.out = []; this.att = null; this.open = true; this.code = 0; this.L = {}; } send(s) { if (!this.open) throw new Error("closed"); this.out.push(typeof s === "string" ? JSON.parse(s) : s); }
  serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); } deserializeAttachment() { return this.att; } close(c) { this.open = false; this.code = c || 1000; } accept() {} addEventListener(k, f) { this.L[k] = f; } }
globalThis.WebSocketPair = function () { const a = new FakeWs(), b = new FakeWs(); return { 0: a, 1: b }; };
const R0 = globalThis.Response; globalThis.Response = class extends R0 { constructor(b, i) { super(b, i && i.status === 101 ? { ...i, status: 200 } : i); if (i && i.webSocket) this.webSocket = i.webSocket; } };
globalThis.fetch = (u) => Promise.reject(new Error("no network in tests: " + u));
const TEST_KEY = "k-" + Math.random().toString(36).slice(2);
const objs = new Map(); const env = { TEST_KEY, ROOMS: { idFromName: (x) => x, get: (id) => ({ fetch: (u, init) => obj(id).fetch(u instanceof Request ? u : new Request(u, init)) }) } };
const obj = (id) => { let o = objs.get(id); if (!o) { const tags = new Map(), all = [];
  o = new W.Room({ storage: { sql: new Sql() }, tags, acceptWebSocket: (ws, t) => { all.push(ws); for (const x of t) { if (!tags.has(x)) tags.set(x, []); tags.get(x).push(ws); } }, getWebSockets: (t) => (t === undefined ? all : tags.get(t) || []).filter((w) => w.open), setWebSocketAutoResponse() {} }, env); objs.set(id, o); } return o; };
const S = () => obj("social-v1"), q = () => S().sdb();
const pk = (k) => k.toString(16).padStart(32, "0"); const pidOf = async (k) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + k)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); };
const post = async (path, body) => (await W.default.fetch(new Request("https://w" + path, { method: "POST", body: JSON.stringify(body), headers: { origin: "https://billke.com" } }), env)).json();
const op = (k, o, extra = {}) => post("/s", { pk: pk(k), op: o, ...extra });
const aop = (k, o, extra = {}) => post("/a", { pk: pk(k), op: o, ...extra });
const M = await import(join(dir, "sim.js"));
const A = async (k, o, x = {}) => op(k, o, x);
const P1 = await pidOf(pk(1)), P2 = await pidOf(pk(2));
await op(1, "w_get"); await op(2, "w_get"); q().exec("UPDATE acct SET own = 1, t = ? WHERE pid = ?", Date.now() - 864e5, P1);
q().exec("UPDATE acct SET t = ? WHERE pid = ?", W.MIG.CUT - 864e5, P2); await op(2, "w_mig", { coins: 1000, lv: 5 });
// 1) schedule: Fri 00:00 - Sun 23:59 UTC, one rule per weekend, rotating through the 4
const wk = (d) => M.weekendMut(Date.parse(d));
ok(wk("2026-11-05T23:59:59Z") === "" && wk("2026-11-09T00:00:00Z") === "", "no rule Mon-Thu");
ok(wk("2026-11-06T00:00:00Z") && wk("2026-11-06T00:00:00Z") === wk("2026-11-08T23:59:59Z"), "same rule from Fri 00:00 to Sun 23:59 UTC");
const four = ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"].map((d) => wk(d + "T12:00:00Z")); ok(new Set(four).size === 4 && four.every((k) => M.MUTS.includes(k)), "4 weekends in a row = the 4 safe rules " + four.join(","));
ok(wk("2026-12-04T12:00:00Z") === four[0], "rotation repeats weekly (every 4 weekends)");
ok(M.mutNow("off", Date.parse("2026-11-07T12:00:00Z")) === "" && M.mutNow("fb", Date.parse("2026-11-04T12:00:00Z")) === "fb" && M.mutNow("auto", Date.parse("2026-11-07T12:00:00Z")) === four[0], "override: off / forced rule / auto");
// 2) the sim rules
{ const S = new M.Sim({ seed: 3, netMode: true }); S.mut = "bs"; const a = S.addSnake("a", { k: "skin", i: 0 }, {}); ok(Math.round(a.m) === M.C.START_M * 3, "big start: start mass x3 (" + Math.round(a.m) + ")");
  S.mut = "fb"; a.setMass(200); a.boost = 1; for (let i = 0; i < 30; i++) S.moveOne(a, 1 / 30); ok(a.m === 200, "free boost: boosting costs no mass");
  S.mut = ""; for (let i = 0; i < 30; i++) S.moveOne(a, 1 / 30); ok(a.m < 200, "normal: boosting costs mass");
  const fe = (k) => { const T = new M.Sim({ seed: 9, netMode: true }); T.mut = k; const n0 = T.fCount; for (let i = T.fCount - 1; i >= 0 && T.fCount > n0 - 200; i--) if (T.fa[i]) T.removeFood(i, 0); const n1 = T.fCount; for (let i = 0; i < 20; i++) T.feed(false), k === "ff" && T.feed(false); return T.fCount - n1; };
  ok(fe("ff") > fe(""), "fast food: refills faster (" + fe("ff") + " vs " + fe("") + " in 20 ticks)");
  const D = new M.Sim({ seed: 5, netMode: true }); const s = D.addSnake("d", { k: "skin", i: 0 }, {}); for (let i = 0; i < D.FM; i++) if (D.fa[i]) D.removeFood(i, 0); const i0 = D.spawnFood(s.x, s.y, 2, 0); D.buildGrid(); D.eat(s); const g1 = s.m - M.C.START_M;
  D.mut = "df"; const m1 = s.m; for (let i = 0; i < D.FM; i++) if (D.fa[i]) D.removeFood(i, 0); D.spawnFood(s.x, s.y, 2, 0); D.buildGrid(); D.eat(s); ok(Math.abs((s.m - m1) - 2 * g1) < 1e-6 && g1 > 0, "double food: each candy counts twice"); }
// 3) owner override a_mut (owner only, reason, audited) -> cfg + rooms
ok((await A(2, "a_mut", { k: "fb", why: "test x" })).err === "forbidden", "a_mut refuses a non-owner");
ok((await A(1, "a_mut", { k: "zz", why: "bad one" })).err === "bad" && (await A(1, "a_mut", { k: "fb" })).err === "reason", "a_mut: unknown rule / no reason refused");
let r = await A(1, "a_mut", { k: "fb", why: "promo weekend" }); ok(r.ok && S().cfgPub().mut === "fb", "owner forces Free boost");
let u = await (await S().fetch(new Request("https://social/s/uid?pid=" + P2))).json(); ok(u.mu === "fb", "rooms read the override with each player (/s/uid)");
u = await (await S().fetch(new Request("https://social/s/mu"))).json(); ok(u.mu === "fb", "rooms re-read it every 60 s (/s/mu)");
ok(q().exec("SELECT COUNT(*) AS n FROM aud WHERE act = 'mut'").one().n === 1, "override audited");
{ const R = new W.Room({ storage: { sql: new Sql() } }, env); R.init(new URLSearchParams("name_room=pub-9")); R.clients = new Set([{ joined: 1 }]); R.bcast = () => {}; R.mutOv = "fb"; R.mutTick(Date.now()); ok(R.sim.mut === "fb", "room applies the forced rule");
  R.mutOv = "off"; R.mutTick(Date.now()); ok(R.sim.mut === "", "room: owner switched it off"); }
await A(1, "a_mut", { k: "auto", why: "back to auto" }); ok(S().cfgPub().mut === "auto", "back to the schedule");
// 4) crown bounty
ok(E.btyVal(0) === E.BOUNTY.BASE && E.btyVal(25) === E.BOUNTY.BASE + 2 * E.BOUNTY.STEP && E.btyVal(1e6) === E.BOUNTY.MAX, "bounty grows with time at #1, capped at " + E.BOUNTY.MAX);
{ const R = new W.Room({ storage: { sql: new Sql() } }, env); R.init(new URLSearchParams("name_room=pub-8")); const srt = R.sim.snakes.filter((s) => s.alive).sort((a, b) => b.m - a.m);
  R.bty = null; R.btyTrack(srt[0], Date.now() - 40000); const bt = JSON.parse(R.lbMsg()).bt; ok(bt && bt[0] === srt[0].id && bt[1] === E.btyVal(40), "public room: #1 carries the bounty in the leaderboard (" + JSON.stringify(bt) + ")");
  R.btyTrack(srt[0], Date.now()); ok(JSON.parse(R.lbMsg()).bt[1] === E.btyVal(40), "staying #1 keeps the clock");
  R.btyTrack(srt[1], Date.now()); ok(JSON.parse(R.lbMsg()).bt[0] === srt[1].id && JSON.parse(R.lbMsg()).bt[1] === E.BOUNTY.BASE, "new #1: bounty restarts");
  const P = new W.Room({ storage: { sql: new Sql() } }, env); P.init(new URLSearchParams("name_room=priv-x&bots=0")); P.btyTrack(srt[0], Date.now()); ok(!JSON.parse(P.lbMsg()).bt, "private rooms: no bounty");
  // a human kills the bounty holder -> paid through social (counts in the online day cap)
  const ws = new FakeWs(), killer = R.sim.addSnake("K", { k: "skin", i: 1 }, {}), c = { ws, pid: P2, snake: killer, joined: 1 }; R.clients = new Set([c]); R.send = (cc, m) => cc.ws.send(m);
  R.bty = { id: srt[1].id, t0: Date.now() - 100000 }; const b0 = (await op(2, "w_get")).w.bal; R.btyKill([[srt[1].id, killer.id, 3]]); await new Promise((r) => setTimeout(r, 60));
  const msg = ws.out.find((x) => x.t === "bty"), b1 = (await op(2, "w_get")).w.bal; ok(msg && msg.c === E.btyVal(100) && b1 === b0 + msg.c, "killer paid the bounty ◆" + (msg && msg.c) + " by the room");
  ok(q().exec("SELECT k FROM led WHERE pid = ? ORDER BY id DESC LIMIT 1", P2).one().k === "bounty", "ledger row kind bounty"); ok(R.bty === null, "bounty cleared after the kill");
  R.bty = { id: srt[2].id, t0: Date.now() - 5000 }; R.btyKill([[srt[2].id, 0, 1]]); await new Promise((r) => setTimeout(r, 30)); ok(ws.out.filter((x) => x.t === "bty").length === 1, "wall / no killer: nobody paid");
  q().exec("UPDATE wal SET od = ?, oe = ? WHERE pid = ?", new Date().toISOString().slice(0, 10), E.ONLINE.PER_DAY - 10, P2);
  R.bty = { id: srt[3].id, t0: Date.now() - 999000 }; R.btyKill([[srt[3].id, killer.id, 3]]); await new Promise((r) => setTimeout(r, 60)); const m2 = ws.out.filter((x) => x.t === "bty")[1]; ok(m2 && m2.c === 10, "bounty counts within the online day cap (only 10 left -> " + (m2 && m2.c) + ")");
  const bad = await (await S().fetch(new Request("https://social/s/earn", { method: "POST", body: JSON.stringify({ pid: P2, ck: "on:bty:x:1:2:3:4", bty: 999999 }) }))).json(); ok(bad.c <= E.BOUNTY.MAX, "bounty value capped on the wallet side too"); }
// 5) offline claims refused for a switched-off mode
await A(1, "a_modes", { moff: ["zen"], eoff: [], why: "zen off" });
const at = Date.now() - 1000, cl = (mode, h) => ({ k: "match", ck: "m:" + h, a: { mode, at, dur: 120, best: 400, kills: 2, diff: 1 } });
r = await op(2, "w_claims", { l: [cl("zen", "aa11bb22cc33")], cn: Date.now() }); ok(r.res[0].err === "off" && !r.res[0].keep, "offline claim for a switched-off mode refused (not retried)");
r = await op(2, "w_claims", { l: [cl("classic", "aa11bb22cc44")], cn: Date.now() }); ok(!r.res[0].err && r.res[0].c > 0, "other modes still pay");
r = await op(1, "w_mig", { coins: 0 }); r = await op(1, "w_claims", { l: [cl("zen", "aa11bb22cc55")], cn: Date.now() }); ok(r.res[0].err !== "off", "owner exempt");
await A(1, "a_modes", { moff: [], eoff: [], why: "all on" });
// 6) flag price editable
const cfg = await A(1, "a_cfg"); const fp = cfg.prices.find((x) => x.k === "flags"); ok(fp && fp.p === 300 && fp.b === 300, "Economy lists the flag price");
r = await A(1, "a_price", { key: "flags", price: 450, why: "flag price" }); ok(r.ok && SK.FLAG_PRICE === 450 && E.catItem("flag", 3).base === 450, "flag price changed -> every flag priced 450 on the server");
r = await A(1, "a_price", { key: "flags", price: 0, why: "reset flags" }); ok(r.ok && SK.FLAG_PRICE === 300, "0 = back to base 300");
console.log(fail ? `FAIL ${fail}/${n}` : `ALL ${n} OK`); process.exit(fail ? 1 : 0);
