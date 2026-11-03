// super-snake-online — Cloudflare Worker + Durable Object (one DO per room). No database, no payments, nothing stored.
// The room runs the SAME sim.js as the client at 30 Hz and is authoritative for movement, food, mass, collisions and kills.
// Clients predict their own snake (input seq/ack reconciliation) and interpolate everyone else.
import { Sim, C, moveSnake, sanitizeSkin, cleanName, BOT_NAMES, pickBotName } from "./sim.js";

const TICK = 1 / 30, MAX_HUMANS = 12, TARGET_SNAKES = 30, VERSION = 3; // v2: power-ups (pus / pu+ / pu- / sh) · v3: 11 power-ups, arena events (evt / met), emotes (emo), avatars in skins
const ORIGINS = [/^https:\/\/(www\.)?billke\.com$/, /^https:\/\/m0290477-collab\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// look1: bots never share a look with any live snake (players included)
const uniqSkin = (snakes, i) => { const used = new Set(); for (const o of snakes) if (o.alive && o.skin) used.add(o.skin.k + ":" + o.skin.i); for (let k = 0; k < 60; k++) { const c = BOT_SKINS(i + k * 5); if (!used.has(c.k + ":" + c.i)) return c; } return BOT_SKINS(i); };
const BOT_SKINS = (i) => ({ k: i % 3 === 0 ? "flag" : "skin", i: i % 3 === 0 ? (i * 37) % 197 : i % 24, e: i % 4, t: 0, n: 0, av: i % 3 === 0 ? "f" + ((i * 37) % 197) : "p" + ((i * 7) % 24), fr: i % 5 === 0 ? 0 : 1 + (i % 4) });
const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };

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
    while (want-- > 0) { const i = this.botSeq++; this.sim.addSnake(pickBotName(this.sim.snakes, i), uniqSkin(this.sim.snakes, i), { bot: true, diff: [1, 1, 2, 2, 3][i % 5] }); }
  }
  async fetch(req) {
    const url = new URL(req.url);
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
    if (c.snake && c.snake.alive) this.sim.kill(c.snake, 0, 4);
    if (!this.clients.size && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  send(c, m) { try { c.ws.send(typeof m === "string" ? m : m); } catch (_) {} }
  bcast(m) { for (const c of this.clients) if (c.joined) this.send(c, m); }
  snakeMsg(s) { // full description of one snake incl. its recent path (enough to draw the whole body)
    const pts = []; const k = Math.min(s.n, Math.ceil(s.len / (C.SPEED * TICK)) + 4);
    for (let i = k - 1; i >= 0; i--) pts.push(Math.round(s.sx(i) * 100) / 100, Math.round(s.sy(i) * 100) / 100);
    return { id: s.id, name: s.name, skin: s.skin, bot: s.bot ? 1 : 0, m: Math.round(s.m), a: s.a, path: pts, tick: this.sim.tick };
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
      const s = this.sim.addSnake(c.name, c.skin, {}); c.snake = s; c.q.length = 0; c.ack = 0xffff; c.extra = 0;
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
      const lb = alive.slice().sort((a, b2) => b2.m - a.m).slice(0, 10).map((s) => [s.id, Math.round(s.m), s.kills]);
      this.bcast(JSON.stringify({ t: "lb", lb, humans: [...this.clients].filter((c) => c.joined).length }));
    }
  }
}
