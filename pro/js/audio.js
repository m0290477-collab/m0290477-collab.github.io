// Synthesised audio (WebAudio, no files): SFX + generative music per world. Unlocks on first touch (iOS rule).
const SCALES = [[0, 3, 5, 7, 10], [0, 2, 3, 7, 8], [0, 2, 4, 7, 9], [0, 3, 5, 6, 7, 10]]; // jungle, babylon (phrygian-ish), ice, neon
const ROOTS = [57, 52, 60, 55];
const PROG = [[0, 7, 3, 5], [0, 1, 0, 8], [0, 5, 9, 7], [0, 8, 3, 10]];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() { this.ctx = null; this.vol = { master: 0.8, sfx: 0.9, music: 0.45 }; this.world = 0; this.musicOn = false; this.ok = !!(window.AudioContext || window.webkitAudioContext); this._boost = null; this.lastEat = 0; this.eatCombo = 0; }
  unlock() {
    if (!this.ok) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC({ latencyHint: "interactive" });
        const c = this.ctx; this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.connect(c.destination);
        this.master = c.createGain(); this.master.connect(this.comp); this.sfx = c.createGain(); this.sfx.connect(this.master); this.mus = c.createGain(); this.mus.connect(this.master);
        this.musLP = c.createBiquadFilter(); this.musLP.type = "lowpass"; this.musLP.frequency.value = 2400; this.musLP.connect(this.mus);
        const len = c.sampleRate; this.noise = c.createBuffer(1, len, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // a short feedback delay gives the music space without a reverb impulse file
        this.delay = c.createDelay(1); this.delay.delayTime.value = 0.32; this.fb = c.createGain(); this.fb.gain.value = 0.32; this.delay.connect(this.fb); this.fb.connect(this.delay); this.delay.connect(this.mus);
        this.applyVol();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (_) { this.ok = false; }
  }
  setVol(v) { Object.assign(this.vol, v); this.applyVol(); }
  applyVol() { if (!this.ctx) return; const t = this.ctx.currentTime; this.master.gain.setTargetAtTime(this.vol.master, t, 0.03); this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.03); this.mus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.08); }
  get ready() { return this.ctx && this.ctx.state === "running"; }
  _tone(type, f0, f1, dur, vol, when = 0, dest) {
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.02);
  }
  _noise(dur, vol, f, q = 1, when = 0, type = "bandpass") {
    const c = this.ctx, t = c.currentTime + when, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  play(name, x) {
    if (!this.ready) return;
    try {
      switch (name) {
        case "eat": { const now = performance.now(); this.eatCombo = now - this.lastEat < 260 ? Math.min(this.eatCombo + 1, 12) : 0; this.lastEat = now;
          const f = 520 * Math.pow(2, (SCALES[this.world][this.eatCombo % 5] + 12 * ((this.eatCombo / 5) | 0)) / 12); this._tone("sine", f, f * 1.5, 0.09, 0.12); break; }
        case "big": this._tone("triangle", 330, 990, 0.18, 0.16); this._tone("sine", 660, 1320, 0.22, 0.08, 0.04); break;
        case "kill": this._tone("square", 220, 880, 0.12, 0.08); [0, 4, 7, 12].forEach((s, i) => this._tone("triangle", mtof(72 + s), 0, 0.3, 0.1, i * 0.05)); this._noise(0.25, 0.25, 1800, 0.8); break;
        case "die": this._tone("sawtooth", 440, 55, 0.7, 0.16); this._noise(0.6, 0.35, 600, 0.6, 0, "lowpass"); break;
        case "click": this._tone("sine", 1200, 900, 0.045, 0.07); break;
        case "tab": this._tone("sine", 900, 1100, 0.05, 0.05); break;
        case "toggle": this._tone("triangle", 700, 1050, 0.07, 0.07); break;
        case "back": this._tone("sine", 800, 500, 0.07, 0.06); break;
        case "count": this._tone("square", 660, 0, 0.12, 0.06); break;
        case "go": this._tone("square", 990, 0, 0.25, 0.07); this._tone("triangle", 1320, 0, 0.3, 0.06, 0.02); break;
        case "level": [0, 4, 7, 12, 16].forEach((s, i) => this._tone("triangle", mtof(67 + s), 0, 0.35, 0.1, i * 0.08)); break;
        case "ach": [0, 7, 12].forEach((s, i) => this._tone("sine", mtof(79 + s), 0, 0.5, 0.09, i * 0.1)); break;
        case "error": this._tone("square", 220, 180, 0.18, 0.06); break;
        case "warn": this._tone("sine", 880, 0, 0.08, 0.06); this._tone("sine", 880, 0, 0.08, 0.06, 0.14); break;
      }
    } catch (_) {}
  }
  boost(on) {
    if (!this.ready) return;
    if (on && !this._boost) {
      const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; s.loop = true; f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 0.7;
      g.gain.value = 0.0001; g.gain.setTargetAtTime(0.09, c.currentTime, 0.05); s.connect(f); f.connect(g); g.connect(this.sfx); s.start(); this._boost = { s, g, f };
    } else if (!on && this._boost) { const b = this._boost; this._boost = null; b.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.06); setTimeout(() => { try { b.s.stop(); } catch (_) {} }, 300); }
    if (this._boost) this._boost.f.frequency.setTargetAtTime(700 + Math.random() * 600, this.ctx.currentTime, 0.1);
  }
  // generative music: pad chords + plucked arpeggio, scheduled ahead on the audio clock
  music(on, world) {
    if (world !== undefined) this.world = world;
    if (!this.ok) return;
    this.musicOn = on;
    if (on && !this._tm) { this._step = 0; this._next = this.ctx ? this.ctx.currentTime + 0.1 : 0; this._tm = setInterval(() => this._sched(), 90); }
    if (!on && this._tm) { clearInterval(this._tm); this._tm = null; }
  }
  _sched() {
    if (!this.ready || this.vol.music <= 0.001) { if (this.ctx) this._next = this.ctx.currentTime + 0.1; return; }
    const c = this.ctx, bpm = [92, 84, 76, 110][this.world], spb = 60 / bpm / 2; // eighth notes
    while (this._next < c.currentTime + 0.3) {
      const st = this._step, bar = (st / 16) | 0, chordRoot = ROOTS[this.world] + PROG[this.world][bar % 4], sc = SCALES[this.world];
      if (st % 16 === 0) for (const iv of [0, 7, 12 + sc[1]]) this._pad(mtof(chordRoot - 12 + iv), this._next, spb * 16);
      if (st % 16 === 0) this._bass(mtof(chordRoot - 24), this._next, spb * 3);
      if (st % 16 === 8) this._bass(mtof(chordRoot - 24 + 7), this._next, spb * 3);
      const pat = [0, 2, 4, 2, 1, 3, 4, 3]; if ((st * 7919) % 5 !== 0 || this.world === 3) this._pluck(mtof(chordRoot + 12 + sc[pat[st % 8] % sc.length]), this._next, spb * 1.8, st % 4 === 0 ? 0.05 : 0.03);
      this._next += spb; this._step++;
    }
  }
  _pad(f, t, d) { const c = this.ctx; for (const det of [-6, 6]) { const o = c.createOscillator(), g = c.createGain(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.018, t + d * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.musLP); o.start(t); o.stop(t + d + 0.05); } }
  _bass(f, t, d) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = "triangle"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.musLP); o.start(t); o.stop(t + d + 0.05); }
  _pluck(f, t, d, v) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = this.world === 3 ? "square" : "triangle"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.musLP); g.connect(this.delay); o.start(t); o.stop(t + d + 0.05); }
}
export const haptic = { on: true, tap(ms = 10) { if (this.on && navigator.vibrate) try { navigator.vibrate(ms); } catch (_) {} }, pattern(p) { if (this.on && navigator.vibrate) try { navigator.vibrate(p); } catch (_) {} } };
