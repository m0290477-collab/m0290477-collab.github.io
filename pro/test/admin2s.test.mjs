// admin2 server checks: owner-only admin ops (coins / items / level / ids / trophies / chat), announcement + maintenance + modes, gift-to-all, promo codes, prices, stats, backup now; warm rooms
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
process.env.TZ = "UTC";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-a2s-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
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
const A = async (k, o, x = {}) => op(k, o, x);
const P1 = await pidOf(pk(1)), P2 = await pidOf(pk(2));
await op(1, "w_get"); await op(2, "w_get"); q().exec("UPDATE acct SET own = 1, t = ? WHERE pid = ?", Date.now() - 864e5, P1); q().exec("UPDATE acct SET t = ? WHERE pid = ?", Date.now() - 864e5, P2);
q().exec("UPDATE acct SET t = ? WHERE pid = ?", W.MIG.CUT - 864e5, P2); await op(2, "w_mig", { coins: 1000, lv: 5 });
const id2 = q().exec("SELECT vis FROM acct WHERE pid = ?", P2).one().vis;
// 0) only the owner
for (const o of ["a_coins", "a_item", "a_lvl", "a_sid", "a_ann", "a_mnt", "a_modes", "a_price", "a_gift", "a_promo", "a_kick", "a_mdel", "a_mclr", "a_trs", "a_stats", "a_rooms", "a_cfg", "a_bak"]) { const r = await A(2, o, { id: "1", why: "test x", sure: 1 }); if (r.err !== "forbidden") ok(false, "non-owner refused " + o + " -> " + JSON.stringify(r)); }
ok(true, "every new admin op refuses a non-owner (18 ops)");
ok((await A(1, "a_coins", { id: id2, bal: 5 })).err === "reason", "a reason is required");
// 1) coins exact
let r = await A(1, "a_coins", { id: id2, bal: 50, why: "fix balance" }); ok(r.err === "sure", "lowering coins needs the confirm step");
r = await A(1, "a_coins", { id: id2, bal: 50, why: "fix balance", sure: 1 }); ok(r.ok && (await op(2, "w_get")).w.bal === 50, "coins set to an exact balance (1000 -> 50)");
r = await A(1, "a_coins", { id: id2, bal: 7777, why: "comp" }); ok(r.ok && (await op(2, "w_get")).w.bal === 7777, "raise to 7777 without the extra confirm");
ok(q().exec("SELECT d FROM led WHERE pid = ? AND k = 'adm' ORDER BY id DESC LIMIT 1", P2).one().d === 7727, "ledger row has the exact delta");
ok((await A(1, "a_coins", { id: "1", bal: 5, why: "self test", sure: 1 })).err, "owner's own wallet is not editable here (ID 1 protected)");
// 2) items
r = await A(1, "a_item", { id: id2, it: "fl:7", why: "gift flag" }); ok(r.ok && (await op(2, "w_get")).w.own.includes("fl:7"), "item given");
ok((await A(1, "a_item", { id: id2, it: "nope", why: "bad item" })).err === "na", "unknown item refused");
r = await A(1, "a_item", { id: id2, it: "fl:7", rm: 1, why: "take back", sure: 1 }); ok(r.ok && !(await op(2, "w_get")).w.own.includes("fl:7"), "item removed (with confirm)");
// 3) level
r = await A(1, "a_lvl", { id: id2, lv: 20, why: "level fix" }); ok(r.ok && W.lvOf((await op(2, "w_get")).w.sx) === 20, "level set to 20 (server XP)");
ok((await A(1, "a_lvl", { id: id2, lv: 3, why: "lower" })).err === "sure", "lowering a level needs confirm");
// 4) special id
r = await A(1, "a_sid", { id: id2, n: "77777", why: "vip" }); ok(r.ok && r.me.prem.includes("77777"), "special id 77777 assigned");
ok((await A(1, "a_sid", { id: id2, n: "1", why: "x1x" })).err === "bad", "id 1 can never be assigned");
ok((await A(1, "a_sid", { id: id2, n: "77777", why: "dup" })).err === "sold", "an id already held is refused");
r = await A(1, "a_sid", { id: id2, n: "77777", rm: 1, why: "remove", sure: 1 }); ok(r.ok && !r.me.prem.includes("77777") && !(await op(2, "w_get")).w.own.includes("sid:77777"), "special id removed");
// 5) announcement / maintenance / modes
r = await A(1, "a_ann", { tx: "مرحبا بالجميع — new season!", hours: 2, why: "season" }); ok(r.ok && S().cfgPub().ann.tx.startsWith("مرحبا"), "announcement in any language, with expiry");
r = await A(1, "a_mnt", { on: 1, msg: "back soon", why: "upgrade" }); ok(r.err === "sure", "maintenance on needs confirm");
r = await A(1, "a_mnt", { on: 1, msg: "back soon", why: "upgrade", sure: 1 }); ok(r.ok, "maintenance on");
let u = await (await S().fetch(new Request("https://social/s/uid?pid=" + P2))).json(); ok(u.mt && u.mt.k === "maint" && u.mt.m === "back soon", "maintenance: rooms refuse a player with the message");
u = await (await S().fetch(new Request("https://social/s/uid?pid=" + P1))).json(); ok(!u.mt, "owner exempt from maintenance");
await A(1, "a_mnt", { on: 0, why: "done now" }); u = await (await S().fetch(new Request("https://social/s/uid?pid=" + P2))).json(); ok(!u.mt, "maintenance off");
r = await A(1, "a_modes", { moff: ["online", "zen", "bogus"], eoff: ["rain"], why: "test modes" }); ok(r.ok && r.moff.join() === "online,zen" && r.eoff.join() === "rain", "modes / events switched off (unknown ignored)");
u = await (await S().fetch(new Request("https://social/s/uid?pid=" + P2))).json(); ok(u.mt && u.mt.k === "off" && u.evo.includes("rain"), "online off reaches rooms; events off list too");
await A(1, "a_modes", { moff: [], eoff: [], why: "restore" });
// 6) gift to all (one claim each, idempotent, accounts made after the gift do not get it)
r = await A(1, "a_gift", { coins: 250, items: ["fl:3"], days: 3, why: "thanks" }); ok(r.ok, "gift to all created");
const b0 = (await op(2, "w_get")).w.bal; ok(S().giftClaim(P2) === 1 && S().giftClaim(P2) === 0, "gift claimed once per player");
ok((await op(2, "w_get")).w.bal === b0 + 250 && (await op(2, "w_get")).w.own.includes("fl:3"), "gift paid: +250 and the item");
await op(9, "w_get"); ok(S().giftClaim(await pidOf(pk(9))) === 0, "an id created after the gift gets nothing (no farming)");
// 7) promo codes
r = await A(1, "a_promo", { code: "eid2026", coins: 100, max: 1, days: 2, why: "eid" }); ok(r.ok && r.code === "EID2026", "promo created (upper-case)");
ok((await A(1, "a_promo", { code: "EID2026", coins: 1, why: "dup" })).err === "taken", "duplicate code refused");
const b1 = (await op(2, "w_get")).w.bal; r = await op(2, "promo", { code: "eid2026" }); ok(r.ok && r.c === 100 && (await op(2, "w_get")).w.bal === b1 + 100, "player redeems (+100)");
ok((await op(2, "promo", { code: "EID2026" })).err === "used", "second redeem: used"); ok((await op(9, "promo", { code: "EID2026" })).err === "max", "max uses reached");
ok((await op(9, "promo", { code: "NOPE1" })).err === "bad", "unknown code refused");
await A(1, "a_promo", { code: "OLD1", coins: 5, days: 1, why: "exp test" }); q().exec("UPDATE promo SET exp = 1 WHERE code = 'OLD1'"); ok((await op(9, "promo", { code: "OLD1" })).err === "exp", "expired code refused");
// 8) prices
const sk = SK.SKINS.find((x) => x.src && x.src.startsWith("coins:")); const base = +sk.src.split(":")[1];
r = await A(1, "a_price", { key: sk.id, price: 123, why: "sale" }); ok(r.ok && E.catItem("skin", SK.SKINS.indexOf(sk)).base === 123, "price override reaches the server catalogue");
const c = await A(1, "a_cfg"); ok(c.cfg.px[sk.id] === 123 && c.prices.find((x) => x.k === sk.id).b === base, "config lists override + base");
await A(1, "a_price", { key: sk.id, price: 0, why: "reset" }); ok(E.catItem("skin", SK.SKINS.indexOf(sk)).base === base, "price reset to base");
ok((await A(1, "a_price", { key: "zzz", price: 5, why: "bad" })).err === "na", "unknown key refused");
// 9) chat + trophies
q().exec("INSERT INTO msg (cv, f, tx, t) VALUES ('x', ?, 'bad words', ?)", P2, Date.now()); q().exec("INSERT INTO msg (cv, f, tx, t) VALUES ('x', ?, 'more', ?)", P2, Date.now());
const ml = await A(1, "a_msgs", { id: id2 }); ok(ml.list.length === 2, "owner lists a player's messages");
r = await A(1, "a_mdel", { mid: ml.list[0].id, why: "abuse", sure: 1 }); ok(r.ok && (await A(1, "a_msgs", { id: id2 })).list.length === 1, "one message deleted");
r = await A(1, "a_mclr", { id: id2, why: "abuse", sure: 1 }); ok(r.ok && r.n === 1 && (await A(1, "a_msgs", { id: id2 })).list.length === 0, "all of a player's messages cleared");
r = await A(1, "a_trs", { id: id2, tr: 1234, why: "restore", sure: 1 }); ok(r.ok && r.tr === 1234, "trophies set");
let bg = await (await obj("board-v1").fetch(new Request("https://board/b/get?pid=" + P2))).json(); ok(bg.tr === 1234, "board holds 1234");
r = await A(1, "a_trs", { id: id2, reset: 1, why: "cheat", sure: 1 }); bg = await (await obj("board-v1").fetch(new Request("https://board/b/get?pid=" + P2))).json(); ok(r.ok && bg.tr === 0, "leaderboard entry reset");
// 10) stats, view, backup, audit
const st = await A(1, "a_stats"); ok(st.days.length === 7 && st.nw >= 1 && st.players >= 3, "stats: 7 days + today");
const v = await A(1, "a_view", { id: id2 }); ok(Array.isArray(v.items) && v.lv === 20 && v.tr === 0, "player view shows items, level, trophies");
r = await A(1, "a_bak", { why: "before update" }); ok(r.ok && r.sz > 1000 && r.kept === 1, "backup now: snapshot stored server-side (" + r.sz + " bytes)");
const bl = await (await obj("bak-v1").fetch(new Request("https://ops/x/bk"))).json(); ok(bl.list.length === 1, "backup listed");
const au = (await A(1, "a_aud")).list.map((x) => x.act); for (const a of ["coins", "item_give", "item_rm", "level", "sid_give", "sid_rm", "ann", "maint", "modes", "gift", "promo", "price", "msg_del", "msg_clr", "tr_set", "tr_reset", "backup"]) if (!au.includes(a)) ok(false, "audit missing " + a);
ok(true, "every write is in the audit log");
// 11) warm room: fast-forward bounded, varied sizes, filled leaderboard
{ const R = new W.Room({ storage: { sql: new Sql() } }, env); const t0 = performance.now(); R.init(new URLSearchParams("name_room=pub-7")); const ms = performance.now() - t0, al = R.sim.snakes.filter((s) => s.alive), ms2 = al.map((s) => s.m).sort((a, b) => b - a);
  console.log("warm init total", ms.toFixed(0), "ms; fast-forward", R.ffMs, "ms; tick", R.sim.tick, "; top masses", ms2.slice(0, 6).map(Math.round).join(","));
  ok(R.sim.tick >= W.FF.TICKS && R.ffMs < 300, "fast-forward " + W.FF.TICKS + " ticks in " + R.ffMs + " ms (< 300)");
  ok(al.length === 30 && ms2[0] > 5 * ms2[ms2.length - 1], "bots have varied sizes");
  const lb = JSON.parse(R.lbMsg()); ok(lb.lb.length === 10 && lb.lb.some((x) => x[2] > 0), "leaderboard filled, some kills");
  let f = 0; for (let i = 0; i < R.sim.FM; i++) if (R.sim.fa[i]) f++; ok(f > 500, "food spread (" + f + ")");
  R.idleAt = Date.now() - 60000; R.timer = null; const t1 = R.sim.tick; await R.fetch(new Request("https://room/ws?name_room=pub-7")).catch(() => {}); ok(R.sim.tick - t1 >= W.FF.RESUME - 10 && R.ffMs < 300, "paused room catches up on wake (" + (R.sim.tick - t1) + " ticks, " + R.ffMs + " ms)"); clearInterval(R.timer); }
console.log(fail ? "FAILED " + fail + " of " + n : "ALL PASS " + n); process.exit(fail ? 1 : 0);
