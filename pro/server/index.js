// super-snake-online — Cloudflare Worker + Durable Object (one DO per room). No database, no payments, nothing stored.
// The room runs the SAME sim.js as the client at 30 Hz and is authoritative for movement, food, mass, collisions and kills.
// Clients predict their own snake (input seq/ack reconciliation) and interpolate everyone else.
import { Sim, C, moveSnake, sanitizeSkin, cleanName, BOT_NAMES, pickBotName, TROPHY, trophyDelta, seasonCarry, seasonId, weekId, prevPeriodId, botTrophies, filterText, idKind, idPrice, ID_PRICES, SPECIAL_REP, SPECIAL_SEQ, MSG_MAX, CHAT_KEEP } from "./sim.js";

const TICK = 1 / 30, MAX_HUMANS = 12, TARGET_SNAKES = 30, VERSION = 5; // v5 (srv1): social object "social-v1" (public ids, special ids, friends, chat, invites, live /sws), snake "u" = public id, skins carry "gt" · v4 (comp1): server-decided trophies ("tro"), snake league "tr", board DO "board-v1" (leaderboards, contests, seasons) · v2: power-ups (pus / pu+ / pu- / sh) · v3: 11 power-ups, arena events (evt / met), emotes (emo), avatars in skins
const ORIGINS = [/^https:\/\/(www\.)?billke\.com$/, /^https:\/\/m0290477-collab\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// look1: bots never share a look with any live snake (players included)
const uniqSkin = (snakes, i) => { const used = new Set(); for (const o of snakes) if (o.alive && o.skin) used.add(o.skin.k + ":" + o.skin.i); for (let k = 0; k < 60; k++) { const c = BOT_SKINS(i + k * 5); if (!used.has(c.k + ":" + c.i)) return c; } return BOT_SKINS(i); };
const BOT_SKINS = (i) => ({ k: i % 3 === 0 ? "flag" : "skin", i: i % 3 === 0 ? (i * 37) % 197 : i % 24, e: i % 4, t: 0, n: 0, av: i % 3 === 0 ? "f" + ((i * 37) % 197) : "p" + ((i * 7) % 24), fr: i % 5 === 0 ? 0 : 1 + (i % 4) });
const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
const SOCIAL = "social-v1"; // srv1: the one social object (same Room class, SQLite-backed; no new migration)
const OWNER_H = "f7fbde3c1fea505ba93f50420658e738b482e0fd55dea9bf270829ecb8d0fa78"; // srv1: SHA-256 of the one-time founder claim code (id 1); the code itself is not in any file that ships
const BOARD = "board-v1"; // name of the single leaderboard object (same Room class, SQLite-backed; no new migration needed)
// anonymous device player id: the client keeps a random secret (pk); the public id is a hash of it, so nobody can write to
// or claim for another player's id without the secret. Sign-in can later link a pid to an account.
async function pidOf(pk) { if (typeof pk !== "string" || !/^[0-9a-f]{32,64}$/.test(pk)) return ""; const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + pk)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); }
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: cors });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response(JSON.stringify({ ok: true, name: "super-snake-online", v: VERSION, t: Date.now() }), { headers: cors });
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const origin = req.headers.get("Origin");
      if (origin && !ORIGINS.some((r) => r.test(origin))) return new Response("origin not allowed", { status: 403 });
      let room = (url.searchParams.get("room") || "pub-1").toLowerCase();
      if (!/^[a-z0-9-]{1,24}$/.test(room)) room = "pub-1";
      const id = env.ROOMS.idFromName(room);
      return env.ROOMS.get(id).fetch(new Request("https://room/ws?" + url.searchParams.toString() + "&name_room=" + room, req));
    }
    // comp1: public leaderboard / contest / season API -> the one board object (SQLite storage). /b/rec is internal only (room -> board).
    if (url.pathname === "/lb/top" || url.pathname === "/lb/me" || url.pathname === "/lb/claim") {
      if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
      const origin = req.headers.get("Origin"); if (origin && !ORIGINS.some((r) => r.test(origin))) return new Response("origin not allowed", { status: 403 });
      if (req.method === "POST" && +(req.headers.get("content-length") || 0) > 600) return new Response('{"err":"big"}', { status: 413, headers: cors });
      const body = req.method === "POST" ? await req.text() : null;
      return env.ROOMS.get(env.ROOMS.idFromName(BOARD)).fetch(new Request("https://board/b/" + url.pathname.slice(4) + url.search, { method: req.method === "POST" ? "POST" : "GET", body: body ? body.slice(0, 600) : null }));
    }
    // srv1: social API. POST /s {pk, op, ...} (HTTP fallback) and the live socket /sws?pk= (both -> the one social object)
    if (url.pathname === "/s" || url.pathname === "/sws") {
      if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
      const origin = req.headers.get("Origin"); if (origin && !ORIGINS.some((r) => r.test(origin))) return new Response("origin not allowed", { status: 403 });
      const so = env.ROOMS.get(env.ROOMS.idFromName(SOCIAL));
      if (url.pathname === "/sws") { if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 }); return so.fetch(new Request("https://social/sws?pk=" + encodeURIComponent(url.searchParams.get("pk") || ""), req)); }
      if (req.method !== "POST") return J({ err: "method" }, 405); if (+(req.headers.get("content-length") || 0) > 1200) return new Response('{"err":"big"}', { status: 413, headers: cors });
      return so.fetch(new Request("https://social/s/op", { method: "POST", body: (await req.text()).slice(0, 1200) }));
    }
    return new Response("Super Snake online server", { headers: { "content-type": "text/plain" } });
  },
};

export class Room {
  constructor(state, env) { this.state = state; this.env = env; this.clients = new Set(); this.sim = null; this.timer = null; this.botSeq = 0; }
  init(params) {
    this.noBots = params.get("bots") === "0" && !(params.get("name_room") || "").startsWith("pub-");
    this.room = params.get("name_room") || "pub-1";
    this.sim = new Sim({ dt: TICK, seed: (Date.now() & 0xffffff) ^ 0x5eed, netMode: true, powerups: true, events: true, evtFirst: 35 });
    this.sim.diff = 1;
    this.fill();
    this.last = Date.now(); this.acc = 0;
  }
  fill() {
    if (this.noBots) return;
    const alive = this.sim.snakes.filter((s) => s.alive).length; let want = TARGET_SNAKES - alive;
    while (want-- > 0) { const i = this.botSeq++; const b = this.sim.addSnake(pickBotName(this.sim.snakes, i), uniqSkin(this.sim.snakes, i), { bot: true, diff: [1, 1, 2, 2, 3][i % 5] }); if (b) b.tr = botTrophies(i); }
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/b/")) return this.board(req, url); // comp1: this instance is the board object
    if (url.pathname.startsWith("/s/")) return this.socialHttp(req, url); // srv1: this instance is the social object
    if (url.pathname === "/sws") return this.socialWs(req, url);
    if (!this.sim) this.init(url.searchParams);
    const humans = [...this.clients].length;
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair); server.accept();
    if (humans >= MAX_HUMANS) { server.send(JSON.stringify({ t: "full" })); server.close(4001, "full"); return new Response(null, { status: 101, webSocket: client }); }
    const c = { ws: server, snake: null, q: [], ack: 0xffff, extra: 0, name: "Guest", skin: sanitizeSkin(null), msgs: 0, win: Date.now(), joined: false, lastTa: 0, lastBoost: 0 };
    this.clients.add(c);
    server.addEventListener("message", (e) => this.onMsg(c, e.data));
    server.addEventListener("close", () => this.drop(c));
    server.addEventListener("error", () => this.drop(c));
    if (!this.timer) { this.last = Date.now(); this.acc = 0; this.timer = setInterval(() => this.loop(), 16); }
    return new Response(null, { status: 101, webSocket: client });
  }
  drop(c) {
    if (!this.clients.has(c)) return; this.clients.delete(c);
    if (c.snake && c.snake.alive) { this.sim.kill(c.snake, 0, 4); this.score(c, c.snake); }
    if (!this.clients.size && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  send(c, m) { try { c.ws.send(typeof m === "string" ? m : m); } catch (_) {} }
  bcast(m) { for (const c of this.clients) if (c.joined) this.send(c, m); }
  snakeMsg(s) { // full description of one snake incl. its recent path (enough to draw the whole body)
    const pts = []; const k = Math.min(s.n, Math.ceil(s.len / (C.SPEED * TICK)) + 4);
    for (let i = k - 1; i >= 0; i--) pts.push(Math.round(s.sx(i) * 100) / 100, Math.round(s.sy(i) * 100) / 100);
    return { id: s.id, name: s.name, skin: s.skin, bot: s.bot ? 1 : 0, m: Math.round(s.m), a: s.a, path: pts, tick: this.sim.tick, tr: Number.isFinite(s.tr) ? s.tr : -1, u: s.uid || "" }; // srv1: u = public player id (humans)
  }
  onMsg(c, data) {
    const now = Date.now(); if (now - c.win > 1000) { c.win = now; c.msgs = 0; } if (++c.msgs > 90) { c.ws.close(4008, "rate"); return; }
    if (typeof data !== "string") { // binary input batch: u8 2, u8 n, n × (u16 seq, u16 ta, u8 boost)
      const v = new DataView(data); if (v.byteLength < 2 || v.getUint8(0) !== 2) return; const n = Math.min(10, v.getUint8(1));
      for (let i = 0; i < n && 2 + i * 5 + 5 <= v.byteLength; i++) { const o = 2 + i * 5; c.q.push(v.getUint16(o, true), (v.getUint16(o + 2, true) / 65536) * Math.PI * 2 - Math.PI, v.getUint8(o + 4)); }
      if (c.q.length > 60) c.q.splice(0, c.q.length - 30);
      return;
    }
    if (data.length > 2000) return; let m; try { m = JSON.parse(data); } catch (_) { return; }
    if (!m || typeof m.t !== "string") return;
    if (m.t === "hello") {
      c.name = cleanName(m.name); c.skin = sanitizeSkin(m.skin); c.joined = true;
      if (!c.pidP && typeof m.pk === "string") c.pidP = pidOf(m.pk).then(async (pid) => { c.pid = pid; if (pid) this.uidOf(c); if (!pid || !this.ranked()) return; try { const r = await (await this.boardStub().fetch("https://board/b/get?pid=" + pid)).json(); if (r && Number.isFinite(r.tr)) { c.tr = r.tr; if (c.snake) c.snake.tr = r.tr; this.send(c, JSON.stringify({ t: "tro0", tr: r.tr, ss: r.ss })); } } catch (_) {} });
      this.send(c, JSON.stringify({ t: "welcome", v: VERSION, room: this.room, tick: this.sim.tick, dt: TICK, R: this.sim.R, snakes: this.sim.snakes.filter((s) => s.alive).map((s) => this.snakeMsg(s)) }));
      this.send(c, this.foodFull());
      this.send(c, JSON.stringify({ t: "pus", l: this.sim.pus.map((p) => [p.id, p.k, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) }));
      const E = this.sim.evt; if (E) this.send(c, JSON.stringify({ t: "evt", k: E.k, ph: "start", id: E.id || 0, d: Math.max(1, Math.round(E.t)), late: 1 }));
      if (this.sim.mets.length) this.send(c, JSON.stringify({ t: "met", l: this.sim.mets.map((M) => [M.id, Math.round(M.x * 100) / 100, Math.round(M.y * 100) / 100, M.r, +M.t.toFixed(2), M.T]) }));
    } else if (m.t === "spawn") {
      if (!c.joined || (c.snake && c.snake.alive)) return;
      if (c.snake) this.sim.removeSnake(c.snake);
      if (typeof m.name === "string") c.name = cleanName(m.name); if (m.skin) c.skin = sanitizeSkin(m.skin);
      // a human replaces one bot so rooms stay the same size
      const bot = this.sim.snakes.find((s) => s.bot && s.alive); if (bot && !this.noBots) { bot.alive = false; this.sim.evDie.push(bot.id, 0, 5); }
      const s = this.sim.addSnake(c.name, c.skin, {}); c.snake = s; if (c.uid) s.uid = c.uid; c.q.length = 0; c.ack = 0xffff; c.extra = 0;
      s.tr = c.tr; c.life = { t0: Date.now(), best: 99, field: this.sim.snakes.filter((o) => o.alive).length, bm: s.m, done: false }; // comp1: what this life is judged on
      this.send(c, JSON.stringify({ t: "you", id: s.id, x: s.x, y: s.y, a: s.a, m: s.m, tick: this.sim.tick, seq: (m.seq | 0) & 0xffff }));
      c.q.length = 0; c.seq0 = (m.seq | 0) & 0xffff; c.buf = true;
    } else if (m.t === "die") { // the client saw its own head touch a body: accept at once (it can only hurt itself), credit the hit snake
      const s = c.snake; if (!s || !s.alive) return; const k = this.sim.byId.get(m.hit | 0);
      let by = 0; if (k && k.alive && k !== s) { const dx = k.x - s.x, dy = k.y - s.y; by = dx * dx + dy * dy < (k.len + 8) ** 2 ? k.id : 0; }
      if (k === s) return; // noself1: own body never kills (an old client's self report is ignored)
      this.sim.kill(s, by, by ? 3 : 1);
    } else if (m.t === "emo") { // quick emote: one per second per player, relayed to everyone else in the room
      const s = c.snake, e = m.e | 0; if (!s || !s.alive || e < 0 || e > 5 || now - (c.lastEmo || 0) < 1000) return; c.lastEmo = now;
      const msg = JSON.stringify({ t: "emo", id: s.id, e }); for (const o of this.clients) if (o !== c && o.joined) this.send(o, msg);
    } else if (m.t === "ping") this.send(c, JSON.stringify({ t: "pong", c: m.c, s: Date.now(), tick: this.sim.tick }));
  }
  // srv1: public id of a human in this room (shown on the in-match player card, used to add them as a friend)
  uidOf(c) { this.env.ROOMS.get(this.env.ROOMS.idFromName(SOCIAL)).fetch("https://social/s/uid?pid=" + c.pid).then((r) => r.json()).then((r) => { if (!r || !/^\d{1,7}$/.test(r.id || "")) return; c.uid = r.id;
    const s = c.snake; if (s && s.alive && s.uid !== r.id) { s.uid = r.id; this.bcast(JSON.stringify({ t: "uid", id: s.id, u: r.id })); } this.send(c, JSON.stringify({ t: "myid", u: r.id })); }).catch(() => {}); }
  // ---------- comp1: trophies (server-decided), board object (leaderboards, weekly/monthly contests, monthly seasons) ----------
  ranked() { return this.room.startsWith("pub-") && !this.noBots; } // private rooms never move trophies (no farming with friends)
  boardStub() { return this.env.ROOMS.get(this.env.ROOMS.idFromName(BOARD)); }
  score(c, s) { // one finished life of a human -> trophies, judged only on what this server saw
    const L = c.life; if (!L || L.done) return; L.done = true; if (!c.pid || !this.ranked()) return;
    const alive = this.sim.snakes.filter((o) => o.alive).length, field = Math.max(L.field, alive + 1, 2);
    const atDeath = 1 + this.sim.snakes.filter((o) => o.alive && o !== s && o.m > s.m).length, place = Math.min(L.best, atDeath);
    const kills = s.kills | 0, life = (Date.now() - L.t0) / 1000, sc = Math.round(Math.max(L.bm, s.m));
    const d = trophyDelta({ place, field, kills, life, t: c.tr | 0, online: 1 });
    const body = JSON.stringify({ pid: c.pid, name: c.name, d, kl: kills, sc: life >= TROPHY.LIFE_MIN ? sc : 0 });
    this.boardStub().fetch("https://board/b/rec", { method: "POST", body }).then((r) => r.json()).then((r) => {
      if (!r || !r.ok) return; c.tr = r.tr; if (c.snake === s) s.tr = r.tr;
      if (this.clients.has(c)) this.send(c, JSON.stringify({ t: "tro", d: r.d, tr: r.tr, ss: r.ss, pl: place, f: field, k: kills, sc, life: Math.round(life) }));
    }).catch(() => { if (this.clients.has(c)) this.send(c, JSON.stringify({ t: "tro", err: 1 })); });
  }
  db() {
    if (this._db) return this._db; const q = this.state.storage.sql; this._db = q; this.lbc = new Map();
    q.exec("CREATE TABLE IF NOT EXISTS pl (pid TEXT PRIMARY KEY, name TEXT, tr INTEGER, ss TEXT, pk INTEGER, wk TEXT, wtr INTEGER, wkl INTEGER, wsc INTEGER, mo TEXT, mtr INTEGER, mkl INTEGER, msc INTEGER, n INTEGER, upd INTEGER)");
    for (const [n, c] of [["ss", "tr"], ["wk", "wtr"], ["wk", "wkl"], ["wk", "wsc"], ["mo", "mtr"], ["mo", "mkl"], ["mo", "msc"]]) q.exec(`CREATE INDEX IF NOT EXISTS i_${n}_${c} ON pl(${n}, ${c} DESC)`);
    q.exec("CREATE TABLE IF NOT EXISTS fin (per TEXT, met TEXT, pid TEXT, rk INTEGER, v INTEGER, cl INTEGER DEFAULT 0, PRIMARY KEY (per, met, pid))");
    q.exec("CREATE INDEX IF NOT EXISTS i_fin_pid ON fin(pid, cl)"); q.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
    return q;
  }
  // period rollover (lazy, on the first request of a new week / month): freeze the final top lists that earn rewards
  roll(now) {
    const q = this.db(), get = (k) => { const r = q.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0]; return r ? r.v : ""; }, set = (k, v) => q.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, v);
    const W = weekId(now), M = seasonId(now), w0 = get("w"), m0 = get("m");
    const snap = (per, met, col, where, id, lim) => q.exec(`INSERT OR IGNORE INTO fin (per, met, pid, rk, v) SELECT ?, ?, pid, ROW_NUMBER() OVER (ORDER BY ${col} DESC, upd ASC), ${col} FROM pl WHERE ${where} ORDER BY ${col} DESC, upd ASC LIMIT ${lim}`, per, met, ...id);
    if (w0 !== W) { if (w0) for (const [met, col] of [["tr", "wtr"], ["kl", "wkl"], ["sc", "wsc"]]) snap("w:" + w0, met, col, `wk = ? AND ${col} > 0`, [w0], 50); set("w", W); this.lbc.clear(); }
    if (m0 !== M) { if (m0) { for (const [met, col] of [["tr", "mtr"], ["kl", "mkl"], ["sc", "msc"]]) snap("m:" + m0, met, col, `mo = ? AND ${col} > 0`, [m0], 100); snap("s:" + m0, "cq", "tr", "ss = ? AND tr >= ?", [m0, TROPHY.CONQ_MIN], TROPHY.CONQ_N); } set("m", M); this.lbc.clear(); }
    return { W, M };
  }
  async board(req, url) {
    try {
      const now = Date.now(), { W, M } = this.roll(now), q = this.db(), op = url.pathname.slice(3);
      const row = (pid) => q.exec("SELECT * FROM pl WHERE pid = ?", pid).toArray()[0] || null;
      const view = (r) => { // the player's state as of now (season soft reset + period counters applied, nothing written)
        if (!r) return { tr: 0, ss: M, pk: 0, wtr: 0, wkl: 0, wsc: 0, mtr: 0, mkl: 0, msc: 0 };
        const o = { ...r }; if (o.ss !== M) { o.tr = seasonCarry(o.tr); o.pk = o.tr; o.ss = M; } if (o.wk !== W) { o.wk = W; o.wtr = o.wkl = o.wsc = 0; } if (o.mo !== M) { o.mo = M; o.mtr = o.mkl = o.msc = 0; } return o; };
      let B = {}; if (req.method === "POST") { try { B = JSON.parse((await req.text()).slice(0, 600)) || {}; } catch (_) { B = {}; } }
      if (op === "get") { const pid = url.searchParams.get("pid") || ""; if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400); const v = view(row(pid)); return J({ tr: v.tr, ss: M }); }
      if (op === "rec") { // internal: a room reports one finished life
        const pid = String(B.pid || ""); if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400);
        const d = Math.max(TROPHY.ON_MIN, Math.min(TROPHY.ON_MAX, B.d | 0)), kl = Math.max(0, Math.min(60, B.kl | 0)), sc = Math.max(0, Math.min(1e6, B.sc | 0));
        const v = view(row(pid)), tr = Math.max(0, Math.min(TROPHY.MAX, v.tr + d)), ap = tr - v.tr;
        q.exec("INSERT OR REPLACE INTO pl (pid, name, tr, ss, pk, wk, wtr, wkl, wsc, mo, mtr, mkl, msc, n, upd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          pid, cleanName(B.name), tr, M, Math.max(v.pk | 0, tr), W, (v.wtr | 0) + ap, (v.wkl | 0) + kl, Math.max(v.wsc | 0, sc), M, (v.mtr | 0) + ap, (v.mkl | 0) + kl, Math.max(v.msc | 0, sc), ((v.n | 0) + 1), now);
        return J({ ok: 1, d: ap, tr, ss: M });
      }
      if (op === "top") { // ?k=tr|wtr|wkl|wsc|mtr|mkl|msc  -> top 50 (cached 20 s; ids shown shortened)
        const k = url.searchParams.get("k") || "tr"; if (!["tr", "wtr", "wkl", "wsc", "mtr", "mkl", "msc"].includes(k)) return J({ err: "k" }, 400);
        const c = this.lbc.get(k); if (c && now - c.t < 20000) return J(c.o);
        const where = k === "tr" ? "ss = ?" : k[0] === "w" ? `wk = ? AND ${k} > 0` : `mo = ? AND ${k} > 0`, per = k === "tr" || k[0] === "m" ? M : W;
        const list = q.exec(`SELECT pid, name, ${k} AS v FROM pl WHERE ${where} ORDER BY ${k} DESC, upd ASC LIMIT 50`, per).toArray().map((r, i) => ({ r: i + 1, n: r.name, v: r.v, id: r.pid.slice(0, 6) }));
        const o = { k, per, list, conqN: TROPHY.CONQ_N, conqMin: TROPHY.CONQ_MIN, t: now }; this.lbc.set(k, { t: now, o }); return J(o);
      }
      if (op === "me" || op === "claim") {
        const pid = await pidOf(String(B.pk || "")); if (!pid) return J({ err: "pk" }, 400);
        if (op === "claim") { const per = String(B.per || ""), met = String(B.met || ""); if (!/^[wms]:\d{4}-(W\d{2}|\d{2})$/.test(per) || !["tr", "kl", "sc", "cq"].includes(met)) return J({ err: "bad" }, 400);
          const r = q.exec("SELECT rk, v FROM fin WHERE per = ? AND met = ? AND pid = ? AND cl = 0", per, met, pid).toArray()[0]; if (!r) return J({ err: "none" });
          q.exec("UPDATE fin SET cl = 1 WHERE per = ? AND met = ? AND pid = ?", per, met, pid); return J({ ok: 1, per, met, rk: r.rk, v: r.v }); }
        const v = view(row(pid)), rank = (col, val, where, per) => (val > 0 ? q.exec(`SELECT COUNT(*) AS n FROM pl WHERE ${where} AND ${col} > ?`, per, val).one().n + 1 : 0);
        const rk = rank("tr", v.tr, "ss = ?", M);
        const out = { pid: pid.slice(0, 6), tr: v.tr, ss: M, pk: v.pk | 0, rank: rk, conq: rk > 0 && rk <= TROPHY.CONQ_N && v.tr >= TROPHY.CONQ_MIN ? 1 : 0, w: W, m: M,
          c: { w_rush: [v.wtr | 0, rank("wtr", v.wtr | 0, "wk = ?", W)], w_hunt: [v.wkl | 0, rank("wkl", v.wkl | 0, "wk = ?", W)], w_score: [v.wsc | 0, rank("wsc", v.wsc | 0, "wk = ?", W)],
            m_rush: [v.mtr | 0, rank("mtr", v.mtr | 0, "mo = ?", M)], m_hunt: [v.mkl | 0, rank("mkl", v.mkl | 0, "mo = ?", M)], m_score: [v.msc | 0, rank("msc", v.msc | 0, "mo = ?", M)] },
          claims: q.exec("SELECT per, met, rk, v FROM fin WHERE pid = ? AND cl = 0 LIMIT 20", pid).toArray(), t: now };
        return J(out);
      }
      return J({ err: "op" }, 404);
    } catch (e) { return J({ err: "server", m: String(e && e.message).slice(0, 120) }, 500); }
  }
  // ---------- srv1: social object "social-v1" (same Room class, SQLite): public ids, special ids, friends, 1:1 chat, invites ----------
  // Live delivery uses the Hibernation WebSocket API (state.acceptWebSocket, one tag = the player's pid), so idle lobby sockets
  // cost no duration while nothing happens. Everything here is synchronous SQL inside one object = atomic per request.
  sdb() {
    if (this._sdb) return this._sdb; const q = this.state.storage.sql; this._sdb = q; this.rl = new Map();
    q.exec("CREATE TABLE IF NOT EXISTS acct (pid TEXT PRIMARY KEY, id7 TEXT, vis TEXT, name TEXT, av TEXT, fr INTEGER, lv INTEGER, own INTEGER DEFAULT 0, seen INTEGER, t INTEGER)");
    q.exec("CREATE TABLE IF NOT EXISTS ids (num TEXT PRIMARY KEY, pid TEXT, kind TEXT, t INTEGER, tok TEXT)"); q.exec("CREATE INDEX IF NOT EXISTS i_ids_pid ON ids(pid)");
    q.exec("CREATE TABLE IF NOT EXISTS rq (a TEXT, b TEXT, t INTEGER, PRIMARY KEY (a, b))"); q.exec("CREATE INDEX IF NOT EXISTS i_rq_b ON rq(b)");
    q.exec("CREATE TABLE IF NOT EXISTS fr (a TEXT, b TEXT, t INTEGER, PRIMARY KEY (a, b))");
    q.exec("CREATE TABLE IF NOT EXISTS bl (a TEXT, b TEXT, t INTEGER, PRIMARY KEY (a, b))");
    q.exec("CREATE TABLE IF NOT EXISTS msg (id INTEGER PRIMARY KEY AUTOINCREMENT, cv TEXT, f TEXT, tx TEXT, t INTEGER)"); q.exec("CREATE INDEX IF NOT EXISTS i_msg_cv ON msg(cv, id)");
    q.exec("CREATE TABLE IF NOT EXISTS rd (pid TEXT, cv TEXT, last INTEGER, PRIMARY KEY (pid, cv))");
    q.exec("CREATE TABLE IF NOT EXISTS inv (a TEXT, b TEXT, room TEXT, t INTEGER, PRIMARY KEY (a, b))");
    q.exec("CREATE TABLE IF NOT EXISTS rep (id INTEGER PRIMARY KEY AUTOINCREMENT, by TEXT, who TEXT, mid INTEGER, tx TEXT, t INTEGER)");
    q.exec("INSERT OR IGNORE INTO ids (num, pid, kind, t) VALUES ('1', '', 'o', 0)"); // id 1 is reserved for the founder: never assigned at random, only by the one-time claim
    return q;
  }
  srow(pid) { return this.sdb().exec("SELECT * FROM acct WHERE pid = ?", pid).toArray()[0] || null; }
  sAcct(pid) { // every player gets a 7-digit public id the first time the server sees them (random, unique, never sequential)
    const q = this.sdb(); let r = this.srow(pid); if (r) return r; const now = Date.now();
    for (let k = 0; k < 40; k++) { const b = new Uint32Array(1); crypto.getRandomValues(b); const n = String(1000000 + (b[0] % 9000000));
      if (q.exec("SELECT num FROM ids WHERE num = ?", n).toArray().length) continue;
      q.exec("INSERT INTO ids (num, pid, kind, t) VALUES (?, ?, 'b', ?)", n, pid, now); q.exec("INSERT INTO acct (pid, id7, vis, name, av, fr, lv, own, seen, t) VALUES (?, ?, ?, 'Guest', 'p0', 0, 1, 0, ?, ?)", pid, n, n, now, now); return this.srow(pid); }
    throw new Error("id space");
  }
  sCard(pid, me) { const r = this.srow(pid); if (!r) return null; const c = { id: r.vis, n: r.name, av: r.av, fr: r.fr | 0, lv: r.lv | 0 }; if (r.own) c.own = 1; if (me) c.st = this.sPres(pid); return c; }
  sPid(id) { id = String(id || ""); if (!/^\d{1,7}$/.test(id)) return ""; const r = this.sdb().exec("SELECT pid FROM ids WHERE num = ?", id).toArray()[0]; return r && r.pid ? r.pid : ""; }
  sPres(pid, excl) { let ws = []; try { ws = this.state.getWebSockets(pid); } catch (_) {} let st = "off"; for (const w of ws) { if (w === excl) continue; let a = null; try { a = w.deserializeAttachment(); } catch (_) {} if (!a) continue; if (a.st === "match") return "match"; st = "lobby"; } return st; }
  sPush(pid, o) { let ws = []; try { ws = this.state.getWebSockets(pid); } catch (_) {} const s = JSON.stringify({ t: "ev", ...o }); let n = 0; for (const w of ws) try { w.send(s); n++; } catch (_) {} return n; }
  sFriends(pid) { return this.sdb().exec("SELECT b FROM fr WHERE a = ?", pid).toArray().map((r) => r.b); }
  sPresAll(pid, excl) { const r = this.srow(pid); if (!r) return; const st = this.sPres(pid, excl); for (const f of this.sFriends(pid)) this.sPush(f, { k: "pres", id: r.vis, st }); }
  sVis(pid) { const q = this.sdb(), r = this.srow(pid); if (!r) return; const p = q.exec("SELECT num FROM ids WHERE pid = ? AND kind = 'p' ORDER BY t DESC LIMIT 1", pid).toArray()[0];
    const v = r.own ? "1" : p ? p.num : r.id7; if (v !== r.vis) q.exec("UPDATE acct SET vis = ? WHERE pid = ?", v, pid); return v; }
  sMe(pid) { const r = this.srow(pid), q = this.sdb(); return { id: r.vis, id7: r.id7, prem: q.exec("SELECT num FROM ids WHERE pid = ? AND kind = 'p' ORDER BY t", pid).toArray().map((x) => x.num), own: r.own ? 1 : 0 }; }
  sLimit(pid, k, n, win = 60000) { const now = Date.now(), key = pid + "|" + k; let e = this.rl.get(key); if (!e || now - e.t > win) { e = { t: now, n: 0 }; this.rl.set(key, e); } if (this.rl.size > 20000) this.rl.clear(); return ++e.n > n; }
  sBlocked(a, b) { return this.sdb().exec("SELECT a FROM bl WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", a, b, b, a).toArray().length > 0; }
  static cv(a, b) { return a < b ? a + ":" + b : b + ":" + a; }
  sop(pid, m) {
    const q = this.sdb(), now = Date.now(), op = String(m.op || ""); if (this.sLimit(pid, "*", 240)) return { err: "rate" };
    const me = this.sAcct(pid); const other = () => { const o = this.sPid(m.id); return o && o !== pid ? o : ""; };
    if (op === "hello") { // profile summary for friend lists + cards (name filtered like chat)
      const nm = filterText(cleanName(m.n)).t.slice(0, 16) || "Guest", av = typeof m.av === "string" && /^(p([0-9]|1[0-9]|2[0-3])|f\d{1,3})$/.test(m.av) ? m.av : "p0";
      q.exec("UPDATE acct SET name = ?, av = ?, fr = ?, lv = ?, seen = ? WHERE pid = ?", nm, av, Math.max(0, Math.min(17, m.fr | 0)), Math.max(1, Math.min(100, m.lv | 0)), now, pid); this.sVis(pid);
      return { ok: 1, me: this.sMe(pid) }; }
    if (op === "me") return { me: this.sMe(pid) };
    if (op === "list") {
      const fr = this.sFriends(pid).map((b) => { const c = this.sCard(b, 1); if (!c) return null; const cv = Room.cv(pid, b), rd = q.exec("SELECT last FROM rd WHERE pid = ? AND cv = ?", pid, cv).toArray()[0];
        c.un = q.exec("SELECT COUNT(*) AS n FROM msg WHERE cv = ? AND f != ? AND id > ?", cv, pid, rd ? rd.last : 0).one().n; return c; }).filter(Boolean);
      const cards = (rows, k) => rows.map((r) => this.sCard(r[k])).filter(Boolean);
      return { me: this.sMe(pid), fr, inq: cards(q.exec("SELECT a FROM rq WHERE b = ? ORDER BY t DESC LIMIT 50", pid).toArray(), "a"), outq: cards(q.exec("SELECT b FROM rq WHERE a = ? ORDER BY t DESC LIMIT 50", pid).toArray(), "b"),
        bl: cards(q.exec("SELECT b FROM bl WHERE a = ? LIMIT 100", pid).toArray(), "b"), inv: q.exec("SELECT a, room, t FROM inv WHERE b = ? AND t > ?", pid, now - 120000).toArray().map((r) => ({ from: this.sCard(r.a), room: r.room, t: r.t })).filter((x) => x.from) };
    }
    if (op === "find") { if (this.sLimit(pid, "find", 30)) return { err: "rate" }; const o = this.sPid(m.id); if (!o) return { err: "notfound" }; if (o === pid) return { err: "self" };
      const c = this.sCard(o); c.rel = q.exec("SELECT a FROM fr WHERE a = ? AND b = ?", pid, o).toArray().length ? "fr" : q.exec("SELECT a FROM rq WHERE a = ? AND b = ?", pid, o).toArray().length ? "out" : q.exec("SELECT a FROM rq WHERE a = ? AND b = ?", o, pid).toArray().length ? "in" : q.exec("SELECT a FROM bl WHERE a = ? AND b = ?", pid, o).toArray().length ? "bl" : ""; return { card: c }; }
    if (op === "req") { if (this.sLimit(pid, "req", 10)) return { err: "rate" }; const o = this.sPid(m.id); if (!o) return { err: "notfound" }; if (o === pid) return { err: "self" };
      if (q.exec("SELECT a FROM fr WHERE a = ? AND b = ?", pid, o).toArray().length) return { err: "already" };
      if (q.exec("SELECT a FROM bl WHERE a = ? AND b = ?", pid, o).toArray().length) return { err: "blocked" };
      if (q.exec("SELECT a FROM bl WHERE a = ? AND b = ?", o, pid).toArray().length) return { ok: 1, sent: 1 }; // they blocked me: looks sent, never delivered
      if (q.exec("SELECT a FROM rq WHERE a = ? AND b = ?", o, pid).toArray().length) return this.sop(pid, { op: "acc", id: m.id }); // they asked first: accept
      if (q.exec("SELECT COUNT(*) AS n FROM fr WHERE a = ?", pid).one().n >= 200) return { err: "full" };
      if (q.exec("SELECT COUNT(*) AS n FROM rq WHERE a = ?", pid).one().n >= 30) return { err: "pending" };
      q.exec("INSERT OR REPLACE INTO rq (a, b, t) VALUES (?, ?, ?)", pid, o, now); this.sPush(o, { k: "req", from: this.sCard(pid) }); return { ok: 1, sent: 1 }; }
    if (op === "acc") { const o = other(); if (!o || !q.exec("SELECT a FROM rq WHERE a = ? AND b = ?", o, pid).toArray().length) return { err: "none" };
      q.exec("DELETE FROM rq WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", o, pid, pid, o); q.exec("INSERT OR IGNORE INTO fr (a, b, t) VALUES (?, ?, ?)", pid, o, now); q.exec("INSERT OR IGNORE INTO fr (a, b, t) VALUES (?, ?, ?)", o, pid, now);
      this.sPush(o, { k: "acc", from: this.sCard(pid, 1) }); return { ok: 1, card: this.sCard(o, 1) }; }
    if (op === "dec") { const o = other(); if (!o) return { err: "none" }; q.exec("DELETE FROM rq WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", o, pid, pid, o); return { ok: 1 }; } // also cancels my own request
    if (op === "rem") { const o = other(); if (!o) return { err: "none" }; q.exec("DELETE FROM fr WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", o, pid, pid, o); q.exec("DELETE FROM inv WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", o, pid, pid, o); this.sPush(o, { k: "rem", id: me.vis }); return { ok: 1 }; }
    if (op === "blk") { const o = other(); if (!o) return { err: "none" }; for (const T of ["fr", "rq", "inv"]) q.exec(`DELETE FROM ${T} WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)`, o, pid, pid, o);
      q.exec("INSERT OR REPLACE INTO bl (a, b, t) VALUES (?, ?, ?)", pid, o, now); this.sPush(o, { k: "rem", id: me.vis }); return { ok: 1 }; }
    if (op === "unb") { const o = other(); if (!o) return { err: "none" }; q.exec("DELETE FROM bl WHERE a = ? AND b = ?", pid, o); return { ok: 1 }; }
    const isFr = (o) => q.exec("SELECT a FROM fr WHERE a = ? AND b = ?", pid, o).toArray().length > 0;
    if (op === "msgs") { const o = other(); if (!o || !isFr(o)) return { err: "notfriend" }; const cv = Room.cv(pid, o);
      const list = q.exec("SELECT id, f, tx, t FROM msg WHERE cv = ? ORDER BY id DESC LIMIT ?", cv, CHAT_KEEP).toArray().reverse().map((r) => ({ i: r.id, me: r.f === pid ? 1 : 0, tx: r.tx, t: r.t }));
      if (list.length) q.exec("INSERT OR REPLACE INTO rd (pid, cv, last) VALUES (?, ?, ?)", pid, cv, list[list.length - 1].i); return { id: m.id, list, card: this.sCard(o, 1) }; }
    if (op === "read") { const o = other(); if (!o) return { err: "none" }; const cv = Room.cv(pid, o), r = q.exec("SELECT MAX(id) AS n FROM msg WHERE cv = ?", cv).one(); if (r && r.n) q.exec("INSERT OR REPLACE INTO rd (pid, cv, last) VALUES (?, ?, ?)", pid, cv, r.n); return { ok: 1 }; }
    if (op === "send") { const o = other(); if (!o || !isFr(o)) return { err: "notfriend" }; if (this.sBlocked(pid, o)) return { err: "blocked" };
      const raw = String(m.tx || ""); if (!raw.trim()) return { err: "empty" }; if ([...raw].length > MSG_MAX) return { err: "long" }; if (this.sLimit(pid, "send", 20) || this.sLimit(pid, "send1", 3, 2000)) return { err: "rate" }; const f = filterText(raw); if (!f.t) return { err: "empty" };
      const cv = Room.cv(pid, o); q.exec("INSERT INTO msg (cv, f, tx, t) VALUES (?, ?, ?, ?)", cv, pid, f.t, now); const id = q.exec("SELECT MAX(id) AS n FROM msg WHERE cv = ?", cv).one().n;
      const cut = q.exec("SELECT id FROM msg WHERE cv = ? ORDER BY id DESC LIMIT 1 OFFSET ?", cv, CHAT_KEEP - 1).toArray()[0]; if (cut) q.exec("DELETE FROM msg WHERE cv = ? AND id < ?", cv, cut.id); // keep the last 100
      q.exec("INSERT OR REPLACE INTO rd (pid, cv, last) VALUES (?, ?, ?)", pid, cv, id);
      this.sPush(o, { k: "msg", from: this.sCard(pid), m: { i: id, me: 0, tx: f.t, t: now } }); return { ok: 1, m: { i: id, me: 1, tx: f.t, t: now }, filt: f.hit ? 1 : 0 }; }
    if (op === "rep") { if (this.sLimit(pid, "rep", 10)) return { err: "rate" }; const o = other(); if (!o) return { err: "none" }; const r = q.exec("SELECT tx FROM msg WHERE id = ? AND cv = ? AND f = ?", m.mid | 0, Room.cv(pid, o), o).toArray()[0];
      q.exec("INSERT INTO rep (by, who, mid, tx, t) VALUES (?, ?, ?, ?, ?)", pid, o, m.mid | 0, r ? r.tx : "", now); return { ok: 1 }; }
    if (op === "inv") { if (this.sLimit(pid, "inv", 6)) return { err: "rate" }; const o = other(); if (!o || !isFr(o)) return { err: "notfriend" };
      let room = String(m.room || "").toLowerCase(); if (!/^[a-z0-9-]{1,24}$/.test(room)) { const b = new Uint8Array(4); crypto.getRandomValues(b); room = "f-" + [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 7); }
      q.exec("INSERT OR REPLACE INTO inv (a, b, room, t) VALUES (?, ?, ?, ?)", pid, o, room, now); const live = this.sPush(o, { k: "inv", from: this.sCard(pid), room, at: now }); return { ok: 1, room, live: live ? 1 : 0, st: this.sPres(o) }; }
    if (op === "invr") { const o = other(); if (!o) return { err: "none" }; const r = q.exec("SELECT room FROM inv WHERE a = ? AND b = ? AND t > ?", o, pid, now - 120000).toArray()[0]; q.exec("DELETE FROM inv WHERE a = ? AND b = ?", o, pid);
      if (!r) return { err: "expired" }; this.sPush(o, { k: "invr", from: this.sCard(pid), ok: m.ok ? 1 : 0, room: r.room }); return { ok: 1, room: r.room }; }
    // ---- special ids (shop). Ownership is decided here, atomically; the coin price is paid client-side right after (see client) ----
    if (op === "shop") { const sold = new Set(q.exec("SELECT num FROM ids WHERE length(num) = 5").toArray().map((r) => r.num)); const pick = [];
      const seed = Math.floor(now / 3600000); let h = seed * 2654435761 >>> 0; for (let k = 0; k < 200 && pick.length < 8; k++) { h = (Math.imul(h ^ (h >>> 13), 1274126177) + 0x9e3779b9) >>> 0; const n = String(10000 + (h % 90000)); if (idKind(n) === "std" && !sold.has(n) && !pick.includes(n)) pick.push(n); }
      return { prices: ID_PRICES, rep: SPECIAL_REP.map((n) => ({ n, s: sold.has(n) ? 1 : 0 })), seq: SPECIAL_SEQ.map((n) => ({ n, s: sold.has(n) ? 1 : 0 })), std: pick, me: this.sMe(pid) }; }
    if (op === "chk") { const n = String(m.n || ""), k = idKind(n); if (!k) return { err: "bad" }; return { n, kind: k, price: idPrice(n), sold: q.exec("SELECT num FROM ids WHERE num = ?", n).toArray().length ? 1 : 0 }; }
    if (op === "buyid") { if (this.sLimit(pid, "buy", 6)) return { err: "rate" }; const n = String(m.n || ""), k = idKind(n); if (!k) return { err: "bad" };
      if (Number(m.price) !== idPrice(n)) return { err: "price", price: idPrice(n) };
      if (q.exec("SELECT COUNT(*) AS c FROM ids WHERE pid = ? AND kind = 'p'", pid).one().c >= 5) return { err: "max" };
      if (q.exec("SELECT num FROM ids WHERE num = ?", n).toArray().length) return { err: "sold" }; // check + insert with no await between them: one buyer only
      const b = new Uint8Array(8); crypto.getRandomValues(b); const tok = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      q.exec("INSERT INTO ids (num, pid, kind, t, tok) VALUES (?, ?, 'p', ?, ?)", n, pid, now, tok); this.sVis(pid); this.sPresAll(pid);
      return { ok: 1, n, price: idPrice(n), tok, me: this.sMe(pid) }; }
    if (op === "undoid") { const n = String(m.n || ""), r = q.exec("SELECT * FROM ids WHERE num = ? AND pid = ? AND kind = 'p'", n, pid).toArray()[0]; // the coin payment failed on the device: give the id back
      if (!r || !m.tok || r.tok !== String(m.tok) || now - r.t > 600000) return { err: "none" }; q.exec("DELETE FROM ids WHERE num = ?", n); this.sVis(pid); return { ok: 1, me: this.sMe(pid) }; }
    if (op === "paid") { q.exec("UPDATE ids SET tok = NULL WHERE num = ? AND pid = ? AND kind = 'p'", String(m.n || ""), pid); return { ok: 1 }; } // payment done: the sale can no longer be undone
    return { err: "op" };
  }
  async sOp(pid, m) { // the one op that needs an await (hashing the founder code) is resolved here, then everything else is synchronous
    if (m && m.op === "claim1") { if (this.sLimit(pid, "claim", 5, 600000)) return { err: "rate" }; this.sAcct(pid);
      const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-own|" + String(m.code || "").trim().toUpperCase())))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const q = this.sdb(), r = q.exec("SELECT pid FROM ids WHERE num = '1'").toArray()[0];
      if (h !== OWNER_H) return { err: "bad" }; if (r && r.pid && r.pid !== pid) return { err: "taken" };
      q.exec("UPDATE ids SET pid = ?, t = ? WHERE num = '1'", pid, Date.now()); q.exec("UPDATE acct SET own = 1 WHERE pid = ?", pid); this.sVis(pid); return { ok: 1, me: this.sMe(pid) }; }
    try { return this.sop(pid, m || {}); } catch (e) { return { err: "server", m: String(e && e.message).slice(0, 100) }; }
  }
  async socialHttp(req, url) {
    if (url.pathname === "/s/uid") { const pid = url.searchParams.get("pid") || ""; if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400); try { return J({ id: this.sAcct(pid).vis }); } catch (e) { return J({ err: "server" }, 500); } } // internal: room -> social
    let B = {}; try { B = JSON.parse((await req.text()).slice(0, 1200)) || {}; } catch (_) {}
    const pid = await pidOf(String(B.pk || "")); if (!pid) return J({ err: "pk" }, 400); return J(await this.sOp(pid, B));
  }
  async socialWs(req, url) {
    const pid = await pidOf(url.searchParams.get("pk") || ""); if (!pid) return new Response("pk", { status: 400 });
    this.sAcct(pid); const old = this.state.getWebSockets(pid); for (let i = 0; i < old.length - 2; i++) try { old[i].close(4009, "replaced"); } catch (_) {} // at most 3 live tabs per player
    if (!this._auto) { this._auto = 1; try { this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}')); } catch (_) {} } // keep-alive pings never wake the object
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair); this.state.acceptWebSocket(server, [pid]);
    server.serializeAttachment({ pid, st: "lobby" }); server.send(JSON.stringify({ t: "hi", me: this.sMe(pid), v: VERSION })); this.sPresAll(pid);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, data) { // hibernation API: only the social object's sockets come here (game rooms use accept() + listeners)
    let a = null; try { a = ws.deserializeAttachment(); } catch (_) {} if (!a || !a.pid || typeof data !== "string" || data.length > 1200) return; let m; try { m = JSON.parse(data); } catch (_) { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "st") { const st = m.s === "match" ? "match" : "lobby"; if (a.st !== st) { a.st = st; ws.serializeAttachment(a); this.sPresAll(a.pid); } return; }
    if (m.t === "ping") { try { ws.send('{"t":"pong"}'); } catch (_) {} return; }
    if (m.t === "op") { const r = await this.sOp(a.pid, m); try { ws.send(JSON.stringify({ t: "r", i: m.i | 0, ...r })); } catch (_) {} }
  }
  async webSocketClose(ws) { let a = null; try { a = ws.deserializeAttachment(); } catch (_) {} if (a && a.pid) this.sPresAll(a.pid, ws); try { ws.close(1000); } catch (_) {} }
  async webSocketError(ws) { return this.webSocketClose(ws); }
  foodFull() {
    const S = this.sim, idx = []; for (let i = 0; i < S.FM; i++) if (S.fa[i]) idx.push(i);
    const b = new ArrayBuffer(3 + idx.length * 12), v = new DataView(b); v.setUint8(0, 3); v.setUint16(1, idx.length, true);
    let o = 3; for (const i of idx) { v.setUint16(o, S.fid[i], true); v.setFloat32(o + 2, S.fx[i], true); v.setFloat32(o + 6, S.fy[i], true); v.setUint8(o + 10, Math.min(255, Math.round(S.fv[i] * 10))); v.setUint8(o + 11, S.fc[i]); o += 12; }
    return b;
  }
  loop() {
    const now = Date.now(); this.acc += (now - this.last) / 1000; this.last = now; if (this.acc > 0.25) this.acc = 0.25; // never spiral
    while (this.acc >= TICK) { this.acc -= TICK; this.tick(); }
  }
  tick() {
    const S = this.sim;
    // apply one queued input per human (two when the queue is long, so a laggy burst catches up instead of piling up)
    for (const c of this.clients) {
      const s = c.snake; if (!s || !s.alive) continue;
      // jitter buffer: after a starve, wait until 2 inputs are queued again so network jitter can't starve every other tick
      if (c.buf && c.q.length >= 6) c.buf = false;
      if (c.buf || c.q.length < 3) { c.buf = true; c.extra++; continue; }
      const take = c.q.length >= 18 ? 2 : 1;
      for (let k = 0; k < take; k++) { c.ack = c.q.shift(); c.lastTa = c.q.shift(); c.lastBoost = c.q.shift(); c.extra = 0; s.ta = c.lastTa; s.boost = c.lastBoost; if (k === 0 && take === 2) S.extraMove(s); } // noself1b: catch-up move eats + collides like step
    }
    S.step(() => true);
    // events
    const dead = []; for (let i = 0; i < S.evDie.length; i += 3) dead.push([S.evDie[i], S.evDie[i + 1], S.evDie[i + 2]]);
    for (const id of S.evNew) { const s = S.byId.get(id); if (s && s.alive) this.bcast(JSON.stringify({ t: "sn", ...this.snakeMsg(s) })); }
    for (const [id, by, cause] of dead) this.bcast(JSON.stringify({ t: "dead", id, by, cause }));
    if (dead.length) for (const c of this.clients) if (c.snake && !c.snake.alive && c.life && !c.life.done && dead.some((d) => d[0] === c.snake.id)) this.score(c, c.snake);
    if (S.evPuNew.length) this.bcast(JSON.stringify({ t: "pu+", l: S.evPuNew.map((p) => [p.id, p.k, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) }));
    if (S.evPu.length) { const l = []; for (let i = 0; i < S.evPu.length; i += 3) l.push([S.evPu[i].id, S.evPu[i + 1], S.evPu[i].k, S.evPu[i + 2] || []]); this.bcast(JSON.stringify({ t: "pu-", l })); }
    for (let i = 0; i < S.evShield.length; i += 2) this.bcast(JSON.stringify({ t: "sh", id: S.evShield[i], by: S.evShield[i + 1] }));
    for (const e of S.evEvt) this.bcast(JSON.stringify({ t: "evt", ...e }));
    if (S.evMet.length) this.bcast(JSON.stringify({ t: "met", l: S.evMet.map((M) => [M.id, Math.round(M.x * 100) / 100, Math.round(M.y * 100) / 100, M.r, M.t, M.T]) }));
    // one binary frame shared by everybody: [0]=1 [1..4]=tick [5..6]=ack [7]=extra (255 = no snake) [8..23]=own x,y,a,av [24]=count, then snakes, eats, spawns
    const alive = S.snakes.filter((s) => s.alive), ne = S.evEat.length / 2, ns = S.evSpawn.length;
    const size = 25 + alive.length * 13 + 2 + ne * 4 + 2 + ns * 12, b = new ArrayBuffer(size), v = new DataView(b);
    v.setUint8(0, 1); v.setUint32(1, S.tick, true);
    let o = 25; v.setUint8(24, alive.length);
    for (const s of alive) { v.setUint16(o, s.id, true); v.setFloat32(o + 2, s.x, true); v.setFloat32(o + 6, s.y, true); v.setUint16(o + 10, Math.min(65535, Math.round(s.m)), true); v.setUint8(o + 12, (s.boosting ? 1 : 0) | (s.bot ? 2 : 0)); o += 13; }
    v.setUint16(o, ne, true); o += 2; for (let i = 0; i < S.evEat.length; i += 2) { v.setUint16(o, S.fid[S.evEat[i]], true); v.setUint16(o + 2, S.evEat[i + 1], true); o += 4; }
    v.setUint16(o, ns, true); o += 2; for (const i of S.evSpawn) { v.setUint16(o, S.fid[i], true); v.setFloat32(o + 2, S.fx[i], true); v.setFloat32(o + 6, S.fy[i], true); v.setUint8(o + 10, Math.min(255, Math.round(S.fv[i] * 10))); v.setUint8(o + 11, S.fc[i]); o += 12; }
    const u8 = new Uint8Array(b);
    for (const c of this.clients) {
      if (!c.joined) continue; const s = c.snake;
      v.setUint16(5, c.ack, true); v.setUint8(7, Math.min(255, c.extra));
      if (s && s.alive) { v.setFloat32(8, s.x, true); v.setFloat32(12, s.y, true); v.setFloat32(16, s.a, true); v.setFloat32(20, s.av, true); v.setUint8(7, Math.min(254, c.extra)); }
      else { v.setFloat32(8, 0, true); v.setFloat32(12, 0, true); v.setFloat32(16, 0, true); v.setFloat32(20, 0, true); v.setUint8(7, 255); }
      this.send(c, u8.slice().buffer);
    }
    S.drain();
    // corpses leave the sim, bots respawn to keep the room lively
    for (const [id] of dead) { const s = S.byId.get(id); if (s) S.removeSnake(s); }
    if (S.tick % 30 === 0) {
      this.fill();
      const srt = alive.slice().sort((a, b2) => b2.m - a.m), lb = srt.slice(0, 10).map((s) => [s.id, Math.round(s.m), s.kills]);
      for (const c of this.clients) { const L = c.life, s = c.snake; if (!L || L.done || !s || !s.alive) continue; const r = srt.indexOf(s) + 1; if (r > 0 && r < L.best) L.best = r; if (srt.length > L.field) L.field = srt.length; if (s.m > L.bm) L.bm = s.m; }
      this.bcast(JSON.stringify({ t: "lb", lb, humans: [...this.clients].filter((c) => c.joined).length }));
    }
  }
}
