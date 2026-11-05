// Online client: WebSocket to the super-snake-online Durable Object.
// Own snake = client-side prediction with input seq/ack reconciliation. Others = interpolation ~2 ticks behind the server.
// Own deaths are detected locally against what is on screen and reported at once (instant, never "late"); the server confirms
// and is still authoritative for everything else (food, mass, kills, collisions it sees first).
import { Snake, Sim, C, moveSnake, MASK, boostCost, PU, PU_DUR, puTick, puGive, Terr } from "./sim.js?v=layoutfix";
// one predicted step: identical to the server step for this snake, including the boost mass cost
let MUT = ""; // play2: weekend rule of the room (free boost = no boost cost in prediction either)
function predict(s, dt) { moveSnake(s, dt, s.m > C.MIN_BOOST_M); if (s.boosting && MUT !== "fb" && !(s.pu && (s.pu[2] > 0 || s.pu[7] > 0))) s.setMass(Math.max(C.MIN_BOOST_M - 0.5, s.m - boostCost(s.m, dt))); }
export const SERVER = (typeof window !== "undefined" && window.__SSP_SERVER) || "wss://super-snake-online.molierk.workers.dev/ws";
const DT = 1 / 30, INTERP = 3; // render remote snakes >= 3 server ticks (100 ms) behind: absorbs network jitter
// perf2 network governor: the interpolation delay follows measured snapshot jitter / loss. It grows fast on a spike
// (6 ticks/s) and shrinks slowly (0.25 tick/s, only after 3 s without a spike), between INTERP (the old fixed value, so a
// clean connection behaves exactly as before) and INTERP_MAX. Rendering only: the local death check uses the same
// positions that are drawn (prepareOthers), and the server stays authoritative, so rules and fairness are unchanged.
const INTERP_MAX = 8;
export function interpTarget(jit, lossRate) { return Math.max(INTERP, Math.min(INTERP_MAX, 2 + (jit + 6) / (DT * 1000) + Math.min(2, lossRate * 20))); }
export function netQuality(rtt, jit, lossRate) { const sc = rtt / 1000 * 2 + jit / 30 + lossRate * 25; return sc < 0.6 ? "good" : sc < 1.4 ? "fair" : "poor"; }

export class NetBackend {
  constructor(opts) {
    this.o = opts; // { room, name, skin, cb: {onState, onDeath(id,by,cause), onEat(byId,x,y,v), onMyDeath(by,cause), onKill(id), onSpawnMe}, ... }
    this.cb = opts.cb; this.dt = DT; this.online = true;
    this.mirrors = new Map(); this.me = null; this.myId = 0; this.seq = 0; this.hist = new Float32Array(256 * 2);
    this.batch = []; this.acc = 0; this.R = C.R; this.tick = 0; this.clock = null; this.lb = []; this.humans = 0; this.ping = 0; this.pings = [];
    this.FM = 6200; this.fx = new Float32Array(this.FM); this.fy = new Float32Array(this.FM); this.fv = new Float32Array(this.FM); this.fc = new Uint8Array(this.FM); this.fa = new Uint8Array(this.FM); this.fb = new Float64Array(this.FM);
    this.free = []; for (let i = this.FM - 1; i >= 0; i--) this.free.push(i); this.fmap = new Map(); this.ghosts = []; this.tmp = new Float32Array(1600);
    this.status = "connecting"; this.tries = 0; this.closed = false; this.stats = { rtt: [], corrections: 0, corrDist: 0, selfDeaths: 0, serverDeaths: 0, packets: 0, gaps: 0, snaps: 0 };
    this.interp = INTERP; this.jit = 0; this.jitPk = 0; this.spikeT = 0; this.lastArr = 0; this.loss = 0; this.quality = "good"; this._qN = 0;
    this.age = (i) => Math.min(1, (performance.now() - this.fb[i]) / 300);
    this.ta = 0; this.boostIn = 0; this.publicIdx = 1; this.pus = []; this.mets = [];
  }
  // srv2: matchmaking. With no room named (no friend invite / shared link), the matchmaker picks a live room in the player's
  // skill bracket (decided on the server from the board). "hold" = the bracket is busy right now: ask again (with the time
  // waited) and after ~5 s the matchmaker widens to the neighbouring bracket. Any failure falls back to the old public room.
  async pick(excl) {
    const t0 = performance.now(), base = SERVER.replace(/^ws/, "http").replace(/\/ws$/, "/mm");
    for (let k = 0; k < 5 && !this.closed; k++) {
      let r = null; try { const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 5000); r = await (await fetch(base + "?pk=" + encodeURIComponent(this.o.pk || "") + "&w=" + Math.round(performance.now() - t0) + (excl ? "&x=" + encodeURIComponent(excl) : "") + (this.o.md === "t" ? "&md=t" : ""), { signal: ac.signal })).json(); clearTimeout(tm); } catch (_) { r = null; }
      if (r && r.err === "banned") { this.banned = r.u || 1; return null; }
      if (r && (r.err === "maint" || r.err === "off")) { this.blocked = { k: r.err, m: r.m || "" }; return null; } // admin2: maintenance / online switched off
      if (!r || r.err || (!r.room && !r.hold)) return null;
      if (r.hold) { this.cb.onFind && this.cb.onFind({ st: "wait", br: r.br }); await new Promise((q) => setTimeout(q, r.wait || 2500)); continue; }
      return r;
    }
    return null;
  }
  connect() {
    if (this.closed) return;
    if (!this.o.room && !this.mmRoom && this.o.pk) { // srv2: find a live room first (finding screen), then connect to it
      if (this._picking) return; this._picking = true; this.cb.onFind && this.cb.onFind({ st: "find" });
      this.pick(this._excl).then((r) => { this._picking = false; if (this.closed) return; if (this.banned) { this.cb.onFind && this.cb.onFind({ st: "ban", u: this.banned }); this.fail(); return; }
        if (this.blocked) { this.cb.onFind && this.cb.onFind({ st: "ban", u: 0 }); this.fail(); return; } // admin2
        this.mm = r; this.mmRoom = r ? r.room : "pub-" + this.publicIdx; this.cb.onFind && this.cb.onFind({ st: "found", ...(r || { room: this.mmRoom }) }); this.connect(); });
      return;
    }
    const room = this.o.room || this.mmRoom || "pub-" + this.publicIdx;
    let ws; try { ws = new WebSocket(SERVER + "?room=" + encodeURIComponent(room) + (this.o.bots === 0 ? "&bots=0" : "")); } catch (e) { this.fail(); return; }
    ws.binaryType = "arraybuffer"; this.ws = ws; this.room = room;
    const to = setTimeout(() => { if (ws.readyState !== 1) { try { ws.close(); } catch (_) {} } }, 6000);
    ws.onopen = () => { clearTimeout(to); this.tries = 0; this.status = "online"; ws.send(JSON.stringify({ t: "hello", name: this.o.name, skin: this.o.skin, v: 1, pk: this.o.pk || undefined })); /* comp1: device secret -> server-side anonymous player id */ this._pingT = setInterval(() => { if (this.quality === "poor" && (this._pk = !this._pk)) return; this.sendPing(); }, 2000); this.sendPing(); this.cb.onStatus && this.cb.onStatus("online"); };
    ws.onmessage = (e) => { try { typeof e.data === "string" ? this.onJson(JSON.parse(e.data)) : this.onBin(e.data); } catch (err) { console.warn("net msg", err); } };
    ws.onclose = (e) => {
      clearTimeout(to); clearInterval(this._pingT); if (this.closed) return;
      if (e.code === 4011 || e.code === 4012) { this.blocked = this.blocked || { k: e.reason || "kick", m: "" }; this.cb.onFind && this.cb.onFind({ st: "ban", u: 0 }); this.fail(); return; } // admin2: maintenance / kicked
      if (e.code === 4003) { this.banned = 1; this.cb.onFind && this.cb.onFind({ st: "ban", u: this.banned }); this.fail(); return; } // srv2: banned by the owner
      if (e.code === 4001 && !this.o.room && this.mmRoom && (this._fullN = (this._fullN || 0) + 1) < 4) { this._excl = this.mmRoom; this.mmRoom = ""; this.connect(); return; } // srv2: full -> ask the matchmaker again
      if (e.code === 4001 && !this.o.room && this.publicIdx < 6) { this.publicIdx++; this.connect(); return; } // room full → next public room
      this.retry();
    };
    ws.onerror = () => {};
  }
  retry() {
    this.tries++; this.status = "reconnecting"; this.cb.onStatus && this.cb.onStatus("reconnecting", this.tries);
    if (this.tries > 3 || (navigator.onLine === false)) { this.fail(); return; }
    // the old snake died with the connection; start clean after reconnecting
    this.mirrors.clear(); this.mets.length = 0; this.me = null; this.myId = 0; this.fa.fill(0); this.fmap.clear(); this.free.length = 0; for (let i = this.FM - 1; i >= 0; i--) this.free.push(i); this.clock = null;
    this.wantSpawn = true; setTimeout(() => this.connect(), [0, 500, 1500, 3000][this.tries] || 3000);
  }
  fail() { this.status = "failed"; this.closed = true; this.cb.onStatus && this.cb.onStatus("failed"); }
  close() { this.closed = true; clearInterval(this._pingT); try { this.ws && this.ws.close(1000); } catch (_) {} }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(typeof m === "string" ? m : m); }
  sendPing() { this.send(JSON.stringify({ t: "ping", c: performance.now() })); }
  spawn(name, skin) { if (name) this.o.name = name; if (skin) this.o.skin = skin; this.wantSpawn = false; this.send(JSON.stringify({ t: "spawn", seq: this.seq, name: this.o.name, skin: this.o.skin })); }

  onJson(m) {
    if (m.t === "welcome") { this.server = { room: m.room, br: m.br || "", bi: m.bi | 0, h: m.h | 0, b: m.b | 0, fb: this.mm && this.mm.fb ? this.mm.fb : "", my: this.mm ? this.mm.my : "" }; this.cb.onFind && this.cb.onFind({ st: "in", ...this.server }); this.mut = MUT = m.mu || ""; this.cb.onMut && this.cb.onMut(this.mut); this.R = m.R; this.tick = m.tick; this.setClock(m.tick);
      // land1: a territory room: a mirror of the server's cells (full map follows as a binary frame, then deltas)
      if (m.ter) { if (!this.ter || this.ter.R !== m.R) this.ter = new Terr(m.R, { cell: m.ter.cell }); this.terInfo = { n: m.ter.n | 0, end: performance.now() + (m.ter.left | 0) * 1000, pub: !!m.ter.pub }; } else { this.ter = null; this.terInfo = null; }
      for (const s of m.snakes) this.addMirror(s); if (this.ter) this.cb.onTerr && this.cb.onTerr({ ph: "on" }); this.cb.onState && this.cb.onState("welcome"); if (this.wantSpawn !== false) this.spawn(); if (m.mev) this.cb.onMev && this.cb.onMev({ ph: "now", ...m.mev }); if (m.rg) this.server.rg = m.rg; if (Number.isFinite(m.ssn)) this.cb.onSsn && this.cb.onSsn(m.ssn); /* top1: map event in progress, room region */ }
    else if (m.t === "sn") { if (m.id !== this.myId) this.addMirror(m); }
    else if (m.t === "mev") { this.cb.onMev && this.cb.onMev(m); } // top1: map event start / end
    else if (m.t === "tp") { for (const [id, dx, dy] of m.l || []) { const s = id === this.myId ? this.me : this.mirrors.get(id)?.s; if (s) this.cb.onTp && this.cb.onTp(s, dx, dy, id === this.myId); } } // top1: portal (whole body moves)
    else if (m.t === "you") {
      const s = new Snake(m.id); s.reset(m.x, m.y, m.a, m.m); s.name = this.o.name; s.skin = this.o.skin; s.avt = this.o.skin && this.o.skin.av; s.fr = this.o.skin ? this.o.skin.fr | 0 : 0; this.me = s; this.myId = m.id; this.seq = m.seq; this.seq0 = m.seq; this.batch.length = 0; this.mirrors.delete(m.id);
      this.ta = m.a; this.dead = false; this.terMe = null; /* land1: the last round result belongs to the previous life */ this.cb.onSpawnMe && this.cb.onSpawnMe(s);
    } else if (m.t === "dead") {
      if (m.id === this.myId) { if (!this.dead) { this.dead = true; this.stats.serverDeaths++; this.cb.onMyDeath(m.by, m.cause); } }
      else { const mr = this.mirrors.get(m.id); if (mr) { mr.s.alive = false; mr.deadAt = performance.now(); if (m.cause !== 5 && m.cause !== 7) this.cb.onDeath(mr, m.by, m.cause); } } // land1: 7 = territory round over (quiet exit)
      if (m.by && m.by === this.myId && m.id !== this.myId && m.cause !== 5 && m.cause !== 7) this.cb.onKill && this.cb.onKill(m.id);
    } else if (m.t === "pong") { const rtt = performance.now() - m.c; this.pings.push(rtt); if (this.pings.length > 10) this.pings.shift(); this.ping = Math.round(this.pings.reduce((a, b) => a + b, 0) / this.pings.length); this.stats.rtt.push(rtt); }
    else if (m.t === "lb") { this.lb = m.lb; this.humans = m.humans; this.bt = m.bt || null; // play2: bt = [crown bounty snake id, value]
      if (this.terInfo && Number.isFinite(m.rl)) { const e = performance.now() + m.rl * 1000; if (Math.abs(e - this.terInfo.end) > 1500) this.terInfo.end = e; } } // land1: round clock
    else if (m.t === "tsl") { if (this.ter && Array.isArray(m.l)) for (const [sl, id] of m.l) this.ter.mapSlot(sl | 0, id | 0); } // land1: slot <-> snake
    else if (m.t === "trd") { if (this.terInfo) { this.terInfo.n = m.n | 0; this.terInfo.end = performance.now() + (m.left | 0) * 1000; } this.cb.onTerr && this.cb.onTerr({ ph: "round", n: m.n | 0 }); }
    else if (m.t === "tend") { this.terEnd = m; this.cb.onTerr && this.cb.onTerr({ ph: "end", ...m }); }
    else if (m.t === "tme") { this.terMe = m; }
    else if (m.t === "mut") { this.mut = MUT = m.k || ""; this.cb.onMut && this.cb.onMut(this.mut); }
    else if (m.t === "bty") { this.cb.onBounty && this.cb.onBounty(m); }
    else if (m.t === "uid") { const mr = this.mirrors.get(m.id); if (mr && /^\d{1,7}$/.test(m.u || "")) mr.s.uid = m.u; } // srv1
    else if (m.t === "myid") { this.myUid = m.u; }
    else if (m.t === "ban") { this.banned = m.u || 1; }
    else if (m.t === "kick") { this.blocked = { k: m.k || "kick", m: m.m || "" }; } // admin2
    else if (m.t === "full") {}
    else if (m.t === "tro" || m.t === "tro0") { this.cb.onTrophy && this.cb.onTrophy(m); } // comp1: server-decided trophies
    // power-ups (server v2): field list, spawns, pickups (+ who got frozen), shield breaks
    else if (m.t === "pus") this.pus = m.l.map(([id, k, x, y]) => ({ id, k, x, y }));
    else if (m.t === "pu+") { for (const [id, k, x, y] of m.l) this.pus.push({ id, k, x, y }); }
    else if (m.t === "pu-") {
      for (const [id, by, k, hit] of m.l) {
        const i = this.pus.findIndex((p) => p.id === id); const p = i >= 0 ? this.pus.splice(i, 1)[0] : { id, k, x: 0, y: 0 }; if (!by) continue;
        const sn = by === this.myId ? this.me : this.mirrors.get(by)?.s; if (!sn) continue;
        if (PU_DUR[k] > 0) puGive(sn, k); // timed kinds (incl. dash / invisible / giant) on the taker, me or a mirror
        if (this.me && hit.includes(this.myId)) this.me.slow = PU_DUR[PU.FREEZE];
        for (const id2 of hit) { const o = this.mirrors.get(id2); if (o) o.s.slow = PU_DUR[PU.FREEZE]; }
        this.cb.onPu && this.cb.onPu(sn, k, hit, p);
      }
    } else if (m.t === "evt") { // arena events (server v3): rain / meteor / bounty start, claim, end
      if (m.k === "bounty") { const b = m.id === this.myId ? this.me : this.mirrors.get(m.id)?.s; if (b) b.bounty = m.ph === "start"; }
      this.cb.onEvt && this.cb.onEvt(m);
    } else if (m.t === "met") { for (const [id, x, y, r, t, T] of m.l) { const M = { id, x, y, r, t, T }; this.mets.push(M); this.cb.onMeteor && this.cb.onMeteor(M); } }
    else if (m.t === "emo") { const sn = m.id === this.myId ? this.me : this.mirrors.get(m.id)?.s; if (sn && m.e >= 0 && m.e <= 5) { sn.emo = m.e; sn.emoT = performance.now(); } }
    else if (m.t === "sh") { const sn = m.id === this.myId ? this.me : this.mirrors.get(m.id)?.s; if (sn) { if (sn.pu[1] > 0 || sn !== this.me) { sn.pu[1] = 0; sn.inv = 1.2; this.cb.onShield && this.cb.onShield(sn); } } }
  }
  addMirror(m) {
    const s = new Snake(m.id); s.n = 0; s.h = 0; s.alive = true; s.name = m.name; s.skin = m.skin; s.bot = !!m.bot; s.avt = m.skin && m.skin.av; s.fr = m.skin ? m.skin.fr | 0 : 0; s.setMass(m.m); s.a = m.a || 0; if (Number.isFinite(m.tr) && m.tr >= 0) s.tr = m.tr; // comp1: league from the server
    if (typeof m.u === "string" && /^\d{1,7}$/.test(m.u)) s.uid = m.u; // srv1: public player id (player card)
    for (let i = 0; i < m.path.length; i += 2) s.push(m.path[i], m.path[i + 1]);
    s.x = m.path[m.path.length - 2]; s.y = m.path[m.path.length - 1];
    const mr = { s, lastTick: m.tick, boost: 0, deadAt: 0 }; this.mirrors.set(m.id, mr); this.cb.onNewSnake && this.cb.onNewSnake(mr);
  }
  setClock(tick) { this.clock = { base: tick, t: performance.now() }; }
  estTick() { return this.clock ? this.clock.base + (performance.now() - this.clock.t) / (DT * 1000) : 0; }
  allocFood(fid, x, y, v, c, fresh) { const i = this.free.pop(); if (i === undefined) return; this.fx[i] = x; this.fy[i] = y; this.fv[i] = v; this.fc[i] = c; this.fa[i] = 1; this.fb[i] = fresh ? performance.now() : 0; this.fmap.set(fid, i); }
  onBin(buf) {
    const v = new DataView(buf), type = v.getUint8(0);
    if (type === 4 || type === 5) { if (this.ter) { if (type === 4) this.ter.applyFull(buf); else this.ter.applyDelta(buf); } return; } // land1: territory cells
    if (type === 3) { const n = v.getUint16(1, true); let o = 3; for (let k = 0; k < n; k++) { this.allocFood(v.getUint16(o, true), v.getFloat32(o + 2, true), v.getFloat32(o + 6, true), v.getUint8(o + 10) / 10, v.getUint8(o + 11), false); o += 12; } return; }
    if (type !== 1) return;
    this.stats.packets++;
    const tick = v.getUint32(1, true); if (this.tick && tick !== this.tick + 1) this.stats.gaps++;
    { // perf2: jitter = how late this snapshot is versus the server's tick spacing; loss = share of skipped ticks (EWMA)
      const now = performance.now(), dTick = this.tick ? tick - this.tick : 1;
      if (this.lastArr && dTick > 0 && dTick < 30) { const late = Math.abs(now - this.lastArr - dTick * DT * 1000); this.jit += (late - this.jit) * 0.1; this.loss += ((dTick > 1 ? (dTick - 1) / dTick : 0) - this.loss) * 0.05;
        const L = this.lateR || (this.lateR = new Float32Array(90)), S2 = this.lateS || (this.lateS = new Float32Array(90)); L[this.lateI = ((this.lateI | 0) + 1) % 90] = late; this.lateN = Math.min(90, (this.lateN | 0) + 1);
        if (this.lateI % 10 === 0 && this.lateN >= 20) { S2.set(L); S2.sort(); const p95 = S2[90 - Math.max(1, Math.round(this.lateN * 0.05))]; if (p95 > this.jitPk + 4) this.spikeT = now; this.jitPk = p95; } } // ~3 s window, p95 lateness
      this.lastArr = now; }
    this.tick = tick;
    // clock: snap on big drift, otherwise ease toward the newest tick so interpolation never stutters
    const est = this.estTick(); if (!this.clock || Math.abs(est - tick) > 4) this.setClock(tick); else this.clock.base += (tick - est) * 0.08;
    const ack = v.getUint16(5, true), extra = v.getUint8(7), n = v.getUint8(24); let o = 25;
    for (let k = 0; k < n; k++) {
      const id = v.getUint16(o, true), x = v.getFloat32(o + 2, true), y = v.getFloat32(o + 6, true), m = v.getUint16(o + 10, true), fl = v.getUint8(o + 12); o += 13;
      if (id === this.myId && this.me) { this.srvMass = m; continue; }
      const mr = this.mirrors.get(id); if (!mr || !mr.s.alive) continue;
      const s = mr.s; const gap = tick - mr.lastTick; // fill a missed tick by repeating, keeps sample index == tick
      for (let g = 1; g < gap && g < 4; g++) s.push(x, y);
      s.push(x, y); s.x = x; s.y = y; if (Math.abs(s.m - m) > 0.5) s.setMass(m); mr.lastTick = tick; mr.boost = fl & 1;
    }
    const ne = v.getUint16(o, true); o += 2;
    for (let k = 0; k < ne; k++) {
      const fid = v.getUint16(o, true), by = v.getUint16(o + 2, true); o += 4; const i = this.fmap.get(fid); if (i === undefined) continue;
      this.fmap.delete(fid); this.fa[i] = 0; this.free.push(i);
      const eater = by === this.myId ? this.me : this.mirrors.get(by)?.s;
      if (eater) { if (this.ghosts.length < 120) this.ghosts.push({ x: this.fx[i], y: this.fy[i], tx: eater.x, ty: eater.y, t: 0, r: 0.22 + Math.sqrt(this.fv[i]) * 0.16, v: this.fv[i], c: this.fc[i], e: eater }); this.cb.onEat(by === this.myId, this.fx[i], this.fy[i], this.fv[i], this.fc[i]); }
    }
    const ns = v.getUint16(o, true); o += 2;
    for (let k = 0; k < ns; k++) { this.allocFood(v.getUint16(o, true), v.getFloat32(o + 2, true), v.getFloat32(o + 6, true), v.getUint8(o + 10) / 10, v.getUint8(o + 11), true); o += 12; }
    // own snake: rebase on the server state at `ack` (+extra server-only steps) and replay the inputs it has not applied yet
    if (this.me && !this.dead && extra !== 255) {
      const s = this.me, sx = v.getFloat32(8, true), sy = v.getFloat32(12, true), sa = v.getFloat32(16, true), sav = v.getFloat32(20, true);
      const pending = (this.seq - (ack === 0xffff ? this.seq0 : ack)) & 0xffff;
      if (pending < 120) {
        const px = s.x, py = s.y, pa = s.a, pav = s.av, h0 = s.h, n0 = s.n, pm = s.m; if (this.srvMass) s.setMass(this.srvMass);
        s.h = (s.h - pending) & MASK; s.n = Math.max(2, s.n - pending); s.x = sx; s.y = sy; s.a = sa; s.av = sav; s.px[s.h] = sx; s.py[s.h] = sy;
        for (let q = pending - 1; q >= 0; q--) { const sq = (this.seq - q) & 255; s.ta = this.hist[sq * 2]; s.boost = this.hist[sq * 2 + 1]; predict(s, DT); }
        const err = Math.hypot(s.x - px, s.y - py);
        if (err < 0.01) { s.h = h0; s.n = n0; s.x = px; s.y = py; s.a = pa; s.av = pav; if (Math.abs(s.m - pm) < 0.3) s.setMass(pm); } // tiny float noise: keep the smooth local path
        else { this.stats.corrections++; this.stats.corrDist += err; if (this.debug) this.debug.push([tick, pending, extra, +err.toFixed(3), +this.me.m.toFixed(1), this.boostIn]); if (err < 10) { this.vox = (this.vox || 0) + px - s.x; this.voy = (this.voy || 0) + py - s.y; const m = Math.hypot(this.vox, this.voy); if (m > 8) { this.vox *= 8 / m; this.voy *= 8 / m; } } } // visual offset decays, so a correction never pops (perf2: up to 10 units, spread longer when large)
        s.ta = this.ta; s.boost = this.boostIn;
      }
    }
  }
  setInput(ta, boost) { this.ta = ta; this.boostIn = boost ? 1 : 0; }
  sendEmo(e) { this.send(JSON.stringify({ t: "emo", e })); }
  // fixed 30 Hz prediction step for the own snake + local death check against what the player sees
  update(dt) {
    this.acc += dt; let steps = 0;
    while (this.acc >= DT && steps < 5) {
      this.acc -= DT; steps++;
      const s = this.me; if (!s || this.dead) continue;
      this.seq = (this.seq + 1) & 0xffff; const q = Math.round(((this.ta + Math.PI) / (Math.PI * 2)) * 65536) & 0xffff, taQ = (q / 65536) * Math.PI * 2 - Math.PI;
      this.hist[(this.seq & 255) * 2] = taQ; this.hist[(this.seq & 255) * 2 + 1] = this.boostIn;
      puTick(s, DT);
      s.ta = taQ; s.boost = this.boostIn; this.prevX = s.x; this.prevY = s.y; predict(s, DT);
      this.batch.push(this.seq, q, this.boostIn);
      if (this.batch.length >= (this.quality === "poor" ? 9 : 6)) this.flush(); // perf3: weak link -> 3 inputs per packet (10 packets/s instead of 15); the server still applies one per tick
      // instant death: head vs bodies exactly as drawn this frame, and the wall
      this.prepareOthers();
      let hit = s.inv > 0 || s.ph > 0 ? 0 : s.pu[7] > 0 ? 0 : Sim.hitTest(s.x, s.y, s.r, this._others, this.tmp, s, this.tmp2 || (this.tmp2 = new Float32Array(1200))); // noself1: own body never kills (me is skipped); head-on = only the deeper head dies
      if (hit && Sim.mutual) hit = 0; // noself1: a mutual head-on is left to the server (authoritative), which kills exactly one of the two; a local report could race it into a double death
      if (hit && s.pu[1] > 0) { s.pu[1] = 0; s.inv = 1.2; hit = 0; this.cb.onShield && this.cb.onShield(s); } // shield: the server sees the same touch and spends it too
      const wall = s.x * s.x + s.y * s.y > (this.R - s.r * 0.6) ** 2;
      if (hit || wall) { this.dead = true; this.stats.selfDeaths++; this.send(JSON.stringify({ t: "die", hit: hit || 0, seq: this.seq })); this.flush(); this.cb.onMyDeath(hit, hit ? 3 : 1, true); }
    }
    if (steps >= 5) this.acc = 0;
    if (this.vox || this.voy) { const m = Math.abs(this.vox) + Math.abs(this.voy), k = Math.exp(-dt * (m < 0.6 ? 12 : m < 3 ? 8 : 5)); this.vox *= k; this.voy *= k; if (m < 0.002) this.vox = this.voy = 0; }
    { // perf2: interpolation delay governor (see interpTarget)
      const now = performance.now(), tgt = interpTarget(Math.max(this.jit * 1.5, this.jitPk), this.loss);
      if (tgt > this.interp) this.interp = Math.min(tgt, this.interp + dt * 6); else if (now - this.spikeT > 3000) this.interp = Math.max(tgt, this.interp - dt * 0.25);
      if (!this._qT || now - this._qT > 1000) { this._qT = now; const nq = netQuality(this.ping || 0, this.jit, this.loss); if (nq === this.quality) this._qN = 0; else if (++this._qN >= (nq === "poor" ? 2 : 3)) { this.quality = nq; this._qN = 0; } } } // perf3: hysteresis, 2 s to drop, 3 s to rise (no flicker)
    const now = performance.now();
    for (const [id, mr] of this.mirrors) if (!mr.s.alive && now - mr.deadAt > 600) this.mirrors.delete(id);
    for (const mr of this.mirrors.values()) puTick(mr.s, dt);
    for (let i = this.mets.length - 1; i >= 0; i--) { const M = this.mets[i]; M.t -= dt; if (M.t <= 0) { this.mets.splice(i, 1); this.cb.onImpact && this.cb.onImpact(M.x, M.y, M.r); } }
    for (let i = this.ghosts.length - 1; i >= 0; i--) { const g = this.ghosts[i]; g.t += dt * 7; g.tx = g.e.x; g.ty = g.e.y; if (g.t >= 1) this.ghosts.splice(i, 1); }
  }
  flush() { if (!this.batch.length) return; const n = this.batch.length / 3, b = new ArrayBuffer(2 + n * 5), v = new DataView(b); v.setUint8(0, 2); v.setUint8(1, n); for (let k = 0; k < n; k++) { v.setUint16(2 + k * 5, this.batch[k * 3], true); v.setUint16(4 + k * 5, this.batch[k * 3 + 1], true); v.setUint8(6 + k * 5, this.batch[k * 3 + 2]); } this.send(b); this.batch.length = 0; }
  prepareOthers() {
    const rt = this.estTick() - this.interp, fl = Math.floor(rt), fr = rt - fl; const out = this._others || (this._others = []); out.length = 0;
    for (const mr of this.mirrors.values()) { const s = mr.s; let o = mr.lastTick - fl, f = fr; if (o < 1) { o = 0; f = 0; } if (o > s.n - 3) o = s.n - 3; s._ro = o; s._rf = f; if (s.alive) out.push(s); }
    return out;
  }
  get alpha() { return Math.min(1, this.acc / DT); }
}
