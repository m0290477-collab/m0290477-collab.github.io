// coin1: the coin economy's single source of truth, shared by the game (display, optimistic amounts) and the worker (the
// wallet decides). Pure data + rules: no DOM, no storage. The server never takes an amount from the client: it recomputes
// every reward from these tables and every price from the catalogue (and this week's offers) before it moves a coin.
import { SKINS, FLAGS, FLAG_PRICE, GTRAILS, fuParse, seasonMonth } from "./skins.js?v=top1";
import { weeklyOffers, monthlyBundle, occasionBundle } from "./offers.js?v=top1";
import { CONTESTS } from "./sim.js?v=top1";

export const DAY = 86400000;
// ---------- daily login calendar + lucky wheel (were in profile.js) ----------
export const LOGIN = [100, 150, 200, 250, 350, 500, 800]; // day 7 also grants a cosmetic (or +500 when everything is owned)
export const LOGIN_NOCOS = 500;
export const SPIN = [{ c: 50, w: 24 }, { c: 100, w: 22 }, { x: 200, w: 10 }, { c: 150, w: 16 }, { cos: 1, w: 7 }, { c: 250, w: 12 }, { c: 500, w: 6 }, { c: 1000, w: 3 }];
export const SPIN_NOCOS = 300;
export function spinPick(r) { let w = 0; for (const s of SPIN) w += s.w; let x = r * w, i = 0; for (; i < SPIN.length - 1; i++) { x -= SPIN[i].w; if (x < 0) break; } return i; }
// cosmetics a login day 7 / a spin may hand out: portraits, frames, titles, banners; never competition-only or owner-only ones
export const RANDOM_COS = /^(av:p([0-9]|1[0-9]|2[0-3])|fr:([1-9]|1[0-4])|ti:([1-9]|1[0-2])|bn:[0-7])$/;
export const COS_KEY = /^(av:(p\d{1,2}|f\d{1,3})|fr:\d{1,2}|ti:\d{1,2}|bn:\d{1,2}|bd:[a-z0-9]{1,4})$/;
// ---------- season pass, chains, achievements, missions (were in store.js) ----------
export const SEASON = { id: "s1", tiers: 30, per: 400 };
export const seasonReward = (k) => (k === 10 ? { skin: "magma" } : k === 20 ? { skin: "storm" } : k === 30 ? { skin: "dragon" } : k % 5 === 0 ? { coins: 300 * (k / 5) + 200, chest: 1 } : { coins: 60 + k * 10 });
export const CHAINS = {
  hunter: { reward: "phantom", steps: [["kills", 5], ["kills", 20], ["kills", 50], ["teamWin", 1]] },
  collector: { reward: "prism", steps: [["food", 300], ["food", 1500], ["mass", 800], ["mass", 1500]] },
  survivor: { reward: "aurora_l", steps: [["life", 120], ["wave", 5], ["brWin", 1], ["life", 300]] },
};
// skins earned by progress (chains, the weekly streak, the boss); the season-pass skins come with their tier claim
export const UNLOCKS = new Set(SKINS.filter((s) => s.src && /^(chain|weekly|boss):/.test(s.src)).map((s) => s.id));
export const ACH_COINS = { a_first: 20, a_hunter: 100, a_predator: 400, a_glutton: 300, a_titan: 200, a_colossus: 600, a_veteran: 300, a_survivor: 200, a_king: 250, a_speed: 150, a_zen: 100, a_globe: 200, a_online: 100, a_wave: 300, a_time: 200, a_level: 200, a_master: 1000, a_style: 100 };
export const levelCoins = (l) => 25 * l + (l % 10 === 0 ? 500 : 0);
export const LV_MAX = 100;
export const bonusCoins = (lv) => 50 + Math.min(10, Math.max(1, lv | 0)) * 10;
// the 3 daily missions of a calendar day (local date "YYYY-MM-DD"): same for every player that day
export function dailyMissions(d) {
  let h = 0; for (const ch of d) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x6d2b79f5) | 0; return ((h >>> 0) % 10000) / 10000; };
  const T = [["eat", [150, 300, 500]], ["kill", [2, 5, 10]], ["mass", [300, 600, 1200]], ["games", [3, 5]], ["survive", [90, 180, 300]], ["boost", [30, 60]], ["online", [1, 2]]];
  const pick = []; while (pick.length < 3) { const tt = T[(rnd() * T.length) | 0]; if (!pick.some((x) => x.id === tt[0])) { const gi = (rnd() * tt[1].length) | 0; pick.push({ id: tt[0], g: tt[1][gi], p: 0, r: 60 + gi * 50, c: 0 }); } }
  return pick;
}
export const weeklyCoins = (i) => 450 + i * 150;
export const WC_REWARD = [300, 700, 1500]; // weekly skill chain tiers (was in modes.js)
export const DAILY_MODE_BONUS = 150; // first daily-challenge run of the day
// ---------- competitions (were in league.js) ----------
export const SEASON_COINS = [150, 300, 500, 800, 1200, 1800];
export function leagueSeasonReward(li) { const r = { coins: SEASON_COINS[Math.max(0, Math.min(5, li | 0))], cos: [] }; if (li >= 5) r.cos.push("ti:17"); return r; }
export const CONQ_REWARD = { coins: 3000, cos: ["fr:15", "ti:14", "bd:cq"] };
export function rankReward(per, rk) {
  const W = per === "w"; if (rk === 1) return { coins: W ? 1500 : 4000, cos: [W ? "ti:15" : "ti:16", "fr:16", W ? "bd:c1w" : "bd:c1m"] };
  if (rk <= 3) return { coins: W ? 800 : 2000, cos: ["fr:17", W ? "bd:c3w" : "bd:c3m"] }; if (rk <= 10) return { coins: W ? 400 : 1000, cos: [] };
  if (rk <= (W ? 50 : 100)) return { coins: W ? 150 : 300, cos: [] }; return null;
}
export const MILE_COINS = { w: [80, 200, 400], m: [150, 400, 800] };
export const BADGE_OF = { w_rush: "wr", w_hunt: "wh", w_score: "ws", m_rush: "mr", m_hunt: "mh", m_score: "ms" };
export const mileReward = (c, i) => ({ coins: MILE_COINS[c.per][i], cos: i === 2 ? ["bd:" + BADGE_OF[c.id]] : [] });
export { CONTESTS };
// ---------- one finished match (same formula on the device and in the room) ----------
export function matchXp(a) {
  const diffMul = [0.75, 1, 1.25, 1.5][a.diff ?? 1] * (a.mode === "online" ? 1.3 : 1) * (a.mode === "zen" ? 0.4 : 1) * (a.win ? 1.5 : 1);
  return Math.round(((+a.best || 0) / 8 + (a.kills | 0) * 30 + Math.min(+a.dur || 0, 900) / 4 + (a.mode === "survival" ? (a.wave | 0) * 25 : 0) + (a.win ? 150 : 0) + (a.pu | 0) * 6 + (+a.bonus || 0) / 20) * diffMul) + 10;
}
export const matchCoins = (a) => Math.round(matchXp(a) / 4) + (a.bounty | 0) * 100;
// offline / bot matches are claimed by the device: the numbers must be possible for the time played. Anything above is cut
// back to the limit (and logged by the server); a match shorter than MIN_S earns nothing.
export const OFF = { MIN_S: 10, MAX_S: 3600, PER_MATCH: 600, PER_DAY: 8000, MASS0: 150, MASS_S: 40, KILL0: 2, KILL_S: 0.25, BONUS_MAX: 6000, BOUNTY_MAX: 5 };
export function plausible(a) {
  const dur = Math.max(0, Math.min(OFF.MAX_S, +a.dur || 0)), cut = [];
  const lim = { best: OFF.MASS0 + OFF.MASS_S * dur, kills: Math.floor(OFF.KILL0 + OFF.KILL_S * dur), wave: Math.floor(dur / 10) + 1, pu: Math.floor(dur / 3) + 2, bonus: OFF.BONUS_MAX, bounty: Math.min(OFF.BOUNTY_MAX, Math.max(0, a.kills | 0)) };
  const o = { mode: String(a.mode || "classic").slice(0, 12), diff: Math.max(0, Math.min(3, a.diff | 0)), win: !!a.win, dur };
  for (const k of ["best", "kills", "wave", "pu", "bonus", "bounty"]) { const v = Math.max(0, +a[k] || 0); o[k] = Math.min(v, lim[k]); if (v > lim[k]) cut.push(k); }
  if (o.mode === "online") { o.mode = "classic"; cut.push("mode"); } // online lives are paid by the room, never by a claim
  let c = dur < OFF.MIN_S ? 0 : matchCoins(o); if (dur < OFF.MIN_S && matchCoins(o) > 0) cut.push("short");
  if (c > OFF.PER_MATCH) { c = OFF.PER_MATCH; cut.push("cap"); }
  return { c, cut, full: matchCoins({ ...a, dur }), o }; // fix1: o = the clamped numbers (server XP uses them)
}
export const ONLINE = { PER_LIFE: 800, PER_DAY: 30000 };
// play2: crown bounty on the #1 snake of a public online room (paid by the room to the human who kills it; counts in ONLINE.PER_DAY)
export const BOUNTY = { BASE: 25, STEP: 5, EVERY: 10, MAX: 250 };
export const btyVal = (sec) => Math.min(BOUNTY.MAX, BOUNTY.BASE + Math.floor(Math.max(0, sec) / BOUNTY.EVERY) * BOUNTY.STEP);
// ---------- shop catalogue: what each item key costs at full price ----------
// item keys: skin id ("phoenix"), "fl:<flag index>", "gt:<trail id>", cosmetics "av:/fr:/ti:/bn:/bd:", special ids "sid:<n>"
export const SHOP_TRAILS = GTRAILS; // admin2: the priced ground-trail list (owner price overrides edit it)
export const gtPrice = (id) => { const G = GTRAILS.find((g) => g.id === id); return G ? G.price | 0 : -1; }; // fix1: -1 = unknown id
export function catItem(k, i) {
  if (k === "skin") { const S = SKINS[i | 0]; if (!S || !S.src || !S.src.startsWith("coins:") || String(i | 0) !== String(i)) return null; return { key: S.id, base: +S.src.split(":")[1], it: { k: "skin", i: i | 0 } }; }
  if (k === "flag") { if (!FLAGS[i | 0] || String(i | 0) !== String(i)) return null; return { key: "fl:" + (i | 0), base: FLAG_PRICE, it: { k: "flag", i: i | 0 } }; }
  if (k === "gt") { const G = GTRAILS[i | 0]; if (!G || !G.price || String(i | 0) !== String(i)) return null; return { key: "gt:" + G.id, base: G.price | 0 }; }
  return null;
}
// a known item key (migration import, owner grants): true when the catalogue or the cosmetic list has it
export function validKey(key) {
  key = String(key || ""); if (COS_KEY.test(key)) return true; if (/^fl:\d{1,3}$/.test(key)) return !!FLAGS[+key.slice(3)]; if (/^gt:[a-z0-9_]{1,24}$/.test(key)) return GTRAILS.some((g) => g.id === key.slice(3));
  if (/^sid:\d{5}$/.test(key)) return true; if (/^fu:/.test(key)) return !!fuParse(key); /* land1: a fusion skin */ return SKINS.some((s) => s.id === key && s.src);
}
// the offers a player could be looking at right now: every local time zone (UTC-12 .. UTC+14) of this moment, with the
// player's server-held items skipped exactly like the shop does on the device
export function offerCandidates(owned, now = Date.now()) {
  const S = { unlocked: (k, i) => k === "skin" && SKINS[i] && owned.has(SKINS[i].id), p: { flags: [...owned].filter((x) => x.startsWith("fl:")).map((x) => +x.slice(3)) } };
  const seen = new Set(), single = [], bundles = [];
  const days = new Set(); // offers change only at local midnight: at most 3 calendar dates exist on Earth at one instant
  for (let h = -12; h <= 14; h++) { const d = new Date(now + h * 3600000), dk = d.toISOString().slice(0, 10); if (days.has(dk)) continue; days.add(dk);
    const w = weeklyOffers(S, d); for (const it of w.items) { const id = it.k + ":" + it.i + ":" + it.price; if (!seen.has(id)) { seen.add(id); single.push({ k: it.k, i: it.i, price: it.price }); } }
    for (const b of [monthlyBundle(S, d), occasionBundle(S, d)]) if (b && b.items && b.items.length && !seen.has("b:" + b.key + ":" + b.price)) { seen.add("b:" + b.key + ":" + b.price); bundles.push({ key: b.key, price: b.price, items: b.items.map((x) => ({ k: x.k, i: x.i })) }); } }
  return { single, bundles };
}

// top1: a season skin can be bought only while its month is on sale (UTC month, or the owner's override 1..12)
export const seasonOk = (key, now = Date.now(), ov = 0) => { const S = SKINS.find((x) => x.id === key); return !S || !S.ssn || S.ssn === seasonMonth(now, ov); };
