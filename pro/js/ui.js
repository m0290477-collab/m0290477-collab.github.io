// Menus, HUD, modals, tutorial, customization preview. Every control here is wired to real state.
import { t, LANGS, LANG, achDesc, fmtNum } from "./i18n.js";
import { SKINS, FLAGS, EYES, TRAILS, NAME_COLORS, PATTERNS, FLAG_PRICE, flagName, flagEmoji, swatchCss, compileSkin, primaryColor } from "./skins.js";
import { WORLDS, paintGround } from "./worlds.js";
import { Store, lvInfo } from "./store.js";
import { haptic } from "./audio.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const IC = {
  classic: '<svg viewBox="0 0 24 24"><path d="M4 16c2.5-6 6 2 8.5-4S18 8 20 10"/><circle cx="19.5" cy="9.5" r="1.2" fill="currentColor"/></svg>',
  time: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 2.5h5M12 2.5v3"/></svg>',
  survival: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6l7-3Z"/><path d="M9 12l2 2 4-4"/></svg>',
  zen: '<svg viewBox="0 0 24 24"><path d="M12 4c2.5 2.6 2.5 6.4 0 9-2.5-2.6-2.5-6.4 0-9Z"/><path d="M4 12c3 0 5.5 1.3 8 4 2.5-2.7 5-4 8-4-1 4.5-4.5 7-8 7s-7-2.5-8-7Z"/></svg>',
  online: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5S14.6 18.1 12 20.5C9.4 18.1 8.2 15.3 8.2 12S9.4 5.9 12 3.5Z"/></svg>',
  crown: '<svg viewBox="0 0 24 24" class="crown"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5L3 8Z" fill="currentColor" stroke="none"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};
const MODE_LIST = [["classic"], ["time"], ["survival"], ["zen"], ["online"]];
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, "0")}`; };

export class Hud {
  constructor(app) { this.app = app; this.mini = $("h-mini").getContext("2d"); this.bt = 0; this.lastLb = ""; }
  show(mode) {
    $("hud").classList.remove("x-hide"); $("h-timer").classList.toggle("x-hide", !(mode === "time" || mode === "survival")); $("h-feed").innerHTML = ""; $("h-pop").innerHTML = "";
    $("h-mini").classList.toggle("x-hide", !this.app.store.settings.minimap); $("h-fps").classList.toggle("x-hide", !this.app.store.settings.showFps);
  }
  hide() { $("hud").classList.add("x-hide"); }
  update(d) {
    this.massShown = this.massShown == null ? d.mass : this.massShown + (d.mass - this.massShown) * 0.5; if (Math.abs(d.mass - this.massShown) < 1) this.massShown = d.mass; $("h-mass").textContent = fmtNum(this.massShown); $("h-rank").textContent = d.rank ? `#${d.rank}/${d.total}` : "–"; $("h-kills").textContent = d.kills;
    const tm = $("h-timer");
    if (d.timeLeft !== null) { tm.textContent = "⏱ " + fmtTime(d.timeLeft); tm.classList.toggle("warn", d.timeLeft < 15); }
    else if (d.wave !== null) { tm.textContent = t("wave", { n: d.wave }); tm.classList.remove("warn"); }
    let h = ""; d.top.forEach((s, i) => { h += `<div class="${s === d.me ? "me" : ""}"><i>${i === 0 ? IC.crown : i + 1}</i><em style="background:${this.dot(s)}"></em><span>${esc(s.name || "?")}</span><b>${fmtNum(s.m)}</b></div>`; });
    if (d.me && d.me.alive && d.rank > 5) h += `<div class="me sep"><i>${d.rank}</i><span>${esc(d.me.name)}</span><b>${fmtNum(d.me.m)}</b></div>`;
    if (d.ping !== null) h += `<div class="sep"><span>${t("online", { n: d.ping })}</span><b>${d.humans ? "👤" + d.humans : ""}</b></div>`;
    if (h !== this.lastLb) { $("h-lb").innerHTML = h; this.lastLb = h; }
  }
  dot(s) { const k = s.skin ? JSON.stringify(s.skin) : ""; this._dots = this._dots || new Map(); let c = this._dots.get(k); if (!c) { c = s.skin ? primaryColor(s.skin) : "#888"; this._dots.set(k, c); } return c; }
  minimap(all, me, R, pal) {
    const g = this.mini, S = 180; g.clearRect(0, 0, S, S); const k = (S / 2 - 6) / R;
    const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2); gr.addColorStop(0, "rgba(255,255,255,0.02)"); gr.addColorStop(1, "rgba(245,196,81,0.12)"); g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, 6.283); g.fill();
    g.strokeStyle = "rgba(245,196,81,0.55)"; g.lineWidth = 2.5; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, 6.283); g.stroke();
    if (me && me.alive) { const mx = S / 2 + me.x * k, my = S / 2 + me.y * k; g.fillStyle = "rgba(255,231,163,0.10)"; g.beginPath(); g.moveTo(mx, my); g.arc(mx, my, 34, me.a - 0.7, me.a + 0.7); g.closePath(); g.fill(); }
    const lead = all[0]; if (lead && lead !== me) { g.fillStyle = "#f5c451"; g.font = "bold 16px sans-serif"; g.textAlign = "center"; g.fillText("♛", S / 2 + lead.x * k, S / 2 + lead.y * k - 8); }
    for (const s of all) { if (s === me) continue; g.fillStyle = s.bot ? "rgba(255,255,255,0.45)" : "rgba(120,200,255,0.9)"; const r = Math.max(2.5, Math.min(7, s.r * 2.2)); g.beginPath(); g.arc(S / 2 + s.x * k, S / 2 + s.y * k, r, 0, 6.283); g.fill(); }
    if (me && me.alive) { g.fillStyle = "#ffe7a3"; g.shadowColor = "#f5c451"; g.shadowBlur = 8; g.beginPath(); g.arc(S / 2 + me.x * k, S / 2 + me.y * k, 6, 0, 6.283); g.fill(); g.shadowBlur = 0; }
  }
  net(txt) { const n = $("h-net"); n.textContent = txt; n.classList.toggle("x-hide", !txt); n.classList.toggle("bad", !!txt); }
  fps(n) { $("h-fps").textContent = n + " FPS"; }
  feed(list) { $("h-feed").innerHTML = list.slice(0, 3).map((f) => `<div class="${f.mine ? "mine" : ""}">${esc(t("kill_feed", { x: f.a, y: f.b }))}</div>`).join(""); clearTimeout(this.ft); this.ft = setTimeout(() => ($("h-feed").innerHTML = ""), 4000); }
  banner(txt, ms) { const b = $("h-banner"); b.textContent = txt; b.classList.add("on"); clearTimeout(this.bt); this.bt = setTimeout(() => b.classList.remove("on"), ms || 1400); }
  popup(txt, kind, pos) { const p = document.createElement("div"); p.className = "pop " + (kind || ""); p.textContent = txt; if (pos && pos[2]) { p.style.left = pos[0] + "px"; p.style.top = pos[1] + "px"; } const box = $("h-pop"); box.appendChild(p); while (box.children.length > 6) box.firstChild.remove(); setTimeout(() => p.remove(), 1000); }
  flash() { const v = $("vignette"); v.classList.remove("flash"); void v.offsetWidth; v.classList.add("flash"); }
}

export class UI {
  constructor(app) {
    this.app = app; this.cur = null; this.cTab = "skins"; this.pTab = "missions"; this.gTab = "graphics"; this.flagQ = ""; this.selMode = app.store.p.last.mode || "classic";
    this.bind();
  }
  get S() { return this.app.store; }
  get p() { return this.app.store.p; }
  click(el, fn, snd = "click") { el.addEventListener("click", (e) => { this.app.audio.unlock(); this.app.audio.play(snd); haptic.tap(6); fn(e); }); }
  show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.id === "s-" + id)); this.cur = id;
    if (id === "lobby") this.renderLobby(); if (id === "custom") this.renderCustom(); if (id === "progress") this.renderProgress(); if (id === "settings") this.renderSettings();
    if (id === "custom") this.startPreview(); else this.stopPreview();
  }
  hideScreens() { document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on")); this.cur = null; this.stopPreview(); }
  goLobby() { ["m-pause", "m-results"].forEach((m) => $(m).classList.add("x-hide")); this.app.hud.hide(); this.app.game.startAttract(this.p.last.world || 0); this.app.audio.music(true, this.p.last.world || 0); this.show("lobby"); }
  toast(msg, kind = "", ms = 2800) {
    const el = document.createElement("div"); el.className = "toast " + kind; el.textContent = msg; const box = $("toasts"); box.appendChild(el); while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, ms);
  }
  confirm(text) { return new Promise((res) => { $("cf-text").textContent = text; const m = $("m-confirm"); m.classList.remove("x-hide"); const done = (v) => { m.classList.add("x-hide"); $("cf-yes").onclick = $("cf-no").onclick = null; res(v); }; $("cf-yes").onclick = () => done(true); $("cf-no").onclick = () => done(false); }); }

  bind() {
    const A = this.app;
    // auth
    $("a-tabs").querySelectorAll("button").forEach((b) => this.click(b, () => { $("a-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); $("f-in").classList.toggle("x-hide", b.dataset.v !== "in"); $("f-up").classList.toggle("x-hide", b.dataset.v !== "up"); }, "tab"));
    this.click($("a-guest"), () => { this.S.signOut(); this.afterLogin(); });
    const doIn = async () => { const b = $("in-go"); if (b.disabled) return; b.disabled = true; $("in-err").textContent = "…"; const r = await this.S.signIn($("in-u").value, $("in-p").value, $("in-rem").checked); b.disabled = false;
      if (r.err) { $("in-err").textContent = t(r.err, { n: r.n }); A.audio.play("error"); return; } $("in-err").textContent = ""; $("in-p").value = ""; this.afterLogin(); if (r.migrated) this.toast(t("migrated"), "gold", 4500); };
    const doUp = async () => { const b = $("up-go"); if (b.disabled) return; b.disabled = true; $("up-err").textContent = "…"; const r = await this.S.signUp($("up-u").value, $("up-e").value, $("up-p").value, $("up-p2").value); b.disabled = false;
      if (r.err) { $("up-err").textContent = t(r.err); A.audio.play("error"); return; } $("up-err").textContent = ""; $("up-p").value = $("up-p2").value = ""; this.afterLogin(); };
    this.click($("in-go"), doIn); this.click($("up-go"), doUp);
    $("f-in").addEventListener("submit", (e) => { e.preventDefault(); doIn(); }); $("f-up").addEventListener("submit", (e) => { e.preventDefault(); doUp(); });
    // lobby
    this.click($("l-custom"), () => this.show("custom")); this.click($("l-progress"), () => this.show("progress")); this.click($("l-settings"), () => this.show("settings"));
    this.click($("l-prof"), () => { this.gTab = "account"; this.show("settings"); });
    this.click($("l-play"), () => this.play());
    $("l-code").addEventListener("input", (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24); this.p.last.room = e.target.value; this.S.save(); });
    document.querySelectorAll("[data-back]").forEach((b) => this.click(b, () => this.back(), "back"));
    // tabs
    const tabs = (id, key, fn) => $(id).querySelectorAll("button").forEach((b) => this.click(b, () => { this[key] = b.dataset.v; $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); fn.call(this); }, "tab"));
    tabs("c-tabs", "cTab", this.renderCustom); tabs("p-tabs", "pTab", this.renderProgress); tabs("g-tabs", "gTab", this.renderSettings);
    // pause / results
    this.click($("h-pause"), () => A.game.pause(true));
    this.click($("pz-resume"), () => A.game.pause(false)); this.click($("pz-restart"), () => { this.hidePause(); A.game.restart(); });
    this.click($("pz-settings"), () => { this.fromPause = true; $("m-pause").classList.add("x-hide"); this.gTab = "graphics"; this.show("settings"); });
    this.click($("pz-quit"), () => { this.hidePause(); if (A.game.mode === "zen" && !A.game.ended) { A.game.paused = false; A.game.finish("zen"); return; } A.game.stopMatch(); this.goLobby(); });
    this.click($("r-again"), () => { $("m-results").classList.add("x-hide"); A.game.again(); });
    this.click($("r-lobby"), () => { A.game.stopMatch(); this.goLobby(); });
    // tutorial
    this.click($("t-next"), () => this.tutNext()); this.click($("t-skip"), () => this.tutDone());
    document.addEventListener("visibilitychange", () => { if (document.hidden) { A.game.pause(true); A.store.flush(); } });
  }
  back() {
    if (this.fromPause && this.cur === "settings") { this.fromPause = false; this.hideScreens(); $("m-pause").classList.remove("x-hide"); return; }
    this.show("lobby");
  }
  afterLogin() { this.selMode = this.p.last.mode || "classic"; this.app.applyAll(); const bonus = this.S.claimDailyBonus(); this.goLobby(); this.toast(t("welcome", { n: this.p.name }), "good"); if (bonus) setTimeout(() => this.toast("◆ " + t("dailyBonus", { n: bonus }), "gold"), 900); }
  showAuth(tab = "in") {
    this.show("auth"); $("a-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === tab)); $("f-in").classList.toggle("x-hide", tab !== "in"); $("f-up").classList.toggle("x-hide", tab !== "up"); $("in-u").value = this.S.remember; $("in-rem").checked = !!this.S.remember;
    $("auth-langs").innerHTML = LANGS.map(([c, n]) => `<button data-l="${c}" class="${c === LANG ? "on" : ""}">${n}</button>`).join("");
    $("auth-langs").querySelectorAll("button").forEach((b) => this.click(b, () => { this.S.settings.lang = b.dataset.l; this.S.save(); this.app.applyLang(); this.showAuth($("f-up").classList.contains("x-hide") ? "in" : "up"); }, "tab"));
  }

  // ---------- lobby ----------
  renderLobby() {
    const p = this.p, S = this.S, lv = lvInfo(p.xp);
    $("l-name").textContent = p.name; $("l-av").textContent = (p.name || "S").slice(0, 1).toUpperCase(); $("l-av").style.background = `linear-gradient(135deg, ${primaryColor(this.app.game.mySkin())}, #1a1306)`;
    $("l-lv").textContent = lv.n; $("l-xp").style.width = Math.round((lv.x / lv.need) * 100) + "%"; $("l-coins").textContent = fmtNum(p.coins);
    $("l-modes").innerHTML = MODE_LIST.map(([m, ic]) => `<button class="mode ${m === this.selMode ? "on" : ""}" data-m="${m}" role="tab"><span class="mi">${IC[m]}</span><span><b>${t("m_" + m)}</b><small>${esc(t("m_" + m + "_d")).slice(0, 34)}…</small></span></button>`).join("");
    $("l-modes").querySelectorAll(".mode").forEach((b) => this.click(b, () => { this.selMode = b.dataset.m; p.last.mode = this.selMode; S.save(); this.renderLobby(); }, "tab"));
    $("l-mtitle").textContent = t("m_" + this.selMode); $("l-mdesc").textContent = t("m_" + this.selMode + "_d");
    // worlds
    const wb = $("l-worlds"); wb.innerHTML = "";
    WORLDS.forEach((w, i) => {
      const b = document.createElement("button"); const ok = S.unlocked("world", i); b.className = `world ${i === p.last.world ? "on" : ""} ${ok ? "" : "lock"}`; b.title = ok ? t("w_" + w.id) : t("unlockAt", { n: w.lv });
      b.appendChild(this.worldThumb(i)); const sp = document.createElement("span"); sp.textContent = ok ? t("w_" + w.id) : t("lockedLv", { n: w.lv }); b.appendChild(sp); if (!ok) { const lk = document.createElement("i"); lk.className = "lk"; lk.innerHTML = IC.lock; b.appendChild(lk); }
      this.click(b, () => { if (!ok) { this.toast("🔒 " + t("unlockAt", { n: w.lv })); this.app.audio.play("error"); return; } p.last.world = i; S.save(); this.app.game.startAttract(i); this.app.audio.music(true, i); this.renderLobby(); }, "tab");
      wb.appendChild(b);
    });
    // difficulty (not for online/zen)
    const dd = $("l-diff"); dd.classList.toggle("x-hide", this.selMode === "online" || this.selMode === "zen");
    dd.innerHTML = [0, 1, 2, 3].map((i) => `<button data-v="${i}" class="${p.last.diff === i ? "on" : ""} ${S.unlocked("diff", i) ? "" : "lock"}">${t("d" + i)}${S.unlocked("diff", i) ? "" : " " + IC.lock}</button>`).join("");
    dd.querySelectorAll("button").forEach((b) => this.click(b, () => { const i = +b.dataset.v; if (!S.unlocked("diff", i)) { this.toast("🔒 " + t("unlockAt", { n: 10 })); return; } p.last.diff = i; S.save(); this.renderLobby(); }, "tab"));
    $("l-room").classList.toggle("x-hide", this.selMode !== "online"); $("l-code").value = p.last.room || "";
    $("l-onote").textContent = this.selMode === "online" ? t("online_rooms") : (S.isGuest ? t("guestNote") : "");
    // daily
    const ms = S.daily(); let anyClaim = false;
    $("l-daily").innerHTML = ms.map((m, i) => { const done = m.p >= m.g; if (done && !m.c) anyClaim = true;
      return `<div class="mis ${done ? "done" : ""}"><span>${t("mi_" + m.id, { n: m.g })}</span>${done ? (m.c ? `<span class="rw">✓ ${t("claimed")}</span>` : `<button class="btn gold claim" data-i2="${i}">${t("claim")} ◆${m.r}</button>`) : `<span class="rw">◆${m.r}</span>`}<div class="pb"><i style="width:${Math.round((m.p / m.g) * 100)}%"></i></div></div>`; }).join("");
    $("l-daily").querySelectorAll("[data-i2]").forEach((b) => this.click(b, () => this.claim(+b.dataset.i2)));
    const now = new Date(), mid = new Date(now); mid.setHours(24, 0, 0, 0); const hl = Math.ceil((mid - now) / 3600000); $("l-dreset").textContent = `⟳ ${hl}h`;
    $("l-pdot").classList.toggle("x-hide", !anyClaim);
    document.querySelectorAll(".coinsv").forEach((e) => (e.textContent = fmtNum(p.coins)));
  }
  claim(i) { const r = this.S.claimMission(i); if (!r) return; this.app.audio.play("ach"); this.toast(`◆ +${r.coins} · +${r.coins} XP`, "gold"); if (r.lv.up) { this.toast(t("levelUp", { n: r.lv.level }), "gold"); this.app.audio.play("level"); } this.checkAch(); if (this.cur === "lobby") this.renderLobby(); else this.renderProgress(); }
  checkAch() { for (const a of this.S.checkAch()) { this.toast(`${a.ic} ${t("achUnlocked", { n: t(a.id) })} · ◆${a.r}`, "gold", 3500); this.app.audio.play("ach"); } }
  worldThumb(i) {
    this._thumbs = this._thumbs || {}; if (this._thumbs[i]) return this._thumbs[i].cloneNode ? this.cloneCanvas(this._thumbs[i]) : this._thumbs[i];
    const w = WORLDS[i], c = document.createElement("canvas"); c.width = 184; c.height = 116; const g = c.getContext("2d");
    const tex = paintGround(w, 128); g.fillStyle = g.createPattern(tex, "repeat"); g.fillRect(0, 0, 184, 116);
    const gr = g.createLinearGradient(0, 0, 0, 116); gr.addColorStop(0, w.fog); gr.addColorStop(0.55, w.fog + "00"); g.fillStyle = gr; g.fillRect(0, 0, 184, 116);
    g.strokeStyle = w.rim; g.lineWidth = 3; g.shadowColor = w.rim; g.shadowBlur = 10; g.beginPath(); g.ellipse(92, 120, 120, 40, 0, Math.PI, 0); g.stroke();
    this._thumbs[i] = c; return this.cloneCanvas(c);
  }
  cloneCanvas(c) { const n = document.createElement("canvas"); n.width = c.width; n.height = c.height; n.getContext("2d").drawImage(c, 0, 0); return n; }
  play() {
    const p = this.p, mode = this.selMode; p.last.mode = mode; this.S.save();
    if (!this.S.unlocked("world", p.last.world)) p.last.world = 0;
    const cfg = { mode, world: p.last.world, diff: mode === "zen" ? 0 : p.last.diff, room: mode === "online" ? p.last.room || "" : "" };
    if (!p.tut) { this.tutStart(cfg); return; }
    this.launch(cfg);
  }
  launch(cfg) { this.hideScreens(); this.app.game.start(cfg); }

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
      const hx = 240 + Math.cos(a) * 50, hy = 75 + Math.sin(a) * 30; const pts = []; for (let k = 0; k < 16; k++) pts.push([240 + Math.cos(a - k * 0.12) * 50, 75 + Math.sin(a - k * 0.12) * 30]); snake(pts, "#2bd67b", 8); }
    if (i === 1) { const x = 60 + ((tm * 60) % 260); snake(path(x, 75, 0, 3, 14, 7), "#2bd67b", 8); for (let k = 0; k < 6; k++) { const fx = 110 + k * 40; if (fx > x) { g.fillStyle = ["#ff3b5c", "#ffe94d", "#29d8ff"][k % 3]; g.shadowColor = g.fillStyle; g.shadowBlur = 12; g.beginPath(); g.arc(fx, 75, 5, 0, 6.283); g.fill(); g.shadowBlur = 0; } } }
    if (i === 2) { const ph = (tm % 2) / 2, sp = ph > 0.5 ? 12 : 6, x = 40 + ((tm * (ph > 0.5 ? 140 : 60)) % 280); snake(path(x, 75, 0, 2, 14, sp * 0.9), "#f5c451", 8); g.fillStyle = ph > 0.5 ? "#ffe7a3" : "rgba(255,255,255,.35)"; g.beginPath(); g.arc(320, 120, 18, 0, 6.283); g.fill(); g.fillStyle = "#1c1405"; g.font = "bold 14px sans-serif"; g.textAlign = "center"; g.fillText("⚡", 320, 125); }
    if (i === 3) { const u = (tm % 3) / 3; const ex = 60 + u * 200; const pts = []; for (let k = 0; k < 18; k++) pts.push([200 + Math.sin(k * 0.1) * 4, 20 + k * 7]); snake(pts, "#2bd67b", 8); snake(path(Math.min(ex, 188), 75, 0, 0, 12, 7), "#ff4d61", 8); if (ex >= 188) { g.fillStyle = "#ffe7a3"; g.font = "bold 22px sans-serif"; g.textAlign = "center"; g.fillText("💥", 186, 82); } }
  }

  // ---------- customize ----------
  renderCustom() {
    const p = this.p, S = this.S, el = $("c-content"); document.querySelectorAll(".coinsv").forEach((e) => (e.textContent = fmtNum(p.coins)));
    const tab = this.cTab; let h = "";
    if (tab === "skins") {
      h = `<div class="grid">` + SKINS.map((s, i) => { const ok = S.unlocked("skin", i), on = p.skin.k === "skin" && p.skin.i === i;
        return `<button class="item ${on ? "on" : ""} ${ok ? "" : "lock"}" data-k="skin" data-v="${i}"><div class="sw" style="background:${swatchCss({ k: "skin", i })}"></div><b>${esc(cap(s.id))}</b><small>${on ? t("equipped") : ok ? t("equip") : "🔒 " + t("lockedLv", { n: s.lv })}</small></button>`; }).join("") + `</div>`;
    } else if (tab === "flags") {
      const q = this.flagQ.toLowerCase(); const list = FLAGS.filter((f) => !q || flagName(f, LANG).toLowerCase().includes(q) || f.en.toLowerCase().includes(q) || f.c.toLowerCase() === q);
      list.sort((a, b) => (p.flags.includes(b.i) - p.flags.includes(a.i)));
      h = `<div class="searchbar"><input type="search" id="c-fq" data-ip="search" placeholder="${t("search")}" value="${esc(this.flagQ)}" /><span class="fine">${p.flags.length}/${FLAGS.length}</span></div><div class="grid">` +
        list.map((f) => { const own = p.flags.includes(f.i), on = p.skin.k === "flag" && p.skin.i === f.i;
          return `<button class="item ${on ? "on" : ""}" data-k="flag" data-v="${f.i}"><div class="sw" style="background:${swatchCss({ k: "flag", i: f.i })}"></div><b>${flagEmoji(f.c)} ${esc(flagName(f, LANG))}</b><small>${on ? t("equipped") : own ? t("equip") : "◆ " + FLAG_PRICE}</small></button>`; }).join("") + `</div>`;
    } else if (tab === "editor") {
      const c = p.custom; h = `<h4 class="sub">${t("pattern")}</h4><div class="pats">` + PATTERNS.map((pt, i) => `<button class="item ${c.p === i ? "on" : ""}" data-k="pat" data-v="${i}"><div class="sw" style="background:${swatchCss({ k: "custom", p: i, c: c.c })}"></div><b>${cap(pt)}</b></button>`).join("") + `</div>
        <div class="ed-row"><label>${t("color1")}<input type="color" data-ci="0" value="${c.c[0]}"></label><label>${t("color2")}<input type="color" data-ci="1" value="${c.c[1]}"></label><label>${t("color3")}<input type="color" data-ci="2" value="${c.c[2]}"></label>
        <button class="btn gold" id="c-useed">${p.skin.k === "custom" ? "✓ " + t("equipped") : t("equip")}</button></div>`;
    } else if (tab === "eyes") {
      h = `<div class="grid">` + EYES.map((e, i) => { const ok = S.unlocked("eye", i), on = p.eye === i; return `<button class="item ${on ? "on" : ""} ${ok ? "" : "lock"}" data-k="eye" data-v="${i}"><div class="emo">${eyeIcon(e)}</div><b>${cap(e.id)}</b><small>${on ? t("equipped") : ok ? t("equip") : "🔒 " + t("lockedLv", { n: e.lv })}</small></button>`; }).join("") + `</div>`;
    } else if (tab === "trails") {
      h = `<div class="grid">` + TRAILS.map((tr, i) => { const ok = S.unlocked("trail", i), on = p.trail === i; return `<button class="item ${on ? "on" : ""} ${ok ? "" : "lock"}" data-k="trail" data-v="${i}"><div class="sw" style="background:${tr.c ? `radial-gradient(circle at 30% 50%, ${tr.c[0]} 0 3px, transparent 4px), radial-gradient(circle at 60% 40%, ${tr.c[1]} 0 2px, transparent 3px), radial-gradient(circle at 80% 60%, ${tr.c[0]} 0 2px, transparent 3px), #10131b` : "#10131b"}"></div><b>${cap(tr.id)}</b><small>${on ? t("equipped") : ok ? t("equip") : "🔒 " + t("lockedLv", { n: tr.lv })}</small></button>`; }).join("") + `</div>`;
    } else if (tab === "name") {
      h = `<h4 class="sub">${t("displayName")}</h4><input type="text" id="c-name" maxlength="16" value="${esc(p.name)}" /><h4 class="sub">${t("nameColor")}</h4><div class="namecols">` + NAME_COLORS.map((c, i) => `<button data-k="nc" data-v="${i}" class="${p.nc === i ? "on" : ""}" style="background:${c}" aria-label="${c}"></button>`).join("") + `</div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll("[data-k]").forEach((b) => this.click(b, () => this.pick(b.dataset.k, +b.dataset.v), "tab"));
    const fq = $("c-fq"); if (fq) fq.addEventListener("input", (e) => { this.flagQ = e.target.value; const pos = e.target.selectionStart; this.renderCustom(); const n = $("c-fq"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} });
    el.querySelectorAll("[data-ci]").forEach((inp) => inp.addEventListener("input", (e) => { p.custom.c[+e.target.dataset.ci] = e.target.value; p.skin = { k: "custom", i: 0 }; S.save(); el.querySelectorAll(".pats .sw").forEach((sw, i) => (sw.style.background = swatchCss({ k: "custom", p: i, c: p.custom.c }))); this.syncPreview(); }));
    const ue = $("c-useed"); if (ue) this.click(ue, () => { p.skin = { k: "custom", i: 0 }; S.save(); this.renderCustom(); });
    const nm = $("c-name"); if (nm) nm.addEventListener("change", (e) => { const v = e.target.value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16); p.name = v || p.name; e.target.value = p.name; S.save(); this.syncPreview(); });
    this.renderPresets(); this.syncPreview();
  }
  pick(k, v) {
    const p = this.p, S = this.S;
    if (k === "skin") { if (!S.unlocked("skin", v)) { this.toast("🔒 " + t("unlockAt", { n: SKINS[v].lv })); return; } p.skin = { k: "skin", i: v }; }
    else if (k === "flag") { if (!p.flags.includes(v)) { const r = S.buyFlag(v); if (r === "noCoins") { this.toast(t("noCoins"), "warn"); this.app.audio.play("error"); return; } this.toast(t("bought") + " " + flagEmoji(FLAGS[v].c), "good"); this.app.audio.play("ach"); this.checkAch(); } p.skin = { k: "flag", i: v }; }
    else if (k === "pat") { p.custom.p = v; p.skin = { k: "custom", i: 0 }; }
    else if (k === "eye") { if (!S.unlocked("eye", v)) { this.toast("🔒 " + t("unlockAt", { n: EYES[v].lv })); return; } p.eye = v; }
    else if (k === "trail") { if (!S.unlocked("trail", v)) { this.toast("🔒 " + t("unlockAt", { n: TRAILS[v].lv })); return; } p.trail = v; }
    else if (k === "nc") p.nc = v;
    S.save(); this.renderCustom();
  }
  renderPresets() {
    const p = this.p, box = $("c-presets");
    box.innerHTML = p.presets.map((pr, i) => pr ? `<div class="pre full"><div class="sw" style="background:${swatchCss(pr.skin.k === "custom" ? { k: "custom", p: pr.custom.p, c: pr.custom.c } : pr.skin)}"></div><div class="pre-act"><button data-pl="${i}">${t("load")}</button><button data-ps="${i}">${t("save")}</button></div></div>`
      : `<button class="pre" data-ps="${i}">+ ${t("save")}</button>`).join("");
    box.querySelectorAll("[data-ps]").forEach((b) => this.click(b, () => { p.presets[+b.dataset.ps] = { skin: { ...p.skin }, custom: { p: p.custom.p, c: [...p.custom.c] }, eye: p.eye, trail: p.trail, nc: p.nc }; this.S.save(); this.toast("✓ " + t("save"), "good"); this.checkAch(); this.renderPresets(); }));
    box.querySelectorAll("[data-pl]").forEach((b) => this.click(b, () => { const pr = p.presets[+b.dataset.pl]; if (!pr) return; Object.assign(p, { skin: { ...pr.skin }, custom: { p: pr.custom.p, c: [...pr.custom.c] }, eye: pr.eye, trail: pr.trail, nc: pr.nc }); this.S.save(); this.renderCustom(); }));
  }
  syncPreview() { const d = this.app.game.mySkin(); this.pv = { fn: compileSkin(d), eye: EYES[d.e] || EYES[0], trail: TRAILS[d.t], nc: NAME_COLORS[d.n] }; $("c-pvname").textContent = this.p.name; $("c-pvname").style.color = this.pv.nc; }
  startPreview() {
    if (this.pvRaf) return; const c = $("c-prev"), g = c.getContext("2d"), col = [0, 0, 0]; const parts = [];
    const draw = () => {
      this.pvRaf = requestAnimationFrame(draw); if (!this.pv) return; const W = c.width, H = c.height, tm = performance.now() / 1000; g.clearRect(0, 0, W, H);
      const n = 30, R = 21, pts = [];
      for (let k = 0; k < n; k++) { const u = k / n; pts.push([W * 0.84 - u * W * 0.7, H * 0.52 + Math.sin(tm * 2.6 - k * 0.36) * 44 * Math.min(1, k / 5 + 0.3)]); }
      g.fillStyle = "rgba(0,0,0,0.35)"; for (let k = n - 1; k >= 0; k--) { g.beginPath(); g.ellipse(pts[k][0] + 6, pts[k][1] + 10, R, R * 0.55, 0, 0, 6.283); g.fill(); }
      const T = this.pv.trail; if (T && T.c && Math.random() < 0.6) parts.push({ x: pts[n - 1][0], y: pts[n - 1][1], vx: -20 - Math.random() * 30, vy: (Math.random() - 0.5) * 30, l: 1, c: T.c[(Math.random() * 2) | 0] });
      for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i]; q.l -= 0.02; q.x += q.vx / 60; q.y += q.vy / 60; if (q.l <= 0) { parts.splice(i, 1); continue; } g.globalAlpha = q.l; g.fillStyle = q.c; g.beginPath(); g.arc(q.x, q.y, 3, 0, 6.283); g.fill(); } g.globalAlpha = 1;
      for (let k = n - 1; k >= 0; k--) {
        const u = k / (n - 1), rr = R * (u > 0.72 ? 1 - ((u - 0.72) / 0.28) * 0.6 : 1) * (k === 0 ? 1.12 : 1); this.pv.fn(k, n, tm, col);
        const cc = `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`;
        const gr = g.createRadialGradient(pts[k][0] - rr * 0.35, pts[k][1] - rr * 0.4, rr * 0.1, pts[k][0], pts[k][1], rr); gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(0.25, cc); gr.addColorStop(1, shade(col, 0.55));
        g.fillStyle = gr; g.beginPath(); g.arc(pts[k][0], pts[k][1], rr, 0, 6.283); g.fill();
      }
      const E = this.pv.eye, a = Math.atan2(pts[0][1] - pts[1][1], pts[0][0] - pts[1][0]), er = R * 0.42 * E.s;
      for (let q = 0; q < E.n; q++) { const side = E.n === 1 ? 0 : (q ? 1 : -1) * R * 0.5, ex = pts[0][0] + Math.cos(a) * R * 0.45 - Math.sin(a) * side, ey = pts[0][1] + Math.sin(a) * R * 0.45 + Math.cos(a) * side;
        g.fillStyle = E.ec; g.beginPath(); g.arc(ex, ey, er, 0, 6.283); g.fill(); g.fillStyle = E.pc; if (E.glow) { g.shadowColor = E.pc; g.shadowBlur = 10; } g.beginPath(); g.arc(ex + Math.cos(a) * er * 0.35, ey + Math.sin(a) * er * 0.35, er * E.p, 0, 6.283); g.fill(); g.shadowBlur = 0;
        if (E.lid) { this.pv.fn(0, n, tm, col); g.fillStyle = `rgb(${(col[0] * 255) | 0},${(col[1] * 255) | 0},${(col[2] * 255) | 0})`; g.beginPath(); g.arc(ex, ey, er * 1.05, a - Math.PI, a, false); g.fill(); } }
    };
    draw();
  }
  stopPreview() { if (this.pvRaf) cancelAnimationFrame(this.pvRaf); this.pvRaf = 0; }

  // ---------- progress ----------
  renderProgress() {
    const p = this.p, S = this.S, el = $("p-content"), tab = this.pTab; document.querySelectorAll(".coinsv").forEach((e) => (e.textContent = fmtNum(p.coins))); let h = "";
    if (tab === "missions") {
      const lv = lvInfo(p.xp); h = `<div class="stat" style="margin-bottom:10px"><small>${t("level")}</small><b>${lv.n} <span class="fine">${fmtNum(lv.x)} / ${fmtNum(lv.need)} XP</span></b><div class="xpbar big" style="margin-top:8px"><i style="width:${Math.round((lv.x / lv.need) * 100)}%"></i></div></div><h4 class="sub">${t("daily")}</h4>`;
      h += S.daily().map((m, i) => { const done = m.p >= m.g; return `<div class="mis ${done ? "done" : ""}" style="margin-bottom:6px"><span>${t("mi_" + m.id, { n: m.g })} · ${fmtNum(m.p)}/${fmtNum(m.g)}</span>${done ? (m.c ? `<span class="rw">✓ ${t("claimed")}</span>` : `<button class="btn gold claim" data-i2="${i}">${t("claim")} ◆${m.r}</button>`) : `<span class="rw">◆${m.r} · ${m.r} XP</span>`}<div class="pb"><i style="width:${Math.round((m.p / m.g) * 100)}%"></i></div></div>`; }).join("");
    } else if (tab === "ach") {
      const got = Object.keys(p.ach).length; h = `<p class="fine" style="margin-bottom:8px">${got}/${Store.ACH.length}</p><div class="achs">` + Store.ACH.map(([id, ic, , r]) => `<div class="ach ${p.ach[id] ? "got" : ""}"><div class="ic">${ic}</div><div><b>${t(id)}</b><small>${esc(achDesc(id))}</small></div><span class="rw">${p.ach[id] ? "✓" : "◆" + r}</span></div>`).join("") + `</div>`;
    } else if (tab === "stats") {
      const s = p.stats, kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills, dur = (x) => (x >= 3600 ? (x / 3600).toFixed(1) + " h" : x >= 60 ? t("min", { n: Math.round(x / 60) }) : t("sec", { n: x }));
      const rows = [["st_games", fmtNum(s.games)], ["st_kills", fmtNum(s.kills)], ["st_deaths", fmtNum(s.deaths)], ["st_kd", kd], ["st_food", fmtNum(s.food)], ["st_best", fmtNum(s.best)], ["st_top", fmtNum(s.top)], ["st_life", dur(s.life)], ["st_time", dur(s.time)], ["st_boost", dur(s.boost)], ["st_online", fmtNum(s.online)]];
      h = `<div class="stats">` + rows.map(([k, v]) => `<div class="stat"><small>${t(k)}</small><b>${v}</b></div>`).join("") + `</div>`;
    } else if (tab === "bests") {
      const modes = ["classic", "time", "survival", "online", "zen"]; this.bMode = this.bMode || "classic";
      h = `<div class="seg small" id="b-modes" style="margin-bottom:10px">` + modes.map((m) => `<button data-v="${m}" class="${m === this.bMode ? "on" : ""}">${t("m_" + m)}</button>`).join("") + `</div>`;
      const L = p.bests[this.bMode] || [];
      h += L.length ? `<table class="lb"><tr><th>#</th><th>${t("bests")}</th><th>${t("r_mass")}</th><th>${t("r_kills")}</th><th>${t("world")}</th><th></th></tr>` + L.map((e, i) => `<tr><td>${i + 1}</td><td>${fmtNum(e.s)}</td><td>${fmtNum(e.m || 0)}</td><td>${e.k}</td><td>${t("w_" + (WORLDS[e.w] || WORLDS[0]).id)}</td><td class="fine">${new Date(e.d).toLocaleDateString(LANG)}</td></tr>`).join("") + `</table>` : `<p class="fine">${t("noBests")}</p>`;
    }
    el.innerHTML = h;
    el.querySelectorAll("[data-i2]").forEach((b) => this.click(b, () => this.claim(+b.dataset.i2)));
    const bm = $("b-modes"); if (bm) bm.querySelectorAll("button").forEach((b) => this.click(b, () => { this.bMode = b.dataset.v; this.renderProgress(); }, "tab"));
  }

  // ---------- settings ----------
  renderSettings() {
    const s = this.S.settings, el = $("g-content"), tab = this.gTab; let rows = [];
    $("g-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === tab));
    const seg = (k, opts, label, sub) => ({ k, type: "seg", opts, label, sub }), tog = (k, label, sub) => ({ k, type: "tog", label, sub }), rng = (k, label, min, max, step, fmt) => ({ k, type: "rng", label, min, max, step, fmt });
    if (tab === "graphics") rows = [seg("quality", [["auto", t("q_auto")], ["low", t("q_low")], ["medium", t("q_medium")], ["high", t("q_high")], ["ultra", t("q_ultra")]], "quality", this.app.renderer && s.quality === "auto" ? "→ " + t("q_" + this.app.renderer.qName) : ""),
      seg("renderer", [["3d", t("r3d")], ["2d", t("r2d")]], "renderer"), seg("fpsCap", [[30, "30"], [60, "60"], [0, "∞"]], "fpsCap"), tog("showFps", "showFps"), tog("postFx", "postFx"), tog("juice", "juice"), tog("minimap", "minimap")];
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
      if (r.type === "rng") h += `<div class="set-row"><span>${t(r.label)}</span><span><input type="range" data-r="${r.k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${s[r.k]}" style="--p:${((s[r.k] - r.min) / (r.max - r.min)) * 100}%" aria-label="${t(r.label)}"><span class="rv" data-rv="${r.k}">${r.fmt(s[r.k])}</span></span></div>`;
      if (r.type === "btn") h += `<div class="set-row"><span>${t(r.label)}</span><button class="btn" data-act="${r.act}">▶</button></div>`;
      if (r.type === "lang") h += LANGS.map(([c, n]) => `<div class="set-row"><span>${n}</span><button class="toggle ${s.lang === c ? "on" : ""}" data-lang="${c}" role="radio" aria-checked="${s.lang === c}" aria-label="${n}"></button></div>`).join("");
      if (r.type === "acct") { const g = this.S.isGuest, a = !g && this.S.acc[this.S.cur];
        h += `<div class="set-row"><span>${esc(this.p.name)}<small>${g ? t("guestNote") : esc(a.email || "")}</small></span>${g ? `<button class="btn primary" data-act="signup">${t("signUp")}</button>` : `<button class="btn" data-act="signout">${t("signOut")}</button>`}</div>
          <div class="set-row"><span>${t("resetProg")}</span><button class="btn danger" data-act="reset">${t("resetProg")}</button></div>
          <div class="set-row"><span>${t("privacy")}<small>${t("localNote")}</small></span><a class="btn" href="../privacy.html" target="_blank" rel="noopener">↗</a></div>
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
  showPause(online) { $("m-pause").classList.remove("x-hide"); $("pz-online").classList.toggle("x-hide", !online); $("pz-online").textContent = online ? t("m_online_d") : ""; $("pz-restart").classList.toggle("x-hide", online); }
  hidePause() { $("m-pause").classList.add("x-hide"); }
  showResults(r) {
    const m = $("m-results"); m.classList.remove("x-hide"); this.app.hud.hide();
    $("r-title").textContent = r.title; $("r-sub").textContent = r.sub || ""; $("r-best").classList.toggle("x-hide", !r.newBest);
    const sc = $("r-score"), target = r.score, t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / 700); sc.textContent = fmtNum(k >= 1 ? target : target * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); }; step();
    const cells = [["r_mass", fmtNum(r.mass)], ["r_kills", r.kills], ["r_rank", r.rank === "—" ? "—" : "#" + r.rank], ["r_time", fmtTime(r.time)]]; if (r.mode === "survival") cells[2] = ["wave", r.wave];
    $("r-grid").innerHTML = cells.map(([a, b]) => `<div><small>${a === "wave" ? t("wave", { n: "" }).trim() : t(a)}</small><b>${b}</b></div>`).join("");
    const lv = lvInfo(this.p.xp); $("r-lv").textContent = lv.n; $("r-xpbar").style.width = "0"; setTimeout(() => ($("r-xpbar").style.width = Math.round((lv.x / lv.need) * 100) + "%"), 60);
    $("r-xp").textContent = t("xpGain", { n: r.xp }); $("r-coins").textContent = "◆ " + t("coinGain", { n: r.coins });
    const ex = []; if (r.lv.up) ex.push("⭐ " + t("levelUp", { n: r.lv.level })); for (const ms of r.missions) ex.push("✓ " + t("missionDone", { n: t("mi_" + ms.id, { n: ms.g }) })); for (const a of r.ach) ex.push(a.ic + " " + t(a.id));
    $("r-extra").innerHTML = ex.map((x) => `<span>${esc(x)}</span>`).join("");
    for (const a of r.ach) this.toast(`${a.ic} ${t("achUnlocked", { n: t(a.id) })} · ◆${a.r}`, "gold", 3500);
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const shade = (c, k) => `rgb(${(c[0] * 255 * k) | 0},${(c[1] * 255 * k) | 0},${(c[2] * 255 * k) | 0})`;
function eyeIcon(e) { return { classic: "👀", cute: "🥺", fierce: "😠", cyber: "🤖", sleepy: "😪", cyclops: "👁️", demon: "😈" }[e.id] || "👀"; }
