// admin2: owner admin (ID 1 only; every action is checked again on the server and written to the audit log) + the player side of
// the owner config: announcement banner, maintenance / switched-off modes, price overrides, promo codes, owner wallet edits.
import { t, fmtNum, addStrings, LANG } from "./i18n.js?v=admin2";
import { SKINS, FLAGS, GTRAILS } from "./skins.js?v=admin2";
import { AVATARS, FRAMES, TITLES, BANNERS } from "./profile.js?v=admin2";
import { pidHtml } from "./pid.js?v=admin2";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const CF = { cfg: { ann: null, mnt: null, moff: [], eoff: [], px: {} }, ui: null, own: false };

// ---------- price overrides: the same catalogue edit the server makes (so every price shown matches what the server charges) ----------
const PX0 = new Map();
function applyPx(px) { px = px || {};
  for (const S of SKINS) { if (!S.src || !/^coins:/.test(S.src)) continue; if (!PX0.has(S.id)) PX0.set(S.id, +S.src.split(":")[1]); const v = px[S.id] | 0; S.src = "coins:" + (v > 0 ? v : PX0.get(S.id)); }
  for (const G of GTRAILS) { if (!G.price) continue; const k = "gt:" + G.id; if (!PX0.has(k)) PX0.set(k, G.price | 0); const v = px[k] | 0; G.price = v > 0 ? v : PX0.get(k); } }

export function setCfg(c, own) { if (!c) return; CF.cfg = { ann: c.ann || null, mnt: c.mnt || null, moff: c.moff || [], eoff: c.eoff || [], px: c.px || {} }; if (own !== undefined) CF.own = !!own; applyPx(CF.cfg.px);
  const ui = CF.ui; if (ui && ui.cur === "lobby") { try { ui.renderLobby(); } catch (_) {} } annBar(); }
export const modeOff = (m) => !CF.own && (CF.cfg.moff || []).includes(m);
export function onlineBlock() { if (CF.own) return ""; const c = CF.cfg; if (c.mnt && c.mnt.on) return t("a2_maintOn") + (c.mnt.msg ? " — " + c.mnt.msg : ""); if ((c.moff || []).includes("online")) return t("a2_modeOff"); return ""; }
// announcement banner (top of the lobby; closing it hides that one announcement on this device)
export function annBar() { const ui = CF.ui; let el = $("ann-bar"); const a = CF.cfg.ann, mt = CF.cfg.mnt && CF.cfg.mnt.on && !CF.own ? CF.cfg.mnt : null;
  let seen = ""; try { seen = localStorage.getItem("ssp_ann") || ""; } catch (_) {}
  const show = (a && a.exp > Date.now() && String(a.id) !== seen) || mt;
  if (!show) { if (el) el.classList.add("x-hide"); return; }
  if (!el) { el = document.createElement("div"); el.id = "ann-bar"; el.className = "ann-bar"; el.setAttribute("role", "status"); const lb = $("s-lobby"); if (!lb) return; lb.appendChild(el); }
  el.classList.remove("x-hide"); el.innerHTML = `<span class="ann-i">${mt ? "🛠" : "📣"}</span><p dir="auto">${esc(mt ? t("a2_maintOn") + (mt.msg ? " — " + mt.msg : "") : a.tx)}</p>${mt ? "" : `<button class="icon-btn ann-x" aria-label="${t("a2_close")}">✕</button>`}`;
  const x = el.querySelector(".ann-x"); if (x) x.addEventListener("click", () => { try { localStorage.setItem("ssp_ann", String(a.id)); } catch (_) {} el.classList.add("x-hide"); });
  if (ui && ui.cur !== "lobby") el.classList.add("x-hide"); }

// ---------- owner admin: extra tabs (live ops, economy) + dashboard stats + player actions ----------
const A2 = { stats: null, cfg: null, rooms: null, msgs: null };
export function a2Reset(tab) { if (tab === "dash") A2.stats = null; if (tab === "live") { A2.rooms = null; A2.cfg = null; } if (tab === "eco") A2.cfg = null; }
const fmtT = (x) => new Date(x).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short" });
function chart(days) { const mx = Math.max(1, ...days.map((d) => Math.max(d.act, d.nw))), W = 300, H = 110, bw = W / days.length;
  return `<svg class="a2-chart" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="${t("a2_chart")}">${days.map((d, i) => { const ha = (d.act / mx) * H, hn = (d.nw / mx) * H, x = i * bw;
    return `<rect x="${x + bw * 0.14}" y="${H - ha}" width="${bw * 0.36}" height="${ha}" rx="2" class="a"/><rect x="${x + bw * 0.52}" y="${H - hn}" width="${bw * 0.3}" height="${hn}" rx="2" class="n"/><text x="${x + bw / 2}" y="${H + 13}" text-anchor="middle">${d.d.slice(8)}</text><text x="${x + bw * 0.32}" y="${Math.max(9, H - ha - 3)}" text-anchor="middle" class="v">${d.act}</text>`; }).join("")}</svg>
    <p class="fine a2-leg"><i class="a"></i>${t("a2_active")} <i class="n"></i>${t("a2_new")} · UTC</p>`; }
export function dashExtra(adm) { const s = A2.stats; if (!s) { adm("a_stats").then((r) => { A2.stats = r || { err: "offline" }; CF.rer && CF.rer(); }); return `<p class="fine">${t("loading")}…</p>`; }
  if (s.err) return `<p class="so-err">${esc(s.err)}</p>`; const tile = (k, v) => `<div class="ad-tile"><small>${t(k)}</small><b>${v}</b></div>`;
  return `<div class="ad-tiles">${tile("a2_onNow", fmtNum(s.online))}${tile("a2_today", fmtNum(s.today))}${tile("a2_newToday", fmtNum(s.nw))}</div><div class="pv-card"><div class="pv-h">${t("a2_7d")}<button class="btn ac-b ad-sm" data-a2="bak">💾 ${t("a2_bak")}</button></div>${chart(s.days)}</div>`; }
export function liveHtml(adm) { const C = A2.cfg, R = A2.rooms; if (!C) adm("a_cfg").then((r) => { A2.cfg = r || { err: "offline" }; CF.rer && CF.rer(); }); if (!R) adm("a_rooms").then((r) => { A2.rooms = r || { err: "offline" }; CF.rer && CF.rer(); });
  if (!C || !R) return `<p class="fine">${t("loading")}…</p>`; if (C.err) return `<p class="so-err">${esc(C.err)}</p>`;
  const cf = C.cfg, ann = C.raw.ann, mnt = C.raw.mnt || {};
  const rooms = (R.rooms || []).filter((r) => r.info && (r.info.h || r.live));
  return `<div class="pv-g2"><div class="pv-card"><div class="pv-h">📣 ${t("a2_ann")}</div><p class="fine" dir="auto">${ann && ann.exp > Date.now() ? esc(ann.tx) + ` <i>(${t("a2_until")} ${esc(fmtT(ann.exp))})</i>` : t("a2_none")}</p><div class="ac-btns"><button class="btn gold ac-b" data-a2="ann">${t("a2_annSet")}</button>${ann && ann.exp > Date.now() ? `<button class="btn ac-b" data-a2="annx">${t("a2_annClr")}</button>` : ""}</div></div>
    <div class="pv-card"><div class="pv-h">🛠 ${t("a2_maint")}</div><p class="fine">${mnt.on ? `<em class="ad-bad">${t("a2_maintOn")}</em> ${esc(mnt.msg || "")}` : `<span class="ad-good">${t("a2_maintOff")}</span>`}</p><div class="ac-btns">${mnt.on ? `<button class="btn ac-b" data-a2="mntoff">${t("a2_mntStop")}</button>` : `<button class="btn ac-b danger" data-a2="mnton">${t("a2_mntStart")}</button>`}</div></div></div>
    <div class="pv-card"><div class="pv-h">🎮 ${t("a2_modes")}</div><div class="a2-chips">${C.modes.map((m) => `<button class="a2-chip ${cf.moff.includes(m) ? "off" : "on"}" data-mo="${m}" aria-pressed="${!cf.moff.includes(m)}">${esc(t("m_" + m))}</button>`).join("")}</div>
      <div class="pv-lab">${t("a2_events")}</div><div class="a2-chips">${C.events.map((k) => `<button class="a2-chip ${cf.eoff.includes(k) ? "off" : "on"}" data-ev="${k}" aria-pressed="${!cf.eoff.includes(k)}">${esc(t("a2_ev_" + k))}</button>`).join("")}</div></div>
    <div class="pv-card"><div class="pv-h">🏟 ${t("a2_rooms")} · ${rooms.length}<button class="btn ac-b ad-sm" data-a2="rref">${t("ad_refresh")}</button></div>${rooms.length ? rooms.map((r) => `<div class="a2-room"><b>${esc(r.room)}</b> <small class="fine">${esc(t("a2_online"))}${r.br ? " · " + esc(t("br_" + r.br)) : ""} · 👤 ${r.info.h} · 🤖 ${r.info.b}</small>
      ${r.info.pl.map((p) => `<div class="a2-pl"><span dir="auto">${esc(p.n)} ${p.u ? pidHtml(p.u) : ""} <small class="fine">◉ ${fmtNum(p.m)}</small></span>${p.u && p.u !== "1" ? `<button class="btn ac-b danger ad-sm" data-kick="${esc(r.room)}|${esc(p.u)}|${esc(p.n)}">${t("a2_kick")}</button>` : ""}</div>`).join("")}</div>`).join("") : `<p class="fine">${t("ad_noRooms")}</p>`}</div>`; }
export function ecoHtml(adm) { const C = A2.cfg; if (!C) { adm("a_cfg").then((r) => { A2.cfg = r || { err: "offline" }; CF.rer && CF.rer(); }); return `<p class="fine">${t("loading")}…</p>`; } if (C.err) return `<p class="so-err">${esc(C.err)}</p>`;
  const it = (s) => { const a = (() => { try { return JSON.parse(s || "[]"); } catch (_) { return []; } })(); return a.length ? " + " + a.map(esc).join(", ") : ""; };
  return `<div class="pv-g2"><div class="pv-card"><div class="pv-h">🎁 ${t("a2_gift")}<button class="btn gold ac-b ad-sm" data-a2="gift">${t("a2_new1")}</button></div>${C.gifts.length ? C.gifts.map((g) => `<p class="fine">#${g.id} ◆${fmtNum(g.coins)}${it(g.items)} · ${t("a2_claimed")} ${fmtNum(g.n)} · ${g.exp > Date.now() ? t("a2_until") + " " + esc(fmtT(g.exp)) : t("a2_ended")}<br><span dir="auto">${esc(g.why)}</span></p>`).join("") : `<p class="fine">${t("a2_none")}</p>`}</div>
    <div class="pv-card"><div class="pv-h">🏷 ${t("a2_promo")}<button class="btn gold ac-b ad-sm" data-a2="promo">${t("a2_new1")}</button></div>${C.promos.length ? `<table class="lb ad-tb"><tr><th>${t("a2_code")}</th><th>${t("a2_reward")}</th><th>${t("a2_uses")}</th><th></th></tr>` + C.promos.map((p) => `<tr class="${p.off || p.exp < Date.now() ? "dim" : ""}"><td dir="ltr"><b>${esc(p.code)}</b></td><td>◆${fmtNum(p.coins)}${it(p.items)}</td><td>${p.used}/${p.max}</td><td>${p.off ? t("a2_off") : p.exp < Date.now() ? t("a2_ended") : `<button class="btn ac-b ad-sm" data-poff="${esc(p.code)}">${t("a2_disable")}</button>`}</td></tr>`).join("") + `</table>` : `<p class="fine">${t("a2_none")}</p>`}</div></div>
    <div class="pv-card"><div class="pv-h">🛒 ${t("a2_prices")}</div><table class="lb ad-tb a2-px"><tr><th>${t("a2_item")}</th><th>${t("a2_base")}</th><th>${t("a2_now")}</th><th></th></tr>${C.prices.map((p) => `<tr><td dir="ltr">${esc(p.k)}</td><td>◆${fmtNum(p.b)}</td><td class="${p.p !== p.b ? "g" : ""}">◆${fmtNum(p.p)}</td><td><button class="btn ac-b ad-sm" data-px="${esc(p.k)}|${p.p}|${p.b}">${t("a2_edit")}</button></td></tr>`).join("")}</table></div>`; }
export function playerExtra(v) { if (!v || !v.card || v.err) return "";
  return `<div class="pv-card"><div class="pv-h">${t("a2_owner")}</div><div class="ad-kvs"><div class="ad-kv"><small>${t("ad_level")}</small><b>${v.lv == null ? "—" : v.lv}</b></div><div class="ad-kv"><small>🏆</small><b>${v.tr == null ? "—" : fmtNum(v.tr)}</b></div><div class="ad-kv"><small>${t("a2_items")}</small><b>${(v.items || []).length}</b></div><div class="ad-kv"><small>${t("a2_msgs")}</small><b>${v.msgs | 0}</b></div></div>
    <div class="ad-acts"><button class="btn gold ac-b" data-p2="coins">◆ ${t("a2_setCoins")}</button><button class="btn ac-b" data-p2="give">＋ ${t("a2_giveItem")}</button><button class="btn ac-b danger" data-p2="take">− ${t("a2_takeItem")}</button><button class="btn ac-b" data-p2="lvl">${t("a2_setLvl")}</button>
    <button class="btn ac-b" data-p2="sid">★ ${t("a2_sid")}</button>${(v.prem || []).length ? `<button class="btn ac-b danger" data-p2="sidrm">★ ${t("a2_sidRm")}</button>` : ""}<button class="btn ac-b" data-p2="tr">🏆 ${t("a2_trSet")}</button><button class="btn ac-b danger" data-p2="trrs">🏆 ${t("a2_trReset")}</button><button class="btn ac-b" data-p2="msgs">💬 ${t("a2_chat")}</button></div></div>
    ${A2.msgs && A2.msgs.id === v.card.id ? `<div class="pv-card"><div class="pv-h">💬 ${t("a2_chat")} · ${A2.msgs.list.length}${A2.msgs.list.length ? `<button class="btn ac-b danger ad-sm" data-p2="mclr">${t("a2_clearAll")}</button>` : ""}</div>${A2.msgs.list.map((x) => `<div class="a2-pl"><span class="ad-msg" dir="auto">“${esc(x.tx)}” <small class="fine">${esc(fmtT(x.t))}</small></span><button class="btn ac-b danger ad-sm" data-mdel="${x.id}">${t("ad_del")}</button></div>`).join("") || `<p class="fine">${t("a2_none")}</p>`}</div>` : ""}`; }

// item picker by category (keys are what the server's validKey accepts)
const CATS = [["skins", () => SKINS.filter((s) => s.src).map((s) => [s.id, s.id])], ["flags", () => FLAGS.map((f) => ["fl:" + f.i, f.en || f.c])], ["trails", () => GTRAILS.filter((g) => g.price).map((g) => ["gt:" + g.id, g.id])],
  ["avatars", () => AVATARS.map((_, i) => ["av:p" + i, "#" + i])], ["frames", () => FRAMES.map((f, i) => ["fr:" + i, f.id || "#" + i])], ["titles", () => TITLES.map((x, i) => ["ti:" + i, x.id || "#" + i])], ["banners", () => BANNERS.map((b, i) => ["bn:" + i, (b.w && b.w.id) || "#" + i])]];
// generic owner dialog: fields + required reason; destructive actions need a second tap ("Confirm again") and send sure: 1
function dlg(ui, o) {
  const m = $("m-adact"), c = $("m-adact-c"); if (!m) return;
  const F = (f) => f.k === "sel" ? `<label class="pv-lab" for="d2-${f.n}">${t(f.l)}</label><select id="d2-${f.n}" class="a2-sel">${f.opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`
    : f.k === "cat" ? `<div class="pv-lab">${t("a2_cat")}</div><div class="seg small a2-cats" id="d2-cat">${CATS.map(([k], i) => `<button type="button" data-c="${k}" class="${i ? "" : "on"}">${t("a2_c_" + k)}</button>`).join("")}</div><select id="d2-it" class="a2-sel"></select>`
    : f.k === "chk" ? `<label class="a2-chk"><input type="checkbox" id="d2-${f.n}" ${f.v ? "checked" : ""}> ${t(f.l)}</label>`
    : `<label class="pv-lab" for="d2-${f.n}">${t(f.l)}</label><input id="d2-${f.n}" ${f.num ? 'inputmode="numeric" dir="ltr"' : 'dir="auto"'} maxlength="${f.max || 280}" value="${esc(f.v == null ? "" : f.v)}" placeholder="${esc(f.ph || "")}">`;
  c.innerHTML = `<h2>${esc(o.title)}</h2>${o.sub ? `<p class="fine" dir="auto">${o.sub}</p>` : ""}${o.danger ? `<p class="so-err">${t("a2_danger")}</p>` : ""}<form class="ac-form col" id="d2-f">${(o.fields || []).map(F).join("")}<label class="pv-lab" for="d2-why">${t("ad_reason")}</label><input id="d2-why" dir="auto" maxlength="200" placeholder="${t("ad_reasonPh")}"><p class="so-err" id="d2-e"></p><div class="ac-btns"><button class="btn gold ac-b ${o.danger ? "danger" : ""}" type="submit" id="d2-ok">${t("ad_confirm")}</button><button class="btn ac-b" type="button" id="d2-x">${t("pvCancel")}</button></div></form>`;
  m.classList.remove("x-hide"); let armed = false;
  const fillCat = (k) => { const s = $("d2-it"); if (!s) return; const L = (CATS.find((x) => x[0] === k) || CATS[0])[1](); s.innerHTML = L.map(([v, l]) => `<option value="${esc(v)}">${esc(l)} · ${esc(v)}</option>`).join(""); };
  c.querySelectorAll("#d2-cat button").forEach((b) => b.addEventListener("click", () => { c.querySelectorAll("#d2-cat button").forEach((x) => x.classList.toggle("on", x === b)); fillCat(b.dataset.c); })); fillCat("skins");
  ui.click($("d2-x"), () => m.classList.add("x-hide"), "back");
  $("d2-f").addEventListener("submit", async (e) => { e.preventDefault(); const why = $("d2-why").value.trim(), err = $("d2-e"); if (why.length < 3) { err.textContent = t("ad_needReason"); return; }
    if (o.danger && !armed) { armed = true; $("d2-ok").textContent = t("a2_again"); err.textContent = t("a2_sure"); return; }
    const v = {}; for (const f of o.fields || []) { const el = f.k === "cat" ? $("d2-it") : $("d2-" + f.n); v[f.k === "cat" ? "it" : f.n] = f.k === "chk" ? el.checked : el.value.trim(); }
    const r = await o.run({ ...v, why, sure: o.danger ? 1 : undefined }); if (!r || !r.ok) { err.textContent = t("a2_e_" + (r && r.err)) !== "a2_e_" + (r && r.err) ? t("a2_e_" + r.err) : r && r.err === "reason" ? t("ad_needReason") : String((r && r.err) || "offline"); return; }
    m.classList.add("x-hide"); ui.toast(t("ad_done") + (r.live ? " · " + t("ad_live") : ""), "good", 2600); o.done && o.done(r); });
}
export function bind2(ui, el, adm, A, reload) {
  const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => ui.click(b, () => fn(b), "tab"));
  const rc = () => { A2.cfg = null; A.aud = null; reload(); };
  on('[data-a2="bak"]', () => dlg(ui, { title: "💾 " + t("a2_bak"), sub: t("a2_bakSub"), run: (v) => adm("a_bak", v), done: (r) => { ui.toast(t("a2_bakDone", { id: r.id, kb: Math.round(r.sz / 1024) }), "good", 4000); A.aud = null; } }));
  on('[data-a2="ann"]', () => dlg(ui, { title: "📣 " + t("a2_annSet"), fields: [{ n: "tx", l: "a2_annTx", max: 280 }, { n: "hours", l: "a2_hours", num: 1, v: 24, max: 3 }], run: (v) => adm("a_ann", { ...v, hours: +v.hours || 24 }), done: rc }));
  on('[data-a2="annx"]', () => dlg(ui, { title: "📣 " + t("a2_annClr"), run: (v) => adm("a_ann", { ...v, tx: "" }), done: rc }));
  on('[data-a2="mnton"]', () => dlg(ui, { title: "🛠 " + t("a2_mntStart"), danger: 1, fields: [{ n: "msg", l: "a2_mntMsg", max: 200 }], run: (v) => adm("a_mnt", { ...v, on: 1 }), done: rc }));
  on('[data-a2="mntoff"]', () => dlg(ui, { title: "🛠 " + t("a2_mntStop"), run: (v) => adm("a_mnt", { ...v, on: 0 }), done: rc }));
  const tog = (key, val) => { const C = A2.cfg.cfg, mo = new Set(C.moff), eo = new Set(C.eoff), S = key === "mo" ? mo : eo; S.has(val) ? S.delete(val) : S.add(val);
    dlg(ui, { title: "🎮 " + (S.has(val) ? t("a2_off") : t("a2_onW")) + ": " + (key === "mo" ? t("m_" + val) : t("a2_ev_" + val)), run: (v) => adm("a_modes", { ...v, moff: [...mo], eoff: [...eo] }), done: rc }); };
  on("[data-mo]", (b) => tog("mo", b.dataset.mo)); on("[data-ev]", (b) => tog("ev", b.dataset.ev));
  on('[data-a2="rref"]', () => { A2.rooms = null; reload(); });
  on("[data-kick]", (b) => { const [room, u, n] = b.dataset.kick.split("|"); dlg(ui, { title: t("a2_kick") + ": " + n, sub: esc(room) + " · " + pidHtml(u), danger: 1, run: (v) => adm("a_kick", { ...v, room, u }), done: () => { A2.rooms = null; A.aud = null; reload(); } }); });
  on('[data-a2="gift"]', () => dlg(ui, { title: "🎁 " + t("a2_gift"), sub: t("a2_giftSub"), fields: [{ n: "coins", l: "ad_coins", num: 1, v: 500, max: 6 }, { n: "items", l: "ad_items", ph: "fl:3, gt:sparks", max: 200 }, { n: "days", l: "a2_days", num: 1, v: 7, max: 2 }], run: (v) => adm("a_gift", { ...v, coins: +v.coins || 0, days: +v.days || 7, items: v.items.split(/[,\s]+/).filter(Boolean) }), done: rc }));
  on('[data-a2="promo"]', () => dlg(ui, { title: "🏷 " + t("a2_promo"), fields: [{ n: "code", l: "a2_code", ph: "EID2026", max: 16 }, { n: "coins", l: "ad_coins", num: 1, v: 200, max: 6 }, { n: "items", l: "ad_items", ph: "fl:3", max: 200 }, { n: "max", l: "a2_maxUses", num: 1, v: 100, max: 6 }, { n: "days", l: "a2_days", num: 1, v: 7, max: 3 }],
    run: (v) => adm("a_promo", { ...v, coins: +v.coins || 0, max: +v.max || 100, days: +v.days || 7, items: v.items.split(/[,\s]+/).filter(Boolean) }), done: rc }));
  on("[data-poff]", (b) => dlg(ui, { title: t("a2_disable") + " " + b.dataset.poff, danger: 1, run: (v) => adm("a_promo", { ...v, code: b.dataset.poff, off: 1 }), done: rc }));
  on("[data-px]", (b) => { const [k, p, base] = b.dataset.px.split("|"); dlg(ui, { title: "🛒 " + k, sub: t("a2_base") + " ◆" + fmtNum(+base) + " · " + t("a2_pxSub"), fields: [{ n: "price", l: "a2_now", num: 1, v: p, max: 7 }], run: (v) => adm("a_price", { ...v, key: k, price: +v.price || 0 }), done: rc }); });
  // one player
  const V = A.view; if (!V || !V.card) return; const id = V.card.id, who = esc(V.card.n) + " · " + pidHtml(id), rv = async () => { const x = await adm("a_view", { id }); if (x && x.card) A.view = x; A.aud = null; reload(); };
  on('[data-p2="coins"]', () => dlg(ui, { title: "◆ " + t("a2_setCoins"), sub: who + " · ◆" + fmtNum(V.wal ? V.wal.bal : 0), fields: [{ n: "bal", l: "a2_exact", num: 1, v: V.wal ? V.wal.bal : 0, max: 9 }], danger: 0, run: (v) => adm("a_coins", { ...v, id, bal: +v.bal, sure: V.wal && +v.bal < V.wal.bal ? 1 : undefined }), done: rv }));
  on('[data-p2="give"]', () => dlg(ui, { title: "＋ " + t("a2_giveItem"), sub: who, fields: [{ k: "cat", n: "it" }], run: (v) => adm("a_item", { ...v, id }), done: rv }));
  on('[data-p2="take"]', () => dlg(ui, { title: "− " + t("a2_takeItem"), sub: who, danger: 1, fields: [{ k: "sel", n: "it", l: "a2_items", opts: (V.items || []).filter((x) => !x.startsWith("sid:")).map((x) => [x, x]) }], run: (v) => adm("a_item", { ...v, id, rm: 1 }), done: rv }));
  on('[data-p2="lvl"]', () => dlg(ui, { title: t("a2_setLvl"), sub: who, fields: [{ n: "lv", l: "ad_level", num: 1, v: V.lv || 1, max: 3 }], run: (v) => adm("a_lvl", { ...v, id, lv: +v.lv, sure: V.lv && +v.lv < V.lv ? 1 : undefined }), done: rv }));
  on('[data-p2="sid"]', () => dlg(ui, { title: "★ " + t("a2_sid"), sub: who + " · " + t("a2_sidSub"), fields: [{ n: "n", l: "a2_sidN", num: 1, ph: "77777", max: 5 }], run: (v) => adm("a_sid", { ...v, id }), done: rv }));
  on('[data-p2="sidrm"]', () => dlg(ui, { title: "★ " + t("a2_sidRm"), sub: who, danger: 1, fields: [{ k: "sel", n: "n", l: "a2_sidN", opts: (V.prem || []).map((x) => [x, x]) }], run: (v) => adm("a_sid", { ...v, id, rm: 1 }), done: rv }));
  on('[data-p2="tr"]', () => dlg(ui, { title: "🏆 " + t("a2_trSet"), sub: who, danger: 1, fields: [{ n: "tr", l: "a2_trophies", num: 1, v: V.tr || 0, max: 6 }], run: (v) => adm("a_trs", { ...v, id, tr: +v.tr || 0 }), done: rv }));
  on('[data-p2="trrs"]', () => dlg(ui, { title: "🏆 " + t("a2_trReset"), sub: who, danger: 1, run: (v) => adm("a_trs", { ...v, id, reset: 1 }), done: rv }));
  on('[data-p2="msgs"]', async () => { const r = await adm("a_msgs", { id }); A2.msgs = { id, list: (r && r.list) || [] }; reload(); });
  const rm2 = async () => { const r = await adm("a_msgs", { id }); A2.msgs = { id, list: (r && r.list) || [] }; rv(); };
  on('[data-p2="mclr"]', () => dlg(ui, { title: t("a2_clearAll"), sub: who, danger: 1, run: (v) => adm("a_mclr", { ...v, id }), done: rm2 }));
  on("[data-mdel]", (b) => dlg(ui, { title: t("ad_del") + " 💬", sub: who, danger: 1, run: (v) => adm("a_mdel", { ...v, mid: +b.dataset.mdel }), done: rm2 }));
}
export const actName2 = { coins: "a2_setCoins", item_give: "a2_giveItem", item_rm: "a2_takeItem", level: "a2_setLvl", sid_give: "a2_sid", sid_rm: "a2_sidRm", ann: "a2_ann", maint: "a2_maint", modes: "a2_modes", price: "a2_prices", gift: "a2_gift", promo: "a2_promo", promo_off: "a2_disable", kick: "a2_kick", msg_del: "a2_chat", msg_clr: "a2_clearAll", tr_set: "a2_trSet", tr_reset: "a2_trReset", backup: "a2_bak" };

addStrings({
  ad_live2: ["Live", "مباشر", "Canlı", "En direct", "En vivo", "लाइव"],
  ad_eco: ["Economy", "الاقتصاد", "Ekonomi", "Économie", "Economía", "अर्थव्यवस्था"],
  a2_onNow: ["Online now", "متصلين هسه", "Şu an çevrimiçi", "En ligne", "En línea ahora", "अभी ऑनलाइन"],
  a2_today: ["Active today", "نشطين اليوم", "Bugün aktif", "Actifs aujourd'hui", "Activos hoy", "आज सक्रिय"],
  a2_newToday: ["New today", "جدد اليوم", "Bugün yeni", "Nouveaux aujourd'hui", "Nuevos hoy", "आज नए"],
  a2_7d: ["Last 7 days", "آخر ٧ أيام", "Son 7 gün", "7 derniers jours", "Últimos 7 días", "पिछले 7 दिन"],
  a2_chart: ["Active and new players per day", "اللاعبين النشطين والجدد باليوم", "Günlük aktif ve yeni oyuncular", "Joueurs actifs et nouveaux par jour", "Jugadores activos y nuevos por día", "प्रतिदिन सक्रिय और नए खिलाड़ी"],
  a2_active: ["active", "نشطين", "aktif", "actifs", "activos", "सक्रिय"],
  a2_new: ["new", "جدد", "yeni", "nouveaux", "nuevos", "नए"],
  a2_bak: ["Backup now", "نسخة احتياطية هسه", "Şimdi yedekle", "Sauvegarder", "Copia ahora", "अभी बैकअप"],
  a2_bakSub: ["Stores a full snapshot (accounts, wallets, ledger, board) on the server. The last 5 are kept.", "يحفظ نسخة كاملة (الحسابات، المحافظ، السجل، الترتيب) بالسيرفر. تنحفظ آخر ٥.", "Sunucuda tam bir anlık görüntü saklar. Son 5 tutulur.", "Enregistre un instantané complet sur le serveur. Les 5 derniers sont gardés.", "Guarda una copia completa en el servidor. Se conservan las 5 últimas.", "सर्वर पर पूरा स्नैपशॉट सहेजता है। आख़िरी 5 रखे जाते हैं।"],
  a2_bakDone: ["Backup #{id} saved ({kb} KB)", "انحفظت النسخة #{id} ({kb} KB)", "Yedek #{id} kaydedildi ({kb} KB)", "Sauvegarde #{id} enregistrée ({kb} Ko)", "Copia #{id} guardada ({kb} KB)", "बैकअप #{id} सहेजा गया ({kb} KB)"],
  a2_ann: ["Announcement", "إعلان", "Duyuru", "Annonce", "Anuncio", "घोषणा"],
  a2_annSet: ["New announcement", "إعلان جديد", "Yeni duyuru", "Nouvelle annonce", "Nuevo anuncio", "नई घोषणा"],
  a2_annClr: ["Remove", "شيل", "Kaldır", "Retirer", "Quitar", "हटाएँ"],
  a2_annTx: ["Text (any language)", "النص (بأي لغة)", "Metin (herhangi bir dil)", "Texte (toute langue)", "Texto (cualquier idioma)", "टेक्स्ट (कोई भी भाषा)"],
  a2_hours: ["Show for (hours)", "يبين لمدة (ساعات)", "Süre (saat)", "Durée (heures)", "Mostrar (horas)", "कितने घंटे"],
  a2_until: ["until", "لحد", "şu zamana kadar", "jusqu'au", "hasta", "तक"],
  a2_none: ["None", "ماكو", "Yok", "Aucun", "Ninguno", "कोई नहीं"],
  a2_maint: ["Maintenance", "صيانة", "Bakım", "Maintenance", "Mantenimiento", "रखरखाव"],
  a2_maintOn: ["Online play is under maintenance", "اللعب أونلاين تحت الصيانة", "Çevrimiçi oyun bakımda", "Jeu en ligne en maintenance", "Juego en línea en mantenimiento", "ऑनलाइन खेल रखरखाव में है"],
  a2_maintOff: ["Online open", "الأونلاين مفتوح", "Çevrimiçi açık", "En ligne ouvert", "En línea abierto", "ऑनलाइन खुला"],
  a2_mntStart: ["Start maintenance", "شغّل الصيانة", "Bakımı başlat", "Lancer la maintenance", "Iniciar mantenimiento", "रखरखाव शुरू"],
  a2_mntStop: ["End maintenance", "طفي الصيانة", "Bakımı bitir", "Fin de maintenance", "Terminar mantenimiento", "रखरखाव ख़त्म"],
  a2_mntMsg: ["Message to players", "رسالة للاعبين", "Oyunculara mesaj", "Message aux joueurs", "Mensaje a jugadores", "खिलाड़ियों को संदेश"],
  a2_modeOff: ["This mode is switched off for now", "هذا الوضع مطفي حالياً", "Bu mod şu an kapalı", "Ce mode est désactivé pour l'instant", "Este modo está desactivado por ahora", "यह मोड अभी बंद है"],
  a2_modes: ["Game modes & events", "أوضاع اللعب والأحداث", "Oyun modları ve etkinlikler", "Modes et événements", "Modos y eventos", "गेम मोड और इवेंट"],
  a2_events: ["Arena events (online)", "أحداث الساحة (أونلاين)", "Arena etkinlikleri (çevrimiçi)", "Événements d'arène (en ligne)", "Eventos de arena (en línea)", "एरीना इवेंट (ऑनलाइन)"],
  a2_ev_rain: ["Golden rain", "مطر ذهبي", "Altın yağmuru", "Pluie dorée", "Lluvia dorada", "सुनहरी बारिश"],
  a2_ev_drops: ["Power-up drops", "إسقاط القوى", "Güç düşüşleri", "Bonus parachutés", "Caída de poderes", "पावर-अप ड्रॉप"],
  a2_ev_bounty: ["Bounty bot", "بوت المكافأة", "Ödül botu", "Bot à prime", "Bot recompensa", "बाउंटी बॉट"],
  a2_off: ["Off", "مطفي", "Kapalı", "Désactivé", "Apagado", "बंद"],
  a2_onW: ["On", "شغّال", "Açık", "Activé", "Encendido", "चालू"],
  a2_rooms: ["Live rooms", "الغرف الشغالة", "Canlı odalar", "Salles en direct", "Salas en vivo", "लाइव रूम"],
  a2_online: ["Online", "أونلاين", "Çevrimiçi", "En ligne", "En línea", "ऑनलाइन"],
  a2_kick: ["Kick", "اطرد", "At", "Expulser", "Expulsar", "निकालें"],
  a2_gift: ["Gift to all players", "هدية لكل اللاعبين", "Tüm oyunculara hediye", "Cadeau à tous", "Regalo para todos", "सभी को उपहार"],
  a2_giftSub: ["Every player who already has an account gets it once on their next connect.", "كل لاعب عنده حساب ياخذها مرة وحدة أول ما يدخل.", "Hesabı olan her oyuncu bir sonraki bağlantıda bir kez alır.", "Chaque joueur existant la reçoit une fois à sa prochaine connexion.", "Cada jugador existente la recibe una vez al conectarse.", "हर मौजूदा खिलाड़ी अगली बार जुड़ने पर एक बार पाएगा।"],
  a2_new1: ["New", "جديد", "Yeni", "Nouveau", "Nuevo", "नया"],
  a2_claimed: ["claimed", "استلموا", "alındı", "réclamés", "reclamados", "लिए गए"],
  a2_ended: ["ended", "خلص", "bitti", "terminé", "terminado", "समाप्त"],
  a2_promo: ["Promo codes", "أكواد ترويجية", "Promosyon kodları", "Codes promo", "Códigos promo", "प्रोमो कोड"],
  a2_code: ["Code", "الكود", "Kod", "Code", "Código", "कोड"],
  a2_reward: ["Reward", "الجائزة", "Ödül", "Récompense", "Premio", "इनाम"],
  a2_uses: ["Uses", "الاستخدام", "Kullanım", "Utilisations", "Usos", "उपयोग"],
  a2_maxUses: ["Max uses", "أقصى استخدام", "En fazla kullanım", "Utilisations max", "Usos máximos", "अधिकतम उपयोग"],
  a2_days: ["Days valid", "أيام الصلاحية", "Geçerli gün", "Jours de validité", "Días válidos", "मान्य दिन"],
  a2_disable: ["Disable", "عطّل", "Devre dışı", "Désactiver", "Desactivar", "बंद करें"],
  a2_prices: ["Store prices", "أسعار المتجر", "Mağaza fiyatları", "Prix de la boutique", "Precios de tienda", "स्टोर कीमतें"],
  a2_item: ["Item", "الغرض", "Eşya", "Objet", "Objeto", "आइटम"],
  a2_base: ["Base", "الأصلي", "Taban", "Base", "Base", "मूल"],
  a2_now: ["Price now", "السعر هسه", "Şimdiki fiyat", "Prix actuel", "Precio actual", "अभी की कीमत"],
  a2_edit: ["Edit", "عدّل", "Düzenle", "Modifier", "Editar", "बदलें"],
  a2_pxSub: ["0 = back to base. Weekly offers follow the new price.", "٠ = يرجع للأصلي. عروض الأسبوع تمشي على السعر الجديد.", "0 = tabana dön. Haftalık teklifler yeni fiyatı izler.", "0 = prix de base. Les offres suivent le nouveau prix.", "0 = volver a base. Las ofertas siguen el nuevo precio.", "0 = मूल कीमत। ऑफ़र नई कीमत पर चलते हैं।"],
  a2_owner: ["Owner tools", "أدوات المالك", "Sahip araçları", "Outils du propriétaire", "Herramientas del dueño", "मालिक टूल"],
  a2_items: ["Items", "الأغراض", "Eşyalar", "Objets", "Objetos", "आइटम"],
  a2_msgs: ["Messages", "الرسائل", "Mesajlar", "Messages", "Mensajes", "संदेश"],
  a2_setCoins: ["Set coins", "حدد الكوينز", "Coin ayarla", "Fixer les pièces", "Fijar monedas", "सिक्के सेट"],
  a2_exact: ["Exact balance", "الرصيد بالضبط", "Tam bakiye", "Solde exact", "Saldo exacto", "सटीक बैलेंस"],
  a2_giveItem: ["Give item", "انطي غرض", "Eşya ver", "Donner un objet", "Dar objeto", "आइटम दें"],
  a2_takeItem: ["Remove item", "شيل غرض", "Eşya al", "Retirer un objet", "Quitar objeto", "आइटम हटाएँ"],
  a2_setLvl: ["Set level", "حدد اللفل", "Seviye ayarla", "Fixer le niveau", "Fijar nivel", "लेवल सेट"],
  a2_sid: ["Assign special ID", "انطي آيدي مميز", "Özel ID ver", "Attribuer un ID spécial", "Asignar ID especial", "विशेष ID दें"],
  a2_sidRm: ["Remove special ID", "شيل الآيدي المميز", "Özel ID'yi kaldır", "Retirer l'ID spécial", "Quitar ID especial", "विशेष ID हटाएँ"],
  a2_sidN: ["5-digit ID", "آيدي من ٥ أرقام", "5 haneli ID", "ID à 5 chiffres", "ID de 5 dígitos", "5 अंकों की ID"],
  a2_sidSub: ["5 digits; ID 1 is never assigned", "٥ أرقام؛ آيدي ١ ما ينطى أبداً", "5 hane; ID 1 asla verilmez", "5 chiffres ; l'ID 1 n'est jamais attribué", "5 dígitos; el ID 1 nunca se asigna", "5 अंक; ID 1 कभी नहीं दी जाती"],
  a2_trSet: ["Set trophies", "حدد الكؤوس", "Kupa ayarla", "Fixer les trophées", "Fijar trofeos", "ट्रॉफी सेट"],
  a2_trReset: ["Reset leaderboard entry", "صفّر الترتيب", "Sıralamayı sıfırla", "Réinitialiser le classement", "Reiniciar clasificación", "लीडरबोर्ड रीसेट"],
  a2_trophies: ["Trophies", "الكؤوس", "Kupalar", "Trophées", "Trofeos", "ट्रॉफी"],
  a2_chat: ["Chat messages", "رسائل الدردشة", "Sohbet mesajları", "Messages du chat", "Mensajes de chat", "चैट संदेश"],
  a2_clearAll: ["Clear all", "امسح الكل", "Hepsini sil", "Tout effacer", "Borrar todo", "सब मिटाएँ"],
  a2_cat: ["Category", "الصنف", "Kategori", "Catégorie", "Categoría", "श्रेणी"],
  a2_c_skins: ["Skins", "سكنات", "Görünümler", "Skins", "Aspectos", "स्किन"], a2_c_flags: ["Flags", "أعلام", "Bayraklar", "Drapeaux", "Banderas", "झंडे"], a2_c_trails: ["Trails", "آثار", "İzler", "Traînées", "Estelas", "ट्रेल"],
  a2_c_avatars: ["Avatars", "صور", "Avatarlar", "Avatars", "Avatares", "अवतार"], a2_c_frames: ["Frames", "إطارات", "Çerçeveler", "Cadres", "Marcos", "फ़्रेम"], a2_c_titles: ["Titles", "ألقاب", "Unvanlar", "Titres", "Títulos", "टाइटल"], a2_c_banners: ["Banners", "بانرات", "Afişler", "Bannières", "Pancartas", "बैनर"],
  a2_danger: ["This changes or removes data. You will confirm twice.", "هذا يغيّر أو يمسح بيانات. راح تأكد مرتين.", "Bu veri değiştirir veya siler. İki kez onaylayacaksın.", "Ceci modifie ou supprime des données. Double confirmation.", "Esto cambia o borra datos. Confirmarás dos veces.", "यह डेटा बदलता/हटाता है। दो बार पुष्टि करें।"],
  a2_again: ["Confirm again", "أكد مرة ثانية", "Tekrar onayla", "Confirmer encore", "Confirmar otra vez", "फिर पुष्टि करें"],
  a2_sure: ["Sure? Tap again to apply.", "متأكد؟ دوس مرة ثانية.", "Emin misin? Uygulamak için tekrar dokun.", "Sûr ? Touchez encore pour appliquer.", "¿Seguro? Toca otra vez.", "पक्का? लागू करने के लिए फिर टैप करें।"],
  a2_close: ["Close", "سد", "Kapat", "Fermer", "Cerrar", "बंद"],
  a2_e_nomig: ["This player has not opened an updated version yet", "هذا اللاعب بعده ما فتح النسخة الجديدة", "Bu oyuncu henüz güncel sürümü açmadı", "Ce joueur n'a pas encore ouvert la nouvelle version", "Este jugador aún no abrió la versión nueva", "इस खिलाड़ी ने नया संस्करण अभी नहीं खोला"],
  a2_e_sold: ["That ID is already taken", "هذا الآيدي مأخوذ", "Bu ID alınmış", "Cet ID est déjà pris", "Ese ID ya está tomado", "यह ID पहले से ली गई है"],
  a2_e_bad: ["Not a valid value", "قيمة مو صحيحة", "Geçersiz değer", "Valeur invalide", "Valor no válido", "मान्य मान नहीं"],
  a2_e_taken: ["That code already exists", "هذا الكود موجود", "Bu kod zaten var", "Ce code existe déjà", "Ese código ya existe", "यह कोड पहले से है"],
  a2_e_empty: ["Add coins or an item", "ضيف كوينز أو غرض", "Coin veya eşya ekle", "Ajoutez des pièces ou un objet", "Añade monedas u objeto", "सिक्के या आइटम जोड़ें"],
  a2_e_owner: ["The owner account is protected", "حساب المالك محمي", "Sahip hesabı korunuyor", "Le compte propriétaire est protégé", "La cuenta del dueño está protegida", "मालिक का खाता सुरक्षित है"],
  pr_ok: ["Code redeemed: +{c} coins", "انصرف الكود: +{c} كوينز", "Kod kullanıldı: +{c} coin", "Code utilisé : +{c} pièces", "Código canjeado: +{c} monedas", "कोड रिडीम: +{c} सिक्के"],
  pr_used: ["You already used this code", "استعملت هذا الكود قبل", "Bu kodu zaten kullandın", "Code déjà utilisé", "Ya usaste este código", "यह कोड पहले इस्तेमाल हो चुका"],
  pr_exp: ["This code has expired", "الكود منتهي", "Kodun süresi doldu", "Ce code a expiré", "Este código expiró", "यह कोड समाप्त हो गया"],
  pr_max: ["This code has run out", "الكود خلص", "Kodun kullanımı bitti", "Ce code est épuisé", "Este código se agotó", "यह कोड ख़त्म हो गया"],
  a2_kicked: ["You were removed from the room", "انطردت من الغرفة", "Odadan çıkarıldın", "Vous avez été retiré de la salle", "Te sacaron de la sala", "आपको रूम से हटाया गया"],
});
