// Game loop, modes, offline backend, effects, cinematics, adaptive music, HUD feed, auto-quality.
// Renderer-agnostic (3D or 2D fallback). Modes: classic, time, survival, zen, online + battle royale (storm),
// king of the hill, boss event (giant AI snake with phases), team battle.
import { XMODES, XMODE_CFG, XMODE_EVENTS, XT, xFinish } from "./modes.js?v=resp2a"; // Track B: extra modes + skill chain
import { Sim, C, BOT_NAMES, pickBotName, bodyPoints, PU, PU_COL, PU_ICON, PU_DUR, GOLD_FC } from "./sim.js?v=resp2a";
import { compileSkin, SKINS, FLAGS, NAME_COLORS, primaryColor, skinFx, LEGEND } from "./skins.js?v=resp2a";
import { FOOD_COLORS, FOOD_COLORS_CB, WORLDS } from "./worlds.js?v=resp2a";
import { NetBackend } from "./net.js?v=resp2a";
import { t, fmtNum } from "./i18n.js?v=resp2a";
import { haptic } from "./audio.js?v=resp2a";
import { rankOf, rpDelta } from "./profile.js?v=resp2a";
import { Replay } from "./replay.js?v=resp2a";
import { afterMatch, applyServer, devKey, trophies } from "./league.js?v=resp2a"; // comp1
import { onServerTrophy } from "./compui.js?v=resp2a";
import { Governor } from "./gov.js?v=resp2a"; // perf2: adaptive render governor
import { emit } from "./events.js?v=resp2a"; // aaa2: fx.* hooks (renderers + audio subscribe)
const EV = { eat: {}, kill: {}, mykill: {}, death: {}, pos: {}, boost: { on: false } }; // reused payloads (no allocation on the hot path)

const toLin = (v) => v * v * (0.7 + 0.3 * v);
const hexLin = (h) => { const n = parseInt(h.slice(1), 16); return [toLin((n >> 16 & 255) / 255), toLin((n >> 8 & 255) / 255), toLin((n & 255) / 255)]; };
export const EMOTES = ["👋", "😂", "😡", "🔥", "👍", "GG"];
// arena events allowed per mode (zen/koth: harmless gold rain only; boss: none)
const MODE_EVENTS = { classic: true, time: true, online: true, survival: ["rain", "drops"], zen: ["rain"], br: ["rain", "bounty"], team: ["rain", "bounty"], koth: ["rain"], boss: [] };
export const MODES = {
  // slither-scale arenas (~3.4x the area of the first release); food scales with area in the sim, bots scale here
  classic: { bots: 30, R: 240 }, time: { bots: 26, R: 205, dur: 180 }, survival: { bots: 14, R: 200 }, zen: { bots: 16, R: 200 },
  br: { bots: 34, R: 300, noRespawn: true }, koth: { bots: 20, R: 190, dur: 180, target: 100 }, boss: { bots: 8, R: 190, lives: 3 }, team: { bots: 25, R: 220, dur: 180, target: 25 },
};
Object.assign(MODES, XMODE_CFG); Object.assign(MODE_EVENTS, XMODE_EVENTS); // Track B modes
const FOOD_CALM = ["#ffd56b", "#7fe6ff", "#ff92bd", "#a6ff7c", "#ffd56b", "#7fe6ff", "#ff92bd", "#a6ff7c", "#ffd56b", "#7fe6ff", "#ff92bd", "#a6ff7c", "#ffc93a"];
const TEAM_COL = [[0.2, 0.55, 1.0], [1.0, 0.25, 0.3]], TEAM_CSS = ["#4da3ff", "#ff4d5e"];
const skinCache = new Map();
export function skinFn(d) { const k = JSON.stringify(d); let f = skinCache.get(k); if (!f) { f = compileSkin(d); skinCache.set(k, f); if (skinCache.size > 300) skinCache.delete(skinCache.keys().next().value); } return f; }
const BOSS_SKIN = { k: "skin", i: SKINS.findIndex((s) => s.id === "void"), e: 6, t: 0, n: 7 };

// ---------- offline backend: the shared sim at 60 Hz, bots, player ----------
class LocalBackend {
  constructor(mode, opts, cb) {
    this.mode = mode; this.cb = cb; this.online = false; const M = MODES[mode] || MODES.classic; this.M = M;
    this.sim = new Sim({ dt: 1 / 60, R: M.R, seed: opts.seed, walls: true, diff: opts.diff, events: opts.events ?? MODE_EVENTS[mode] ?? [], evtFirst: 32 + Math.random() * 14 });
    this.sim.diff = opts.diff; this.R = M.R; this.dt = 1 / 60; this.acc = 0; this.opts = opts; this.botSeq = 0; this.teamN = [0, 0];
    if (mode === "team") this.sim.teams = true;
    for (let i = 0; i < M.bots; i++) this.addBot();
    this.me = null; this.dead = false; this.wave = 1; this.ghosts = [];
    this.FM = this.sim.FM; this.fx = this.sim.fx; this.fy = this.sim.fy; this.fv = this.sim.fv; this.fc = this.sim.fc; this.fa = this.sim.fa;
    this.age = (i) => (this.sim.fBorn[i] === 0 ? 1 : Math.min(1, (this.sim.tick - this.sim.fBorn[i]) / 18));
  }
  // look1: if a bot already wears the player's look, give that bot an unused skin
  _uniqVsMe(me) { const key = (o) => o.skin && o.skin.k + ":" + o.skin.i, mk = key(me); const used = new Set(this.sim.snakes.filter((o) => o.alive).map(key));
    for (const o of this.sim.snakes) if (o !== me && o.bot && o.alive && key(o) === mk) { const free = SKINS.map((x, k) => k).filter((k) => !SKINS[k].fx && !used.has("skin:" + k)); if (!free.length) break; const i = free[(this.sim.rand() * free.length) | 0]; o.skin = { ...o.skin, k: "skin", i }; used.add("skin:" + i); } }
  addBot(diff, team) {
    const i = this.botSeq++, r = this.sim.rand; const d = diff ?? (this.mode === "zen" ? 0 : this.opts.diff);
    const legend = r() < 0.12; const used = new Set(); for (const o of this.sim.snakes) if (o.alive && o.skin) used.add(o.skin.k + ":" + o.skin.i); // look1: no two live snakes share a look
    const pool0 = SKINS.map((s, k) => k).filter((k) => !!SKINS[k].fx === legend), pool = pool0.filter((k) => !used.has("skin:" + k)), fpool = FLAGS.map((f, k) => k).filter((k) => !used.has("flag:" + k));
    const skin = r() < 0.3 && fpool.length ? { k: "flag", i: fpool[(r() * fpool.length) | 0] } : { k: "skin", i: (pool.length ? pool : pool0)[(r() * (pool.length || pool0.length)) | 0] };
    const s = this.sim.addSnake(pickBotName(this.sim.snakes, i * 7 + ((r() * 40) | 0)), { ...skin, e: (r() * 4) | 0, t: 0, n: 0 }, { bot: true, diff: d, m: C.START_M }); // noself1 fairness: bots spawn at the player's start mass
    s.avt = skin.k === "flag" && r() < 0.6 ? "f" + skin.i : "p" + ((r() * 16) | 0); s.fr = r() < 0.5 ? 0 : 1 + ((r() * 4) | 0);
    if (this.mode === "team") { s.team = team ?? (this.teamN[0] < Math.floor(this.M.bots / 2) ? 0 : 1); this.teamN[s.team]++; }
    return s;
  }
  spawn(name, skin) {
    const s = this.sim.addSnake(name, skin, { god: this.mode === "zen" }); this.me = s; this._uniqVsMe(s); s.avt = skin.av; s.fr = skin.fr; this.dead = false; this.myId = s.id; if (this.mode === "team") s.team = 0; this.cb.onSpawnMe && this.cb.onSpawnMe(s); return s;
  }
  setInput(ta, boost) { if (this.me) { this.me.ta = ta; this.me.boost = boost ? 1 : 0; } }
  update(dt) {
    this.acc += dt; let n = 0; const S = this.sim;
    while (this.acc >= this.dt && n < 6) {
      this.acc -= this.dt; n++;
      S.step(null);
      for (let i = 0; i < S.evEat.length; i += 2) {
        const fi = S.evEat[i], by = S.byId.get(S.evEat[i + 1]);
        if (by && this.ghosts.length < 150) this.ghosts.push({ x: S.fx[fi], y: S.fy[fi], tx: by.x, ty: by.y, t: 0, r: 0.22 + Math.sqrt(S.fv[fi]) * 0.16, v: S.fv[fi], c: S.fc[fi], e: by, mine: by === this.me });
        if (by) this.cb.onEat(by === this.me, S.fx[fi], S.fy[fi], S.fv[fi], S.fc[fi]);
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
      if (this.cb.onEvt) for (const e of S.evEvt) this.cb.onEvt(e);
      if (this.cb.onMeteor) for (const M of S.evMet) this.cb.onMeteor(M);
      if (this.cb.onImpact) for (let i = 0; i < S.evImpact.length; i += 3) this.cb.onImpact(S.evImpact[i], S.evImpact[i + 1], S.evImpact[i + 2]);
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
  get mets() { return this.sim.mets; }
  others() { return this.sim.snakes; }
  close() {}
}

export class Game {
  constructor(app) {
    this.app = app; this.r = null; this.running = false; this.paused = false; this.view = { snakes: [], food: null, cam: { x: 0, y: 0, zoom: 1 }, t: 0, dt: 0, ghosts: null, foodPal: null, foodPalCss: null };
    this.entries = new Map(); this.ft = new Float32Array(240); this.fi = 0; this.fpsShown = 0; this.lastFrame = 0; this.attract = null; this.t = 0;
    this.hud = app.hud; this._loop = (ts) => this.loop(ts); this.raf = 0; this.goodWins = 0; this.autoToasted = false; this.camX = 0; this.camY = 0; this.show = null;
  }
  setRenderer(r) { this.r = r; if (r && r.setGov && this.gov) r.setGov(this.gov.level); }
  // calm food palette: four soft hues (less colour noise) + gold for event orbs; colour-blind mode keeps its own set
  palettes(w) { const W = WORLDS[w ?? this.world ?? 0] || WORLDS[0], wf = W.calm && W.calm.food; const P = this.app.store.settings.cb ? FOOD_COLORS_CB : wf ? Array.from({ length: 13 }, (_, i) => (i === 12 ? "#e6c36a" : wf[i % wf.length])) : FOOD_CALM; this.view.foodPal = P.map(hexLin); this.view.foodPalCss = P; }
  startLoop() { if (!this.raf) this.raf = requestAnimationFrame(this._loop); }

  // ---------- attract (title flyover) and studio showcase (menus) ----------
  startAttract(world, title) {
    this.stopMatch(); this.palettes();
    this.attract = new LocalBackend("classic", { diff: 2, seed: 1234, events: [] }, { onEat() {}, onDeath: () => {}, onMyDeath() {}, onKill() {} });
    this.backend = this.attract; this.mode = "attract"; this.world = world; this.r.setArena(this.attract.R); this.r.setWorld(world); this.orbit = 0; this.titleT = title ? 0 : undefined; this.running = true; this.startLoop();
    for (let k = 0; k < 240; k++) this.attract.update(1 / 60);
  }
  // resp1: after a resize the canvas is cleared; draw again even if the menu backdrop or a frozen match frame is being held
  redraw() { this._stillRef = null; this._frozen = false; }
  startShow(world) { this.stopMatch(); this.palettes(world); this.backend = null; this.mode = "show"; if (world !== undefined) { this.world = world; this.r.setWorld(world); } this.running = true; this.startLoop(); }

  // ---------- matches ----------
  start(cfg) {
    const A = this.app, S = A.store, p = S.p; this.palettes(cfg.world);
    this.cfg = cfg; this.mode = cfg.mode; this.world = cfg.world; this.attract = null; this.M = MODES[cfg.mode] || {};
    this.stats = { kills: 0, food: 0, boost: 0, life: 0, best: 0, rankBest: 99, t0: performance.now(), lifeT0: performance.now(), deaths: 0, score: 0, timeLeft: 0, wave: 1 };
    this.combo = 0; this.comboT = 0; this.gainAcc = 0; this.gainT = 0; this.rankShown = 99; this.massMile = 0; this.liveMs = new Set(); this.puLast = null; this.hintI = 0; this.hintT = 4; this.stats.bonus = 0; this.stats.pu = 0; this.stats.bounty = 0; this.watching = false; this.killer = null; this.selfHit = false; this.deathCause = 0; this.emoT = 0; this.rainFx = null; this.evNow = null; // no stale killer from the last match
    this.matchT0 = performance.now(); this.slowWins = 0; this.goodWins = 0; this.slowQ = 0; this.qRose = false; this.ft.fill(1000 / (this.app.store.settings.fpsCap || 60)); this.ended = false; this.paused = false; this.deathT = 0; this.spectate = null; this.feed = []; this.lastLb = 0; this.killcam = null; this.victory = null; this.streak = 0; this.streakT = 0; this.endAt = 0; this.respawnAt = 0;
    if (!this.rec) this.rec = new Replay(); this.rec.reset(); this.rec.clip = null; this.rec.meRef = null; this.replay = null; this.rpPending = false; this.recMs = 0; this.recN = 0; this.app.ui.replayHide && this.app.ui.replayHide();
    this.zone = null; this.hill = null; this.boss = null; this.teamScore = [0, 0]; this.kothPts = new Map(); this.lives = this.M.lives || 0; this.win = false; this.place = 0;
    const skin = this.mySkin();
    const cb = {
      onEat: (me, x, y, v, c) => this.onEat(me, x, y, v, c), onDeath: (mr, by, cause) => this.onDeath(mr, by, cause), onMyDeath: (by, cause) => this.onMyDeath(by, cause),
      onKill: (id) => this.onKill(id), onSpawnMe: (s) => { this.camX = s.x; this.camY = s.y; this.view.cam.snap = true; },
      onStatus: (st, n) => this.onNet(st, n), onAnyDeath: (s, by) => this.onAnyDeath(s, by),
      onPu: (s, k, hit, p) => this.onPu(s, k, hit, p), onShield: (s) => this.onShield(s),
      onEvt: (e) => this.onEvt(e), onMeteor: (M) => this.onMeteor(M), onImpact: (x, y, r) => this.onImpact(x, y, r),
      onTrophy: (m) => this.onTrophy(m),
    };
    this.troMsg = null;
    if (cfg.mode === "online") {
      this.backend = new NetBackend({ room: cfg.room, name: p.name, skin, cb, bots: cfg.bots, pk: devKey(this.app.store) }); this.backend.connect(); this.hud.net(t("connecting"));
    } else {
      this.backend = new LocalBackend(cfg.mode, { diff: cfg.diff, seed: cfg.seed ?? (Math.random() * 1e9) | 0 }, cb); this.backend.spawn(p.name, skin);
      if (cfg.mode === "time") this.stats.timeLeft = MODES.time.dur;
      if (this.M.dur && cfg.mode !== "time") this.stats.timeLeft = this.M.dur;
      this.hud.net(""); this.setupMode();
    }
    this.r.setArena(this.backend.R || C.R); this.r.setWorld(cfg.world);
    A.audio.music(true, cfg.world, false); A.audio.setIntensity(0.2); A.input.reset(); A.input.enabled = true; this.running = true; this.hud.show(cfg.mode); this.startLoop();
    this.countdown = cfg.mode === "online" ? 0 : 1.6; this.intro = cfg.mode === "online" ? 1 : 1.6; // calm1: shorter start beat this.introDur = this.intro; this.cdShown = -1; this.timeScale = 1; this.slowUntil = 0;
    this.r.shakeA = 0; this.hud.modeHud(this.modeHudData());
  }
  setupMode() {
    const b = this.backend, S = b.sim, R = b.R;
    if (this.mode === "br") { this.zone = { x: 0, y: 0, r: R * 1.02, from: R * 1.02, to: R * 1.02, cx: 0, cy: 0, tx: 0, ty: 0, stage: 0, t: 0, phase: "wait", dmg: 1 }; S.zone = this.zone; this.zoneNext = 25; }
    if (this.mode === "koth") { this.hill = { x: 0, y: 0, r: 20, t: 0 }; this.moveHill(true); S.attractPt = { x: this.hill.x, y: this.hill.y, r: this.hill.r, w: 0.4 }; }
    if (this.mode === "team") { this.teamScore = [0, 0]; }
    if (this.mode === "boss") this.spawnBoss();
    this.xm = XMODES[this.mode] || null; XT.start(this); this._xl = ""; if (this.xm && this.xm.setup) this.xm.setup(this); // Track B
  }
  spawnBoss() {
    const b = this.backend, S = b.sim; const s = S.addSnake("LEVIATHAN", BOSS_SKIN, { bot: true, diff: 3, m: 2400, pos: [0, -b.R * 0.4] });
    s.rk = 1.9; s.lk = 0.62; s.setMass(2400); s.god = true; s.boss = true; s.ai.prey = b.me ? b.me.id : 0; s.vk = 0.92;
    this.boss = { s, hp: 8, max: 8, phase: 1, cores: [], hitT: 0 };
    this.hud.banner(t("bossAppears"), 2200); this.app.audio.play("roar"); this.r.shake && this.r.shake(1);
  }
  moveHill(first) { const R = this.backend.R, a = Math.random() * 6.283, d = first ? R * 0.15 : R * (0.2 + Math.random() * 0.4); this.hill.x = Math.cos(a) * d; this.hill.y = Math.sin(a) * d; this.hill.t = 0; if (this.backend.sim.attractPt) { this.backend.sim.attractPt.x = this.hill.x; this.backend.sim.attractPt.y = this.hill.y; } if (!first) { this.hud.banner(t("hillMoved"), 1400); this.app.audio.play("warn"); } }
  mySkin() { const p = this.app.store.p; const sk = p.skin.k === "custom" ? { k: "custom", p: p.custom.p, c: p.custom.c } : { k: p.skin.k, i: p.skin.i }; return { ...sk, e: p.eye, t: p.trail, n: p.nc, av: p.av, fr: p.frame }; }
  stopMatch() { if (this.backend && this.backend.close) this.backend.close(); this.backend = null; this.app.input && (this.app.input.enabled = false); this.app.audio.boost(false); this.killcam = null; this.victory = null; if (this.replay) { this.replay = null; this.app.ui.replayHide(); } }
  pause(on) {
    if (!this.mode || this.mode === "attract" || this.mode === "show" || this.ended) return;
    this.paused = on; this.app.audio.boost(false); this.app.input.reset();
    if (on) this.app.ui.showPause(this.mode === "online"); else this.app.ui.hidePause();
  }
  emote(i) {}
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
  onEat(me, x, y, v, c) {
    { const E = EV.eat; E.me = !!me; E.x = x; E.y = y; E.v = v; E.c = c | 0; emit("fx.eat", E); }
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
    if (near) { if (mine) this.r.ring(p.x, p.y, col, 4); this.r.burst(p.x, p.y, col, mine ? 22 : 8, mine ? 6 : 4, 0.7, 0.45, 4); }
    if (mine) {
      this.stats.pu++; A.audio.play("pu", { k }); haptic.pattern([12, 30, 18]); this.r.kick && this.r.kick(0.5, col, 0.12); this.r.light && this.r.light(p.x, p.y, [col[0] * 3, col[1] * 3, col[2] * 3], 1.2);
      this.hud.puFlash(k); // the HUD chip pops in; no text over the snake
      if (k === PU.FREEZE) { for (const id of hit) { const o = this.findSnake(id); if (o) this.r.ring(o.x, o.y, [0.6, 0.95, 1], 4); } this.hud.banner(hit.length ? t("frozeN", { n: hit.length }) : t("pu_5"), 1300); }
      if (k === PU.MEGA) { this.r.ring(me.x, me.y, col, 6); this.r.shake && this.r.shake(0.5); }
      if (k === PU.RAIN) { this.rainFx = { until: performance.now() + 2300 }; }
      if (k === PU.GIANT) { this.r.ring(me.x, me.y, col, 5); this.r.shake && this.r.shake(0.6); A.audio.play("roar"); }
      if (k === PU.MAG) this.hud.banner(t("pu_0"), 1100); // fix1: calm name banner, the ring around the head shows the reach
      if (k === PU.DASH) { this.r.kick && this.r.kick(1.1, col, 0.1); A.audio.play("whoosh"); this.hud.banner(t("pud_7"), 1600, "sub"); } // the rule in one line
    } else if (s && near) A.audio.at && A.audio.at("big", p.x, p.y);
    if (me && hit && hit.includes(me.id)) { this.hud.banner("❄ " + t("frozen"), 1400); A.audio.play("warn"); haptic.tap(30); this.hud.frost(PU_DUR[5]); }
  }
  // ---------- arena events: golden food rain, meteor shower, golden bounty ----------
  onEvt(e) {
    const A = this.app, me = this.backend && this.backend.me;
    if (e.ph === "start") {
      this.evNow = { k: e.k, until: performance.now() + (e.d || 12) * 1000, id: e.id || 0 };
      if (e.k === "rain") { this.hud.banner("✨ " + t("ev_rain"), 2200); A.audio.play("event"); }
      if (e.k === "drops") { this.hud.banner("🎁 " + t("ev_drops"), 2400); }
      if (e.k === "bounty") { const b = this.findSnake(e.id); if (b) b.bounty = true; if (me && e.id === me.id) this.hud.banner("💰 " + t("ev_bountyMe"), 2400); else this.hud.banner("💰 " + t("ev_bounty", { n: b ? b.name : "?" }), 2400); A.audio.play("event"); }
      this.hud.modeHud(this.modeHudData());
    } else if (e.ph === "claim") {
      const v = this.findSnake(e.id), k = e.by ? this.findSnake(e.by) : null; if (v) v.bounty = false;
      if (me && e.by === me.id) { this.stats.bounty++; this.stats.bonus += 500; this.hud.popup("💰 " + t("bountyBonus", { n: 500 }), "rank", this.r.project(me.x, me.y, 3.5)); A.audio.play("level"); haptic.pattern([20, 40, 20, 40]); if (v) this.r.confetti && this.r.confetti(v.x, v.y, 90); }
      else if (k && v) this.pushFeed("💰", t("bountyClaimed", { a: k.name, b: v.name }), false, "bounty");
      this.evNow = null; this.hud.modeHud(this.modeHudData());
    } else if (e.ph === "end") {
      if (e.k === "bounty") { const b = this.findSnake(e.id); if (b) b.bounty = false; this.hud.banner(t("bountyEnd"), 1400); }
      this.evNow = null; this.hud.modeHud(this.modeHudData());
    }
  }
  onMeteor(M) { const me = this.backend && this.backend.me; if (me && me.alive && Math.hypot(M.x - me.x, M.y - me.y) < 30) this.app.audio.at ? this.app.audio.at("warn", M.x, M.y) : this.app.audio.play("warn"); }
  onImpact(x, y, r) {
    const me = this.backend && this.backend.me, near = me ? Math.hypot(x - me.x, y - me.y) : 0; if (near > 70) return;
    this.r.ring(x, y, [1, 0.45, 0.15], r * 1.3); this.r.burst(x, y, [1.6, 0.6, 0.2], 40, 11, 1, 0.7, 6); this.r.burst(x, y, [0.4, 0.35, 0.3], 18, 6, 1.4, 0.9, 3); this.r.light && this.r.light(x, y, [3, 1.2, 0.4], 1.5);
    if (near < 40) { this.r.shake(Math.max(0.25, 1 - near / 40)); this.app.audio.play("meteor"); if (near < 14) haptic.tap(25); }
  }
  // ---------- quick emotes (bubble over the head; relayed online, bots answer sometimes) ----------
  emote(i) {
    const b = this.backend, me = b && b.me, now = performance.now(); if (!me || !me.alive || this.mode === "attract" || this.mode === "show" || now - this.emoT < 1200) return;
    this.emoT = now; me.emo = i; me.emoT = now; this.app.audio.play("emote"); if (b.sendEmo) b.sendEmo(i);
  }
  botEmote(s, i) { if (!s || !s.alive || !s.bot) return; s.emo = i; s.emoT = performance.now(); }
  onShield(s) {
    const A = this.app, me = this.backend && this.backend.me; if (!s) return;
    this.r.ring(s.x, s.y, [0.4, 0.8, 1], 4); this.r.burst(s.x, s.y, [0.4, 0.8, 1], 18, 6, 0.6, 0.45, 4);
    if (me && s.id === me.id) { A.audio.play("shieldHit"); haptic.pattern([30, 20, 30]); this.hud.banner("🛡 " + t("shieldSaved"), 1400); this.r.kick && this.r.kick(0.7, [0.3, 0.6, 1], 0.2); }
  }
  colOf(s) { const f = skinFn(s.skin || {}), col = [0, 0, 0]; f(2, 20, 0, col); return [toLin(col[0]), toLin(col[1]), toLin(col[2])]; }
  onDeath(mr, by, cause) {
    const s = mr.s; const f = skinFn(s.skin || {}), lin = this.colOf(s);
    { const E = EV.kill, k0 = by && by !== s.id ? this.findSnake(by) : null; E.s = s; E.x = s.x; E.y = s.y; E.id = s.id; E.by = by || 0; E.hasK = !!(k0 && k0.alive); E.kx = k0 ? k0.x : 0; E.ky = k0 ? k0.y : 0; emit("fx.kill", E); }
    const me = this.backend && this.backend.me; const dist = me ? Math.hypot(s.x - me.x, s.y - me.y) : 999;
    if (dist < 45) { this.r.shatter(s, f, this.app.store.settings.juice ? 60 : 25); this.r.burst(s.x, s.y, lin, 26, 9, 0.9, 0.65, 6); this.r.burst(s.x, s.y, [1, 1, 1], 10, 5, 0.4, 0.5, 3); if (this.app.store.settings.juice) { this.r.ring(s.x, s.y, lin, 7); this.r.light && this.r.light(s.x, s.y, [lin[0] * 2 + 0.6, lin[1] * 2 + 0.6, lin[2] * 2 + 0.6], 0.9); } }
    if (dist < 80 && (!by || by !== (me && me.id))) this.app.audio.at("die", s.x, s.y);
    const k = by ? this.findSnake(by) : null, self = !!by && (by === s.id || k === s);
    if (self) { if (dist < 200) this.pushFeed("☠", s.name, false, "self"); } // ran into its own body: one name, not "X ⚔ X"
    else if (by && by !== (me && me.id)) { if (k) this.pushFeed(k.name, s.name); }
    else if (!by && dist < 200) this.pushFeed("☠", s.name, false, cause === 6 ? "meteor" : cause === 3 && this.mode === "br" ? "storm" : "wall");
  }
  onAnyDeath(s, by) {
    if (this.xm && this.xm.onAnyDeath) this.xm.onAnyDeath(this, s, by); { const me0 = this.backend && this.backend.me; if (by && me0 && by === me0.id && s !== me0) XT.kill(this, s); } // Track B
    if (by && this.backend && this.backend.sim) { const k = this.findSnake(by), me = this.backend.me; if (k && k.bot && k !== s && me && Math.hypot(k.x - me.x, k.y - me.y) < 45 && Math.random() < (s === me ? 0.75 : 0.3)) this.botEmote(k, s === me ? (Math.random() < 0.5 ? 1 : 5) : [3, 5, 4][(Math.random() * 3) | 0]); }
    if (this.mode === "team" && by) { const k = this.findSnake(by); if (k && k.team !== undefined && k.team !== s.team) { this.teamScore[k.team]++; this.hud.modeHud(this.modeHudData()); if (this.teamScore[k.team] >= this.M.target) this.endMatch(k.team === 0, "team"); } }
    if (this.mode === "br" && !this.ended) { const alive = this.backend.sim.snakes.filter((x) => x.alive).length; if (s !== this.backend.me) { if (alive === 1 && this.backend.me && this.backend.me.alive) this.endMatch(true, "br"); } }
  }
  onKill(id) {
    this.stats.kills++; const A = this.app, now = performance.now(); { const v0 = this.findSnake(id), E = EV.mykill; E.id = id; E.x = v0 ? v0.x : 0; E.y = v0 ? v0.y : 0; emit("fx.mykill", E); } A.audio.play("kill"); haptic.pattern([15, 40, 25]); this.r.shake(0.7);
    const v = this.findSnake(id); this.pushFeed(t("you"), v ? v.name : "?", true);
    this.streak = now - this.streakT < 4000 ? this.streak + 1 : 1; this.streakT = now;
    const label = this.streak >= 4 ? t("rampage") : this.streak === 3 ? t("tripleKill") : this.streak === 2 ? t("doubleKill") : t("eliminated");
    this.hud.killBanner(label, v ? v.name : ""); if (this.streak >= 2) A.audio.play("streak");
    if (v) this.stats.bonus += Math.round(v.m * 0.25);
    if (v) { const lin = this.colOf(v); this.r.ring(v.x, v.y, lin, 7); this.r.kick && this.r.kick(0.9, [1, 1, 1], 0.12); this.r.light && this.r.light(v.x, v.y, [lin[0] * 2 + 0.5, lin[1] * 2 + 0.5, lin[2] * 2 + 0.5], 1.4); A.audio.play("shock"); }
    // slow-motion kill-cam (offline; online keeps real time but still frames the kill)
    const S = A.store.settings; if (v && S.juice && !S.reduceMotion && !S.calmFx && (this.streak >= 2 || v.m > 60 || Math.random() < 0.6)) this.killcam = { x: v.x, y: v.y, t0: now, dur: this.mode === "online" ? 700 : 1150, a0: Math.random() * 6.28 };
  }
  onMyDeath(by, cause) {
    const A = this.app, me = this.backend.me; if (!me) return;
    { const E = EV.death; E.x = me.x; E.y = me.y; E.cause = cause | 0; emit("fx.death", E); }
    this.stats.deaths++; const life = (performance.now() - this.stats.lifeT0) / 1000; this.stats.life = Math.max(this.stats.life, life);
    A.audio.play("die"); A.audio.boost(false); haptic.pattern([40, 30, 80]); this.r.shake(1.2); this.r.kick && this.r.kick(1.2, [0.6, 0, 0], 0.35);
    const f = skinFn(this.mySkin()), lin = this.colOf({ skin: this.mySkin() });
    const calm = A.store.settings.calmFx; if (!calm) { this.r.shatter(me, f, 40); this.r.burst(me.x, me.y, lin, 16, 9, 0.8, 0.7, 6); this.hud.flash(); } this.r.ring(me.x, me.y, [1, 1, 1], 6); // calm1: short, cheap death beat, no slow-motion
    me.alive = false; me.deadAt = performance.now(); this.deathT = performance.now(); if (this.qPend) setTimeout(() => this.flushQ(), 700); /* resp2 fix3 */ this.killer = by && by !== me.id ? this.findSnake(by) : null; if (this.killer === me) this.killer = null; const selfHit = (this.selfHit = false); /* noself1: own body never kills */ this.deathCause = cause;
    this.spectate = this.killer; A.input.enabled = false; A.input.reset(); this.streak = 0;
    const msg = by && this.killer ? t("killedBy", { n: this.killer.name }) : cause === 6 ? t("meteorDeath") : cause === 3 && this.mode === "br" ? t("stormDeath") : cause === 1 ? t("hitWall") : t("eliminated");
    if (by && this.killer) this.pushFeed(this.killer.name, t("you"), false); this.hud.combo(0); this.hud.puClear();
    const respawn = (this.mode === "time" && this.stats.timeLeft > 2) || this.mode === "koth" || this.mode === "team" || (this.mode === "boss" && --this.lives > 0) || !!(this.xm && this.xm.respawn && this.xm.respawn(this));
    if (respawn) { this.respawnAt = performance.now() + 1900; this.hud.banner(msg + (this.mode === "boss" ? " · " + t("livesN", { n: this.lives }) : ""), 1700); }
    else { if (this.mode === "br") this.place = this.backend.sim.snakes.filter((x) => x.alive).length + 1; this.endAt = performance.now() + 650; this.hud.banner(msg, 1200); // calm1: results almost straight away
      // replay1: freeze the last seconds as a clip; it plays after the short death beat, then results
      this.rpPending = false; if (this.rec && this.mode !== "zen" && A.store.settings.replay !== false) { if (this.rec.meRef === me) { this.build(0); this.rec.record(performance.now(), this.view, me, true); /* fix1: last sample = the frame of the actual contact */ } this.rpPending = this.rec.freeze({ cause, self: selfHit, killer: this.killer ? this.killer.id : 0 }); } else if (this.rec) this.rec.clip = null; }
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
    if (this.qPend) setTimeout(() => this.flushQ(), 700); // resp2 fix3: a queued tier change lands once the match is over
    if (win) {
      this.victory = { t0: performance.now(), dur: 3600, reason }; A.input.enabled = false; A.audio.boost(false); A.audio.play("victory"); haptic.pattern([30, 60, 30, 60, 90]);
      this.hud.cinematic(t("victory"), t("vic_" + reason)); const p = me && me.alive ? me : { x: this.camX, y: this.camY }; { const E = EV.pos; E.x = p.x; E.y = p.y; E.reason = reason; emit("fx.win", E); }
      if (this.r.confetti) { this.r.confetti(p.x, p.y, 180); setTimeout(() => this.r.confetti && this.backend && this.r.confetti(p.x + 3, p.y - 2, 140), 700); }
      this.r.ring(p.x, p.y, [1, 0.85, 0.3], 20); this.r.kick && this.r.kick(0.4, [1, 0.95, 0.8], 0.25);
    } else { A.audio.play("defeat"); this.endAt = performance.now() + 600; this.hud.cinematic(t("defeat"), t("def_" + reason), true); A.input.enabled = false; }
  }
  onTrophy(m) { // comp1
    if (m.t === "tro0") { applyServer(this.app.store, m); if (this.backend && this.backend.me) this.backend.me.tr = trophies(this.app.store.p); return; }
    if (this.ended && this.app.ui.lastCmp && this.app.ui.lastCmp.pending) onServerTrophy(this.app.ui, m); else this.troMsg = m;
  }
  finish(reason) {
    if (this.ended) return; this.ended = true; this.victory = null; this.killcam = null; const A = this.app, S = A.store, p = S.p, st = this.stats, me = this.backend && this.backend.me;
    A.input.enabled = false; A.audio.boost(false);
    const dur = (performance.now() - st.t0) / 1000; const mass = Math.round(me ? (reason === "time" ? me.m : st.best) : st.best);
    let score = mass; if (this.mode === "survival") score = Math.round(st.life * 10 + st.best); if (this.mode === "time") score = Math.round(st.endMass ?? mass);
    if (this.mode === "koth") score = Math.round(this.kothPts.get(me ? me.id : 0) || 0) * 10 + st.kills * 50; if (this.mode === "team") score = this.teamScore[0] * 100 + st.kills * 60; if (this.mode === "boss") score = (this.boss ? (this.boss.max - this.boss.hp) * 250 : 0) + (this.win ? 2000 : 0) + st.kills * 50; if (this.mode === "br") score = (this.win ? 3000 : Math.max(0, 25 - this.place) * 80) + st.kills * 100 + Math.round(st.best);
    if (this.mode !== "zen") score += Math.round(st.bonus || 0);
    if (this.xm && this.xm.score) score = this.xm.score(this, score) + Math.round(st.bonus || 0); this.xres = xFinish(this, score); // Track B
    const diffMul = [0.75, 1, 1.25, 1.5][this.cfg.diff ?? 1] * (this.mode === "online" ? 1.3 : 1) * (this.mode === "zen" ? 0.4 : 1) * (this.win ? 1.5 : 1);
    const xp = Math.round((st.best / 8 + st.kills * 30 + Math.min(dur, 900) / 4 + (this.mode === "survival" ? st.wave * 25 : 0) + (this.win ? 150 : 0) + (st.pu || 0) * 6 + (st.bonus || 0) / 20) * diffMul) + 10;
    const coins = Math.round(xp / 4) + (st.bounty || 0) * 100;
    const P = p.stats; P.games++; P.kills += st.kills; P.deaths += st.deaths; P.food += st.food; P.best = Math.max(P.best, Math.round(st.best)); P.time += Math.round(dur); P.life = Math.max(P.life, Math.round(st.life)); P.boost += Math.round(st.boost);
    if (this.mode === "online") P.online++; if (this.mode === "zen") P.zen += Math.round(dur); if (this.mode === "survival") P.wave = Math.max(P.wave, st.wave); if (this.mode === "time") P.tbest = Math.max(P.tbest, score);
    if (this.win) { P.wins = (P.wins || 0) + 1; if (this.mode === "br") P.brWins = (P.brWins || 0) + 1; if (this.mode === "koth") P.kothWins = (P.kothWins || 0) + 1; if (this.mode === "team") P.teamWins = (P.teamWins || 0) + 1; if (this.mode === "boss") P.bossKills = (P.bossKills || 0) + 1; }
    if (st.rankBest === 1 && this.mode !== "zen") P.top++;
    p.coins += coins; const lv = S.addXp(xp); const tiers = S.addSeasonXp(xp);
    const bestKey = this.mode; const pos = S.addBest(bestKey, { s: score, k: st.kills, d: Date.now(), w: this.world, m: Math.round(st.best) });
    const missions = S.missionProgress({ food: st.food, kills: st.kills, mass: st.best, life: st.life, boost: st.boost, online: this.mode === "online" });
    const mp = S.matchProgress({ food: st.food, kills: st.kills, mass: st.best, life: st.life, boost: st.boost, wave: st.wave, mode: this.mode, win: this.win || st.rankBest === 1 });
    const rank = this.mode === "br" ? (this.win ? 1 : this.place || "—") : st.rankBest < 99 ? st.rankBest : "—";
    // ranked points + history (last 10) + games per mode for the profile
    const rk0 = rankOf(p.rp).i, rp = rpDelta({ mode: this.mode, rank: typeof rank === "number" ? rank : 99, win: this.win, kills: st.kills }); p.rp = Math.max(0, p.rp + rp); const rankUp = rankOf(p.rp).i > rk0;
    S.pushHistory({ m: this.mode, s: score, k: st.kills, r: typeof rank === "number" ? rank : 0, w: this.win ? 1 : 0, ms: Math.round(st.best), t: Math.round(dur), d: Date.now(), rp });
    // comp1: trophies. Offline: decided now (capped). Online: the server's "tro" for this life (maybe already here) decides.
    const field = Math.max(2, st.field | 0, typeof rank === "number" ? rank : 2), room = this.cfg.room || "";
    let cmp = afterMatch(S, { mode: this.mode, place: this.win ? 1 : typeof rank === "number" ? rank : field, field, kills: st.kills, life: this.mode === "online" ? Math.max(st.life, 0) : dur, score, online: this.mode === "online", priv: this.mode === "online" && !!room && !/^pub-/.test(room) });
    if (cmp.pending && this.troMsg) { const m = this.troMsg; this.troMsg = null; const res = applyServer(S, m); cmp = m.err ? { none: "err" } : { ...res, d: res.d }; }
    else if (cmp.pending) setTimeout(() => { const U = A.ui; if (U.lastCmp === cmp && cmp.pending) onServerTrophy(U, { err: 1 }); }, 9000);
    const ach = S.checkAch(); S.save();
    const title = this.win ? t("victory") : reason === "time" ? t("timeUp") : this.mode === "zen" ? t("zenDone") : t("gameOver");
    const sub = this.win ? t("vic_" + this.mode) : this.killer ? t("killedBy", { n: this.killer.name }) : this.deathCause === 6 ? t("meteorDeath") : this.deathCause === 3 && this.mode === "br" ? t("stormDeath") : this.deathCause === 1 ? t("hitWall") : "";
    this.watching = false; A.ui.showResults({ cmp, replay: !!(this.rec && this.rec.clip), killer: this.killer && this.killer.alive && !this.win ? this.killer : null, seasonXp: xp, pu: st.pu || 0, title, sub, score, mass: Math.round(st.best), kills: st.kills, rank, time: dur, xp, coins: coins + lv.coins, lv, newBest: pos === 0 && score > 0, missions, ach, mode: this.mode, wave: st.wave, win: this.win, tiers, mp, rp, rankUp });
    if (lv.up) A.audio.play("level"); else if (ach.length) A.audio.play("ach");
    if (pos === 0 && score > 0 && this.r.confetti && me) this.r.confetti(me.x, me.y, 120);
  }

  // ---------- frame ----------
  loop(ts) {
    this.raf = requestAnimationFrame(this._loop);
    const A = this.app, set = A.store.settings;
    // perf2: nothing is drawn while the page is hidden (the clock keeps running, so dt on return is clamped as before)
    if (document.hidden) return;
    const G = this.gov || (this.gov = new Governor()); if (!this.app.gov) this.app.gov = G;
    const cap = G.fpsCap(set.fpsCap); if (cap && this.lastFrame && ts - this.lastFrame < 1000 / cap - 2.5) return;
    if (this.lastFrame) { const menu = this.mode === "show" || !!this._frozen, live = !menu && this.mode !== "attract" && !!this.backend && !this.replay && !(this.countdown > 0);
      G.sample(ts - this.lastFrame, ts, { auto: set.quality === "auto", menu, inMatch: live, target: 1000 / Math.min(60, set.fpsCap || 60), apply: (L) => { if (this.r && this.r.setGov) this.r.setGov(L); } }); }
    const dt = this.lastFrame ? Math.min(0.1, (ts - this.lastFrame) / 1000) : 1 / 60; this.lastFrame = ts; this.t += dt;
    const c0 = performance.now();
    try { this.tick(dt, ts); } catch (e) { console.error(e); A.ui.toast(t("oops"), "warn"); if (this.mode !== "attract" && this.mode !== "show") { this.ended = true; this.stopMatch(); A.ui.goLobby(); } }
    if (!this.cpu) this.cpu = new Float32Array(1024); this.cpu[this.cpuI = ((this.cpuI || 0) + 1) & 1023] = performance.now() - c0;
  }
  tick(dt, ts) {
    const A = this.app, set = A.store.settings; if (!this.r) return;
    this.ft[this.fi++ % this.ft.length] = dt * 1000;
    if (set.showFps && ts - this.fpsShown > 500) { this.fpsShown = ts; const n = Math.min(this.fi, 60); let s = 0; for (let k = 1; k <= n; k++) s += this.ft[(this.fi - k + this.ft.length) % this.ft.length]; this.hud.fps(Math.round(1000 / (s / n)), set.quality === "auto" && this.gov ? (this.r.is2D ? "2D " : (this.r.qName || "") + " ") + this.gov.tier : ""); }
    if (set.quality === "auto" && this.fi % 120 === 0 && this.fi > 240 && !document.hidden && this.mode !== "show") this.autoQuality();
    if (this.mode === "show") { const sh = this.show; // resp1: a still backdrop (full-screen panel open) renders ~0.6 s, then holds the last frame
      if (sh && sh.still) { if (this._stillRef !== sh) { this._stillRef = sh; this._stillT = 0; } this._stillT += dt; if (this._stillT > 0.6) return; } else this._stillRef = null;
      const v = this.view; v.t = this.t; v.dt = dt; v.scene = "show"; v.show = this.show; v.fpsTarget = (this.gov ? this.gov.fpsCap(set.fpsCap) : set.fpsCap) || 60; this.r.frame(v); return; }
    const b = this.backend; if (!b) return; this.view.scene = "world";
    // calm1: behind the results card or the pause menu the last frame stays on screen; nothing is re-rendered
    if ((this.ended && !this.watching && !this.replay) || (this.paused && this.mode !== "online")) { if (this._frozen) return; this._frozen = true; } else this._frozen = false;
    const me = b.me; const now = performance.now();
    if (this.replay) { if (b.online && !this.ended) b.update(dt); this.replayTick(dt, now); return; }
    const cine = this.killcam || this.victory;
    if (this.mode !== "attract" && !this.paused && !this.ended && me && me.alive && !this.victory) {
      const ang = A.input.poll(me.ta ?? me.a, dt); let boost = A.input.boost;
      if (ang !== null && ang !== undefined) b.setInput(A.input.world ? ang : this.screenToWorldAng(ang, me), boost); else b.setInput(me.ta ?? me.a, boost);
      const boosting = !!boost && me.m > C.MIN_BOOST_M; A.audio.boost(boosting); if (boosting) { this.stats.boost += dt; if (!this._wasBoost) { this.r.kick && this.r.kick(0.35); } } if (boosting !== !!this._wasBoost) { EV.boost.on = boosting; emit("fx.boost", EV.boost); } this._wasBoost = boosting;
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
    this.build(dt); this.view.fpsTarget = (this.gov ? this.gov.fpsCap(set.fpsCap) : set.fpsCap) || 60; this.r.frame(this.view);
    // replay1: ring buffer of the last 5 s near the player (20 Hz, typed arrays, no allocation per sample)
    if (this.rec && me && me.alive && !this.ended && !this.victory && this.mode !== "attract" && this.mode !== "zen" && !(this.countdown > 0) && set.replay !== false) {
      if (this.rec.meRef !== me) { this.rec.reset(); this.rec.meRef = me; } const r0 = performance.now(), c0 = this.rec.count, h0 = this.rec.head; this.rec.record(now, this.view, me, false); if (this.rec.head !== h0 || this.rec.count !== c0) { this.recMs += performance.now() - r0; this.recN++; } }
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
    XT.tick(this); if (this.xm && this.xm.rule && !this.ended) this.xm.rule(this, dt); // Track B
    if (this.endAt && now > this.endAt) { this.endAt = 0; if (this.rpPending && !this.ended) { this.rpPending = false; this.playReplay(false); } else this.finish("death"); }
  }
  timeUp() {
    if (this.xm && this.xm.timeUp) return this.xm.timeUp(this); // Track B
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
  modeHudData() { const d = this.modeHudBase(), E = this.evNow; if (!E || performance.now() > E.until) return d; const b = E.k === "bounty" ? this.findSnake(E.id) : null; return { ...(d || {}), ev: { k: E.k, name: b ? b.name : "" } }; }
  modeHudBase() { if (this.mode === "zen") return { kind: "zen" };
    if (this.xm && this.xm.hud) return this.xm.hud(this); // Track B
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
      e.alpha = s.alive ? 1 : Math.max(0, 1 - (now - (s.deadAt || now)) / 450); e.scale = s.alive ? 1 : 1 + (1 - e.alpha) * 0.25; e.look = s.ta; e.top = false; e.top1 = false; e.used = true; e.ox = me && b.vox ? b.vox : 0; e.oy = me && b.voy ? b.voy : 0;
      e.team = s.team !== undefined ? TEAM_COL[s.team] : null; if (s.team !== undefined) e.nc = TEAM_CSS[s.team]; if (s.boss) { e.nc = "#ff4040"; e.glow = [1, 0.1, 0.1]; e.team = null; } else e.glow = null;
      if (s.boss && this.boss && this.boss.phase === 3) e.glow = [1.6, 0.2, 0.05];
      if (s.bounty) { e.glow = [1.5, 1.05, 0.15]; e.nc = "#ffd23a"; e.name = "💰 " + s.name; }
      e.inv = false; e.giant = !!(s.pu && s.pu[9] > 0); e.dash = !!(s.pu && s.pu[7] > 0); if (e.dash) { e.boost = true; if (!e.glow) e.glow = [0.3, 0.95, 1.2]; } // dash: soft steady cyan glow (harmless while active)
      e.emo = s.emoT && now - s.emoT < 2600 ? EMOTES[s.emo] || null : null; e.emoI = s.emo | 0; e.gold = !!s.bounty;
      list.push(e); return e;
    };
    for (const e of this.entries.values()) e.used = false;
    if (b.sim) { for (const s of b.sim.snakes) if (s.n > 2) add(s, 1, alpha, s === b.me, s.boosting); }
    else { b.prepareOthers(); for (const mr of b.mirrors.values()) add(mr.s, mr.s._ro, mr.s._rf, false, mr.boost); if (b.me) add(b.me, 1, alpha, true, b.me.boosting); }
    for (const [k, e] of this.entries) if (!e.used) this.entries.delete(k);
    for (let q = 0; q < 3; q++) { let best = null; for (const e of list) if (!e.top && e.s.alive && (!best || e.s.m > best.s.m)) best = e; if (best) { best.top = true; if (q === 0) best.top1 = true; } }
    v.food = b; v.ghosts = b.ghosts; v.pus = b.pus || null; v.mets = b.mets || null; v.tick = b.sim ? b.sim.tick : undefined;
    v.rain = this.rainFx && now < this.rainFx.until && b.me && b.me.alive ? b.me : null; v.goldRain = this.evNow && this.evNow.k === "rain" && now < this.evNow.until && b.me ? b.me : null;
    v.zone = this.zone && this.mode === "br" ? this.zone : null; v.hill = this.hill && this.mode === "koth" ? { x: this.hill.x, y: this.hill.y, r: this.hill.r, c: this.hill.mine ? [0.3, 1, 0.5] : this.hill.contested ? [1, 0.3, 0.3] : [1, 0.8, 0.2] } : null;
    v.cores = this.boss && this.boss.s.alive ? this.boss.cores : null; v.goldMode = this.mode === "goldrush"; // candy1: Gold Rush gold renders as coins
    if (this.xm && this.xm.view) this.xm.view(this, v); // Track B
    // camera
    const me = b.me; let tx = this.camX, ty = this.camY, zoom = 1; const cam = v.cam;
    cam.gz = 1; cam.title = undefined; cam.intro = undefined; cam.kill = null; cam.victory = undefined; cam.orbit = undefined; v.letterbox = false; v.hideNames = false;
    if (this.mode === "attract") {
      const lead = b.sim.leaderboard(1)[0]; if (lead) { tx = lead.x * 0.3; ty = lead.y * 0.3; }
      if (this.titleT !== undefined) { this.titleT += dt; cam.title = this.titleT; v.hideNames = true; } else { this.orbit += dt * 0.05; cam.orbit = this.orbit; } zoom = 1.9;
    } else {
      const foc = this.spectate && this.spectate.alive ? this.spectate : me;
      if (foc) { const head = foc === me && me.alive ? lerpHead(me, alpha) : (_LH[0] = foc.x, _LH[1] = foc.y, _LH); if (foc === me && b.vox) { head[0] += b.vox; head[1] += b.voy; }
        const la = (foc.boosting ? 4.2 : 2.6) * (1 + Math.max(0, foc.r - 0.6) * 0.5); this.lookX = (this.lookX || 0) + (Math.cos(foc.a) * la - (this.lookX || 0)) * Math.min(1, dt * 5); this.lookY = (this.lookY || 0) + (Math.sin(foc.a) * la - (this.lookY || 0)) * Math.min(1, dt * 5);
        tx = head[0] + this.lookX; ty = head[1] + this.lookY; zoom = 1 + Math.max(0, foc.r - 0.6) * 0.55; cam.boost = !!foc.boosting && foc === me;
        if (foc === me && me.alive) { // zoom1: own live snake: zoom out with mass (log) + radius, eased over ~1 s; spectate/death keep the old radius rule
          const R = this.r || {}, zt = growZoom(me.m || 0, me.r || 0.6, (R.w || 16) / (R.h || 9), !!R.is2D);
          if (cam.snap || !(this.gz > 0)) this.gz = zt; else this.gz += (zt - this.gz) * (1 - Math.exp(-Math.min(0.1, dt) * 3));
          zoom = this.gz; cam.gz = this.gz; } else { this.gz = 0; cam.gz = 1; } }
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
    all.sort((a, c) => c.m - a.m); const rank = me && me.alive ? all.indexOf(me) + 1 : 0; if (rank > 0) st.rankBest = Math.min(st.rankBest, rank); if (all.length > (st.field | 0)) st.field = all.length; // comp1: field size for trophies
    let top = all.slice(0, 5), scoreList = null;
    if (this.xm && this.xm.lb) scoreList = this.xm.lb(this); // Track B
    if (this.mode === "koth") scoreList = [...this.kothPts.entries()].sort((a, c) => c[1] - a[1]).slice(0, 5).map(([id, v]) => ({ s: this.findSnake(id), v: Math.floor(v) })).filter((x) => x.s);
    this.hud.update({ mass: me && me.alive ? me.m : 0, rank, total: all.length, top, me, kills: st.kills, timeLeft: this.M && (this.mode === "time" || this.M.dur) ? st.timeLeft : null, wave: this.mode === "survival" ? st.wave : null, ping: b.online ? b.ping : null, nq: b.online ? b.quality : null, humans: b.online ? b.humans : null, scoreList, kothMine: this.mode === "koth" && me ? Math.floor(this.kothPts.get(me.id) || 0) : null, target: this.M && this.M.target, alive: this.mode === "br" ? all.length : null, zone: this.zone && this.zone.phase === "wait" ? Math.ceil(this.zoneNext) : null, hill: this.hill });
    if (this.app.store.settings.minimap) this.hud.minimap(all, me, b.R || C.R, this.view.foodPalCss, this.zone, this.hill, this.boss && this.boss.s, b.pus);
    if (me && me.alive && !this.ended) {
      this.hud.pu(me.pu, me.slow);
      // rank / mass milestones
      if (rank > 0 && rank < this.rankShown && (rank === 1 || rank <= 3 || (rank <= 10 && this.rankShown > 10)) && performance.now() - st.t0 > 4000) { this.hud.popup(rank === 1 ? "👑 " + t("rankTop") : t("rankUp", { n: rank }), "rank", this.r.project(me.x, me.y, 3.5)); this.app.audio.play(rank === 1 ? "level" : "toast"); if (rank === 1) { const E = EV.pos; E.x = me.x; E.y = me.y; emit("fx.rank1", E); } }
      if (rank > 0) this.rankShown = rank;
      const MILES = [100, 250, 500, 1000, 2500, 5000, 10000]; const mi = MILES.findIndex((x) => me.m < x); const reached = mi < 0 ? MILES.length : mi;
      if (reached > this.massMile) { this.massMile = reached; this.hud.popup("⬆ " + t("massN", { n: fmtNum(MILES[reached - 1]) }), "rank", this.r.project(me.x, me.y, 4)); this.app.audio.play("ach"); haptic.tap(15); const E = EV.pos; E.x = me.x; E.y = me.y; E.n = reached; emit("fx.levelup", E); }
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
    const H = ["hint_steer", "hint_boost", "hint_eat", "hint_pu", "hint_cut", "hint_dead"]; if (this.hintI >= H.length) return; const hk = H[this.hintI++], mo = !document.documentElement.classList.contains("touch") && (hk === "hint_steer" || hk === "hint_boost"); this.hud.hint(t(mo ? hk + "_m" : hk)); // resp1: mouse-only devices get mouse wording this.hintT = 9;
  }
  // fix1: pointer/joystick angles are screen directions; the 3D camera is tilted, so screen up/down is foreshortened.
  // Map the screen direction through the camera's local Jacobian at the head (identity in 2D) so the head points exactly
  // where the finger points on screen, in 2D and 3D alike.
  screenToWorldAng(a, me) {
    const r = this.r; if (!r || !r.project || r.is2D) return a; const h = me.r || 0.6;
    const p0 = r.project(me.x, me.y, h), px = r.project(me.x + 1, me.y, h), py = r.project(me.x, me.y + 1, h);
    const ax = px[0] - p0[0], ay = px[1] - p0[1], bx = py[0] - p0[0], by = py[1] - p0[1], det = ax * by - ay * bx; if (!(Math.abs(det) > 1e-6)) return a;
    const ux = Math.cos(a), uy = Math.sin(a), wx = (ux * by - uy * bx) / det, wy = (ax * uy - ay * ux) / det; return Math.atan2(wy, wx);
  }
  // ---------- replay1: death replay ----------
  playReplay(fromResults) {
    const R = this.rec; if (!R || !R.clip || !this.backend || !this.r) return false; R.start(); const A = this.app;
    const k = R.clip.killer ? this.findSnake(R.clip.killer) || (this.killer && this.killer.id === R.clip.killer ? this.killer : null) : null;
    this.replay = { from: !!fromResults, killer: R.clip.killer, kname: k ? k.name : (R.meta.get(R.clip.killer) || {}).name || "" };
    A.input.enabled = false; A.audio.boost(false); this.hud.hide(); this.hud.bannerClear && this.hud.bannerClear(); this.r.clearFx && this.r.clearFx();
    if (fromResults) document.getElementById("m-results").classList.add("x-hide");
    const M = R.meta.get(R.clip.killer) || {}; A.ui.replayShow({ killer: R.clip.killer ? { name: this.replay.kname, avt: (k && k.avt) || M.avt, fr: (k ? k.fr : M.fr) | 0 } : null, cause: R.clip.cause, self: R.clip.self, mode: this.mode });
    this._frozen = false; this.startLoop(); return true;
  }
  replayAgain() { if (this.replay && this.rec && this.rec.clip) { this.rec.start(); this.r.clearFx && this.r.clearFx(); } }
  replayTick(dt, now) {
    const R = this.rec, Rp = this.replay; R.advance(dt);
    const v = R.view(this.view, dt, this.t, Rp.killer); v.fpsTarget = (this.gov ? this.gov.fpsCap(this.app.store.settings.fpsCap) : this.app.store.settings.fpsCap) || 60; this.r.frame(v); R.cam.snap = false;
    if (!R.impactFired && R.c >= R.clip.t1) { R.impactFired = true; this.r.ring(R.clip.ix, R.clip.iy, [0.55, 0.32, 0.28], 2.2); } // fix1: small, soft, centred on the contact
    this.app.ui.replayProg(R.progress());
    if (R.done) this.endReplay();
  }
  endReplay() {
    const Rp = this.replay; if (!Rp) return; this.replay = null; this.app.ui.replayHide(); this.r.clearFx && this.r.clearFx();
    if (Rp.from || this.ended) { this._frozen = false; this.app.ui.reshowResults(); } else this.finish("death");
  }
  // after a game over: follow the killer for a while
  watchKiller() {
    const k = this.killer; if (!k || !k.alive || !this.backend) return false; this.watching = true; this.spectate = k; this.app.ui.hideResults(); this.hud.spectate(k.name); this.running = true; return true;
  }
  stopWatch() { this.watching = false; this.spectate = null; this.hud.spectate(null); this.app.ui.reshowResults(); }
  // sharp1: tier changes rebuild materials and meshes (a visible hitch), so they are rare: drop one tier only after two
  // slow windows in a row (~4 s), rise at most once per match after six good windows, never two changes within 10 s.
  // The 2D renderer has no tiers that matter, so it is never touched.
  autoQuality() {
    const A = this.app; if (this.r.is2D) return;
    const n = this.ft.length, arr = this._ftS || (this._ftS = new Float32Array(n)); arr.set(this.ft); arr.sort(); const p90 = arr[Math.floor(n * 0.9)];
    const target = 1000 / ((this.gov ? this.gov.fpsCap(A.store.settings.fpsCap) : A.store.settings.fpsCap) || 60), order = ["low", "medium", "high", "ultra"], cur = this.r.qName, i = order.indexOf(cur), now = performance.now(), calm = now - (this.qChangeT || 0) > 10000;
    // resp2 fix3: a tier change rebuilds meshes and recompiles shaders (a visible stutter), so mid-match it is only queued
    // and applied at death / match end (flushQ); the governor's cheap live knobs carry the match meanwhile. Applied live
    // only under severe sustained slowness: p90 over 2.2x the frame budget for 4 windows in a row (~8 s).
    const me = this.backend && this.backend.me, live = !!(me && me.alive && !this.ended);
    if (!live && this.qPend) { this.flushQ(); return; }
    if (p90 > target * 1.45) {
      this.goodWins = 0; this.slowQ = (this.slowQ || 0) + 1; this.sevQ = p90 > target * 2.2 ? (this.sevQ || 0) + 1 : 0;
      if (i > 0 && this.slowQ >= 2 && calm && (!live || this.sevQ >= 4)) { this.slowQ = 0; this.sevQ = 0; this.qPend = order[i - 1]; this.flushQ(); }
      else if (i > 0 && this.slowQ >= 2 && live) { this.qPend = order[i - 1]; }
      // 2D only after a sustained real problem: already at low, well past the first seconds of the match (shader/stream
      // stalls), and three slow windows in a row (~6 s). Never persisted (see switchRenderer), so the next launch retries 3D.
      else if (i === 0 && p90 > 45 && now - (this.matchT0 || 0) > 15000) { if (++this.slowWins >= 3) { this.slowWins = 0; A.switchRenderer("2d", true); } }
    } else if (p90 < target * 1.08) { this.slowWins = 0; this.slowQ = 0; if (++this.goodWins >= 6 && calm && !this.qRose && !this.qPend && i >= 0 && i < (A.maxAuto || 2)) { this.goodWins = 0; this.qRose = true; this.qPend = order[i + 1]; if (!live) this.flushQ(); } this.sevQ = 0; }
    else { this.goodWins = 0; this.slowWins = 0; this.slowQ = 0; this.sevQ = 0; }
  }
  // resp2 fix3: apply a queued tier change (death, match end, or severe sustained slowness). The first drop leaves one
  // quiet note in the notification bell instead of a toast over the play field.
  flushQ() {
    const q = this.qPend, A = this.app; this.qPend = null; if (!q || !this.r || this.r.is2D || q === this.r.qName) return;
    const down = ["low", "medium", "high", "ultra"].indexOf(q) < ["low", "medium", "high", "ultra"].indexOf(this.r.qName);
    this.qChangeT = performance.now(); A.applyQuality(q); this.ft.fill(1000 / ((this.gov ? this.gov.fpsCap(A.store.settings.fpsCap) : A.store.settings.fpsCap) || 60));
    if (down && !A.autoNoted) { A.autoNoted = true; A.ui.note(t("autoLow"), "⚙"); }
  }

}
const _LH = [0, 0]; // reused: no per-frame allocation
// zoom1: gameplay camera zoom for the player's own snake. Grows on a log curve of mass (score) plus a radius term, capped
// (2D 2.4, 3D 2.0: the 3D view also widens its cull/fog/shadow ranges with it). Portrait screens get up to +15 % so the
// narrow side still shows enough ahead. m = START_M (24) -> 1.0 in landscape.
export function growZoom(m, r, asp, is2D) {
  const zl = 0.26 * Math.log(1 + Math.max(0, m - 24) / 40), zr = Math.max(0, r - 0.6) * 0.35;
  const ak = asp < 1 ? 1 + 0.15 * Math.min(1, (1 / asp - 1) / 1.2) : 1;
  return Math.min(is2D ? 2.4 : 2.0, (1 + zl + zr)) * ak;
}
function lerpHead(s, a) { const x1 = s.sx(1), y1 = s.sy(1); _LH[0] = x1 + (s.sx(0) - x1) * a; _LH[1] = y1 + (s.sy(0) - y1) * a; return _LH; }
