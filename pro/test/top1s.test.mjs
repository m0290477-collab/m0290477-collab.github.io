// top1 server + sim checks: region rooms (locationHint, region-aware matchmaking, legacy names unchanged), map events (one at a time,
// sandstorm sight, gold rain, portals move the whole body + phase, never a teleport kill, owner switch), bot personalities (mixed,
// sight-limited, same physics), error reports (grouped, rate-limited, capped, owner-only view), fair-play holds on top-50 rewards
// (flag -> held -> claim waits -> release -> paid), monthly season skins (on sale only in their month, owner override). Node only.
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
process.env.TZ = "UTC";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-t1-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
const W = await import(join(dir, "index.js")); W.MIG.CUT = 9e15; const SM = await import(join(dir, "sim.js")); const E = await import(join(dir, "econ.js")); const SK = await import(join(dir, "skins.js"));
class Sql { constructor() { this.db = new DatabaseSync(":memory:"); } exec(q, ...b) { const st = this.db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...b).map((r) => ({ ...r })); return { toArray: () => rows, one: () => rows[0] }; } st.run(...b); return { toArray: () => [], one: () => undefined }; } }
class FakeWs { constructor() { this.out = []; this.att = null; this.open = true; this.L = {}; } send(s) { if (!this.open) throw new Error("closed"); this.out.push(typeof s === "string" ? JSON.parse(s) : s); } serializeAttachment(a) { this.att = JSON.parse(JSON.stringify(a)); } deserializeAttachment() { return this.att; } close() { this.open = false; } accept() {} addEventListener(k, f) { this.L[k] = f; } }
globalThis.WebSocketPair = function () { const a = new FakeWs(), b = new FakeWs(); return { 0: a, 1: b }; };
const R0 = globalThis.Response; globalThis.Response = class extends R0 { constructor(b, i) { super(b, i && i.status === 101 ? { ...i, status: 200 } : i); if (i && i.webSocket) this.webSocket = i.webSocket; } };
globalThis.fetch = (u) => Promise.reject(new Error("no network in tests: " + u));
const objs = new Map(), hints = new Map();
const env = { TEST_KEY: "k", ROOMS: { idFromName: (x) => x, get: (id, o) => { if (o && o.locationHint) hints.set(id, o.locationHint); return { fetch: (u, init) => obj(id).fetch(u instanceof Request ? u : new Request(u, init)) }; } } };
const obj = (id) => { let o = objs.get(id); if (!o) { const tags = new Map(), all = []; o = new W.Room({ storage: { sql: new Sql() }, acceptWebSocket: (ws, t) => { all.push(ws); for (const x of t) { if (!tags.has(x)) tags.set(x, []); tags.get(x).push(ws); } }, getWebSockets: (t) => (t === undefined ? all : tags.get(t) || []).filter((w) => w.open), setWebSocketAutoResponse() {} }, env); objs.set(id, o); } return o; };
const pk = (k) => k.toString(16).padStart(32, "0"); const pidOf = async (k) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + k)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); };
const post = async (path, body, cf) => { const rq = new Request("https://w" + path, { method: "POST", body: JSON.stringify(body), headers: { origin: "https://billke.com" } }); if (cf) Object.defineProperty(rq, "cf", { value: cf }); return (await W.default.fetch(rq, env)).json(); };
const get = async (path, cf) => { const rq = new Request("https://w" + path, { headers: { origin: "https://billke.com" } }); if (cf) Object.defineProperty(rq, "cf", { value: cf }); return (await W.default.fetch(rq, env)).json(); };
const op = (k, o, extra = {}) => post("/s", { pk: pk(k), op: o, ...extra });

// ---------- 1) regions ----------
ok(W.regionOf({ continent: "EU", country: "DE", longitude: 13.4 }) === "weur" && W.regionOf({ continent: "EU", country: "PL", longitude: 21 }) === "eeur" && W.regionOf({ continent: "NA", country: "US", longitude: -117 }) === "wnam" && W.regionOf({ continent: "NA", country: "US", longitude: -74 }) === "enam", "region from request.cf: Europe west/east, US west/east");
ok(W.regionOf({ continent: "AS", country: "IQ" }) === "me" && W.regionOf({ continent: "EU", country: "TR", longitude: 29 }) === "me" && W.regionOf({ continent: "AS", country: "JP" }) === "apac" && W.regionOf({ continent: "OC", country: "AU" }) === "oc" && W.regionOf({}) === "", "Iraq / Turkey -> Middle East, Japan -> Asia, Australia -> Oceania, unknown -> none");
ok(W.roomRg("pub-gp-weur-3") === "weur" && W.roomRg("pub-gp-3") === "" && W.roomRg("pub-gp-xx-3") === "", "region parsed from the room name only for known hints");
{ const R = new Map(), P = new Map(), t = 1e12; let p = W.mmPick(R, P, { pid: "a", br: "gp", now: t, rg: "me" }); ok(p.room === "pub-gp-me-1" && p.rg === "me", "empty server: a new room in the player's region (pub-gp-me-1)");
  p = W.mmPick(R, P, { pid: "b", br: "gp", now: t, rg: "" }); ok(p.room === "pub-gp-1" && !p.rg, "no region known: exactly the old room names");
  R.set("pub-gp-weur-1", { room: "pub-gp-weur-1", br: "gp", rg: "weur", i: 1, h: 5, b: 25, t, pend: 0 }); R.set("pub-gp-me-2", { room: "pub-gp-me-2", br: "gp", rg: "me", i: 2, h: 1, b: 29, t, pend: 0 });
  p = W.mmPick(R, P, { pid: "c", br: "gp", now: t + 10, rg: "me" }); ok(p.room === "pub-gp-me-2", "own region's populated room first, even when another region has more players");
  R.delete("pub-gp-me-2"); for (let i = 0; i < 4; i++) W.mmPick(R, P, { pid: "m" + i, br: "gp", now: t + 20, rg: "me" });
  p = W.mmPick(R, P, { pid: "d", br: "gp", now: t + 30, rg: "me", w: 0 }); const p2 = W.mmPick(R, P, { pid: "e", br: "gp", now: t + 30, rg: "me", w: 3000 });
  ok(p.room !== "pub-gp-weur-1" && p2.room === "pub-gp-weur-1" && p2.far === 1, "busy region with no populated room waits in its region first; after 2.5 s it joins the nearest populated room (far)"); }
{ const r = await get("/mm?pk=" + pk(901), { continent: "AS", country: "IQ" }); ok(r.room && /^pub-bs-me-\d+$/.test(r.room) && r.myRg === "me", "worker /mm reads request.cf -> Middle East room (" + r.room + ")");
  const pair = new WebSocketPair(); const rq = new Request("https://w/ws?room=" + r.room, { headers: { Upgrade: "websocket" } }); await W.default.fetch(rq, env).catch(() => null);
  ok(hints.get(r.room) === "me", "the room object is created with locationHint 'me'"); const R = obj(r.room); ok(R.rg === "me" && R.br === "bs", "room knows its region and bracket from its name"); }

// ---------- 2) map events (sim) ----------
const mkSim = () => { const S = new SM.Sim({ dt: 1 / 30, seed: 77, netMode: true, powerups: false, events: [] }); for (let i = 0; i < 20; i++) S.addSnake("b" + i, null, { bot: true, diff: 1 }); return S; };
{ const S = mkSim(); const e = S.startMapEvent("storm"); ok(e && S.viewK === SM.MEV_STORM_VIEW && S.evMev[0].k === "storm" && S.evMev[0].ph === "start", "sandstorm starts: bots' sight shrinks to " + SM.MEV_STORM_VIEW);
  ok(S.startMapEvent("gold") === null, "only one map event at a time");
  for (let i = 0; i < 30 * 26; i++) { S.step(() => true); if (S.evMev.some((x) => x.ph === "end")) break; S.drain(); for (const d of S.snakes.filter((x) => !x.alive)) S.removeSnake(d); }
  ok(!S.mev && S.viewK === 1, "sandstorm ends after 25 s and sight is back"); }
{ const S = mkSim(); const f0 = S.fCount; let gold0 = 0; for (let i = 0; i < S.FM; i++) if (S.fa[i] && S.fc[i] === SM.GOLD_FC) gold0++; S.startMapEvent("gold"); for (let i = 0; i < 30 * 5; i++) { S.step(() => true); S.drain(); }
  let gold = 0; for (let i = 0; i < S.FM; i++) if (S.fa[i] && S.fc[i] === SM.GOLD_FC) gold++; ok(gold > gold0 + 20, "golden food rain spreads gold orbs across the map (" + gold0 + " -> " + gold + ")"); }
{ const S = new SM.Sim({ dt: 1 / 30, seed: 5, netMode: true, powerups: false, events: [] }); const a = S.addSnake("me", null, { bot: false, m: 60, pos: [0, 0] });
  for (let i = 0; i < 90; i++) { a.ta = 0; S.step((s) => { s.ta = 0; return true; }); S.drain(); }
  const E2 = S.startMapEvent("portal"); const P = E2.p[0], Q = E2.p[1]; ok(Math.hypot(P[0] + Q[0], P[1] + Q[1]) < 1e-6 && Math.hypot(...P) < S.R * 0.55, "portal pair: mirrored, well inside the arena");
  // place a bot right where the exit is, then drive the player into portal A
  const b = S.addSnake("blk", null, { bot: true, m: 200, pos: [Q[0] + 40, Q[1] + 30] });
  const dx = P[0] - a.x, dy = P[1] - a.y, shape0 = [a.sx(10) - a.x, a.sy(10) - a.y]; S.teleport(a, dx - Math.cos(a.a) * 0.1, dy - Math.sin(a.a) * 0.1); a.ph = 0; S.drain(); // standing just at portal A
  S.mevStep(1 / 30); const tp = S.evTp.slice(); ok(tp.length === 3 && tp[0] === a.id && Math.hypot(a.x - Q[0], a.y - Q[1]) < E2.r + 3 + a.r, "head entering A comes out of B (evTp sent)");
  ok(Math.abs(a.sx(10) - a.x - shape0[0]) < 1e-3 && Math.abs(a.sy(10) - a.y - shape0[1]) < 1e-3, "the whole body moved rigidly (same shape)");
  ok(a.ph > 0, "teleported snake is in its phase window (" + SM.TP_PHASE + " s)"); S.drain(); { const ox = a.sx(3) - b.x, oy = a.sy(3) - b.y; for (let i = 0; i < b.px.length; i++) { b.px[i] += ox; b.py[i] += oy; } b.x += ox; b.y += oy; } // the other snake's head inside the moved body S.buildGrid(); S.collide(); ok(a.alive && b.alive, "no teleport kill: the exit overlaps another snake, both live");
  S.mevStep(1 / 30); ok(S.evTp.length === 0, "a 4 s cooldown stops ping-pong between the rings"); }
{ const R = obj("pub-bs-31"); R.init(new URLSearchParams("name_room=pub-bs-31")); R.mevCfg = { off: 0, k: [] }; const c = { joined: true, snake: R.sim.snakes.find((s) => s.alive), ws: new FakeWs(), q: [] }; R.clients.add(c);
  const now = Date.now(); R.mevTick(now); ok(!R.sim.mev && R.mevAt >= now + 60000 && R.mevAt <= now + 150000, "first map event 60-150 s after players arrive");
  R.mevTick(R.mevAt + 1); ok(!!R.sim.mev && SM.MEV.includes(R.sim.mev.k), "then one event starts (" + (R.sim.mev && R.sim.mev.k) + ")"); const k1 = R.sim.mev.k; R.sim.endMapEvent(); R.mevTick(now + 200000);
  ok(!R.sim.mev && R.mevEnd >= now + 200000 - 1, "the next one waits at least 7 minutes"); R.mevCfg = { off: 0, k: SM.MEV.filter((x) => x !== "portal") }; R.mevAt = 1; R.mevEnd = 0; R.mevLast = ""; R.mevTick(now + 900000); ok(R.sim.mev && R.sim.mev.k === "portal", "a switched-off kind is never picked");
  R.mevCfg = { off: 1, k: [] }; R.mevTick(now + 900001); ok(!R.sim.mev, "owner switch off ends a running event"); R.clients.delete(c);
  const R2 = obj("pv-xyz"); R2.init(new URLSearchParams("name_room=pv-xyz")); R2.clients.add(c); R2.mevAt = 1; R2.mevTick(now + 1e6); ok(!R2.sim.mev, "private rooms never get map events"); R2.clients.delete(c); clearInterval(R.timer); clearInterval(R2.timer); }

// ---------- 3) bot personalities ----------
{ const S = mkSim(); const pers = new Set(S.snakes.map((s) => s.ai.per)); ok(pers.size === 4 && SM.PERSONAS.join() === "hunter,coward,farmer,reckless", "four personalities mixed in one room");
  ok(SM.PERS.every((p) => p.hunt > 0 && p.look > 0.5 && p.slip > 0 && p.slip <= 2), "personality factors are bounded (decisions only)");
  // sight: a lone player far away is never "near" (no map-wide targeting)
  const S2 = new SM.Sim({ dt: 1 / 30, seed: 9, netMode: true, powerups: false, events: [] }); const bot = S2.addSnake("h", null, { bot: true, diff: 3, pos: [0, 0] }); bot.ai.per = 0; const far = S2.addSnake("p", null, { bot: false, pos: [SM.SIGHT + 40, 0], m: 20 });
  let hunted = 0; for (let k = 0; k < 400; k++) { S2.botThink(bot); if (bot.ai.mode === 3) hunted++; } ok(hunted === 0, "a hunter does not target a player outside its sight (" + (SM.SIGHT + 40) + " units)");
  far.x = 14; far.y = 0; let near = 0; for (let k = 0; k < 400; k++) { bot.ai.mode = 0; bot.ai.commit = 0; S2.botThink(bot); if (bot.ai.mode === 3) near++; } ok(near > 0, "…but hunts one in sight (" + near + "/400 decisions)");
  // coward flees a bigger head
  const S3 = new SM.Sim({ dt: 1 / 30, seed: 11, netMode: true, powerups: false, events: [] }); const cw = S3.addSnake("c", null, { bot: true, diff: 1, pos: [0, 0], m: 30 }); cw.ai.per = 1; const big = S3.addSnake("big", null, { bot: true, pos: [9, 0], m: 400 });
  let away = 0; for (let k = 0; k < 50; k++) { S3.botThink(cw); if (Math.cos(cw.ta - Math.PI) > 0.6) away++; } ok(away > 35, "a coward turns away from a bigger head nearby (" + away + "/50)");
  // 60 s room: all four personalities alive / dying under the same rules (no crash, deaths happen)
  const S4 = mkSim(); let deaths = 0; for (let i = 0; i < 30 * 60; i++) { S4.step(() => true); deaths += S4.evDie.length / 3; S4.drain(); for (const d of S4.snakes.filter((x) => !x.alive)) S4.removeSnake(d); while (S4.snakes.filter((s) => s.alive).length < 20) S4.addSnake("r", null, { bot: true, diff: 1 }); }
  ok(deaths > 3 && deaths < 400, "60 s bot room runs with real deaths (" + deaths + ")"); }

// ---------- 4) error reports ----------
{ const rep = (k, m, d = "iPhone 18 Safari", v = "top1") => post("/err", { pk: pk(k), m, s: "at frame (render3d.js:12:3)", d, v, mo: "online" });
  let r = await rep(1, "TypeError: undefined is not an object (evaluating 'a.b') at 123"); ok(r.ok === 1 && r.h, "an error report is accepted");
  await rep(2, "TypeError: undefined is not an object (evaluating 'a.b') at 456", "Android 14 Chrome", "warm2"); await rep(1, "RangeError: bad length 77");
  const S = obj("social-v1"); const L = S.sdb().exec("SELECT * FROM errs ORDER BY n DESC").toArray(); ok(L.length === 2 && L[0].n === 2 && L[0].u === 2, "grouped by normalised message (numbers stripped): 2 groups, 2 reports from 2 players");
  ok(JSON.parse(L[0].dev)["iPhone 18 Safari"] === 1 && JSON.parse(L[0].dev)["Android 14 Chrome"] === 1 && JSON.parse(L[0].ver).warm2 === 1, "device + app version histograms per group");
  ok(!JSON.stringify(L).includes(await pidOf(pk(1))), "no player id stored (only a short re-hash for counting)");
  let rate = 0; for (let i = 0; i < 20; i++) { const x = await rep(3, "Error " + "abcdefghijklmnopqrstu"[i]); if (x.err === "rate") rate++; } ok(rate === 20 - W.ERR.PER_H, "per-player limit: " + W.ERR.PER_H + " reports an hour");
  S.errDay.n = W.ERR.DAY; r = await rep(4, "late"); ok(r.err === "cap", "daily cap protects the free tier (" + W.ERR.DAY + "/day)"); S.errDay.n = 0;
  // owner view
  const own = 5001; await op(own, "hello", { n: "Owner" }); const op1 = await S.sOp(await pidOf(pk(own)), { op: "a_errs" }); ok(op1.err === "forbidden", "Errors view is owner-only");
  S.sdb().exec("UPDATE acct SET own = 1 WHERE pid = ?", await pidOf(pk(own))); const v = await S.sOp(await pidOf(pk(own)), { op: "a_errs" }); ok(Array.isArray(v.list) && v.list.length >= 2 && v.list[0].dev && typeof v.list[0].dev === "object", "owner sees grouped errors with devices");
  const c1 = await S.sOp(await pidOf(pk(own)), { op: "a_errclr", h: "*" }); const c2 = await S.sOp(await pidOf(pk(own)), { op: "a_errclr", h: "*", why: "fixed in top1" }); ok(c1.err === "reason" && c2.ok && S.sdb().exec("SELECT COUNT(*) AS n FROM errs").one().n === 0, "clearing needs a reason and is audited"); }

// ---------- 5) fair play: top-50 holds ----------
{ const B = obj("board-v1"); B.db(); const q = B.db(); const now = Date.now(); const M = SM.seasonId(now);
  const rec = (pid, o) => B.fetch(new Request("https://board/b/rec", { method: "POST", body: JSON.stringify({ pid, name: o.n || "P", d: o.d ?? 20, kl: o.kl ?? 2, sc: o.sc ?? 300, lf: o.lf ?? 120, rm: o.rm || "pub-bs-1", bm: o.bm ?? 300 }) })).then((r) => r.json());
  ok(W.acCheck([{ t: 1, lf: 100, kl: 40, d: 30, bm: 500, rm: "a" }]).includes("kills") && W.acCheck([{ t: 1, lf: 10, kl: 1, d: 5, bm: 5000, rm: "a" }]).includes("growth") && W.acCheck([{ t: 1, lf: 0, kl: 1, d: 5, bm: 5000, rm: "a" }]).length === 0, "rules: too many kills / impossible growth; an older room's life (no length) is not judged");
  ok(W.acCheck([{ t: 100000, lf: 60, kl: 1, d: 5, bm: 50, rm: "a" }, { t: 110000, lf: 60, kl: 1, d: 5, bm: 50, rm: "b" }, { t: 120000, lf: 60, kl: 1, d: 5, bm: 50, rm: "a" }]).includes("overlap"), "two rooms at the same time = overlap");
  const cheat = await pidOf(pk(7001)), fair = await pidOf(pk(7002));
  for (let i = 0; i < 3; i++) { await rec(cheat, { n: "Cheat", kl: 45, bm: 900, lf: 200 }); await rec(fair, { n: "Fair", kl: 3 }); }
  // close the month as the roll would: snapshot + check
  const per = "m:" + M; q.exec("INSERT OR IGNORE INTO fin (per, met, pid, rk, v) VALUES (?, 'kl', ?, 1, 135), (?, 'kl', ?, 2, 9)", per, cheat, per, fair); B.acClose(per);
  const st = (p) => (q.exec("SELECT st FROM ac WHERE per = ? AND pid = ?", per, p).toArray()[0] || {}).st;
  ok(st(cheat) === 1 && st(fair) === 0, "top-50 check at period close: the cheater's reward is held, the fair player's is clean");
  const cl = await post("/lb/claim", { pk: pk(7001), per, met: "kl" }); const cl2 = await post("/lb/claim", { pk: pk(7002), per, met: "kl" }); ok(cl.err === "held" && cl2.ok === 1, "the board refuses a held claim, pays the clean one");
  const fin = await (await B.fetch(new Request("https://board/b/fin", { method: "POST", body: JSON.stringify({ pids: [cheat], keys: [per + ":kl"] }) }))).json(); ok(fin.held.includes(per), "wallet lookups see the hold");
  // wallet claim of the contest reward waits (kept in the queue), then the owner releases it
  const S = obj("social-v1"); await op(7001, "hello", { n: "Cheat" }); await op(7001, "w_mig", { coins: 0, items: [], lv: 1 });
  const w1 = await op(7001, "w_claims", { l: [{ k: "rw", ck: "rw:sv:" + per + ":kl", a: { key: "sv:" + per + ":kl" } }] }); const r1 = w1.res && w1.res[0]; ok(r1 && r1.err === "held" && r1.keep === 1, "wallet: a held reward is kept in the device queue (not lost, not paid)");
  const own = await pidOf(pk(5001)); const ac = await S.sOp(own, { op: "a_ac" }); ok(ac.list && ac.list.some((x) => x.pid === cheat && x.st === 1 && x.why.includes("kills")), "owner Fair play view lists the hold with its reason");
  const rel = await S.sOp(own, { op: "a_acrel", pid: cheat, per, st: 2, why: "checked replays, legit" }); ok(rel.ok && st(cheat) === 2, "owner releases it (audited)");
  const w2 = await op(7001, "w_claims", { l: [{ k: "rw", ck: "rw:sv:" + per + ":kl", a: { key: "sv:" + per + ":kl" } }] }); const r2 = w2.res && w2.res[0]; ok(r2 && !r2.err && r2.c > 0, "after release the same claim is paid (" + (r2 && r2.c) + " coins)");
  const sc = await S.sOp(own, { op: "a_acscan", why: "spot check" }); ok(sc.ok && Number.isFinite(sc.n), "scan of this month's top 50 (preview, nothing held)"); }

// ---------- 6) season ----------
{ const nov = Date.parse("2026-11-04T12:00:00Z"); ok(SK.seasonMonth(nov) === 11 && SK.seasonMonth(nov, 12) === 12 && SK.seasonSkins(11).length === 3 && SK.SEASON_THEMES.length === 12, "12 monthly themes, 3 skins each, UTC month or owner override");
  ok(SK.SKINS.slice(0, SK.SEASON_SKIN0).every((s) => !s.ssn), "season skins come after every older skin (indexes never move)");
  ok(E.seasonOk("ss11a", nov) && !E.seasonOk("ss12a", nov) && E.seasonOk("ss12a", nov, 12) && E.seasonOk("emerald", nov), "on sale only in their month (override opens another month)");
  const S = obj("social-v1"); await op(7101, "hello", { n: "Buyer" }); await op(7101, "w_mig", { coins: 0, items: [], lv: 1 }); const bp = await pidOf(pk(7101)); S.wAdd(bp, 20000, "test", "t:1");
  const m = SK.seasonMonth(), cur = SK.seasonSkins(m)[0], other = SK.seasonSkins((m % 12) + 1)[0];
  const b1 = await op(7101, "w_buy", { k: "skin", ix: other, price: +SK.SKINS[other].src.split(":")[1] }); ok(b1.err === "season", "server refuses another month's season skin");
  const b2 = await op(7101, "w_buy", { k: "skin", ix: cur, price: +SK.SKINS[cur].src.split(":")[1] }); ok(b2.ok === 1 && b2.it.includes(SK.SKINS[cur].id), "this month's season skin is bought with coins (" + SK.SKINS[cur].src + ")");
  const own = await pidOf(pk(5001)); const o1 = await S.sOp(own, { op: "a_ssn", m: (m % 12) + 1, why: "preview next month" }); ok(o1.ok && S.cfgPub().ssn === (m % 12) + 1, "owner override of the season month");
  const b3 = await op(7101, "w_buy", { k: "skin", ix: other, price: +SK.SKINS[other].src.split(":")[1] }); ok(b3.ok === 1, "…which opens that month's skins"); await S.sOp(own, { op: "a_ssn", m: 0, why: "back to auto" });
  const off = E.offerCandidates(new Set()); ok(!JSON.stringify(off).includes('"ss'), "season skins never appear in weekly offers"); }

// ---------- 7) map event switch reaches rooms ----------
{ const S = obj("social-v1"), own = await pidOf(pk(5001)); const r = await S.sOp(own, { op: "a_mev", off: 0, k: ["storm"], why: "no storms this week" }); ok(r.ok && r.mev.k.join() === "storm", "owner switches one map event kind off");
  const mu = await (await S.fetch(new Request("https://social/s/mu"))).json(); ok(mu.mev && mu.mev.k.includes("storm") && mu.mev.off === 0, "rooms read the switch with the weekend rule (/s/mu)"); }

// ---------- 8) no map events on a territory map (land1) ----------
{ const S = mkSim(); S.ter = {}; ok(S.startMapEvent("storm") === null && !S.mev, "no map event starts on a territory map (sim.ter set)"); }
{ const hum = () => new Set([{ joined: 1, snake: { alive: true } }]), mk = (ter) => ({ ranked: () => true, sim: mkSim(), ter, clients: hum(), mevCfg: { off: 0, k: [] }, mevAt: 1, mevEnd: 0, mevLast: "" });
  const a = mk(null), t = mk({ cells: 1 }); W.Room.prototype.mevTick.call(a, Date.now() + 9e6); W.Room.prototype.mevTick.call(t, Date.now() + 9e6);
  ok(!!a.sim.mev && !t.sim.mev, "mevTick: a classic room starts its due map event, a ranked territory room (tp-) never does"); }

console.log(fail ? `FAILED ${fail} of ${n}` : `ALL ${n} PASSED`); process.exit(fail ? 1 : 0);
