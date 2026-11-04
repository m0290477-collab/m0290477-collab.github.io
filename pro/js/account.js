// srv2: accounts on the client. Sign-in card (Profile + Settings): Continue with Google (Google Identity Services, ID token),
// Sign in with Apple (Apple JS, ID token), email one-time code. Tokens are verified on the worker (JWKS); a button stays hidden
// while its client id is not configured on the server (/cfg). Profile snapshots: debounced ~10 s after a save + at match end,
// versioned (a newer save from another device wins), restored on sign-in. Owner grants arrive live over the social socket.
// Owner panel (only reachable from the founder's own Profile, every call checked on the server). Finding-a-server overlay.
import { t, fmtNum, addStrings, LANG } from "./i18n.js?v=admin2";
import { SERVER } from "./net.js?v=admin2";
import { devKey } from "./league.js?v=admin2";
import { SO, call, socialRestart, errText } from "./social.js?v=admin2";
import { avatarHtml } from "./profile.js?v=admin2";
import { KV, jparse, newProfile } from "./store.js?v=admin2";
import { pidHtml } from "./pid.js?v=admin2";
import { legalButtons } from "./legal.js?v=admin2"; // coin1: Privacy / Terms
import { WL, migrated, apply as walletApply, onPush as walletPush } from "./wallet.js?v=admin2"; // coin1
import { CF, dashExtra, liveHtml, ecoHtml, playerExtra, bind2, a2Reset, actName2 } from "./admin2.js?v=admin2"; // admin2

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const HTTP = SERVER.replace(/^ws/, "http").replace(/\/ws$/, "");
const GSI = "https://accounts.google.com/gsi/client", AJS = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
export const AC = { ui: null, cfg: null, acct: null, sv: 0, ban: 0, mute: 0, lastSent: "", syncT: 0, lastOk: 0, nonce: null, pend: null, em: { step: 1, email: "" }, adm: { tab: "dash", q: "", list: null, view: null, srv: null, reps: null, aud: null } };
const S_ = () => AC.ui.S;
const inMatch = () => { const g = AC.ui && AC.ui.app.game; return !!(g && g.mode && g.mode !== "show" && g.mode !== "attract" && !g.ended); };
const fmtD = (ms) => (ms > 1e15 - 1 || ms > Date.now() + 50 * 365 * 864e5 ? t("ad_perm") : new Date(ms).toLocaleString(LANG, { dateStyle: "medium", timeStyle: "short" }));
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? t("ac_justNow") : m < 60 ? t("ac_minAgo", { n: m }) : new Date(ms).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short" }); };

// ---------- transport ----------
async function hpost(op, args = {}) { try { const r = await fetch(HTTP + "/a", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pk: devKey(S_()), op, ...args }) }); return await r.json(); } catch (_) { return { err: "offline" }; } }
const acall = (op, args = {}) => (SO.up && SO.ws ? call(op, args) : hpost(op, args)); // the socket when it is up (cheap), else the worker
export async function loadCfg(force) {
  if (typeof window !== "undefined" && window.__SSP_ACFG) return (AC.cfg = window.__SSP_ACFG); // QA override (screenshots)
  const c = jparse(KV.get("ssp-acfg") || "null"); if (!force && c && Date.now() - c.t < 3600000) return (AC.cfg = c.c);
  try { const r = await (await fetch(HTTP + "/cfg")).json(); if (r && typeof r === "object") { AC.cfg = r; KV.set("ssp-acfg", JSON.stringify({ t: Date.now(), c: r })); } } catch (_) { AC.cfg = AC.cfg || (c && c.c) || { g: "", a: "", em: 0 }; }
  return AC.cfg;
}
const loadScript = (src) => new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement("script"); s.src = src; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

// ---------- start: hooks into the social socket and the store ----------
export function accountStart(ui) {
  AC.ui = ui; injectDom(ui);
  SO.onAcct = (m) => { AC.acct = m.acct || null; AC.sv = m.sv | 0; setBan(m.ban | 0, true); AC.mute = m.mute | 0; if (Array.isArray(m.gr) && m.gr.length) applyGrants(m.gr);
    const p = S_().p; if (AC.acct && (p.ssv | 0) < AC.sv) pullAdopt(); else schedule(); rerender(); };
  SO.onAcctEv = (m) => onEv(m);
  S_().onFlush = () => schedule();
  loadCfg().then(rerender);
}
function rerender() { const ui = AC.ui; if (!ui) return; if (ui.cur === "profile" && ui.prTab === "over") ui.renderProfile(); else if (ui.cur === "settings" && ui.gTab === "account") ui.renderSettings(); else if (ui.cur === "admin") renderAdmin(ui); }

// ---------- snapshots ----------
function schedule() { if (!AC.ui || AC.syncT) return; AC.syncT = setTimeout(() => { AC.syncT = 0; sync(); }, 10000); } // at most one save every ~10 s
const snapText = (p) => { const o = { ...p }; delete o.dev; delete o._ck; delete o.ssv; return JSON.stringify(o); };
export async function sync(force) {
  const S = S_(), p = S.p; if (!SO.pk) return; const js = snapText(p); if (!force && js === AC.lastSent) return; if (js.length > 63000) return;
  const r = await acall("snap", { sv: p.ssv | 0, js }); if (S.p !== p) return;
  if (r && r.ok) { AC.lastSent = js; AC.lastOk = Date.now(); AC.sv = r.sv; if (r.adj) { if (Number.isFinite(r.adj.xp)) p.xp = r.adj.xp; if (migrated()) walletApply(WL.st); else if (Number.isFinite(r.adj.coins)) p.coins = r.adj.coins; AC.ui.coins && AC.ui.coins(p.coins); } // coin1: coins = the wallet
    p.ssv = r.sv; S.save(); if (r.adj) AC.lastSent = ""; }
  else if (r && r.err === "stale") adopt(r.js, r.sv);
}
async function pullAdopt() { const r = await acall("pull"); if (r && r.js && (r.sv | 0) > (S_().p.ssv | 0)) adopt(r.js, r.sv); }
function adopt(js, sv) { // take the server's (newer) save; during a match it waits for the lobby
  if (inMatch()) { AC.pend = { js, sv }; return; } AC.pend = null;
  const S = S_(), np = jparse(js); if (!np || typeof np !== "object") return; np.dev = S.p.dev; np.ssv = sv | 0; S.replaceProfile(np); if (migrated()) walletApply(WL.st); // coin1: a restored save shows the wallet balance AC.lastSent = snapText(S.p); AC.sv = sv | 0;
  const ui = AC.ui; ui.app.applyAll(); ui.coins && ui.coins(S.p.coins); if (ui.cur) ui.show(ui.cur);
}
export function accountMatchEnd() { setTimeout(() => sync(true), 400); } // results are saved first
export function accountLobby() { if (AC.pend) { const x = AC.pend; adopt(x.js, x.sv); } if (AC.banShow) showBan(); }
// coin1: an owner gift. Its coins are already in the server wallet (the balance arrives with it); its items are shown here.
// Before this device's one-time wallet import the grant waits on the server (the import adds it), so it is acked only after.
function applyGrants(list, bal) {
  const S = S_(), p = S.p, done = []; let coins = 0, items = 0;
  for (const g of list) { const key = "adm:" + g.id; done.push(g.id); if (p.rc.includes(key)) continue; coins += g.c | 0;
    for (const it of g.it || []) { const L = /^(av|fr|ti|bn|bd):/.test(it) ? p.cos : p.owned; if (!L.includes(it)) { L.push(it); items++; } } p.rc.push(key); }
  if (Number.isFinite(+bal)) walletPush({ bal });
  if (coins || items) { S.flush(); AC.ui.coins && AC.ui.coins(p.coins); AC.ui.toast(coins ? t("ac_gift", { n: fmtNum(coins) }) : t("ac_giftIt"), "gold", 5000); }
  if (done.length && migrated()) acall("gack", { ids: done });
}
function onEv(m) {
  const ui = AC.ui, S = S_(), p = S.p;
  if (m.k === "grant") { const was = (p.ssv | 0) === (m.sv | 0) - 1; applyGrants([m.g], m.bal); if (was && m.sv) { p.ssv = m.sv; AC.lastSent = ""; S.save(); } }
  else if (m.k === "ban") { setBan(m.u | 0); if (inMatch() && ui.app.game.mode === "online") { ui.app.game.stopMatch(); ui.goLobby(); } }
  else if (m.k === "unban") { setBan(0); ui.toast(t("ac_unbanned"), "good", 4000); }
  else if (m.k === "mute") { AC.mute = m.u | 0; ui.toast(t("ac_muted", { d: fmtD(AC.mute) }), "warn", 5000); }
  else if (m.k === "unmute") { AC.mute = 0; ui.toast(t("ac_unmuted"), "good", 3000); }
  else if (m.k === "rname") { p.name = String(m.n || "Player").slice(0, 16); S.save(); ui.toast(t("ac_renamed"), "warn", 5000); if (ui.cur === "lobby") ui.renderLobby(); }
  else if (m.k === "snap") { if ((m.sv | 0) > (p.ssv | 0) && AC.acct) pullAdopt(); }
  else if (m.k === "gone") { leave(false); ui.toast(t("ac_delDone"), "warn", 5000); }
}
function setBan(u, quiet) { AC.ban = u > Date.now() ? u : 0; AC.banShow = !!AC.ban; if (AC.ban && !inMatch()) showBan(); }
function showBan() { AC.banShow = false; if (!AC.ban) return; AC.ui.toast(AC.ban > Date.now() + 50 * 365 * 864e5 ? t("ac_bannedP") : t("ac_banned", { d: fmtD(AC.ban) }), "warn", 7000); }

// ---------- sign-in card ----------
export function signInCard(ui) {
  const C = AC.cfg || { g: "", a: "", em: 0 }, A = AC.acct, own = SO.me && SO.me.own, any = C.g || C.a || C.em;
  if (A) { const ms = [A.g && "Google", A.a && "Apple", A.e && t("ac_m_e") + " · " + A.e, A.tt && "Test"].filter(Boolean).join(" · ");
    const more = [C.g && !A.g ? `<div class="ac-gbtn" id="ac-g"></div>` : "", C.a && !A.a ? `<button class="btn ac-b ac-apple" id="ac-a">${APPLE_SVG}<span>${t("ac_apple")}</span></button>` : "", C.em && !A.e ? `<button class="btn ac-b" id="ac-e">${MAIL_SVG}<span>${t("ac_email")}</span></button>` : ""].join("");
    return `<div class="pv-card ac-card on"><div class="pv-h">☁ ${t("ac_in")}</div><p class="ac-st"><b>✓ ${t("ac_in")}</b> <span class="fine">${esc(ms)}</span></p><p class="fine">${AC.lastOk ? t("ac_saved", { t: ago(AC.lastOk) }) : t("ac_autosave")}</p>
      ${more ? `<div class="pv-lab">${t("ac_add")}</div><div class="ac-btns">${more}</div>` : ""}<div class="ac-btns ac-row2"><button class="btn ac-b" id="ac-out">${t("ac_out")}</button>${A.own ? "" : `<button class="btn ac-b danger" id="ac-del">${t("ac_del")}</button>`}</div>${legalButtons()}</div>`; }
  return `<div class="pv-card ac-card"><div class="pv-h">☁ ${t("ac_title")}</div><p class="ac-sub">${t("ac_sub")}</p>
    ${any ? `<div class="ac-btns">${C.g ? `<div class="ac-gbtn" id="ac-g"><button class="btn ac-b ac-google" id="ac-gf">${G_SVG}<span>${t("ac_google")}</span></button></div>` : ""}${C.a ? `<button class="btn ac-b ac-apple" id="ac-a">${APPLE_SVG}<span>${t("ac_apple")}</span></button>` : ""}${C.em ? `<button class="btn ac-b" id="ac-e">${MAIL_SVG}<span>${t("ac_email")}</span></button>` : ""}</div><p class="fine">${t("ac_note")}</p><p class="fine ac-legal">${t("lg_agree")}</p>` : `<p class="fine ac-soon">${t("ac_soon")}</p>`}${legalButtons()}${SO.me && !SO.me.own ? `<div class="ac-btns ac-row2"><button class="btn ac-b danger" id="ac-delg">${t("ac_delG")}</button></div>` : ""}</div>`;
}
// owner panel entry: only on the founder's own Profile (id 1 per the server); every panel call is checked on the server again
export function ownerEntry() { return SO.me && SO.me.own && SO.me.id === "1" ? `<div class="pv-card ad-entry"><div class="pv-h">♛ ${t("ac_admin")}</div><p class="fine">${t("ad_entrySub")}</p><button class="btn gold ac-b" id="ad-open">${t("ac_admin")}</button></div>` : ""; }
export function bindSignIn(ui, el) {
  const on = (id, fn) => { const b = el.querySelector("#" + id); if (b) ui.click(b, fn, "tab"); };
  on("ac-e", () => openEmail(ui)); on("ac-a", () => apple(ui)); on("ac-out", () => signOut(ui)); on("ac-del", () => delAcct(ui)); on("ac-delg", () => delGuest(ui)); on("ad-open", () => { AC.adm.tab = "dash"; ui.go("admin"); });
  const g = el.querySelector("#ac-g"); if (g && AC.cfg && AC.cfg.g) google(ui, g);
}
async function nonce() { if (AC.nonce && Date.now() - AC.nonce.t < 600000) return AC.nonce.n; const r = await acall("nonce"); if (!r || !r.n) return ""; AC.nonce = { n: r.n, t: Date.now() }; return r.n; }
async function google(ui, box) {
  if (window.__SSP_NOGSI) { const f = box.querySelector("#ac-gf"); if (f) ui.click(f, () => ui.toast(t("ac_e_token"), "warn"), "tab"); return; } // QA: no third-party script
  try { const n = await nonce(); if (!n) return; await loadScript(GSI); const gid = window.google && google.accounts && google.accounts.id; if (!gid) return;
    gid.initialize({ client_id: AC.cfg.g, nonce: n, ux_mode: "popup", use_fedcm_for_prompt: true, callback: async (resp) => { AC.nonce = null; done(ui, await hpost("google", { tok: resp.credential })); } });
    box.innerHTML = ""; gid.renderButton(box, { type: "standard", theme: "filled_black", size: "large", text: "continue_with", shape: "pill", locale: LANG, width: 260 }); } catch (e) { console.warn("gsi", e); }
}
async function apple(ui) {
  try { const n = await nonce(); if (!n) { ui.toast(errText("offline"), "warn"); return; } await loadScript(AJS); const A = window.AppleID; if (!A) return;
    A.auth.init({ clientId: AC.cfg.a, scope: "email", redirectURI: AC.cfg.ar, state: n.slice(0, 8), nonce: n, usePopup: true });
    const r = await A.auth.signIn(); AC.nonce = null; const tok = r && r.authorization && r.authorization.id_token; if (tok) done(ui, await hpost("apple", { tok })); }
  catch (e) { if (!(e && /popup_closed|user_cancelled/.test(e.error || ""))) ui.toast(t("ac_e_token"), "warn"); }
}
function acErr(r) { const e = (r && r.err) || "offline", k = "ac_e_" + e; return t(k, { n: r && r.left }) !== k ? t(k, { n: r && r.left }) : errText(e); }
function done(ui, r) {
  if (!r || !r.ok) { ui.toast(acErr(r), "warn", 4000); return; }
  const S = S_(), p = S.p; AC.acct = r.acct; closeEmail();
  if (r.mode === "restore") { const key = "ssp-pre:" + (S.cur || "guest"); if (!KV.get(key)) KV.set(key, JSON.stringify({ p })); // this device's own profile comes back on sign-out
    if (r.snap && r.snap.js) adopt(r.snap.js, r.snap.sv); else { p.ssv = r.sv | 0; S.save(); } socialRestart(); ui.toast(t("ac_back", { n: S.p.name }), "gold", 4500); }
  else { p.ssv = r.sv | 0; AC.lastSent = ""; S.save(); sync(true); ui.toast(r.mode === "added" ? t("ac_added") : t("ac_new"), "good", 4000); }
  rerender();
}
async function signOut(ui) { if (!(await ui.confirm(t("ac_outQ")))) return; await sync(true); const r = await hpost("out"); if (!r || !r.ok) { ui.toast(acErr(r), "warn"); return; } leave(true); ui.toast(t("ac_outDone"), "good", 4500); }
// coin1: a guest can delete its online data too (same real server delete); the device then starts a fresh profile
async function delGuest(ui) { if (!(await ui.confirm(t("ac_delGQ")))) return; const r = await hpost("adel"); if (!r || !r.ok) { ui.toast(acErr(r), "warn"); return; } leave(false); ui.toast(t("ac_delGDone"), "good", 4500); }
async function delAcct(ui) { if (!(await ui.confirm(t("ac_delQ")))) return; const r = await hpost("adel"); if (!r || !r.ok) { ui.toast(acErr(r), "warn"); return; } leave(false); ui.toast(t("ac_delDone"), "good", 4500); }
function leave() { // signed out / deleted: this device gets its own profile back (or a fresh one with a new device id)
  const S = S_(), key = "ssp-pre:" + (S.cur || "guest"), pre = jparse(KV.get(key) || "null"), name = S.p.name;
  if (pre && pre.p) S.replaceProfile(pre.p); else { const f = newProfile(name); f.tut = 1; f.dev = ""; S.replaceProfile(f); }
  KV.del(key); AC.acct = null; AC.lastSent = ""; AC.lastOk = 0; AC.nonce = null; socialRestart(); const ui = AC.ui; ui.app.applyAll(); ui.coins && ui.coins(S.p.coins); if (ui.cur) ui.show(ui.cur);
}

// ---------- email (one-time code) ----------
function openEmail(ui) { AC.em = { step: 1, email: "" }; drawEmail(ui); $("m-acem").classList.remove("x-hide"); }
function closeEmail() { const m = $("m-acem"); if (m) m.classList.add("x-hide"); }
function drawEmail(ui) {
  const c = $("m-acem-c"), E = AC.em;
  c.innerHTML = `<button class="icon-btn so-x" id="em-x" aria-label="${t("back")}">${X_SVG}</button><h2>${t("ac_emTitle")}</h2>` + (E.step === 1
    ? `<p class="fine">${t("ac_emSub")}</p><form class="ac-form" id="em-f"><input id="em-in" type="email" inputmode="email" autocomplete="email" dir="ltr" maxlength="254" placeholder="${t("ac_emPh")}" value="${esc(E.email)}"><button class="btn gold ac-b" type="submit">${t("ac_send")}</button></form>`
    : `<p class="fine">${esc(t("ac_codeSub", { e: E.email }))}</p><form class="ac-form" id="em-f"><input id="em-in" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" dir="ltr" maxlength="6" placeholder="${t("ac_codePh")}"><button class="btn gold ac-b" type="submit">${t("ac_verify")}</button></form><button class="btn ghost ac-b" id="em-back">${t("ac_resend")}</button>`) + `<p class="so-err" id="em-err"></p>`;
  ui.click($("em-x"), closeEmail, "back"); const b = $("em-back"); if (b) ui.click(b, () => { AC.em.step = 1; drawEmail(ui); }, "tab");
  $("em-f").addEventListener("submit", async (e) => { e.preventDefault(); const v = $("em-in").value.trim(), err = $("em-err");
    if (E.step === 1) { const r = await hpost("em1", { email: v }); if (r && r.ok) { AC.em = { step: 2, email: v.toLowerCase() }; drawEmail(ui); } else err.textContent = acErr(r); }
    else { const r = await hpost("em2", { email: E.email, code: v }); if (r && r.ok) done(ui, r); else err.textContent = acErr(r); } });
}

// ---------- finding a server (online) ----------
export function serverName(f) { const br = f.br || "", m = /^pub-(\d+)$/.exec(f.room || "");
  return br ? t(BR_SHORT[br]) + " #" + (f.bi || f.i || 1) : m ? t("mm_public", { n: m[1] }) : t("mm_friend"); }
const BR_SHORT = { bs: "lg_bronze", gp: "lg_gold", dc: "lg_diamond", cq: "lg_conq" };
export function onFind(f) {
  const el = $("mm-find"); if (!el) return; clearTimeout(AC._ft); const T = $("mmf-t"), Sb = $("mmf-s");
  if (f.st === "ban") { el.classList.add("x-hide"); return; }
  el.classList.remove("x-hide", "out"); el.classList.toggle("busy", f.st !== "in");
  if (f.st === "find") { T.textContent = t("mm_find"); Sb.textContent = ""; }
  else if (f.st === "wait") { T.textContent = t("mm_wait"); Sb.textContent = f.br ? t("mm_br", { b: t("br_" + f.br) }) : ""; }
  else if (f.st === "found") { T.textContent = t("mm_join", { s: serverName({ br: f.br, i: f.i, room: f.room }) }); Sb.textContent = f.br ? t("mm_br", { b: t("br_" + f.br) }) : ""; }
  else if (f.st === "in") { const nb = Math.max(0, (f.b | 0) - 1); T.textContent = t("mm_server", { s: serverName(f), n: Math.max(1, f.h | 0) }) + (nb ? " · " + t("mm_bots", { n: nb }) : ""); // the joining player replaces one bot
    Sb.textContent = f.fb && f.my && f.fb !== f.my ? t("mm_fb") : f.br ? t("mm_br", { b: t("br_" + f.br) }) : "";
    AC._ft = setTimeout(() => { el.classList.add("out"); AC._ft = setTimeout(() => el.classList.add("x-hide"), 400); }, window.__SSP_NOGSI ? 6e5 : 3200); } // QA screenshots hold it
}
export function findHide() { const el = $("mm-find"); if (el) el.classList.add("x-hide"); clearTimeout(AC._ft); }

// ---------- owner panel ----------
const adm = (op, a = {}) => call(op, a);
export function renderAdmin(ui) {
  const el = $("ad-content"); if (!el) return; const A = AC.adm, tab = A.tab;
  $("ad-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === tab));
  if (!(SO.me && SO.me.own)) { el.innerHTML = `<div class="pv-card"><p class="so-err">${t("ad_forbidden")}</p></div>`; return; }
  let h = "";
  if (tab === "dash") { const s = A.srv;
    if (!s) h = `<p class="fine">${t("loading")}…</p>`; else if (s.err) h = `<p class="so-err">${esc(s.err === "forbidden" ? t("ad_forbidden") : errText(s.err))}</p>`;
    else { const tile = (k, v, w) => `<div class="ad-tile ${w || ""}"><small>${t(k)}</small><b>${v}</b></div>`;
      h = `<div class="ad-tiles">${tile("ad_online", fmtNum(s.online))}${tile("ad_lobby", fmtNum(s.lobby))}${tile("ad_match", fmtNum(Math.max(s.match, s.inRooms)))}${tile("ad_rooms", fmtNum(s.rooms.filter((r) => r.live).length))}${tile("ad_msgs", (Math.round(s.msgMin * 10) / 10) + ` <i class="fine">(${Math.round(s.msg10 * 10) / 10})</i>`)}${tile("ad_errs", fmtNum(s.errs.social + s.errs.rooms), s.errs.social + s.errs.rooms ? "bad" : "")}</div>
        <div class="pv-card"><div class="pv-h">${t("ad_rooms")}<button class="btn ac-b ad-sm" id="ad-ref">${t("ad_refresh")}</button></div>${s.rooms.length ? `<table class="lb ad-tb"><tr><th>${t("ad_room")}</th><th>${t("ad_bracket")}</th><th>${t("ad_humans")}</th><th>${t("ad_botsH")}</th><th>${t("ad_up")}</th></tr>` + s.rooms.map((r) => `<tr class="${r.live ? "" : "dim"}"><td>${esc(serverName({ br: r.br, bi: r.i, room: r.room }))}</td><td>${r.br ? esc(t("br_" + r.br)) : "—"}</td><td class="g">${r.h}</td><td>${r.b}</td><td>${Math.round(r.up / 60)} min</td></tr>`).join("") + `</table>` : `<p class="fine">${t("ad_noRooms")}</p>`}
        <p class="fine">${t("ad_total", { p: fmtNum(s.players), a: fmtNum(s.accounts), r: fmtNum(s.open) })}</p></div>`; }
    h = dashExtra(adm) + h; // admin2: stats + backup
  } else if (tab === "players") {
    if (A.view) h = viewHtml(A.view) + playerExtra(A.view); // admin2
    else { h = `<div class="pv-card"><form class="so-find" id="ad-f"><input id="ad-q" autocomplete="off" dir="auto" maxlength="24" placeholder="${t("ad_search")}" value="${esc(A.q)}"><button class="btn gold so-b" type="submit">${t("search")}</button></form></div>`;
      if (A.list) h += `<div class="pv-card">` + (A.list.length ? A.list.map((c) => `<button class="so-row ad-pr" data-vid="${esc(c.id)}">${avatarHtml(c.av || "p0", c.fr | 0, "m")}<div class="so-who"><b dir="auto">${esc(c.n)}</b><small>${pidHtml(c.id)} · ${t("level")} ${c.lv | 0}${c.acc ? " · ☁" : ""}${c.ban ? ` · <em class="ad-bad">${t("ad_ban")}</em>` : ""}${c.mute ? ` · <em class="ad-warn">${t("ad_mute")}</em>` : ""}</small></div></button>`).join("") : `<p class="fine">${t("ad_noRes")}</p>`) + `</div>`; }
  } else if (tab === "live") h = liveHtml(adm); else if (tab === "eco") h = ecoHtml(adm); // admin2
  else if (tab === "reports") { const L = A.reps;
    h = !L ? `<p class="fine">${t("loading")}…</p>` : L.err ? `<p class="so-err">${esc(errText(L.err))}</p>` : L.length ? L.map((r) => `<div class="pv-card ad-rep ${r.res ? "res" : ""}"><div class="pv-h"><span>${r.res ? "✓ " + t("ad_resolved") : "● " + t("ad_open")}</span><span class="fine">${esc(new Date(r.t).toLocaleString(LANG))}</span></div>
        <div class="so-who"><b dir="auto">${esc(r.who.n)}</b> <small>${pidHtml(r.who.id)}</small></div><p class="ad-msg" dir="auto">“${esc(r.tx || "—")}”</p><p class="fine">${esc(t("ad_by", { n: r.by.n }))} · ${pidHtml(r.by.id)}${r.rwhy ? " · " + esc(r.rwhy) : ""}</p>
        <div class="ac-btns">${r.res ? "" : `<button class="btn gold ac-b" data-res="${r.id}">${t("ad_resolve")}</button>`}<button class="btn ac-b" data-vid="${esc(r.who.id)}">${t("ad_view")}</button></div></div>`).join("") : `<div class="pv-card"><p class="fine">${t("ad_noReps")}</p></div>`;
  } else { const L = A.aud;
    h = !L ? `<p class="fine">${t("loading")}…</p>` : L.err ? `<p class="so-err">${esc(errText(L.err))}</p>` : `<div class="pv-card">` + (L.length ? `<table class="lb ad-tb"><tr><th>${t("ad_t")}</th><th>${t("ad_act")}</th><th>${t("ad_tgt")}</th><th>${t("ad_reason")}</th></tr>` + L.map((x) => `<tr><td class="fine">${esc(new Date(x.t).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short" }))}</td><td>${esc(actName(x.act))}${actData(x)}</td><td>${x.tgt ? pidHtml(x.tgt) : "—"}</td><td dir="auto">${esc(x.why)}</td></tr>`).join("") + `</table>` : `<p class="fine">${t("ad_noLog")}</p>`) + `</div>`; }
  el.innerHTML = h; bindAdmin(ui, el); CF.rer = () => { if (ui.cur === "admin") renderAdmin(ui); }; bind2(ui, el, adm, A, CF.rer); // admin2
  if (tab === "dash" && !A.srv) loadAdm(ui, "srv"); if (tab === "reports" && !A.reps) loadAdm(ui, "reps"); if (tab === "log" && !A.aud) loadAdm(ui, "aud");
}
const actName = (a) => t({ ...actName2, ban: "ad_ban", unban: "ad_unban", mute: "ad_mute", unmute: "ad_unmute", grant: "ad_grantS", rename: "ad_rname", resolve: "ad_resolve", delete: "ad_del" }[a] || "ad_act");
function actData(x) { const d = jparse(x.d || "{}") || {}; return d.coins ? ` <span class="fine">◆${fmtNum(d.coins)}${d.items && d.items.length ? " +" + d.items.length : ""}</span>` : d.mins ? ` <span class="fine">${d.mins === "perm" ? t("ad_perm") : Math.round(d.mins / 60) + " h"}</span>` : ""; }
async function loadAdm(ui, k) { const A = AC.adm; const r = await adm("a_" + k); if (k === "srv") A.srv = r; else A[k] = r && r.list ? r.list : { err: (r && r.err) || "offline" }; if (ui.cur === "admin") renderAdmin(ui); }
function viewHtml(v) {
  if (v.err) return `<div class="pv-card"><button class="btn ac-b" id="ad-back">‹ ${t("ad_players")}</button><p class="so-err">${esc(errText(v.err))}</p></div>`;
  const c = v.card, a = v.acct, sn = v.snap, row = (k, val) => `<div class="ad-kv"><small>${t(k)}</small><b>${val}</b></div>`;
  const st = v.ban ? `<em class="ad-bad">${v.ban.until > 1e15 - 1 ? t("ad_bannedP") : esc(t("ad_bannedU", { d: fmtD(v.ban.until) }))}</em> <span class="fine" dir="auto">${esc(v.ban.why)}</span>` : v.mute ? `<em class="ad-warn">${esc(t("ad_mutedU", { d: fmtD(v.mute.until) }))}</em>` : `<span class="ad-good">${t("ad_ok")}</span>`;
  return `<div class="ad-vh"><button class="btn ac-b" id="ad-back">‹ ${t("ad_players")}</button></div>
    <div class="pv-card ad-pv"><div class="so-pch">${avatarHtml(c.av || "p0", c.fr | 0, "l")}<div><h2 dir="auto">${esc(c.n)}</h2>${pidHtml(c.id)}<small class="fine"> · ${t("level")} ${sn ? sn.lv : c.lv}</small></div></div>
      <div class="ad-kvs">${row("ad_coins", sn ? "◆" + fmtNum(sn.coins) : "—")}${row("ad_level", sn ? sn.lv : c.lv)}${row("ad_acct", a ? [a.g && "Google", a.a && "Apple", a.e && esc(a.e), a.tt && "Test"].filter(Boolean).join(" · ") : t("ad_none"))}${row("ad_seen", c.seen ? esc(new Date(c.seen).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short" })) : "—")}${row("so_friends", fmtNum(v.friends))}${row("ad_status", st)}</div>
      ${sn && sn.sus ? `<p class="fine ad-warn">${t("ad_sus", { n: sn.sus })}</p>` : ""}</div>
    <div class="pv-card"><div class="pv-h">${t("ad_actions")}</div><div class="ad-acts">${v.ban ? `<button class="btn ac-b" data-a="unban">${t("ad_unban")}</button>` : `<button class="btn ac-b danger" data-a="ban">${t("ad_ban")}</button>`}${v.mute ? `<button class="btn ac-b" data-a="unmute">${t("ad_unmute")}</button>` : `<button class="btn ac-b" data-a="mute">${t("ad_mute")}</button>`}<button class="btn gold ac-b" data-a="grant">${t("ad_grant")}</button><button class="btn ac-b" data-a="rname">${t("ad_rname")}</button><button class="btn ac-b danger ghost" data-a="del">${t("ad_del")}</button></div></div>
    <div class="pv-g2"><div class="pv-card"><div class="pv-h">${t("ad_devices")} · ${v.devices.length}</div>${v.devices.map((d) => `<div class="ad-dev"><b>${esc(d.ua || "?")}</b><small class="fine">#${esc(d.d)}${d.ln ? " · ☁ " + t("ad_linked") : ""} · ${esc(new Date(d.t1).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short" }))}</small></div>`).join("") || `<p class="fine">—</p>`}</div>
      <div class="pv-card"><div class="pv-h">${t("ad_repsAbout")} · ${v.reps.length}</div>${v.reps.length ? v.reps.slice(0, 8).map((r) => `<p class="ad-msg ${r.res ? "res" : ""}" dir="auto">“${esc(r.tx || "—")}” <small class="fine">${esc(r.by.n)}</small></p>`).join("") : `<p class="fine">${t("ad_noReps")}</p>`}</div></div>`;
}
function bindAdmin(ui, el) {
  const A = AC.adm, on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => ui.click(b, () => fn(b), "tab"));
  on("#ad-ref", () => { A.srv = null; renderAdmin(ui); });
  on("[data-vid]", async (b) => { A.tab = "players"; A.view = { card: { n: "…", id: b.dataset.vid }, devices: [], reps: [], loading: 1 }; const r = await adm("a_view", { id: b.dataset.vid }); A.view = r && r.card ? r : { err: (r && r.err) || "offline" }; renderAdmin(ui); });
  on("#ad-back", () => { A.view = null; renderAdmin(ui); });
  on("[data-res]", (b) => askAct(ui, { k: "res", rid: +b.dataset.res }));
  on("[data-a]", (b) => askAct(ui, { k: b.dataset.a, id: A.view.card.id, name: A.view.card.n }));
  const f = el.querySelector("#ad-f"); if (f) f.addEventListener("submit", async (e) => { e.preventDefault(); A.q = $("ad-q").value.trim(); if (!A.q) return; const r = await adm("a_find", { q: A.q }); A.list = r && r.list ? r.list : []; renderAdmin(ui); });
}
// action dialog: duration / coins + items when needed, and a required reason (it goes into the audit log)
function askAct(ui, o) {
  const m = $("m-adact"), c = $("m-adact-c"), k = o.k, ttl = { ban: "ad_ban", unban: "ad_unban", mute: "ad_mute", unmute: "ad_unmute", grant: "ad_grant", rname: "ad_rname", del: "ad_del", res: "ad_resolve" }[k];
  const dur = k === "ban" || k === "mute" ? `<div class="pv-lab">${t("ad_dur")}</div><div class="seg small" id="aa-dur">${[[60, "ad_d1h"], [1440, "ad_d24"], [10080, "ad_d7"], [0, "ad_perm"]].map(([v, l], i) => `<button type="button" data-v="${v}" class="${i === 1 ? "on" : ""}">${t(l)}</button>`).join("")}</div>` : "";
  const gr = k === "grant" ? `<label class="pv-lab" for="aa-c">${t("ad_coins")}</label><input id="aa-c" inputmode="numeric" dir="ltr" maxlength="7" value="500"><label class="pv-lab" for="aa-i">${t("ad_items")}</label><input id="aa-i" dir="ltr" maxlength="200" placeholder="gt:lava, av:x1">` : "";
  c.innerHTML = `<h2>${t(ttl)}</h2>${o.name ? `<p class="fine" dir="auto">${esc(o.name)} · ${pidHtml(o.id)}</p>` : ""}${k === "del" ? `<p class="so-err">${t("ad_delQ")}</p>` : ""}<form class="ac-form col" id="aa-f">${dur}${gr}<label class="pv-lab" for="aa-r">${t("ad_reason")}</label><input id="aa-r" dir="auto" maxlength="200" placeholder="${t("ad_reasonPh")}"><p class="so-err" id="aa-e"></p><div class="ac-btns"><button class="btn gold ac-b" type="submit">${t("ad_confirm")}</button><button class="btn ac-b" type="button" id="aa-x">${t("pvCancel")}</button></div></form>`;
  m.classList.remove("x-hide"); let mins = 1440;
  c.querySelectorAll("#aa-dur button").forEach((b) => b.addEventListener("click", () => { mins = +b.dataset.v; c.querySelectorAll("#aa-dur button").forEach((x) => x.classList.toggle("on", x === b)); }));
  ui.click($("aa-x"), () => m.classList.add("x-hide"), "back");
  $("aa-f").addEventListener("submit", async (e) => { e.preventDefault(); const why = $("aa-r").value.trim(), err = $("aa-e"); if (why.length < 3) { err.textContent = t("ad_needReason"); return; }
    const a = { why }; if (k === "res") a.rid = o.rid; else a.id = o.id; if (k === "ban" || k === "mute") a.mins = mins;
    if (k === "grant") { a.coins = Math.max(0, Math.floor(+$("aa-c").value || 0)); a.items = $("aa-i").value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean); }
    const r = await adm("a_" + k, a); if (!r || !r.ok) { err.textContent = r && r.err === "reason" ? t("ad_needReason") : errText(r && r.err); return; }
    m.classList.add("x-hide"); ui.toast(t("ad_done") + (k === "grant" && r.live ? " · " + t("ad_live") : ""), "good", 2600);
    const A = AC.adm; if (k === "del") { A.view = null; A.list = null; } else if (k === "res") { A.reps = null; } else { const v = await adm("a_view", { id: o.id }); A.view = v && v.card ? v : A.view; } A.aud = null; renderAdmin(ui); });
  setTimeout(() => { const r = $("aa-r"); if (r && !(k === "grant")) r.focus(); }, 50);
}

// ---------- DOM ----------
const X_SVG = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const MAIL_SVG = '<svg viewBox="0 0 24 24" class="ac-ic"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>';
const APPLE_SVG = '<svg viewBox="0 0 24 24" class="ac-ic fill"><path d="M16.4 12.6c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.4-1-2.4-4.2ZM14 5.1c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z"/></svg>';
const G_SVG = '<svg viewBox="0 0 24 24" class="ac-ic gl"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.6Z"/><path fill="#34A853" d="M12 22.5c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10.4 10.4 0 0 0 12 22.5Z"/><path fill="#FBBC05" d="M6.2 14.1a6.3 6.3 0 0 1 0-4v-2.7H2.7a10.4 10.4 0 0 0 0 9.4l3.5-2.7Z"/><path fill="#EA4335" d="M12 5.6c1.5 0 2.9.5 4 1.6l3-3A10.4 10.4 0 0 0 2.7 7.4l3.5 2.7C7 7.5 9.3 5.6 12 5.6Z"/></svg>';
function injectDom(ui) {
  if ($("s-admin")) return;
  const sec = document.createElement("section"); sec.id = "s-admin"; sec.className = "screen panel";
  sec.innerHTML = `<header class="phead"><button class="icon-btn back" id="ad-x" data-ia="back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><h2 data-i="ac_admin"></h2>
    <div class="seg tabs" id="ad-tabs"><button data-v="dash" class="on" data-i="ad_dash"></button><button data-v="players" data-i="ad_players"></button><button data-v="live" data-i="ad_live2"></button><button data-v="eco" data-i="ad_eco"></button><button data-v="reports" data-i="ad_reports"></button><button data-v="log" data-i="ad_log"></button></div><div class="sp"></div></header>
    <div class="pbody"><div class="pcontent wide" id="ad-content"></div></div>`;
  const lobby = $("s-lobby"); lobby.parentNode.insertBefore(sec, lobby.nextSibling);
  ui.click($("ad-x"), () => { ui.prTab = "over"; ui.go("profile", "fade"); }, "back"); // back to the founder's Profile (the only way in)
  $("ad-tabs").querySelectorAll("button").forEach((b) => ui.click(b, () => { const A = AC.adm; A.tab = b.dataset.v; a2Reset(A.tab); if (A.tab === "dash") A.srv = null; if (A.tab === "reports") A.reps = null; if (A.tab === "log") A.aud = null; renderAdmin(ui); }, "tab"));
  sec.querySelectorAll("[data-i]").forEach((el) => (el.textContent = t(el.dataset.i)));
  for (const [id, cls] of [["m-acem", "ac-em"], ["m-adact", "ad-act"]]) { const m = document.createElement("div"); m.id = id; m.className = "modal x-hide"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.innerHTML = `<div class="glass mcard ${cls}" id="${id}-c"></div>`; document.body.appendChild(m); m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("x-hide"); }); }
  const f = document.createElement("div"); f.id = "mm-find"; f.className = "mm-find x-hide"; f.setAttribute("role", "status"); f.setAttribute("aria-live", "polite");
  f.innerHTML = `<div class="mmf-card"><i class="mmf-dot" aria-hidden="true"></i><div><b id="mmf-t"></b><small id="mmf-s"></small></div></div>`; document.body.appendChild(f);
}

addStrings({
  ac_title: ["Save your progress", "احفظ تقدّمك", "İlerlemeni kaydet", "Sauvegarde ta progression", "Guarda tu progreso", "अपनी प्रगति सहेजें"],
  ac_sub: ["Sign in to keep your ID, friends, trophies, coins and items when you change device.", "سجّل دخول حتى يبقى الآيدي والأصدقاء والكؤوس والكوينز والأغراض مالتك لو بدّلت الجهاز.", "Cihaz değiştirdiğinde kimliğin, arkadaşların, kupaların, paraların ve eşyaların kalsın diye giriş yap.", "Connecte-toi pour garder ton ID, tes amis, trophées, pièces et objets si tu changes d'appareil.", "Inicia sesión para conservar tu ID, amigos, trofeos, monedas y objetos al cambiar de dispositivo.", "डिवाइस बदलने पर भी अपनी ID, दोस्त, ट्रॉफी, सिक्के और आइटम रखने के लिए साइन इन करें।"],
  ac_note: ["If the account already exists, its progress replaces what is on this device.", "إذا الحساب موجود من قبل، تقدّمه يحلّ محل اللي على هذا الجهاز.", "Hesap zaten varsa, bu cihazdakinin yerine onun ilerlemesi gelir.", "Si le compte existe déjà, sa progression remplace celle de cet appareil.", "Si la cuenta ya existe, su progreso sustituye al de este dispositivo.", "अगर खाता पहले से है, तो उसकी प्रगति इस डिवाइस वाली की जगह ले लेगी।"],
  ac_soon: ["Sign-in is being set up. Until then your progress is saved on this device and backed up to the server automatically.", "تسجيل الدخول ديتجهّز. لحد ذاك الوقت تقدّمك محفوظ على هذا الجهاز وينحفظ نسخة بالسيرفر تلقائياً.", "Giriş hazırlanıyor. O zamana kadar ilerlemen bu cihazda kayıtlı ve sunucuya otomatik yedekleniyor.", "La connexion arrive bientôt. D'ici là, ta progression est enregistrée sur cet appareil et sauvegardée sur le serveur.", "El inicio de sesión llega pronto. Mientras tanto tu progreso se guarda en este dispositivo y se respalda en el servidor.", "साइन-इन तैयार हो रहा है। तब तक आपकी प्रगति इस डिवाइस पर सहेजी जाती है और सर्वर पर अपने-आप बैकअप होती है।"],
  ac_google: ["Continue with Google", "المتابعة عبر Google", "Google ile devam et", "Continuer avec Google", "Continuar con Google", "Google से जारी रखें"],
  ac_apple: ["Sign in with Apple", "تسجيل الدخول عبر Apple", "Apple ile giriş yap", "Se connecter avec Apple", "Iniciar sesión con Apple", "Apple से साइन इन करें"],
  ac_email: ["Continue with email", "المتابعة بالإيميل", "E-posta ile devam et", "Continuer avec un e-mail", "Continuar con correo", "ईमेल से जारी रखें"],
  ac_m_e: ["Email", "إيميل", "E-posta", "E-mail", "Correo", "ईमेल"],
  ac_in: ["Signed in", "مسجّل دخول", "Giriş yapıldı", "Connecté", "Sesión iniciada", "साइन इन है"],
  ac_saved: ["Saved to your account {t}", "انحفظ بحسابك {t}", "Hesabına kaydedildi: {t}", "Enregistré sur ton compte {t}", "Guardado en tu cuenta {t}", "आपके खाते में सहेजा गया {t}"],
  ac_autosave: ["Your progress is saved to your account automatically.", "تقدّمك ينحفظ بحسابك تلقائياً.", "İlerlemen hesabına otomatik kaydedilir.", "Ta progression est enregistrée automatiquement sur ton compte.", "Tu progreso se guarda automáticamente en tu cuenta.", "आपकी प्रगति अपने-आप आपके खाते में सहेजी जाती है।"],
  ac_justNow: ["just now", "هسه", "az önce", "à l'instant", "ahora mismo", "अभी"],
  ac_minAgo: ["{n} min ago", "قبل {n} دقيقة", "{n} dk önce", "il y a {n} min", "hace {n} min", "{n} मिनट पहले"],
  ac_add: ["Add another way to sign in", "ضيف طريقة دخول ثانية", "Başka bir giriş yolu ekle", "Ajouter un autre moyen de connexion", "Añadir otra forma de entrar", "साइन इन का एक और तरीका जोड़ें"],
  ac_out: ["Sign out", "تسجيل الخروج", "Çıkış yap", "Se déconnecter", "Cerrar sesión", "साइन आउट"],
  ac_del: ["Delete account", "حذف الحساب", "Hesabı sil", "Supprimer le compte", "Eliminar cuenta", "खाता हटाएं"],
  ac_outQ: ["Sign out? Your progress stays in your account. This device goes back to its own profile.", "تطلع من الحساب؟ تقدّمك يبقى بالحساب، وهذا الجهاز يرجع لملفه الخاص.", "Çıkış yapılsın mı? İlerlemen hesabında kalır. Bu cihaz kendi profiline döner.", "Se déconnecter ? Ta progression reste sur ton compte. Cet appareil revient à son propre profil.", "¿Cerrar sesión? Tu progreso se queda en tu cuenta. Este dispositivo vuelve a su propio perfil.", "साइन आउट करें? आपकी प्रगति खाते में रहेगी। यह डिवाइस अपनी प्रोफ़ाइल पर लौट जाएगा।"],
  ac_delQ: ["Delete your account for good? Your ID, friends, chats, Special IDs and saved progress are removed from the server. This can't be undone.", "تحذف حسابك نهائياً؟ الآيدي والأصدقاء والمحادثات والآيديات المميزة والتقدّم المحفوظ تنمسح من السيرفر. ما ينرجع.", "Hesabın kalıcı olarak silinsin mi? Kimliğin, arkadaşların, sohbetlerin, Özel Kimliklerin ve kayıtlı ilerlemen sunucudan silinir. Geri alınamaz.", "Supprimer ton compte définitivement ? Ton ID, tes amis, discussions, ID spéciaux et ta progression sont effacés du serveur. C'est irréversible.", "¿Eliminar tu cuenta para siempre? Tu ID, amigos, chats, ID especiales y progreso guardado se borran del servidor. No se puede deshacer.", "खाता हमेशा के लिए हटाएं? आपकी ID, दोस्त, चैट, स्पेशल ID और सहेजी प्रगति सर्वर से मिट जाएगी। यह वापस नहीं होगा।"],
  ac_outDone: ["Signed out. Sign in again to get your progress back.", "طلعت من الحساب. سجّل دخول مرة ثانية حتى يرجع تقدّمك.", "Çıkış yapıldı. İlerlemeni geri almak için tekrar giriş yap.", "Déconnecté. Reconnecte-toi pour retrouver ta progression.", "Sesión cerrada. Vuelve a entrar para recuperar tu progreso.", "साइन आउट हो गया। प्रगति वापस पाने के लिए फिर से साइन इन करें।"],
  ac_delDone: ["Account deleted.", "انحذف الحساب.", "Hesap silindi.", "Compte supprimé.", "Cuenta eliminada.", "खाता हटा दिया गया।"],
  ac_new: ["Signed in. Your progress is now saved to your account.", "تم الدخول. تقدّمك صار ينحفظ بحسابك.", "Giriş yapıldı. İlerlemen artık hesabına kaydediliyor.", "Connecté. Ta progression est maintenant enregistrée sur ton compte.", "Sesión iniciada. Tu progreso ya se guarda en tu cuenta.", "साइन इन हो गया। अब आपकी प्रगति खाते में सहेजी जाती है।"],
  ac_back: ["Welcome back, {n}! Your account is restored on this device.", "هلا بيك من جديد {n}! رجع حسابك على هذا الجهاز.", "Tekrar hoş geldin {n}! Hesabın bu cihaza geri yüklendi.", "Bon retour, {n} ! Ton compte est restauré sur cet appareil.", "¡Bienvenido de nuevo, {n}! Tu cuenta está restaurada en este dispositivo.", "वापसी पर स्वागत है, {n}! आपका खाता इस डिवाइस पर बहाल हो गया।"],
  ac_added: ["Sign-in method added.", "انضافت طريقة الدخول.", "Giriş yöntemi eklendi.", "Moyen de connexion ajouté.", "Método de inicio añadido.", "साइन-इन तरीका जोड़ा गया।"],
  ac_emTitle: ["Sign in with email", "الدخول بالإيميل", "E-posta ile giriş", "Connexion par e-mail", "Entrar con correo", "ईमेल से साइन इन"],
  ac_emSub: ["We'll send a 6-digit code to your inbox.", "راح نرسل رمز من 6 أرقام لإيميلك.", "Gelen kutuna 6 haneli bir kod göndereceğiz.", "On t'envoie un code à 6 chiffres.", "Te enviaremos un código de 6 dígitos.", "हम आपके इनबॉक्स में 6 अंकों का कोड भेजेंगे।"],
  ac_emPh: ["you@example.com", "you@example.com", "sen@example.com", "toi@example.com", "tu@example.com", "you@example.com"],
  ac_send: ["Send code", "أرسل الرمز", "Kod gönder", "Envoyer le code", "Enviar código", "कोड भेजें"],
  ac_codeSub: ["Enter the code sent to {e}", "اكتب الرمز اللي انرسل لـ {e}", "{e} adresine gönderilen kodu gir", "Saisis le code envoyé à {e}", "Escribe el código enviado a {e}", "{e} पर भेजा गया कोड डालें"],
  ac_codePh: ["6-digit code", "رمز من 6 أرقام", "6 haneli kod", "Code à 6 chiffres", "Código de 6 dígitos", "6 अंकों का कोड"],
  ac_verify: ["Verify", "تأكيد", "Doğrula", "Vérifier", "Verificar", "पुष्टि करें"],
  ac_resend: ["Use another email", "استخدم إيميل ثاني", "Başka e-posta kullan", "Utiliser un autre e-mail", "Usar otro correo", "दूसरा ईमेल इस्तेमाल करें"],
  ac_e_email: ["That email doesn't look right.", "الإيميل مو صحيح.", "Bu e-posta doğru görünmüyor.", "Cet e-mail ne semble pas valide.", "Ese correo no parece correcto.", "यह ईमेल सही नहीं लग रहा।"],
  ac_e_mail_off: ["Email sign-in isn't available yet.", "الدخول بالإيميل مو متوفر بعد.", "E-posta ile giriş henüz yok.", "La connexion par e-mail n'est pas encore disponible.", "El acceso por correo aún no está disponible.", "ईमेल साइन-इन अभी उपलब्ध नहीं है।"],
  ac_e_mail_fail: ["The email couldn't be sent. Try again later.", "ما كدرنا نرسل الإيميل. جرّب بعدين.", "E-posta gönderilemedi. Sonra tekrar dene.", "L'e-mail n'a pas pu être envoyé. Réessaie plus tard.", "No se pudo enviar el correo. Inténtalo más tarde.", "ईमेल नहीं भेजा जा सका। बाद में कोशिश करें।"],
  ac_e_code: ["Wrong code. {n} tries left.", "الرمز غلط. باقي {n} محاولات.", "Yanlış kod. {n} hak kaldı.", "Code incorrect. {n} essais restants.", "Código incorrecto. Quedan {n} intentos.", "गलत कोड। {n} कोशिशें बाकी।"],
  ac_e_expired: ["The code expired. Ask for a new one.", "الرمز انتهى. اطلب واحد جديد.", "Kodun süresi doldu. Yenisini iste.", "Le code a expiré. Demandes-en un nouveau.", "El código caducó. Pide uno nuevo.", "कोड की समय-सीमा खत्म हुई। नया मांगें।"],
  ac_e_tries: ["Too many tries. Ask for a new code.", "محاولات هواية. اطلب رمز جديد.", "Çok fazla deneme. Yeni kod iste.", "Trop d'essais. Demande un nouveau code.", "Demasiados intentos. Pide un código nuevo.", "बहुत ज़्यादा कोशिशें। नया कोड मांगें।"],
  ac_e_token: ["Sign-in didn't work. Please try again.", "الدخول ما زبط. جرّب مرة ثانية.", "Giriş olmadı. Lütfen tekrar dene.", "La connexion a échoué. Réessaie.", "No se pudo iniciar sesión. Inténtalo de nuevo.", "साइन इन नहीं हुआ। फिर से कोशिश करें।"],
  ac_e_nonce: ["Sign-in took too long. Please try again.", "الدخول طوّل. جرّب مرة ثانية.", "Giriş çok uzun sürdü. Tekrar dene.", "La connexion a pris trop de temps. Réessaie.", "El inicio tardó demasiado. Inténtalo de nuevo.", "साइन इन में बहुत देर हुई। फिर कोशिश करें।"],
  ac_e_has: ["This account already has that sign-in method.", "هذا الحساب بيه نفس طريقة الدخول من قبل.", "Bu hesapta bu giriş yöntemi zaten var.", "Ce compte a déjà ce moyen de connexion.", "Esta cuenta ya tiene ese método.", "इस खाते में यह तरीका पहले से है।"],
  ac_e_owner: ["The founder account can't be deleted.", "حساب المؤسس ما ينحذف.", "Kurucu hesabı silinemez.", "Le compte du fondateur ne peut pas être supprimé.", "La cuenta del fundador no se puede eliminar.", "संस्थापक का खाता नहीं हटाया जा सकता।"],
  ac_e_none: ["You're not signed in.", "انت مو مسجّل دخول.", "Giriş yapmadın.", "Tu n'es pas connecté.", "No has iniciado sesión.", "आप साइन इन नहीं हैं।"],
  ac_banned: ["Your account is suspended until {d}.", "حسابك موقوف لحد {d}.", "Hesabın {d} tarihine kadar askıya alındı.", "Ton compte est suspendu jusqu'au {d}.", "Tu cuenta está suspendida hasta el {d}.", "आपका खाता {d} तक निलंबित है।"],
  ac_bannedP: ["Your account is suspended.", "حسابك موقوف.", "Hesabın askıya alındı.", "Ton compte est suspendu.", "Tu cuenta está suspendida.", "आपका खाता निलंबित है।"],
  ac_unbanned: ["Your suspension has ended.", "انتهى إيقاف حسابك.", "Askıya alma sona erdi.", "Ta suspension est levée.", "Tu suspensión ha terminado.", "आपका निलंबन खत्म हो गया।"],
  ac_muted: ["You're muted in chat until {d}.", "انت مكتوم بالدردشة لحد {d}.", "{d} tarihine kadar sohbette susturuldun.", "Tu es muet dans le chat jusqu'au {d}.", "Estás silenciado en el chat hasta el {d}.", "आप {d} तक चैट में म्यूट हैं।"],
  ac_unmuted: ["You can chat again.", "تكدر تدردش مرة ثانية.", "Tekrar sohbet edebilirsin.", "Tu peux de nouveau discuter.", "Ya puedes volver a chatear.", "आप फिर से चैट कर सकते हैं।"],
  ac_renamed: ["Your name was reset by a moderator.", "المشرف رجّع اسمك للاسم الافتراضي.", "Adın bir moderatör tarafından sıfırlandı.", "Ton nom a été réinitialisé par un modérateur.", "Un moderador restableció tu nombre.", "एक मॉडरेटर ने आपका नाम रीसेट किया।"],
  ac_gift: ["🎁 The Super Snake team sent you {n} coins", "🎁 فريق سوبر سنيك دزّلك {n} كوين", "🎁 Super Snake ekibi sana {n} para gönderdi", "🎁 L'équipe Super Snake t'a envoyé {n} pièces", "🎁 El equipo de Super Snake te envió {n} monedas", "🎁 Super Snake टीम ने आपको {n} सिक्के भेजे"],
  ac_giftIt: ["🎁 The Super Snake team sent you a gift", "🎁 فريق سوبر سنيك دزّلك هدية", "🎁 Super Snake ekibi sana bir hediye gönderdi", "🎁 L'équipe Super Snake t'a envoyé un cadeau", "🎁 El equipo de Super Snake te envió un regalo", "🎁 Super Snake टीम ने आपको एक उपहार भेजा"],
  ac_admin: ["Owner panel", "لوحة المالك", "Sahip paneli", "Panneau du fondateur", "Panel del dueño", "मालिक पैनल"],
  so_e_muted: ["You're muted in chat right now.", "انت مكتوم بالدردشة هسه.", "Şu an sohbette susturuldun.", "Tu es muet dans le chat pour l'instant.", "Ahora mismo estás silenciado en el chat.", "आप अभी चैट में म्यूट हैं।"],
  so_e_banned: ["Your account is suspended.", "حسابك موقوف.", "Hesabın askıya alındı.", "Ton compte est suspendu.", "Tu cuenta está suspendida.", "आपका खाता निलंबित है।"],
  so_e_forbidden: ["Only the founder account can do that.", "بس حساب المؤسس يكدر يسوي هذا.", "Bunu yalnızca kurucu hesabı yapabilir.", "Seul le compte du fondateur peut faire ça.", "Solo la cuenta del fundador puede hacerlo.", "यह केवल संस्थापक खाता कर सकता है।"],
  so_e_notfound: ["No player with that ID.", "ماكو لاعب بهذا الآيدي.", "Bu kimlikle oyuncu yok.", "Aucun joueur avec cet ID.", "No hay jugador con ese ID.", "इस ID का कोई खिलाड़ी नहीं।"],
  so_e_owner: ["The founder account can't be changed here.", "حساب المؤسس ما يتغيّر من هنا.", "Kurucu hesabı burada değiştirilemez.", "Le compte du fondateur ne peut pas être modifié ici.", "La cuenta del fundador no se puede cambiar aquí.", "संस्थापक खाता यहाँ नहीं बदला जा सकता।"],
  so_e_empty: ["Add coins or an item.", "ضيف كوينز أو غرض.", "Para veya eşya ekle.", "Ajoute des pièces ou un objet.", "Añade monedas o un objeto.", "सिक्के या आइटम जोड़ें।"],
  mm_find: ["Finding a server…", "ديندوّر على سيرفر…", "Sunucu aranıyor…", "Recherche d'un serveur…", "Buscando servidor…", "सर्वर ढूंढ रहे हैं…"],
  mm_wait: ["Looking for players at your level…", "ديندوّر على لاعبين بمستواك…", "Seviyende oyuncular aranıyor…", "Recherche de joueurs de ton niveau…", "Buscando jugadores de tu nivel…", "आपके स्तर के खिलाड़ी ढूंढ रहे हैं…"],
  mm_join: ["Joining {s}…", "ديندخل {s}…", "{s} sunucusuna giriliyor…", "Connexion à {s}…", "Entrando en {s}…", "{s} में शामिल हो रहे हैं…"],
  mm_server: ["Server: {s} · {n} players", "السيرفر: {s} · {n} لاعب", "Sunucu: {s} · {n} oyuncu", "Serveur : {s} · {n} joueurs", "Servidor: {s} · {n} jugadores", "सर्वर: {s} · {n} खिलाड़ी"],
  mm_bots: ["{n} bots", "{n} بوت", "{n} bot", "{n} bots", "{n} bots", "{n} बॉट"],
  mm_br: ["Bracket: {b}", "الفئة: {b}", "Lig grubu: {b}", "Groupe : {b}", "Grupo: {b}", "समूह: {b}"],
  mm_fb: ["Few players at your level right now: you joined the nearest bracket.", "ماكو هواية لاعبين بمستواك هسه: دخلت أقرب فئة.", "Şu an seviyende az oyuncu var: en yakın gruba katıldın.", "Peu de joueurs de ton niveau en ce moment : tu as rejoint le groupe voisin.", "Hay pocos jugadores de tu nivel ahora: entraste en el grupo más cercano.", "अभी आपके स्तर के कम खिलाड़ी हैं: आप सबसे नज़दीकी समूह में गए।"],
  mm_friend: ["Friend room", "غرفة الأصدقاء", "Arkadaş odası", "Salon d'amis", "Sala de amigos", "दोस्तों का रूम"],
  mm_public: ["Public #{n}", "عام #{n}", "Herkese açık #{n}", "Public #{n}", "Público #{n}", "पब्लिक #{n}"],
  br_bs: ["Bronze–Silver", "برونز–فضة", "Bronz–Gümüş", "Bronze–Argent", "Bronce–Plata", "ब्रॉन्ज़–सिल्वर"],
  br_gp: ["Gold–Platinum", "ذهب–بلاتين", "Altın–Platin", "Or–Platine", "Oro–Platino", "गोल्ड–प्लैटिनम"],
  br_dc: ["Diamond–Crown", "ألماس–تاج", "Elmas–Taç", "Diamant–Couronne", "Diamante–Corona", "डायमंड–क्राउन"],
  br_cq: ["Conqueror", "الفاتح", "Fatih", "Conquérant", "Conquistador", "विजेता"],
  ad_entrySub: ["Players, reports, live servers and the audit log. Only your founder account can open it.", "اللاعبين والبلاغات والسيرفرات الشغالة وسجل الإجراءات. بس حساب المؤسس مالتك يكدر يفتحها.", "Oyuncular, raporlar, canlı sunucular ve denetim kaydı. Yalnızca kurucu hesabın açabilir.", "Joueurs, signalements, serveurs en direct et journal. Seul ton compte fondateur peut l'ouvrir.", "Jugadores, reportes, servidores en vivo y registro. Solo tu cuenta de fundador puede abrirlo.", "खिलाड़ी, रिपोर्ट, लाइव सर्वर और ऑडिट लॉग। केवल आपका संस्थापक खाता इसे खोल सकता है।"],
  ad_dash: ["Dashboard", "لوحة المتابعة", "Pano", "Tableau de bord", "Panel", "डैशबोर्ड"],
  ad_players: ["Players", "اللاعبين", "Oyuncular", "Joueurs", "Jugadores", "खिलाड़ी"],
  ad_reports: ["Reports", "البلاغات", "Raporlar", "Signalements", "Reportes", "रिपोर्ट"],
  ad_log: ["Audit log", "سجل الإجراءات", "Denetim kaydı", "Journal", "Registro", "ऑडिट लॉग"],
  ad_online: ["Online", "متصلين", "Çevrimiçi", "En ligne", "En línea", "ऑनलाइन"],
  ad_lobby: ["In lobby", "باللوبي", "Lobide", "Au lobby", "En el lobby", "लॉबी में"],
  ad_match: ["In a match", "بمباراة", "Maçta", "En partie", "En partida", "मैच में"],
  ad_rooms: ["Live rooms", "الغرف الشغالة", "Canlı odalar", "Salons en direct", "Salas en vivo", "लाइव रूम"],
  ad_msgs: ["Messages / min", "رسائل / دقيقة", "Mesaj / dk", "Messages / min", "Mensajes / min", "संदेश / मिनट"],
  ad_errs: ["Errors", "الأخطاء", "Hatalar", "Erreurs", "Errores", "त्रुटियां"],
  ad_room: ["Server", "السيرفر", "Sunucu", "Serveur", "Servidor", "सर्वर"],
  ad_bracket: ["Bracket", "الفئة", "Grup", "Groupe", "Grupo", "समूह"],
  ad_humans: ["Players", "لاعبين", "Oyuncu", "Joueurs", "Jugadores", "खिलाड़ी"],
  ad_botsH: ["Bots", "بوتات", "Bot", "Bots", "Bots", "बॉट"],
  ad_up: ["Up", "شغال من", "Süre", "Actif", "Activo", "चालू"],
  ad_noRooms: ["No live rooms right now.", "ماكو غرف شغالة هسه.", "Şu an canlı oda yok.", "Aucun salon en direct.", "No hay salas en vivo ahora.", "अभी कोई लाइव रूम नहीं।"],
  ad_total: ["{p} players · {a} accounts · {r} open reports", "{p} لاعب · {a} حساب · {r} بلاغ مفتوح", "{p} oyuncu · {a} hesap · {r} açık rapor", "{p} joueurs · {a} comptes · {r} signalements ouverts", "{p} jugadores · {a} cuentas · {r} reportes abiertos", "{p} खिलाड़ी · {a} खाते · {r} खुली रिपोर्ट"],
  ad_refresh: ["Refresh", "تحديث", "Yenile", "Actualiser", "Actualizar", "रीफ़्रेश"],
  ad_search: ["Player ID or name", "آيدي اللاعب أو اسمه", "Oyuncu kimliği veya adı", "ID ou nom du joueur", "ID o nombre del jugador", "खिलाड़ी ID या नाम"],
  ad_noRes: ["No players found.", "ماكو لاعبين.", "Oyuncu bulunamadı.", "Aucun joueur trouvé.", "No se encontraron jugadores.", "कोई खिलाड़ी नहीं मिला।"],
  ad_coins: ["Coins", "الكوينز", "Para", "Pièces", "Monedas", "सिक्के"],
  ad_level: ["Level", "المستوى", "Seviye", "Niveau", "Nivel", "स्तर"],
  ad_acct: ["Sign-in", "الدخول", "Giriş", "Connexion", "Acceso", "साइन-इन"],
  ad_none: ["None (this device only)", "ماكو (بس هذا الجهاز)", "Yok (yalnızca cihaz)", "Aucune (appareil seul)", "Ninguno (solo dispositivo)", "कोई नहीं (केवल डिवाइस)"],
  ad_seen: ["Last seen", "آخر ظهور", "Son görülme", "Vu", "Última vez", "आखिरी बार"],
  ad_devices: ["Devices", "الأجهزة", "Cihazlar", "Appareils", "Dispositivos", "डिवाइस"],
  ad_linked: ["signed in", "مسجّل", "girişli", "connecté", "con sesión", "साइन इन"],
  ad_repsAbout: ["Reports about this player", "بلاغات على هذا اللاعب", "Bu oyuncu hakkındaki raporlar", "Signalements sur ce joueur", "Reportes sobre este jugador", "इस खिलाड़ी की रिपोर्ट"],
  ad_noReps: ["No reports.", "ماكو بلاغات.", "Rapor yok.", "Aucun signalement.", "Sin reportes.", "कोई रिपोर्ट नहीं।"],
  ad_status: ["Status", "الحالة", "Durum", "Statut", "Estado", "स्थिति"],
  ad_ok: ["Good standing", "وضعه سليم", "Sorunsuz", "En règle", "En regla", "ठीक है"],
  ad_bannedU: ["Banned until {d}", "محظور لحد {d}", "{d} tarihine kadar yasaklı", "Banni jusqu'au {d}", "Baneado hasta el {d}", "{d} तक प्रतिबंधित"],
  ad_bannedP: ["Banned permanently", "محظور نهائياً", "Kalıcı yasaklı", "Banni définitivement", "Baneado para siempre", "स्थायी रूप से प्रतिबंधित"],
  ad_mutedU: ["Muted until {d}", "مكتوم لحد {d}", "{d} tarihine kadar susturuldu", "Muet jusqu'au {d}", "Silenciado hasta el {d}", "{d} तक म्यूट"],
  ad_actions: ["Actions", "الإجراءات", "İşlemler", "Actions", "Acciones", "कार्रवाइयां"],
  ad_ban: ["Ban", "حظر", "Yasakla", "Bannir", "Banear", "प्रतिबंध"],
  ad_unban: ["Unban", "فك الحظر", "Yasağı kaldır", "Débannir", "Quitar ban", "प्रतिबंध हटाएं"],
  ad_mute: ["Mute chat", "كتم الدردشة", "Sohbeti sustur", "Rendre muet", "Silenciar chat", "चैट म्यूट"],
  ad_unmute: ["Unmute", "فك الكتم", "Susturmayı kaldır", "Rétablir le chat", "Quitar silencio", "अनम्यूट"],
  ad_grant: ["Give coins / items", "إعطاء كوينز / أغراض", "Para / eşya ver", "Donner pièces / objets", "Dar monedas / objetos", "सिक्के / आइटम दें"],
  ad_grantS: ["Gift", "هدية", "Hediye", "Cadeau", "Regalo", "उपहार"],
  ad_rname: ["Reset name", "تصفير الاسم", "Adı sıfırla", "Réinitialiser le nom", "Restablecer nombre", "नाम रीसेट"],
  ad_del: ["Remove account", "حذف الحساب", "Hesabı kaldır", "Supprimer le compte", "Eliminar cuenta", "खाता हटाएं"],
  ad_delQ: ["This removes the account for good: everything about it is deleted from the server.", "هذا يحذف الحساب نهائياً: كل شي يخصه ينمسح من السيرفر.", "Bu hesabı kalıcı olarak kaldırır: ona ait her şey sunucudan silinir.", "Le compte sera supprimé définitivement du serveur.", "La cuenta se borrará para siempre del servidor.", "यह खाता हमेशा के लिए हटाता है: इसका सब कुछ सर्वर से मिट जाएगा।"],
  ad_reason: ["Reason", "السبب", "Sebep", "Raison", "Motivo", "कारण"],
  ad_reasonPh: ["Why? This goes into the audit log.", "ليش؟ ينكتب بسجل الإجراءات.", "Neden? Denetim kaydına yazılır.", "Pourquoi ? C'est noté dans le journal.", "¿Por qué? Se guarda en el registro.", "क्यों? यह ऑडिट लॉग में जाएगा।"],
  ad_needReason: ["Write a reason (at least 3 letters).", "اكتب سبب (3 أحرف على الأقل).", "Bir sebep yaz (en az 3 harf).", "Écris une raison (3 lettres minimum).", "Escribe un motivo (mínimo 3 letras).", "कारण लिखें (कम से कम 3 अक्षर)।"],
  ad_dur: ["Duration", "المدة", "Süre", "Durée", "Duración", "अवधि"],
  ad_d1h: ["1 h", "ساعة", "1 sa", "1 h", "1 h", "1 घंटा"],
  ad_d24: ["24 h", "24 ساعة", "24 sa", "24 h", "24 h", "24 घंटे"],
  ad_d7: ["7 days", "7 أيام", "7 gün", "7 jours", "7 días", "7 दिन"],
  ad_perm: ["Permanent", "نهائي", "Kalıcı", "Définitif", "Permanente", "स्थायी"],
  ad_items: ["Items (ids, comma separated)", "أغراض (آيديات مفصولة بفارزة)", "Eşyalar (virgülle ayrılmış)", "Objets (ids séparés par des virgules)", "Objetos (ids separados por comas)", "आइटम (कॉमा से अलग ID)"],
  ad_confirm: ["Confirm", "تأكيد", "Onayla", "Confirmer", "Confirmar", "पुष्टि करें"],
  ad_done: ["Done ✓", "تم ✓", "Tamam ✓", "Fait ✓", "Hecho ✓", "हो गया ✓"],
  ad_live: ["delivered live", "وصل مباشرة", "anında iletildi", "livré en direct", "entregado al momento", "तुरंत पहुंचा"],
  ad_resolve: ["Mark resolved", "تم الحل", "Çözüldü işaretle", "Marquer résolu", "Marcar resuelto", "हल किया गया"],
  ad_resolved: ["Resolved", "محلول", "Çözüldü", "Résolu", "Resuelto", "हल"],
  ad_open: ["Open", "مفتوح", "Açık", "Ouvert", "Abierto", "खुला"],
  ad_by: ["Reported by {n}", "بلّغ عنه {n}", "Bildiren: {n}", "Signalé par {n}", "Reportado por {n}", "{n} ने रिपोर्ट किया"],
  ad_view: ["View player", "عرض اللاعب", "Oyuncuyu gör", "Voir le joueur", "Ver jugador", "खिलाड़ी देखें"],
  ad_t: ["Time", "الوقت", "Zaman", "Heure", "Hora", "समय"],
  ad_act: ["Action", "الإجراء", "İşlem", "Action", "Acción", "कार्रवाई"],
  ad_tgt: ["Player", "اللاعب", "Oyuncu", "Joueur", "Jugador", "खिलाड़ी"],
  ad_noLog: ["Nothing logged yet.", "ماكو شي بالسجل بعد.", "Henüz kayıt yok.", "Rien dans le journal.", "Nada registrado aún.", "अभी कुछ लॉग नहीं।"],
  ad_forbidden: ["Only the founder account can open this.", "بس حساب المؤسس يكدر يفتح هذا.", "Bunu yalnızca kurucu hesabı açabilir.", "Seul le compte du fondateur peut ouvrir ceci.", "Solo la cuenta del fundador puede abrir esto.", "इसे केवल संस्थापक खाता खोल सकता है।"],
  ad_sus: ["Coin checks cut this player's balance {n} times.", "فحص الكوينز قصّ رصيد هذا اللاعب {n} مرات.", "Para kontrolü bu oyuncunun bakiyesini {n} kez kırptı.", "Le contrôle des pièces a réduit ce solde {n} fois.", "El control de monedas recortó este saldo {n} veces.", "सिक्का जांच ने इस खिलाड़ी का बैलेंस {n} बार घटाया।"],
});
