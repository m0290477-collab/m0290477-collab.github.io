// srv1: social server (real server/index.js on node:sqlite, the engine SQLite-backed Durable Objects use): public ids
// (unique, random, id 1 reserved for the one-time founder claim), atomic special-id sale (no double sale), friend
// request flow, chat storage + 100-message cap + filter, block, rate limits, live pushes via hibernation sockets, invites,
// online ground trails whitelisted in sanitizeSkin. Node only, no network.
import { mkdtempSync, copyFileSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite"; import { createHash } from "node:crypto";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-s1-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f)); // coin1: the worker also bundles econ.js (+ skins.js, offers.js)
const W = await import(join(dir, "index.js")); W.MIG.CUT = 9e15; /* grow1: test ids count as pre-coin1 */ const M = await import(join(dir, "sim.js"));
class Sql { constructor() { this.db = new DatabaseSync(":memory:"); }
  exec(q, ...b) { const st = this.db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...b).map((r) => ({ ...r })); return { toArray: () => rows, one: () => rows[0] }; } st.run(...b); return { toArray: () => [], one: () => undefined }; } }
// hibernation socket mock: tags -> sockets, attachments, sent frames
class FakeWs { constructor() { this.out = []; this.att = null; this.open = true; } send(s) { if (!this.open) throw new Error("closed"); this.out.push(JSON.parse(s)); } serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); } deserializeAttachment() { return this.att; } close() { this.open = false; } evs(k) { return this.out.filter((o) => o.t === "ev" && (!k || o.k === k)); } }
const objs = new Map(); const env = { ROOMS: { idFromName: (n) => n, get: (id) => ({ fetch: (u, init) => obj(id).fetch(u instanceof Request ? u : new Request(u, init)) }) } };
const obj = (id) => { let o = objs.get(id); if (!o) { const tags = new Map(); o = new W.Room({ storage: { sql: new Sql() }, tags, acceptWebSocket: (ws, t) => { for (const x of t) { if (!tags.has(x)) tags.set(x, []); tags.get(x).push(ws); } }, getWebSockets: (t) => (tags.get(t) || []).filter((w) => w.open) }, env); objs.set(id, o); } return o; };
const S = () => obj("social-v1");
const pk = (n) => n.toString(16).padStart(32, "0"); const pidOf = async (k) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + k)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); };
const http = async (body, origin = "https://billke.com") => (await W.default.fetch(new Request("https://w/s", { method: "POST", body: JSON.stringify(body), headers: { origin } }), env)).json();
const op = (k, o, extra = {}) => http({ pk: pk(k), op: o, ...extra });
// a live client: socket registered under its pid (what socialWs does), ops sent as frames
async function live(k, st = "lobby") { const pid = await pidOf(pk(k)), ws = new FakeWs(); S().sAcct(pid); S().state.acceptWebSocket(ws, [pid]); ws.serializeAttachment({ pid, st }); S().sPresAll(pid); return { ws, pid,
  op: async (o, extra = {}) => { const i = Math.floor(Math.random() * 1e6); await S().webSocketMessage(ws, JSON.stringify({ t: "op", i, op: o, ...extra })); return ws.out.filter((x) => x.t === "r" && x.i === i).pop(); } }; }

// ---- 1. ids ----
const meA = (await op(1, "me")).me, meB = (await op(2, "me")).me;
ok(/^[1-9]\d{6}$/.test(meA.id) && meA.id === meA.id7 && meA.id !== meB.id, `7-digit ids assigned by the server (${meA.id}, ${meB.id})`);
ok((await op(1, "me")).me.id === meA.id, "an id is stable for the same device secret");
{ const ids = new Set(), seqs = []; for (let k = 100; k < 700; k++) { const r = (await op(k, "me")).me.id; ids.add(r); seqs.push(+r); }
  let adj = 0; for (let i = 1; i < seqs.length; i++) if (Math.abs(seqs[i] - seqs[i - 1]) === 1) adj++;
  ok(ids.size === 600 && ![...ids].includes("1") && [...ids].every((x) => /^[1-9]\d{6}$/.test(x)), "600 accounts: 600 unique 7-digit ids, none is 1");
  ok(adj === 0, "ids are not sequential (no neighbours in assignment order)"); }
const one = S().sdb().exec("SELECT * FROM ids WHERE num = '1'").toArray()[0]; ok(one && one.kind === "o" && one.pid === "", "id 1 is reserved (kind o, unowned) until the founder claims it");
ok((await op(1, "find", { id: "1" })).err === "notfound", "nobody can be found as id 1 before the claim");
ok((await op(1, "claim1", { code: "WRONG-CODE" })).err === "bad", "founder claim: a wrong code is refused");
const OWNER_H = /OWNER_H = "([0-9a-f]{64})"/.exec(readFileSync(ROOT + "/server/index.js", "utf8"))[1];
let CODE = process.env.SSP_OWNER_CODE || ""; try { CODE = CODE || readFileSync("/workspace/work/srv1/owner_code.txt", "utf8").split("\n")[0].trim(); } catch (_) {}
if (CODE && createHash("sha256").update("ssp-own|" + CODE).digest("hex") === OWNER_H) {
  const c1 = await op(9, "claim1", { code: CODE.toLowerCase() }); ok(c1.ok && c1.me.id === "1" && c1.me.own === 1, "founder claim with the one-time code -> visible id 1");
  const c2 = await op(10, "claim1", { code: CODE }); ok(c2.err === "taken", "the code cannot give id 1 to a second device");
  ok((await op(1, "find", { id: "1" })).card.own === 1, "id 1 is findable after the claim"); ok((await op(9, "me")).me.id7.length === 7, "founder keeps his 7-digit id reserved too");
} else console.log("skip founder-code checks (code file not present)");
{ let rate = 0; for (let k = 0; k < 6; k++) if ((await op(11, "claim1", { code: "x" + k })).err === "rate") rate++; ok(rate >= 1, "founder claim attempts are rate limited (5 / 10 min)"); }

// ---- 2. special ids ----
ok(M.idKind("77777") === "rep" && M.idKind("12345") === "seq" && M.idKind("98765") === "seq" && M.idKind("48213") === "std" && M.idKind("01234") === "" && M.idKind("123456") === "", "idKind: repeated / sequence / ordinary, 5 digits only");
ok(M.idPrice("11111") === 300000 && M.idPrice("12345") === 150000 && M.idPrice("40817") === 50000, "prices 300,000 / 150,000 / 50,000");
let shop = await op(1, "shop"); ok(shop.rep.length === 9 && shop.seq.length === 10 && shop.std.length === 8 && shop.std.every((n) => M.idKind(n) === "std"), "shop lists repeated, sequences and 8 ordinary picks");
// coin1: special ids are sold by the wallet in one transaction (w_sid); the undo-token flow is gone (see test/coin1.test.mjs)
const fund = async (k, c) => { await op(k, "w_mig", { coins: 0 }); const so = objs.get("social-v1"); so.wAdd(await pidOf(pk(k)), c, "test", "seed"); };
for (const k of [1, 2, 3, 30]) await fund(k, 400000);
ok((await op(1, "w_sid", { n: "77777", price: 1 })).err === "price", "buy with the wrong price is refused");
{ const r = await Promise.all([op(1, "w_sid", { n: "77777", price: 300000 }), op(2, "w_sid", { n: "77777", price: 300000 }), op(3, "w_sid", { n: "77777", price: 300000 })]);
  ok(r.filter((x) => x.ok).length === 1 && r.filter((x) => x.err === "sold").length === 2, "3 buyers at once: exactly one gets 77777, two see sold out"); }
const buyer = (await op(1, "me")).me.prem.includes("77777") ? 1 : (await op(2, "me")).me.prem.includes("77777") ? 2 : 3;
{ const m = (await op(buyer, "me")).me; ok(m.id === "77777" && /^\d{7}$/.test(m.id7), "bought id replaces the visible 7-digit id"); ok((await op(5, "find", { id: m.id7 })).card.id === "77777", "the old 7-digit id stays reserved and still finds the player");
  shop = await op(5, "shop"); ok(shop.rep.find((x) => x.n === "77777").s === 1, "shop shows 77777 sold out"); }
ok((await op(20, "buyid", { n: "12345", price: 150000 })).err === "update", "the old grant-then-pay purchase answers 'update'");
{ let rate = 0; for (let k = 0; k < 8; k++) { const r = await op(30, "w_sid", { n: String(40000 + k * 7 + 1), price: 50000 }); if (r.err === "rate") rate++; } ok(rate >= 1, "special-id purchases are rate limited"); }

// ---- 3. friends over live sockets ----
const a = await live(1), b = await live(2), c = await live(3);
const idA = (await a.op("me")).me.id, idB = (await b.op("me")).me.id, idC = (await c.op("me")).me.id;
await a.op("hello", { n: "Alice", av: "p3", fr: 2, lv: 12 }); await b.op("hello", { n: "Bob", av: "p4", lv: 40 });
ok((await b.op("hello", { n: "fuck", av: "p1" })) && (await a.op("find", { id: idB })).card.n === "***", "names go through the chat filter"); await b.op("hello", { n: "Bob", av: "p4", lv: 40 });
ok((await a.op("req", { id: idA })).err === "self" && (await a.op("req", { id: "999" })).err === "notfound", "request: self / unknown id refused");
let r = await a.op("req", { id: idB }); ok(r.ok && b.ws.evs("req").length === 1 && b.ws.evs("req")[0].from.n === "Alice", "A -> B request pushed live to B");
ok((await b.op("list")).inq.some((x) => x.id === idA) && (await a.op("list")).outq.some((x) => x.id === idB), "lists: incoming / outgoing");
r = await b.op("acc", { id: idA }); ok(r.ok && a.ws.evs("acc").length === 1, "B accepts, A is told live");
let la = await a.op("list"); ok(la.fr.length === 1 && la.fr[0].id === idB && la.fr[0].st === "lobby" && la.inq.length === 0, "friends list with presence (lobby)");
b.ws.serializeAttachment({ pid: b.pid, st: "lobby" }); await S().webSocketMessage(b.ws, JSON.stringify({ t: "st", s: "match" }));
ok(a.ws.evs("pres").some((e) => e.id === idB && e.st === "match") && (await a.op("list")).fr[0].st === "match", "presence: in a match, pushed to friends");
await S().webSocketMessage(b.ws, JSON.stringify({ t: "st", s: "lobby" }));
await c.op("req", { id: idA }); r = await a.op("dec", { id: idC }); ok(r.ok && (await a.op("list")).inq.length === 0 && (await c.op("list")).outq.length === 0, "decline clears the request");
await c.op("req", { id: idA }); r = await a.op("req", { id: idC }); ok(r.ok && (await a.op("list")).fr.length === 2, "a request back to someone who asked first = accept");

// ---- 4. messages ----
r = await a.op("send", { id: idB, tx: "hi Bob 👋 GG" }); ok(r.ok && r.m.tx === "hi Bob 👋 GG" && b.ws.evs("msg").length === 1 && b.ws.evs("msg")[0].m.tx === "hi Bob 👋 GG", "message (with emoji) stored and pushed live");
ok((await b.op("list")).fr.find((x) => x.id === idA).un === 1, "unread badge count");
let ms = await b.op("msgs", { id: idA }); ok(ms.list.length === 1 && ms.list[0].me === 0 && (await b.op("list")).fr.find((x) => x.id === idA).un === 0, "opening the chat marks it read");
ok((await a.op("send", { id: idB, tx: "x".repeat(201) })).err === "long" && (await a.op("send", { id: idB, tx: "   " })).err === "empty", "201 chars / empty refused");
r = await a.op("send", { id: idB, tx: "add me www.spam.com or 0770 123 4567 you كلب" }); ok(r.ok && r.filt && !/spam|0770|كلب/.test(r.m.tx), "links, phone numbers and bad words filtered (EN + AR)");
{ const x = await live(41), idX = (await x.op("me")).me.id; ok((await a.op("send", { id: idX, tx: "hey" })).err === "notfriend", "messages only between friends"); }
// cap: 100 per conversation (rate limit is per sender, so two senders + clock shift)
const realNow = Date.now; let NOW = realNow(); Date.now = () => NOW;
for (let k = 0; k < 130; k++) { NOW += 3100; S().rl.clear(); const s = k % 2 ? a : b, to = k % 2 ? idB : idA; const q = await s.op("send", { id: to, tx: "m" + k }); if (!q.ok) { console.log("send failed", q); break; } }
ms = await a.op("msgs", { id: idB }); const stored = S().sdb().exec("SELECT COUNT(*) AS n FROM msg WHERE cv = ?", W.Room.cv(a.pid, b.pid)).one().n;
ok(ms.list.length === 100 && stored === 100 && ms.list[99].tx === "m129" && ms.list[0].tx === "m30", "only the last 100 messages are kept per conversation");
{ S().rl.clear(); let rate = 0; for (let k = 0; k < 25; k++) { NOW += 1000; const q = await a.op("send", { id: idB, tx: "s" + k }); if (q.err === "rate") rate++; } ok(rate >= 5, `message rate limit (20/min, 3 per 2 s): ${rate} of 25 refused`); }
{ S().rl.clear(); let rate = 0; for (let k = 0; k < 14; k++) { const q = await a.op("find", { id: String(1000000 + k) }); } for (let k = 0; k < 12; k++) { const x = await a.op("req", { id: String(1000000 + k) }); if (x.err === "rate") rate++; } ok(rate >= 1, "friend-request rate limit (10/min)"); }
Date.now = realNow;
r = await b.op("rep", { id: idA, mid: ms.list[99].i }); ok(r.ok && S().sdb().exec("SELECT COUNT(*) AS n FROM rep").one().n === 1, "report a message (stored for review)");

// ---- 5. invites ----
S().rl.clear(); r = await a.op("inv", { id: idB }); const ie = b.ws.evs("inv").pop();
ok(r.ok && /^f-[a-z0-9]{1,7}$/.test(r.room) && r.live === 1 && ie && ie.room === r.room && ie.from.id === idA, `invite pushed live with a private room (${r.room})`);
const ir = await b.op("invr", { id: idA, ok: 1 }); ok(ir.ok && ir.room === r.room && a.ws.evs("invr").pop().ok === 1, "B joins: both get the same room");
ok((await b.op("invr", { id: idA, ok: 1 })).err === "expired", "an invite is used once");
{ let rate = 0; for (let k = 0; k < 8; k++) if ((await a.op("inv", { id: idB })).err === "rate") rate++; ok(rate >= 1, "invite rate limit (6/min)"); }

// ---- 6. block ----
r = await b.op("blk", { id: idA }); ok(r.ok && (await a.op("list")).fr.every((x) => x.id !== idB) && (await b.op("list")).bl.some((x) => x.id === idA), "block removes the friendship and lists the blocked player");
const before = b.ws.evs("req").length; r = await a.op("req", { id: idB }); ok(r.ok && b.ws.evs("req").length === before && (await b.op("list")).inq.length === 0, "a blocked player's request looks sent but is never delivered");
ok((await a.op("send", { id: idB, tx: "hello?" })).err === "notfriend" && (await a.op("inv", { id: idB })).err !== "ok", "no messages / invites after a block");
ok((await b.op("req", { id: idA })).err === "blocked", "the blocker must unblock first"); await b.op("unb", { id: idA }); ok((await b.op("list")).bl.length === 0, "unblock");
c.ws.close(); await S().webSocketClose(c.ws); ok(a.ws.evs("pres").some((e) => e.id === idC && e.st === "off"), "closing the socket pushes offline to friends");

// ---- 7. routing + trails ----
ok((await W.default.fetch(new Request("https://w/s", { method: "POST", body: "{}", headers: { origin: "https://evil.example" } }), env)).status === 403, "social API refuses foreign origins");
ok((await http({ pk: "zz", op: "me" })).err === "pk", "a bad device secret is refused");
ok((await (await W.default.fetch(new Request("https://w/s/uid?pid=" + a.pid), env)).text()).indexOf('"id"') < 0, "internal /s/uid is not reachable from outside");
ok(M.sanitizeSkin({ gt: "lava" }).gt === "lava" && M.sanitizeSkin({ gt: "x<script>" }).gt === undefined && M.GT_IDS.length === 10, "online skins carry only the 10 known ground trails");
{ const sk = readFileSync(ROOT + "/js/skins.js", "utf8"), ids = [...sk.slice(sk.indexOf("GTRAILS = ["), sk.indexOf("];", sk.indexOf("GTRAILS = ["))).matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]); ok(ids.join() === M.GT_IDS.join(), "sim GT_IDS == skins GTRAILS order"); }
console.log(fail ? `${fail} FAILED` : "ALL PASS"); process.exit(fail ? 1 : 0);
