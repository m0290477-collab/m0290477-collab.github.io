// coin1: server wallet (real server/index.js on node:sqlite, the engine SQLite-backed Durable Objects use). Migration once only
// (capped, logged), purchases (insufficient funds, ownership, price / offer checks, double-spend race), special-id atomic buy
// with 3 concurrent buyers, idempotent claims (daily / mission / achievement / level / season / contests), offline match
// plausibility + caps, online coins paid by the room, owner grants into the wallet, delete. Node only, no network.
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
process.env.TZ = "UTC";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-c1-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
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
const rid = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
const today = new Date().toISOString().slice(0, 10), bal = (r) => r && r.w && r.w.bal;
const skinI = (id) => SK.SKINS.findIndex((s) => s.id === id && s.src); // ids can repeat (a level skin "phoenix" and the coin legendary "phoenix")

// ---------- 1. migration: once only, capped, logged ----------
let r = await op(1, "w_get"); ok(r.w && r.w.mig === 0 && r.w.bal === 0, "a player who never connected the updated game has an empty, unmigrated wallet");
r = await op(1, "w_buy", { k: "flag", ix: 3, price: 300, rid: rid() }); ok(r.err === "mig", "nothing can be bought before the device balance is imported");
r = await op(1, "w_mig", { coins: 5000, own: ["phoenix", "fl:4", "gt:sparks", "av:p5", "notathing", "sid:12345"], lv: 12, ck: ["ach:a_first", "login:" + today], ld: today, ln: 2 });
ok(r.ok && r.w.mig === 1 && r.w.bal === 5000 && r.mig.rule === "first" && r.mig.cut === 0, "first connect imports the device balance (5,000 under the 200,000 first-import cap)");
ok(r.w.own.includes("phoenix") && r.w.own.includes("fl:4") && r.w.own.includes("gt:sparks") && r.w.own.includes("av:p5") && !r.w.own.includes("notathing") && !r.w.own.includes("sid:12345"), "owned items come over; unknown keys and special ids the server never sold to this player are dropped");
r = await op(1, "w_mig", { coins: 999999 }); ok(r.err === "done" && r.w.bal === 5000, "migration runs once only: a second import (999,999) is refused and changes nothing");
r = await op(2, "w_mig", { coins: 5e6 }); ok(r.ok && r.w.bal === W.MIG.FIRST && r.mig.cut === 5e6 - W.MIG.FIRST, "an implausible device balance (5,000,000) is cut to the first-import cap and the cut is logged");
{ const L = q().exec("SELECT * FROM led WHERE pid = ? AND k = 'mig'", await pidOf(pk(2))).toArray(); ok(L.length === 1 && JSON.parse(L[0].note).cut === 5e6 - W.MIG.FIRST, "the ledger keeps the migration with device value, cap, rule and cut"); }
{ // snapshot holders: snapshot coins + the srv2 allowance for the time since that save
  const p3 = await pidOf(pk(3)); S().sAcct(p3); q().exec("INSERT INTO snp (pid, sv, coins, xp, lv, js, t, sus) VALUES (?, 1, 1000, 0, 1, '{}', ?, 0)", p3, Date.now());
  r = await op(3, "w_mig", { coins: 50000 }); ok(r.ok && r.mig.rule === "snapshot" && r.w.bal === 1000 + W.allowance(0).coins, "a player with a server snapshot imports at most snapshot coins + allowance (srv2 rule)"); }
// concurrent migrations from two tabs: only one import
{ const rs = await Promise.all([op(4, "w_mig", { coins: 700 }), op(4, "w_mig", { coins: 700 }), op(4, "w_mig", { coins: 700 })]); ok(rs.filter((x) => x.ok).length === 1 && (await op(4, "w_get")).w.bal === 700, "three tabs migrating at once import the balance exactly once"); }

// ---------- 2. purchases ----------
const ph = skinI("phoenix"), hol = skinI("hologram"), koi = skinI("koi");
r = await op(1, "w_buy", { k: "skin", ix: ph, price: 7500, rid: rid() }); ok(r.err === "own", "an item the server says is owned can not be bought again");
r = await op(1, "w_buy", { k: "skin", ix: hol, price: 6000, rid: rid() }); ok(r.err === "noCoins" && bal(r) === 5000, "insufficient funds (6,000 > 5,000): refused, balance untouched");
r = await op(1, "w_buy", { k: "skin", ix: koi, price: 1, rid: rid() }); ok(r.err === "badPrice", "a forged price (1 coin for a 3,000 skin) is refused");
r = await op(1, "w_buy", { k: "skin", ix: koi, price: 3000, coins: 1e9, bal: 1e9, rid: rid() }); ok(r.ok && bal(r) === 2000 && r.w.own.includes("koi"), "a catalogue buy debits the server balance (5,000 -> 2,000); a balance sent by the client is ignored");
{ const id = rid(); const a = await op(1, "w_buy", { k: "flag", ix: 9, price: 300, rid: id }), b = await op(1, "w_buy", { k: "flag", ix: 9, price: 300, rid: id }); ok(a.ok && b.ok && b.dup && bal(b) === 1700, "a retried purchase (same request id) is paid once"); }
r = await op(1, "w_buy", { k: "gt", ix: E.catItem ? SK.GTRAILS.findIndex((g) => g.price > 0) : 2, price: SK.GTRAILS.find((g) => g.price > 0).price, rid: rid() }); ok(r.err === "own", "ground trails use the same ownership check (gt:sparks came with the migration)");
// double-spend race: 1,700 coins, six 300-coin flags bought at once -> exactly 5 succeed, balance 200, never negative
{ const rs = await Promise.all([20, 21, 22, 23, 24, 25].map((i) => op(1, "w_buy", { k: "flag", ix: i, price: 300, rid: rid() })));
  const w = (await op(1, "w_get")).w; ok(rs.filter((x) => x.ok).length === 5 && rs.filter((x) => x.err === "noCoins").length === 1 && w.bal === 200, "double-spend race: six parallel buys with coins for five -> five paid, one refused, balance 200"); }
{ const rs = await Promise.all([1, 2, 3].map(() => op(4, "w_buy", { k: "flag", ix: 40, price: 300, rid: rid() }))); const w = (await op(4, "w_get")).w;
  ok(rs.filter((x) => x.ok).length === 1 && rs.filter((x) => x.err === "own").length === 2 && w.bal === 400, "the same item bought from three tabs at once is paid once (the other two: already owned)"); }
// offers: this week's discount is accepted at its price; a made-up discount is not
{ const C = E.offerCandidates(new Set((await op(2, "w_get")).w.own)); const o = C.single[0], b = C.bundles[0];
  r = await op(2, "w_buy", { k: o.k, ix: o.i, price: o.price, rid: rid() }); ok(r.ok && r.price === o.price, "a live weekly offer is sold at its discounted price (" + o.k + " " + o.i + " for " + o.price + ")");
  const other = o.k === "skin" ? { k: "flag", ix: 150 } : { k: "skin", ix: hol }; const base = E.catItem(other.k, other.ix).base;
  r = await op(2, "w_buy", { ...other, price: Math.ceil(base * 0.6), rid: rid() }); ok(r.err === "badPrice", "a discount that is not on offer right now is refused");
  if (b) { r = await op(2, "w_buy", { k: "bundle", key: b.key, items: b.items, price: b.price, rid: rid() }); ok(r.ok && b.items.every((x) => r.w.own.includes(E.catItem(x.k, x.i).key)), "the monthly / occasion bundle is sold whole at its price"); } }

// ---------- 3. special ids: one transaction, 3 concurrent buyers ----------
for (const k of [11, 12, 13]) { await op(k, "w_mig", { coins: 10 }); S().wAdd(await pidOf(pk(k)), 60000, "test", "seed"); }
{ const rs = await Promise.all([11, 12, 13].map((k) => op(k, "w_sid", { n: "48213", price: 50000 }))); const wins = rs.filter((x) => x.ok), sold = rs.filter((x) => x.err === "sold");
  const bals = await Promise.all([11, 12, 13].map(async (k) => (await op(k, "w_get")).w.bal)); const holder = q().exec("SELECT pid FROM ids WHERE num = '48213'").toArray();
  ok(wins.length === 1 && sold.length === 2 && holder.length === 1, "3 concurrent buyers of special id 48213: exactly one gets it, two see 'sold'");
  ok(bals.filter((b) => b === 10010).length === 1 && bals.filter((b) => b === 60010).length === 2, "only the winner paid (50,000); the others kept every coin (no grant-then-refund)");
  ok(wins[0].me.prem.includes("48213") && wins[0].w.own.includes("sid:48213"), "the winner's profile and server item list show the id at once"); }
r = await op(13, "w_sid", { n: "77777", price: 300000 }); ok(r.err === "noCoins" && !q().exec("SELECT num FROM ids WHERE num = '77777'").toArray().length, "a special id the player can not afford is never assigned, not even for a moment");
r = await op(13, "buyid", { n: "54321", price: 150000 }); ok(r.err === "update", "the old grant-then-pay id purchase is closed (older builds are told to update)");

// ---------- 4. claims: server-priced, idempotent ----------
const cl = (k, list, cn) => op(k, "w_claims", { l: list, ...(cn ? { cn } : {}) });
await op(5, "w_mig", { coins: 0, lv: 3, ck: ["ach:a_first"] });
r = await cl(5, [{ k: "ach", ck: "ach:a_hunter", a: { id: "a_hunter" } }, { k: "ach", ck: "ach:a_first", a: { id: "a_first" } }, { k: "ach", ck: "ach:a_nope", a: { id: "a_nope" } }]);
ok(r.res[0].c === 100 && r.res[1].dup && r.res[2].err === "bad" && bal(r) === 100, "achievement: priced from the server table (100); one paid before the update is not paid again; an unknown one is refused");
r = await cl(5, [{ k: "ach", ck: "ach:a_hunter", a: { id: "a_hunter", coins: 99999 } }]); ok(r.res[0].dup && bal(r) === 100, "the same claim id twice = paid once (and a coin amount from the device is ignored)");
{ const rs = await Promise.all([1, 2, 3].map(() => cl(5, [{ k: "ach", ck: "ach:a_king", a: { id: "a_king" } }]))); ok(rs.filter((x) => x.res[0].c === 250).length === 1 && (await op(5, "w_get")).w.bal === 350, "a claim sent from three tabs at once is paid once"); }
const ms = E.dailyMissions(today); r = await cl(5, [{ k: "ms", ck: "ms:" + today + ":1", a: { d: today, i: 1 } }]); ok(r.res[0].c === ms[1].r, "daily mission reward = that day's mission table (" + ms[1].r + ")");
r = await cl(5, [{ k: "ms", ck: "ms:2020-01-01:0", a: { d: "2020-01-01", i: 0 } }]); ok(r.res[0].err === "bad", "a mission of a long-gone day is refused");
r = await cl(5, [{ k: "lv", ck: "lv:3", a: { n: 3 } }, { k: "lv", ck: "lv:4", a: { n: 4 } }, { k: "lv", ck: "lv:10", a: { n: 10 } }]);
ok(r.res[0].err === "old" && r.res[1].c === E.levelCoins(4) && r.res[2].c === E.levelCoins(10), "level-up coins: levels reached before the update pay nothing, new ones pay 25 x level (+500 every 10th)");
{ const L = []; for (let l = 11; l <= 35; l++) L.push({ k: "lv", ck: "lv:" + l, a: { n: l } }); r = await cl(5, L); ok(r.res.filter((x) => x.c).length === W.LV_DAY - 2 && r.res.filter((x) => x.err === "rate" && x.keep).length === 25 - (W.LV_DAY - 2), "at most " + W.LV_DAY + " level rewards per day (a forged jump to level 35 is held back, kept for later days)"); }
{ const b0 = (await op(5, "w_get")).w.bal; r = await cl(5, [{ k: "login", ck: "login:" + today, a: { d: today } }]); const w1 = r.w; r = await cl(5, [{ k: "login", ck: "login:" + today, a: { d: today } }]);
  ok(w1.bal === b0 + E.LOGIN[0] && r.res[0].dup && r.w.bal === w1.bal, "daily login: server-tracked streak (day 1 = " + E.LOGIN[0] + "), once per day"); }
{ const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10); r = await cl(5, [{ k: "login", ck: "login:" + y, a: { d: y } }]); ok(r.res[0].err === "day", "an earlier day can not be claimed after a later one (no clock games)"); }
{ const b0 = (await op(5, "w_get")).w.bal; r = await cl(5, [{ k: "bonus", ck: "bonus:" + today, a: { d: today, lv: 99 } }]); ok(r.res[0].c === E.bonusCoins(10) && r.w.bal === b0 + 150, "daily bonus priced by the server (level capped at 10 -> 150)"); }
r = await cl(5, [{ k: "tier", ck: "tier:s1:10", a: { k: 10 } }, { k: "tier", ck: "tier:s1:5", a: { k: 5 } }, { k: "tier", ck: "tier:s1:31", a: { k: 31 } }]);
ok(r.w.own.includes("magma") && r.res[1].c === 500 && r.res[2].err === "bad", "season pass: tier 10 gives its skin on the server, tier 5 its coins, tier 31 does not exist");
r = await cl(5, [{ k: "unl", ck: "unl:phantom", a: { id: "phantom" } }, { k: "unl", ck: "unl:phoenix", a: { id: "phoenix" } }]); ok(r.w.own.includes("phantom") && r.res[1].err === "bad", "progress unlocks: chain skins can be claimed, a coin-shop skin can not");
{ const wk = (() => { const d = new Date(); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + "-W" + Math.ceil(((t - y0) / 86400000 + 1) / 7); })();
  r = await cl(5, [{ k: "wk", ck: "wk:" + wk + ":2", a: { w: wk, i: 2 } }, { k: "wc", ck: "wc:" + wk + ":1", a: { w: wk, t: 1 } }, { k: "wk", ck: "wk:2020-W1:0", a: { w: "2020-W1", i: 0 } }]);
  ok(r.res[0].c === 750 && r.res[1].c === 700 && r.res[2].err === "bad", "weekly mission (750) + weekly chain tier (700) for this week; an old week is refused"); }
// contests: milestones priced from the table, final ranks only as the board recorded them
{ const p5 = await pidOf(pk(5)), B = obj("board-v1"); B.db(); const wkP = W.prevPeriodId ? null : null; const prevW = (await import(join(dir, "sim.js"))).prevPeriodId("w", Date.now()), curM = (await import(join(dir, "sim.js"))).seasonId(Date.now());
  B.db().exec("INSERT INTO fin (per, met, pid, rk, v) VALUES (?, 'tr', ?, 1, 500)", "w:" + prevW, p5);
  r = await cl(5, [{ k: "rw", ck: "rw:sv:w:" + prevW + ":tr", a: { key: "sv:w:" + prevW + ":tr" } }, { k: "rw", ck: "rw:sv:w:" + prevW + ":kl", a: { key: "sv:w:" + prevW + ":kl" } }, { k: "rw", ck: "rw:ms:w_rush:" + prevW + ":2", a: { key: "ms:w_rush:" + prevW + ":2" } }, { k: "rw", ck: "rw:ss:" + curM, a: { key: "ss:" + curM, li: 5 } }]);
  ok(r.res[0].c === 1500 && r.res[0].rk === 1 && r.w.own.includes("ti:15") && r.res[1].err === "none" && r.res[2].c === 400 && r.w.own.includes("bd:wr") && r.res[3].err === "bad", "contests: weekly #1 pays 1,500 + its title (rank read from the board), a rank never recorded pays nothing, milestone 3 = 400 + badge, the running season can not be claimed yet"); }

// ---------- 5. offline match claims: plausibility + caps ----------
await op(6, "w_mig", { coins: 0 }); const t0 = Date.now(); q().exec("UPDATE wal SET mat = 0"); // (tests replay matches from the last hours)
const H = 3600000;
const match = (a, at) => ({ k: "match", ck: "m:" + rid(), a: { mode: "classic", diff: 1, ...a, at } });
r = await cl(6, [match({ dur: 300, best: 2000, kills: 6 }, t0 - 5 * H)]);
ok(r.res[0].c === E.matchCoins({ mode: "classic", diff: 1, dur: 300, best: 2000, kills: 6 }) && !r.res[0].cut, "a plausible 5-minute offline match pays the same formula as the device (" + r.res[0].c + ")");
{ const m1 = match({ dur: 60, best: 900000, kills: 400, bounty: 50, bonus: 1e7 }, t0 - 4 * H); r = await cl(6, [m1]);
  const L = q().exec("SELECT * FROM led WHERE pid = ? AND k = 'cut'", await pidOf(pk(6))).toArray();
  ok(r.res[0].cut && r.res[0].c <= E.OFF.PER_MATCH && r.res[0].c < E.plausible({ dur: 60 }).full + 1000 && L.length === 1, "a forged 60 s match (900,000 mass, 400 kills) is cut back to what 60 s allows; the cut is logged (" + r.res[0].c + " coins, cuts: " + r.res[0].cut.join(",") + ")"); }
r = await cl(6, [match({ dur: 300, best: 400 }, Date.now() + 5 * 60000)]); ok(r.res[0].err === "bad", "a match that ends in the future (device clock forged) pays nothing");
r = await cl(6, [match({ dur: 5, best: 400 }, t0 - 3.5 * H)]); ok(r.res[0].c === 0 && r.res[0].cut.includes("short"), "a 5-second match pays nothing");
r = await cl(6, [match({ dur: 120, best: 800 }, t0 + 120000)], t0 + 10 * 60000); ok(r.res[0].c > 0, "a device clock 10 min fast is corrected by the time it sends with the batch");
{ const base = t0 - 2 * H, L = []; for (let i = 0; i < 4; i++) L.push(match({ dur: 600, best: 3000, kills: 10 }, base + i * 1000)); r = await cl(6, L);
  ok(r.res.filter((x) => x.cut && x.cut.includes("overlap")).length >= 3, "four 10-minute matches that would overlap in time: only the first pays"); }
{ await op(7, "w_mig", { coins: 0 }); q().exec("UPDATE wal SET mat = 0"); const L = []; let at = Date.now() - 2.5 * 86400000; for (let i = 0; i < 25; i++) { at += 1900 * 1000; L.push(match({ dur: 1800, best: 3600 * 40, kills: 400, diff: 3, win: true }, at)); }
  r = await cl(7, L); const sum = r.res.reduce((a, x) => a + (x.c | 0), 0), per = r.res.map((x) => x.c | 0);
  ok(per.every((c) => c <= E.OFF.PER_MATCH) && sum <= E.OFF.PER_DAY * 3, "offline caps: at most " + E.OFF.PER_MATCH + " per match and " + E.OFF.PER_DAY + " per day (25 maxed matches -> " + sum + ")"); }
r = await cl(6, [{ k: "match", ck: "m:" + rid(), a: { mode: "online", dur: 300, best: 2000, kills: 6, at: Date.now() - 1000 } }]); ok(!r.res[0].c || r.res[0].cut.includes("mode") || r.res[0].cut.includes("overlap"), "an online life can not be claimed by the device (rooms pay those)");

// ---------- 6. online coins: paid by the room ----------
{ const RM = obj("pub-bs-3"); await RM.fetch(new Request("https://room/ws?name_room=pub-bs-3")); const c = [...RM.clients].pop(); RM.onMsg(c, JSON.stringify({ t: "hello", name: "Coin C", pk: pk(8) }));
  await new Promise((z) => setTimeout(z, 80)); await op(8, "w_mig", { coins: 100 }); RM.onMsg(c, JSON.stringify({ t: "spawn", seq: 1 })); const s = c.snake; s.m = 800; c.life.bm = 800; s.kills = 3; c.life.t0 = Date.now() - 240000;
  RM.sim.kill(s, 0, 1); RM.score(c, s); await new Promise((z) => setTimeout(z, 80)); const w = (await op(8, "w_get")).w, exp = Math.min(E.ONLINE.PER_LIFE, E.matchCoins({ mode: "online", diff: 1, best: 800, kills: 3, dur: 240 }));
  ok(w.bal === 100 + exp && c.ws.out.some((o) => o && o.t === "coin" && o.c === exp), "an online life is paid by the room from what it saw (" + exp + " coins), the player is told live");
  RM.score(c, s); await new Promise((z) => setTimeout(z, 40)); ok((await op(8, "w_get")).w.bal === 100 + exp, "the same life is never paid twice"); RM.drop(c); }

// ---------- 7. spin, owner grants, snapshots, delete ----------
{ await op(9, "w_mig", { coins: 0 }); r = await op(9, "w_spin", { d: today, cos: "av:p7" }); const sg = E.SPIN[r.i]; ok(r.ok && r.i >= 0 && (sg.c ? r.c === sg.c : sg.x ? r.x === sg.x : r.cos === "av:p7" || r.c === E.SPIN_NOCOS), "lucky wheel: rolled on the server, the device only animates to segment " + r.i);
  r = await op(9, "w_spin", { d: today }); ok(r.err === "day", "one spin per day"); }
{ const dF = 30, dT = 31; await op(dF, "me"); const pF = await pidOf(pk(dF)); q().exec("UPDATE ids SET pid = ? WHERE num = '1'", pF); q().exec("UPDATE acct SET own = 1 WHERE pid = ?", pF); S().sVis(pF);
  await op(dT, "w_mig", { coins: 10 }); const tid = (await op(dT, "me")).me.id;
  r = await op(dF, "a_grant", { id: tid, coins: 2500, items: ["fr:16", "ti:15"], why: "test gift" }); const w = (await op(dT, "w_get")).w;
  ok(r.ok && w.bal === 2510 && w.own.includes("fr:16") && r.bal === 2510, "owner grants from the admin panel go straight into the wallet (+ items on the server list)");
  const dU = 32; await op(dU, "me"); const uid = (await op(dU, "me")).me.id; await op(dF, "a_grant", { id: uid, coins: 900, why: "before update" }); r = await op(dU, "w_mig", { coins: 40 });
  ok(r.w.bal === 940 && r.mig.pend === 900, "a grant made before the player's first updated connect is added by the migration (once)");
  r = await op(dF, "a_view", { id: tid }); ok(r.wal && r.wal.bal === 2510 && r.wal.led.length >= 2, "the owner's player view shows the wallet and its ledger"); }
{ r = await aop(1, "test", { key: TEST_KEY, name: "coin-one" }); const b = (await op(1, "w_get")).w.bal; r = await aop(1, "snap", { sv: 0, js: JSON.stringify({ coins: 999999, xp: 10 }) });
  ok(r.ok && r.adj && r.adj.coins === b && q().exec("SELECT coins FROM snp WHERE pid = ?", await pidOf(pk(1))).one().coins === b, "a profile snapshot with a forged balance is stored with the wallet balance (device coins are display only)");
  r = await aop(1, "adel"); const p1 = await pidOf(pk(1)); ok(r.ok && !q().exec("SELECT pid FROM wal WHERE pid = ?", p1).toArray().length && !q().exec("SELECT pid FROM own WHERE pid = ?", p1).toArray().length && !q().exec("SELECT pid FROM led WHERE pid = ?", p1).toArray().length, "account delete removes the wallet, items, claims and ledger"); }
{ const hi = await S().socialWs(new Request("https://social/sws?pk=" + pk(4)), new URL("https://social/sws?pk=" + pk(4))); const ws = S().state.getWebSockets().pop(); const m = ws.out.find((o) => o.t === "hi"); ok(m && m.w && m.w.mig === 1 && m.w.bal === 400, "the social socket's hello carries the wallet (no extra request on connect)"); }

// ---------- 8. feedback + guest delete (privacy: deletion is real for guests too) ----------
{ r = await op(40, "fb", { tx: "please add teams" }); const row = q().exec("SELECT * FROM rep WHERE who = 'fb'").toArray(); ok(r.ok && row.length === 1 && row[0].tx === "please add teams", "feedback is stored with the reports for the owner");
  await op(40, "w_mig", { coins: 50 }); r = await aop(40, "adel"); const p40 = await pidOf(pk(40));
  ok(r.ok && r.guest && !q().exec("SELECT pid FROM acct WHERE pid = ?", p40).toArray().length && !q().exec("SELECT pid FROM wal WHERE pid = ?", p40).toArray().length && !q().exec("SELECT by FROM rep WHERE by = ?", p40).toArray().length, "a guest can delete its online data: id, wallet and feedback are gone from the server"); }
console.log(fail ? `\n${fail} of ${n} FAILED` : `\nall ${n} coin1 checks passed`); process.exit(fail ? 1 : 0);
