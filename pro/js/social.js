// srv1: social layer. Public player ids (7 digits, server-assigned; 1 = the founder), Special IDs shop (5-digit ids for coins),
// friends (requests, accept / decline, remove, block), 1:1 chat (200 chars + the in-game emotes, last 100 kept on the server),
// invites into the same online room, live notifications over one WebSocket to the "social-v1" object (reconnect with
// back-off; a 30 s HTTP poll only while the socket is down), presence (online / in lobby / in a match), in-match player card.
// No sound, no voice. Everything degrades to a friendly "offline" message when the server cannot be reached.
import { t, fmtNum, addStrings, LANG } from "./i18n.js?v=play2";
import { SERVER } from "./net.js?v=play2";
import { devKey } from "./league.js?v=play2";
import { avatarHtml } from "./profile.js?v=play2";
import { idKind, idPrice, MSG_MAX } from "./sim.js?v=play2";
import { EMOTES } from "./game.js?v=play2";
import { pidHtml, pidBig } from "./pid.js?v=play2";
import { WL, online as walletOnline, onPush as walletPush, admSet } from "./wallet.js?v=play2"; // coin1
import { setCfg } from "./admin2.js?v=play2"; // admin2

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WS_URL = SERVER.replace(/\/ws$/, "/sws"), HTTP_URL = SERVER.replace(/^ws/, "http").replace(/\/ws$/, "/s");
const IC = {
  ppl: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 13.6c2.9.2 5 2.2 5 5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4Z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7Z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M4 12 20 4l-6 16-3-7Z"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

// ---------- connection + state ----------
export const SO = { ui: null, ws: null, up: false, tries: 0, pk: "", me: null, fr: [], inq: [], outq: [], bl: [], inv: [], chats: new Map(), open: "", seq: 1, wait: new Map(), st: "lobby", tab: "fr", lastList: 0, lat: [] };
function S_() { return SO.ui.S; }
export function socialStart(ui) {
  SO.ui = ui; injectDom(ui); const pk = devKey(ui.S); WL.call = call; WL.up = () => SO.up; WL.onBal = (c) => ui.coins && ui.coins(c); // coin1: the wallet talks through this socket (HTTP fallback)
  if (pk !== SO.pk) { SO.pk = pk; SO.me = null; SO.fr = []; SO.inq = []; SO.outq = []; SO.bl = []; SO.inv = []; SO.chats.clear(); close(); connect(); } else if (SO.up) hello();
  badge();
}
// srv2: after sign-in / sign-out / delete the device plays as another account: reconnect so the server tags the socket anew
export function socialRestart() { SO.me = null; SO.fr = []; SO.inq = []; SO.outq = []; SO.bl = []; SO.inv = []; SO.chats.clear(); SO._shop = null; close(); SO.tries = 0; connect(); badge(); }
function close() { clearTimeout(SO._rt); if (SO.ws) { SO.ws.onclose = null; try { SO.ws.close(1000); } catch (_) {} } SO.ws = null; SO.up = false; }
function connect() {
  clearTimeout(SO._rt); if (!SO.pk) return; let ws; try { ws = new WebSocket(WS_URL + "?pk=" + SO.pk); } catch (_) { retry(); return; } SO.ws = ws;
  const to = setTimeout(() => { if (ws.readyState !== 1) try { ws.close(); } catch (_) {} }, 8000);
  ws.onopen = () => { clearTimeout(to); SO.up = true; SO.tries = 0; stopPoll(); hello(); status(SO.st, true); clearInterval(SO._ping); SO._ping = setInterval(() => { if (SO.up) try { ws.send('{"t":"ping"}'); } catch (_) {} }, 45000); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onMsg(m); };
  ws.onclose = (e) => { clearTimeout(to); clearInterval(SO._ping); SO.up = false; SO.ws = null; for (const [, w] of SO.wait) w.res({ err: "offline" }); SO.wait.clear(); if (e.code === 4009 || e.code === 4010) return; retry(); };
  ws.onerror = () => {};
}
function retry() { SO.tries++; const d = Math.min(30000, 1000 * 2 ** Math.min(5, SO.tries - 1)) * (0.8 + Math.random() * 0.4); SO._rt = setTimeout(connect, d); startPoll(); } // 1, 2, 4, 8, 16, 30 s
function startPoll() { if (SO._poll) return; SO._poll = setInterval(() => { if (!SO.up) refresh(); }, 30000); } // fallback only while the socket is down
function stopPoll() { clearInterval(SO._poll); SO._poll = 0; }
async function hello() { const p = SO.ui.p, r = await call("hello", { n: p.name, av: p.av, fr: p.frame, lv: SO.ui.S.level() }); if (r && r.me) setMe(r.me); if (r && r.rn && p.name !== r.rn) { p.name = r.rn; SO.ui.S.save(); } refresh(); } // srv2: rn = name set by the owner
function setMe(me) { SO.me = me; const p = SO.ui.p; if (me && me.id && p.uid !== me.id) { p.uid = me.id; SO.ui.S.save(); } }
export function status(st, force) { if (!force && SO.st === st) return; SO.st = st; if (SO.up) try { SO.ws.send(JSON.stringify({ t: "st", s: st })); } catch (_) {} }
export function call(op, args = {}) {
  if (SO.up && SO.ws) return new Promise((res) => { const i = SO.seq++, t0 = performance.now(); const tm = setTimeout(() => { SO.wait.delete(i); res({ err: "offline" }); }, 8000);
    SO.wait.set(i, { res: (r) => { clearTimeout(tm); SO.lat.push(performance.now() - t0); if (SO.lat.length > 20) SO.lat.shift(); res(r); } }); try { SO.ws.send(JSON.stringify({ t: "op", i, op, ...args })); } catch (_) { clearTimeout(tm); SO.wait.delete(i); res({ err: "offline" }); } });
  return fetch(HTTP_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pk: SO.pk, op, ...args }) }).then((r) => r.json()).catch(() => ({ err: "offline" }));
}
async function refresh() { const r = await call("list"); if (!r || r.err) return r; SO.lastList = Date.now(); if (r.me) setMe(r.me); SO.fr = r.fr || []; SO.inq = r.inq || []; SO.outq = r.outq || []; SO.bl = r.bl || []; SO.inv = (r.inv || []).filter((x) => x.from); badge(); rerender(); return r; }
function onMsg(m) {
  if (m.t === "r") { const w = SO.wait.get(m.i); if (w) { SO.wait.delete(m.i); w.res(m); } return; }
  if (m.t === "hi") { if (m.me) setMe(m.me); try { setCfg(m.cfg, !!(m.me && m.me.own)); } catch (e) { console.warn("cfg", e); } // admin2: owner config (announcement, maintenance, modes, prices)
    walletOnline(m.w).catch(() => {}); if (Array.isArray(m.chr)) m.chr.forEach((x, i) => setTimeout(() => chrNote(x), 600 + i * 3400)); /* grow1: challenge results that waited */ // coin1: the hello carries the wallet
    if (SO.onAcct) try { SO.onAcct(m); } catch (e) { console.warn("acct", e); } return; } // srv2: account status, ban, pending grants
  if (m.t !== "ev") return; const ui = SO.ui, nm = (c) => (c && c.n) || "?";
  if (m.k === "wal") { walletPush(m); return; } // coin1: an online life paid by the room
  if (m.k === "cfg") { setCfg(m.cfg); return; } if (m.k === "adm") { if (m.me) setMe(m.me); admSet(m); try { ui && ui.coins && ui.coins(ui.p.coins); } catch (_) {} return; } // admin2
  if (["grant", "ban", "unban", "mute", "unmute", "rname", "snap", "gone"].includes(m.k)) { if (SO.onAcctEv) try { SO.onAcctEv(m); } catch (e) { console.warn("acct", e); } return; } // srv2
  if (m.k === "chr") { chrNote(m); return; } // grow1: a friend played your challenge link
  if (m.k === "req") { if (!SO.inq.some((x) => x.id === m.from.id)) SO.inq.unshift(m.from); notify("👤", t("so_reqIn", { n: nm(m.from) }), "req"); }
  else if (m.k === "acc") { SO.outq = SO.outq.filter((x) => x.id !== m.from.id); if (!SO.fr.some((x) => x.id === m.from.id)) SO.fr.push({ ...m.from, un: 0 }); notify("🤝", t("so_accIn", { n: nm(m.from) }), "acc"); }
  else if (m.k === "rem") { SO.fr = SO.fr.filter((x) => x.id !== m.id); SO.chats.delete(m.id); }
  else if (m.k === "pres") { const f = SO.fr.find((x) => x.id === m.id); if (f) f.st = m.st; }
  else if (m.k === "msg") { const id = m.from.id, L = SO.chats.get(id); if (L) { L.push(m.m); if (L.length > 100) L.splice(0, L.length - 100); }
    const f = SO.fr.find((x) => x.id === id); if (SO.open === id && !$("m-chat").classList.contains("x-hide")) { if (!L) SO.chats.set(id, [m.m]); call("read", { id }); drawChat(ui, id); } else { if (f) f.un = (f.un | 0) + 1; notify("💬", nm(m.from) + ": " + m.m.tx, "msg"); } }
  else if (m.k === "inv") { SO.inv = SO.inv.filter((x) => x.from.id !== m.from.id); SO.inv.push({ from: m.from, room: m.room, t: m.at || Date.now() }); inviteIn(m.from, m.room); }
  else if (m.k === "invr") { if (m.ok) ui.toast("✓ " + t("so_invJoined", { n: nm(m.from) }), "good", 3500); else ui.toast(t("so_invNo", { n: nm(m.from) }), "", 3000); }
  badge(); rerender();
}
const chrNote = (m) => notify(m.w ? "🏆" : "⚔️", t(m.w ? "chResW" : "chResL", { n: m.n, a: fmtNum(m.s), b: fmtNum(m.my) }), "msg"); // grow1 (strings in grow.js)
function notify(ic, msg, kind) { const ui = SO.ui; ui.toast(ic + " " + msg, kind === "msg" ? "" : "good", 3200); if (kind === "msg") ui.note(msg, ic); }
export function unreadTotal() { return SO.inq.length + SO.fr.reduce((a, f) => a + (f.un | 0), 0) + SO.inv.filter((x) => Date.now() - x.t < 120000).length; }
function badge() { const b = $("l-fbdg"); if (!b) return; const n = unreadTotal(); b.textContent = n > 99 ? "99+" : n; b.classList.toggle("x-hide", !n); }
function rerender() { const ui = SO.ui; if (ui && ui.cur === "friends") renderFriends(ui); if (ui && ui.cur === "custom" && ui.cTab === "ids" && SO._shop) renderIds(ui, $("c-content"), true); }
const copyId = async (id) => { try { await navigator.clipboard.writeText(String(id)); SO.ui.toast("✓ " + t("so_copied", { n: id }), "good", 1800); } catch (_) { SO.ui.toast("ID " + id, "", 4000); } };
export const errText = (e) => t("so_e_" + e) !== "so_e_" + e ? t("so_e_" + e) : t("so_e_offline");
const stLabel = (st) => (st === "match" ? t("so_inMatch") : st === "lobby" ? t("so_inLobby") : t("so_offline"));
const idTag = (id) => pidHtml(id); // srv2: premium ids get their tier style

// ---------- DOM: lobby button, Friends screen, chat, invite popup, player card, players-in-match list ----------
function injectDom(ui) {
  if ($("s-friends")) return;
  const bell = $("l-bell"); if (bell) { const b = document.createElement("button"); b.className = "icon-btn"; b.id = "l-friends"; b.dataset.ia = "so_friends"; b.setAttribute("aria-label", t("so_friends")); b.innerHTML = IC.ppl + '<i class="badge x-hide" id="l-fbdg">0</i>'; bell.parentNode.insertBefore(b, bell); ui.click(b, () => { SO.tab = SO.inq.length && !SO.fr.some((f) => f.un) ? "rq" : "fr"; ui.go("friends"); }); }
  const sec = document.createElement("section"); sec.id = "s-friends"; sec.className = "screen panel";
  sec.innerHTML = `<header class="phead"><button class="icon-btn back" id="fr-back" data-ia="back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><h2 data-i="so_friends"></h2>
    <div class="seg tabs" id="fr-tabs"><button data-v="fr" class="on" data-i="so_friends"></button><button data-v="rq" data-i="so_requests"></button><button data-v="add" data-i="so_add"></button><button data-v="bl" data-i="so_blocked"></button></div><div class="sp"></div></header>
    <div class="pbody"><div class="pcontent wide" id="fr-content"></div></div>`;
  const lobby = $("s-lobby"); lobby.parentNode.insertBefore(sec, lobby.nextSibling);
  for (const [id, cls] of [["m-chat", "so-chat"], ["m-invite", "so-inv"], ["m-pcard", "so-pc"], ["m-players", "so-pl"]]) { const m = document.createElement("div"); m.id = id; m.className = "modal x-hide"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.innerHTML = `<div class="glass mcard ${cls}" id="${id}-c"></div>`; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m) hideModal(id); }); }
  ui.click($("fr-back"), () => { SO.open = ""; ui.go("lobby", "fade"); }, "back");
  $("fr-tabs").querySelectorAll("button").forEach((b) => ui.click(b, () => { SO.tab = b.dataset.v; renderFriends(ui); }, "tab"));
  // pause menu (online): who is in this match -> player card
  const pq = $("pz-quit"); if (pq) { const b = document.createElement("button"); b.className = "btn wide x-hide"; b.id = "pz-players"; b.dataset.i = "so_players"; b.textContent = t("so_players"); pq.parentNode.insertBefore(b, pq); ui.click(b, () => openPlayers(ui)); }
  sec.querySelectorAll("[data-i]").forEach((el) => (el.textContent = t(el.dataset.i)));
}
function hideModal(id) { const m = $(id); if (m) m.classList.add("x-hide"); if (id === "m-chat") SO.open = ""; }
export function pauseHook(online) { const b = $("pz-players"); if (b) { b.textContent = t("so_players"); b.classList.toggle("x-hide", !online); } }

// ---------- Friends screen ----------
export function renderFriends(ui) {
  const el = $("fr-content"); if (!el) return; const tab = SO.tab || "fr"; ui.coins && 0;
  $("fr-tabs").querySelectorAll("button").forEach((x) => { x.classList.toggle("on", x.dataset.v === tab); const n = x.dataset.v === "rq" ? SO.inq.length : x.dataset.v === "fr" ? SO.fr.reduce((a, f) => a + (f.un | 0), 0) : 0; x.innerHTML = esc(t(x.dataset.i)) + (n ? ` <i class="so-n">${n}</i>` : ""); });
  if (Date.now() - SO.lastList > 15000 && !SO._ref) { SO._ref = 1; refresh().finally(() => (SO._ref = 0)); }
  const off = !SO.up && !SO.me ? `<div class="so-off fine">${t("so_e_offline")}</div>` : "";
  const row = (c, acts, sub) => `<div class="so-row" data-id="${esc(c.id)}">${avatarHtml(c.av || "p0", c.fr | 0, "m")}<div class="so-who"><b dir="auto">${esc(c.n)}${c.own ? ` <em class="so-own">★</em>` : ""}</b><small>${idTag(c.id)}${sub ? " · " + sub : ""}</small></div><div class="so-acts">${acts}</div></div>`;
  let h = off;
  const invs = SO.inv.filter((x) => Date.now() - x.t < 120000);
  if (tab === "fr") {
    if (invs.length) h += `<div class="pv-card"><div class="pv-h">${t("so_invites")}</div>` + invs.map((x) => row(x.from, `<button class="btn gold so-b" data-join="${esc(x.from.id)}">${IC.play}<span>${t("so_join")}</span></button>`, t("so_invYou"))).join("") + `</div>`;
    const L = SO.fr.slice().sort((a, b) => ((b.st !== "off") - (a.st !== "off")) || (b.un | 0) - (a.un | 0) || String(a.n).localeCompare(b.n));
    h += `<div class="pv-card"><div class="pv-h">${t("so_friends")} · ${L.length}<span class="so-me">${SO.me ? t("so_yourId") + " " + idTag(SO.me.id) + ` <button class="so-copy" data-copy="${esc(SO.me.id)}" aria-label="${t("so_copy")}">${IC.copy}</button>` : ""}</span></div>` +
      (L.length ? L.map((f) => row(f, `<button class="btn so-b" data-chat="${esc(f.id)}" aria-label="${t("so_chat")}">${IC.chat}<span>${t("so_chat")}</span>${f.un ? `<i class="so-n">${f.un}</i>` : ""}</button><button class="btn gold so-b" data-inv="${esc(f.id)}" aria-label="${t("so_invite")}">${IC.play}<span>${t("so_invite")}</span></button><button class="icon-btn so-i" data-card="${esc(f.id)}" aria-label="${t("so_more")}">${IC.more}</button>`, `<span class="so-st ${f.st || "off"}"><i></i>${stLabel(f.st)}</span>`)).join("")
        : `<div class="so-empty"><p>${t("so_noFriends")}</p><button class="btn gold so-b" data-tab="add">${t("so_addFriend")}</button></div>`) + `</div>`;
  } else if (tab === "rq") {
    h += `<div class="pv-card"><div class="pv-h">${t("so_incoming")} · ${SO.inq.length}</div>` + (SO.inq.length ? SO.inq.map((c) => row(c, `<button class="btn gold so-b" data-acc="${esc(c.id)}">${t("so_accept")}</button><button class="btn so-b" data-dec="${esc(c.id)}">${t("so_decline")}</button>`, t("level") + " " + (c.lv | 0))).join("") : `<p class="fine">${t("so_noReq")}</p>`) + `</div>`;
    h += `<div class="pv-card"><div class="pv-h">${t("so_outgoing")} · ${SO.outq.length}</div>` + (SO.outq.length ? SO.outq.map((c) => row(c, `<button class="btn so-b" data-dec="${esc(c.id)}">${t("so_cancel")}</button>`, t("so_pending"))).join("") : `<p class="fine">${t("so_noOut")}</p>`) + `</div>`;
  } else if (tab === "add") {
    h += `<div class="pv-card so-add"><div class="pv-h">${t("so_yourId")}</div><div class="so-myid">${SO.me ? pidBig(SO.me.id) : '<b dir="ltr">…</b>'}${SO.me ? `<button class="btn so-b" data-copy="${esc(SO.me.id)}">${IC.copy}<span>${t("so_copy")}</span></button>` : ""}</div><p class="fine">${t("so_shareId")}</p></div>
      <div class="pv-card"><div class="pv-h">${t("so_findById")}</div><form class="so-find" id="so-find"><input id="so-q" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="off" dir="ltr" placeholder="${t("so_idPh")}" value="${esc(SO.q || "")}"><button class="btn gold so-b" type="submit">${t("search")}</button></form><div id="so-res">${SO.res ? resCard(SO.res) : ""}</div></div>`;
  } else {
    h += `<div class="pv-card"><div class="pv-h">${t("so_blocked")} · ${SO.bl.length}</div>` + (SO.bl.length ? SO.bl.map((c) => row(c, `<button class="btn so-b" data-unb="${esc(c.id)}">${t("so_unblock")}</button>`)).join("") : `<p class="fine">${t("so_noBlocked")}</p>`) + `</div>`;
  }
  el.innerHTML = h; bindActs(ui, el);
  const f = $("so-find"); if (f) { const q = $("so-q"); q.addEventListener("input", () => { q.value = q.value.replace(/\D/g, "").slice(0, 7); SO.q = q.value; }); f.addEventListener("submit", async (e) => { e.preventDefault(); const id = q.value.trim(); if (!id) return; const r = await call("find", { id }); SO.res = r.card ? r.card : { err: r.err || "offline" }; const box = $("so-res"); if (box) { box.innerHTML = resCard(SO.res); bindActs(ui, box); } }); }
}
function resCard(c) { if (c.err) return `<p class="so-err">${esc(errText(c.err))}</p>`; const rel = c.rel;
  const act = rel === "fr" ? `<span class="fine">✓ ${t("so_isFriend")}</span>` : rel === "out" ? `<span class="fine">${t("so_pending")}</span>` : rel === "in" ? `<button class="btn gold so-b" data-acc="${esc(c.id)}">${t("so_accept")}</button>` : rel === "bl" ? `<button class="btn so-b" data-unb="${esc(c.id)}">${t("so_unblock")}</button>` : `<button class="btn gold so-b" data-req="${esc(c.id)}">${t("so_addFriend")}</button>`;
  return `<div class="so-row">${avatarHtml(c.av || "p0", c.fr | 0, "m")}<div class="so-who"><b dir="auto">${esc(c.n)}</b><small>${idTag(c.id)} · ${t("level")} ${c.lv | 0}</small></div><div class="so-acts">${act}</div></div>`; }
function bindActs(ui, el) {
  const on = (sel, fn, snd) => el.querySelectorAll(sel).forEach((b) => ui.click(b, (e) => { e.stopPropagation(); fn(b); }, snd || "tab"));
  on("[data-copy]", (b) => copyId(b.dataset.copy));
  on("[data-tab]", (b) => { SO.tab = b.dataset.tab; renderFriends(ui); });
  on("[data-chat]", (b) => openChat(ui, b.dataset.chat));
  on("[data-inv]", (b) => invite(ui, b.dataset.inv));
  on("[data-card]", (b) => openCard(ui, { uid: b.dataset.card }));
  on("[data-join]", (b) => joinInvite(ui, b.dataset.join, true));
  on("[data-req]", (b) => act(ui, "req", b.dataset.req, b));
  on("[data-acc]", (b) => act(ui, "acc", b.dataset.acc, b));
  on("[data-dec]", (b) => act(ui, "dec", b.dataset.dec, b));
  on("[data-unb]", (b) => act(ui, "unb", b.dataset.unb, b));
}
async function act(ui, op, id, btn) {
  if (btn) btn.disabled = true; const r = await call(op, { id }); if (btn) btn.disabled = false;
  if (!r || r.err) { ui.toast(errText(r && r.err), "warn"); return r; }
  const msg = { req: t("so_reqSent"), acc: t("so_nowFriends"), dec: "", rem: t("so_removed"), blk: t("so_blockedT"), unb: t("so_unblocked") }[op]; if (msg) ui.toast("✓ " + msg, "good", 2200);
  if (SO.res && SO.res.id === id) SO.res.rel = op === "req" ? (r.card ? "fr" : "out") : op === "acc" ? "fr" : op === "unb" ? "" : SO.res.rel;
  await refresh(); return r;
}

// ---------- chat ----------
async function openChat(ui, id) {
  SO.open = id; const m = $("m-chat"), c = $("m-chat-c"); m.classList.remove("x-hide"); const f = SO.fr.find((x) => x.id === id) || { id, n: "…" };
  c.innerHTML = `<div class="so-ch"><button class="icon-btn" id="ch-x" aria-label="${t("back")}">${IC.x}</button>${avatarHtml(f.av || "p0", f.fr | 0, "s")}<div class="so-who"><b dir="auto">${esc(f.n)}</b><small>${idTag(id)} · <span class="so-st ${f.st || "off"}"><i></i>${stLabel(f.st)}</span></small></div><button class="btn gold so-b" id="ch-inv">${IC.play}<span>${t("so_invite")}</span></button></div>
    <div class="so-msgs" id="ch-list" aria-live="polite"><p class="fine">${t("loading")}…</p></div>
    <div class="so-emo" id="ch-emo">${EMOTES.map((e, i) => `<button class="so-e ${e.length > 2 ? "txt" : ""}" data-e="${i}">${e}</button>`).join("")}</div>
    <form class="so-in" id="ch-form"><input id="ch-tx" maxlength="${MSG_MAX}" autocomplete="off" dir="auto" enterkeyhint="send" placeholder="${t("so_msgPh")}"><small id="ch-cnt" dir="ltr">0/${MSG_MAX}</small><button class="btn gold so-b" type="submit" aria-label="${t("so_send")}">${IC.send}</button></form>`;
  ui.click($("ch-x"), () => hideModal("m-chat"), "back"); ui.click($("ch-inv"), () => invite(ui, id));
  const tx = $("ch-tx"), cnt = $("ch-cnt"); tx.addEventListener("input", () => (cnt.textContent = [...tx.value].length + "/" + MSG_MAX));
  c.querySelectorAll("[data-e]").forEach((b) => ui.click(b, () => { const e = EMOTES[+b.dataset.e]; if ([...(tx.value + e)].length <= MSG_MAX) { tx.value += (tx.value && !/\s$/.test(tx.value) && e.length > 2 ? " " : "") + e; tx.dispatchEvent(new Event("input")); } tx.focus(); }, "tab"));
  $("ch-form").addEventListener("submit", async (e) => { e.preventDefault(); const v = tx.value.trim(); if (!v) return; tx.value = ""; cnt.textContent = "0/" + MSG_MAX; const r = await call("send", { id, tx: v });
    if (!r || r.err) { ui.toast(errText(r && r.err), "warn"); if (r && r.err !== "notfriend") tx.value = v; return; } const L = SO.chats.get(id) || []; L.push(r.m); SO.chats.set(id, L); if (r.filt) ui.toast(t("so_filtered"), "", 2600); drawChat(ui, id); });
  const r = await call("msgs", { id }); if (SO.open !== id) return; if (!r || r.err) { $("ch-list").innerHTML = `<p class="so-err">${esc(errText(r && r.err))}</p>`; return; }
  SO.chats.set(id, r.list); if (f) f.un = 0; badge(); drawChat(ui, id);
}
function drawChat(ui, id) {
  const box = $("ch-list"); if (!box || SO.open !== id) return; const L = SO.chats.get(id) || [];
  const tm = (x) => new Date(x).toLocaleTimeString(LANG === "ar" ? "ar-u-nu-latn" : LANG, { hour: "2-digit", minute: "2-digit" });
  box.innerHTML = L.length ? L.map((m) => `<div class="so-m ${m.me ? "me" : "them"}"><p dir="auto">${esc(m.tx)}</p><small>${tm(m.t)}${m.me ? "" : ` <button class="so-rep" data-rep="${m.i}" aria-label="${t("so_report")}">${IC.flag}</button>`}</small></div>`).join("") : `<p class="fine so-empty">${t("so_noMsgs")}</p>`;
  box.scrollTop = box.scrollHeight;
  box.querySelectorAll("[data-rep]").forEach((b) => ui.click(b, async () => { if (!(await ui.confirm(t("so_reportQ")))) return; const r = await call("rep", { id, mid: +b.dataset.rep }); ui.toast(r && r.ok ? "✓ " + t("so_reported") : errText(r && r.err), r && r.ok ? "good" : "warn"); }, "tab"));
}

// ---------- invites ----------
function inviteIn(from, room) {
  const ui = SO.ui, G = ui.app.game, inMatch = G && G.running && G.mode !== "show" && G.mode !== "attract" && !G.ended;
  ui.note(t("so_invFrom", { n: from.n }), "🎮");
  if (inMatch) { ui.toast("🎮 " + t("so_invFrom", { n: from.n }), "good", 4000); return; } // never pop over a running match; it waits in Friends
  const c = $("m-invite-c"); $("m-invite").classList.remove("x-hide");
  c.innerHTML = `<div class="so-ivh">${avatarHtml(from.av || "p0", from.fr | 0, "l")}<div><h2 dir="auto">${esc(t("so_invFrom", { n: from.n }))}</h2><p class="fine">${idTag(from.id)} · ${t("so_invRoom")}</p></div></div>
    <div class="so-ivb"><button class="btn ghost so-b" id="iv-no">${t("so_notNow")}</button><button class="btn gold so-b" id="iv-yes">${IC.play}<span>${t("so_join")}</span></button></div>`;
  ui.click($("iv-yes"), () => joinInvite(ui, from.id, true), "go"); ui.click($("iv-no"), () => joinInvite(ui, from.id, false), "back");
  clearTimeout(SO._ivT); SO._ivT = setTimeout(() => $("m-invite").classList.add("x-hide"), 60000);
}
async function joinInvite(ui, fromId, yes) {
  $("m-invite").classList.add("x-hide"); const r = await call("invr", { id: fromId, ok: yes ? 1 : 0 }); SO.inv = SO.inv.filter((x) => x.from.id !== fromId); badge();
  if (!yes) { rerender(); return; } if (!r || r.err) { ui.toast(errText(r && r.err), "warn"); rerender(); return; } goRoom(ui, r.room);
}
async function invite(ui, id) {
  const G = ui.app.game, b = G && G.backend, inOnline = G && G.mode === "online" && G.running && !G.ended && b && b.room;
  const r = await call("inv", { id, room: inOnline ? b.room : "" }); if (!r || r.err) { ui.toast(errText(r && r.err), "warn"); return; }
  const f = SO.fr.find((x) => x.id === id), n = f ? f.n : id; ui.toast("✓ " + t(r.st === "off" ? "so_invSentOff" : "so_invSent", { n }), "good", 3500);
  if (!inOnline) { hideModal("m-chat"); hideModal("m-pcard"); setTimeout(() => goRoom(ui, r.room), 500); } // the inviter goes into the room and waits there
}
function goRoom(ui, room) {
  const A = ui.app, p = ui.p; ["m-chat", "m-pcard", "m-players", "m-pause", "m-results"].forEach((x) => $(x) && $(x).classList.add("x-hide"));
  if (A.game.running && A.game.mode !== "show" && A.game.mode !== "attract") A.game.stopMatch();
  ui.selMode = "online"; p.last.mode = "online"; p.last.room = room; ui.S.save(); if (!p.tut) { p.tut = 1; ui.S.save(); }
  ui.launch({ mode: "online", world: ui.S.unlocked("world", p.last.world) ? p.last.world : 0, diff: p.last.diff, room });
}

// ---------- player card (friends list, in-match players list) ----------
async function openCard(ui, o) {
  const m = $("m-pcard"), c = $("m-pcard-c"); m.classList.remove("x-hide");
  const close = `<button class="icon-btn so-x" id="pc-x" aria-label="${t("back")}">${IC.x}</button>`;
  if (o.bot) { c.innerHTML = `${close}<div class="so-pch">${avatarHtml(o.av || "p0", o.fr | 0, "l")}<div><h2 dir="auto">${esc(o.name)}</h2><span class="so-ai">🤖 ${t("so_ai")}</span></div></div><p class="fine">${t("so_aiInfo")}</p>`; ui.click($("pc-x"), () => hideModal("m-pcard"), "back"); return; }
  c.innerHTML = `${close}<p class="fine">${t("loading")}…</p>`; ui.click($("pc-x"), () => hideModal("m-pcard"), "back");
  if (!o.uid) { c.innerHTML = `${close}<div class="so-pch">${avatarHtml(o.av || "p0", o.fr | 0, "l")}<div><h2 dir="auto">${esc(o.name)}</h2></div></div><p class="fine">${t("so_noId")}</p>`; ui.click($("pc-x"), () => hideModal("m-pcard"), "back"); return; }
  const r = SO.me && o.uid === SO.me.id ? { self: 1 } : await call("find", { id: o.uid }); if (m.classList.contains("x-hide")) return;
  if (r.self) { c.innerHTML = `${close}<div class="so-pch">${avatarHtml(ui.p.av, ui.p.frame, "l")}<div><h2 dir="auto">${esc(ui.p.name)} <em class="fine">· ${t("you")}</em></h2>${idTag(o.uid)} <button class="so-copy" data-copy="${esc(o.uid)}" aria-label="${t("so_copy")}">${IC.copy}</button></div></div>`; bindActs(ui, c); ui.click($("pc-x"), () => hideModal("m-pcard"), "back"); return; }
  if (!r.card) { c.innerHTML = `${close}<p class="so-err">${esc(errText(r.err))}</p>`; ui.click($("pc-x"), () => hideModal("m-pcard"), "back"); return; }
  const k = r.card, fr = SO.fr.find((x) => x.id === k.id), rel = fr ? "fr" : k.rel;
  const main = rel === "fr" ? `<button class="btn so-b" data-chat="${esc(k.id)}">${IC.chat}<span>${t("so_chat")}</span></button><button class="btn gold so-b" data-inv="${esc(k.id)}">${IC.play}<span>${t("so_invite")}</span></button>`
    : rel === "out" ? `<span class="fine">${t("so_pending")}</span>` : rel === "in" ? `<button class="btn gold so-b" data-acc="${esc(k.id)}">${t("so_accept")}</button>` : rel === "bl" ? `<button class="btn so-b" data-unb="${esc(k.id)}">${t("so_unblock")}</button>` : `<button class="btn gold so-b" data-req="${esc(k.id)}">${t("so_addFriend")}</button>`;
  c.innerHTML = `${close}<div class="so-pch">${avatarHtml(k.av || "p0", k.fr | 0, "l")}<div><h2 dir="auto">${esc(k.n)}${k.own ? ` <em class="so-own">★ ${t("ti_owner")}</em>` : ""}</h2><div>${idTag(k.id)} <button class="so-copy" data-copy="${esc(k.id)}" aria-label="${t("so_copy")}">${IC.copy}</button></div><small class="fine">${t("level")} ${k.lv | 0}${fr ? ` · <span class="so-st ${fr.st || "off"}"><i></i>${stLabel(fr.st)}</span>` : ""}</small></div></div>
    <div class="so-pca">${main}</div><div class="so-pca sec">${rel === "fr" ? `<button class="btn ghost so-b" data-rem="${esc(k.id)}">${t("so_remove")}</button>` : ""}${rel !== "bl" ? `<button class="btn ghost so-b warn" data-blk="${esc(k.id)}">${t("so_block")}</button>` : ""}</div>`;
  bindActs(ui, c);
  c.querySelectorAll("[data-req],[data-acc],[data-unb]").forEach((b) => b.addEventListener("click", () => setTimeout(() => openCard(ui, o), 400)));
  c.querySelectorAll("[data-chat],[data-inv]").forEach((b) => b.addEventListener("click", () => hideModal("m-pcard")));
  c.querySelectorAll("[data-rem]").forEach((b) => ui.click(b, async () => { if (!(await ui.confirm(t("so_removeQ", { n: k.n })))) return; await act(ui, "rem", k.id); hideModal("m-pcard"); }));
  c.querySelectorAll("[data-blk]").forEach((b) => ui.click(b, async () => { if (!(await ui.confirm(t("so_blockQ", { n: k.n })))) return; await act(ui, "blk", k.id); hideModal("m-pcard"); }));
}
function openPlayers(ui) {
  const b = ui.app.game.backend; if (!b || !b.mirrors) return; const m = $("m-players"), c = $("m-players-c"); m.classList.remove("x-hide");
  const L = [...b.mirrors.values()].map((mr) => mr.s).filter((s) => s.alive).sort((x, y) => (x.bot - y.bot) || y.m - x.m).slice(0, 30);
  c.innerHTML = `<div class="so-ch"><h2>${t("so_players")}</h2><div class="sp"></div><button class="icon-btn" id="pl-x" aria-label="${t("back")}">${IC.x}</button></div><div class="so-pls">` +
    (L.length ? L.map((s, i) => `<button class="so-row so-pr" data-pi="${i}">${avatarHtml(s.avt || "p0", s.fr | 0, "s")}<div class="so-who"><b dir="auto">${esc(s.name)}</b><small>${s.bot ? "🤖 " + t("so_ai") : s.uid ? idTag(s.uid) : t("so_player")}</small></div></button>`).join("") : `<p class="fine">${t("so_alone")}</p>`) + `</div>`;
  ui.click($("pl-x"), () => hideModal("m-players"), "back");
  c.querySelectorAll("[data-pi]").forEach((x) => ui.click(x, () => { const s = L[+x.dataset.pi]; hideModal("m-players"); openCard(ui, { bot: s.bot, name: s.name, av: s.avt, fr: s.fr, uid: s.uid || "" }); }, "tab"));
}

// ---------- profile: the ID row (+ the founder's one-time claim) ----------
export function profileIdCard(ui) {
  const p = ui.p, id = (SO.me && SO.me.id) || p.uid || "", claim = p.owner && !(SO.me && SO.me.id === "1");
  return `<div class="pv-card so-pid"><div class="pv-h">${t("so_playerId")}</div><div class="so-myid">${id ? pidBig(id) : '<b dir="ltr">…</b>'}${id ? `<button class="btn so-b" data-copy="${esc(id)}">${IC.copy}<span>${t("so_copy")}</span></button>` : `<span class="fine">${t("so_idSoon")}</span>`}
    <button class="btn so-b" data-goids="1">${t("so_special")}</button></div>${SO.me && SO.me.id !== SO.me.id7 ? `<p class="fine">${t("so_id7")} <span dir="ltr">${esc(SO.me.id7)}</span></p>` : ""}
    ${claim ? `<form class="so-find" id="so-claim"><input id="so-cc" autocomplete="off" dir="ltr" maxlength="40" placeholder="${t("so_claimPh")}"><button class="btn gold so-b" type="submit">${t("so_claim")}</button></form>` : ""}</div>`;
}
export function bindProfileId(ui, el) {
  bindActs(ui, el); el.querySelectorAll("[data-goids]").forEach((b) => ui.click(b, () => { ui.cTab = "ids"; $("c-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === "ids")); ui.go("custom"); }));
  const f = el.querySelector("#so-claim"); if (f) f.addEventListener("submit", async (e) => { e.preventDefault(); const r = await call("claim1", { code: $("so-cc").value }); if (r && r.ok) { setMe(r.me); ui.toast("★ " + t("so_claimed"), "gold", 4000); ui.renderProfile(); } else ui.toast(errText(r && r.err === "bad" ? "bad_code" : r && r.err), "warn"); });
  if (!SO.me && !SO._meT) { SO._meT = 1; call("me").then((r) => { SO._meT = 0; if (r && r.me) { setMe(r.me); if (ui.cur === "profile" && ui.prTab === "over") ui.renderProfile(); } }); }
}

// ---------- Locker tab: Special IDs ----------
export async function renderIds(ui, el, keep) {
  const p = ui.p; ui.coins(p.coins); const sh = SO._shop;
  const card = (n, sold, kind) => { const mine = SO.me && SO.me.prem.includes(n), pr = idPrice(n), sel = SO.idSel === n;
    return `<button class="item lk2 so-idc k-${kind} ${sold ? (mine ? "on" : "lock") : ""} ${sel ? "sel" : ""}" data-id5="${n}" ${sold && !mine ? 'aria-disabled="true"' : ""}><div class="sw so-idsw"><b dir="ltr">${n}</b></div><div class="meta"><b>${t("so_k_" + kind)}</b></div>${mine ? `<small class="st on">✓ ${t("so_yours")}</small>` : sold ? `<small class="st lk">${t("so_sold")}</small>` : `<small class="st buy${sel ? " go" : ""}">${sel ? t("buy", { n: "" }).trim() + " · " : ""}<span class="coin"></span>${fmtNum(pr)}</small>`}</button>`; };
  const cur = (SO.me && SO.me.id) || p.uid || "…";
  let h = `<div class="lk-head"><h4 class="sub">${t("so_special")}</h4></div><p class="gt-sub">${t("so_specialSub")}</p><div class="so-cur pv-card"><span>${t("so_yourId")}</span>${pidBig(cur)}${SO.me ? `<button class="btn so-b" data-copy="${esc(cur)}">${IC.copy}<span>${t("so_copy")}</span></button>` : ""}</div>
    <form class="so-find" id="so-idq"><input id="so-n5" inputmode="numeric" pattern="[0-9]*" maxlength="5" dir="ltr" autocomplete="off" placeholder="${t("so_pick5")}" value="${esc(SO.n5 || "")}"><button class="btn so-b" type="submit">${t("so_check")}</button></form><div id="so-chk">${SO.chk ? chkHtml(SO.chk, card) : ""}</div>`;
  if (!sh) h += `<p class="fine">${t("loading")}…</p>`;
  else if (sh.err) h += `<p class="so-err">${esc(errText(sh.err))}</p>`;
  else h += [["rep", sh.rep], ["seq", sh.seq], ["std", sh.std.map((n) => ({ n, s: 0 }))]].map(([k, L]) => `<div class="lk-head"><h4 class="sub">${t("so_k_" + k)} · <span class="coin"></span>${fmtNum(sh.prices[k])}</h4></div><div class="grid so-idg">` + L.map((x) => card(x.n, x.s, k)).join("") + `</div>`).join("");
  el.innerHTML = h; bindActs(ui, el);
  el.querySelectorAll("[data-id5]").forEach((b) => ui.click(b, () => pickId(ui, b.dataset.id5, b), "tab"));
  const f = $("so-idq"); if (f) { const q = $("so-n5"); q.addEventListener("input", () => { q.value = q.value.replace(/\D/g, "").slice(0, 5); SO.n5 = q.value; }); f.addEventListener("submit", async (e) => { e.preventDefault(); const n = q.value; if (!idKind(n)) { ui.toast(t("so_e_bad"), "warn"); return; } const r = await call("chk", { n }); SO.chk = r; renderIds(ui, el, true); }); }
  const info = $("c-info"); if (info) info.innerHTML = `<div class="so-info"><b>${t("so_special")}</b><p class="fine">${t("so_specialInfo")}</p><div class="so-tiers"><span><b dir="ltr">11111</b> ◆${fmtNum(sh && sh.prices ? sh.prices.rep : idPrice("11111"))}</span><span><b dir="ltr">12345</b> ◆${fmtNum(sh && sh.prices ? sh.prices.seq : idPrice("12345"))}</span><span><b dir="ltr">48213</b> ◆${fmtNum(sh && sh.prices ? sh.prices.std : idPrice("48213"))}</span></div></div>`;
  if (!keep || !sh || Date.now() - (SO._shopT || 0) > 30000) { SO._shopT = Date.now(); const r = await call("shop"); SO._shop = r && !r.err ? r : { err: (r && r.err) || "offline" }; if (r && r.me) setMe(r.me); if (ui.cur === "custom" && ui.cTab === "ids") renderIds(ui, $("c-content"), true); }
}
function chkHtml(r, card) { if (!r || r.err) return `<p class="so-err">${esc(errText(r && r.err))}</p>`; return `<div class="grid so-idg">${card(r.n, r.sold, r.kind)}</div>`; }
async function pickId(ui, n, btn) {
  const mine = SO.me && SO.me.prem.includes(n); if (mine) { ui.toast("✓ " + t("so_yours"), ""); return; }
  if (SO.idSel !== n) { SO.idSel = n; renderIds(ui, $("c-content"), true); return; } // first tap selects, second buys (same as the trail shop)
  await buyId(ui, n, btn);
}
export async function buyId(ui, n, btn) { // coin1: one server transaction decides who gets the id AND takes its coins
  const S = ui.S, p = ui.p, price = idPrice(n); if (!price) return "bad";
  if (p.coins < price) { ui.buyResult("noCoins"); return "noCoins"; }
  if (SO._buying) return "busy"; SO._buying = true;
  try {
    const r = await S.buySpecialId(n, price);
    if (!r || !r.ok) { const e = (r && r.err) || "offline";
      if (e === "sold") { ui.toast(t("so_e_sold"), "warn"); SO._shopT = 0; renderIds(ui, $("c-content")); } else if (e === "noCoins" || e === "offline") ui.buyResult(e); else ui.toast(errText(e), "warn"); return e; }
    setMe(r.me); SO.idSel = ""; SO.chk = null;
    const sel = `[data-id5="${n}"]`, tgt = document.querySelector("#c-content " + sel) || btn; ui.buyFx(tgt, sel); ui.toast("✓ " + t("so_bought", { n }), "good", 3500);
    if (SO._shop && !SO._shop.err) for (const L of [SO._shop.rep, SO._shop.seq]) for (const x of L) if (x.n === n) x.s = 1;
    setTimeout(() => { if (ui.cur === "custom" && ui.cTab === "ids") renderIds(ui, $("c-content"), true); }, 650); return "ok";
  } finally { SO._buying = false; }
}

addStrings({
  so_friends: ["Friends", "الأصدقاء", "Arkadaşlar", "Amis", "Amigos", "दोस्त"],
  so_requests: ["Requests", "الطلبات", "İstekler", "Demandes", "Solicitudes", "अनुरोध"],
  so_add: ["Add", "إضافة", "Ekle", "Ajouter", "Añadir", "जोड़ें"],
  so_blocked: ["Blocked", "المحظورون", "Engellenenler", "Bloqués", "Bloqueados", "ब्लॉक किए गए"],
  so_players: ["Players in this match", "اللاعبون بهاي المباراة", "Bu maçtaki oyuncular", "Joueurs de la partie", "Jugadores de la partida", "इस मैच के खिलाड़ी"],
  so_player: ["Player", "لاعب", "Oyuncu", "Joueur", "Jugador", "खिलाड़ी"],
  so_alone: ["No other players right now.", "ماكو لاعبين غيرك هسه.", "Şu an başka oyuncu yok.", "Aucun autre joueur pour l'instant.", "No hay más jugadores ahora.", "अभी कोई और खिलाड़ी नहीं।"],
  so_yourId: ["Your ID", "الآيدي مالك", "Kimliğin", "Ton ID", "Tu ID", "आपकी ID"],
  so_playerId: ["Player ID", "آيدي اللاعب", "Oyuncu kimliği", "ID joueur", "ID de jugador", "खिलाड़ी ID"],
  so_copy: ["Copy", "نسخ", "Kopyala", "Copier", "Copiar", "कॉपी"],
  so_copied: ["ID {n} copied", "انسخ الآيدي {n}", "{n} kopyalandı", "ID {n} copié", "ID {n} copiado", "ID {n} कॉपी हुई"],
  so_idSoon: ["Connect once to get your ID", "اتصل مرة وحدة حتى تاخذ آيدي", "Kimlik için bir kez bağlan", "Connecte-toi une fois pour ton ID", "Conéctate una vez para tu ID", "ID के लिए एक बार कनेक्ट करें"],
  so_id7: ["Your 7-digit ID stays reserved:", "الآيدي السباعي مالك يبقى محجوز:", "7 haneli kimliğin saklı kalır:", "Ton ID à 7 chiffres reste réservé :", "Tu ID de 7 dígitos sigue reservado:", "आपकी 7-अंकीय ID आरक्षित रहती है:"],
  so_chat: ["Chat", "دردشة", "Sohbet", "Discuter", "Chat", "चैट"],
  so_invite: ["Invite", "دعوة", "Davet et", "Inviter", "Invitar", "आमंत्रित"],
  so_more: ["More", "المزيد", "Daha fazla", "Plus", "Más", "और"],
  so_join: ["Join", "انضم", "Katıl", "Rejoindre", "Unirse", "शामिल हों"],
  so_notNow: ["Not now", "مو هسه", "Şimdi değil", "Pas maintenant", "Ahora no", "अभी नहीं"],
  so_invites: ["Invites", "الدعوات", "Davetler", "Invitations", "Invitaciones", "आमंत्रण"],
  so_invYou: ["invited you to play", "دعاك تلعب", "seni oyuna davet etti", "t'invite à jouer", "te invitó a jugar", "ने आपको खेलने बुलाया"],
  so_invFrom: ["{n} invited you to play", "{n} دعاك تلعب", "{n} seni oyuna davet etti", "{n} t'invite à jouer", "{n} te invitó a jugar", "{n} ने आपको खेलने बुलाया"],
  so_invRoom: ["Same online room", "نفس الغرفة أونلاين", "Aynı çevrimiçi oda", "Même salon en ligne", "Misma sala online", "एक ही ऑनलाइन रूम"],
  so_invSent: ["Invite sent to {n}. Joining the room…", "انرسلت الدعوة لـ {n}. داخلين الغرفة…", "{n} davet edildi. Odaya giriliyor…", "Invitation envoyée à {n}. Entrée dans le salon…", "Invitación enviada a {n}. Entrando en la sala…", "{n} को आमंत्रण भेजा। रूम में जा रहे हैं…"],
  so_invSentOff: ["{n} is offline; the invite waits 2 min.", "{n} مو متصل، الدعوة تبقى دقيقتين.", "{n} çevrimdışı; davet 2 dk bekler.", "{n} est hors ligne ; l'invitation attend 2 min.", "{n} no está conectado; la invitación espera 2 min.", "{n} ऑफ़लाइन है; आमंत्रण 2 मिनट रहेगा।"],
  so_invJoined: ["{n} is joining your room", "{n} داخل للغرفة مالتك", "{n} odana katılıyor", "{n} rejoint ton salon", "{n} se une a tu sala", "{n} आपके रूम में आ रहे हैं"],
  so_invNo: ["{n} can't play right now", "{n} ما يكدر يلعب هسه", "{n} şu an oynayamıyor", "{n} ne peut pas jouer", "{n} no puede jugar ahora", "{n} अभी नहीं खेल सकते"],
  so_inMatch: ["In a match", "بمباراة", "Maçta", "En partie", "En partida", "मैच में"],
  so_inLobby: ["In lobby", "بالردهة", "Lobide", "Dans le lobby", "En el lobby", "लॉबी में"],
  so_offline: ["Offline", "غير متصل", "Çevrimdışı", "Hors ligne", "Desconectado", "ऑफ़लाइन"],
  so_noFriends: ["No friends yet. Add someone by their ID.", "ماكو أصدقاء بعد. ضيف واحد بالآيدي مالته.", "Henüz arkadaş yok. Kimlikle birini ekle.", "Pas encore d'amis. Ajoute quelqu'un avec son ID.", "Aún no tienes amigos. Añade a alguien por su ID.", "अभी कोई दोस्त नहीं। ID से जोड़ें।"],
  so_addFriend: ["Add friend", "إضافة صديق", "Arkadaş ekle", "Ajouter en ami", "Añadir amigo", "दोस्त जोड़ें"],
  so_incoming: ["Incoming", "الواردة", "Gelen", "Reçues", "Recibidas", "आने वाले"],
  so_outgoing: ["Sent", "المرسلة", "Gönderilen", "Envoyées", "Enviadas", "भेजे गए"],
  so_noReq: ["No requests.", "ماكو طلبات.", "İstek yok.", "Aucune demande.", "Sin solicitudes.", "कोई अनुरोध नहीं।"],
  so_noOut: ["Nothing pending.", "ماكو شي معلّق.", "Bekleyen yok.", "Rien en attente.", "Nada pendiente.", "कुछ लंबित नहीं।"],
  so_accept: ["Accept", "قبول", "Kabul et", "Accepter", "Aceptar", "स्वीकार"],
  so_decline: ["Decline", "رفض", "Reddet", "Refuser", "Rechazar", "अस्वीकार"],
  so_cancel: ["Cancel", "إلغاء", "İptal", "Annuler", "Cancelar", "रद्द करें"],
  so_pending: ["Request sent", "انرسل الطلب", "İstek gönderildi", "Demande envoyée", "Solicitud enviada", "अनुरोध भेजा"],
  so_shareId: ["Friends add you with this number.", "أصدقائك يضيفوك بهذا الرقم.", "Arkadaşların seni bu numarayla ekler.", "Tes amis t'ajoutent avec ce numéro.", "Tus amigos te añaden con este número.", "दोस्त इस नंबर से आपको जोड़ते हैं।"],
  so_findById: ["Find a player by ID", "دوّر على لاعب بالآيدي", "Kimlikle oyuncu bul", "Trouver un joueur par ID", "Buscar jugador por ID", "ID से खिलाड़ी खोजें"],
  so_idPh: ["Player ID (digits)", "آيدي اللاعب (أرقام)", "Oyuncu kimliği (rakam)", "ID joueur (chiffres)", "ID de jugador (dígitos)", "खिलाड़ी ID (अंक)"],
  so_isFriend: ["Friends", "أصدقاء", "Arkadaşsınız", "Amis", "Amigos", "दोस्त"],
  so_noBlocked: ["Nobody is blocked.", "ماكو أحد محظور.", "Engellenen yok.", "Personne n'est bloqué.", "No hay nadie bloqueado.", "कोई ब्लॉक नहीं।"],
  so_unblock: ["Unblock", "إلغاء الحظر", "Engeli kaldır", "Débloquer", "Desbloquear", "अनब्लॉक"],
  so_remove: ["Remove friend", "حذف الصديق", "Arkadaşlıktan çıkar", "Retirer l'ami", "Eliminar amigo", "दोस्त हटाएं"],
  so_block: ["Block", "حظر", "Engelle", "Bloquer", "Bloquear", "ब्लॉक"],
  so_removeQ: ["Remove {n} from your friends?", "تحذف {n} من أصدقائك؟", "{n} arkadaşlıktan çıkarılsın mı?", "Retirer {n} de tes amis ?", "¿Eliminar a {n} de tus amigos?", "{n} को दोस्तों से हटाएं?"],
  so_blockQ: ["Block {n}? They can't message, invite or add you.", "تحظر {n}؟ ما يكدر يراسلك أو يدعوك أو يضيفك.", "{n} engellensin mi? Sana yazamaz, davet edemez, ekleyemez.", "Bloquer {n} ? Plus de messages, invitations ni demandes.", "¿Bloquear a {n}? No podrá escribirte, invitarte ni añadirte.", "{n} को ब्लॉक करें? वे संदेश, आमंत्रण या अनुरोध नहीं भेज पाएंगे।"],
  so_reqSent: ["Friend request sent", "انرسل طلب الصداقة", "Arkadaşlık isteği gönderildi", "Demande d'ami envoyée", "Solicitud de amistad enviada", "मित्रता अनुरोध भेजा"],
  so_reqIn: ["{n} wants to be friends", "{n} يريد يصير صديقك", "{n} arkadaş olmak istiyor", "{n} veut être ton ami", "{n} quiere ser tu amigo", "{n} दोस्त बनना चाहते हैं"],
  so_accIn: ["{n} accepted your request", "{n} قبل طلبك", "{n} isteğini kabul etti", "{n} a accepté ta demande", "{n} aceptó tu solicitud", "{n} ने आपका अनुरोध स्वीकारा"],
  so_nowFriends: ["You're now friends", "صرتوا أصدقاء", "Artık arkadaşsınız", "Vous êtes amis", "Ahora sois amigos", "अब आप दोस्त हैं"],
  so_removed: ["Friend removed", "انحذف الصديق", "Arkadaş çıkarıldı", "Ami retiré", "Amigo eliminado", "दोस्त हटाया"],
  so_blockedT: ["Player blocked", "انحظر اللاعب", "Oyuncu engellendi", "Joueur bloqué", "Jugador bloqueado", "खिलाड़ी ब्लॉक हुआ"],
  so_unblocked: ["Player unblocked", "انشال الحظر", "Engel kaldırıldı", "Joueur débloqué", "Jugador desbloqueado", "खिलाड़ी अनब्लॉक हुआ"],
  so_msgPh: ["Message (200 max)", "رسالة (200 حرف كحد أقصى)", "Mesaj (en fazla 200)", "Message (200 max)", "Mensaje (máx. 200)", "संदेश (अधिकतम 200)"],
  so_send: ["Send", "إرسال", "Gönder", "Envoyer", "Enviar", "भेजें"],
  so_noMsgs: ["Say hi! Messages are kept for the last 100.", "سلّم عليه! تنحفظ آخر 100 رسالة.", "Merhaba de! Son 100 mesaj saklanır.", "Dis bonjour ! Les 100 derniers messages sont gardés.", "¡Saluda! Se guardan los últimos 100 mensajes.", "नमस्ते कहें! आख़िरी 100 संदेश रहते हैं।"],
  so_filtered: ["Some words were hidden by the filter", "بعض الكلمات انخفت بالفلتر", "Bazı kelimeler filtrelendi", "Certains mots ont été masqués", "Algunas palabras se ocultaron", "कुछ शब्द फ़िल्टर से छिपाए गए"],
  so_report: ["Report message", "إبلاغ عن الرسالة", "Mesajı bildir", "Signaler le message", "Denunciar mensaje", "संदेश रिपोर्ट करें"],
  so_reportQ: ["Report this message?", "تبلغ عن هاي الرسالة؟", "Bu mesaj bildirilsin mi?", "Signaler ce message ?", "¿Denunciar este mensaje?", "यह संदेश रिपोर्ट करें?"],
  so_reported: ["Thanks, message reported", "شكراً، انبلّغ عن الرسالة", "Teşekkürler, bildirildi", "Merci, message signalé", "Gracias, mensaje denunciado", "धन्यवाद, रिपोर्ट हो गया"],
  so_ai: ["AI player", "لاعب ذكاء اصطناعي", "Yapay zekâ oyuncu", "Joueur IA", "Jugador IA", "AI खिलाड़ी"],
  so_aiInfo: ["Computer-controlled snakes can't be added as friends.", "الثعابين اللي يتحكم بيها الكمبيوتر ما تنضاف أصدقاء.", "Bilgisayar yılanları arkadaş eklenemez.", "Les serpents IA ne peuvent pas être ajoutés.", "Las serpientes IA no se pueden añadir.", "कंप्यूटर वाले साँप दोस्त नहीं बन सकते।"],
  so_noId: ["This player has no ID yet.", "هذا اللاعب ما عنده آيدي بعد.", "Bu oyuncunun henüz kimliği yok.", "Ce joueur n'a pas encore d'ID.", "Este jugador aún no tiene ID.", "इस खिलाड़ी की अभी ID नहीं है।"],
  so_special: ["Special IDs", "آيديات مميزة", "Özel kimlikler", "ID spéciaux", "ID especiales", "स्पेशल ID"],
  so_specialSub: ["Short 5-digit IDs. Each one exists once: when it's sold, it's gone.", "آيديات قصيرة من 5 أرقام. كل وحدة موجودة مرة وحدة: إذا انباعت تروح.", "5 haneli kısa kimlikler. Her biri tek: satılınca biter.", "ID courts à 5 chiffres. Chacun est unique : vendu, il disparaît.", "ID cortos de 5 dígitos. Cada uno es único: vendido, desaparece.", "5 अंकों की छोटी ID। हर एक एक ही बार: बिकी तो गई।"],
  so_specialInfo: ["A bought ID replaces your 7-digit ID on your profile and player card. Your 7-digit ID stays reserved for you.", "الآيدي اللي تشتريه ياخذ مكان الآيدي السباعي ببروفايلك وبطاقتك. الآيدي السباعي يبقى محجوزلك.", "Satın aldığın kimlik profilinde 7 haneli kimliğinin yerini alır. Eskisi sana ayrılmış kalır.", "L'ID acheté remplace ton ID à 7 chiffres ; l'ancien reste réservé pour toi.", "El ID comprado reemplaza tu ID de 7 dígitos; el anterior sigue reservado.", "ख़रीदी गई ID आपकी 7-अंकीय ID की जगह लेती है; पुरानी आपके लिए आरक्षित रहती है।"],
  so_k_rep: ["Repeated digits", "أرقام مكررة", "Tekrarlı rakamlar", "Chiffres répétés", "Dígitos repetidos", "दोहराए अंक"],
  so_k_seq: ["Sequences", "تسلسلات", "Diziler", "Suites", "Secuencias", "क्रम"],
  so_k_std: ["Ordinary", "عادية", "Sıradan", "Ordinaires", "Normales", "सामान्य"],
  so_sold: ["Sold out", "انباع", "Satıldı", "Vendu", "Vendido", "बिक गया"],
  so_yours: ["Yours", "مالتك", "Senin", "À toi", "Tuyo", "आपका"],
  so_pick5: ["Any 5-digit number", "أي رقم من 5 مراتب", "Herhangi 5 haneli sayı", "N'importe quel nombre à 5 chiffres", "Cualquier número de 5 dígitos", "कोई भी 5-अंकीय संख्या"],
  so_check: ["Check", "تحقق", "Kontrol et", "Vérifier", "Comprobar", "जाँचें"],
  so_bought: ["ID {n} is yours", "الآيدي {n} صار مالتك", "{n} artık senin", "L'ID {n} est à toi", "El ID {n} es tuyo", "ID {n} अब आपकी है"],
  so_claim: ["Claim", "استلام", "Al", "Réclamer", "Reclamar", "दावा करें"],
  so_claimPh: ["Founder code (ID 1)", "كود المؤسس (آيدي 1)", "Kurucu kodu (ID 1)", "Code fondateur (ID 1)", "Código de fundador (ID 1)", "संस्थापक कोड (ID 1)"],
  so_claimed: ["ID 1 is yours, Founder", "الآيدي 1 صار مالتك يا مؤسس", "ID 1 artık senin, Kurucu", "L'ID 1 est à toi, Fondateur", "El ID 1 es tuyo, Fundador", "ID 1 आपकी है, संस्थापक"],
  so_e_offline: ["Can't reach the server. Try again in a moment.", "ما نكدر نوصل للسيرفر. جرّب بعد شوية.", "Sunucuya ulaşılamıyor. Birazdan dene.", "Serveur injoignable. Réessaie dans un instant.", "No se puede conectar. Inténtalo en un momento.", "सर्वर तक नहीं पहुँच सके। थोड़ी देर में फिर।"],
  so_e_notfound: ["No player with that ID", "ماكو لاعب بهذا الآيدي", "Bu kimlikte oyuncu yok", "Aucun joueur avec cet ID", "Ningún jugador con ese ID", "इस ID का कोई खिलाड़ी नहीं"],
  so_e_self: ["That's your own ID", "هذا الآيدي مالتك", "Bu senin kimliğin", "C'est ton propre ID", "Es tu propio ID", "यह आपकी अपनी ID है"],
  so_e_already: ["You're already friends", "انتو أصدقاء من قبل", "Zaten arkadaşsınız", "Vous êtes déjà amis", "Ya sois amigos", "आप पहले से दोस्त हैं"],
  so_e_blocked: ["Unblock this player first", "شيل الحظر أول", "Önce engeli kaldır", "Débloque d'abord ce joueur", "Desbloquea primero", "पहले अनब्लॉक करें"],
  so_e_full: ["Friend list is full (200)", "قائمة الأصدقاء مليانة (200)", "Arkadaş listesi dolu (200)", "Liste d'amis pleine (200)", "Lista de amigos llena (200)", "दोस्त सूची भर गई (200)"],
  so_e_pending: ["Too many requests waiting", "طلبات معلّقة هواية", "Çok fazla bekleyen istek", "Trop de demandes en attente", "Demasiadas solicitudes pendientes", "बहुत अनुरोध लंबित"],
  so_e_rate: ["Slow down a little", "على كيفك شوية", "Biraz yavaşla", "Doucement", "Ve más despacio", "थोड़ा धीरे"],
  so_e_notfriend: ["Only friends can do that", "بس الأصدقاء يكدرون", "Bunu sadece arkadaşlar yapabilir", "Réservé aux amis", "Solo amigos", "सिर्फ़ दोस्त कर सकते हैं"],
  so_e_long: ["Message is too long (200 max)", "الرسالة طويلة (200 حد أقصى)", "Mesaj çok uzun (en fazla 200)", "Message trop long (200 max)", "Mensaje demasiado largo (máx. 200)", "संदेश बहुत लंबा (अधिकतम 200)"],
  so_e_empty: ["Write something first", "اكتب شي أول", "Önce bir şey yaz", "Écris d'abord quelque chose", "Escribe algo primero", "पहले कुछ लिखें"],
  so_e_expired: ["That invite has expired", "الدعوة انتهت", "Davetin süresi doldu", "L'invitation a expiré", "La invitación caducó", "आमंत्रण ख़त्म हो गया"],
  so_e_sold: ["Sorry, that ID was just sold", "آسفين، هذا الآيدي هسه انباع", "Üzgünüz, bu kimlik az önce satıldı", "Désolé, cet ID vient d'être vendu", "Lo siento, ese ID se acaba de vender", "माफ़ करें, यह ID अभी बिक गई"],
  so_e_bad: ["Enter 5 digits (not starting with 0)", "اكتب 5 أرقام (ما تبدي بصفر)", "5 rakam gir (0 ile başlamasın)", "Entre 5 chiffres (sans 0 au début)", "Escribe 5 dígitos (sin 0 al inicio)", "5 अंक डालें (0 से शुरू नहीं)"],
  so_e_max: ["You own the maximum of 5 special IDs", "عندك الحد الأقصى 5 آيديات مميزة", "En fazla 5 özel kimliğin var", "Tu possèdes déjà 5 ID spéciaux", "Ya tienes 5 ID especiales", "आपके पास अधिकतम 5 स्पेशल ID हैं"],
  so_e_price: ["The price changed. Please check again.", "السعر تغيّر. تحقق مرة لخ.", "Fiyat değişti. Tekrar kontrol et.", "Le prix a changé. Vérifie à nouveau.", "El precio cambió. Comprueba de nuevo.", "क़ीमत बदल गई। फिर जाँचें।"],
  so_e_bad_code: ["Wrong code", "الكود غلط", "Yanlış kod", "Code incorrect", "Código incorrecto", "ग़लत कोड"],
  so_e_taken: ["ID 1 is already claimed", "الآيدي 1 مستلم من قبل", "ID 1 zaten alındı", "L'ID 1 est déjà pris", "El ID 1 ya fue reclamado", "ID 1 पहले ही ली जा चुकी"],
});
