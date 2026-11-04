// ops1: owner-only backups on the REAL worker code (server/index.js on node:sqlite). Snapshot round-trip (social + board),
// restore is a merge and idempotent, wrong / missing admin key refused, ledger trim keeps every balance and the ledger sum
// exact (and a second trim changes nothing), restoring a pre-trim snapshot brings the detail back. Node only, no network.
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-o1-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
const W = await import(join(dir, "index.js"));
class Sql { constructor() { this.db = new DatabaseSync(":memory:"); }
  exec(q, ...b) { const st = this.db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...b).map((r) => ({ ...r })); return { toArray: () => rows, one: () => rows[0] }; } st.run(...b); return { toArray: () => [], one: () => undefined }; } }
globalThis.fetch = (u) => Promise.reject(new Error("no network in tests: " + u));
const ADMIN_KEY = "a".repeat(8) + Math.random().toString(36).slice(2);
const mkEnv = () => { const objs = new Map(); const env = { ADMIN_KEY, ROOMS: { idFromName: (x) => x, get: (id) => ({ fetch: (u, i) => obj(id).fetch(u instanceof Request ? u : new Request(u, i)) }) } };
  const obj = (id) => { let o = objs.get(id); if (!o) { o = new W.Room({ storage: { sql: new Sql() }, acceptWebSocket() {}, getWebSockets: () => [], setWebSocketAutoResponse() {} }, env); objs.set(id, o); } return o; };
  return { env, S: () => obj("social-v1"), B: () => obj("board-v1") }; };
const call = async (E, path, init = {}, key = ADMIN_KEY) => W.default.fetch(new Request("https://w" + path, { ...init, headers: key ? { "x-admin-key": key } : {} }), E.env);
const snap = async (E) => JSON.parse(await (await call(E, "/admin/snap")).text());
const DAY = 86400000, now = Date.now();
// seed: three players with wallets, items, a friendship, a report, ledger rows spread over 120 days; one board row
const A = mkEnv(), q = A.S().sdb(); A.B().db();
const P = ["p000000000000000000a", "p000000000000000000b", "p000000000000000000c"];
for (const [i, p] of P.entries()) { A.S().wRow(p); for (let k = 0; k < 30; k++) { const d = (k % 3 === 2 ? -1 : 1) * (50 + 10 * k + i); A.S().wAdd(p, d, "t", "r" + k); q.exec("UPDATE led SET t = ? WHERE id = (SELECT MAX(id) FROM led)", now - (121 - 4 * k) * DAY); } }
q.exec("INSERT INTO own (pid, it, src, t) VALUES (?, 'sk:7', 'buy', ?)", P[0], now); q.exec("INSERT INTO fr (a, b, t) VALUES (?, ?, ?)", P[0], P[1], now);
q.exec("INSERT INTO rep (by, who, mid, tx, t) VALUES (?, ?, 0, 'spam', ?)", P[1], P[2], now); q.exec("INSERT INTO nonce (n, dp, t) VALUES ('nn', ?, ?)", P[0], now);
A.B().db().exec("INSERT INTO pl (pid, name, tr, n, upd) VALUES (?, 'Ali', 1234, 3, ?)", P[0], now);
// auth
ok((await call(A, "/admin/snap", {}, "")).status === 403, "no key -> 403");
ok((await call(A, "/admin/snap", {}, ADMIN_KEY + "x")).status === 403, "wrong key -> 403");
ok((await W.default.fetch(new Request("https://w/admin/snap", { headers: { "x-admin-key": "" } }), { ROOMS: A.env.ROOMS })).status === 403, "no ADMIN_KEY secret -> 403");
// snapshot round-trip
const s1 = await snap(A); ok(s1.v === 1 && s1.wv === 8 && s1.social && s1.board, "snapshot shape v1 / wv 8");
ok(s1.social.wal.length === 3 && s1.social.led.length === 90 && s1.social.own.length === 1 && s1.social.fr.length === 1 && s1.social.rep.length === 1, "social tables in snapshot (wal, led, own, fr, rep)");
ok(!s1.social.nonce && !s1.social.ecode, "short-lived sign-in secrets skipped");
ok(s1.board.pl.length === 1 && s1.board.pl[0].tr === 1234, "board (trophies) in snapshot");
const Bn = mkEnv(); Bn.S().sdb(); Bn.B().db();
const dry = await (await call(Bn, "/admin/restore?dry=1", { method: "POST", body: JSON.stringify(s1) })).json();
ok(dry.social.led.rows === 90 && dry.social.led.live === 0 && dry.social.led.put === 0, "dry restore previews, writes nothing");
ok(Bn.S().sdb().exec("SELECT COUNT(*) AS n FROM led").one().n === 0, "dry restore left the db empty");
const r1 = await (await call(Bn, "/admin/restore", { method: "POST", body: JSON.stringify(s1) })).json();
ok(r1.social.led.put === 90 && r1.social.wal.bad === 0, "restore wrote all rows");
const s2 = await snap(Bn); ok(JSON.stringify(s2.social) === JSON.stringify(s1.social) && JSON.stringify(s2.board) === JSON.stringify(s1.board), "round-trip identical");
await call(Bn, "/admin/restore", { method: "POST", body: JSON.stringify(s1) }); const s3 = await snap(Bn);
ok(JSON.stringify(s3.social) === JSON.stringify(s1.social) && JSON.stringify(s3.board) === JSON.stringify(s1.board), "restore twice = same state (idempotent)");
ok(Bn.S().wState(P[0]).bal === A.S().wState(P[0]).bal, "restored wallet balance readable by the wallet code");
const bad = await (await call(Bn, "/admin/restore", { method: "POST", body: JSON.stringify({ v: 1, social: { sqlite_master: [{}], "x;drop": [{}], wal: [{ "pid;": 1 }] } }) })).json();
ok(bad.social.sqlite_master.skip && bad.social["x;drop"].skip && bad.social.wal.bad === 1, "restore ignores unknown tables / bad columns");
// ledger trim
const bal0 = P.map((p) => A.S().wState(p).bal), sum0 = P.map((p) => q.exec("SELECT SUM(d) AS s FROM led WHERE pid = ?", p).one().s);
const recent0 = q.exec("SELECT * FROM led WHERE t >= ? ORDER BY id", now - 60 * DAY).toArray();
const tr = await (await call(A, "/admin/trim?days=60", { method: "POST" })).json();
ok(tr.ok && tr.players === 3 && tr.removed > 0, "trim ran (" + tr.removed + " rows folded)");
ok(P.every((p, i) => A.S().wState(p).bal === bal0[i]), "wallet balances unchanged");
ok(P.every((p, i) => q.exec("SELECT SUM(d) AS s FROM led WHERE pid = ?", p).one().s === sum0[i]), "ledger sum per player exact");
ok(P.every((p) => q.exec("SELECT COUNT(*) AS n FROM led WHERE pid = ? AND t < ?", p, now - 60 * DAY).one().n === 1), "one summary row per player for the old part");
ok(JSON.stringify(q.exec("SELECT * FROM led WHERE t >= ? ORDER BY id", now - 60 * DAY).toArray()) === JSON.stringify(recent0), "rows newer than 60 days untouched");
const last = q.exec("SELECT * FROM led WHERE pid = ? ORDER BY id DESC LIMIT 1", P[1]).one(); ok(last.bal === bal0[1], "newest ledger balance = wallet balance");
const tr2 = await (await call(A, "/admin/trim?days=60", { method: "POST" })).json(); ok(tr2.players === 0 && tr2.removed === 0, "second trim changes nothing");
await call(A, "/admin/restore", { method: "POST", body: JSON.stringify(s1) });
ok(JSON.stringify((await snap(A)).social.led) === JSON.stringify(s1.social.led), "restoring the pre-trim snapshot brings the full ledger back");
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS"); process.exit(fail ? 1 : 0);
