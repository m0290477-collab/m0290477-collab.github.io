// comp1: Competitions screen (League · Weekly · Monthly · Badges), lobby chip, results trophy row, profile league card,
// HUD league tags. Works offline (own progress + milestones); the online boards load from the server when reachable.
import { t, fmtNum, addStrings, LANG } from "./i18n.js?v=trail1";
import { fmtLeft } from "./offers.js?v=trail1";
import { FRAMES, TITLES, avatarHtml } from "./profile.js?v=trail1";
import { LEAGUES, TROPHY, leagueOf, CONTESTS, botTrophies, leagueBadge, leagueName, trophyIcon, badgeImg, trophies, myLeague, ROMAN, SEASON_COINS, CONQ_REWARD, rankReward, MILE, MILE_COINS, BADGE_OF, BADGES,
  localVal, mileKey, claimMilestone, contestTick, seasonTick, syncMe, top, lastMe, nowMs, contestEnds, applyServer } from "./league.js?v=trail1";
import { periodEnd } from "./sim.js?v=trail1";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SRV_KEY = { w_rush: "wtr", w_hunt: "wkl", w_score: "wsc", m_rush: "mtr", m_hunt: "mkl", m_score: "msc" };
const MET_IC = { tr: "rw_c_rush", kl: "rw_c_hunt", sc: "rw_c_score" };
const cosLabel = (c) => { const [k, v] = c.split(":"); if (k === "fr") return t("frameR") + " · " + t("fr_" + FRAMES[+v].id); if (k === "ti") return t("titleR") + " · " + t("ti_" + TITLES[+v].id); if (k === "bd") return t("badgeR") + " · " + t("bd_" + v); return c; };
const rwHtml = (rw) => (rw ? `<span class="cp-rw">◆ ${fmtNum(rw.coins)}${rw.cos.map((c) => `<em>${esc(cosLabel(c))}</em>`).join("")}</span>` : "");

// ---------- reusable small pieces ----------
export function lobbyChip(ui) {
  const el = $("l-comp"); if (!el) return; const p = ui.p, L = myLeague(p);
  el.innerHTML = `${leagueBadge(trophies(p), { size: "m", conq: L.conq })}<span class="lc-t"><b>${fmtNum(trophies(p))}</b><small>${esc(leagueName(L, L.conq))}</small></span><i class="dot x-hide" id="l-cdot"></i>`;
  el.setAttribute("aria-label", t("compT") + " · " + leagueName(L, L.conq) + " · " + t("trophyN", { n: fmtNum(trophies(p)) }));
  $("l-cdot").classList.toggle("x-hide", !hasClaimable(ui.S));
}
export function hasClaimable(S) { const p = S.p; contestTick(S); return CONTESTS.some((c) => MILE[c.per][c.met].some((g, i) => localVal(p, c) >= g && !p.rc.includes(mileKey(c, p.cx[c.per], i)))); }
export function profileLeagueCard(p) {
  const T = trophies(p), L = myLeague(p), span = L.hi ? L.hi - L.lo : 0, nx = L.hi ? leagueOf(L.hi) : null;
  return `<div class="pv-h">${t("leagueT")}</div><div class="pv-rk">${leagueBadge(T, { size: "l", conq: L.conq })}<div style="flex:1"><b>${esc(leagueName(L, L.conq))}</b> <span class="fine">· ${trophyIcon(14)} ${fmtNum(T)}${nx ? " · " + t("toNextL", { n: fmtNum(L.hi - T), r: leagueName(nx) }) : ""}</span>${span ? `<div class="xpbar"><i style="width:${Math.round(((T - L.lo) / span) * 100)}%"></i></div>` : ""}</div></div>
    <div class="pv-ladder lg-ladder">` + LEAGUES.map((K, i) => `<div class="${i <= L.li ? "on" : ""}">${leagueBadge(K.t0, { size: "s" })}<small>${t("lg_" + K.id)}</small></div>`).join("") + `<div class="${L.conq ? "on" : ""}">${leagueBadge(LEAGUES[5].t0, { size: "s", conq: 1 })}<small>${t("lg_conq")}</small></div></div>`;
}
// HUD top list: tiny league tag before a name (own trophies for you, server value online, stable value for offline bots)
const TAGC = new Map();
export function hudTag(s, me, myT, online) {
  let tr = s === me ? myT : s.tr; if (tr == null && !online) tr = s.tr = botTrophies((s.id | 0) * 31 + (s.name ? s.name.length : 0), myT);
  if (!(tr >= 0)) return ""; const L = leagueOf(tr), k = L.id; let h = TAGC.get(k); if (!h) { h = `<img class="lgt" src="assets/lg/lg_${k}_64.webp" alt="" decoding="async" draggable="false">`; TAGC.set(k, h); } return h;
}
// results: the league / trophy block (replaces the old ranked-points block)
export function resultsWho(ui, cmp) {
  const p = ui.p, L = myLeague(p), T = trophies(p); let line;
  if (!cmp) line = ""; else if (cmp.pending) line = `<em class="tro-pend">${t("tro_pending")}</em>`; else if (cmp.none) line = `<em class="fine">${t(cmp.none === "priv" ? "tro_priv" : cmp.none === "err" ? "tro_err" : "tro_mode")}</em>`;
  else line = `<span class="tro-d ${cmp.d > 0 ? "up" : cmp.d < 0 ? "dn" : ""}">${cmp.d > 0 ? "+" : ""}${cmp.d} ${trophyIcon(16)}</span>${cmp.capped ? `<em class="fine">${t(cmp.capped === "ceil" ? "tro_ceil" : "tro_day")}</em>` : ""}`;
  return `<div class="rp tro ${cmp && cmp.d < 0 ? "dn" : "up"}" id="r-tro">${leagueBadge(T, { size: "m", conq: L.conq })}<span>${esc(leagueName(L, L.conq))} · ${fmtNum(T)}<br>${line}</span></div>`;
}
export function leagueToasts(ui, res) {
  if (!res || !res.after) return; const A = res.after;
  if (res.up) setTimeout(() => { ui.toast("🏆 " + t("leagueUp", { n: leagueName(A) }), "gold", 3500); ui.app.audio.play("level"); }, 900);
  else if (res.down) setTimeout(() => ui.toast(t("leagueDown", { n: leagueName(A) }), "", 3000), 900);
  for (const e of res.events || []) { if (e.k === "season") ui.toast("🏆 " + t("seasonRw", { n: t("lg_" + LEAGUES[e.li].id) }) + " · ◆" + fmtNum(e.rw.coins), "gold", 4500); else if (e.k === "mile") ui.toast("✓ " + t("mileRw"), "good", 3000); }
}
// server "tro" for the life that just ended: update the open results card and the lobby chip
export function onServerTrophy(ui, m) {
  const res = applyServer(ui.S, m), el = $("r-tro"); ui.lastCmp = m.err ? { none: "err" } : { d: res.d };
  if (el && !$("m-results").classList.contains("x-hide")) el.outerHTML = resultsWho(ui, ui.lastCmp);
  if (!m.err) leagueToasts(ui, res); if (ui.cur === "lobby") lobbyChip(ui);
}
// sign-in / app start: season + contest rollovers, then (in the background) sync + pay finished server contests
export function startup(ui) {
  const S = ui.S, ev = seasonTick(S, []); contestTick(S, ev); if (ev.length) leagueToasts(ui, { events: ev });
  syncMe(S).then((r) => { if (!r) return; for (const x of r.paid) { const c = CONTESTS.find((k) => k.per === x.per[0] && k.met === x.met); ui.toast("🏆 " + (x.met === "cq" ? t("lg_conq") : t("contestRw", { n: x.rk, x: c ? t("c_" + c.id) : "" })) + " · ◆" + fmtNum(x.rw.coins), "gold", 5000); }
    if (r.paid.length) ui.coins(ui.p.coins); if (ui.cur === "lobby") lobbyChip(ui); if (ui.cur === "comp") renderComp(ui); }).catch(() => {});
}

// ---------- the Competitions screen ----------
let tick = null, selC = { w: "w_rush", m: "m_rush" };
export function renderComp(ui) {
  const el = $("cp-content"); if (!el) return; const S = ui.S, p = ui.p, tab = ui.cpTab || "league"; contestTick(S); seasonTick(S); ui.coins(p.coins);
  let h = "";
  if (tab === "league") {
    const T = trophies(p), L = myLeague(p), span = L.hi ? L.hi - L.lo : 0, nx = L.hi ? leagueOf(L.hi) : null, me = lastMe, sEnd = periodEnd("m", nowMs());
    h = `<div class="cp-hero glass2">${leagueBadge(T, { size: "xl", conq: L.conq })}<div class="cp-hi"><small class="fine">${t("seasonT", { n: esc(p.lg.ss || "") })}</small><b class="cp-ln">${esc(leagueName(L, L.conq))}</b>
      <div class="cp-tr">${trophyIcon(22)}<b>${fmtNum(T)}</b>${p.lg.on ? `<small class="fine">${t("onlineTr")}: ${fmtNum(p.lg.on)}</small>` : ""}</div>
      ${span ? `<div class="xpbar"><i style="width:${Math.round(((T - L.lo) / span) * 100)}%"></i></div><small class="fine">${nx ? t("toNextL", { n: fmtNum(L.hi - T), r: leagueName(nx) }) : ""}</small>` : ""}
      <div class="cp-meta"><span class="cp-cd" data-end="${sEnd}" data-k="resetsIn"></span>${me && me.rank ? `<span>${t("yourRank", { n: fmtNum(me.rank) })}</span>` : ""}</div></div></div>
      <h4 class="sub">${t("ladder")}</h4><div class="cp-ladder">` + LEAGUES.map((K, i) => `<div class="cp-step ${i === L.li && !L.conq ? "cur" : i < L.li || L.conq ? "done" : ""}">${leagueBadge(K.t0 + K.step * 4, { size: "l", tier: false })}<b>${t("lg_" + K.id)}</b><small>${fmtNum(K.t0)}+ · V–I</small><em>◆ ${fmtNum(SEASON_COINS[i])}${i === 5 ? " · " + t("ti_crowned") : ""}</em></div>`).join("") +
      `<div class="cp-step conq ${L.conq ? "cur" : ""}">${leagueBadge(TROPHY.CONQ_MIN, { size: "l", conq: 1 })}<b>${t("lg_conq")}</b><small>${t("conqInfo", { n: TROPHY.CONQ_N, x: fmtNum(TROPHY.CONQ_MIN) })}</small><em>◆ ${fmtNum(CONQ_REWARD.coins)} · ${t("frameR")} + ${t("titleR")}</em></div></div>
      <div class="cp-how glass2"><b>${t("howT")}</b><p>${t("howTxt")}</p><p class="fine">${t("softReset")} ${t("seasonRewardsT")}: ${t("lg_bronze")} ◆${SEASON_COINS[0]} → ${t("lg_crown")} ◆${SEASON_COINS[5]}.</p></div>`;
  } else if (tab === "w" || tab === "m") {
    const list = CONTESTS.filter((c) => c.per === tab), c = list.find((x) => x.id === selC[tab]) || list[0], end = contestEnds(c), v = localVal(p, c), srv = lastMe && lastMe.c && lastMe.c[c.id];
    h = `<div class="cp-tabs2" role="tablist">` + list.map((x) => `<button class="cp-c ${x === c ? "on" : ""}" data-c="${x.id}" role="tab" aria-selected="${x === c}"><img src="assets/lg/${MET_IC[x.met]}_64.webp" alt="" decoding="async"><span><b>${t("c_" + x.id)}</b><small>${t("cd_" + x.met)}</small></span></button>`).join("") + `</div>
      <div class="cp-grid"><div class="cp-card glass2"><div class="cp-ch"><img src="assets/lg/${MET_IC[c.met]}_128.webp" alt="" decoding="async"><div><b>${t("c_" + c.id)}</b><small>${t("cd_" + c.met)}</small><span class="cp-cd" data-end="${end}" data-k="endsIn"></span></div></div>
        <div class="cp-prog"><small>${t("myProg")}</small><b>${fmtNum(v)}</b>${srv && srv[1] ? `<span class="cp-rk">${t("yourRank", { n: fmtNum(srv[1]) })}</span>` : `<span class="fine">${t("notRanked")}</span>`}</div>
        <h4 class="sub">${t("milestones")}</h4><div class="cp-miles">` + MILE[c.per][c.met].map((g, i) => { const key = mileKey(c, p.cx[c.per], i), got = p.rc.includes(key), ok = v >= g, rw = { coins: MILE_COINS[c.per][i], cos: i === 2 ? ["bd:" + BADGE_OF[c.id]] : [] };
          return `<div class="cp-ms ${got ? "got" : ok ? "ok" : ""}"><div class="cp-mt"><b>${fmtNum(g)}</b>${rwHtml(rw)}</div><div class="pb"><i style="width:${Math.min(100, Math.round((v / g) * 100))}%"></i></div>${got ? `<span class="rw">✓ ${t("claimed")}</span>` : ok ? `<button class="btn gold claim" data-ms="${c.id}:${i}">${t("claim")}</button>` : `<span class="rw fine">${fmtNum(v)}/${fmtNum(g)}</span>`}</div>`; }).join("") + `</div>
        <h4 class="sub">${t("rankRewards")}</h4><div class="cp-rr">${[[1, "rk1"], [3, "rk3"], [10, "rk10"], [tab === "w" ? 50 : 100, "rkTop"]].map(([r, k]) => `<div><b>${t(k, { n: tab === "w" ? 50 : 100 })}</b>${rwHtml(rankReward(tab, r))}</div>`).join("")}</div></div>
      <div class="cp-board glass2"><div class="cp-bh"><b>${t("c_" + c.id)}</b><button class="btn ghost cp-ref" data-ref="1">${t("refresh")}</button></div><div class="cp-list" id="cp-list" data-k="${SRV_KEY[c.id]}"><div class="fine cp-load">${t("loadingBoard")}</div></div></div></div>`;
  } else {
    const all = Object.keys(BADGES), own = new Set(p.cos.filter((x) => x.startsWith("bd:")).map((x) => x.slice(3)));
    h = `<h4 class="sub">${t("myBadges")}</h4><div class="cp-badges">` + all.map((id) => `<div class="cp-bd ${own.has(id) ? "own" : ""}">${badgeImg(id, 128)}<small>${t("bd_" + id)}</small></div>`).join("") + `</div>${own.size ? "" : `<p class="fine">${t("noBadges")}</p>`}
      <h4 class="sub">${t("frameR")} · ${t("titleR")}</h4><div class="cp-excl">${[15, 16, 17].map((i) => `<div class="cp-ex ${p.cos.includes("fr:" + i) ? "own" : ""}">${avatarHtml(p.av, i, "m")}<small>${t("fr_" + FRAMES[i].id)}</small></div>`).join("")}${[14, 15, 16, 17].map((i) => `<div class="cp-ex ti ${p.cos.includes("ti:" + i) ? "own" : ""}"><b>${t("ti_" + TITLES[i].id)}</b></div>`).join("")}</div>`;
  }
  el.innerHTML = h; if (ui._cpLast !== tab) { ui._cpLast = tab; const sc = el.closest(".pbody"); if (sc) sc.scrollTop = 0; el.scrollTop = 0; }
  el.querySelectorAll("[data-c]").forEach((b) => ui.click(b, () => { selC[tab] = b.dataset.c; renderComp(ui); }, "tab"));
  el.querySelectorAll("[data-ms]").forEach((b) => ui.click(b, () => { const [cid, i] = b.dataset.ms.split(":"); if (b.disabled) return; b.disabled = true; const r = claimMilestone(S, cid, +i);
    if (r === "ok") { ui.toast("✓ " + t("mileRw"), "gold"); ui.coins(p.coins); } else if (r === "saveFail") ui.toast(t("storageFull"), "warn"); setTimeout(() => renderComp(ui), r === "ok" ? 650 : 0); }, "reward"));
  const ref = el.querySelector("[data-ref]"); if (ref) ui.click(ref, () => { loadBoard(ui, true); syncMe(S).then(() => ui.cur === "comp" && renderComp(ui)); }, "tab");
  if ((!lastMe || Date.now() - lastMe.at > 60000) && !ui._cpSync) { ui._cpSync = true; syncMe(S).then((r) => { ui._cpSync = false; if (r && ui.cur === "comp") renderComp(ui); }, () => { ui._cpSync = false; }); } // fresh own ranks on open (once a minute)
  loadBoard(ui); cd(); clearInterval(tick); tick = setInterval(() => { if (ui.cur !== "comp") { clearInterval(tick); tick = null; return; } cd(); }, 1000);
}
function cd() { const now = nowMs(); document.querySelectorAll("#cp-content [data-end]").forEach((e) => { const v = t(e.dataset.k, { n: fmtLeft(+e.dataset.end - now) }); if (e.textContent !== v) e.textContent = v; }); }
async function loadBoard(ui, force) {
  const box = $("cp-list"); if (!box) return; const k = box.dataset.k, o = await top(k); if (!box.isConnected || box.dataset.k !== k) return;
  if (!o || !Array.isArray(o.list)) { box.innerHTML = `<div class="cp-off"><p class="fine">${t("offlineBoard")}</p></div>`; return; }
  if (!o.list.length) { box.innerHTML = `<p class="fine cp-load">${t("boardEmpty")}</p>`; return; }
  const myId = lastMe && lastMe.pid; box.innerHTML = o.list.map((r) => `<div class="cp-row ${r.id === myId ? "me" : ""} ${r.r <= 3 ? "pod" : ""}"><b>${r.r}</b><span>${esc(r.n)}${r.id === myId ? ` <em>· ${t("you")}</em>` : ""}</span><em>${fmtNum(r.v)}</em></div>`).join("");
}

addStrings({ reqComp: ["Win it in Competitions", "تنكسب بالمنافسات"], toNextL: ["{n} trophies to {r}", "باقي {n} كأس لـ {r}"] });
