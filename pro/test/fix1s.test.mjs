// fix1 server checks (node test/fix1s.test.mjs): online rooms check equipped cosmetics against the server wallet (unowned -> default, logged);
// server-side XP (per-match bounds from plausible(), daily cap) gates level-up claims and snapshots; legacy wallets keep their level.
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
process.env.TZ = "UTC";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-f1s-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
const W = await import(join(dir, "index.js")); W.MIG.CUT = 9e15; /* grow1: test ids count as pre-coin1 */ const E = await import(join(dir, "econ.js")); const SK = await import(join(dir, "skins.js"));
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
const rid = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
const today = new Date().toISOString().slice(0, 10), bal = (r) => r && r.w && r.w.bal;
const skinI = (id) => SK.SKINS.findIndex((s) => s.id === id && s.src); // ids can repeat (a level skin "phoenix" and the coin legendary "phoenix")
const cl = (k, list, cn) => op(k, "w_claims", { l: list, ...(cn ? { cn } : {}) });
const match = (a, at) => ({ k: "match", ck: "m:" + rid(), a: { mode: "classic", diff: 1, ...a, at } });
const P = await import("../js/profile.js");
// ---------- (a) cosmetics: requirement tables mirror js/profile.js ----------
const enc = (r) => (!r ? 0 : r.lv ? r.lv : r.grant ? "g" : "x");
ok(JSON.stringify(P.AVATARS.map(enc)) === JSON.stringify(W.AV_REQ) && JSON.stringify(P.FRAMES.map((F) => enc(F.req))) === JSON.stringify(W.FR_REQ), "server avatar / frame requirement tables = js/profile.js");
{ const lvSkin = SK.SKINS.findIndex((s) => !s.src && s.lv >= 10), coin = SK.SKINS.findIndex((s) => s.src && s.src.startsWith("coins:")), id = SK.SKINS[coin].id;
  const sk = { k: "skin", i: coin, p: 0, c: ["#18c964", "#0b7a3b", "#b8ffcf"], e: 11, t: 12, n: 3, av: "p13", fr: 15, gt: "gold" };
  let [o, cut] = W.verifySkin(sk, { own: new Set(), lv: 1 }); ok(o.k === "skin" && o.i === 0 && o.e === 0 && o.t === 0 && !o.gt && o.fr === 0 && o.av === "p0" && cut.length === 6 && o.n === 3, "unowned skin / eyes / trail / ground trail / granted frame / level avatar -> default (" + cut.join(",") + ")");
  [o, cut] = W.verifySkin(sk, { own: new Set([id, "gt:gold", "fr:15"]), lv: 50 }); ok(o.i === coin && o.e === 11 && o.t === 12 && o.gt === "gold" && o.fr === 15 && o.av === "p13" && !cut.length, "everything owned / level reached -> kept");
  [o, cut] = W.verifySkin({ ...sk, k: "skin", i: lvSkin, fr: 4 }, { own: new Set(), lv: 9 }); ok(o.i === 0 && o.fr === 0 && cut.includes("skin") && cut.includes("frame"), "level skin + diamond frame at level 9 -> default");
  [o, cut] = W.verifySkin({ k: "flag", i: 7, e: 0, t: 0, n: 0, fr: 10, av: "p10" }, { own: new Set(["fl:7"]), lv: 1 }); ok(o.k === "flag" && o.fr === 10 && o.av === "p10" && !cut.length, "owned flag kept; achievement / stat cosmetics (not held by the server) accepted");
  [o, cut] = W.verifySkin({ ...sk, i: coin }, { own: new Set(), lv: 1, o: 1 }); ok(!cut.length, "the owner is never checked");
  [o] = W.verifySkin({ k: "custom", i: 0, p: 3, c: ["#112233", "#445566", "#778899"], e: 0, t: 0, n: 0 }, null); ok(o.k === "custom", "custom colours stay (free)"); }
// room: hello with a device key -> wallet check before the spawn; the forged skin falls back to default
{ await op(21, "w_mig", { coins: 0, own: ["fl:9"], lv: 3 }); const RM = obj("pub-bs-9"); await RM.fetch(new Request("https://room/ws?name_room=pub-bs-9")); const c = [...RM.clients].pop();
  const coin = SK.SKINS.findIndex((s) => s.src && s.src.startsWith("coins:")); const log = console.log, L = []; console.log = (...a) => L.push(a.join(" "));
  RM.onMsg(c, JSON.stringify({ t: "hello", name: "Forge", pk: pk(21), skin: { k: "skin", i: coin, e: 11, fr: 15, gt: "gold" } })); RM.onMsg(c, JSON.stringify({ t: "spawn", seq: 1 }));
  await new Promise((z) => setTimeout(z, 120)); console.log = log; const s = c.snake;
  ok(s && s.skin.k === "skin" && s.skin.i === 0 && s.skin.e === 0 && s.skin.fr === 0 && !s.skin.gt, "online room: a spawn waits for the wallet check, the unowned skin / eyes / frame / ground trail show as default");
  ok(L.some((x) => /cos_fallback/.test(x)) && RM.cosCut >= 1, "the fallback is logged (cos_fallback) and counted");
  s.alive = false; const c2 = c; RM.onMsg(c2, JSON.stringify({ t: "spawn", seq: 2, skin: { k: "flag", i: 9 } })); ok(c2.snake && c2.snake.skin.k === "flag" && c2.snake.skin.i === 9, "an owned flag is shown as equipped"); RM.drop(c); }
// ---------- (b) server XP ----------
{ const p = await pidOf(pk(22)); await op(22, "w_mig", { coins: 0, lv: 1 }); q().exec("UPDATE wal SET mat = 0 WHERE pid = ?", p);
  let w = (await op(22, "w_get")).w; ok(w.sx === 0, "a new wallet starts at 0 server XP");
  let r = await cl(22, [match({ dur: 300, best: 2000, kills: 5 }, Date.now() - 1000)]); const exp = Math.min(W.XP.MATCH, E.matchXp({ mode: "classic", diff: 1, dur: 300, best: 2000, kills: 5, wave: 0, pu: 0, bonus: 0, win: false }));
  ok(r.res[0].x === exp && r.w.sx === exp, "an offline match adds the XP its numbers are worth (" + exp + ")");
  const m0 = () => q().exec("UPDATE wal SET mat = 0 WHERE pid = ?", p); m0(); r = await cl(22, [match({ dur: 60, best: 1e6, kills: 999, bonus: 1e6 }, Date.now())]); ok(r.res[0].x > 0 && r.res[0].x <= E.matchXp({ mode: "classic", diff: 1, dur: 60, best: 150 + 40 * 60, kills: 17, bonus: 6000, wave: 0, pu: 0 }) && r.res[0].x <= W.XP.MATCH, "a forged score is cut to what 60 s can earn (" + r.res[0].x + " XP)");
  m0(); r = await cl(22, [match({ dur: 5, best: 500 }, Date.now())]); ok(r.res[0].x === 0, "a match under " + E.OFF.MIN_S + " s earns no XP");
  const lvNow = W.lvOf(r.w.sx); r = await cl(22, [{ k: "lv", ck: "lv:" + (lvNow + 1), a: { n: lvNow + 1 } }, { k: "lv", ck: "lv:30", a: { n: 30 } }]);
  ok(r.res.every((x) => x.err === "xp" && x.keep), "level-up claims above the server's level are held (err xp, kept for later)");
  q().exec("UPDATE wal SET xn = ? WHERE pid = ?", W.XP.DAY - 100, p); m0(); r = await cl(22, [match({ dur: 600, best: 4000, kills: 8 }, Date.now())]); ok(r.res[0].x === 100, "daily XP cap " + W.XP.DAY + ": only the 100 left today is added");
  const sx = (await op(22, "w_get")).w.sx; r = S().snapOp(p, p, { sv: 0, js: JSON.stringify({ coins: 0, xp: 9e6 }) }); const row = q().exec("SELECT xp FROM snp WHERE pid = ?", p).toArray()[0];
  ok(row && row.xp === sx, "a snapshot can not raise XP above the server's (" + sx + ", asked 9,000,000)"); }
// legacy wallet (before fix1): starts at the start of its level
{ const p = await pidOf(pk(23)); await op(23, "w_mig", { coins: 0, lv: 12 }); const w = (await op(23, "w_get")).w; ok(w.sx === W.cumXp(12) && W.lvOf(w.sx) === 12, "a wallet from before fix1 keeps its level (server XP = start of level 12)"); }
{ await op(24, "w_mig", { coins: 0, lv: 99 }); const w = (await op(24, "w_get")).w; ok(W.lvOf(w.sx) === W.XP.MIG_LV, "a first import claiming level 99 is capped at level " + W.XP.MIG_LV); }
console.log(fail ? "FAILED " + fail + " of " + n : "ALL PASS " + n); process.exit(fail ? 1 : 0);
