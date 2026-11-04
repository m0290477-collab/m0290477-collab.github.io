// comp1: trophies / leagues / contests / seasons. Rules (sim.js), the worker board object (real server/index.js on a
// SQLite mock = node:sqlite, the same engine Durable Objects use), server-decided trophies per life, claims (no double
// claim), and the client side (offline caps, atomic keyed grants, checksum tamper restore). Node only, no network.
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };

// ---- browser-ish globals for the client modules (same approach as guard.test) ----
const mem = new Map(); globalThis.window = globalThis; globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.addEventListener = () => {}; globalThis.document = { hidden: false, addEventListener: () => {}, documentElement: {} }; globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.navigator) globalThis.navigator = { userAgent: "node" };

// ---- server under test: copy index.js + sim.js side by side, exactly like deploy.sh uploads them ----
const dir = mkdtempSync(join(tmpdir(), "ssp-c1-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f)); // coin1: the worker also bundles econ.js (+ skins.js, offers.js)
const W = await import(join(dir, "index.js")); W.MIG.CUT = 9e15; /* grow1: test ids count as pre-coin1 */ const M = await import(join(dir, "sim.js"));
class Sql { constructor() { this.db = new DatabaseSync(":memory:"); this.writes = 0; }
  exec(q, ...b) { const st = this.db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...b).map((r) => ({ ...r })); return { toArray: () => rows, one: () => rows[0] }; } const r = st.run(...b); this.writes += r.changes; return { toArray: () => [], one: () => undefined, rowsWritten: r.changes }; } }
const objs = new Map(); const env = { ROOMS: { idFromName: (n) => n, get: (id) => ({ fetch: (u, init) => obj(id).fetch(u instanceof Request ? u : new Request(u, init)) }) } };
const obj = (id) => { let o = objs.get(id); if (!o) { o = new W.Room({ storage: { sql: new Sql() } }, env); objs.set(id, o); } return o; };
const post = async (path, body) => (await W.default.fetch(new Request("https://w" + path, { method: "POST", body: JSON.stringify(body), headers: { origin: "https://billke.com" } }), env)).json();
const get = async (path) => (await W.default.fetch(new Request("https://w" + path, { headers: { origin: "https://billke.com" } }), env));
const rec = async (pid, d, kl = 0, sc = 0, name = "P") => (await obj("board-v1").fetch(new Request("https://board/b/rec", { method: "POST", body: JSON.stringify({ pid, name, d, kl, sc }) }))).json();
const pk = (n) => n.toString(16).padStart(32, "0"); const pidOf = async (k) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + k)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); };
const realNow = Date.now; let NOW = Date.UTC(2026, 10, 4, 12, 0); Date.now = () => NOW;

// ---- 1. shared rules ----
ok(M.leagueOf(0).id === "bronze" && M.leagueOf(0).tier === 5 && M.leagueOf(399).tier === 1 && M.leagueOf(400).id === "silver" && M.leagueOf(4100).id === "crown" && M.leagueOf(99999).tier === 1 && M.leagueOf(-5).t === 0, "leagueOf: 6 leagues x tiers V..I, clamps");
const on1 = M.trophyDelta({ place: 1, field: 30, kills: 3, life: 90, t: 500, online: 1 }), off1 = M.trophyDelta({ place: 1, field: 30, kills: 3, life: 90, t: 500 });
ok(on1 > 0 && on1 <= M.TROPHY.ON_MAX && off1 > 0 && off1 <= M.TROPHY.OFF_MAX && off1 < on1, `trophyDelta: win online +${on1}, offline +${off1} (half, capped)`);
ok(M.trophyDelta({ place: 30, field: 30, kills: 0, life: 90, t: 100, online: 1 }) === 0 && M.trophyDelta({ place: 30, field: 30, kills: 0, life: 90, t: 3000, online: 1 }) < 0, "trophyDelta: no loss below 300 trophies, loss higher up");
ok(M.trophyDelta({ place: 1, field: 30, kills: 9, life: 5, t: 500, online: 1 }) === 0, "trophyDelta: a life under 15 s never gains");
ok(M.trophyDelta({ place: 1, field: 30, kills: 999, life: 999, t: 500, online: 1 }) <= M.TROPHY.ON_MAX && M.trophyDelta({ place: 1e6, field: 1e6, kills: -5, life: 99, t: 5000, online: 1 }) >= M.TROPHY.ON_MIN, "trophyDelta: bounded for absurd input");
ok(M.seasonCarry(800) === 800 && M.seasonCarry(3000) === 2000 && M.seasonCarry(-4) === 0, "season soft reset: above 1,000 halved");
ok(M.weekId(Date.UTC(2026, 10, 4)) === "2026-W45" && M.periodEnd("w", Date.UTC(2026, 10, 4)) === Date.UTC(2026, 10, 9) && M.periodEnd("m", Date.UTC(2026, 11, 31, 23)) === Date.UTC(2027, 0, 1), "period ids / ends (UTC)");

// ---- 2. worker routing ----
ok((await get("/lb/rec")).status !== 200 || (await (await get("/lb/rec")).text()).indexOf("ok") < 0, "internal /b/rec is not reachable from outside");
ok((await W.default.fetch(new Request("https://w/lb/top?k=tr", { headers: { origin: "https://evil.example" } }), env)).status === 403, "board API refuses foreign origins");
ok((await (await get("/lb/top?k=tr")).json()).list.length === 0, "empty board answers");

// ---- 3. board: record, top, me, contests ----
const A = pk(1), B = pk(2), pa = await pidOf(A), pb = await pidOf(B);
let r = await rec(pa, 30, 4, 900, "Alice"); ok(r.ok && r.tr === 30 && r.d === 30, "rec: first life stored");
await rec(pa, 20, 2, 1200, "Alice"); await rec(pb, 10, 7, 300, "Bob"); r = await rec(pb, -50, 0, 0, "Bob"); ok(r.tr === 0 && r.d === -10, "rec: never below 0 (applied delta reported)");
NOW += 21000; // top lists are cached 20 s inside the board
let T = await (await get("/lb/top?k=tr")).json(); ok(T.list[0].n === "Alice" && T.list[0].v === 50 && T.list[0].id.length === 6, "top: trophies ranked, ids shortened");
T = await (await get("/lb/top?k=wkl")).json(); ok(T.list[0].n === "Bob" && T.list[0].v === 7, "top: weekly kills contest");
let me = await post("/lb/me", { pk: A }); ok(me.tr === 50 && me.rank === 1 && me.c.w_score[0] === 1200 && me.c.w_hunt[1] === 2 && me.claims.length === 0, "me: own totals + contest ranks");
ok((await post("/lb/me", { pk: "zz" })).err === "pk", "me: a bad secret is refused");

// ---- 4. weekly rollover -> frozen results -> one claim only ----
NOW = Date.UTC(2026, 10, 10, 1, 0); // next ISO week
T = await (await get("/lb/top?k=wkl")).json(); ok(T.list.length === 0, "new week: weekly board starts empty");
me = await post("/lb/me", { pk: B }); const cl = me.claims.find((c) => c.per === "w:2026-W45" && c.met === "kl");
ok(cl && cl.rk === 1 && cl.v === 7, "week end: final rank frozen for the reward (#1 kills)");
let c1 = await post("/lb/claim", { pk: B, per: "w:2026-W45", met: "kl" }), c2 = await post("/lb/claim", { pk: B, per: "w:2026-W45", met: "kl" });
ok(c1.ok && c1.rk === 1 && !c2.ok && c2.err === "none", "claim: first ok, second refused (no double claim)");
{ const ca = await post("/lb/claim", { pk: A, per: "w:2026-W45", met: "kl" }); ok(ca.ok && ca.rk === 2, "Alice claims only her own slot (#2 kills), never Bob's #1"); }

// ---- 5. monthly season: soft reset + Conqueror ----
const C = pk(3), pc = await pidOf(C); for (let i = 0; i < 130; i++) await rec(pc, 40, 1, 100, "Conq"); // 5,200 trophies
me = await post("/lb/me", { pk: C }); ok(me.tr === 5200 && me.conq === 1, "Conqueror: top 50 with Crown trophies (live)");
NOW = Date.UTC(2026, 11, 1, 0, 5); // new month = new season
me = await post("/lb/me", { pk: C }); ok(me.tr === M.seasonCarry(5200) && me.ss === "2026-12", `season reset: 5200 -> ${me.tr}`);
ok(me.claims.some((c) => c.per === "s:2026-11" && c.met === "cq" && c.rk === 1), "season end: Conqueror reward listed");
ok(me.claims.some((c) => c.per === "m:2026-11" && c.met === "tr"), "month end: monthly contest results listed");

// ---- 6. room: the server alone decides a life's trophies; private rooms never count ----
NOW = realNow(); Date.now = realNow;
const room = obj("pub-7"); room.init(new URLSearchParams("name_room=pub-7")); const sent = [];
const cl1 = { ws: { send: (m) => sent.push(m), close() {} }, snake: null, q: [], ack: 0xffff, extra: 0, name: "Guest", skin: M.sanitizeSkin(null), msgs: 0, win: Date.now(), joined: false, lastTa: 0, lastBoost: 0 };
room.clients.add(cl1); room.onMsg(cl1, JSON.stringify({ t: "hello", name: "Molier", skin: null, pk: pk(9), tr: 99999, d: 40 })); await cl1.pidP; await new Promise((r) => setTimeout(r, 20));
ok(cl1.pid === (await pidOf(pk(9))) && !(cl1.tr > 0), "hello: pid from the secret; a client-sent trophy value is ignored");
room.onMsg(cl1, JSON.stringify({ t: "spawn", seq: 1 })); const sn = cl1.snake; ok(sn && sn.alive && cl1.life && !cl1.life.done, "spawn: life tracked");
cl1.life.t0 -= 60000; cl1.life.best = 1; sn.kills = 3; room.sim.kill(sn, 0, 1); room.score(cl1, sn); await new Promise((r) => setTimeout(r, 50));
const tro = sent.filter((m) => typeof m === "string").map((m) => JSON.parse(m)).find((m) => m.t === "tro");
ok(tro && tro.d > 0 && tro.d === M.trophyDelta({ place: 1, field: tro.f, kills: 3, life: tro.life, t: 0, online: 1 }) && tro.tr === tro.d, `room: life scored by the server (+${tro && tro.d} for #1, 3 kills)`);
room.score(cl1, sn); await new Promise((r) => setTimeout(r, 30)); ok(sent.map(String).filter((m) => m.includes('"t":"tro"')).length === 1, "room: one life is scored once");
const priv = obj("abc"); priv.init(new URLSearchParams("name_room=abc&bots=0")); const s2 = []; const cl2 = { ...cl1, ws: { send: (m) => s2.push(m), close() {} }, pidP: null, pid: "", life: null, snake: null, joined: false };
priv.clients.add(cl2); priv.onMsg(cl2, JSON.stringify({ t: "hello", name: "X", pk: pk(10) })); await cl2.pidP; priv.onMsg(cl2, JSON.stringify({ t: "spawn", seq: 1 })); cl2.life.t0 -= 60000; priv.sim.kill(cl2.snake, 0, 1); priv.score(cl2, cl2.snake); await new Promise((r) => setTimeout(r, 30));
ok(!s2.map(String).some((m) => m.includes('"t":"tro"')), "private room: trophies never change");
ok(room.snakeMsg(room.sim.snakes.find((s) => s.bot)).tr >= 0, "bots carry a stable league for the HUD");

// ---- 7. client: offline caps, atomic keyed grants, checksum ----
const { Store, econSum, KV } = await import(ROOT + "/js/store.js"); const LG = await import(ROOT + "/js/league.js");
mem.clear(); let S = new Store(); const p = S.p; const ck0 = econSum(p);
const p0 = JSON.parse(JSON.stringify(p)); delete p0.lg; delete p0.cx; delete p0.rc; ok(econSum(p0) === ck0, "checksum unchanged for a save without comp1 fields (old saves still verify)");
let got = 0; for (let i = 0; i < 30; i++) got += LG.afterMatch(S, { mode: "classic", place: 1, field: 30, kills: 8, life: 200, score: 900 }).d;
ok(got === M.TROPHY.OFF_DAY && LG.trophies(p) === M.TROPHY.OFF_DAY, `offline: daily cap holds (${got} after 30 wins)`);
ok(LG.afterMatch(S, { mode: "zen", place: 1, field: 30, kills: 0, life: 99, score: 1 }).none === "mode", "zen never moves trophies");
ok(LG.afterMatch(S, { mode: "classic", place: 99, field: 30, kills: 2, life: 99, score: 1 }).none === "bad", "impossible match result is not counted");
const pend = LG.afterMatch(S, { mode: "online", place: 1, field: 30, kills: 2, life: 99, score: 500, online: true }); ok(pend.pending && LG.trophies(p) === M.TROPHY.OFF_DAY, "online: client never decides its trophies (waits for the server)");
LG.applyServer(S, { t: "tro", d: 26, tr: 26 }); ok(p.lg.on === 26 && LG.trophies(p) === M.TROPHY.OFF_DAY + 26, "online: the server total is applied");
p.lg.off = 2700; p.lg.dg = 0; p.lg.day = ""; const capd = LG.afterMatch(S, { mode: "classic", place: 1, field: 30, kills: 8, life: 200, score: 900 }); ok(LG.trophies(p) <= M.TROPHY.OFF_CEIL + 26 && capd.d <= Math.max(0, M.TROPHY.OFF_CEIL - (2700 + 26)), "offline: ceiling (Diamond+ needs online)");
const c0 = p.coins; ok(S.grantReward("ms:w_rush:2026-W45:0", { coins: 80, cos: ["bd:wr"] }) === "ok" && p.coins === c0 + 80 && p.cos.includes("bd:wr"), "grantReward: coins + badge granted");
ok(S.grantReward("ms:w_rush:2026-W45:0", { coins: 80 }) === "claimed" && p.coins === c0 + 80, "grantReward: same key never pays twice");
ok(S.grantReward("x", { coins: 50, cos: ["evil:1", "fr:99999"] }) === "ok" && !p.cos.includes("evil:1"), "grantReward: unknown cosmetic shapes dropped");
S.flush(); S._backup(JSON.stringify({ v: 1, a: S.acc }), JSON.stringify(S.guest), true); const g = JSON.parse(mem.get("ssp-guest")); g.lg.off = 9000; g.rc = []; mem.set("ssp-guest", JSON.stringify(g));
for (const k of [...mem.keys()]) KV.set(k, mem.get(k)); S = new Store(); ok(S.p.lg.off !== 9000 && S.p.rc.length > 0 && S.repairs.some((x) => /tamper-restored/.test(x)), "tampered trophies / claimed keys restored from last-known-good");
const lb = LG.leagueBadge(4200, { size: "m" }); ok(/lg_crown_64\.webp/.test(lb) && /<b>V<\/b>/.test(lb) && /lg_conq/.test(LG.leagueBadge(6000, { conq: 1 })) && LG.badgeFor({ tr: 500 }).includes("lg_silver"), "badge markup (reusable badgeFor for friends UI)");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS"); process.exit(fail ? 1 : 0);
