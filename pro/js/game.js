// Game loop, modes, offline backend, effects, cinematics, adaptive music, HUD feed, auto-quality.
// Renderer-agnostic (3D or 2D fallback). Modes: classic, time, survival, zen, online + battle royale (storm),
// king of the hill, boss event (giant AI snake with phases), team battle.
import { Sim, C, BOT_NAMES, bodyPoints, PU, PU_COL, PU_ICON, PU_DUR } from "./sim.js?v=f1457";
import { compileSkin, SKINS, FLAGS, NAME_COLORS, primaryColor, skinFx, LEGEND } from "./skins.js?v=f1457";
import { FOOD_COLORS, FOOD_COLORS_CB, WORLDS } from "./worlds.js?v=f1457";
import { NetBackend } from "./net.js?v=f1457";
import { t, fmtNum } from "./i18n.js?v=f1457";
import { haptic } from "./audio.js?v=f1457";

const toLin = (v) => v * v * (0.7 + 0.3 * v);
const hexLin = (h) => { const n = parseInt(h.slice(1), 16); return [toLin((n >> 16 & 255) / 255), toLin((n >> 8 & 255) / 255), toLin((n & 255) / 255)]; };
export const MODES = {
  classic: { bots: 15, R: 130 }, time: { bots: 14, R: 115, dur: 180 }, survival: { bots: 8, R: 120 }, zen: { bots: 8, R: 120 },
  br: { bots: 19, R: 150, noRespawn: true }, koth: { bots: 11, R: 115, dur: 180, target: 100 }, boss: { bots: 3, R: 125, lives: 3 }, team: { bots: 13, R: 125, dur: 180, target: 25 },
};
const TEAM_COL = [[0.2, 0.55, 1.0], [1.0, 0.25, 0.3]], TEAM_CSS = ["#4da3ff", "#ff4d5e"];
const skinCache = new Map();
export function skinFn(d) { const k = JSON.stringify(d); let f = skinCache.get(k); if (!f) { f = compileSkin(d); skinCache.set(k, f); if (skinCache.size > 300) skinCache.delete(skinCache.keys().next().value); } return f; }
const BOSS_SKIN = { k: "skin", i: SKINS.findIndex((s) => s.id === "void"), e: 6, t: 0, n: 7 };

// ---------- offline backend: the shared sim at 60 Hz, bots, player ----------
class LocalBackend {
  constructor(mode, opts, cb) {
    this.mode = mode; this.cb = cb; this.online = false; const M = MODES[mode] || MODES.classic; this.M = M;
    this.sim = new Sim({ dt: 1 / 60, R: M.R, seed: opts.seed, walls: true, diff: opts.diff });
    this.sim.diff = opts.diff; this.R = M.R; this.dt = 1 / 60; this.acc = 0; this.opts = opts; this.botSeq = 0; this.teamN = [0, 0];
    if (mode === "team") this.sim.teams = true;
    for (let i = 0; i < M.bots; i++) this.addBot();
    this.me = null; this.dead = false; this.wave = 1; this.ghosts = [];
    this.FM = this.sim.FM; this.fx = this.sim.fx; this.fy = this.sim.fy; this.fv = this.sim.fv; this.fc = this.sim.fc; this.fa = this.sim.fa;
    this.age = (i) => (this.sim.fBorn[i] === 0 ? 1 : Math.min(1, (this.sim.tick - this.sim.fBorn[i]) / 18));
  }
  addBot(diff, team) {
    const i = this.botSeq++, r = this.sim.rand; const d = diff ?? (this.mode === "zen" ? 0 : this.opts.diff);
    const legend = r() < 0.12; const pool = SKINS.map((s, k) => k).filter((k) => !!SKINS[k].fx === legend);
    const skin = r() < 0.3 ? { k: "flag", i: (r() * FLAGS.length) | 0 } : { k: "skin", i: pool[(r() * pool.length) | 0] };
    const s = this.sim.addSnake(BOT_NAMES[(i * 7 + ((r() * 40) | 0)) % BOT_NAMES.length], { ...skin, e: (r() * 4) | 0, t: 0, n: 0 }, { bot: true, diff: d, m: C.START_M + r() * 60 });
    if (this.mode === "team") { s.team = team ?? (this.teamN[0] < 6 ? 0 : 1); this.teamN[s.team]++; }
    return s;
  }
  spawn(name, skin) {
    const s = this.sim.addSnake(name, skin, { god: this.mode === "zen" }); this.me = s; this.dead = false; this.myId = s.id; if (this.mode === "team") s.team = 0; this.cb.onSpawnMe && this.cb.onSpawnMe(s); return s;
  }
  setInput(ta, boost) { if (this.me) { this.me.ta = ta; this.me.boost = boost ? 1 : 0; } }
  update(dt) {
    this.acc += dt; let n = 0; const S = this.sim;
    while (this.acc >= this.dt && n < 6) {
      this.acc -= this.dt; n++;
      S.step(null);
      for (let i = 0; i < S.evEat.length; i += 2) {
        const fi = S.evEat[i], by = S.byId.get(S.evEat[i + 1]);
        if (by && this.ghosts.length < 150) this.ghosts.push({ x: S.fx[fi], y: S.fy[fi], tx: by.x, ty: by.y, t: 0, r: 0.22 + Math.sqrt(S.fv[fi]) * 0.16, c: S.fc[fi], e: by, mine: by === this.me });
        if (by) this.cb.onEat(by === this.me, S.fx[fi], S.fy[fi], S.fv[fi]);
      }
      for (let i = 0; i < S.evDie.length; i += 3) {
        const id = S.evDie[i], by = S.evDie[i + 1], cause = S.evDie[i + 2], s = S.byId.get(id); if (!s) continue; s.deadAt = performance.now();
        if (s === this.me) { if (!this.dead) { this.dead = true; this.cb.onMyDeath(by, cause, true); } }
        else this.cb.onDeath({ s }, by, cause);
        if (by && this.me && by === this.me.id && s !== this.me) this.cb.onKill(id);
        this.cb.onAnyDeath && this.cb.onAnyDeath(s, by, cause);
      }
      for (let i = 0; i < S.evPu.length; i += 3) { const p = S.evPu[i], by = S.evPu[i + 1]; if (by) this.cb.onPu && this.cb.onPu(S.byId.get(by), p.k, S.evPu[i + 2] || [], p); }
      for (let i = 0; i < S.evShield.length; i += 2) this.cb.onShield && this.cb.onShield(S.byId.get(S.evShield[i]));
      S.drain();
    }
    if (n >= 6) this.acc = 0;
    const now = performance.now();
    for (let i = S.snakes.length - 1; i >= 0; i--) { const s = S.snakes[i]; if (!s.alive && now - s.deadAt > 600 && s !== this.me) { S.removeSnake(s); if (s.bot && !s.boss && !this.M.noRespawn) { this.pendingBots = (this.pendingBots || 0) + 1; if (s.team !== undefined) { this.teamN[s.team]--; (this.pendingTeams || (this.pendingTeams = [])).push(s.team); } } } }
    if (this.pendingBots && S.tick % 90 === 0) { this.pendingBots--; const tm = this.pendingTeams && this.pendingTeams.shift(); this.addBot(this.mode === "survival" ? Math.min(3, ((this.wave / 3) | 0) + 1) : undefined, tm); }
    for (let i = this.ghosts.length - 1; i >= 0; i--) { const g = this.ghosts[i]; g.t += dt * 6; g.tx = g.e.x; g.ty = g.e.y; if (g.t >= 1) this.ghosts.splice(i, 1); }
  }
  get alpha() { return this.acc / this.dt; }
  get pus() { return this.sim.pus; }
  others() { return this.sim.snakes; }
  close() {}
}

export class Game {
  constructor(app) {
    this.app = app; this.r = null; this.running = false; this.paused = false; this.view = { snakes: [], food: null, cam: { x: 0, y: 0, zoom: 1 }, t: 0, dt: 0, ghosts: null, foodPal: null, foodPalCss: null };
    this.entries = new Map(); this.ft = new Float32Array(240); this.fi = 0; this.fpsShown = 0; this.lastFrame = 0; this.attract = null; this.t = 0;
    this.hud = app.hud; this._loop = (ts) => this.loop(ts); this.raf = 0; this.goodWins = 0; this.autoToasted = false; this.camX = 0; this.camY = 0; this.show = null;
  }
  setRenderer(r) { this.r = r; }
  palettes() { const P = this.app.store.settings.cb ? FOOD_COLORS_CB : FOOD_COLORS; this.view.foodPal = P.map(hexLin); this.view.foodPalCss = P; }
  startLoop() { if (!this.raf) this.raf = requestAnimationFrame(this._loop); }

  // ---------- attract (title flyover) and studio showcase (menus) ----------
  startAttract(world, title) {
    this.stopMatch(); this.palettes();
    this.attract = new LocalBackend("classic", { diff: 2, seed: 1234 }, { onEat() {}, onDeath: () => {}, onMyDeath() {}, onKill() {} });
    this.backend = this.attract; this.mode = "attract"; this.world = world; this.r.setArena(this.attract.R); this.r.setWorld(world); this.orbit = 0; this.titleT = title ? 0 : undefined; this.running = true; this.startLoop();
    for (let k = 0; k < 240; k++) this.attract.update(1 / 60);
  }
  startShow(world) { this.stopMatch(); this.palettes(); this.backend = null; this.mode = "show"; if (world !== undefined) { this.world = world; this.r.setWorld(world); } this.running = true; this.startLoop(); }

  // ---------- matches ----------
  start(cfg) {
    const A = this.app, S = A.store, p = S.p; this.palettes();
    this.cfg = cfg; this.mode = cfg.mode; this.world = cfg.world; this.attract = null; this.M = MODES[cfg.mode] || {};
    this.stats = { kills: 0, food: 0, boost: 0, life: 0, best: 0, rankBest: 99, t0: performance.now(), lifeT0: performance.now(), deaths: 0, score: 0, timeLeft: 0, wave: 1 };
    this.combo = 0; this.comboT = 0; this.gainAcc = 0; this.gainT = 0; this.rankShown = 99; this.massMile = 0; this.liveMs = new Set(); this.puLast = null; this.hintI = 0; this.hintT = 4; this.stats.bonus = 0; this.stats.pu = 0; this.watching = false;
    this.ended = false; this.paused = false; this.deathT = 0; this.spectate = null; this.feed = []; this.lastLb = 0; this.killcam = null; this.victory = null; this.streak = 0; this.streakT = 0; this.endAt = 0; this.respawnAt = 0;
    this.zone = null; this.hill = null; this.boss = null; this.teamScore = [0, 0]; this.kothPts = new Map(); this.lives = this.M.lives || 0; this.win = false; this.place = 0;
    const skin = this.mySkin();
    const cb = {
      onEat: (me, x, y, v) => this.onEat(me, x, y, v), onDeath: (mr, by, cause) => this.onDeath(mr, by, cause), onMyDeath: (by, cause) => this.onMyDeath(by, cause),
      onKill: (id) => this.onKill(id), onSpawnMe: (s) => { this.camX = s.x; this.camY = s.y; this.view.cam.snap = true; },
      onStatus: (st, n) => this.onNet(st, n), onAnyDeath: (s, by) => this.onAnyDeath(s, by),
      onPu: (s, k, hit, p) => this.onPu(s, k, hit, p), onShield: (s) => this.onShield(s),
    };
    if (cfg.mode === "online") {
      this.backend = new NetBackend({ room: cfg.room, name: p.name, skin, cb, bots: cfg.bots }); this.backend.connect(); this.hud.net(t("connecting"));
    } else {
      this.backend = new LocalBackend(cfg.mode, { diff: cfg.diff, seed: (Math.random() * 1e9) | 0 }, cb); this.backend.spawn(p.name, skin);
      if (cfg.mode === "time") this.stats.timeLeft = MODES.time.dur;
      if (this.M.dur && cfg.mode !== "time") this.stats.timeLeft = this.M.dur;
      this.hud.net(""); this.setupMode();
    }
    this.r.setArena(this.backend.R || C.R); this.r.setWorld(cfg.world);
    A.audio.music(true, cfg.world, false); A.audio.setIntensity(0.2); A.input.reset(); A.input.enabled = true; this.running = true; this.hud.show(cfg.mode); this.startLoop();
    this.countdown = cfg.mode === "online" ? 0 : 2.6; this.intro = cfg.mode === "online" ? 1.4 : 2.6; this.introDur = this.intro; this.cdShown = -1; this.timeScale = 1; this.slowUntil = 0;
    this.r.shakeA = 0; this.hud.modeHud(this.modeHudData());
  }
  setupMode() {
    const b = this.backend, S = b.sim, R = b.R;
    if (this.mode === "br") { this.zone = { x: 0, y: 0, r: R * 1.02, from: R * 1.02, to: R * 1.02, cx: 0, cy: 0, tx: 0, ty: 0, stage: 0, t: 0, phase: "wait", dmg: 1 }; S.zone = this.zone; this.zoneNext = 25; }
    if (this.mode === "koth") { this.hill = { x: 0, y: 0, r: 15, t: 0 }; this.moveHill(true); S.attractPt = { x: this.hill.x, y: this.hill.y, r: this.hill.r, w: 0.4 }; }
    if (this.mode === "team") { this.teamScore = [0, 0]; }
    if (this.mode === "boss") this.spawnBoss();
  }
  spawnBoss() {
    const b = this.backend, S = b.sim; const s = S.addSnake("LEVIATHAN", BOSS_SKIN, { bot: true, diff: 3, m: 2400, pos: [0, -b.R * 0.4] });
    s.rk = 1.9; s.lk = 0.62; s.setMass(2400); s.god = true; s.boss = true; s.ai.prey = b.me ? b.me.id : 0; s.vk = 0.92;
    this.boss = { s, hp: 8, max: 8, phase: 1, cores: [], hitT: 0 };
    this.hud.banner(t("bossAppears"), 2200); this.app.audio.play("roar"); this.r.shake && this.r.shake(1);
  }
  moveHill(first) { const R = this.backend.R, a = Math.random() * 6.283, d = first ? R * 0.15 : R * (0.2 + Math.random() * 0.4); this.hill.x = Math.cos(a) * d; this.hill.y = Math.sin(a) * d; this.hill.t = 0; if (this.backend.sim.attractPt) { this.backend.sim.attractPt.x = this.hill.x; this.backend.sim.attractPt.y = this.hill.y; } if (!first) { this.hud.banner(t("hillMoved"), 1400); this.app.audio.play("warn"); } }
  mySkin() { const p = this.app.store.p; const sk = p.skin.k === "custom" ? { k: "custom", p: p.custom.p, c: p.custom.c } : { k: p.skin.k, i: p.skin.i }; return { ...sk, e: p.eye, t: p.trail, n: p.nc }; }
  stopMatch() { if (this.backend && this.backend.close) this.backend.close(); this.backend = null; this.app.input && (this.app.input.enabled = false); this.app.audio.boost(false); this.killcam = null; this.victory = null; }
  pause(on) {
    if (!this.mode || this.mode === "attract" || this.mode === "show" || this.ended) return;
    this.paused = on; this.app.audio.boost(false); this.app.input.reset();
    if (on) this.app.ui.showPause(this.mode === "online"); else this.app.ui.hidePause();
  }
  restart() { const c = this.cfg; this.stopMatch(); this.start(c); }
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
    const now = performance.now(), mine = this.backend && this.backend.me, x2 = mine && mine.pu && mine.pu[3] > 0 ? 2 : 1;
    this.combo = now - this.comboT < 700 ? this.combo + 1 : 1; this.comboT = now;
    const mul = this.combo >= 30 ? 4 : this.combo >= 18 ? 3 : this.combo >= 8 ? 2 : 1; // eating-streak score multiplier
    const gain = v * x2; this.gainAcc += gain; this.stats.bonus += gain * (mul - 1);
    if (mul > 1 && mul !== this.comboMulShown) { this.comboMulShown = mul; this.hud.combo(mul, this.combo); A.audio.play("combo", { n: mul * 3 }); haptic.tap(12); }
    else if (mul > 1) this.hud.combo(mul, this.combo);
    if (v >= 4) { A.audio.play("big"); haptic.tap(8); this.r.burst(x, y, [1, 0.9, 0.5], 10, 3, 0.5, 0.45); this.bigAcc = (this.bigAcc || 0) + v; clearTimeout(this.bigT); this.bigT = setTimeout(() => { const me2 = this.backend && this.backend.me; if (me2 && this.bigAcc >= 4) this.hud.popup("+" + Math.round(this.bigAcc), "mass", this.r.project(me2.x, me2.y, 2)); this.bigAcc = 0; }, 140); } else A.audio.play("eat");
  }
  // floating +score above the head every ~0.35 s, combo decay
  gainTick(now) {
    const me = this.backend && this.backend.me; if (!me || !me.alive) return;
    if (this.gainAcc >= 1 && now - this.gainT > 350) { this.gainT = now; const mul = this.comboMulShown || 1; this.hud.popup("+" + Math.round(this.gainAcc * mul) + (mul > 1 ? " ×" + mul : ""), mul > 1 ? "gain hot" : "gain", this.r.project(me.x, me.y, 2.2)); this.gainAcc = 0; }
    if (this.combo && now - this.comboT > 700) { this.combo = 0; if (this.comboMulShown > 1) this.hud.combo(0); this.comboMulShown = 1; }
  }
  // ---------- power-ups ----------
  onPu(s, k, hit, p) {
    const A = this.app, me = this.backend && this.backend.me, mine = !!(s && me && s.id === me.id), col = hexLin(PU_COL[k]);
    const near = me ? Math.hypot(p.x - me.x, p.y - me.y) < 60 : true;
    if (near) { this.r.ring(p.x, p.y, col, mine ? 11 : 6); this.r.burst(p.x, p.y, col, mine ? 40 : 14, mine ? 9 : 5, 0.9, 0.6, 5); }
    if (mine) {
      this.stats.pu++; A.audio.play("pu", { k }); haptic.pattern([12, 30, 18]); this.r.kick && this.r.kick(0.5, col, 0.12); this.r.light && this.r.light(p.x, p.y, [col[0] * 3, col[1] * 3, col[2] * 3], 1.2);
      this.hud.popup(t("pu_" + k) + "!", "pu", this.r.project(me.x, me.y, 3), PU_COL[k]); this.hud.puFlash(k);
      if (k === PU.FREEZE) { for (const id of hit) { const o = this.findSnake(id); if (o) this.r.ring(o.x, o.y, [0.6, 0.95, 1], 6); } this.hud.banner(hit.length ? t("frozeN", { n: hit.length }) : t("pu_5"), 1300); }
      if (k === PU.MEGA) { this.r.ring(me.x, me.y, col, 18); this.r.shake && this.r.shake(0.5); }
    } else if (s && near) A.audio.at && A.audio.at("big", p.x, p.y);
    if (me && hit && hit.includes(me.id)) { this.hud.banner("❄ " + t("frozen"), 1400); A.audio.play("warn"); haptic.tap(30); this.hud.frost(PU_DUR[5]); }
  }
  onShield(s) {
    const A = this.app, me = this.backend && this.backend.me; if (!s) return;
    this.r.ring(s.x, s.y, [0.4, 0.8, 1], 9); this.r.burst(s.x, s.y, [0.4, 0.8, 1], 30, 8, 0.7, 0.5, 4);
    if (me && s.id === me.id) { A.audio.play("shieldHit"); haptic.pattern([30, 20, 30]); this.hud.banner("🛡 " + t("shieldSaved"), 1400); this.r.kick && this.r.kick(0.7, [0.3, 0.6, 1], 0.2); }
  }
  colOf(s) { const f = skinFn(s.skin || {}), col = [0, 0, 0]; f(2, 20, 0, col); return [toLin(col[0]), toLin(col[1]), toLin(col[2])]; }
  onDeath(mr, by, cause) {
    const s = mr.s; const f = skinFn(s.skin || {}), lin = this.colOf(s);
    const me = this.backend && this.backend.me; const dist = me ? Math.hypot(s.x - me.x, s.y - me.y) : 999;
    if (dist < 45) { this.r.shatter(s, f, this.app.store.settings.juice ? 60 : 25); this.r.burst(s.x, s.y, lin, 26, 9, 0.9, 0.65, 6); this.r.burst(s.x, s.y, [1, 1, 1], 10, 5, 0.4, 0.5, 3); if (this.app.store.settings.juice) { this.r.ring(s.x, s.y, lin, 7); this.r.light && this.r.light(s.x, s.y, [lin[0] * 2 + 0.6, lin[1] * 2 + 0.6, lin[2] * 2 + 0.6], 0.9); } }
    if (dist < 80 && (!by || by !== (me && me.id))) this.app.audio.at("die", s.x, s.y);
    if (by && by !== (me && me.id)) { const k = this.findSnake(by); if (k) this.pushFeed(k.name, s.name); }
    else if (!by && dist < 200) this.pushFeed("☠", s.name, false, cause === 3 ? "storm" : "wall");
  }
  onAnyDeath(s, by) {
    if (this.mode === "team" && by) { const k = this.findSnake(by); if (k && k.team !== undefined && k.team !== s.team) { this.teamScore[k.team]++; this.hud.modeHud(this.modeHudData()); if (this.teamScore[k.team] >= this.M.target) this.endMatch(k.team === 0, "team"); } }
    if (this.mode === "br" && !this.ended) { const alive = this.backend.sim.snakes.filter((x) => x.alive).length; if (s !== this.backend.me) { this.hud.banner(t("aliveN", { n: alive }), 900); if (alive === 1 && this.backend.me && this.backend.me.alive) this.endMatch(true, "br"); } }
  }
  onKill(id) {
    this.stats.kills++; const A = this.app, now = performance.now(); A.audio.play("kill"); haptic.pattern([15, 40, 25]); this.r.shake(0.7);
    const v = this.findSnake(id); this.pushFeed(t("you"), v ? v.name : "?", true);
    this.streak = now - this.streakT < 4000 ? this.streak + 1 : 1; this.streakT = now;
    const label = this.streak >= 4 ? t("rampage") : this.streak === 3 ? t("tripleKill") : this.streak === 2 ? t("doubleKill") : t("eliminated");
    const pos = v ? this.r.project(v.x, v.y, 1.5) : null; this.hud.popup("⚔ " + label, "kill", pos); this.hud.killBanner(label, v ? v.name : ""); if (this.streak >= 2) A.audio.play("streak");
    if (v) this.stats.bonus += Math.round(v.m * 0.25);
    if (v) { const lin = this.colOf(v); this.r.ring(v.x, v.y, [1, 1, 1], 12); this.r.ring(v.x, v.y, lin, 18); this.r.kick && this.r.kick(0.9, [1, 1, 1], 0.12); this.r.light && this.r.light(v.x, v.y, [lin[0] * 2 + 0.5, lin[1] * 2 + 0.5, lin[2] * 2 + 0.5], 1.4); A.audio.play("shock"); }
    // slow-motion kill-cam (offline; online keeps real time but still frames the kill)
    const S = A.store.settings; if (v && S.juice && !S.reduceMotion && (this.streak >= 2 || v.m > 60 || Math.random() < 0.6)) this.killcam = { x: v.x, y: v.y, t0: now, dur: this.mode === "online" ? 700 : 1150, a0: Math.random() * 6.28 };
  }
  onMyDeath(by, cause) {
    const A = this.app, me = this.backend.me; if (!me) return;
    this.stats.deaths++; const life = (performance.now() - this.stats.lifeT0) / 1000; this.stats.life = Math.max(this.stats.life, life);
    A.audio.play("die"); A.audio.boost(false); haptic.pattern([40, 30, 80]); this.r.shake(1.2); this.r.kick && this.r.kick(1.2, [0.6, 0, 0], 0.35);
    const f = skinFn(this.mySkin()), lin = this.colOf({ skin: this.mySkin() });
    this.r.shatter(me, f, 90); this.r.burst(me.x, me.y, lin, 30, 11, 1.2, 0.7, 6); this.r.ring(me.x, me.y, [1, 1, 1], 10); if (!A.store.settings.reduceMotion) this.slowUntil = performance.now() + 500; this.hud.flash();
    me.alive = false; me.deadAt = performance.now(); this.deathT = performance.now(); this.killer = by ? this.findSnake(by) : null; this.deathCause = cause;
    this.spectate = this.killer; A.input.enabled = false; A.input.reset(); this.streak = 0;
    const msg = by && this.killer ? t("killedBy", { n: this.killer.name }) : cause === 3 ? t("stormDeath") : t("hitWall");
    if (by && this.killer) this.pushFeed(this.killer.name, t("you"), false); this.hud.combo(0); this.hud.puClear();
    const respawn = (this.mode === "time" && this.stats.timeLeft > 2) || this.mode === "koth" || this.mode === "team" || (this.mode === "boss" && --this.lives > 0);
    if (respawn) { this.respawnAt = performance.now() + 1900; this.hud.banner(msg + (this.mode === "boss" ? " · " + t("livesN", { n: this.lives }) : ""), 1700); }
    else { if (this.mode === "br") this.place = this.backend.sim.snakes.filter((x) => x.alive).length + 1; this.endAt = performance.now() + 1600; this.hud.banner(msg, 1500); }
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
  pushFeed(a, b, mine, how) { this.feed.unshift({ a, b, mine, how, t: performance.now() }); if (this.feed.length > 4) this.feed.pop(); this.hud.feed(this.feed); }

  // ---------- win / lose ----------
  endMatch(win, reason) {
    if (this.ended || this.victory) return; this.win = win; const A = this.app, me = this.backend.me;
    if (win) {
      this.victory = { t0: performance.now(), dur: 3600, reason }; A.input.enabled = false; A.audio.boost(false); A.audio.play("victory"); haptic.pattern([30, 60, 30, 60, 90]);
      this.hud.cinematic(t("victory"), t("vic_" + reason)); const p = me && me.alive ? me : { x: this.camX, y: this.camY };
      if (this.r.confetti) { this.r.confetti(p.x, p.y, 180); setTimeout(() => this.r.confetti && this.backend && this.r.confetti(p.x + 3, p.y - 2, 140), 700); }
      this.r.ring(p.x, p.y, [1, 0.85, 0.3], 20); this.r.kick && this.r.kick(0.4, [1, 0.95, 0.8], 0.25);
    } else { A.audio.play("defeat"); this.endAt = performance.now() + 1200; this.hud.cinematic(t("defeat"), t("def_" + reason), true); A.input.enabled = false; }
  }
  finish(reason) {
    if (this.ended) return; this.ended = true; this.victory = null; this.killcam = null; const A = this.app, S = A.store, p = S.p, st = this.stats, me = this.backend && this.backend.me;
    A.input.enabled = false; A.audio.boost(false);
    const dur = (performance.now() - st.t0) / 1000; const mass = Math.round(me ? (reason === "time" ? me.m : st.best) : st.best);
    let score = mass; if (this.mode === "survival") score = Math.round(st.life * 10 + st.best); if (this.mode === "time") score = Math.round(st.endMass ?? mass);
    if (this.mode === "koth") score = Math.round(this.kothPts.get(me ? me.id : 0) || 0) * 10 + st.kills * 50; if (this.mode === "team") score = this.teamScore[0] * 100 + st.kills * 60; if (this.mode === "boss") score = (this.boss ? (this.boss.max - this.boss.hp) * 250 : 0) + (this.win ? 2000 : 0) + st.kills * 50; if (this.mode === "br") score = (this.win ? 3000 : Math.max(0, 25 - this.place) * 80) + st.kills * 100 + Math.round(st.best);
    if (this.mode !== "zen") score += Math.round(st.bonus || 0);
    const diffMul = [0.75, 1, 1.25, 1.5][this.cfg.diff ?? 1] * (this.mode === "online" ? 1.3 : 1) * (this.mode === "zen" ? 0.4 : 1) * (this.win ? 1.5 : 1);
    const xp = Math.round((st.best / 8 + st.kills * 30 + Math.min(dur, 900) / 4 + (this.mode === "survival" ? st.wave * 25 : 0) + (this.win ? 150 : 0) + (st.pu || 0) * 6 + (st.bonus || 0) / 20) * diffMul) + 10;
    const coins = Math.round(xp / 4);
    const P = p.stats; P.games++; P.kills += st.kills; P.deaths += st.deaths; P.food += st.food; P.best = Math.max(P.best, Math.round(st.best)); P.time += Math.round(dur); P.life = Math.max(P.life, Math.round(st.life)); P.boost += Math.round(st.boost);
    if (this.mode === "online") P.online++; if (this.mode === "zen") P.zen += Math.round(dur); if (this.mode === "survival") P.wave = Math.max(P.wave, st.wave); if (this.mode === "time") P.tbest = Math.max(P.tbest, score);
    if (this.win) { P.wins = (P.wins || 0) + 1; if (this.mode === "br") P.brWins = (P.brWins || 0) + 1; if (this.mode === "koth") P.kothWins = (P.kothWins || 0) + 1; if (this.mode === "team") P.teamWins = (P.teamWins || 0) + 1; if (this.mode === "boss") P.bossKills = (P.bossKills || 0) + 1; }
    if (st.rankBest === 1 && this.mode !== "zen") P.top++;
    p.coins += coins; const lv = S.addXp(xp); const tiers = S.addSeasonXp(xp);
    const bestKey = this.mode; const pos = S.addBest(bestKey, { s: score, k: st.kills, d: Date.now(), w: this.world, m: Math.round(st.best) });
    const missions = S.missionProgress({ food: st.food, kills: st.kills, mass: st.best, life: st.life, boost: st.boost, online: this.mode === "online" });
    const mp = S.matchProgress({ food: st.food, kills: st.kills, mass: st.best, life: st.life, boost: st.boost, wave: st.wave, mode: this.mode, win: this.win || st.rankBest === 1 });
    const ach = S.checkAch(); S.save();
    const title = this.win ? t("victory") : reason === "time" ? t("timeUp") : this.mode === "zen" ? t("zenDone") : t("gameOver");
    const sub = this.win ? t("vic_" + this.mode) : this.killer ? t("killedBy", { n: this.killer.name }) : this.deathCause === 1 ? t("hitWall") : this.deathCause === 3 ? t("stormDeath") : "";
    const rank = this.mode === "br" ? (this.win ? 1 : this.place || "—") : st.rankBest < 99 ? st.rankBest : "—";
    this.watching = false; A.ui.showResults({ killer: this.killer && this.killer.alive && !this.win ? this.killer : null, seasonXp: xp, pu: st.pu || 0, title, sub, score, mass: Math.round(st.best), kills: st.kills, rank, time: dur, xp, coins: coins + lv.coins, lv, newBest: pos === 0 && score > 0, missions, ach, mode: this.mode, wave: st.wave, win: this.win, tiers, mp });
    if (lv.up) A.audio.play("level"); else if (ach.length) A.audio.play("ach");
    if (pos === 0 && score > 0 && this.r.confetti && me) this.r.confetti(me.x, me.y, 120);
  }

  // ---------- frame ----------
  loop(ts) {
    this.raf = requestAnimationFrame(this._loop);
    const A = this.app, set = A.store.settings;
    const cap = set.fpsCap; if (cap && this.lastFrame && ts - this.lastFrame < 1000 / cap - 2.5) return;
    const dt = this.lastFrame ? Math.min(0.1, (ts - this.lastFrame) / 1000) : 1 / 60; this.lastFrame = ts; this.t += dt;
    const c0 = performance.now();
    try { this.tick(dt, ts); } catch (e) { console.error(e); A.ui.toast(t("oops"), "warn"); if (this.mode !== "attract" && this.mode !== "show") { this.ended = true; this.stopMatch(); A.ui.goLobby(); } }
    if (!this.cpu) this.cpu = new Float32Array(1024); this.cpu[this.cpuI = ((this.cpuI || 0) + 1) & 1023] = performance.now() - c0;
  }
  tick(dt, ts) {
    const A = this.app, set = A.store.settings; if (!this.r) return;
    this.ft[this.fi++ % this.ft.length] = dt * 1000;
    if (set.showFps && ts - this.fpsShown > 500) { this.fpsShown = ts; const n = Math.min(this.fi, 60); let s = 0; for (let k = 1; k <= n; k++) s += this.ft[(this.fi - k + this.ft.length) % this.ft.length]; this.hud.fps(Math.round(1000 / (s / n))); }
    if (set.quality === "auto" && this.fi % 120 === 0 && this.fi > 240 && !document.hidden && this.mode !== "show") this.autoQuality();
    if (this.mode === "show") { const v = this.view; v.t = this.t; v.dt = dt; v.scene = "show"; v.show = this.show; v.fpsTarget = set.fpsCap || 60; this.r.frame(v); return; }
    const b = this.backend; if (!b) return; this.view.scene = "world";
    const me = b.me; const now = performance.now();
    const cine = this.killcam || this.victory;
    if (this.mode !== "attract" && !this.paused && !this.ended && me && me.alive && !this.victory) {
      const ang = A.input.poll(me.ta ?? me.a, dt); let boost = A.input.boost;
      if (ang !== null && ang !== undefined) b.setInput(ang, boost); else b.setInput(me.ta ?? me.a, boost);
      const boosting = !!boost && me.m > C.MIN_BOOST_M; A.audio.boost(boosting); if (boosting) { this.stats.boost += dt; if (!this._wasBoost) { this.r.kick && this.r.kick(0.35); } } this._wasBoost = boosting;
      this.stats.best = Math.max(this.stats.best, me.m);
    }
    if (this.countdown > 0 && !this.paused) {
      this.countdown -= dt; const n = Math.ceil(this.countdown / 0.8);
      if (n !== this.cdShown) { this.cdShown = n; if (n > 0 && n <= 3) { this.hud.count(String(n)); A.audio.play("count"); } else if (n <= 0) { this.hud.count(t("go") || "GO!"); A.audio.play("go"); haptic.tap(15); this.stats.t0 = this.stats.lifeT0 = performance.now(); } }
    }
    if (this.intro > 0) this.intro = Math.max(0, this.intro - dt);
    // time scale: own death beat, kill-cam slow motion
    let ts2 = 1; if (now < this.slowUntil) ts2 = 0.35;
    if (this.killcam) { const k = (now - this.killcam.t0) / this.killcam.dur; if (k >= 1) this.killcam = null; else if (this.mode !== "online") ts2 = Math.min(ts2, 0.22 + 0.78 * Math.pow(k, 3)); }
    this.timeScale = ts2;
    if (!(this.paused && this.mode !== "online") && !(this.countdown > 0)) b.update(dt * this.timeScale);
    if (this.mode === "attract") { const S = b.sim; if (S.snakes.filter((s) => s.alive).length < 14) b.addBot(2); }
    if (this.mode !== "attract" && !this.ended && !this.paused && !(this.countdown > 0)) this.rules(dt * this.timeScale, dt);
    if (this.watching && (!this.spectate || !this.spectate.alive)) this.stopWatch();
    this.build(dt); this.view.fpsTarget = set.fpsCap || 60; this.r.frame(this.view);
    if (this.r.setListener !== undefined) {} A.audio.setListener(this.camX, this.camY);
    if (this.mode !== "attract" && this.mode !== "show") this.gainTick(now);
    if (this.mode !== "attract" && ts - this.lastLb > 250) { this.lastLb = ts; this.hudTick(); }
  }
  rules(dt, rdt) {
    const st = this.stats, b = this.backend, now = performance.now(), me = b.me;
    if (this.victory) { if (now - this.victory.t0 > this.victory.dur) this.finish("win"); return; }
    if (this.M.dur && st.timeLeft > 0 && this.mode !== "time") { st.timeLeft -= dt; if (st.timeLeft <= 0) { st.timeLeft = 0; this.timeUp(); return; } }
    if (this.mode === "time") {
      st.timeLeft -= dt; if (st.timeLeft <= 0) { st.timeLeft = 0; st.endMass = me && me.alive ? me.m : C.START_M; this.finish("time"); return; }
    }
    if (this.respawnAt && now > this.respawnAt) { this.respawnAt = 0; const old = b.me; b.sim.removeSnake(old); b.spawn(this.app.store.p.name, this.mySkin()); if (this.boss) this.boss.s.ai.prey = b.me.id; this.app.input.enabled = true; this.spectate = null; st.lifeT0 = now; }
    if (this.mode === "survival") {
      const el = (now - st.t0) / 1000, wave = 1 + Math.floor(el / 30);
      if (wave > st.wave) { st.wave = wave; b.wave = wave; this.hud.banner(t("wave", { n: wave }), 1600); this.app.audio.play("go"); const S = b.sim; S.botAggro = 1 + wave * 0.12; const add = Math.min(3, 26 - S.snakes.filter((s) => s.alive).length); for (let k = 0; k < add; k++) b.addBot(Math.min(3, 1 + ((wave - 1) / 3) | 0)); }
      st.life = Math.max(st.life, (now - st.lifeT0) / 1000);
    } else if (me && me.alive) st.life = Math.max(st.life, (now - st.lifeT0) / 1000);
    if (this.mode === "br") this.ruleBR(dt);
    if (this.mode === "koth") this.ruleKOTH(dt);
    if (this.mode === "boss") this.ruleBoss(dt);
    if (this.endAt && now > this.endAt) { this.endAt = 0; this.finish("death"); }
  }
  timeUp() {
    if (this.mode === "koth") { const ranking = [...this.kothPts.entries()].sort((a, c) => c[1] - a[1]); this.endMatch(ranking.length > 0 && ranking[0][0] === (this.backend.me && this.backend.me.id), "koth"); }
    else if (this.mode === "team") this.endMatch(this.teamScore[0] > this.teamScore[1], "team");
    else this.finish("time");
  }
  ruleBR(dt) {
    const z = this.zone, R = this.backend.R; z.t += dt; const me = this.backend.me;
    if (z.phase === "wait") { this.zoneNext -= dt; if (this.zoneNext <= 0) { z.stage++; z.phase = "shrink"; z.from = z.r; z.to = Math.max(10, R * Math.pow(0.62, z.stage)); z.cx = z.x; z.cy = z.y; const a = Math.random() * 6.283, m = Math.max(0, z.from - z.to) * 0.45; z.tx = z.x + Math.cos(a) * m; z.ty = z.y + Math.sin(a) * m; z.k = 0; z.dmg = 1 + z.stage * 0.4; this.hud.banner(t("stormShrinks"), 1600); this.app.audio.play("siren"); } }
    else { z.k = Math.min(1, z.k + dt / 18); const e = z.k * z.k * (3 - 2 * z.k); z.r = z.from + (z.to - z.from) * e; z.x = z.cx + (z.tx - z.cx) * e; z.y = z.cy + (z.ty - z.cy) * e; if (z.k >= 1) { z.phase = "wait"; this.zoneNext = z.stage >= 5 ? 9999 : 28; } }
    if (me && me.alive) { const out = Math.hypot(me.x - z.x, me.y - z.y) > z.r; this.hud.storm(out); if (out && (this._stormBeep = (this._stormBeep || 0) + dt) > 0.8) { this._stormBeep = 0; this.app.audio.play("warn"); haptic.tap(20); } }
  }
  ruleKOTH(dt) {
    const h = this.hill, S = this.backend.sim, me = this.backend.me; h.t += dt; if (h.t > 40) this.moveHill();
    const inside = []; for (const s of S.snakes) if (s.alive && Math.hypot(s.x - h.x, s.y - h.y) < h.r) inside.push(s);
    const rate = inside.length === 1 ? 6 : 2.5; for (const s of inside) { const v = (this.kothPts.get(s.id) || 0) + rate * dt; this.kothPts.set(s.id, v); if (v >= this.M.target) { this.endMatch(s === me, "koth"); return; } }
    h.owner = inside.length === 1 ? inside[0] : null; h.contested = inside.length > 1; h.mine = !!(me && inside.includes(me));
    if (h.mine && (this._hillT = (this._hillT || 0) + dt) > 0.5) { this._hillT = 0; this.app.audio.play("hill"); }
  }
  ruleBoss(dt) {
    const B = this.boss, me = this.backend.me, S = this.backend.sim; if (!B || !B.s.alive) return; const bs = B.s;
    // weak cores ride along the boss body
    const pts = this._bp || (this._bp = new Float32Array(1200)); const n = bodyPoints(bs, 0, 0, Math.max(0.5, bs.r * 0.6), bs.len, pts, 590);
    B.cores.length = 0; for (let i = 0; i < B.hp; i++) { const j = Math.min(n - 1, Math.floor(((i + 1) / (B.max + 1)) * n)); B.cores.push({ x: pts[j * 2], y: pts[j * 2 + 1], h: bs.r * 2.1, r: 0.9 + bs.r * 0.18 }); }
    B.hitT -= dt;
    if (me && me.alive && B.hitT <= 0) for (let i = 0; i < B.cores.length; i++) { const c = B.cores[i]; if (Math.hypot(me.x - c.x, me.y - c.y) < c.r + me.r + 1.2) { this.hitCore(c); break; } }
    if (S.tick % 30 === 0) bs.ai.prey = me && me.alive ? me.id : 0;
  }
  hitCore(c) {
    const B = this.boss, A = this.app; B.hp--; B.hitT = 0.6; this.stats.kills += 0; A.audio.play("core"); this.r.shake(0.9); this.r.ring(c.x, c.y, [1, 0.3, 0.2], 10); this.r.burst(c.x, c.y, [1.4, 0.4, 0.2], 40, 10, 0.9, 0.7, 6); this.r.kick && this.r.kick(0.8, [1, 0.3, 0.2], 0.18); this.r.light && this.r.light(c.x, c.y, [2.5, 0.6, 0.3], 1.6);
    haptic.pattern([20, 30, 40]); this.hud.popup("💥 " + t("coreHit"), "kill", this.r.project(c.x, c.y, 2)); const bs = B.s; bs.setMass(Math.max(400, bs.m - 200));
    const ph = B.hp <= 2 ? 3 : B.hp <= 5 ? 2 : 1;
    if (ph !== B.phase) { B.phase = ph; A.audio.play("roar"); this.hud.banner(t("bossPhase", { n: ph }), 1800); this.r.shake(1.2);
      if (ph === 2) { bs.vk = 1.08; for (let k = 0; k < 3; k++) { const m = this.backend.addBot(3); m.ai.prey = this.backend.me ? this.backend.me.id : 0; } }
      if (ph === 3) { bs.vk = 1.2; this.backend.sim.botAggro = 1.6; for (let k = 0; k < 40; k++) { const [x, y] = this.backend.sim.randPos(this.backend.R * 0.7); this.backend.sim.spawnFood(x, y, 4 + Math.random() * 4, (Math.random() * 12) | 0); } } }
    if (B.hp <= 0) { bs.god = false; this.backend.sim.kill(bs, this.backend.me ? this.backend.me.id : 0, 2); A.audio.play("boom"); this.r.shake(1.4); this.r.ring(bs.x, bs.y, [1, 0.6, 0.2], 30); this.endMatch(true, "boss"); }
    this.hud.modeHud(this.modeHudData());
  }
  modeHudData() {
    const m = this.mode;
    if (m === "team") return { kind: "team", a: this.teamScore[0], b: this.teamScore[1], target: this.M.target };
    if (m === "boss" && this.boss) return { kind: "boss", hp: this.boss.hp, max: this.boss.max, phase: this.boss.phase, lives: this.lives };
    if (m === "koth") return { kind: "koth" }; if (m === "br") return { kind: "br" }; return null;
  }
  build(dt) {
    const v = this.view, b = this.backend, set = this.app.store.settings; v.t = this.t; v.dt = dt;
    const list = v.snakes; list.length = 0; const now = performance.now();
    const alpha = b.alpha;
    const add = (s, o, f, me, boost) => {
      let e = this.entries.get(s); if (!e) { e = { s }; this.entries.set(s, e); }
      const sk = s.skin || {}; e.o = o; e.f = f; e.fn = skinFn(sk); e.eye = sk.e | 0; e.trail = sk.t | 0; e.name = s.name; e.nc = NAME_COLORS[sk.n | 0] || "#fff"; e.me = me; e.boost = boost; e.fx = skinFx(sk);
      e.alpha = s.alive ? 1 : Math.max(0, 1 - (now - (s.deadAt || now)) / 450); e.scale = s.alive ? 1 : 1 + (1 - e.alpha) * 0.25; e.look = s.ta; e.top = false; e.used = true; e.ox = me && b.vox ? b.vox : 0; e.oy = me && b.voy ? b.voy : 0;
      e.team = s.team !== undefined ? TEAM_COL[s.team] : null; if (s.team !== undefined) e.nc = TEAM_CSS[s.team]; if (s.boss) { e.nc = "#ff4040"; e.glow = [1, 0.1, 0.1]; e.team = null; } else e.glow = null;
      if (s.boss && this.boss && this.boss.phase === 3) e.glow = [1.6, 0.2, 0.05];
      list.push(e); return e;
    };
    for (const e of this.entries.values()) e.used = false;
    if (b.sim) { for (const s of b.sim.snakes) if (s.n > 2) add(s, 1, alpha, s === b.me, s.boosting); }
    else { b.prepareOthers(); for (const mr of b.mirrors.values()) add(mr.s, mr.s._ro, mr.s._rf, false, mr.boost); if (b.me) add(b.me, 1, alpha, true, b.me.boosting); }
    for (const [k, e] of this.entries) if (!e.used) this.entries.delete(k);
    for (let q = 0; q < 3; q++) { let best = null; for (const e of list) if (!e.top && e.s.alive && (!best || e.s.m > best.s.m)) best = e; if (best) best.top = true; }
    v.food = b; v.ghosts = b.ghosts; v.pus = b.pus || null; v.tick = b.sim ? b.sim.tick : undefined;
    v.zone = this.zone && this.mode === "br" ? this.zone : null; v.hill = this.hill && this.mode === "koth" ? { x: this.hill.x, y: this.hill.y, r: this.hill.r, c: this.hill.mine ? [0.3, 1, 0.5] : this.hill.contested ? [1, 0.3, 0.3] : [1, 0.8, 0.2] } : null;
    v.cores = this.boss && this.boss.s.alive ? this.boss.cores : null;
    // camera
    const me = b.me; let tx = this.camX, ty = this.camY, zoom = 1; const cam = v.cam;
    cam.title = undefined; cam.intro = undefined; cam.kill = null; cam.victory = undefined; cam.orbit = undefined; v.letterbox = false; v.hideNames = false;
    if (this.mode === "attract") {
      const lead = b.sim.leaderboard(1)[0]; if (lead) { tx = lead.x * 0.3; ty = lead.y * 0.3; }
      if (this.titleT !== undefined) { this.titleT += dt; cam.title = this.titleT; v.hideNames = true; } else { this.orbit += dt * 0.05; cam.orbit = this.orbit; } zoom = 1.9;
    } else {
      const foc = this.spectate && this.spectate.alive ? this.spectate : me;
      if (foc) { const head = foc === me && me.alive ? lerpHead(me, alpha) : [foc.x, foc.y]; if (foc === me && b.vox) { head[0] += b.vox; head[1] += b.voy; }
        const la = (foc.boosting ? 4.2 : 2.6) * (1 + Math.max(0, foc.r - 0.6) * 0.5); this.lookX = (this.lookX || 0) + (Math.cos(foc.a) * la - (this.lookX || 0)) * Math.min(1, dt * 3); this.lookY = (this.lookY || 0) + (Math.sin(foc.a) * la - (this.lookY || 0)) * Math.min(1, dt * 3);
        tx = head[0] + this.lookX; ty = head[1] + this.lookY; zoom = 1 + Math.max(0, foc.r - 0.6) * 0.55; cam.boost = !!foc.boosting && foc === me; }
      if (this.intro > 0 && this.introDur) cam.intro = this.intro / this.introDur;
      if (this.killcam) { const k = (now - this.killcam.t0) / this.killcam.dur, w = Math.min(1, k * 5, (1 - k) * 4); cam.kill = { x: this.killcam.x, y: this.killcam.y, t: k * this.killcam.dur / 1000, a0: this.killcam.a0, w: Math.max(0, w) * 0.85 }; v.letterbox = true; }
      if (this.victory) { cam.victory = (now - this.victory.t0) / 1000; v.letterbox = true; v.hideNames = true; }
    }
    this.camX = tx; this.camY = ty; cam.x = tx; cam.y = ty; cam.zoom = zoom; if (cam.snap) setTimeout(() => (cam.snap = false), 50);
  }
  hudTick() {
    const b = this.backend, me = b.me, st = this.stats; if (!b) return;
    let all = b.sim ? b.sim.snakes.filter((s) => s.alive) : [...b.mirrors.values()].map((m) => m.s).filter((s) => s.alive);
    if (me && me.alive && !b.sim) all.push(me);
    all.sort((a, c) => c.m - a.m); const rank = me && me.alive ? all.indexOf(me) + 1 : 0; if (rank > 0) st.rankBest = Math.min(st.rankBest, rank);
    let top = all.slice(0, 5), scoreList = null;
    if (this.mode === "koth") scoreList = [...this.kothPts.entries()].sort((a, c) => c[1] - a[1]).slice(0, 5).map(([id, v]) => ({ s: this.findSnake(id), v: Math.floor(v) })).filter((x) => x.s);
    this.hud.update({ mass: me && me.alive ? me.m : 0, rank, total: all.length, top, me, kills: st.kills, timeLeft: this.M && (this.mode === "time" || this.M.dur) ? st.timeLeft : null, wave: this.mode === "survival" ? st.wave : null, ping: b.online ? b.ping : null, humans: b.online ? b.humans : null, scoreList, kothMine: this.mode === "koth" && me ? Math.floor(this.kothPts.get(me.id) || 0) : null, target: this.M && this.M.target, alive: this.mode === "br" ? all.length : null, zone: this.zone && this.zone.phase === "wait" ? Math.ceil(this.zoneNext) : null, hill: this.hill });
    if (this.app.store.settings.minimap) this.hud.minimap(all, me, b.R || C.R, this.view.foodPalCss, this.zone, this.hill, this.boss && this.boss.s, b.pus);
    if (me && me.alive && !this.ended) {
      this.hud.pu(me.pu, me.slow);
      // rank / mass milestones
      if (rank > 0 && rank < this.rankShown && (rank === 1 || rank <= 3 || (rank <= 10 && this.rankShown > 10)) && performance.now() - st.t0 > 4000) { this.hud.popup(rank === 1 ? "👑 " + t("rankTop") : t("rankUp", { n: rank }), "rank", this.r.project(me.x, me.y, 3.5)); this.app.audio.play(rank === 1 ? "level" : "toast"); }
      if (rank > 0) this.rankShown = rank;
      const MILES = [100, 250, 500, 1000, 2500, 5000, 10000]; const mi = MILES.findIndex((x) => me.m < x); const reached = mi < 0 ? MILES.length : mi;
      if (reached > this.massMile) { this.massMile = reached; this.hud.popup("⬆ " + t("massN", { n: fmtNum(MILES[reached - 1]) }), "rank", this.r.project(me.x, me.y, 4)); this.app.audio.play("ach"); haptic.tap(15); }
      this.liveMissions(); this.hint();
    }
    // adaptive music intensity: size, nearby threats, mode danger
    if (me && me.alive) { let near = 0; for (const s of all) if (s !== me && Math.hypot(s.x - me.x, s.y - me.y) < 25) near++;
      let I = Math.min(0.5, Math.log10(Math.max(10, me.m)) / 6) + Math.min(0.35, near * 0.08); if (this.boss) I += 0.3 + (this.boss.phase - 1) * 0.15; if (this.zone && this.zone.stage > 0) I += 0.1 + this.zone.stage * 0.06; if (rank === 1) I += 0.1; this.app.audio.setIntensity(I); }
    else this.app.audio.setIntensity(0.15);
  }
  // daily missions + weekly challenges preview during play (the real save happens in finish)
  liveMissions() {
    const S = this.app.store, st = this.stats; if (this.mode === "zen" && !this.cfg) return;
    const cur = (id) => id === "eat" ? st.food : id === "kill" ? st.kills : id === "mass" ? st.best : id === "survive" ? st.life : id === "boost" ? st.boost : id === "online" ? (this.mode === "online" ? 1 : 0) : id === "games" ? 1 : 0;
    const check = (list, key, txt) => { list.forEach((m, i) => { if (m.c || m.p >= m.g) return; const add = m.id === "mass" || m.id === "survive" ? Math.max(0, cur(m.id) - m.p) : cur(m.id); const v = Math.min(m.g, Math.floor(m.p + add)), half = m.p < m.g / 2 && v >= m.g / 2 && m.id !== "games";
      const k = key + i; if (v >= m.g && !this.liveMs.has(k + "d")) { this.liveMs.add(k + "d"); this.liveMs.add(k + "h"); this.hud.mission("✓ " + txt(m), m.g, m.g, true); this.app.audio.play("mission"); haptic.pattern([10, 40, 10]); }
      else if (half && !this.liveMs.has(k + "h")) { this.liveMs.add(k + "h"); this.hud.mission(txt(m), v, m.g, false); } }); };
    check(S.daily(), "d", (m) => t("mi_" + m.id, { n: m.g })); check(S.weekly().filter((m) => ["kill", "eat", "mass", "boost"].includes(m.id)), "w", (m) => t("wk_" + m.id, { n: fmtNum(m.g) }));
  }
  // first matches: short contextual hints
  hint() {
    const p = this.app.store.p; if ((p.stats.games || 0) > 3 || this.mode === "online") return; this.hintT -= 0.25; if (this.hintT > 0) return;
    const H = ["hint_steer", "hint_boost", "hint_eat", "hint_pu", "hint_cut", "hint_dead"]; if (this.hintI >= H.length) return; this.hud.hint(t(H[this.hintI++])); this.hintT = 9;
  }
  // after a game over: follow the killer for a while
  watchKiller() {
    const k = this.killer; if (!k || !k.alive || !this.backend) return false; this.watching = true; this.spectate = k; this.app.ui.hideResults(); this.hud.spectate(k.name); this.running = true; return true;
  }
  stopWatch() { this.watching = false; this.spectate = null; this.hud.spectate(null); this.app.ui.reshowResults(); }
  autoQuality() {
    const A = this.app, n = this.ft.length, arr = Array.from(this.ft).sort((a, c) => a - c), p90 = arr[Math.floor(n * 0.9)];
    const target = 1000 / (A.store.settings.fpsCap || 60), order = ["low", "medium", "high", "ultra"], cur = this.r.qName, i = order.indexOf(cur);
    if (p90 > target * 1.45) {
      this.goodWins = 0;
      if (i > 0) { A.applyQuality(order[i - 1]); if (!this.autoToasted) { this.autoToasted = true; A.ui.toast(t("autoLow")); } }
      else if (!this.r.is2D && p90 > 40) { A.switchRenderer("2d", true); }
      this.ft.fill(target);
    } else if (p90 < target * 1.08) { if (++this.goodWins >= 4 && i >= 0 && i < (A.maxAuto || 2)) { this.goodWins = 0; A.applyQuality(order[i + 1]); this.ft.fill(target); } }
    else this.goodWins = 0;
  }
}
function lerpHead(s, a) { const x1 = s.sx(1), y1 = s.sy(1); return [x1 + (s.sx(0) - x1) * a, y1 + (s.sy(0) - y1) * a]; }
