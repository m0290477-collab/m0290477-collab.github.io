// Menus, HUD, modals, transitions, studio intro, title, cinematic loading, locker with 3D showcase, season pass,
// rarity reveals, notifications. Every control is wired to real state and fails with a friendly message.
import { t, LANGS, LANG, achDesc, fmtNum } from "./i18n.js?v=f1";
import { SKINS, FLAGS, EYES, TRAILS, NAME_COLORS, PATTERNS, FLAG_PRICE, flagName, flagEmoji, swatchCss, compileSkin, primaryColor, LEGEND, RAR_COL, skinFx } from "./skins.js?v=f1";
import { WORLDS, worldAsset } from "./worlds.js?v=f1";
import { Store, lvInfo, SEASON, seasonReward, CHAINS } from "./store.js?v=f1";
import { haptic } from "./audio.js?v=f1";
import { skinFn, MODES } from "./game.js?v=f1";
import { PU_COL, PU_ICON, PU_DUR, PU_SVG } from "./sim.js?v=f1";
const puSvg = (k) => `<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="${PU_SVG[k]}"/></svg>`;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const IC = {
  classic: '<svg viewBox="0 0 24 24"><path d="M4 16c2.5-6 6 2 8.5-4S18 8 20 10"/><circle cx="19.5" cy="9.5" r="1.2" fill="currentColor"/></svg>',
  time: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 2.5h5M12 2.5v3"/></svg>',
  survival: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6l7-3Z"/><path d="M9 12l2 2 4-4"/></svg>',
  zen: '<svg viewBox="0 0 24 24"><path d="M12 4c2.5 2.6 2.5 6.4 0 9-2.5-2.6-2.5-6.4 0-9Z"/><path d="M4 12c3 0 5.5 1.3 8 4 2.5-2.7 5-4 8-4-1 4.5-4.5 7-8 7s-7-2.5-8-7Z"/></svg>',
  online: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5S14.6 18.1 12 20.5C9.4 18.1 8.2 15.3 8.2 12S9.4 5.9 12 3.5Z"/></svg>',
  br: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.5"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  koth: '<svg viewBox="0 0 24 24"><path d="M3 20h18L14 8l-3 4-2-2-6 10Z"/><path d="M14 8V3l4 2-4 2"/></svg>',
  boss: '<svg viewBox="0 0 24 24"><path d="M5 9c0-4 3-6 7-6s7 2 7 6c0 3-1 4-2 5v3H7v-3c-1-1-2-2-2-5Z"/><path d="M9 11h.01M15 11h.01M10 17v3M14 17v3"/></svg>',
  team: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M12 15.5c1.1-1 2.5-1.5 4-1.5 3.3 0 6 2.7 6 6"/></svg>',
  crown: '<svg viewBox="0 0 24 24" class="crown"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8Z" fill="currentColor" stroke="none"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};
const MODE_LIST = ["classic", "br", "koth", "boss", "team", "time", "survival", "zen", "online"];
const NEW_MODES = new Set(["br", "koth", "boss", "team"]);
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, "0")}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const skinName = (i) => { const S = SKINS[i]; if (!S) return "?"; const k = "s_" + S.id; const v = t(k); return v === k ? cap(S.id) : v; };

export class Hud {
  constructor(app) { this.app = app; this.mini = $("h-mini").getContext("2d"); this.bt = 0; this.lastLb = ""; }
  show(mode) {
    $("hud").classList.remove("cine"); clearTimeout(this._cineT);
    $("hud").classList.remove("x-hide"); $("h-timer").classList.toggle("x-hide", !(mode === "time" || mode === "survival" || (MODES[mode] && MODES[mode].dur))); $("h-feed").innerHTML = ""; $("h-pop").innerHTML = ""; $("h-mode").innerHTML = "";
    $("h-mini").classList.toggle("x-hide", !this.app.store.settings.minimap); $("h-fps").classList.toggle("x-hide", !this.app.store.settings.showFps); this.storm(false); this.mode = mode; this.lastLb = "";
    for (const id of ["h-cine", "h-kill", "h-count", "h-combo", "h-mission", "h-hint"]) $(id).classList.remove("on"); this.puClear(); this.spectate(null);
  }
  hide() { $("hud").classList.add("x-hide"); this.storm(false); }
  update(d) {
    this.massShown = this.massShown == null ? d.mass : this.massShown + (d.mass - this.massShown) * 0.5; if (Math.abs(d.mass - this.massShown) < 1) this.massShown = d.mass; $("h-mass").textContent = fmtNum(this.massShown); $("h-rank").textContent = d.rank ? `#${d.rank}/${d.total}` : "–"; $("h-kills").textContent = d.kills;
    const tm = $("h-timer");
    if (d.timeLeft !== null && d.timeLeft !== undefined) { tm.textContent = "⏱ " + fmtTime(d.timeLeft); tm.classList.toggle("warn", d.timeLeft < 15); }
    else if (d.wave !== null) { tm.textContent = t("wave", { n: d.wave }); tm.classList.remove("warn"); }
    let h = "";
    if (d.scoreList) { d.scoreList.forEach((x, i) => { h += `<div class="${x.s === d.me ? "me" : ""}"><b>${i === 0 ? IC.crown : i + 1}</b><i style="background:${this.dot(x.s)}"></i><span>${esc(x.s.name || "?")}</span><em>${x.v}/${d.target}</em></div>`; }); }
    else { d.top.forEach((s, i) => { h += `<div class="${s === d.me ? "me" : ""}"><b>${i === 0 ? IC.crown : i + 1}</b><i style="background:${this.dot(s)}"></i><span>${esc(s.name || "?")}</span><em>${fmtNum(s.m)}</em></div>`; });
      if (d.me && d.me.alive && d.rank > 5) h += `<div class="me"><b>${d.rank}</b><i style="background:${this.dot(d.me)}"></i><span>${esc(d.me.name)}</span><em>${fmtNum(d.me.m)}</em></div>`; }
    if (d.ping !== null) h += `<div><span>${t("online", { n: d.ping })}</span><em>${d.humans ? "👤" + d.humans : ""}</em></div>`;
    if (h !== this.lastLb) { $("h-lb").innerHTML = h; this.lastLb = h; }
    if (d.alive !== null && d.alive !== undefined) this.modeLine(`<div class="mode-pill hot">${t("aliveN", { n: d.alive })}${d.zone ? " · " + t("zoneIn", { n: d.zone }) : ""}</div>`);
    if (d.kothMine !== null && d.kothMine !== undefined) this.modeLine(`<div class="mode-pill koth ${d.hill && d.hill.mine ? "hot" : ""} ${d.hill && d.hill.contested ? "contest" : ""}">♛ ${d.kothMine}/${d.target} ${d.hill && d.hill.mine ? "· " + t("holding") : d.hill && d.hill.contested ? "· " + t("contested") : "· " + t("goHill")}<div class="cap"><i style="width:${Math.min(100, (d.kothMine / d.target) * 100)}%"></i></div></div>`);
  }
  modeLine(html) { const el = $("h-mode"); if (el.dataset.k !== html) { el.innerHTML = (this.modeTop || "") + html; el.dataset.k = html; } }
  modeHud(d) {
    let h = "";
    if (d && d.kind === "team") h = `<div class="tm-bar"><span class="a">${d.a}</span><span class="tb ta"><i style="width:${(d.a / d.target) * 100}%"></i></span><small>${d.target}</small><span class="tb tb2"><i style="width:${(d.b / d.target) * 100}%"></i></span><span class="b">${d.b}</span></div>`;
    if (d && d.kind === "boss") h = `<div class="boss-bar"><b>LEVIATHAN · ${t("phase")} ${d.phase}</b><div class="hb">${Array.from({ length: d.max }, (_, i) => `<i class="${i >= d.hp ? "gone" : ""}"></i>`).join("")}</div><small>${t("livesN", { n: d.lives })} · ${t("bossTip")}</small></div>`;
    this.modeTop = h; const el = $("h-mode"); el.innerHTML = h; el.dataset.k = "";
  }
  dot(s) { const k = s.skin ? JSON.stringify(s.skin) : ""; this._dots = this._dots || new Map(); let c = this._dots.get(k); if (!c) { c = s.skin ? primaryColor(s.skin) : "#888"; this._dots.set(k, c); } return c; }
  minimap(all, me, R, pal, zone, hill, boss, pus) {
    const g = this.mini, S = 180; g.clearRect(0, 0, S, S); const k = (S / 2 - 6) / R;
    const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2); gr.addColorStop(0, "rgba(255,255,255,0.02)"); gr.addColorStop(1, "rgba(255,200,69,0.12)"); g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, 6.283); g.fill();
    g.strokeStyle = "rgba(255,200,69,0.6)"; g.lineWidth = 2.5; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, 6.283); g.stroke();
    if (zone) { g.strokeStyle = "rgba(190,110,255,0.95)"; g.lineWidth = 3; g.beginPath(); g.arc(S / 2 + zone.x * k, S / 2 + zone.y * k, Math.max(2, zone.r * k), 0, 6.283); g.stroke(); }
    if (hill) { g.fillStyle = "rgba(255,200,69,0.35)"; g.beginPath(); g.arc(S / 2 + hill.x * k, S / 2 + hill.y * k, Math.max(4, hill.r * k), 0, 6.283); g.fill(); }
    if (me && me.alive) { const mx = S / 2 + me.x * k, my = S / 2 + me.y * k; g.fillStyle = "rgba(255,231,163,0.12)"; g.beginPath(); g.moveTo(mx, my); g.arc(mx, my, 34, me.a - 0.7, me.a + 0.7); g.closePath(); g.fill(); }
    if (pus) for (const p of pus) { g.fillStyle = PU_COL[p.k]; g.beginPath(); const x = S / 2 + p.x * k, y = S / 2 + p.y * k; g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.fill(); }
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    for (const s of all) { if (s === me || !me || !me.alive) continue; const d = Math.hypot(s.x - me.x, s.y - me.y); if (d < 40 && s.m > me.m * 1.2 && !(s.team !== undefined && s.team === me.team)) { g.strokeStyle = `rgba(255,60,70,${0.5 + pulse * 0.5})`; g.lineWidth = 2; g.beginPath(); g.arc(S / 2 + s.x * k, S / 2 + s.y * k, 7 + pulse * 3, 0, 6.283); g.stroke(); } }
    for (const s of all) { if (s === me) continue; g.fillStyle = s.boss ? "#ff3040" : s.team === 0 ? "#4da3ff" : s.team === 1 ? "#ff4d5e" : s.bot ? "rgba(255,255,255,0.45)" : "rgba(120,200,255,0.9)"; const r = s.boss ? 8 : Math.max(2.5, Math.min(7, s.r * 2.2)); g.beginPath(); g.arc(S / 2 + s.x * k, S / 2 + s.y * k, r, 0, 6.283); g.fill(); }
    if (me && me.alive) { g.fillStyle = "#ffe7a3"; g.shadowColor = "#ffc845"; g.shadowBlur = 8; g.beginPath(); g.arc(S / 2 + me.x * k, S / 2 + me.y * k, 6, 0, 6.283); g.fill(); g.shadowBlur = 0; }
  }
  net(txt) { const n = $("h-net"); n.textContent = txt; n.classList.toggle("x-hide", !txt); n.classList.toggle("bad", !!txt); }
  fps(n) { $("h-fps").textContent = n + " FPS"; }
  feed(list) { $("h-feed").innerHTML = list.slice(0, 4).map((f) => `<div class="${f.mine ? "mine" : ""}${f.b === t("you") ? " dead" : ""}">${f.how ? `<b>${f.how === "storm" ? "🌀" : "💥"}</b> ${esc(t("feed_" + f.how, { y: f.b }))}` : `<b>${esc(f.a)}</b> <i>⚔</i> <span>${esc(f.b)}</span>`}</div>`).join(""); clearTimeout(this.ft); this.ft = setTimeout(() => ($("h-feed").innerHTML = ""), 4000); }
  banner(txt, ms) { const b = $("h-banner"); b.textContent = txt; b.classList.add("on"); clearTimeout(this.bt); this.bt = setTimeout(() => b.classList.remove("on"), ms || 1400); }
  count(txt) { const c = $("h-count"); c.textContent = txt; c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); }
  killBanner(a, b) { const k = $("h-kill"); k.querySelector("b").textContent = a; k.querySelector("small").textContent = b; k.classList.remove("on"); void k.offsetWidth; k.classList.add("on"); }
  cinematic(a, b, lose) { const hud = $("hud"); if (hud) { hud.classList.add("cine"); clearTimeout(this._cineT); this._cineT = setTimeout(() => hud.classList.remove("cine"), 3800); } const k = $("h-cine"); k.querySelector("b").textContent = a; k.querySelector("small").textContent = b || ""; k.classList.toggle("lose", !!lose); k.classList.remove("on"); void k.offsetWidth; k.classList.add("on"); }
  storm(on) { $("storm-vig").classList.toggle("on", !!on); if (on && !this._stormMsg) { this._stormMsg = 1; this.banner(t("outZone"), 1200); } if (!on) this._stormMsg = 0; }
  popup(txt, kind, pos, col) { const p = document.createElement("div"); p.className = "pop " + (kind || ""); p.textContent = txt; if (col) p.style.color = col; if (pos && pos[2]) { p.style.left = pos[0] + "px"; p.style.top = pos[1] + "px"; } const box = $("h-pop"); box.appendChild(p); while (box.children.length > 6) box.firstChild.remove(); setTimeout(() => p.remove(), 1000); }
  combo(mul, n) { const c = $("h-combo"); if (!mul || mul < 2) { c.classList.remove("on"); return; } const k = "×" + mul; if (c.dataset.k !== k) { c.dataset.k = k; c.classList.remove("pump"); void c.offsetWidth; c.classList.add("pump"); } c.innerHTML = `<b>${t("combo")} ${k}</b><small>${n}</small>`; c.classList.add("on"); c.dataset.m = mul; }
  pu(P, slow) {
    const box = $("h-pu"); if (!P) { if (box.innerHTML) box.innerHTML = ""; return; } let h = "";
    for (let k = 0; k < 6; k++) if (P[k] > 0) { const f = Math.max(0, Math.min(1, P[k] / PU_DUR[k])); h += `<div class="pu-chip ${P[k] < 2 ? "end" : ""}" style="--c:${PU_COL[k]};--f:${f.toFixed(3)}"><i>${puSvg(k)}</i><span>${k === 1 ? "1×" : Math.ceil(P[k]) + "s"}</span></div>`; }
    if (slow > 0) h += `<div class="pu-chip bad" style="--c:#9ff3ff;--f:${(slow / PU_DUR[5]).toFixed(3)}"><i>${puSvg(5)}</i><span>${Math.ceil(slow)}s</span></div>`;
    if (box.dataset.k !== h) { box.innerHTML = h; box.dataset.k = h; }
  }
  puClear() { $("h-pu").innerHTML = ""; $("h-pu").dataset.k = ""; }
  puFlash(k) { const f = $("pu-flash"); f.style.setProperty("--c", PU_COL[k]); f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); }
  frost(sec) { const v = $("frost-vig"); v.classList.add("on"); clearTimeout(this._frT); this._frT = setTimeout(() => v.classList.remove("on"), sec * 1000); }
  mission(txt, v, g, done) { const m = $("h-mission"); m.innerHTML = `<small>${t(done ? "missionDoneShort" : "missionProg")}</small><b>${esc(txt)}</b><div class="mbar"><i style="width:${Math.round((v / g) * 100)}%"></i></div><em>${fmtNum(v)}/${fmtNum(g)}</em>`; m.classList.toggle("done", !!done); m.classList.remove("on"); void m.offsetWidth; m.classList.add("on"); clearTimeout(this._miT); this._miT = setTimeout(() => m.classList.remove("on"), 3200); }
  hint(txt) { const h = $("h-hint"); h.textContent = txt; h.classList.remove("on"); void h.offsetWidth; h.classList.add("on"); clearTimeout(this._hiT); this._hiT = setTimeout(() => h.classList.remove("on"), 5200); }
  spectate(name) { const s = $("h-spec"); s.classList.toggle("x-hide", !name); if (name) s.querySelector("span").textContent = t("watching", { n: name }); $("hud").classList.toggle("watch", !!name); }
  flash() { const v = $("vignette"); v.classList.remove("flash"); void v.offsetWidth; v.classList.add("flash"); }
}

export class UI {
  constructor(app) {
    this.app = app; this.cur = null; this.cTab = "legend"; this.pTab = "missions"; this.gTab = "graphics"; this.sTab = "track"; this.flagQ = ""; this.selMode = app.store.p.last.mode || "classic";
    this.notes = []; this.revealQ = []; this.sel = null; this.bind();
  }
  get S() { return this.app.store; }
  get p() { return this.app.store.p; }
  click(el, fn, snd = "click") {
    el.addEventListener("click", (e) => { this.app.audio.unlock(); this.app.audio.play(snd); haptic.tap(6); this.ripple(el, e); try { fn(e); } catch (err) { console.error(err); this.toast(t("oops"), "warn"); } });
    if (matchMedia("(hover: hover)").matches) el.addEventListener("pointerenter", () => this.app.audio.play("hover"));
  }
  ripple(el, e) { if (!el.classList || !(el.classList.contains("btn") || el.classList.contains("item") || el.classList.contains("mode")) || this.S.settings.reduceMotion) return; const r = el.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement("span"); s.className = "rip"; s.style.width = s.style.height = d + "px"; s.style.left = ((e.clientX || r.left + r.width / 2) - r.left - d / 2) + "px"; s.style.top = ((e.clientY || r.top + r.height / 2) - r.top - d / 2) + "px"; el.appendChild(s); setTimeout(() => s.remove(), 600); }
  // screen transitions: diagonal wipe (big moves) or dissolve
  wipe(kind = "go") { if (this.S.settings.reduceMotion) return Promise.resolve(); const w = $("wipe"); w.className = ""; void w.offsetWidth; w.className = kind; this.app.audio.play("whoosh"); return new Promise((res) => setTimeout(res, kind === "go" ? 330 : 280)).finally(() => setTimeout(() => (w.className = ""), 450)); }
  async go(id, kind) { await this.wipe(kind || "go"); this.show(id); }
  show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.id === "s-" + id)); this.cur = id; $("l-notif").classList.add("x-hide");
    if (id === "lobby") this.renderLobby(); if (id === "custom") this.renderCustom(); if (id === "progress") this.renderProgress(); if (id === "settings") this.renderSettings(); if (id === "season") this.renderSeason();
    this.updateShow();
  }
  hideScreens() { document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on")); this.cur = null; }
  // studio showcase framing per screen
  updateShow() {
    const G = this.app.game; if (!["lobby", "custom", "season", "progress", "settings"].includes(this.cur)) return;
    if (G.mode !== "show") G.startShow();
    const d = this.cur === "custom" && this.sel ? this.sel : this.app.game.mySkin(); const fx = skinFx(d), L = LEGEND[fx];
    const x = this.cur === "custom" ? -0.24 : this.cur === "lobby" ? 0.0 : 0.3;
    G.show = { d: { s: { id: -1, r: 0.5, m: 50, len: 46, x: 0, y: 0 }, fn: skinFn(d), eye: d.e | 0, trail: d.t | 0, fx, name: "" }, idle: L ? L.idle : "sway", glow: L ? L.glow : "#ffc845", x, zoom: this.cur === "lobby" ? 1.2 : 1, orbit: Math.sin(performance.now() / 9000) * 0.25 };
    if (this.cur === "lobby") { const i = d.k === "skin" ? d.i : -1, rar = i >= 0 ? SKINS[i].rar : d.k === "flag" ? "rare" : "epic"; $("l-showtag").innerHTML = `<span class="rar ${rar}">${t("rar_" + rar)}</span><b>${esc(d.k === "flag" ? flagName(FLAGS[d.i], LANG) : d.k === "custom" ? t("custom") : skinName(d.i))}</b>`; }
  }
  goLobby() { ["m-pause", "m-results"].forEach((m) => $(m).classList.add("x-hide")); this.app.hud.hide(); this.app.game.startShow(this.p.last.world || 0); this.app.audio.music(true, this.p.last.world || 0, true); this.go("lobby", "fade"); setTimeout(() => this.nextReveal(), 900); }
  toast(msg, kind = "", ms = 2800) {
    const el = document.createElement("div"); el.className = "toast " + kind; el.textContent = msg; const box = $("toasts"); box.appendChild(el); while (box.children.length > 3) box.firstChild.remove();
    if (kind === "gold" || kind === "good") { this.note(msg, kind === "gold" ? "★" : "✓"); this.app.audio.play("toast"); }
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, ms);
  }
  note(msg, ic) { this.notes.unshift({ msg, ic, t: Date.now(), seen: false }); if (this.notes.length > 20) this.notes.pop(); this.renderBell(); }
  renderBell() { const n = this.notes.filter((x) => !x.seen).length; $("l-bdg").textContent = n; $("l-bdg").classList.toggle("x-hide", !n); }
  confirm(text) { return new Promise((res) => { $("cf-text").textContent = text; const m = $("m-confirm"); m.classList.remove("x-hide"); const done = (v) => { m.classList.add("x-hide"); $("cf-yes").onclick = $("cf-no").onclick = null; res(v); }; $("cf-yes").onclick = () => done(true); $("cf-no").onclick = () => done(false); }); }
  coins(target) { // animated currency counter
    document.querySelectorAll(".coinsv").forEach((el) => { const from = +(el.dataset.v || target), to = target; el.dataset.v = to; if (from === to || this.S.settings.reduceMotion) { el.textContent = fmtNum(to); return; }
      const t0 = performance.now(), step = () => { const k = Math.min(1, (performance.now() - t0) / 900), e = 1 - Math.pow(1 - k, 3); el.textContent = fmtNum(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); }; step(); const c = el.closest(".chip"); if (c && to > from) { c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); this.app.audio.play("coin"); } });
  }

  bind() {
    const A = this.app;
    $("a-tabs").querySelectorAll("button").forEach((b) => this.click(b, () => { $("a-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); $("f-in").classList.toggle("x-hide", b.dataset.v !== "in"); $("f-up").classList.toggle("x-hide", b.dataset.v !== "up"); }, "tab"));
    this.click($("a-guest"), () => { this.S.signOut(); this.afterLogin(); });
    const doIn = async () => { const b = $("in-go"); if (b.disabled) return; b.disabled = true; $("in-err").textContent = "…"; let r; try { r = await this.S.signIn($("in-u").value, $("in-p").value, $("in-rem").checked); } catch (e) { r = { err: "oops" }; } b.disabled = false;
      if (r.err) { $("in-err").textContent = t(r.err, { n: r.n }); A.audio.play("error"); return; } $("in-err").textContent = ""; $("in-p").value = ""; this.afterLogin(); if (r.migrated) this.toast(t("migrated"), "gold", 4500); };
    const doUp = async () => { const b = $("up-go"); if (b.disabled) return; b.disabled = true; $("up-err").textContent = "…"; let r; try { r = await this.S.signUp($("up-u").value, $("up-e").value, $("up-p").value, $("up-p2").value); } catch (e) { r = { err: "oops" }; } b.disabled = false;
      if (r.err) { $("up-err").textContent = t(r.err); A.audio.play("error"); return; } $("up-err").textContent = ""; $("up-p").value = $("up-p2").value = ""; this.afterLogin(); };
    this.click($("in-go"), doIn); this.click($("up-go"), doUp);
    $("f-in").addEventListener("submit", (e) => { e.preventDefault(); doIn(); }); $("f-up").addEventListener("submit", (e) => { e.preventDefault(); doUp(); });
    // lobby
    for (const id of ["l-locker", "l-locker2"]) this.click($(id), () => { this.sel = null; this.go("custom"); });
    this.click($("l-progress"), () => this.go("progress")); this.click($("l-settings"), () => this.go("settings"));
    for (const id of ["l-season", "l-seasonbtn", "l-passcard"]) this.click($(id), () => { this.sTab = "track"; this.go("season"); });
    this.click($("l-prof"), () => { this.gTab = "account"; this.go("settings"); });
    this.click($("l-bell"), () => { const n = $("l-notif"); const open = n.classList.contains("x-hide"); n.classList.toggle("x-hide", !open); if (open) { n.innerHTML = this.notes.length ? this.notes.map((x) => `<div class="nt"><i>${x.ic}</i><div>${esc(x.msg)}<small>${new Date(x.t).toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" })}</small></div></div>`).join("") : `<div class="empty">${t("noNotif")}</div>`; this.notes.forEach((x) => (x.seen = true)); this.renderBell(); } });
    this.click($("l-play"), () => this.play(), "go");
    $("l-code").addEventListener("input", (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24); this.p.last.room = e.target.value; this.S.save(); });
    document.querySelectorAll("[data-back]").forEach((b) => this.click(b, () => this.back(), "back"));
    const tabs = (id, key, fn) => $(id).querySelectorAll("button").forEach((b) => this.click(b, () => { this[key] = b.dataset.v; $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); fn.call(this); }, "tab"));
    tabs("c-tabs", "cTab", this.renderCustom); tabs("p-tabs", "pTab", this.renderProgress); tabs("g-tabs", "gTab", this.renderSettings); tabs("s-tabs", "sTab", this.renderSeason);
    // showcase drag-to-rotate on empty lobby/locker space
    let dx = null; const cv = () => this.app.game.show; addEventListener("pointerdown", (e) => { if (this.cur && (e.target.classList.contains("col-c") || e.target.classList.contains("lk-show") || e.target.id === "gl")) dx = e.clientX; });
    addEventListener("pointermove", (e) => { if (dx !== null && cv()) { const s = this.app.renderer && this.app.renderer.studio; if (s) s.rot = (s.rot || 0) + (e.clientX - dx) * 0.012; dx = e.clientX; } }); addEventListener("pointerup", () => (dx = null));
    // pause / results
    this.click($("h-pause"), () => A.game.pause(true));
    this.click($("pz-resume"), () => A.game.pause(false)); this.click($("pz-restart"), () => { this.hidePause(); A.game.restart(); });
    this.click($("pz-settings"), () => { this.fromPause = true; $("m-pause").classList.add("x-hide"); this.gTab = "graphics"; this.show("settings"); });
    this.click($("pz-quit"), () => { this.hidePause(); const g = A.game; if (!g.ended && g.stats && g.mode !== "attract" && g.mode !== "show" && (performance.now() - g.stats.t0) > 8000) { g.paused = false; g.finish(g.mode === "zen" ? "zen" : "quit"); return; } g.stopMatch(); this.goLobby(); }); // progress is never lost on quit
    this.click($("r-again"), () => { $("m-results").classList.add("x-hide"); if (A.game.mode === "online") A.game.again(); else this.launch(A.game.cfg); });
    this.click($("r-lobby"), () => { A.game.stopMatch(); this.goLobby(); });
    this.click($("r-watch"), () => { if (!A.game.watchKiller()) this.toast(t("killerGone")); });
    this.click($("h-spec-back"), () => A.game.stopWatch());
    this.click($("t-next"), () => this.tutNext()); this.click($("t-skip"), () => this.tutDone());
    this.click($("rv-close"), () => this.closeReveal()); this.click($("rv-equip"), () => { const i = this.revealing; if (i >= 0 && this.S.unlocked("skin", i)) { this.p.skin = { k: "skin", i }; this.S.save(); this.toast("✓ " + t("equipped"), "good"); } this.closeReveal(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { A.game.pause(true); A.store.flush(); } });
  }
  back() {
    if (this.fromPause && this.cur === "settings") { this.fromPause = false; this.hideScreens(); $("m-pause").classList.remove("x-hide"); return; }
    this.go("lobby", "fade");
  }
  afterLogin() { this.selMode = this.p.last.mode || "classic"; this.app.applyAll(); const bonus = this.S.claimDailyBonus(); this.goLobby(); setTimeout(() => this.toast(t("welcome", { n: this.p.name }), "good"), 700); if (bonus) setTimeout(() => { this.toast("◆ " + t("dailyBonus", { n: bonus }), "gold"); this.coins(this.p.coins); }, 1500); }
  showAuth(tab = "in") {
    if (this.app.game.mode !== "attract") this.app.game.startAttract(this.p.last.world || 0, true); this.show("auth"); $("a-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === tab)); $("f-in").classList.toggle("x-hide", tab !== "in"); $("f-up").classList.toggle("x-hide", tab !== "up"); $("in-u").value = this.S.remember; $("in-rem").checked = !!this.S.remember;
    $("auth-langs").innerHTML = LANGS.map(([c, n]) => `<button data-l="${c}" class="${c === LANG ? "on" : ""}">${n}</button>`).join("");
    $("auth-langs").querySelectorAll("button").forEach((b) => this.click(b, () => { this.S.settings.lang = b.dataset.l; this.S.save(); this.app.applyLang(); this.showAuth($("f-up").classList.contains("x-hide") ? "in" : "up"); }, "tab"));
  }
  // ---------- studio intro → title flyover ----------
  intro() {
    return new Promise((res) => {
      const el = $("intro"); if (this.S.settings.reduceMotion || sessionStorage.getItem("ssp-intro")) { res(); return; }
      try { sessionStorage.setItem("ssp-intro", "1"); } catch (_) {}
      el.classList.remove("x-hide"); let done = false; const fin = () => { if (done) return; done = true; el.classList.add("out"); setTimeout(() => { el.classList.add("x-hide"); res(); }, 550); };
      el.addEventListener("pointerdown", fin, { once: true }); setTimeout(fin, 2700);
    });
  }
  title() {
    return new Promise((res) => {
      const el = $("title"); const w = this.p.last.world || 0; this.app.game.startAttract(w, true); this.app.audio.music(true, w, true); el.classList.remove("x-hide");
      let done = false; const fin = () => { if (done) return; done = true; this.app.audio.unlock(); this.app.audio.play("go"); el.classList.add("out"); setTimeout(() => { el.classList.add("x-hide"); el.classList.remove("out"); res(); }, 450); };
      $("t-start").onclick = fin; el.addEventListener("pointerdown", (e) => { if (e.target === el || e.target.closest(".t-logo")) fin(); });
    });
  }
  // ---------- cinematic loading (boot + every match) ----------
  loading(on, ctx) {
    const b = $("boot"); if (!b) return;
    if (on) { b.classList.remove("out"); b.style.display = ""; $("ld-ctx").innerHTML = ctx || ""; this.tip(); this.app.audio.play("whoosh"); }
    else { b.classList.add("out"); }
  }
  tip() { const n = 10, k = (Math.random() * n) | 0; $("ld-tip").textContent = t("tip" + (k + 1)); }
  progress(p, msg) { $("bootbar").style.width = p + "%"; $("bootpct").textContent = Math.round(p) + "%"; if (msg) $("bootmsg").textContent = msg; }

  // ---------- lobby ----------
  renderLobby() {
    const p = this.p, S = this.S, lv = lvInfo(p.xp);
    $("l-name").textContent = p.name; $("l-av").firstChild.nodeValue = (p.name || "S").slice(0, 1).toUpperCase(); $("l-av").style.background = `linear-gradient(135deg, ${primaryColor(this.app.game.mySkin())}, #120a02)`;
    $("l-lv").textContent = lv.n; $("l-xp").style.width = Math.round((lv.x / lv.need) * 100) + "%"; this.coins(p.coins);
    const tier = S.seasonTier(), into = p.season.xp - tier * SEASON.per; $("l-tier").textContent = tier; $("l-sbar").style.width = (tier >= SEASON.tiers ? 100 : Math.round((into / SEASON.per) * 100)) + "%";
    $("l-modes").innerHTML = MODE_LIST.map((m) => `<button class="mode ${m === this.selMode ? "on" : ""}" data-m="${m}" role="tab"><span class="mi">${IC[m]}</span><span><b>${t("m_" + m)}</b><small>${esc(t("m_" + m + "_d"))}</small></span>${NEW_MODES.has(m) ? `<i class="new">${t("new")}</i>` : ""}</button>`).join("");
    $("l-modes").querySelectorAll(".mode").forEach((b) => this.click(b, () => { this.selMode = b.dataset.m; p.last.mode = this.selMode; S.save(); this.renderLobby(); }, "tab"));
    const wb = $("l-worlds"); wb.innerHTML = "";
    WORLDS.forEach((w, i) => {
      const b = document.createElement("button"); const ok = S.unlocked("world", i); b.className = `world ${i === p.last.world ? "on" : ""} ${ok ? "" : "lock"}`; b.title = ok ? t("w_" + w.id) : t("unlockAt", { n: w.lv }); b.style.backgroundImage = `url(${worldAsset(w, "sky", true)})`;
      b.innerHTML = `<span>${esc(ok ? t("w_" + w.id) : "Lv " + w.lv)}</span>${ok ? "" : `<i class="lk">${IC.lock}</i>`}`;
      this.click(b, () => { if (!ok) { this.toast("🔒 " + t("unlockAt", { n: w.lv })); this.app.audio.play("error"); return; } p.last.world = i; S.save(); this.app.renderer.setWorld(i); this.app.audio.music(true, i, true); this.renderLobby(); }, "tab");
      wb.appendChild(b);
    });
    const dd = $("l-diff"); dd.classList.toggle("x-hide", this.selMode === "online" || this.selMode === "zen");
    dd.innerHTML = [0, 1, 2, 3].map((i) => `<button data-v="${i}" class="${p.last.diff === i ? "on" : ""} ${S.unlocked("diff", i) ? "" : "lock"}">${t("d" + i)}${S.unlocked("diff", i) ? "" : " " + IC.lock}</button>`).join("");
    dd.querySelectorAll("button").forEach((b) => this.click(b, () => { const i = +b.dataset.v; if (!S.unlocked("diff", i)) { this.toast("🔒 " + t("unlockAt", { n: 10 })); return; } p.last.diff = i; S.save(); this.renderLobby(); }, "tab"));
    $("l-room").classList.toggle("x-hide", this.selMode !== "online"); $("l-code").value = p.last.room || "";
    $("l-playsub").textContent = `${t("m_" + this.selMode)} · ${t("w_" + WORLDS[p.last.world || 0].id)}`;
    // season mini track
    const start = Math.max(1, Math.min(SEASON.tiers - 5, tier)); let tr = ""; for (let k = start; k < start + 6; k++) { const r = seasonReward(k); tr += `<span class="tn ${k <= tier ? "got" : ""} ${r.skin ? "leg" : ""} ${k === tier + 1 ? "cur" : ""}">${r.skin ? "★" : k}</span>`; } $("l-pctrack").innerHTML = tr;
    let nxt = 0; for (let k = tier + 1; k <= SEASON.tiers; k++) if (seasonReward(k).skin) { nxt = k; break; } $("l-pcnext").textContent = nxt ? t("legendAt", { n: nxt }) : "";
    const unclaimed = Array.from({ length: tier }, (_, i) => i + 1).some((k) => !p.season.claimed.includes(k)); $("l-sdot").classList.toggle("x-hide", !unclaimed);
    const ms = S.daily(); let anyClaim = false;
    $("l-daily").innerHTML = ms.map((m, i) => { const done = m.p >= m.g; if (done && !m.c) anyClaim = true;
      return `<div class="mis ${done ? "done" : ""}"><span>${t("mi_" + m.id, { n: m.g })}</span>${done ? (m.c ? `<span class="rw">✓</span>` : `<button class="btn gold claim" data-i2="${i}">${t("claim")} ◆${m.r}</button>`) : `<span class="rw">◆${m.r}</span>`}<div class="pb"><i style="width:${Math.round((m.p / m.g) * 100)}%"></i></div></div>`; }).join("");
    $("l-daily").querySelectorAll("[data-i2]").forEach((b) => this.click(b, () => this.claim(+b.dataset.i2), "reward"));
    const now = new Date(), mid = new Date(now); mid.setHours(24, 0, 0, 0); const hl = Math.ceil((mid - now) / 3600000); $("l-dreset").textContent = `⟳ ${hl}h`;
    $("l-pdot").classList.toggle("x-hide", !anyClaim); this.renderBell(); this.updateShow();
  }
  claim(i) { const r = this.S.claimMission(i); if (!r) return; this.toast(`◆ +${r.coins} · +${r.coins} XP`, "gold"); this.coins(this.p.coins); if (r.lv.up) { this.toast(t("levelUp", { n: r.lv.level }), "gold"); this.app.audio.play("level"); } this.checkAch(); if (this.cur === "lobby") this.renderLobby(); else this.renderProgress(); }
  checkAch() { for (const a of this.S.checkAch()) { this.toast(`${a.ic} ${t("achUnlocked", { n: t(a.id) })} · ◆${a.r}`, "gold", 3500); this.app.audio.play("ach"); } }
  play() {
    const p = this.p, mode = this.selMode; p.last.mode = mode; this.S.save();
    if (!this.S.unlocked("world", p.last.world)) p.last.world = 0;
    const cfg = { mode, world: p.last.world, diff: mode === "zen" ? 0 : p.last.diff, room: mode === "online" ? p.last.room || "" : "" };
    if (!p.tut) { this.tutStart(cfg); return; }
    this.launch(cfg);
  }
  // match launch: wipe → cinematic loading (streams the world) → match-intro camera sweep
  async launch(cfg) {
    const A = this.app; await this.wipe("go"); this.hideScreens(); $("m-results").classList.add("x-hide"); $("title").classList.add("x-hide"); $("m-reveal").classList.add("x-hide");
    const w = WORLDS[cfg.world] || WORLDS[0]; this.loading(true, `${t("m_" + cfg.mode)}<b>${esc(t("w_" + w.id))}</b>`); this.progress(10, t("loading"));
    const t0 = performance.now(); A.renderer.setWorld(cfg.world);
    let p = 10; const tick = setInterval(() => { p = Math.min(92, p + 7); this.progress(p); }, 90);
    for (let k = 0; k < 60 && !(A.renderer.worldReady ? A.renderer.worldReady() : true); k++) await new Promise((r) => setTimeout(r, 100));
    const left = 950 - (performance.now() - t0); if (left > 0) await new Promise((r) => setTimeout(r, left));
    clearInterval(tick); this.progress(100); A.game.start(cfg); setTimeout(() => this.loading(false), 120);
  }
  // ---------- tutorial ----------
  tutStart(cfg) { this.tutCfg = cfg; this.tutI = 0; $("m-tut").classList.remove("x-hide"); this.tutRender(); const loop = () => { if ($("m-tut").classList.contains("x-hide")) return; this.tutDraw(); requestAnimationFrame(loop); }; loop(); }
  tutRender() { $("t-text").textContent = t("tut" + (this.tutI + 1)); $("t-dots").innerHTML = [0, 1, 2, 3].map((i) => `<i class="${i === this.tutI ? "on" : ""}"></i>`).join(""); $("t-next").textContent = this.tutI === 3 ? t("gotIt") : t("next"); }
  tutNext() { if (this.tutI < 3) { this.tutI++; this.tutRender(); } else this.tutDone(); }
  tutDone() { $("m-tut").classList.add("x-hide"); this.p.tut = 1; this.S.save(); if (this.tutCfg) { const c = this.tutCfg; this.tutCfg = null; this.launch(c); } }
  tutDraw() {
    const c = $("t-anim"), g = c.getContext("2d"), W = c.width, H = c.height, tm = performance.now() / 1000, i = this.tutI; g.clearRect(0, 0, W, H);
    const snake = (pts, col, r) => { for (let k = pts.length - 1; k >= 0; k--) { g.fillStyle = k === 0 ? "#fff" : col; g.globalAlpha = k === 0 ? 1 : 0.9; g.beginPath(); g.arc(pts[k][0], pts[k][1], r, 0, 6.283); g.fill(); } g.globalAlpha = 1; };
    const path = (x0, y0, a0, wob, n, sp) => { const out = []; for (let k = 0; k < n; k++) out.push([x0 - k * sp * Math.cos(a0), y0 - k * sp * Math.sin(a0) + Math.sin(tm * 3 - k * 0.5) * wob]); return out; };
    if (i === 0) { const a = tm * 1.2, jx = 70, jy = 80; g.strokeStyle = "rgba(255,255,255,.3)"; g.lineWidth = 2; g.beginPath(); g.arc(jx, jy, 40, 0, 6.283); g.stroke(); g.fillStyle = "rgba(255,255,255,.6)"; g.beginPath(); g.arc(jx + Math.cos(a) * 24, jy + Math.sin(a) * 24, 16, 0, 6.283); g.fill();
      const pts = []; for (let k = 0; k < 16; k++) pts.push([240 + Math.cos(a - k * 0.12) * 50, 75 + Math.sin(a - k * 0.12) * 30]); snake(pts, "#2bd67b", 8); }
    if (i === 1) { const x = 60 + ((tm * 60) % 260); snake(path(x, 75, 0, 3, 14, 7), "#2bd67b", 8); for (let k = 0; k < 6; k++) { const fx = 110 + k * 40; if (fx > x) { g.fillStyle = ["#ff3b5c", "#ffe94d", "#29d8ff"][k % 3]; g.shadowColor = g.fillStyle; g.shadowBlur = 12; g.beginPath(); g.arc(fx, 75, 5, 0, 6.283); g.fill(); g.shadowBlur = 0; } } }
    if (i === 2) { const ph = (tm % 2) / 2, sp = ph > 0.5 ? 12 : 6, x = 40 + ((tm * (ph > 0.5 ? 140 : 60)) % 280); snake(path(x, 75, 0, 2, 14, sp * 0.9), "#ffc845", 8); g.fillStyle = ph > 0.5 ? "#ffe7a3" : "rgba(255,255,255,.35)"; g.beginPath(); g.arc(320, 120, 18, 0, 6.283); g.fill(); g.fillStyle = "#1c1405"; g.font = "bold 14px sans-serif"; g.textAlign = "center"; g.fillText("⚡", 320, 125); }
    if (i === 3) { const u = (tm % 3) / 3; const ex = 60 + u * 200; const pts = []; for (let k = 0; k < 18; k++) pts.push([200 + Math.sin(k * 0.1) * 4, 20 + k * 7]); snake(pts, "#2bd67b", 8); snake(path(Math.min(ex, 188), 75, 0, 0, 12, 7), "#ff4d61", 8); if (ex >= 188) { g.fillStyle = "#ffe7a3"; g.font = "bold 22px sans-serif"; g.textAlign = "center"; g.fillText("💥", 186, 82); } }
  }

  // ---------- locker ----------
  renderCustom() {
    const p = this.p, S = this.S, el = $("c-content"); this.coins(p.coins);
    const tab = this.cTab; let h = "";
    const card = (i) => { const s = SKINS[i], ok = S.unlocked("skin", i), on = p.skin.k === "skin" && p.skin.i === i, sel = this.sel && this.sel.k === "skin" && this.sel.i === i;
      return `<button class="item r-${s.rar} ${on ? "on" : ""} ${sel ? "sel" : ""} ${ok ? "" : "lock"}" data-k="skin" data-v="${i}"><div class="sw" style="background:${swatchCss({ k: "skin", i })}"></div><span class="rar ${s.rar} rtag">${t("rar_" + s.rar)}</span>${ok ? "" : `<span class="lkic">${IC.lock}</span>`}<b>${esc(skinName(i))}</b><small>${on ? t("equipped") : ok ? t("equip") : s.src ? this.srcText(i) : t("lockedLv", { n: s.lv })}</small></button>`; };
    if (tab === "legend") h = `<div class="grid">` + SKINS.map((s, i) => (s.fx ? card(i) : "")).join("") + `</div>`;
    else if (tab === "skins") h = `<div class="grid">` + SKINS.map((s, i) => (s.fx ? "" : card(i))).join("") + `</div>`;
    else if (tab === "flags") {
      const q = this.flagQ.toLowerCase(); const list = FLAGS.filter((f) => !q || flagName(f, LANG).toLowerCase().includes(q) || f.en.toLowerCase().includes(q) || f.c.toLowerCase() === q);
      list.sort((a, b) => (p.flags.includes(b.i) - p.flags.includes(a.i)));
      h = `<div class="searchbar"><input type="search" id="c-fq" placeholder="${t("search")}" value="${esc(this.flagQ)}" /><span class="fine">${p.flags.length}/${FLAGS.length}</span></div><div class="grid">` +
        list.map((f) => { const own = p.flags.includes(f.i), on = p.skin.k === "flag" && p.skin.i === f.i; return `<button class="item ${on ? "on" : ""}" data-k="flag" data-v="${f.i}"><div class="sw" style="background:${swatchCss({ k: "flag", i: f.i })}"></div><b>${flagEmoji(f.c)} ${esc(flagName(f, LANG))}</b><small>${on ? t("equipped") : own ? t("equip") : "◆ " + FLAG_PRICE}</small></button>`; }).join("") + `</div>`;
    } else if (tab === "editor") {
      const c = p.custom; h = `<h4 class="sub">${t("pattern")}</h4><div class="pats">` + PATTERNS.map((pt, i) => `<button class="item ${c.p === i ? "on" : ""}" data-k="pat" data-v="${i}"><div class="sw" style="background:${swatchCss({ k: "custom", p: i, c: c.c })}"></div><b>${cap(pt)}</b></button>`).join("") + `</div>
        <div class="ed-row"><label>${t("color1")}<input type="color" data-ci="0" value="${c.c[0]}"></label><label>${t("color2")}<input type="color" data-ci="1" value="${c.c[1]}"></label><label>${t("color3")}<input type="color" data-ci="2" value="${c.c[2]}"></label>
        <button class="btn gold" id="c-useed">${p.skin.k === "custom" ? "✓ " + t("equipped") : t("equip")}</button></div>`;
    } else if (tab === "eyes") h = `<div class="grid">` + EYES.map((e, i) => { const ok = S.unlocked("eye", i), on = p.eye === i; return `<button class="item ${on ? "on" : ""} ${ok ? "" : "lock"}" data-k="eye" data-v="${i}"><div class="emo">${eyeIcon(e)}</div><b>${cap(e.id)}</b><small>${on ? t("equipped") : ok ? t("equip") : "🔒 " + t("lockedLv", { n: e.lv })}</small></button>`; }).join("") + `</div>`;
    else if (tab === "trails") h = `<div class="grid">` + TRAILS.map((tr, i) => { const ok = S.unlocked("trail", i), on = p.trail === i; return `<button class="item ${on ? "on" : ""} ${ok ? "" : "lock"}" data-k="trail" data-v="${i}"><div class="sw" style="background:${tr.c ? `radial-gradient(circle at 30% 50%, ${tr.c[0]} 0 3px, transparent 4px), radial-gradient(circle at 60% 40%, ${tr.c[1]} 0 2px, transparent 3px), radial-gradient(circle at 80% 60%, ${tr.c[0]} 0 2px, transparent 3px), #10131b` : "#10131b"}"></div><b>${cap(tr.id)}</b><small>${on ? t("equipped") : ok ? t("equip") : "🔒 " + t("lockedLv", { n: tr.lv })}</small></button>`; }).join("") + `</div>`;
    else if (tab === "name") h = `<h4 class="sub">${t("displayName")}</h4><input type="text" id="c-name" maxlength="16" value="${esc(p.name)}" /><h4 class="sub">${t("nameColor")}</h4><div class="namecols">` + NAME_COLORS.map((c, i) => `<button data-k="nc" data-v="${i}" class="${p.nc === i ? "on" : ""}" style="background:${c}" aria-label="${c}"></button>`).join("") + `</div>`;
    el.innerHTML = h;
    el.querySelectorAll("[data-k]").forEach((b) => this.click(b, () => this.pick(b.dataset.k, +b.dataset.v), "tab"));
    const fq = $("c-fq"); if (fq) fq.addEventListener("input", (e) => { this.flagQ = e.target.value; const pos = e.target.selectionStart; this.renderCustom(); const n = $("c-fq"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} });
    el.querySelectorAll("[data-ci]").forEach((inp) => inp.addEventListener("input", (e) => { p.custom.c[+e.target.dataset.ci] = e.target.value; p.skin = { k: "custom", i: 0 }; S.save(); el.querySelectorAll(".pats .sw").forEach((sw, i) => (sw.style.background = swatchCss({ k: "custom", p: i, c: p.custom.c }))); this.sel = null; this.renderInfo(); this.updateShow(); }));
    const ue = $("c-useed"); if (ue) this.click(ue, () => { p.skin = { k: "custom", i: 0 }; S.save(); this.sel = null; this.renderCustom(); });
    const nm = $("c-name"); if (nm) nm.addEventListener("change", (e) => { const v = e.target.value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16); p.name = v || p.name; e.target.value = p.name; S.save(); });
    this.renderPresets(); this.renderInfo(); this.updateShow();
  }
  srcText(i) { const [k, n] = (SKINS[i].src || "").split(":"); return k === "coins" ? "◆ " + fmtNum(+n) : t("src_" + k, { n: k === "chain" ? t("ch_" + n) : n }); }
  renderInfo() {
    const p = this.p, S = this.S, d = this.sel || this.app.game.mySkin(); let h = "";
    if (d.k === "skin") { const s = SKINS[d.i], ok = S.unlocked("skin", d.i), on = p.skin.k === "skin" && p.skin.i === d.i, price = S.legendPrice(d.i), L = LEGEND[s.fx];
      h = `<span class="rar ${s.rar}">${t("rar_" + s.rar)}</span><b>${esc(skinName(d.i))}</b>${L ? `<p>${t("legendPerks")}</p>` : ""}`;
      h += on ? `<button class="btn ghost wide" disabled>✓ ${t("equipped")}</button>` : ok ? `<button class="btn gold wide" id="ci-eq">${t("equip")}</button>` : price ? `<button class="btn gold wide" id="ci-buy">${t("buy")} · ◆ ${fmtNum(price)}</button>` : `<p>${IC.lock} ${s.src ? this.srcText(d.i) : t("lockedLv", { n: s.lv })}</p>`; }
    else if (d.k === "flag") h = `<span class="rar rare">${t("rar_rare")}</span><b>${flagEmoji(FLAGS[d.i].c)} ${esc(flagName(FLAGS[d.i], LANG))}</b>`;
    else h = `<span class="rar epic">${t("rar_epic")}</span><b>${t("custom")}</b>`;
    $("c-info").innerHTML = h;
    const eq = $("ci-eq"); if (eq) this.click(eq, () => { p.skin = { k: "skin", i: d.i }; S.save(); this.sel = null; this.renderCustom(); this.toast("✓ " + t("equipped"), "good"); });
    const by = $("ci-buy"); if (by) this.click(by, () => { const r = S.buyLegend(d.i); if (r === "noCoins") { this.toast(t("noCoins"), "warn"); this.app.audio.play("error"); return; } if (r === "ok") { this.coins(p.coins); this.reveal(d.i); this.renderCustom(); } }, "reward");
  }
  pick(k, v) {
    const p = this.p, S = this.S;
    if (k === "skin") { if (!S.unlocked("skin", v)) { this.sel = { k: "skin", i: v, e: p.eye, t: p.trail, n: p.nc }; this.renderCustom(); return; } p.skin = { k: "skin", i: v }; this.sel = null; }
    else if (k === "flag") { if (!p.flags.includes(v)) { const r = S.buyFlag(v); if (r === "noCoins") { this.toast(t("noCoins"), "warn"); this.app.audio.play("error"); return; } this.toast(t("bought") + " " + flagEmoji(FLAGS[v].c), "good"); this.coins(p.coins); this.checkAch(); } p.skin = { k: "flag", i: v }; this.sel = null; }
    else if (k === "pat") { p.custom.p = v; p.skin = { k: "custom", i: 0 }; this.sel = null; }
    else if (k === "eye") { if (!S.unlocked("eye", v)) { this.toast("🔒 " + t("unlockAt", { n: EYES[v].lv })); return; } p.eye = v; }
    else if (k === "trail") { if (!S.unlocked("trail", v)) { this.toast("🔒 " + t("unlockAt", { n: TRAILS[v].lv })); return; } p.trail = v; }
    else if (k === "nc") p.nc = v;
    S.save(); this.renderCustom();
  }
  renderPresets() {
    const p = this.p, box = $("c-presets");
    box.innerHTML = p.presets.map((pr, i) => pr ? `<div class="pre full"><div class="sw" style="background:${swatchCss(pr.skin.k === "custom" ? { k: "custom", p: pr.custom.p, c: pr.custom.c } : pr.skin)}"></div><div class="pre-act"><button data-pl="${i}">${t("load")}</button><button data-ps="${i}">${t("save")}</button></div></div>` : `<button class="pre" data-ps="${i}">+ ${t("save")}</button>`).join("");
    box.querySelectorAll("[data-ps]").forEach((b) => this.click(b, () => { p.presets[+b.dataset.ps] = { skin: { ...p.skin }, custom: { p: p.custom.p, c: [...p.custom.c] }, eye: p.eye, trail: p.trail, nc: p.nc }; this.S.save(); this.toast("✓ " + t("save"), "good"); this.checkAch(); this.renderPresets(); }));
    box.querySelectorAll("[data-pl]").forEach((b) => this.click(b, () => { const pr = p.presets[+b.dataset.pl]; if (!pr) return; Object.assign(p, { skin: { ...pr.skin }, custom: { p: pr.custom.p, c: [...pr.custom.c] }, eye: pr.eye, trail: pr.trail, nc: pr.nc }); this.S.save(); this.sel = null; this.renderCustom(); }));
  }
  // ---------- rarity reveal ----------
  reveal(i) { if (i === undefined || i < 0) return; this.revealQ.push(i); if (!this.revealing && this.revealing !== 0) this.nextReveal(); }
  nextReveal() {
    if ($("m-results") && !$("m-results").classList.contains("x-hide")) return; const i = this.revealQ.shift(); if (i === undefined) { this.revealing = undefined; return; }
    this.revealing = i; const s = SKINS[i]; const m = $("m-reveal"); m.className = "r-" + s.rar; $("rv-rar").textContent = t("rar_" + s.rar); $("rv-name").textContent = skinName(i); $("rv-sub").textContent = t("newLegend");
    const prevCur = this.cur; this.app.game.startShow(); this.sel = { k: "skin", i, e: this.p.eye, t: this.p.trail, n: this.p.nc }; const was = this.cur; this.cur = "custom"; this.updateShow(); this.cur = was; this.app.game.show.x = 0; this.app.game.show.zoom = 1.25; this.app.game.show.lift = -0.6;
    this.app.audio.play("reveal"); haptic.pattern([20, 40, 60, 40, 120]); setTimeout(() => this.app.renderer.reveal && this.app.renderer.reveal(), 600); this.note(t("newLegend") + " " + skinName(i), "★");
    m.classList.remove("x-hide"); m.style.display = ""; document.body.classList.add("revealing");
  }
  closeReveal() { $("m-reveal").classList.add("x-hide"); document.body.classList.remove("revealing"); this.sel = null; this.revealing = undefined; if (this.cur) this.show(this.cur); if (this.revealQ.length) setTimeout(() => this.nextReveal(), 300); }

  // ---------- season pass, weekly challenges, mission chains ----------
  renderSeason() {
    const p = this.p, S = this.S, el = $("s-content"), tab = this.sTab; this.coins(p.coins); let h = "";
    if (tab === "track") {
      const tier = S.seasonTier(), into = p.season.xp - tier * SEASON.per;
      h = `<div class="trk-head"><div><small class="fine">${t("season1")}</small><div class="big">${t("tier")} ${tier}</div></div><div class="xpbar"><i style="width:${tier >= SEASON.tiers ? 100 : Math.round((into / SEASON.per) * 100)}%"></i></div><small class="fine">${tier >= SEASON.tiers ? "MAX" : `${fmtNum(into)} / ${fmtNum(SEASON.per)} XP`}</small></div><div class="track" id="trk">`;
      for (let k = 1; k <= SEASON.tiers; k++) { const r = seasonReward(k), got = k <= tier, cl = p.season.claimed.includes(k); const i = r.skin ? SKINS.findIndex((s) => s.id === r.skin) : -1;
        h += `<div class="tier ${got ? "ok" : ""} ${cl ? "claimed" : ""} ${r.skin ? "leg" : ""} ${k === tier + 1 ? "cur" : ""}"><span class="tn2">${t("tier")} ${k}</span><div class="rwd">${r.skin ? `<div><div class="sw" style="background:${swatchCss({ k: "skin", i })}"></div><span class="rar legendary">${t("rar_legendary")}</span><br>${esc(skinName(i))}</div>` : `<div><div class="bigc">${r.chest ? "🎁" : "◆"} ${fmtNum(r.coins)}</div>${r.chest ? t("chest") : t("coins")}</div>`}</div>${cl ? `<button class="btn ghost" disabled>✓</button>` : got ? `<button class="btn gold" data-tier="${k}">${t("claim")}</button>` : `<button class="btn ghost" disabled>${IC.lock}</button>`}</div>`; }
      h += `</div><p class="fine">${t("seasonNote")}</p>`;
    } else if (tab === "weekly") {
      const W = S.weekly(); h = `<h4 class="sub">${t("weekly")} · ${t("weeklyDone", { n: Math.min(3, p.weekly.done || 0) })}</h4>` + W.map((m, i) => { const done = m.p >= m.g; return `<div class="mis ${done ? "done" : ""}"><span>${t("wk_" + m.id, { n: fmtNum(m.g) })} · ${fmtNum(m.p)}/${fmtNum(m.g)}</span>${done ? (m.c ? `<span class="rw">✓ ${t("claimed")}</span>` : `<button class="btn gold claim" data-wk="${i}">${t("claim")} ◆${m.r}</button>`) : `<span class="rw">◆${m.r}</span>`}<div class="pb"><i style="width:${Math.round((m.p / m.g) * 100)}%"></i></div></div>`; }).join("");
      h += `<h4 class="sub">${t("daily")}</h4>` + S.daily().map((m, i) => { const done = m.p >= m.g; return `<div class="mis ${done ? "done" : ""}"><span>${t("mi_" + m.id, { n: m.g })} · ${fmtNum(m.p)}/${fmtNum(m.g)}</span>${done ? (m.c ? `<span class="rw">✓</span>` : `<button class="btn gold claim" data-i2="${i}">${t("claim")} ◆${m.r}</button>`) : `<span class="rw">◆${m.r}</span>`}<div class="pb"><i style="width:${Math.round((m.p / m.g) * 100)}%"></i></div></div>`; }).join("");
    } else {
      for (const id in CHAINS) { const C = CHAINS[id], c = S.chain(id), i = SKINS.findIndex((s) => s.id === C.reward), done = c.s >= C.steps.length;
        h += `<div class="chain"><h4><span>${t("ch_" + id)}</span><span class="rar legendary">${esc(skinName(i))}</span></h4><div class="steps">` + C.steps.map(([k, g], j) => `<div class="stp ${j < c.s ? "done" : ""} ${j === c.s && !done ? "cur" : ""}">${j < c.s ? "✓ " : ""}${t("chs_" + k, { n: fmtNum(g) })}${j === c.s && !done ? `<div class="pb"><i style="width:${Math.min(100, Math.round((c.p / g) * 100))}%"></i></div>` : ""}</div>`).join("") + `</div></div>`; }
    }
    el.innerHTML = h;
    el.querySelectorAll("[data-tier]").forEach((b) => this.click(b, () => { const r = S.claimTier(+b.dataset.tier); if (!r) return; if (r.coins) { this.toast(`◆ +${r.coins}`, "gold"); this.coins(p.coins); } if (r.skinI !== null && r.skinI !== undefined) this.reveal(r.skinI); this.renderSeason(); }, "reward"));
    el.querySelectorAll("[data-wk]").forEach((b) => this.click(b, () => { const r = S.claimWeekly(+b.dataset.wk); if (!r) return; this.toast(`◆ +${r.coins}`, "gold"); this.coins(p.coins); if (r.skinI !== null && r.skinI >= 0) this.reveal(r.skinI); this.renderSeason(); }, "reward"));
    el.querySelectorAll("[data-i2]").forEach((b) => this.click(b, () => { this.claim(+b.dataset.i2); this.renderSeason(); }, "reward"));
    const trk = $("trk"); if (trk) { const tier = S.seasonTier(); requestAnimationFrame(() => { const c = trk.children[Math.max(0, tier - 1)]; if (c) trk.scrollLeft = c.offsetLeft - trk.clientWidth / 2 + 48; }); }
  }

  // ---------- progress ----------
  renderProgress() {
    const p = this.p, S = this.S, el = $("p-content"), tab = this.pTab; this.coins(p.coins); let h = "";
    if (tab === "missions") {
      const lv = lvInfo(p.xp); h = `<div class="stat" style="margin-bottom:10px"><small>${t("level")}</small><b>${lv.n} <span class="fine">${fmtNum(lv.x)} / ${fmtNum(lv.need)} XP</span></b><div class="xpbar big" style="margin-top:8px"><i style="width:${Math.round((lv.x / lv.need) * 100)}%"></i></div></div><h4 class="sub">${t("daily")}</h4>`;
      h += S.daily().map((m, i) => { const done = m.p >= m.g; return `<div class="mis ${done ? "done" : ""}"><span>${t("mi_" + m.id, { n: m.g })} · ${fmtNum(m.p)}/${fmtNum(m.g)}</span>${done ? (m.c ? `<span class="rw">✓ ${t("claimed")}</span>` : `<button class="btn gold claim" data-i2="${i}">${t("claim")} ◆${m.r}</button>`) : `<span class="rw">◆${m.r} · ${m.r} XP</span>`}<div class="pb"><i style="width:${Math.round((m.p / m.g) * 100)}%"></i></div></div>`; }).join("");
    } else if (tab === "ach") {
      const got = Object.keys(p.ach).length; h = `<p class="fine" style="margin-bottom:8px">${got}/${Store.ACH.length}</p><div class="achs">` + Store.ACH.map(([id, ic, , r]) => `<div class="ach ${p.ach[id] ? "got" : ""}"><div class="ic">${ic}</div><div><b>${t(id)}</b><small>${esc(achDesc(id))}</small></div><span class="rw">${p.ach[id] ? "✓" : "◆" + r}</span></div>`).join("") + `</div>`;
    } else if (tab === "stats") {
      const s = p.stats, kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills, dur = (x) => (x >= 3600 ? (x / 3600).toFixed(1) + " h" : x >= 60 ? t("min", { n: Math.round(x / 60) }) : t("sec", { n: x }));
      const rows = [["st_games", fmtNum(s.games)], ["st_wins", fmtNum(s.wins || 0)], ["st_kills", fmtNum(s.kills)], ["st_deaths", fmtNum(s.deaths)], ["st_kd", kd], ["st_food", fmtNum(s.food)], ["st_best", fmtNum(s.best)], ["st_top", fmtNum(s.top)], ["st_life", dur(s.life)], ["st_time", dur(s.time)], ["st_boost", dur(s.boost)], ["st_online", fmtNum(s.online)], ["st_boss", fmtNum(s.bossKills || 0)]];
      h = `<div class="stats">` + rows.map(([k, v]) => `<div class="stat"><small>${t(k)}</small><b>${v}</b></div>`).join("") + `</div>`;
    } else if (tab === "bests") {
      const modes = ["classic", "br", "koth", "boss", "team", "time", "survival", "online", "zen"]; this.bMode = this.bMode || "classic";
      h = `<div class="seg small" id="b-modes" style="margin-bottom:10px">` + modes.map((m) => `<button data-v="${m}" class="${m === this.bMode ? "on" : ""}">${t("m_" + m)}</button>`).join("") + `</div>`;
      const L = p.bests[this.bMode] || [];
      h += L.length ? `<table class="lb"><tr><th>#</th><th>${t("bests")}</th><th>${t("r_mass")}</th><th>${t("r_kills")}</th><th>${t("world")}</th><th></th></tr>` + L.map((e, i) => `<tr><td>${i + 1}</td><td>${fmtNum(e.s)}</td><td>${fmtNum(e.m || 0)}</td><td>${e.k}</td><td>${t("w_" + (WORLDS[e.w] || WORLDS[0]).id)}</td><td class="fine">${new Date(e.d).toLocaleDateString(LANG)}</td></tr>`).join("") + `</table>` : `<p class="fine">${t("noBests")}</p>`;
    }
    el.innerHTML = h;
    el.querySelectorAll("[data-i2]").forEach((b) => this.click(b, () => this.claim(+b.dataset.i2), "reward"));
    const bm = $("b-modes"); if (bm) bm.querySelectorAll("button").forEach((b) => this.click(b, () => { this.bMode = b.dataset.v; this.renderProgress(); }, "tab"));
  }

  // ---------- settings ----------
  renderSettings() {
    const s = this.S.settings, el = $("g-content"), tab = this.gTab; let rows = [];
    $("g-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === tab));
    const seg = (k, opts, label, sub) => ({ k, type: "seg", opts, label, sub }), tog = (k, label, sub) => ({ k, type: "tog", label, sub }), rng = (k, label, min, max, step, fmt) => ({ k, type: "rng", label, min, max, step, fmt });
    const R = this.app.renderer;
    if (tab === "graphics") rows = [seg("quality", [["auto", t("q_auto")], ["low", t("q_low")], ["medium", t("q_medium")], ["high", t("q_high")], ["ultra", t("q_ultra")]], "quality", R ? (s.quality === "auto" ? "→ " + t("q_" + R.qName) : "") + (R.dyn && R.dyn < 0.99 ? ` · ${t("dynRes")} ${Math.round(R.dyn * 100)}%` : "") : ""),
      seg("renderer", [["3d", t("r3d")], ["2d", t("r2d")]], "renderer"), seg("fpsCap", [[30, "30"], [60, "60"], [0, "∞"]], "fpsCap"), tog("showFps", "showFps"), tog("postFx", "postFx", t("postFxSub")), tog("juice", "juice"), tog("minimap", "minimap")];
    if (tab === "controls") rows = [seg("ctrl", [["joy", t("c_joy")], ["follow", t("c_follow")], ["swipe", t("c_swipe")]], "ctrlType"), rng("sens", "sens", 0.5, 2, 0.05, (v) => v.toFixed(2) + "×"), tog("left", "leftHand"),
      rng("boostSize", "boostSize", 0.7, 1.4, 0.05, (v) => Math.round(v * 100) + "%"), rng("boostPos", "boostPos", 0, 1, 0.05, (v) => Math.round(v * 100) + "%"), { ...tog("haptics", "haptics"), sub: navigator.vibrate ? "" : t("hapticsNo") }];
    if (tab === "audio") rows = [rng("vMaster", "vMaster", 0, 1, 0.01, (v) => Math.round(v * 100) + "%"), rng("vSfx", "vSfx", 0, 1, 0.01, (v) => Math.round(v * 100) + "%"), rng("vMusic", "vMusic", 0, 1, 0.01, (v) => Math.round(v * 100) + "%")];
    if (tab === "access") rows = [tog("cb", "cbMode"), tog("reduceMotion", "reduceMotion"), tog("bigText", "bigText"), { type: "btn", label: "tutorial", act: "tut" }];
    if (tab === "lang") rows = [{ type: "lang" }];
    if (tab === "account") rows = [{ type: "acct" }];
    let h = "";
    for (const r of rows) {
      if (r.type === "seg") h += `<div class="set-row"><span>${t(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span><div class="seg small" data-k="${r.k}">${r.opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[r.k]) === String(v) ? "on" : ""}">${l}</button>`).join("")}</div></div>`;
      if (r.type === "tog") h += `<div class="set-row"><span>${t(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span><button class="toggle ${s[r.k] ? "on" : ""}" data-t="${r.k}" role="switch" aria-checked="${!!s[r.k]}" aria-label="${t(r.label)}"></button></div>`;
      if (r.type === "rng") h += `<div class="set-row"><span>${t(r.label)}</span><span style="flex-direction:row;align-items:center"><input type="range" data-r="${r.k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${s[r.k]}" style="--p:${((s[r.k] - r.min) / (r.max - r.min)) * 100}%" aria-label="${t(r.label)}"><span class="rv" data-rv="${r.k}">${r.fmt(s[r.k])}</span></span></div>`;
      if (r.type === "btn") h += `<div class="set-row"><span>${t(r.label)}</span><button class="btn" data-act="${r.act}">▶</button></div>`;
      if (r.type === "lang") h += LANGS.map(([c, n]) => `<div class="set-row"><span>${n}</span><button class="toggle ${s.lang === c ? "on" : ""}" data-lang="${c}" role="radio" aria-checked="${s.lang === c}" aria-label="${n}"></button></div>`).join("");
      if (r.type === "acct") { const g = this.S.isGuest, a = !g && this.S.acc[this.S.cur];
        h += `<div class="set-row"><span>${esc(this.p.name)}<small>${g ? t("guestNote") : esc(a.email || "")}</small></span>${g ? `<button class="btn primary" data-act="signup">${t("signUp")}</button>` : `<button class="btn" data-act="signout">${t("signOut")}</button>`}</div>
          <div class="set-row"><span>${t("resetProg")}</span><button class="btn danger" data-act="reset">${t("resetProg")}</button></div>
          <div class="set-row"><span>${t("privacy")}<small>${t("localNote")}</small></span><a class="btn" href="../privacy.html" target="_blank" rel="noopener">↗</a></div>
          <div class="set-row"><span>${t("credits")}<small>${t("creditsSub")}</small></span><a class="btn" href="CREDITS.md" target="_blank" rel="noopener">↗</a></div>
          <p class="fine" style="text-align:center;margin-top:10px">${t("version")}</p>`; }
    }
    el.innerHTML = h;
    el.querySelectorAll(".seg[data-k]").forEach((g) => g.querySelectorAll("button").forEach((b) => this.click(b, () => { const k = g.dataset.k; let v = b.dataset.v; if (typeof s[k] === "number") v = +v; s[k] = v; this.S.save(); this.app.applySetting(k); this.renderSettings(); }, "tab")));
    el.querySelectorAll("[data-t]").forEach((b) => this.click(b, () => { const k = b.dataset.t; s[k] = !s[k]; this.S.save(); this.app.applySetting(k); this.renderSettings(); }, "toggle"));
    el.querySelectorAll("[data-r]").forEach((inp) => { const k = inp.dataset.r, row = rows.find((r) => r.k === k);
      inp.addEventListener("input", () => { s[k] = +inp.value; inp.style.setProperty("--p", ((s[k] - row.min) / (row.max - row.min)) * 100 + "%"); el.querySelector(`[data-rv="${k}"]`).textContent = row.fmt(s[k]); this.app.applySetting(k); });
      inp.addEventListener("change", () => { this.S.save(); if (k.startsWith("v")) { this.app.audio.unlock(); this.app.audio.play("eat"); } }); });
    el.querySelectorAll("[data-lang]").forEach((b) => this.click(b, () => { s.lang = b.dataset.lang; this.S.save(); this.app.applyLang(); this.renderSettings(); }, "toggle"));
    el.querySelectorAll("[data-act]").forEach((b) => this.click(b, async () => {
      const a = b.dataset.act;
      if (a === "tut") { this.tutCfg = null; this.tutI = 0; this.tutStart(null); }
      if (a === "signup") this.showAuth("up");
      if (a === "signout") { this.S.signOut(); this.app.applyAll(); this.showAuth(); }
      if (a === "reset") { if (await this.confirm(t("confirmReset"))) { this.S.resetProgress(); this.app.applyAll(); this.toast("✓", "good"); this.renderSettings(); } }
    }));
  }

  // ---------- pause & results ----------
  hideResults() { $("m-results").classList.add("x-hide"); this.app.hud.show(this.app.game.mode); }
  reshowResults() { const m = $("m-results"); m.classList.remove("x-hide"); this.app.hud.hide(); $("r-watch").classList.toggle("x-hide", !(this.app.game.killer && this.app.game.killer.alive)); }
  showPause(online) { $("m-pause").classList.remove("x-hide"); $("pz-online").classList.toggle("x-hide", !online); $("pz-online").textContent = online ? t("m_online_d") : ""; $("pz-restart").classList.toggle("x-hide", online); }
  hidePause() { $("m-pause").classList.add("x-hide"); }
  showResults(r) {
    const m = $("m-results"); m.classList.remove("x-hide"); this.app.hud.hide(); m.querySelector(".results").classList.toggle("win", !!r.win);
    $("r-title").textContent = r.title; $("r-sub").textContent = r.sub || ""; $("r-best").classList.toggle("x-hide", !r.newBest);
    const sc = $("r-score"), target = r.score, t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / 900); sc.textContent = fmtNum(k >= 1 ? target : target * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); }; step();
    const cells = [["r_mass", fmtNum(r.mass)], ["r_kills", r.kills], ["r_rank", r.rank === "—" ? "—" : "#" + r.rank], ["r_time", fmtTime(r.time)]]; if (r.mode === "survival") cells[2] = ["wave", r.wave];
    $("r-grid").innerHTML = cells.map(([a, b]) => `<div><small>${a === "wave" ? t("wave", { n: "" }).trim() : t(a)}</small><b>${b}</b></div>`).join("");
    const lv = lvInfo(this.p.xp); $("r-lv").textContent = lv.n; $("r-xpbar").style.width = "0"; setTimeout(() => ($("r-xpbar").style.width = Math.round((lv.x / lv.need) * 100) + "%"), 60);
    this.lastResults = r; $("r-watch").classList.toggle("x-hide", !r.killer); $("r-season").textContent = "✦ " + t("seasonXp", { n: r.seasonXp || r.xp }) + (r.pu ? " · " + t("puUsed", { n: r.pu }) : "");
    $("r-xp").textContent = t("xpGain", { n: r.xp }); $("r-coins").textContent = "◆ " + t("coinGain", { n: r.coins });
    const ex = []; if (r.lv.up) ex.push("⭐ " + t("levelUp", { n: r.lv.level })); if (r.tiers) ex.push("✦ " + t("tierUp", { n: this.S.seasonTier() }));
    for (const ms of r.missions) ex.push("✓ " + t("missionDone", { n: t("mi_" + ms.id, { n: ms.g }) })); for (const w of (r.mp && r.mp.weekly) || []) ex.push("✓ " + t("wk_" + w.id, { n: fmtNum(w.g) }));
    for (const c of (r.mp && r.mp.chains) || []) ex.push("⛓ " + t("ch_" + c.id) + " " + c.step + "/4"); for (const a of r.ach) ex.push(a.ic + " " + t(a.id));
    $("r-extra").innerHTML = ex.map((x, i) => `<span style="animation-delay:${0.3 + i * 0.08}s">${esc(x)}</span>`).join("");
    for (const a of r.ach) this.toast(`${a.ic} ${t("achUnlocked", { n: t(a.id) })} · ◆${a.r}`, "gold", 3500);
    if (r.tiers) this.note(t("tierUp", { n: this.S.seasonTier() }), "✦");
    for (const i of (r.mp && r.mp.legends) || []) this.revealQ.push(i);
    this.coins(this.p.coins);
  }
}
function eyeIcon(e) { return { classic: "👀", cute: "🥺", fierce: "😠", cyber: "🤖", sleepy: "😪", cyclops: "👁️", demon: "😈" }[e.id] || "👀"; }
