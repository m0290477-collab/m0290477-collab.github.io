// Game loop, modes, offline backend, effects, HUD, auto-quality. Renderer-agnostic (3D or 2D fallback).
import { Sim, C, BOT_NAMES } from "./sim.js";
import { compileSkin, SKINS, FLAGS, NAME_COLORS, primaryColor } from "./skins.js";
import { FOOD_COLORS, FOOD_COLORS_CB, WORLDS } from "./worlds.js";
import { NetBackend } from "./net.js";
import { t, fmtNum } from "./i18n.js";
import { haptic } from "./audio.js";

const toLin = (v) => v * v * (0.7 + 0.3 * v);
const hexLin = (h) => { const n = parseInt(h.slice(1), 16); return [toLin((n >> 16 & 255) / 255), toLin((n >> 8 & 255) / 255), toLin((n & 255) / 255)]; };
const MODES = {
  classic: { bots: 15, R: 130 }, time: { bots: 14, R: 115, dur: 180 }, survival: { bots: 8, R: 120 }, zen: { bots: 8, R: 120 },
};
const skinCache = new Map();
export function skinFn(d) { const k = JSON.stringify(d); let f = skinCache.get(k); if (!f) { f = compileSkin(d); skinCache.set(k, f); if (skinCache.size > 300) skinCache.delete(skinCache.keys().next().value); } return f; }

// ---------- offline backend: the shared sim at 60 Hz, bots, player ----------
class LocalBackend {
  constructor(mode, opts, cb) {
    this.mode = mode; this.cb = cb; this.online = false; const M = MODES[mode];
    this.sim = new Sim({ dt: 1 / 60, R: M.R, seed: opts.seed, walls: true, diff: opts.diff });
    this.sim.diff = opts.diff; this.R = M.R; this.dt = 1 / 60; this.acc = 0; this.opts = opts; this.botSeq = 0;
    for (let i = 0; i < M.bots; i++) this.addBot();
    this.me = null; this.dead = false; this.wave = 1; this.ghosts = [];
    this.FM = this.sim.FM; this.fx = this.sim.fx; this.fy = this.sim.fy; this.fv = this.sim.fv; this.fc = this.sim.fc; this.fa = this.sim.fa;
    this.age = (i) => (this.sim.fBorn[i] === 0 ? 1 : Math.min(1, (this.sim.tick - this.sim.fBorn[i]) / 18));
  }
  addBot(diff) {
    const i = this.botSeq++, r = this.sim.rand; const d = diff ?? (this.mode === "zen" ? 0 : this.opts.diff);
    const skin = r() < 0.35 ? { k: "flag", i: (r() * FLAGS.length) | 0 } : { k: "skin", i: (r() * SKINS.length) | 0 };
    return this.sim.addSnake(BOT_NAMES[(i * 7 + ((r() * 40) | 0)) % BOT_NAMES.length], { ...skin, e: (r() * 4) | 0, t: 0, n: 0 }, { bot: true, diff: d, m: C.START_M + r() * 60 });
  }
  spawn(name, skin) {
    const s = this.sim.addSnake(name, skin, { god: this.mode === "zen" }); this.me = s; this.dead = false; this.myId = s.id; this.cb.onSpawnMe && this.cb.onSpawnMe(s); return s;
  }
  setInput(ta, boost) { if (this.me) { this.me.ta = ta; this.me.boost = boost ? 1 : 0; } }
  update(dt) {
    this.acc += dt; let n = 0; const S = this.sim;
    while (this.acc >= this.dt && n < 6) {
      this.acc -= this.dt; n++;
      S.step(null);
      for (let i = 0; i < S.evEat.length; i += 2) {
        const fi = S.evEat[i], by = S.byId.get(S.evEat[i + 1]);
        if (by && this.ghosts.length < 150) this.ghosts.push({ x: S.fx[fi], y: S.fy[fi], tx: by.x, ty: by.y, t: 0, r: 0.22 + Math.sqrt(S.fv[fi]) * 0.16, c: S.fc[fi], e: by });
        if (by) this.cb.onEat(by === this.me, S.fx[fi], S.fy[fi], S.fv[fi]);
      }
      for (let i = 0; i < S.evDie.length; i += 3) {
        const id = S.evDie[i], by = S.evDie[i + 1], cause = S.evDie[i + 2], s = S.byId.get(id); if (!s) continue; s.deadAt = performance.now();
        if (s === this.me) { if (!this.dead) { this.dead = true; this.cb.onMyDeath(by, cause, true); } }
        else this.cb.onDeath({ s }, by, cause);
        if (by && this.me && by === this.me.id && s !== this.me) this.cb.onKill(id);
      }
      S.drain();
    }
    if (n >= 6) this.acc = 0;
    // corpses fade out, bots come back
    const now = performance.now();
    for (let i = S.snakes.length - 1; i >= 0; i--) { const s = S.snakes[i]; if (!s.alive && now - s.deadAt > 600 && s !== this.me) { S.removeSnake(s); if (s.bot) this.pendingBots = (this.pendingBots || 0) + 1; } }
    if (this.pendingBots && S.tick % 90 === 0) { this.pendingBots--; this.addBot(this.mode === "survival" ? Math.min(3, ((this.wave / 3) | 0) + 1) : undefined); }
    for (let i = this.ghosts.length - 1; i >= 0; i--) { const g = this.ghosts[i]; g.t += dt * 7; g.tx = g.e.x; g.ty = g.e.y; if (g.t >= 1) this.ghosts.splice(i, 1); }
  }
  get alpha() { return this.acc / this.dt; }
  others() { return this.sim.snakes; }
  close() {}
}

export class Game {
  constructor(app) {
    this.app = app; this.r = null; this.running = false; this.paused = false; this.view = { snakes: [], food: null, cam: { x: 0, y: 0, zoom: 1 }, t: 0, dt: 0, ghosts: null, foodPal: null, foodPalCss: null };
    this.entries = new Map(); this.ft = new Float32Array(240); this.fi = 0; this.fpsShown = 0; this.lastFrame = 0; this.qWin = []; this.attract = null; this.t = 0;
    this.hud = app.hud; this._loop = (ts) => this.loop(ts); this.raf = 0; this.goodWins = 0; this.autoToasted = false; this.camX = 0; this.camY = 0;
  }
  setRenderer(r) { this.r = r; }
  palettes() { const P = this.app.store.settings.cb ? FOOD_COLORS_CB : FOOD_COLORS; this.view.foodPal = P.map(hexLin); this.view.foodPalCss = P; }
  startLoop() { if (!this.raf) this.raf = requestAnimationFrame(this._loop); }

  // ---------- attract mode behind the menus: bots playing, slow orbit ----------
  startAttract(world) {
    this.stopMatch(); this.palettes();
    this.attract = new LocalBackend("classic", { diff: 2, seed: 1234 }, { onEat() {}, onDeath: () => {}, onMyDeath() {}, onKill() {} });
    this.backend = this.attract; this.mode = "attract"; this.world = world; this.r.setArena(this.attract.R); this.r.setWorld(world); this.orbit = 0; this.running = true; this.startLoop();
  }

  // ---------- matches ----------
  start(cfg) {
    const A = this.app, S = A.store, p = S.p; this.palettes();
    this.cfg = cfg; this.mode = cfg.mode; this.world = cfg.world; this.attract = null;
    this.stats = { kills: 0, food: 0, boost: 0, life: 0, best: 0, rankBest: 99, t0: performance.now(), lifeT0: performance.now(), deaths: 0, score: 0, timeLeft: 0, wave: 1 };
    this.ended = false; this.paused = false; this.deathT = 0; this.spectate = null; this.feed = []; this.lastLb = 0;
    const skin = this.mySkin();
    const cb = {
      onEat: (me, x, y, v) => this.onEat(me, x, y, v), onDeath: (mr, by, cause) => this.onDeath(mr, by, cause), onMyDeath: (by, cause) => this.onMyDeath(by, cause),
      onKill: (id) => this.onKill(id), onSpawnMe: (s) => { this.camX = s.x; this.camY = s.y; this.view.cam.snap = true; },
      onStatus: (st, n) => this.onNet(st, n),
    };
    if (cfg.mode === "online") {
      this.backend = new NetBackend({ room: cfg.room, name: p.name, skin, cb, bots: cfg.bots }); this.backend.connect(); this.hud.net(t("connecting"));
    } else {
      this.backend = new LocalBackend(cfg.mode, { diff: cfg.diff, seed: (Math.random() * 1e9) | 0 }, cb); this.backend.spawn(p.name, skin);
      if (cfg.mode === "time") this.stats.timeLeft = MODES.time.dur;
      this.hud.net("");
    }
    this.r.setArena(this.backend.R || C.R); this.r.setWorld(cfg.world);
    A.audio.music(true, cfg.world); A.input.reset(); A.input.enabled = true; this.running = true; this.hud.show(cfg.mode); this.startLoop();
    this.countdown = cfg.mode === "online" ? 0 : 2.4; this.cdShown = -1; this.timeScale = 1; this.slowUntil = 0;
    this.r.shakeA = 0;
  }
  mySkin() { const p = this.app.store.p; const sk = p.skin.k === "custom" ? { k: "custom", p: p.custom.p, c: p.custom.c } : { k: p.skin.k, i: p.skin.i }; return { ...sk, e: p.eye, t: p.trail, n: p.nc }; }
  stopMatch() { if (this.backend && this.backend.close) this.backend.close(); this.backend = null; this.app.input && (this.app.input.enabled = false); this.app.audio.boost(false); }
  pause(on) {
    if (!this.mode || this.mode === "attract" || this.ended) return;
    this.paused = on; this.app.audio.boost(false); this.app.input.reset();
    if (on) this.app.ui.showPause(this.mode === "online"); else this.app.ui.hidePause();
  }
  restart() { const c = this.cfg; this.stopMatch(); this.start(c); }
  // results → "Play again": online keeps the connection and respawns in the same room
  again() {
    const b = this.backend;
    if (this.mode === "online" && b && b.status === "online" && !b.closed) {
      const p = this.app.store.p; this.ended = false; this.endAt = 0; this.spectate = null; this.killer = null;
      this.stats = { kills: 0, food: 0, boost: 0, life: 0, best: 0, rankBest: 99, t0: performance.now(), lifeT0: performance.now(), deaths: 0, score: 0, timeLeft: 0, wave: 1 };
      b.spawn(p.name, this.mySkin()); this.app.input.reset(); this.app.input.enabled = true; this.hud.show("online"); return;
    }
    this.restart();
  }

  // ---------- events ----------
  onEat(me, x, y, v) {
    if (!me) return; this.stats.food++; const A = this.app;
    if (v >= 4) { A.audio.play("big"); haptic.tap(8); this.r.burst(x, y, [1, 0.9, 0.5], 8, 3, 0.5, 0.4); this.bigAcc = (this.bigAcc || 0) + v; clearTimeout(this.bigT); this.bigT = setTimeout(() => { const me2 = this.backend && this.backend.me; if (me2 && this.bigAcc >= 4) this.hud.popup("+" + Math.round(this.bigAcc), "mass", this.r.project(me2.x, me2.y, 2)); this.bigAcc = 0; }, 140); } else A.audio.play("eat");
  }
  onDeath(mr, by, cause) {
    const s = mr.s; const f = skinFn(s.skin || {}), col = [0, 0, 0]; f(2, 20, 0, col);
    const lin = [toLin(col[0]), toLin(col[1]), toLin(col[2])];
    const me = this.backend && this.backend.me; const near = me && Math.hypot(s.x - me.x, s.y - me.y) < 40;
    if (near) { this.r.shatter(s, f, this.app.store.settings.juice ? 60 : 25); if (this.app.store.settings.juice) this.r.ring(s.x, s.y, lin, 7); }
    if (by && by !== (me && me.id)) { const k = this.findSnake(by); if (k) this.pushFeed(k.name, s.name); }
  }
  onKill(id) {
    this.stats.kills++; const A = this.app; A.audio.play("kill"); haptic.pattern([15, 40, 25]); this.r.shake(0.6);
    const v = this.findSnake(id); this.pushFeed(t("you"), v ? v.name : "?", true);
    const pos = v ? this.r.project(v.x, v.y, 1.5) : null; this.hud.popup("⚔ KO", "kill", pos);
  }
  onMyDeath(by, cause) {
    const A = this.app, me = this.backend.me; if (!me) return;
    this.stats.deaths++; const life = (performance.now() - this.stats.lifeT0) / 1000; this.stats.life = Math.max(this.stats.life, life);
    A.audio.play("die"); A.audio.boost(false); haptic.pattern([40, 30, 80]); this.r.shake(1.1);
    const f = skinFn(this.mySkin()), col = [0, 0, 0]; f(2, 20, 0, col); const lin = [toLin(col[0]), toLin(col[1]), toLin(col[2])];
    this.r.shatter(me, f, 90); this.r.burst(me.x, me.y, lin, 30, 11, 1.2, 0.7, 6); this.r.ring(me.x, me.y, [1, 1, 1], 10); if (!A.store.settings.reduceMotion) this.slowUntil = performance.now() + 450; this.hud.flash();
    me.alive = false; me.deadAt = performance.now(); this.deathT = performance.now(); this.killer = by ? this.findSnake(by) : null; this.deathCause = cause;
    this.spectate = this.killer; A.input.enabled = false; A.input.reset();
    if (this.mode === "time" && this.stats.timeLeft > 2) { // Time Attack: back in after a short breath; mass starts over
      this.respawnAt = performance.now() + 1600; this.hud.banner(by && this.killer ? t("killedBy", { n: this.killer.name }) : t("hitWall"), 1500);
    } else { this.endAt = performance.now() + 1500; this.hud.banner(by && this.killer ? t("killedBy", { n: this.killer.name }) : t("hitWall"), 1500); }
  }
  onNet(st, n) {
    const A = this.app;
    if (st === "online") { this.hud.net(""); }
    else if (st === "reconnecting") { this.hud.net(t("reconnecting", { n })); A.audio.play("warn"); }
    else if (st === "failed") {
      if (this.mode !== "online" || this.ended) return;
      A.ui.toast(t("offlineFallback"), "warn");
      const cfg = { ...this.cfg, mode: "classic", fellBack: true }; this.stopMatch(); this.start(cfg);
    }
  }
  findSnake(id) { const b = this.backend; if (!b) return null; if (b.sim) return b.sim.byId.get(id); const m = b.mirrors.get(id); return m ? m.s : (b.me && b.me.id === id ? b.me : null); }
  pushFeed(a, b, mine) { this.feed.unshift({ a, b, mine, t: performance.now() }); if (this.feed.length > 4) this.feed.pop(); this.hud.feed(this.feed); }

  // ---------- end of a match ----------
  finish(reason) {
    if (this.ended) return; this.ended = true; const A = this.app, S = A.store, p = S.p, st = this.stats, me = this.backend && this.backend.me;
    A.input.enabled = false; A.audio.boost(false);
    const dur = (performance.now() - st.t0) / 1000; const mass = Math.round(me ? (reason === "time" ? me.m : st.best) : st.best);
    let score = mass; if (this.mode === "survival") score = Math.round(st.life * 10 + st.best); if (this.mode === "time") score = Math.round(st.endMass ?? mass);
    const diffMul = [0.75, 1, 1.25, 1.5][this.cfg.diff ?? 1] * (this.mode === "online" ? 1.3 : 1) * (this.mode === "zen" ? 0.4 : 1);
    const xp = Math.round((st.best / 8 + st.kills * 30 + Math.min(dur, 900) / 4 + (this.mode === "survival" ? st.wave * 25 : 0)) * diffMul) + 10;
    const coins = Math.round(xp / 4);
    const P = p.stats; P.games++; P.kills += st.kills; P.deaths += st.deaths; P.food += st.food; P.best = Math.max(P.best, Math.round(st.best)); P.time += Math.round(dur); P.life = Math.max(P.life, Math.round(st.life)); P.boost += Math.round(st.boost);
    if (this.mode === "online") P.online++; if (this.mode === "zen") P.zen += Math.round(dur); if (this.mode === "survival") P.wave = Math.max(P.wave, st.wave); if (this.mode === "time") P.tbest = Math.max(P.tbest, score);
    if (st.rankBest === 1 && this.mode !== "zen") P.top++;
    p.coins += coins; const lv = S.addXp(xp);
    const bestKey = this.mode === "online" ? "online" : this.mode; const pos = S.addBest(bestKey, { s: score, k: st.kills, d: Date.now(), w: this.world, m: Math.round(st.best) });
    const missions = S.missionProgress({ food: st.food, kills: st.kills, mass: st.best, life: st.life, boost: st.boost, online: this.mode === "online" });
    const ach = S.checkAch(); S.save();
    const title = reason === "time" ? t("timeUp") : this.mode === "zen" ? t("zenDone") : t("gameOver");
    const sub = this.killer ? t("killedBy", { n: this.killer.name }) : this.deathCause === 1 ? t("hitWall") : "";
    A.ui.showResults({ title, sub, score, mass: Math.round(st.best), kills: st.kills, rank: st.rankBest < 99 ? st.rankBest : "—", time: dur, xp, coins: coins + lv.coins, lv, newBest: pos === 0 && score > 0, missions, ach, mode: this.mode, wave: st.wave });
    if (lv.up) A.audio.play("level"); else if (ach.length) A.audio.play("ach");
    // keep the world running behind the results
  }

  // ---------- frame ----------
  loop(ts) {
    this.raf = requestAnimationFrame(this._loop);
    const A = this.app, set = A.store.settings;
    const cap = set.fpsCap; if (cap && this.lastFrame && ts - this.lastFrame < 1000 / cap - 2.5) return;
    const dt = this.lastFrame ? Math.min(0.1, (ts - this.lastFrame) / 1000) : 1 / 60; this.lastFrame = ts; this.t += dt;
    const c0 = performance.now();
    try { this.tick(dt, ts); } catch (e) { console.error(e); A.ui.toast(t("oops"), "warn"); if (this.mode !== "attract") { this.ended = true; this.stopMatch(); A.ui.goLobby(); } }
    if (!this.cpu) this.cpu = new Float32Array(1024); this.cpu[this.cpuI = ((this.cpuI || 0) + 1) & 1023] = performance.now() - c0; // CPU ms per frame (perf telemetry)
  }
  tick(dt, ts) {
    const A = this.app, set = A.store.settings, b = this.backend; if (!b || !this.r) return;
    // frame-time stats (FPS readout + auto quality)
    this.ft[this.fi++ % this.ft.length] = dt * 1000;
    if (set.showFps && ts - this.fpsShown > 500) { this.fpsShown = ts; const n = Math.min(this.fi, 60); let s = 0; for (let k = 1; k <= n; k++) s += this.ft[(this.fi - k + this.ft.length) % this.ft.length]; this.hud.fps(Math.round(1000 / (s / n))); }
    if (set.quality === "auto" && this.fi % 120 === 0 && this.fi > 240 && !document.hidden) this.autoQuality();
    const me = b.me;
    if (this.mode !== "attract" && !this.paused && !this.ended && me && me.alive) {
      const ang = A.input.poll(me.ta ?? me.a, dt); let boost = A.input.boost;
      if (ang !== null && ang !== undefined) b.setInput(ang, boost); else b.setInput(me.ta ?? me.a, boost);
      const boosting = !!boost && me.m > C.MIN_BOOST_M; A.audio.boost(boosting); if (boosting) this.stats.boost += dt;
      this.stats.best = Math.max(this.stats.best, me.m);
    }
    // countdown: 3-2-1-GO with the world frozen and the camera flying in
    if (this.countdown > 0 && !this.paused) {
      this.countdown -= dt; const n = Math.ceil(this.countdown / 0.8);
      if (n !== this.cdShown) { this.cdShown = n; if (n > 0) { this.hud.banner(String(n), 700); A.audio.play("count"); } else { this.hud.banner(t("go") || "GO!", 700); A.audio.play("go"); haptic.tap(15); this.stats.t0 = this.stats.lifeT0 = performance.now(); } }
    }
    // own death: a short slow-motion beat
    this.timeScale = performance.now() < this.slowUntil ? 0.35 : 1;
    if (!(this.paused && this.mode !== "online") && !(this.countdown > 0)) b.update(dt * this.timeScale);
    if (this.mode === "attract") { const S = b.sim; if (S.snakes.filter((s) => s.alive).length < 14) b.addBot(2); }
    // mode rules
    if (this.mode !== "attract" && !this.ended && !this.paused && !(this.countdown > 0)) this.rules(dt);
    this.build(dt); this.r.frame(this.view);
    if (this.mode !== "attract" && ts - this.lastLb > 250) { this.lastLb = ts; this.hudTick(); }
  }
  rules(dt) {
    const st = this.stats, b = this.backend, now = performance.now();
    if (this.mode === "time") {
      st.timeLeft -= dt; if (st.timeLeft <= 0) { st.timeLeft = 0; st.endMass = b.me && b.me.alive ? b.me.m : C.START_M; this.finish("time"); return; }
      if (this.respawnAt && now > this.respawnAt) { this.respawnAt = 0; const old = b.me; b.sim.removeSnake(old); b.spawn(this.app.store.p.name, this.mySkin()); this.app.input.enabled = true; this.spectate = null; st.lifeT0 = now; }
    }
    if (this.mode === "survival") {
      const el = (now - st.t0) / 1000, wave = 1 + Math.floor(el / 30);
      if (wave > st.wave) { st.wave = wave; b.wave = wave; this.hud.banner(t("wave", { n: wave }), 1600); this.app.audio.play("go"); const S = b.sim; S.botAggro = 1 + wave * 0.12; const add = Math.min(3, 26 - S.snakes.filter((s) => s.alive).length); for (let k = 0; k < add; k++) b.addBot(Math.min(3, 1 + ((wave - 1) / 3) | 0)); }
      st.life = Math.max(st.life, (now - st.lifeT0) / 1000);
    } else if (b.me && b.me.alive) st.life = Math.max(st.life, (now - st.lifeT0) / 1000);
    if (this.endAt && now > this.endAt) { this.endAt = 0; this.finish("death"); }
  }
  build(dt) {
    const v = this.view, b = this.backend, set = this.app.store.settings; v.t = this.t; v.dt = dt;
    const list = v.snakes; list.length = 0; const now = performance.now();
    const alpha = b.alpha;
    const add = (s, o, f, me, boost) => {
      let e = this.entries.get(s); if (!e) { e = { s }; this.entries.set(s, e); }
      const sk = s.skin || {}; e.o = o; e.f = f; e.fn = skinFn(sk); e.eye = sk.e | 0; e.trail = sk.t | 0; e.name = s.name; e.nc = NAME_COLORS[sk.n | 0] || "#fff"; e.me = me; e.boost = boost;
      e.alpha = s.alive ? 1 : Math.max(0, 1 - (now - (s.deadAt || now)) / 450); e.scale = s.alive ? 1 : 1 + (1 - e.alpha) * 0.25; e.look = s.ta; e.top = false; e.used = true; e.ox = me && b.vox ? b.vox : 0; e.oy = me && b.voy ? b.voy : 0; list.push(e);
      return e;
    };
    for (const e of this.entries.values()) e.used = false;
    if (b.sim) { for (const s of b.sim.snakes) if (s.n > 2) add(s, 1, alpha, s === b.me, s.boosting); }
    else {
      b.prepareOthers(); for (const mr of b.mirrors.values()) add(mr.s, mr.s._ro, mr.s._rf, false, mr.boost);
      if (b.me) add(b.me, 1, alpha, true, b.me.boosting);
    }
    for (const [k, e] of this.entries) if (!e.used) this.entries.delete(k);
    // top-3 always named even on low quality
    for (let q = 0; q < 3; q++) { let best = null; for (const e of list) if (!e.top && e.s.alive && (!best || e.s.m > best.s.m)) best = e; if (best) best.top = true; }
    v.food = b; v.ghosts = b.ghosts;
    // camera
    const me = b.me; let tx = this.camX, ty = this.camY, zoom = 1;
    if (this.mode === "attract") { const lead = b.sim.leaderboard(1)[0]; if (lead) { tx = lead.x * 0.3; ty = lead.y * 0.3; } this.orbit += dt * 0.05; v.cam.orbit = this.orbit; zoom = 1.9; }
    else {
      v.cam.orbit = undefined; const foc = this.spectate && this.spectate.alive ? this.spectate : me;
      if (foc) { const head = foc === me && me.alive ? lerpHead(me, alpha) : [foc.x, foc.y]; if (foc === me && b.vox) { head[0] += b.vox; head[1] += b.voy; }
        const la = (foc.boosting ? 4.2 : 2.6) * (1 + Math.max(0, foc.r - 0.6) * 0.5); this.lookX = (this.lookX || 0) + (Math.cos(foc.a) * la - (this.lookX || 0)) * Math.min(1, dt * 3); this.lookY = (this.lookY || 0) + (Math.sin(foc.a) * la - (this.lookY || 0)) * Math.min(1, dt * 3);
        tx = head[0] + this.lookX; ty = head[1] + this.lookY; zoom = 1 + Math.max(0, foc.r - 0.6) * 0.55; v.cam.boost = !!foc.boosting && foc === me; }
      if (this.countdown > 0) zoom *= 1 + Math.pow(this.countdown / 2.4, 2) * 0.9;
    }
    this.camX = tx; this.camY = ty; v.cam.x = tx; v.cam.y = ty; v.cam.zoom = zoom; if (v.cam.snap) setTimeout(() => (v.cam.snap = false), 50);
  }
  hudTick() {
    const b = this.backend, me = b.me, st = this.stats; if (!b) return;
    let all = b.sim ? b.sim.snakes.filter((s) => s.alive) : [...b.mirrors.values()].map((m) => m.s).filter((s) => s.alive);
    if (me && me.alive && !b.sim) all.push(me);
    all.sort((a, c) => c.m - a.m); const rank = me && me.alive ? all.indexOf(me) + 1 : 0; if (rank > 0) st.rankBest = Math.min(st.rankBest, rank);
    this.hud.update({ mass: me && me.alive ? me.m : 0, rank, total: all.length, top: all.slice(0, 5), me, kills: st.kills, timeLeft: this.mode === "time" ? st.timeLeft : null, wave: this.mode === "survival" ? st.wave : null, ping: b.online ? b.ping : null, humans: b.online ? b.humans : null });
    if (this.app.store.settings.minimap) this.hud.minimap(all, me, b.R || C.R, this.view.foodPalCss);
  }
  autoQuality() {
    const A = this.app, n = this.ft.length, arr = Array.from(this.ft).sort((a, c) => a - c), p90 = arr[Math.floor(n * 0.9)];
    const target = 1000 / (A.store.settings.fpsCap || 60), order = ["low", "medium", "high", "ultra"], cur = this.r.qName, i = order.indexOf(cur);
    if (p90 > target * 1.45) {
      this.goodWins = 0;
      if (i > 0) { A.applyQuality(order[i - 1]); if (!this.autoToasted) { this.autoToasted = true; A.ui.toast(t("autoLow")); } }
      else if (!this.r.is2D && p90 > 40) { A.switchRenderer("2d", true); }
      this.ft.fill(target);
    } else if (p90 < target * 1.08) { if (++this.goodWins >= 4 && i >= 0 && i < 2) { this.goodWins = 0; A.applyQuality(order[i + 1]); this.ft.fill(target); } }
    else this.goodWins = 0;
  }
}
function lerpHead(s, a) { const x1 = s.sx(1), y1 = s.sy(1); return [x1 + (s.sx(0) - x1) * a, y1 + (s.sy(0) - y1) * a]; }
export { MODES };
