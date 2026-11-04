// grow1 server checks: new ids after coin1 import nothing; challenge links (create / open / result / pending delivery)
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
process.env.TZ = "UTC";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-g1s-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
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
const w = (r) => r && r.w; W.MIG.CUT = Date.parse("2026-11-04T18:35:00Z");
// 0) exploit: a device id first seen after the coin1 release imports nothing and starts at level 1
{ const r = await op(31, "w_mig", { coins: 150000, own: ["fl:9", "sk:3"], lv: 60 }); const st = (await op(31, "w_get")).w;
  ok(r.ok && r.mig.rule === "new" && st.bal === 0, "new id after coin1: 0 coins imported (asked 150,000)");
  ok(W.lvOf(st.sx) === 1, "new id after coin1: level 1 (asked 60)"); ok(!(st.own || []).includes("fl:9"), "new id after coin1: no items imported");
  const r2 = await op(31, "w_mig", { coins: 150000 }); ok(r2.err === "done", "the import stays one-time"); }
{ const p = await pidOf(pk(32)); await op(32, "w_get"); q().exec("UPDATE acct SET t = ? WHERE pid = ?", W.MIG.CUT - 86400000, p);
  const r = await op(32, "w_mig", { coins: 5000, lv: 7 }); const st = (await op(32, "w_get")).w; ok(r.ok && r.mig.rule === "first" && st.bal === 5000 && W.lvOf(st.sx) === 7, "id known before coin1 keeps the one-time import (5,000, level 7)"); }
{ const p = await pidOf(pk(33)); await op(33, "w_get"); q().exec("UPDATE acct SET t = ? WHERE pid = ?", Date.now(), p); q().exec("INSERT INTO dv (dp, cp, t0, t1, ua) VALUES (?, ?, ?, ?, '')", "x".repeat(20), p, W.MIG.CUT - 1000, Date.now());
  const r = await op(33, "w_mig", { coins: 777 }); ok(r.ok && r.mig.rule === "first" && (await op(33, "w_get")).w.bal === 777, "a device seen before coin1 also counts as pre-coin1"); }
// 1) challenge links
{ const a = await op(41, "ch_new", { seed: 123456, mode: "classic", wo: 2, df: 1, sc: 900 }); ok(a.ok && /^[a-z2-9]{7}$/.test(a.c), "challenge created: short code " + a.c);
  ok((await op(41, "ch_new", { seed: 1, mode: "online", sc: 1 })).err === "bad", "online / unknown mode refused"); ok((await op(41, "ch_new", { seed: -5, mode: "br", sc: 1 })).err === "bad", "bad seed refused");
  const g = await op(42, "ch_get", { c: a.c }); ok(g.ok && g.ch.seed === 123456 && g.ch.mode === "classic" && g.ch.wo === 2 && g.ch.df === 1 && g.ch.sc === 900 && !g.ch.mine, "opener gets seed + mode + world + diff + score");
  ok((await op(42, "ch_get", { c: "zzzzzzz" })).err === "notfound", "unknown code: notfound");
  const r1 = await op(42, "ch_res", { c: a.c, sc: 500 }); ok(r1.ok && r1.win === 0, "lower score = lose");
  const P = S().chPend(await pidOf(pk(41))); ok(P.length === 1 && P[0].s === 500 && P[0].my === 900 && P[0].w === 0, "sender offline: result waits for the next connect");
  ok(S().chPend(await pidOf(pk(41))).length === 0, "delivered once");
  const r2 = await op(42, "ch_res", { c: a.c, sc: 400 }); ok(r2.best === 500, "a worse rerun is not sent again");
  const r3 = await op(42, "ch_res", { c: a.c, sc: 1200 }); ok(r3.ok && r3.win === 1, "higher score = beat");
  const P2 = S().chPend(await pidOf(pk(41))); ok(P2.length === 1 && P2[0].w === 1 && P2[0].s === 1200, "the better result reaches the sender");
  ok((await op(41, "ch_res", { c: a.c, sc: 5 })).self === 1, "sender opening own link: no result"); }
console.log(fail ? "FAILED " + fail + " of " + n : "ALL PASS " + n); process.exit(fail ? 1 : 0);
