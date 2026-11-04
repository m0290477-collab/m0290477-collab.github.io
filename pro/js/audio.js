// Super Snake Pro audio engine — 100% original WebAudio synthesis, no sample files (nothing to license).
// • Convolution reverb from a generated stereo impulse, master bus compressor + soft limiter
// • Layered adaptive music per world (pad / bass / arp / drums / lead / choir): intensity 0..1 from the
//   game (size, danger, boss) fades layers in and opens the filter; a calmer lobby theme for menus
// • Spatial 3D audio (HRTF PannerNodes) for other snakes' kills, deaths and boosts around the camera
// • Full UI set (hover, click, tab, back, toggle, toast, reward, unlock, reveal) and impact SFX
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// per world: root, scale, chord degrees, bpm, timbre, drum feel
const TH = [
  { root: 57, sc: [0, 2, 3, 5, 7, 9, 10], prog: [0, 5, 3, 4], bpm: 96, lead: "triangle", pad: "sawtooth", kit: "tribal" }, // jungle: dorian, marimba-ish
  { root: 52, sc: [0, 1, 4, 5, 7, 8, 10], prog: [0, 1, 0, 6], bpm: 88, lead: "sawtooth", pad: "sawtooth", kit: "frame" }, // babylon: hijaz
  { root: 60, sc: [0, 2, 4, 7, 9, 11, 14], prog: [0, 5, 3, 4], bpm: 78, lead: "sine", pad: "triangle", kit: "soft" }, // ice: lydian bells
  { root: 55, sc: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 6, 4], bpm: 118, lead: "square", pad: "sawtooth", kit: "synth" }, // neon: synthwave minor
  { root: 50, sc: [0, 1, 3, 5, 7, 8, 10], prog: [0, 6, 5, 1], bpm: 104, lead: "sawtooth", pad: "sawtooth", kit: "heavy" }, // volcano: phrygian
  { root: 62, sc: [0, 2, 4, 6, 7, 9, 11], prog: [0, 2, 4, 5], bpm: 84, lead: "sine", pad: "triangle", kit: "soft" }, // nebula: lydian ambient
];
// calm Zen theme: slow lydian pads and soft bells, no drums
const ZEN = { root: 60, sc: [0, 2, 4, 6, 7, 9, 11], prog: [0, 3, 5, 3], bpm: 62, lead: "sine", pad: "triangle", kit: "none" };
// SFX that belong to the interface bus (own volume slider)
const UI_SND = new Set(["hover", "click", "tab", "toggle", "back", "toast", "coin", "chime", "reward", "ach", "error", "spin", "pause", "reveal", "level", "mission"]);
import { on as onEvt } from "./events.js?v=perf3";
const LOBBY = { root: 57, sc: [0, 2, 4, 7, 9, 11, 14], prog: [0, 5, 3, 4], bpm: 80, lead: "triangle", pad: "sawtooth", kit: "soft" };

export class Audio {
  constructor() { this.ctx = null; this.vol = { master: 0.8, sfx: 0.9, music: 0.45, ui: 0.8 }; this.zen = false; this._storm = null; this._eatT = 0; this.world = 0; this.musicOn = false; this.ok = !!(window.AudioContext || window.webkitAudioContext); this._boost = null; this.lastEat = 0; this.eatCombo = 0; this.intensity = 0; this.menu = true; this.lastHover = 0;  this.bindEvents();}
  unlock() {
    if (!this.ok) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC({ latencyHint: "interactive" }); const c = this.ctx;
        this.lim = c.createDynamicsCompressor(); this.lim.threshold.value = -6; this.lim.knee.value = 4; this.lim.ratio.value = 12; this.lim.attack.value = 0.003; this.lim.release.value = 0.15; this.lim.connect(c.destination);
        this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -18; this.comp.ratio.value = 3; this.comp.connect(this.lim);
        this.master = c.createGain(); this.master.connect(this.comp);
        this.sfx = c.createGain(); this.sfx.connect(this.master); this.uiBus = c.createGain(); this.uiBus.connect(this.master); this.mus = c.createGain(); this.mus.connect(this.master);
        this.musLP = c.createBiquadFilter(); this.musLP.type = "lowpass"; this.musLP.frequency.value = 1800; this.musLP.Q.value = 0.6; this.musLP.connect(this.mus);
        // reverb: generated stereo impulse (exponentially decaying filtered noise), shared send bus
        this.verb = c.createConvolver(); this.verb.buffer = this._impulse(2.6, 2.8); this.verbIn = c.createGain(); this.verbIn.gain.value = 0.9; this.verbIn.connect(this.verb); const vo = c.createGain(); vo.gain.value = 0.55; this.verb.connect(vo); vo.connect(this.master);
        this.musVerb = c.createGain(); this.musVerb.gain.value = 0.32; this.musLP.connect(this.musVerb); this.musVerb.connect(this.verbIn);
        this.sfxVerb = c.createGain(); this.sfxVerb.gain.value = 0.22; this.sfx.connect(this.sfxVerb); this.sfxVerb.connect(this.verbIn);
        const len = c.sampleRate; this.noise = c.createBuffer(1, len, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // music layers (gain per layer follows intensity)
        this.L = {}; for (const k of ["pad", "bass", "arp", "drum", "lead", "choir"]) { const g = c.createGain(); g.gain.value = 0; g.connect(this.musLP); this.L[k] = g; }
        this.delay = c.createDelay(1); this.delay.delayTime.value = 0.36; this.fb = c.createGain(); this.fb.gain.value = 0.3; const dl = c.createBiquadFilter(); dl.type = "lowpass"; dl.frequency.value = 2400; this.delay.connect(dl); dl.connect(this.fb); this.fb.connect(this.delay); dl.connect(this.musLP);
        this.listener = c.listener; this.applyVol(); this._layers(true);
      }
      if (this.ctx.state !== "running") { const r = this.ctx.resume(); if (r && r.catch) r.catch(() => {}); } // "suspended" or iOS "interrupted"
    } catch (_) { this.ok = false; }
  }
  _impulse(sec, decay) { const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; lp = lp * 0.82 + w * 0.18; const e = Math.pow(1 - i / n, decay); d[i] = (i < c.sampleRate * 0.012 ? w * 0.5 : lp * 1.6) * e; } } return b; }
  setVol(v) { Object.assign(this.vol, v); this.applyVol(); }
  applyVol() { if (!this.ctx) return; const t = this.ctx.currentTime; this.master.gain.setTargetAtTime(this.vol.master, t, 0.03); this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.03); this.mus.gain.setTargetAtTime(this.vol.music * 0.62, t, 0.08); if (this.uiBus) this.uiBus.gain.setTargetAtTime((this.vol.ui ?? 0.8) * 0.9, t, 0.03); }
  // fade everything out while the page is hidden (no click/pop), back in on return
  duck(on) { if (!this.ctx || !this.master) return; const t = this.ctx.currentTime; this.master.gain.cancelScheduledValues(t); this.master.gain.setTargetAtTime(on ? 0.0001 : this.vol.master, t, on ? 0.05 : 0.25); }
  // battle-royale storm: low filtered rumble with a slow tremolo while outside the zone
  storm(on) {
    if (!this.ready) return; if (on === !!this._storm) return; const c = this.ctx, t = c.currentTime;
    if (on) { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(); s.buffer = this.noise; s.loop = true; f.type = "lowpass"; f.frequency.value = 180; f.Q.value = 0.9; g.gain.value = 0.0001; g.gain.setTargetAtTime(0.32, t, 0.25); lfo.frequency.value = 0.35; lg.gain.value = 0.12; lfo.connect(lg); lg.connect(g.gain); s.connect(f); f.connect(g); g.connect(this.sfx); s.start(); lfo.start(); const o = c.createOscillator(), og = c.createGain(); o.type = "sine"; o.frequency.value = 38; og.gain.value = 0.0001; og.gain.setTargetAtTime(0.12, t, 0.3); o.connect(og); og.connect(this.sfx); o.start(); this._storm = { s, g, lfo, o, og }; }
    else { const S = this._storm; this._storm = null; S.g.gain.setTargetAtTime(0.0001, t, 0.2); S.og.gain.setTargetAtTime(0.0001, t, 0.2); setTimeout(() => { try { S.s.stop(); S.lfo.stop(); S.o.stop(); } catch (_) {} }, 900); }
  }
  // layered eat: soft pluck + airy tick; pitch climbs the world scale with the eating streak; panned by screen side
  eat(x, v) {
    if (!this.ready) return; const now = performance.now(); if (now - this._eatT < 55) return; this._eatT = now; this.eatCombo = now - this.lastEat < 320 ? Math.min(this.eatCombo + 1, 20) : 0; this.lastEat = now;
    try { const c = this.ctx, t = c.currentTime, sc = (this.zen ? ZEN : TH[this.world] || TH[0]).sc, k = this.eatCombo, f = 520 * Math.pow(2, (sc[k % sc.length] + 12 * ((k / sc.length) | 0)) / 12) * (1 + (Math.random() - 0.5) * 0.012);
      const pan = c.createStereoPanner ? c.createStereoPanner() : null, out = pan || this.sfx; if (pan) { pan.pan.value = Math.max(-0.6, Math.min(0.6, x || 0)); pan.connect(this.sfx); }
      const vol = 0.045 + Math.min(0.03, (v || 1) * 0.006); this._tone("sine", f, f * 1.5, 0.07, vol, 0, out); this._tone("triangle", f * 2, f * 2.6, 0.04, vol * 0.3, 0.005, out); if (k > 6) this._tone("sine", f * 3, 0, 0.09, vol * 0.25, 0.02, out); } catch (_) {}
  }
  get ready() { return this.ctx && this.ctx.state === "running"; }
  bindEvents() { if (this._bound) return; this._bound = 1; onEvt("fx.eat", (e) => { if (e && e.me) this.eat(this.panX ? this.panX(e.x, e.y) : 0, e.v); }); }
  // ---------- building blocks ----------
  _env(g, t, a, peak, d, end = 0.0001) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(end, t + a + d); }
  _tone(type, f0, f1, dur, vol, when = 0, dest, pan) {
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this._env(g, t, 0.006, vol, dur); o.connect(g); g.connect(dest || this._d || this.sfx); o.start(t); o.stop(t + dur + 0.05); return g;
  }
  _noise(dur, vol, f, q = 1, when = 0, type = "bandpass", dest, f1) {
    const c = this.ctx, t = c.currentTime + when, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; fl.type = type; fl.frequency.setValueAtTime(f, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur); fl.Q.value = q; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest || this._d || this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  _thump(f0, f1, dur, vol, when = 0, dest) { const g = this._tone("sine", f0, f1, dur, vol, when, dest); return g; }
  _spatial(x, y) { // a panner placed in world space relative to the listener (camera); returns its input node
    const c = this.ctx, p = c.createPanner(); p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 8; p.maxDistance = 120; p.rolloffFactor = 1.4;
    const dx = x - (this.lx || 0), dz = y - (this.lz || 0); if (p.positionX) { p.positionX.value = dx; p.positionY.value = 0; p.positionZ.value = dz; } else p.setPosition(dx, 0, dz); p.connect(this.sfx); return p;
  }
  setListener(x, y) { this.lx = x; this.lz = y; }
  panX(x) { return (x - (this.lx || 0)) / 26; }
  // ---------- SFX ----------
  play(name, opt) {
    if (!this.ready) return;
    this._d = UI_SND.has(name) ? this.uiBus : null;
    try {
      const sc = (this.menu ? LOBBY : TH[this.world] || TH[0]).sc;
      switch (name) {
        case "eat": { const now = performance.now(); this.eatCombo = now - this.lastEat < 260 ? Math.min(this.eatCombo + 1, 14) : 0; this.lastEat = now;
          const f = 560 * Math.pow(2, (sc[this.eatCombo % sc.length] + 12 * ((this.eatCombo / sc.length) | 0)) / 12); this._tone("sine", f, f * 1.45, 0.08, 0.1); this._tone("triangle", f * 2, f * 2.8, 0.05, 0.03); break; }
        case "big": this._tone("triangle", 330, 990, 0.18, 0.14); this._tone("sine", 660, 1320, 0.22, 0.08, 0.04); this._noise(0.12, 0.08, 5000, 2, 0, "highpass"); break;
        case "kill": // punchy impact: sub drop + crack + bright stinger + riser tail
          this._thump(140, 38, 0.45, 0.5); this._noise(0.22, 0.5, 2400, 0.6, 0, "bandpass", undefined, 600); this._noise(0.05, 0.4, 7000, 1, 0, "highpass");
          [0, 7, 12, 19].forEach((s, i) => this._tone("sawtooth", mtof(72 + s), 0, 0.22, 0.035, 0.03 + i * 0.035)); this._tone("sine", 1760, 2640, 0.35, 0.04, 0.12); break;
        case "die": this._thump(200, 36, 0.8, 0.42); this._noise(0.7, 0.3, 900, 0.6, 0, "lowpass", undefined, 120); [0, 3, 7].forEach((s, i) => { this._tone("triangle", mtof(57 + s), mtof(52 + s), 1.3, 0.05, 0.08 + i * 0.02); this._tone("sine", mtof(45 + s), 0, 1.4, 0.04, 0.08); }); this._tone("sawtooth", 330, 70, 0.7, 0.05); break;
        case "boom": this._thump(90, 28, 1.2, 0.6); this._noise(1.4, 0.45, 1200, 0.5, 0, "lowpass", undefined, 80); break;
        case "shock": this._noise(0.5, 0.3, 300, 1.2, 0, "bandpass", undefined, 3000); this._thump(70, 30, 0.6, 0.4); break;
        case "hover": { const n = performance.now(); if (n - this.lastHover < 60) break; this.lastHover = n; this._tone("sine", 2200, 2600, 0.025, 0.018); break; }
        case "click": this._tone("sine", 1400, 900, 0.05, 0.07); this._noise(0.02, 0.05, 6000, 1, 0, "highpass"); break;
        case "tab": this._tone("triangle", 980, 1180, 0.05, 0.05); break;
        case "toggle": this._tone("triangle", 700, 1050, 0.07, 0.06); break;
        case "back": this._tone("sine", 900, 520, 0.08, 0.06); break;
        case "whoosh": this._noise(0.35, 0.12, 400, 0.8, 0, "bandpass", undefined, 3200); break;
        case "toast": this._tone("sine", 1320, 0, 0.12, 0.05); this._tone("sine", 1760, 0, 0.16, 0.04, 0.06); break;
        case "coin": [0, 5].forEach((s, i) => this._tone("square", mtof(88 + s), 0, 0.09, 0.025, i * 0.06)); break;
        case "count": this._tone("sine", 880, 0, 0.16, 0.07); this._tone("triangle", 1760, 0, 0.08, 0.02); this._thump(120, 60, 0.15, 0.22); this._noise(0.05, 0.05, 5000, 1, 0, "highpass"); break;
        case "go": this._tone("sawtooth", 990, 0, 0.3, 0.05); this._tone("triangle", 1320, 0, 0.35, 0.06, 0.02); this._thump(110, 40, 0.4, 0.4); this._noise(0.5, 0.15, 800, 0.7, 0, "bandpass", undefined, 5000); break;
        case "level": [0, 4, 7, 12, 16, 19].forEach((s, i) => this._tone("triangle", mtof(67 + s), 0, 0.4, 0.08, i * 0.07)); this._noise(0.8, 0.08, 6000, 1, 0.3, "highpass"); break;
        case "chime": [0, 7, 12, 19, 24].forEach((s, i) => { this._tone("sine", mtof(84 + s), 0, 0.7, 0.05, i * 0.055); this._tone("triangle", mtof(96 + s), 0, 0.3, 0.012, i * 0.055 + 0.01); }); break;
        case "ach": case "reward": [0, 7, 12, 16].forEach((s, i) => this._tone("sine", mtof(79 + s), 0, 0.55, 0.07, i * 0.09)); break;
        case "reveal": this._noise(1.2, 0.18, 300, 1, 0, "bandpass", undefined, 8000); [0, 4, 7, 11, 14, 19].forEach((s, i) => this._tone("triangle", mtof(72 + s), 0, 1.2, 0.05, 0.6 + i * 0.05)); this._thump(80, 40, 1, 0.4, 0.6); break;
        case "victory": [0, 4, 7, 12].forEach((s, i) => { this._tone("sawtooth", mtof(60 + s), 0, 0.5, 0.045, i * 0.14); this._tone("triangle", mtof(72 + s), 0, 0.5, 0.05, i * 0.14); }); [0, 4, 7, 12, 16].forEach((s) => { this._tone("sawtooth", mtof(60 + s), 0, 2.2, 0.03, 0.62); this._tone("triangle", mtof(72 + s), 0, 2.2, 0.035, 0.62); }); this._thump(70, 40, 1.4, 0.5); this._thump(70, 40, 1.4, 0.45, 0.62); this._noise(1.6, 0.08, 7000, 1, 0.62, "highpass"); break;
        case "defeat": [7, 3, 0, -5].forEach((s, i) => this._tone("triangle", mtof(60 + s), 0, 0.7, 0.06, i * 0.18)); break;
        case "error": this._tone("square", 220, 180, 0.18, 0.05); break;
        case "warn": this._tone("sine", 880, 0, 0.08, 0.06); this._tone("sine", 880, 0, 0.08, 0.06, 0.14); break;
        case "siren": for (let i = 0; i < 3; i++) this._tone("sawtooth", 400, 800, 0.5, 0.04, i * 0.5); break;
        case "roar": { const o = this._tone("sawtooth", 90, 45, 1.6, 0.18); this._noise(1.6, 0.3, 500, 0.8, 0, "lowpass", undefined, 120); this._thump(60, 30, 1.6, 0.4); break; }
        case "core": this._tone("square", 880, 220, 0.3, 0.07); this._thump(160, 50, 0.4, 0.35); this._noise(0.3, 0.3, 3000, 0.8); break;
        case "hill": this._tone("sine", 1500, 0, 0.06, 0.03); break;
        case "pu": { const k = (opt && opt.k) | 0; const base = [72, 76, 79, 74, 81, 84, 70][k] || 76; [0, 7, 12].forEach((st, i) => this._tone(k === 4 ? "sine" : "triangle", mtof(base + st), mtof(base + st + 12), 0.22, 0.07, i * 0.05)); this._noise(0.35, 0.08, 5000, 1.2, 0.02, "highpass"); if (k === 5) this._noise(0.6, 0.12, 2500, 3, 0.05, "bandpass", undefined, 9000); if (k === 6) this._thump(130, 50, 0.35, 0.35); break; }
        case "puEnd": this._tone("sine", 900, 450, 0.18, 0.05); break;
        case "shieldHit": this._tone("square", 1200, 300, 0.25, 0.06); this._noise(0.25, 0.25, 4000, 1, 0, "bandpass", undefined, 1200); this._thump(160, 60, 0.25, 0.3); break;
        case "combo": { const n = Math.min(10, (opt && opt.n) | 0); this._tone("triangle", mtof(76 + n), 0, 0.12, 0.05); this._tone("sine", mtof(83 + n), 0, 0.14, 0.035, 0.03); break; }
        case "streak": [0, 4, 7, 12].forEach((st, i) => this._tone("sawtooth", mtof(64 + st), 0, 0.3, 0.04, i * 0.05)); this._thump(90, 40, 0.5, 0.45); break;
        case "mission": [0, 4, 7].forEach((st, i) => this._tone("sine", mtof(84 + st), 0, 0.3, 0.06, i * 0.07)); break;
        case "event": [0, 7, 12, 19].forEach((st, i) => this._tone("triangle", mtof(72 + st), mtof(84 + st), 0.35, 0.06, i * 0.08)); this._noise(0.6, 0.1, 6000, 1, 0.1, "highpass"); break;
        case "meteor": this._thump(80, 26, 0.9, 0.55); this._noise(0.9, 0.4, 700, 0.7, 0, "lowpass", undefined, 90); this._tone("sawtooth", 300, 60, 0.5, 0.06); break;
        case "emote": this._tone("sine", 880, 1320, 0.1, 0.06); this._tone("sine", 1320, 1760, 0.12, 0.04, 0.06); break;
        case "spin": this._tone("triangle", 1200, 1000, 0.04, 0.04); break;
        case "pause": this._tone("sine", 700, 500, 0.12, 0.05); break;
      }
    } catch (_) {}
    this._d = null;
  }
  // positional SFX for other snakes (kills/deaths/boost far away)
  at(name, x, y) {
    if (!this.ready) return; try { const p = this._spatial(x, y), c = this.ctx, t = c.currentTime;
      if (name === "kill" || name === "die") { const o = c.createOscillator(), g = c.createGain(); o.type = "sine"; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4); this._env(g, t, 0.005, 0.4, 0.45); o.connect(g); g.connect(p); o.start(t); o.stop(t + 0.5);
        const s = c.createBufferSource(), f = c.createBiquadFilter(), g2 = c.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 1400; g2.gain.setValueAtTime(0.3, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); s.connect(f); f.connect(g2); g2.connect(p); s.start(t); s.stop(t + 0.35); }
      else if (name === "boost") { const s = c.createBufferSource(), f = c.createBiquadFilter(), g2 = c.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.4); g2.gain.setValueAtTime(0.12, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); s.connect(f); f.connect(g2); g2.connect(p); s.start(t); s.stop(t + 0.5); }
    } catch (_) {}
  }
  boost(on) {
    if (!this.ready) return;
    if (on && !this._boost) {
      const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), o = c.createOscillator(), og = c.createGain(); s.buffer = this.noise; s.loop = true; f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 0.8;
      o.type = "sawtooth"; o.frequency.value = 55; og.gain.value = 0.0001; og.gain.setTargetAtTime(0.03, c.currentTime, 0.08); const ol = c.createBiquadFilter(); ol.type = "lowpass"; ol.frequency.value = 300; o.connect(ol); ol.connect(og); og.connect(this.sfx); o.start();
      g.gain.value = 0.0001; g.gain.setTargetAtTime(0.08, c.currentTime, 0.05); s.connect(f); f.connect(g); g.connect(this.sfx); s.start(); this._boost = { s, g, f, o, og };
      this._noise(0.3, 0.1, 400, 0.8, 0, "bandpass", undefined, 2600);
    } else if (!on && this._boost) { const b = this._boost; this._boost = null; const t = this.ctx.currentTime; b.g.gain.setTargetAtTime(0.0001, t, 0.06); b.og.gain.setTargetAtTime(0.0001, t, 0.06); setTimeout(() => { try { b.s.stop(); b.o.stop(); } catch (_) {} }, 350); }
    if (this._boost) { const t = this.ctx.currentTime; this._boost.f.frequency.setTargetAtTime(800 + Math.random() * 700, t, 0.1); this._boost.o.frequency.setTargetAtTime(55 + this.intensity * 30, t, 0.2); }
  }
  // ---------- adaptive music ----------
  music(on, world, menu) {
    if (world !== undefined) this.world = world; if (menu !== undefined) this.menu = menu;
    if (!this.ok) return; this.musicOn = on;
    if (on && !this._tm) { this._step = 0; this._next = this.ctx ? this.ctx.currentTime + 0.1 : 0; this._tm = setInterval(() => this._sched(), 50); }
    if (!on && this._tm) { clearInterval(this._tm); this._tm = null; }
    this._layers();
  }
  setIntensity(x) { x = Math.max(0, Math.min(1, x)); if (Math.abs(x - this.intensity) < 0.02) return; this.intensity = x; this._layers(); }
  _layers(now) {
    if (!this.ctx || !this.L) return; const t = this.ctx.currentTime, I = this.menu ? 0.15 : this.intensity, tc = now ? 0.01 : 1.2;
    const lv = this.menu ? { pad: 0.9, bass: 0.45, arp: 0.55, drum: 0.18, lead: 0.0, choir: 0.35 } : this.zen ? { pad: 1, bass: 0.3, arp: 0.5, drum: 0, lead: 0.25, choir: 0.5 } : { pad: 0.75, bass: 0.6 + I * 0.3, arp: 0.35 + I * 0.5, drum: 0.25 + I * 0.75, lead: Math.max(0, I - 0.45) * 1.6, choir: Math.max(0, I - 0.7) * 2.2 };
    for (const k in lv) this.L[k].gain.setTargetAtTime(lv[k], t, tc);
    this.musLP.frequency.setTargetAtTime(this.menu ? 1600 : 1300 + I * 5200, t, 1.0);
  }
  _sched() {
    if (!this.ready || this.vol.music <= 0.001) { if (this.ctx) this._next = this.ctx.currentTime + 0.1; return; }
    const c = this.ctx, T = this.menu ? LOBBY : this.zen ? ZEN : TH[this.world] || TH[0], spb = 60 / (T.bpm * (this.menu ? 1 : 1 + this.intensity * 0.08)) / 4; // sixteenth notes
    while (this._next < c.currentTime + 0.25) {
      const st = this._step, bar = (st / 16) | 0, beat = st % 16, deg = T.prog[bar % 4], sc = T.sc, root = T.root + sc[deg % sc.length], at = this._next;
      const chord = [0, 2, 4].map((k) => root + sc[(deg + k) % sc.length] - sc[deg % sc.length] + (deg + k >= sc.length ? 12 : 0));
      if (beat === 0) { for (const n of chord) this._pad(mtof(n - 12), at, spb * 16, T.pad); if (bar % 2 === 0) this._choir(mtof(chord[2]), at, spb * 32); }
      if (beat === 0 || beat === 10) this._bass(mtof(root - 24), at, spb * 5);
      if (beat === 6 || beat === 14) this._bass(mtof(root - 24 + 12), at, spb * 2, 0.5);
      const pat = [0, 2, 1, 2, 0, 3, 1, 2]; if (beat % 2 === 0) this._pluck(mtof(chord[pat[(beat / 2) % 8] % 3] + 12 + (beat % 8 === 6 ? 12 : 0)), at, spb * 3, beat % 4 === 0 ? 0.05 : 0.032, T.lead === "square" ? "square" : "triangle");
      this._drums(T.kit, beat, at, spb);
      if (beat === 0 && bar % 2 === 1) { const m = [0, 2, 4, 3, 5, 4, 2, 1]; for (let i = 0; i < 4; i++) this._lead(mtof(root + 12 + sc[m[(bar * 3 + i) % 8] % sc.length]), at + i * spb * 4, spb * 3.6, T.lead); }
      this._next += spb; this._step++;
    }
  }
  _o(type, f, t, d, peak, dest, a = 0.01, det = 0) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det; this._env(g, t, a, peak, d); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + 0.05); return o; }
  _pad(f, t, d, type) { const c = this.ctx; for (const det of [-9, 0, 9]) { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.013, t + d * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.L.pad); o.start(t); o.stop(t + d + 0.05); } }
  _choir(f, t, d) { const c = this.ctx; for (const m of [1, 1.5, 2]) { const o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = f * m; fl.type = "bandpass"; fl.frequency.value = 900 * m; fl.Q.value = 6; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.02, t + d * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + d); o.connect(fl); fl.connect(g); g.connect(this.L.choir); o.start(t); o.stop(t + d + 0.05); } }
  _bass(f, t, d, k = 1) { this._o("triangle", f, t, d, 0.11 * k, this.L.bass, 0.01); this._o("sine", f / 2, t, d, 0.08 * k, this.L.bass, 0.01); }
  _pluck(f, t, d, v, type) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; this._env(g, t, 0.004, v, d); o.connect(g); g.connect(this.L.arp); const s = c.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(this.delay); o.start(t); o.stop(t + d + 0.05); }
  _lead(f, t, d, type) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(), v = c.createOscillator(), vg = c.createGain(); o.type = type; o.frequency.value = f; v.frequency.value = 5.5; vg.gain.value = f * 0.006; v.connect(vg); vg.connect(o.frequency); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 0.05); g.gain.setTargetAtTime(0.0001, t + d * 0.7, d * 0.2); o.connect(g); g.connect(this.L.lead); g.connect(this.delay); o.start(t); v.start(t); o.stop(t + d + 0.3); v.stop(t + d + 0.3); }
  _drums(kit, beat, t, spb) {
    const D = this.L.drum, c = this.ctx;
    const kick = (v = 1) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); this._env(g, t, 0.002, 0.35 * v, 0.22); o.connect(g); g.connect(D); o.start(t); o.stop(t + 0.3); };
    const hat = (v = 1, open) => { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; f.type = "highpass"; f.frequency.value = 7500; g.gain.setValueAtTime(0.05 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.18 : 0.04)); s.connect(f); f.connect(g); g.connect(D); s.start(t, Math.random()); s.stop(t + 0.2); };
    const snare = (v = 1) => { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.7; g.gain.setValueAtTime(0.16 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); s.connect(f); f.connect(g); g.connect(D); s.start(t, Math.random()); s.stop(t + 0.2); this._o("triangle", 190, t, 0.08, 0.05 * v, D, 0.002); };
    const tom = (f0, v = 1) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.18); this._env(g, t, 0.002, 0.18 * v, 0.2); o.connect(g); g.connect(D); o.start(t); o.stop(t + 0.25); };
    if (kit === "none") return;
    if (kit === "soft") { if (beat === 0) kick(0.6); if (beat % 4 === 2) hat(0.5); if (beat === 12) tom(220, 0.5); }
    else if (kit === "tribal") { if (beat === 0 || beat === 6 || beat === 10) kick(0.8); if (beat % 4 === 2) tom(260, 0.7); if (beat % 2 === 1) hat(0.4); if (beat === 14) tom(180, 0.8); }
    else if (kit === "frame") { if (beat === 0 || beat === 7 || beat === 10) tom(120, 1); if (beat === 4 || beat === 12) snare(0.6); if (beat % 2 === 1) hat(0.35); }
    else if (kit === "synth") { if (beat % 4 === 0) kick(1); if (beat === 4 || beat === 12) snare(0.9); hat(beat % 2 ? 0.35 : 0.6, beat % 4 === 2); }
    else { if (beat % 4 === 0 || beat === 3 || beat === 11) kick(1.1); if (beat === 4 || beat === 12) snare(1); if (beat % 2 === 0) hat(0.5); if (beat === 15) tom(110, 1); }
  }
}
export const haptic = { on: true, tap(ms = 10) { if (this.on && navigator.vibrate) try { navigator.vibrate(ms); } catch (_) {} }, pattern(p) { if (this.on && navigator.vibrate) try { navigator.vibrate(p); } catch (_) {} } };
