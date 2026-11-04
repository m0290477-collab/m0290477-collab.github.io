// srv2: accounts + sign-in, owner admin, live servers + matchmaking (real server/index.js on node:sqlite, the engine SQLite-backed
// Durable Objects use). ID-token verification against a mock JWKS (RS256 keys made here), device -> account link + restore on a
// second device, versioned snapshots (stale / allowance), sign-out + real delete, founder-only admin (non-founder denied),
// ban + mute enforcement (social ops, chat, rooms, matchmaker), live grants over the social socket, report review, audit log,
// matchmaking brackets + fallback + hold, and the warm room state. Node only, no network.
import { mkdtempSync, copyFileSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-s2-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f)); // coin1: the worker also bundles econ.js (+ skins.js, offers.js)
const W = await import(join(dir, "index.js")); W.MIG.CUT = 9e15; /* grow1: test ids count as pre-coin1 */
class Sql { constructor() { this.db = new DatabaseSync(":memory:"); }
  exec(q, ...b) { const st = this.db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...b).map((r) => ({ ...r })); return { toArray: () => rows, one: () => rows[0] }; } st.run(...b); return { toArray: () => [], one: () => undefined }; } }
class FakeWs { constructor() { this.out = []; this.att = null; this.open = true; this.code = 0; this.L = {}; } send(s) { if (!this.open) throw new Error("closed"); this.out.push(typeof s === "string" ? JSON.parse(s) : s); }
  serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); } deserializeAttachment() { return this.att; } close(c) { this.open = false; this.code = c || 1000; } accept() {} addEventListener(k, f) { this.L[k] = f; }
  evs(k) { return this.out.filter((o) => o && o.t === "ev" && (!k || o.k === k)); } }
// Workers runtime bits Node lacks: WebSocketPair and a 101 Response
globalThis.WebSocketPair = function () { const a = new FakeWs(), b = new FakeWs(); return { 0: a, 1: b }; };
const R0 = globalThis.Response; globalThis.Response = class extends R0 { constructor(b, i) { super(b, i && i.status === 101 ? { ...i, status: 200 } : i); if (i && i.webSocket) this.webSocket = i.webSocket; } };
const TEST_KEY = "k-" + Math.random().toString(36).slice(2);
const objs = new Map(); const env = { GOOGLE_CLIENT_ID: "test-google.apps.googleusercontent.com", APPLE_SERVICES_ID: "net.billke.snake.web", TEST_KEY, ROOMS: { idFromName: (n) => n, get: (id) => ({ fetch: (u, init) => obj(id).fetch(u instanceof Request ? u : new Request(u, init)) }) } };
const obj = (id) => { let o = objs.get(id); if (!o) { const tags = new Map(), all = [];
  o = new W.Room({ storage: { sql: new Sql() }, tags, acceptWebSocket: (ws, t) => { all.push(ws); for (const x of t) { if (!tags.has(x)) tags.set(x, []); tags.get(x).push(ws); } }, getWebSockets: (t) => (t === undefined ? all : tags.get(t) || []).filter((w) => w.open), setWebSocketAutoResponse() {} }, env); objs.set(id, o); } return o; };
const S = () => obj("social-v1");
const pk = (n) => n.toString(16).padStart(32, "0"); const pidOf = async (k) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + k)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); };
const post = async (path, body) => (await W.default.fetch(new Request("https://w" + path, { method: "POST", body: JSON.stringify(body), headers: { origin: "https://billke.com" } }), env)).json();
const op = (k, o, extra = {}) => post("/s", { pk: pk(k), op: o, ...extra });
const aop = (k, o, extra = {}) => post("/a", { pk: pk(k), op: o, ...extra });
async function live(k) { const r = await S().socialWs(new Request("https://social/sws?pk=" + pk(k)), new URL("https://social/sws?pk=" + pk(k))); const ws = r.webSocket ? null : null; // socialWs accepts the server end
  const all = S().state.getWebSockets(); const w = all[all.length - 1]; return { ws: w, op: async (o, extra = {}) => { const i = Math.floor(Math.random() * 1e6); await S().webSocketMessage(w, JSON.stringify({ t: "op", i, op: o, ...extra })); return w.out.filter((x) => x.t === "r" && x.i === i).pop(); } }; }

// ---------- 1. ID tokens: RS256 against a mock JWKS ----------
const gen = async () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const K1 = await gen(), K2 = await gen(), jw1 = { ...(await crypto.subtle.exportKey("jwk", K1.publicKey)), kid: "k1", use: "sig", alg: "RS256" }, jw2 = { ...(await crypto.subtle.exportKey("jwk", K2.publicKey)), kid: "k2", use: "sig", alg: "RS256" };
const b64 = (u) => Buffer.from(u).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function jwt(claims, { key = K1.privateKey, kid = "k1", alg = "RS256" } = {}) { const h = b64(JSON.stringify({ alg, kid, typ: "JWT" })), p = b64(JSON.stringify(claims)); const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h + "." + p)); return h + "." + p + "." + b64(new Uint8Array(sig)); }
let jwksCalls = 0; const JW = { "https://www.googleapis.com/oauth2/v3/certs": [jw1, jw2], "https://appleid.apple.com/auth/keys": [jw1] };
const fetcher = async (u) => { jwksCalls++; return new R0(JSON.stringify({ keys: JW[u] || [] }), { headers: { "content-type": "application/json" } }); };
globalThis.fetch = (u, i) => (typeof u === "string" && JW[u] ? fetcher(u) : Promise.reject(new Error("no network in tests: " + u)));
const now = Date.now() / 1000, G = { ...W.IDP.g, aud: env.GOOGLE_CLIENT_ID, fetcher }, gc = (o = {}) => ({ iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, sub: "g-1001", email: "molier@example.com", email_verified: true, iat: now, exp: now + 3600, ...o });
const bad = async (p) => { try { await p; return ""; } catch (e) { return e.message; } };
ok((await W.verifyIdToken(await jwt(gc()), G)).sub === "g-1001", "token: a valid Google ID token verifies (RS256, JWKS key k1)");
ok((await W.verifyIdToken(await jwt(gc(), { key: K2.privateKey, kid: "k2" }), G)).sub === "g-1001", "token: second key in the JWKS (rotation) verifies");
ok((await bad(W.verifyIdToken(await jwt(gc({ aud: "someone-else" })), G))) === "aud", "token: wrong audience refused");
ok((await bad(W.verifyIdToken(await jwt(gc({ iss: "https://evil.example" })), G))) === "iss", "token: wrong issuer refused");
ok((await bad(W.verifyIdToken(await jwt(gc({ exp: now - 600 })), G))) === "expired", "token: expired refused");
ok((await bad(W.verifyIdToken(await jwt(gc(), { key: K2.privateKey, kid: "k1" }), G))) === "signature", "token: signature by another key refused");
{ const c0 = jwksCalls; ok((await bad(W.verifyIdToken(await jwt(gc(), { kid: "k9" }), G))) === "kid" && jwksCalls > c0, "token: unknown kid -> JWKS refetched once, then refused"); }
{ const t = await jwt(gc()); const [h, p] = t.split("."); const forged = h + "." + b64(JSON.stringify(gc({ sub: "g-attacker" }))) + "." + t.split(".")[2]; ok((await bad(W.verifyIdToken(forged, G))) === "signature", "token: edited claims (sub) refused"); }
ok((await bad(W.verifyIdToken(await jwt(gc(), { alg: "none" }), G))) === "alg", "token: alg other than RS256 refused");
ok((await bad(W.verifyIdToken(await jwt(gc()), { ...G, aud: "" }))) === "not configured", "token: refused while the client id is not configured");
const A = { ...W.IDP.a, aud: env.APPLE_SERVICES_ID, fetcher }; ok((await W.verifyIdToken(await jwt({ iss: "https://appleid.apple.com", aud: env.APPLE_SERVICES_ID, sub: "000123.abc", iat: now, exp: now + 600 }), A)).sub === "000123.abc", "token: Apple ID token verifies against the Apple JWKS");
{ const c = await (await W.default.fetch(new Request("https://w/cfg"), env)).json(); ok(c.g === env.GOOGLE_CLIENT_ID && c.a === env.APPLE_SERVICES_ID && c.ar === "https://billke.com/pro/" && c.em === 0, "/cfg: public client ids + redirect, email off without a mail key"); }
{ const c = await (await W.default.fetch(new Request("https://w/cfg"), { ROOMS: env.ROOMS })).json(); ok(c.g === "" && c.a === "", "/cfg: empty ids when not configured (buttons hidden)"); }

// ---------- 2. sign in, link + restore on a second device ----------
const mkProf = (coins, extra = {}) => JSON.stringify({ v: 1, name: "Molier", coins, xp: 5000, owned: ["s1"], cos: [], rc: [], dev: "ffffffffffffffffffffffffffffffff", ...extra });
const dA = 11, dB = 12, dC = 13;
const idA = (await op(dA, "me")).me.id, idB0 = (await op(dB, "me")).me.id; await op(dC, "me");
await op(dA, "hello", { n: "Molier", av: "p2", lv: 5 }); await op(dC, "hello", { n: "Friend C", av: "p4", lv: 3 });
await op(dA, "req", { id: (await op(dC, "me")).me.id }); await op(dC, "acc", { id: idA });
ok((await aop(dA, "snap", { sv: 0, js: mkProf(500) })).sv === 1, "snapshot: first save of a device stored (sv 1)");
let n1 = (await aop(dA, "nonce")).n; let r = await aop(dA, "google", { tok: await jwt(gc({ nonce: n1 })) });
ok(r.ok && r.mode === "new" && r.acct && r.acct.g === 1 && r.me.id === idA, "Google sign-in on device A creates the account from A's profile (same ID " + idA + ")");
ok((await aop(dA, "google", { tok: await jwt(gc({ nonce: n1 })) })).err === "nonce", "a nonce works once (replayed token refused)");
ok((await aop(dA, "google", { tok: await jwt(gc()) })).err === "nonce", "a token without our nonce is refused");
ok((await aop(dA, "google", { tok: await jwt(gc({ aud: "x" })) })).err === "token", "worker refuses a token for another client id");
ok((await post("/s", { pk: pk(dA), op: "idt", _v: { k: "g", sub: "g-attacker" } })).err !== undefined && !(await aop(dB, "acst")).acct, "a client cannot forge a verified identity (/s strips _v, idt needs the worker)");
{ const w = await live(dB); await S().webSocketMessage(w.ws, JSON.stringify({ t: "op", i: 7, op: "idt", _v: { k: "t", sub: "forged" } })); const rr = w.ws.out.find((x) => x.i === 7); ok(rr && rr.err === "token", "...and neither can a socket message"); w.ws.close(); }
let n2 = (await aop(dB, "nonce")).n; r = await aop(dB, "google", { tok: await jwt(gc({ nonce: n2 })) });
ok(r.ok && r.mode === "restore" && r.snap && JSON.parse(r.snap.js).coins === 500 && r.me.id === idA, "device B signs in with the same Google account -> restores A's profile (500 coins, ID " + idA + ")");
ok(!/ffffffff/.test(r.snap.js) && !("dev" in JSON.parse(r.snap.js)), "the device secret is never stored in or returned with a snapshot");
ok((await op(dB, "me")).me.id === idA && (await op(dB, "list")).fr.some((f) => f.n === "Friend C"), "device B now has A's ID and friends (social rows follow the account)");
ok((await aop(dB, "snap", { sv: 1, js: mkProf(650) })).sv === 2, "device B saves on top (sv 2)");
r = await aop(dA, "snap", { sv: 1, js: mkProf(520) }); ok(r.err === "stale" && r.sv === 2 && JSON.parse(r.js).coins === 650, "device A's older base is refused as stale and gets B's newer save");
r = await aop(dA, "snap", { sv: 2, js: mkProf(650 + 1e6) }); ok(r.ok && r.adj && r.adj.coins === 650 + 4000 && JSON.parse((await aop(dA, "pull")).js).coins === 4650, "coins rising faster than play allows are cut back by the server (+1,000,000 -> +4,000)");
{ const ar = await aop(dA, "acst"); ok(ar.acct && ar.acct.g === 1 && ar.sv === 3, "account status: signed in with Google, snapshot sv 3"); }
// email: off without a mail sender, works with one (mail API mocked)
ok((await aop(dC, "em1", { email: "c@example.com" })).err === "mail_off", "email sign-in reports mail_off while no mail sender is configured");
{ const sent = []; env.MAIL_API_KEY = "re_test"; env.MAIL_FROM = "Super Snake <login@billke.com>"; const of = globalThis.fetch; globalThis.fetch = async (u, i) => { if (String(u).includes("resend")) { sent.push(JSON.parse(i.body)); return new R0("{}", { status: 200 }); } return of(u, i); };
  ok((await aop(dC, "em1", { email: "C@Example.com" })).ok === 1 && sent.length === 1 && sent[0].to[0] === "c@example.com", "email: a one-time code is mailed when a sender is configured");
  const code = /code is (\d{6})/.exec(sent[0].text)[1]; ok((await aop(dC, "em2", { email: "c@example.com", code: code === "111111" ? "222222" : "111111" })).err === "code", "email: a wrong code is refused");
  ok((await aop(dB, "em2", { email: "c@example.com", code })).err === "expired", "email: the code only works on the device that asked for it");
  r = await aop(dC, "em2", { email: "c@example.com", code }); ok(r.ok && r.mode === "new" && r.acct.e === "c***@example.com", "email: the right code links the account (address masked)");
  ok((await aop(dC, "em2", { email: "c@example.com", code })).err === "expired", "email: a code works once");
  globalThis.fetch = of; delete env.MAIL_API_KEY; delete env.MAIL_FROM; }
// sign out + delete
ok((await aop(dB, "out")).ok && (await op(dB, "me")).me.id === idB0, "sign out: device B is back to its own ID " + idB0);
{ const pa = await pidOf(pk(dA)); ok((await aop(dA, "adel")).ok === 1, "account delete (device A)");
  const q = S().sdb(); ok(!q.exec("SELECT * FROM au WHERE pid = ?", pa).toArray().length && !q.exec("SELECT * FROM snp WHERE pid = ?", pa).toArray().length && !q.exec("SELECT * FROM dl WHERE aid IS NOT NULL AND dp = ?", pa).toArray().length && !q.exec("SELECT * FROM fr WHERE a = ? OR b = ?", pa, pa).toArray().length, "delete is a real server delete: account, links, snapshot, friendships gone");
  ok(!(await op(dC, "list")).fr.some((f) => f.n === "Molier") && (await op(dA, "me")).me.id !== idA, "the friend no longer sees the deleted player; device A starts over with a new ID");
  n2 = (await aop(dB, "nonce")).n; ok((await aop(dB, "google", { tok: await jwt(gc({ nonce: n2 })) })).mode === "new", "after the delete, the same Google account starts a brand-new account"); await aop(dB, "adel"); }

// ---------- 3. founder (id 1) + admin authorisation ----------
let CODE = process.env.SSP_OWNER_CODE || ""; try { CODE = CODE || readFileSync("/workspace/work/srv1/owner_code.txt", "utf8").split("\n")[0].trim(); } catch (_) {}
const dF = 21, dF2 = 22, dX = 23, dT = 24, dU = 25;
if (CODE) {
  ok((await op(dF, "claim1", { code: CODE })).ok === 1, "founder claims id 1 with the SSP1 code");
  r = await aop(dF, "test", { key: TEST_KEY, name: "founder-test" }); ok(r.ok && r.mode === "new" && r.acct.own === 1 && r.me.id === "1", "founder links an account: the account owns id 1");
  ok((await aop(dF2, "test", { key: "nope", name: "founder-test" })).err === "op", "test sign-in needs the TEST_KEY secret");
  r = await aop(dF2, "test", { key: TEST_KEY, name: "founder-test" }); ok(r.ok && r.mode === "restore" && r.me.id === "1" && r.me.own === 1, "founder signs in on a second device: id 1 + owner come along");
  ok((await aop(dF2, "adel")).err === "owner", "the founder account cannot be deleted by accident");
} else ok(false, "owner code not available (SSP_OWNER_CODE)");
const idT = (await op(dT, "hello", { n: "Target T", av: "p1", lv: 2 })).me.id, idU = (await op(dU, "hello", { n: "QA Smoke A", av: "p1", lv: 2 })).me.id; await op(dX, "hello", { n: "Mallory", av: "p1", lv: 2 });
for (const o of ["a_find", "a_view", "a_srv", "a_ban", "a_grant", "a_reps", "a_aud", "a_del"]) { const rr = await op(dX, o, { q: "T", id: idT, why: "trying", coins: 100, mins: 60 }); if (rr.err !== "forbidden") ok(false, "non-founder " + o + " -> " + JSON.stringify(rr)); }
ok(true, "non-founder is denied every admin op (find, view, server view, ban, grant, reports, audit, delete)");
ok((await op(dX, "a_ban", { id: idT, why: "x", own: 1, _own: 1 })).err === "forbidden", "a client flag cannot make anyone an admin");
const F = (o, e = {}) => op(dF2, o, e);
ok((await F("a_find", { q: "Target" })).list.some((x) => x.id === idT) && (await F("a_find", { q: idT })).list[0].id === idT, "admin search by name and by ID");
ok((await F("a_ban", { id: idT, mins: 60 })).err === "reason", "every admin action needs a reason");
ok((await F("a_ban", { id: "1", mins: 60, why: "test self" })).err === "self", "the founder cannot ban himself");
// ban enforcement
const tLive = await live(dT);
r = await F("a_ban", { id: idT, mins: 60, why: "cheating (test)" }); ok(r.ok && r.until > Date.now() + 3500000, "temporary ban (60 min)");
ok(tLive.ws.evs("ban").length === 1, "the banned player is told live over /sws");
ok((await op(dT, "list")).err === "banned" && (await op(dT, "send", { id: "1", tx: "hi" })).err === "banned", "a banned player's social ops are refused");
{ const u = await (await S().socialHttp(new Request("https://social/s/uid?pid=" + (await pidOf(pk(dT)))), new URL("https://social/s/uid?pid=" + (await pidOf(pk(dT)))))).json(); ok(u.ban > Date.now(), "rooms see the ban (/s/uid)"); }
{ const m = await (await W.default.fetch(new Request("https://w/mm?pk=" + pk(dT)), env)).json(); ok(m.err === "banned", "the matchmaker refuses a banned player"); }
{ const RM = obj("pub-bs-9"); await RM.fetch(new Request("https://room/ws?name_room=pub-bs-9")); const c = [...RM.clients].pop(); RM.onMsg(c, JSON.stringify({ t: "hello", name: "Target T", pk: pk(dT) })); await new Promise((q) => setTimeout(q, 60));
  ok(c.ws.out.some((o) => o && o.t === "ban") && c.ws.code === 4003 && c.banned, "a game room refuses a banned player (ban message + close 4003)"); RM.drop(c); }
ok((await F("a_unban", { id: idT, why: "appeal ok (test)" })).ok && !(await op(dT, "list")).err, "unban restores access");
{ await F("a_ban", { id: idT, mins: 0, why: "permanent (test)" }); const v = await F("a_view", { id: idT }); ok(v.ban && v.ban.until > Date.now() + 1e12, "permanent ban"); await F("a_unban", { id: idT, why: "undo (test)" }); }
// mute
await op(dT, "req", { id: "1" }); await op(dF2, "acc", { id: idT });
ok((await F("a_mute", { id: idT, mins: 30, why: "spam (test)" })).ok && (await op(dT, "send", { id: "1", tx: "spam" })).err === "muted", "mute: chat refused while muted");
{ const uu = "https://social/s/uid?pid=" + (await pidOf(pk(dT))), u = await (await S().socialHttp(new Request(uu), new URL(uu))).json(); ok(u.mute > Date.now(), "rooms see the mute (emotes blocked)"); }
ok((await F("a_unmute", { id: idT, why: "ok now (test)" })).ok && (await op(dT, "send", { id: "1", tx: "sorry" })).ok, "unmute: chat works again");
// grants arrive live and land in the server snapshot
await aop(dT, "snap", { sv: 0, js: mkProf(100) });
r = await F("a_grant", { id: idT, coins: 750, items: ["gt:lava", "av:x1"], why: "event prize (test)" });
{ const ev = tLive.ws.evs("grant").pop(); ok(r.ok && r.live === 1 && ev && ev.g.c === 750 && ev.g.it.includes("gt:lava") && ev.sv === 2, "grant: 750 coins + 2 items pushed live over /sws (sv 2)");
  const P = JSON.parse((await aop(dT, "pull")).js); ok(P.coins === 850 && P.owned.includes("gt:lava") && P.cos.includes("av:x1") && P.rc.includes("adm:" + r.gid), "grant: applied through the server snapshot (850 coins, items, one-time key)");
  ok((await aop(dT, "snap", { sv: 2, js: JSON.stringify({ ...P, coins: 850 }) })).ok, "the client saves on top of the granted snapshot without a stale error"); }
{ const w2 = await live(dT); const hi = w2.ws.out.find((o) => o.t === "hi"); ok(hi.gr.some((g) => g.id === r.gid), "an unacknowledged grant is listed again on the next connection");
  await aop(dT, "gack", { ids: [r.gid] }); const w3 = await live(dT); ok(!w3.ws.out.find((o) => o.t === "hi").gr.length, "...and not after the client acknowledged it"); }
// name reset
r = await F("a_rname", { id: idT, why: "rude name (test)" }); ok(r.ok && tLive.ws.evs("rname").length === 1 && (await F("a_view", { id: idT })).card.n === r.n, "name reset: new server name, player told live");
ok((await op(dT, "hello", { n: "Target T", av: "p1", lv: 2 })).rn === r.n, "the old name is refused after a reset");
{ const uu = "https://social/s/uid?pid=" + (await pidOf(pk(dT))), u = await (await S().socialHttp(new Request(uu), new URL(uu))).json(); ok(u.nm === r.n, "rooms use the server name after a reset"); }
// reports
{ const ms = await op(dT, "send", { id: "1", tx: "you are bad" }); await op(dF2, "rep", { id: idT, mid: ms.m.i }); const L = (await F("a_reps")).list; const rp = L.find((x) => x.who.id === idT && x.tx === "you are bad");
  ok(rp && !rp.res, "reports: the owner sees stored reports (who, by, message)");
  ok((await F("a_res", { rid: rp.id, why: "warned (test)" })).ok && (await F("a_reps")).list.find((x) => x.id === rp.id).res === 1, "reports: marked resolved with a reason");
  const v = await F("a_view", { id: idT }); ok(v.reps.length >= 1 && v.devices.length >= 1 && v.snap && v.snap.coins === 850 && v.card.id === idT, "player view: profile, devices, reports, snapshot"); }
// server view + QA account removal + audit
{ const sv = await F("a_srv"); ok(sv.online >= 1 && typeof sv.msgMin === "number" && sv.errs && Array.isArray(sv.rooms), "server view: online / lobby / rooms / messages per minute / errors"); }
{ const L = (await F("a_find", { q: "QA Smoke" })).list; ok(L.some((x) => x.id === idU), "QA Smoke account found");
  for (const x of L) await F("a_del", { id: x.id, why: "remove QA smoke account (test)" }); ok(!(await F("a_find", { q: "QA Smoke" })).list.length && (await F("a_find", { q: idU })).list.length === 0, "QA Smoke accounts removed (real delete)"); }
{ const L = (await F("a_aud")).list, acts = L.map((x) => x.act); ok(["ban", "unban", "mute", "unmute", "grant", "rename", "resolve", "delete"].every((a) => acts.includes(a)) && L.every((x) => x.why && x.why.length >= 3), "audit log: every admin action with its reason"); }
ok((await F("a_del", { id: "1", why: "oops" })).err === "self", "the founder cannot delete himself through the admin panel");

// ---------- 3b. owner maintenance: move id 1 onto an account by its 7-digit id (deploy-time MAINT binding, runs once) ----------
{ const dM = 41, dM2 = 42; const idM = (await op(dM, "hello", { n: "Owner Phone", av: "p3", lv: 9 })).me.id; await op(dM2, "hello", { n: "Pal", av: "p3", lv: 2 }); await op(dM2, "req", { id: idM }); await op(dM, "acc", { id: (await op(dM2, "me")).me.id });
  await aop(dM, "snap", { sv: 0, js: mkProf(12345, { name: "Owner Phone" }) }); const wM = await live(dM);
  ok((await op(dM, "a_srv")).err === "forbidden", "before the move: that account is not an admin");
  const key = "a1b2c3d4e5f6a7b8c9d0"; env.MAINT = JSON.stringify({ op: "move1", to: idM, key }); await op(99, "me"); // any request runs it once
  const res = JSON.parse(S().sdb().exec("SELECT v FROM smeta WHERE k = ?", "maint:" + key).one().v);
  ok(res.ok && res.prev === "moved", "maintenance ran once: id 1 moved (previous holder demoted)");
  const me = (await op(dM, "me")).me; ok(me.id === "1" && me.own === 1, "the account that held " + idM + " is now id 1 + owner");
  ok((await op(99, "find", { id: idM })).err === "notfound", "its old 7-digit id " + idM + " is released");
  { const c = (await op(99, "find", { id: "1" })).card; ok(c && c.n === "Owner Phone" && c.lv === 9, "lookup of id 1 resolves to that account (name, level kept)"); }
  ok(JSON.parse((await aop(dM, "pull")).js).coins === 12345 && (await op(dM, "list")).fr.some((f) => f.n === "Pal"), "its coins (snapshot) and friends are kept");
  ok(wM.ws.code === 4012, "its live socket is asked to reconnect (to pick up id 1)");
  ok(!(await op(dM, "a_srv")).err, "after the move: the admin panel works for that account");
  ok((await op(dF2, "a_srv")).err === "forbidden" && (await op(dF2, "me")).me.id !== "1", "the previous holder lost admin and id 1");
  env.MAINT = JSON.stringify({ op: "move1", to: idT, key }); S()._mDone = ""; await op(99, "me"); ok((await op(dM, "me")).me.id === "1", "the same maintenance key never runs twice");
  delete env.MAINT;
  ok(!/"op"\s*===?\s*"move1"|op === "move1"/.test(readFileSync(ROOT + "/server/index.js", "utf8").split("maint()")[0]), "no request handler can start the move (only the MAINT binding)"); }
// ---------- 4. matchmaking ----------
ok(W.bracketOf(0) === "bs" && W.bracketOf(999) === "bs" && W.bracketOf(1000) === "gp" && W.bracketOf(2799) === "gp" && W.bracketOf(2800) === "dc" && W.bracketOf(4500) === "dc" && W.bracketOf(4500, 1) === "cq", "brackets: Bronze–Silver <1000, Gold–Platinum <2800, Diamond–Crown, Conqueror = top 50 with 4,100+");
{ const R = new Map(), P = new Map(), t = 1e12; const hb = (room, br, i, h) => R.set(room, { room, br, i, h, b: 30 - h, t, pend: 0, up: t });
  let p = W.mmPick(R, P, { pid: "p1", br: "gp", now: t }); ok(p.room === "pub-gp-1" && p.why === "new", "empty server: own bracket room #1 (bots keep it alive)");
  const p2 = W.mmPick(R, P, { pid: "p2", br: "gp", now: t + 10 }); ok(p2.room === "pub-gp-1", "two players looking at once land in the same room");
  R.clear(); P.clear(); hb("pub-gp-1", "gp", 1, 3); hb("pub-gp-2", "gp", 2, 7); hb("pub-dc-1", "dc", 1, 9);
  p = W.mmPick(R, P, { pid: "p3", br: "gp", now: t + 20 }); ok(p.room === "pub-gp-2" && !p.fb, "own bracket: the fullest room with space (Gold #2, 7 players)");
  hb("pub-gp-2", "gp", 2, 12); p = W.mmPick(R, P, { pid: "p4", br: "gp", now: t + 30 }); ok(p.room === "pub-gp-1", "a full room (12 players) is skipped");
  p = W.mmPick(R, P, { pid: "p4", br: "gp", x: "pub-gp-1", now: t + 31 }); ok(p.room !== "pub-gp-1", "a room that just said 'full' is excluded on retry");
  R.clear(); P.clear(); hb("pub-dc-1", "dc", 1, 5);
  p = W.mmPick(R, P, { pid: "c1", br: "cq", now: t + 40 }); ok(p.room === "pub-dc-1" && p.fb === "dc" && p.why === "low", "Conqueror with nobody in the bracket: falls back to the neighbouring Diamond–Crown room");
  R.clear(); P.clear(); hb("pub-bs-1", "bs", 1, 4); for (const k of ["a", "b", "c"]) P.set("busy-" + k, { br: "gp", t: t + 40 }); hb("pub-gp-1", "gp", 1, 12);
  p = W.mmPick(R, P, { pid: "g1", br: "gp", w: 0, now: t + 50 }); ok(p.hold === 1, "busy bracket but no open populated room: hold (ask again in 2.5 s)");
  p = W.mmPick(R, P, { pid: "g1", br: "gp", w: 5200, now: t + 5250 }); ok(p.room === "pub-bs-1" && p.fb === "bs" && p.why === "wait", "after ~5 s of waiting: the neighbouring bracket");
  R.clear(); P.clear(); R.set("pub-gp-3", { room: "pub-gp-3", br: "gp", i: 3, h: 0, b: 30, t: t - 120000, pend: 0, up: t });
  p = W.mmPick(R, P, { pid: "w1", br: "gp", now: t }); ok(p.room === "pub-gp-3" && p.why === "warm", "no players anywhere: the bracket's warm room (still in memory) is preferred");
  R.set("pub-gp-3", { ...R.get("pub-gp-3"), t: t - 9 * 60000 }); P.clear(); p = W.mmPick(R, P, { pid: "w2", br: "gp", now: t }); ok(p.room === "pub-gp-1", "a room idle past the warm window is not preferred"); }
// end to end: the bracket comes from the board (server-decided), not from the client
{ const B = obj("board-v1"); B.db(); const pd = await pidOf(pk(31)); const M = new Date().toISOString().slice(0, 7);
  await B.board(new Request("https://board/b/rec", { method: "POST", body: JSON.stringify({ pid: pd, name: "Goldie", d: 40, kl: 1, sc: 10 }) }), new URL("https://board/b/rec"));
  B.db().exec("UPDATE pl SET tr = 1500 WHERE pid = ?", pd);
  const m = await (await W.default.fetch(new Request("https://w/mm?pk=" + pk(31) + "&br=cq&tr=9999"), env)).json(); ok(m.room && m.room.startsWith("pub-gp-") && m.tr === 1500, "/mm: 1,500 trophies on the board -> Gold–Platinum (client hints ignored): " + m.room); }

// ---------- 5. live rooms: warm start, keep the world while empty, hb to the matchmaker ----------
{ const RM = obj("pub-gp-1"); await RM.fetch(new Request("https://room/ws?name_room=pub-gp-1")); const S0 = RM.sim, al = S0.snakes.filter((s) => s.alive);
  ok(RM.br === "gp" && RM.bi === 1 && al.length === 30 && Math.max(...al.map((s) => s.m)) > 150 && Math.min(...al.map((s) => s.m)) < 60 && S0.tick > 0, "warm start: a fresh public room already has 30 snakes at mixed sizes, mid-game (" + Math.round(Math.min(...al.map((s) => s.m))) + "–" + Math.round(Math.max(...al.map((s) => s.m))) + ")");
  const c = [...RM.clients].pop(); RM.onMsg(c, JSON.stringify({ t: "hello", name: "P", pk: pk(32) })); const wel = c.ws.out.find((o) => o && o.t === "welcome"); ok(wel && wel.br === "gp" && wel.bi === 1 && wel.h === 1 && wel.b >= 25, "welcome names the server (Gold #1), players and bots");
  await new Promise((q) => setTimeout(q, 30)); ok(obj("mm-v1").mmR && obj("mm-v1").mmR.get("pub-gp-1") && obj("mm-v1").mmR.get("pub-gp-1").h === 1, "the room reported itself to the matchmaker (1 player)");
  for (let k = 0; k < 20; k++) RM.tick(); const tk = RM.sim.tick; RM.drop(c);
  ok(RM.sim === S0 && RM.idleAt > 0 && RM.timer, "last player left: world kept in memory, still running for the linger window");
  await RM.fetch(new Request("https://room/ws?name_room=pub-gp-1")); ok(RM.sim === S0 && RM.sim.tick >= tk && !RM.idleAt, "rejoin within the warm window: the same world continues (no reset)");
  const c2 = [...RM.clients].pop(); RM.drop(c2); RM.idleAt = Date.now() - W.MM_CFG.WARM_MS - 1000;
  await RM.fetch(new Request("https://room/ws?name_room=pub-gp-1")); ok(RM.sim !== S0 && RM.sim.snakes.filter((s) => s.alive).length === 30, "after the warm window: a fresh warm world");
  for (const x of [...RM.clients]) RM.drop(x); clearInterval(RM.timer); RM.timer = null; clearTimeout(RM.lingerT);
  const R9 = obj("pub-bs-9"); clearInterval(R9.timer); R9.timer = null; clearTimeout(R9.lingerT); }
{ const src = readFileSync(ROOT + "/server/index.js", "utf8"); ok(!/setAlarm|storage\.setAlarm/.test(src), "no Durable Object alarms anywhere (an empty room makes no requests)"); }
ok(W.allowance(0).coins === 4000 && W.allowance(60).coins === 19000, "coin allowance: 4,000 + 250 per minute between saves");
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS"); process.exit(fail ? 1 : 0);
