// comp1: trophies, leagues (Bronze .. Crown, tiers V..I, Conqueror = top of the season online), monthly seasons with a soft
// reset, weekly / monthly contests with milestones (work offline) and final-rank rewards (online, server-validated).
// Rewards are coins + exclusive cosmetics only (frames, titles, badges); no real money anywhere.
// Rules shared with the server live in sim.js (leagueOf, trophyDelta, seasonCarry, period ids).
import { LEAGUES, TROPHY, leagueOf, trophyDelta, seasonCarry, seasonId, weekId, periodEnd, CONTESTS, botTrophies } from "./sim.js?v=layoutfix";
import { t, fmtNum, addStrings } from "./i18n.js?v=layoutfix";
import { KV, logErr } from "./store.js?v=layoutfix";
import { stableNow } from "./offers.js?v=layoutfix";
import { SERVER } from "./net.js?v=layoutfix";

export { LEAGUES, TROPHY, leagueOf, CONTESTS, botTrophies };
export const ROMAN = ["", "I", "II", "III", "IV", "V"];
export const HTTP = SERVER.replace(/^ws/, "http").replace(/\/ws$/, ""); // wss://x/ws -> https://x
const COUNT_MODES = new Set(["classic", "time", "survival", "br", "koth", "team", "boss", "goldrush", "infection", "duel", "online", "territory"]); // land1: territory vs bots counts like other offline modes // zen, tutorial, practice extras never move trophies
const today = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const nowMs = () => stableNow(KV).getTime(); // clock-back guard shared with the shop offers

// ---------- rewards (all coins / cosmetics) ----------
// new cosmetics (profile.js): frames 15 conq, 16 champ, 17 podium · titles 14 conq, 15 wchamp, 16 mchamp, 17 crowned
// badges (bd:*) are collected on the Competitions screen: one per contest for its top milestone, plus champion rosettes
// coin1: reward tables live in econ.js (the worker prices every reward claim from them)
import { SEASON_COINS, leagueSeasonReward as seasonReward, CONQ_REWARD, rankReward, MILE_COINS, BADGE_OF, mileReward } from "./econ.js?v=layoutfix";
export { SEASON_COINS, seasonReward, CONQ_REWARD, rankReward, MILE_COINS, BADGE_OF, mileReward };
// personal milestones per contest (count offline + online, claimable once per period)
export const MILE = { w: { tr: [30, 80, 150], kl: [10, 30, 60], sc: [800, 2000, 4000] }, m: { tr: [120, 300, 600], kl: [40, 120, 250], sc: [1500, 4000, 8000] } };
export const BADGES = { wr: "rw_c_rush", wh: "rw_c_hunt", ws: "rw_c_score", mr: "rw_c_rush", mh: "rw_c_hunt", ms: "rw_c_score", c1w: "rw_c_champ", c1m: "rw_c_champ", c3w: "rw_trophy", c3m: "rw_trophy", cq: "lg_conq" };
const CK = (c) => c.per + (c.met === "tr" ? "tr" : c.met === "kl" ? "kl" : "sc"); // cx field: wtr / wkl / wsc / mtr ...

// ---------- badge markup (reusable by any screen: lobby, profile, results, HUD, a future friends list) ----------
const PX = { s: 64, m: 64, l: 128, xl: 256 };
export function leagueBadge(tr, o = {}) {
  const L = leagueOf(tr), size = o.size || "m", conq = !!o.conq, img = conq ? "conq" : L.id, px = PX[size] || 64, name = leagueName(L, conq);
  const tier = o.tier === false || conq || size === "s" ? "" : `<b>${ROMAN[L.tier]}</b>`;
  return `<span class="lgb sz-${size} lg-${L.id}${conq ? " conq" : ""}" role="img" aria-label="${name}" title="${name}"><img src="assets/lg/lg_${img}_${px}.webp" alt="" decoding="async" draggable="false">${tier}</span>`;
}
// for player cards / friends rows: { tr, conq } -> small badge
export const badgeFor = (pl, size = "s") => (pl && Number.isFinite(+pl.tr) && +pl.tr >= 0 ? leagueBadge(+pl.tr, { size, conq: !!pl.conq }) : "");
export function leagueName(L, conq) { return conq ? t("lg_conq") : t("lg_" + L.id) + " " + ROMAN[L.tier]; }
export const trophyIcon = (size = 18) => `<img class="tro-ic" src="assets/lg/rw_trophy_64.webp" alt="" width="${size}" height="${size}" decoding="async" draggable="false">`;
export const badgeImg = (id, size = 64) => `<img class="bdg-ic" src="assets/lg/${BADGES[id] || "rw_trophy"}_${size >= 96 ? 128 : 64}.webp" alt="" decoding="async" draggable="false">`;

// ---------- profile state ----------
export const trophies = (p) => (p.lg.on | 0) + (p.lg.off | 0);
export const myLeague = (p) => ({ ...leagueOf(trophies(p)), conq: !!p.lg.conq });
export function devKey(S) { const p = S.p; if (!/^[0-9a-f]{32}$/.test(p.dev)) { const b = new Uint8Array(16); crypto.getRandomValues(b); p.dev = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); S.save(); } return p.dev; }

// season rollover (local): soft reset of the total and the season reward for the highest league reached, granted atomically
export function seasonTick(S, out = []) {
  const p = S.p, L = p.lg, cur = seasonId(nowMs());
  if (!L.ss) { L.ss = cur; L.pk = Math.max(L.pk, trophies(p)); S.save(); return out; }
  if (L.ss === cur) return out;
  const old = L.ss, peak = Math.max(L.pk, trophies(p)), li = leagueOf(peak).li;
  if (trophies(p) > 0 || peak > 0) { const rw = seasonReward(li), r = S.grantReward("ss:" + old, rw, { li }); if (r === "ok") out.push({ k: "season", ss: old, li, rw }); }
  const tot = seasonCarry(trophies(p)), on = seasonCarry(L.on); L.on = on; L.off = Math.max(0, tot - on); L.ss = cur; L.pk = trophies(p); L.conq = 0; L.rank = 0; S.save();
  return out;
}
// contest periods (local progress): when a week / month ends, milestones that were reached but not claimed are granted
export function contestTick(S, out = []) {
  const p = S.p, X = p.cx, now = nowMs(), W = weekId(now), M = seasonId(now);
  for (const [per, id] of [["w", W], ["m", M]]) {
    if (X[per] === id) continue;
    if (X[per]) for (const c of CONTESTS) if (c.per === per) MILE[per][c.met].forEach((g, i) => { if ((X[CK(c)] | 0) >= g) { const r = S.grantReward(mileKey(c, X[per], i), mileReward(c, i)); if (r === "ok") out.push({ k: "mile", c: c.id, i }); } });
    X[per] = id; X[per + "tr"] = 0; X[per + "kl"] = 0; X[per + "sc"] = 0; S.save();
  }
  return out;
}
export const mileKey = (c, pid, i) => "ms:" + c.id + ":" + pid + ":" + i;
export const localVal = (p, c) => p.cx[CK(c)] | 0;
export function claimMilestone(S, cid, i) {
  const c = CONTESTS.find((x) => x.id === cid); if (!c) return "bad"; contestTick(S); const p = S.p, g = MILE[c.per][c.met][i];
  if (g == null || localVal(p, c) < g) return "locked"; return S.grantReward(mileKey(c, p.cx[c.per], i), mileReward(c, i));
}
const addCx = (p, per, tr, kl, sc) => { const X = p.cx; X[per + "tr"] = Math.max(0, (X[per + "tr"] | 0) + (tr | 0)); X[per + "kl"] = (X[per + "kl"] | 0) + Math.max(0, kl | 0); X[per + "sc"] = Math.max(X[per + "sc"] | 0, Math.max(0, sc | 0)); };

// one finished match. Offline: trophies decided here (half weight, capped). Online: kills / score count for local progress
// at once, trophies arrive from the server ("tro") and are applied by applyServer(). Returns what the results screen shows.
export function afterMatch(S, r) {
  const p = S.p, events = seasonTick(S, []); contestTick(S, events);
  const before = myLeague(p), res = { d: 0, before, after: before, pending: false, none: false, events, tr: trophies(p) };
  if (!COUNT_MODES.has(r.mode)) { res.none = "mode"; return res; }
  const field = Math.max(2, Math.min(200, r.field | 0)), kills = Math.max(0, r.kills | 0), life = +r.life || 0, place = r.place | 0, score = Math.max(0, Math.round(+r.score || 0));
  if (r.online) { if (r.priv) { res.none = "priv"; } else res.pending = true; addCx(p, "w", 0, kills, score); addCx(p, "m", 0, kills, score); S.save(); return res; }
  // sanity: the numbers must be possible for this match, else nothing is counted (and the attempt is logged)
  if (!(place >= 1 && place <= field && kills <= field * 3 && life >= 0 && life <= 7200 && Number.isFinite(score))) { logErr("tamper", "match result out of range"); res.none = "bad"; return res; }
  const L = p.lg, dn = new Date(nowMs()), day = today(dn); if (L.day !== day) { L.day = day; L.dg = 0; }
  let d = trophyDelta({ place, field, kills, life, t: trophies(p), online: 0 });
  if (d > 0) { d = Math.min(d, Math.max(0, TROPHY.OFF_DAY - L.dg), Math.max(0, TROPHY.OFF_CEIL - trophies(p))); if (d <= 0) res.capped = trophies(p) >= TROPHY.OFF_CEIL ? "ceil" : "day"; }
  if (d < 0) d = Math.max(d, -L.off); // offline play can only take back offline trophies
  L.off += d; if (d > 0) L.dg += d; L.pk = Math.max(L.pk, trophies(p));
  addCx(p, "w", d, kills, score); addCx(p, "m", d, kills, score); S.save();
  res.d = d; res.tr = trophies(p); res.after = myLeague(p); res.up = res.after.div > before.div; res.down = res.after.div < before.div; return res;
}
// the server's word on an online life (or the sync on connect): the online part becomes exactly the server total
export function applyServer(S, m) {
  const p = S.p; seasonTick(S); contestTick(S); const before = myLeague(p);
  if (!m || m.err || !Number.isFinite(+m.tr)) return { err: 1, before, after: before };
  const d = m.t === "tro" ? m.d | 0 : 0; p.lg.on = Math.max(0, Math.min(TROPHY.MAX, Math.floor(+m.tr))); p.lg.pk = Math.max(p.lg.pk, trophies(p));
  if (m.t === "tro") { addCx(p, "w", d, 0, 0); addCx(p, "m", d, 0, 0); }
  S.save(); const after = myLeague(p); return { d, before, after, up: after.div > before.div, down: after.div < before.div, tr: trophies(p) };
}

// ---------- server API (leaderboards, own ranks, contest claims). Works without it: everything local keeps going. ----------
async function api(path, body, ms = 6000) {
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null, to = ac && setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(HTTP + "/lb/" + path, body ? { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain" }, signal: ac && ac.signal } : { signal: ac && ac.signal }); if (!r.ok) return null; return await r.json(); }
  catch (_) { return null; } finally { to && clearTimeout(to); }
}
const TOP = new Map();
export async function top(k) { const c = TOP.get(k); if (c && Date.now() - c.t < 30000) return c.o; const o = await api("top?k=" + encodeURIComponent(k)); if (o && Array.isArray(o.list)) TOP.set(k, { t: Date.now(), o }); return o; }
export let lastMe = null;
// sync own server state; pays every finished contest / Conqueror reward the server lists for this player (grant first, keyed,
// then marked on the server: a failed mark is retried next sync and the keyed grant can never pay twice)
export async function syncMe(S) {
  const p = S.p, pk = devKey(S), me = await api("me", { pk }); if (!me || me.err) return null; if (S.p !== p) return null; // profile switched meanwhile
  lastMe = { ...me, at: Date.now() }; applyServer(S, { t: "tro0", tr: me.tr });
  // server-counted contest values (online lives) never show below what the server saw for this player in the same period
  if (me.c) for (const c of CONTESTS) { const v = me.c[c.id], X = p.cx; if (Array.isArray(v) && X[c.per] === (c.per === "w" ? me.w : me.m)) { const k = CK(c); X[k] = Math.max(X[k] | 0, Math.max(0, Math.min(1e7, v[0] | 0))); } } p.lg.conq = me.conq ? 1 : 0; p.lg.rank = me.rank | 0; p.lg.sync = Date.now(); S.save();
  const paid = [];
  for (const c of me.claims || []) {
    const per = String(c.per || ""), kind = per[0], rw = kind === "s" && c.met === "cq" ? CONQ_REWARD : rankReward(kind, c.rk | 0), key = "sv:" + per + ":" + c.met;
    if (!rw) { await api("claim", { pk, per, met: c.met }); continue; }
    const r = S.grantReward(key, rw); if (r === "ok" || r === "claimed") { const ok = await api("claim", { pk, per, met: c.met }); if (r === "ok") paid.push({ per, met: c.met, rk: c.rk, rw }); if (!ok) logErr("claim", "server mark failed " + key); }
  }
  return { me, paid };
}
export const contestEnds = (c, ms = nowMs()) => periodEnd(c.per, ms);

addStrings({
  lg_bronze: ["Bronze", "برونزي"], lg_silver: ["Silver", "فضي"], lg_gold: ["Gold", "ذهبي"], lg_platinum: ["Platinum", "بلاتيني"], lg_diamond: ["Diamond", "ماسي"], lg_crown: ["Crown", "التاج"], lg_conq: ["Conqueror", "الفاتح"],
  trophies: ["Trophies", "الكؤوس"], trophyN: ["{n} trophies", "{n} كأس"], compT: ["Competitions", "المنافسات"], leagueT: ["League", "الدوري"], seasonT: ["Season {n}", "موسم {n}"],
  cWeekly: ["Weekly", "أسبوعي"], cMonthly: ["Monthly", "شهري"], cRewards: ["Rewards", "الجوائز"], endsIn: ["Ends in {n}", "ينتهي بعد {n}"], resetsIn: ["Season resets in {n}", "الموسم يتجدد بعد {n}"],
  c_w_rush: ["Trophy Rush", "سباق الكؤوس"], c_w_hunt: ["Hunter's Week", "أسبوع الصياد"], c_w_score: ["Top Score", "أعلى نتيجة"], c_m_rush: ["Trophy Marathon", "ماراثون الكؤوس"], c_m_hunt: ["Hunter's Month", "شهر الصياد"], c_m_score: ["Score Legend", "أسطورة النتيجة"],
  cd_tr: ["Most trophies gained", "أكثر كؤوس مكسوبة"], cd_kl: ["Most kills", "أكثر عدد قتل"], cd_sc: ["Highest score in one match", "أعلى نتيجة بمباراة وحدة"],
  myProg: ["Your progress", "تقدمك"], yourRank: ["Your rank #{n}", "ترتيبك \u2066#{n}\u2069"], notRanked: ["Not ranked yet", "مو مصنّف بعد"], offlineBoard: ["Online board unavailable. Your own progress still counts.", "لوحة الأونلاين غير متاحة. تقدمك الخاص يبقى محسوب."],
  loadingBoard: ["Loading leaderboard…", "جاري تحميل الترتيب…"], boardEmpty: ["No one on the board yet. Play online to be first!", "ماكو أحد بالترتيب بعد. العب أونلاين وكن الأول!"],
  milestones: ["Milestones", "المراحل"], rankRewards: ["Final rank rewards", "جوائز الترتيب النهائي"], rk1: ["#1", "#1"], rk3: ["#2–3", "#2–3"], rk10: ["#4–10", "#4–10"], rkTop: ["#11–{n}", "#11–{n}"],
  claimed: ["Claimed", "تم الاستلام"], claim: ["Claim", "استلم"], locked: ["Locked", "مقفول"], badgeR: ["Badge", "شارة"], frameR: ["Frame", "إطار"], titleR: ["Title", "لقب"],
  tro_pending: ["Server is counting your trophies…", "السيرفر يحسب كؤوسك…"], tro_priv: ["Private room: trophies don't change", "غرفة خاصة: الكؤوس ما تتغير"], tro_mode: ["This mode doesn't change trophies", "هذا الطور ما يغيّر الكؤوس"],
  tro_err: ["Server unavailable: trophies not counted", "السيرفر غير متاح: الكؤوس ما انحسبت"], tro_day: ["Daily offline trophy limit reached: play online for more", "وصلت حد الكؤوس اليومي بدون نت: العب أونلاين للمزيد"],
  tro_ceil: ["Diamond and above are earned online", "الماسي وفوق ينكسب أونلاين بس"], leagueUp: ["Promoted to {n}!", "ترقّيت إلى {n}!"], leagueDown: ["Dropped to {n}", "نزلت إلى {n}"],
  seasonRw: ["Season ended: {n} reward collected", "انتهى الموسم: استلمت جائزة {n}"], mileRw: ["Milestone reward collected", "استلمت جائزة مرحلة"], contestRw: ["Contest reward: #{n} in {x}", "جائزة منافسة: \u2066#{n}\u2069 في {x}"],
  conqInfo: ["Top {n} of the season online with {x}+ trophies", "أفضل {n} بالموسم أونلاين وعندهم {x}+ كأس"], ladder: ["League ladder", "سلّم الدوري"], seasonRewardsT: ["Season rewards", "جوائز الموسم"],
  softReset: ["At season end trophies above 1,000 are halved.", "بنهاية الموسم الكؤوس فوق 1000 تنقص للنص."], howT: ["How trophies work", "شلون تنحسب الكؤوس"],
  howTxt: ["Win trophies by placement and kills. Online, the server decides them. Offline vs bots counts at half value (max 12 a match, 120 a day) up to Platinum.", "اربح كؤوس حسب ترتيبك وعدد القتل. بالأونلاين السيرفر هو اللي يحسبها. ضد البوتات بدون نت تنحسب بنص القيمة (حد 12 بالمباراة و120 باليوم) لحد البلاتيني."],
  myBadges: ["My badges", "شاراتي"], noBadges: ["Win contest milestones to collect badges.", "اكسب مراحل المنافسات حتى تجمع شارات."], online: ["Online", "أونلاين"], onlineTr: ["Online trophies", "كؤوس الأونلاين"],
  fr_conq: ["Conqueror", "الفاتح"], fr_champ: ["Champion", "البطل"], fr_podium: ["Podium", "المنصة"], ti_conq: ["Conqueror", "الفاتح"], ti_wchamp: ["Weekly Champion", "بطل الأسبوع"], ti_mchamp: ["Monthly Champion", "بطل الشهر"], ti_crowned: ["Crowned", "المتوّج"],
  bd_wr: ["Trophy Rush", "سباق الكؤوس"], bd_wh: ["Hunter's Week", "أسبوع الصياد"], bd_ws: ["Top Score", "أعلى نتيجة"], bd_mr: ["Trophy Marathon", "ماراثون الكؤوس"], bd_mh: ["Hunter's Month", "شهر الصياد"], bd_ms: ["Score Legend", "أسطورة النتيجة"],
  bd_c1w: ["Weekly Champion", "بطل الأسبوع"], bd_c1m: ["Monthly Champion", "بطل الشهر"], bd_c3w: ["Weekly Podium", "منصة الأسبوع"], bd_c3m: ["Monthly Podium", "منصة الشهر"], bd_cq: ["Conqueror", "الفاتح"],
  you: ["You", "أنت"], refresh: ["Refresh", "تحديث"],
});
