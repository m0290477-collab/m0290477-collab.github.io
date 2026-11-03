// Player identity: avatars (16 portraits + every flag), frames, titles, banners, ranked tiers, daily login calendar
// and the free lucky spin. Rewards are coins / XP / cosmetics only (never paid). Pure data + rules, no DOM.
import { WORLDS, worldAsset } from "./worlds.js?v=noself1";
import { FLAGS, flagEmoji } from "./skins.js?v=noself1";

// requirement shapes: null = free · {lv} · {ach} · {stat:[key,n]} · {season} (tier) · {owner}
export const AVATARS = [
  null, null, null, null, // buddy, viper, frost, neon
  { lv: 5 }, { lv: 8 }, { lv: 12 }, { lv: 15 }, { lv: 20 }, { lv: 25 }, // pharaoh, magma, cosmos, venom, storm, mech
  { ach: "a_king" }, { ach: "a_survivor" }, { ach: "a_hunter" }, { lv: 40 }, { ach: "a_predator" }, { stat: ["wins", 10] }, // king, phantom, ninja, dragon, skull, prism
];
export const FRAMES = [
  { id: "none", req: null }, { id: "bronze", req: { lv: 5 } }, { id: "silver", req: { lv: 15 } }, { id: "gold", req: { lv: 30 } },
  { id: "diamond", req: { lv: 50 } }, { id: "legend", req: { lv: 75 } }, { id: "season", req: { season: 15 } },
];
export const TITLES = [
  { id: "rookie", req: null }, { id: "hunter", req: { ach: "a_hunter" } }, { id: "predator", req: { ach: "a_predator" } }, { id: "glutton", req: { ach: "a_glutton" } },
  { id: "titan", req: { ach: "a_titan" } }, { id: "survivor", req: { ach: "a_survivor" } }, { id: "speedster", req: { ach: "a_speed" } }, { id: "zen", req: { ach: "a_zen" } },
  { id: "globe", req: { ach: "a_globe" } }, { id: "champion", req: { stat: ["wins", 10] } }, { id: "slayer", req: { stat: ["bossKills", 1] } }, { id: "legend", req: { lv: 50 } },
  { id: "ascendant", req: { season: 30 } }, { id: "owner", req: { owner: 1 } },
];
// 0 = default glass, 1..6 = the six worlds (unlocked with the world), 7 = royal gold (season tier 20)
export const BANNERS = [{ req: null }, ...WORLDS.map((w) => ({ req: w.lv > 1 ? { lv: w.lv } : null, w })), { req: { season: 20 } }];
export const RANKS = [
  { id: "bronze", rp: 0, c: ["#e7a46a", "#8a4a1c"] }, { id: "silver", rp: 150, c: ["#eef3fa", "#7d8ba0"] }, { id: "gold", rp: 400, c: ["#ffe9a8", "#d18a00"] },
  { id: "plat", rp: 800, c: ["#c9fff4", "#2aa58e"] }, { id: "diamond", rp: 1300, c: ["#d6ecff", "#3a7cff"] }, { id: "master", rp: 2000, c: ["#f1d2ff", "#9a3cff"] },
  { id: "legend", rp: 3000, c: ["#fff6c4", "#ff3f6c"] },
];
export const rankOf = (rp) => { let i = 0; while (i < RANKS.length - 1 && rp >= RANKS[i + 1].rp) i++; const nx = RANKS[i + 1]; return { i, id: RANKS[i].id, c: RANKS[i].c, into: rp - RANKS[i].rp, span: nx ? nx.rp - RANKS[i].rp : 0 }; };
// ranked points from one finished match (zen never counts): placement + wins + kills, online worth a bit more
export function rpDelta(r) {
  if (r.mode === "zen") return 0; let d = r.rank === 1 ? 24 : r.rank <= 3 ? 14 : r.rank <= 10 ? 5 : -7; if (r.win) d += 18; d += Math.min(20, (r.kills | 0) * 2);
  if (r.mode === "online") d = Math.round(d * 1.2); return d;
}
export const LOGIN = [100, 150, 200, 250, 350, 500, 800]; // day 7 also grants a cosmetic
export const SPIN = [{ c: 50, w: 24 }, { c: 100, w: 22 }, { x: 200, w: 10 }, { c: 150, w: 16 }, { cos: 1, w: 7 }, { c: 250, w: 12 }, { c: 500, w: 6 }, { c: 1000, w: 3 }];

// is a requirement met for this store (level/achievements/stats/season/owner) or the cosmetic granted outright (spin, calendar)
export function reqMet(S, req, key) {
  const p = S.p; if (!req || p.owner) return true; if (key && p.cos.includes(key)) return true;
  if (req.lv) return S.level() >= req.lv; if (req.ach) return !!p.ach[req.ach]; if (req.stat) return (p.stats[req.stat[0]] || 0) >= req.stat[1];
  if (req.season) return S.seasonTier() >= req.season; return false;
}
export const avOk = (S, id) => { if (/^f\d+$/.test(id)) return !!FLAGS[+id.slice(1)]; const i = +String(id).slice(1); return /^p\d+$/.test(id) && i < AVATARS.length && reqMet(S, AVATARS[i], "av:" + id); };
export const frameOk = (S, i) => !!FRAMES[i] && reqMet(S, FRAMES[i].req, "fr:" + i);
export const titleOk = (S, i) => !!TITLES[i] && reqMet(S, TITLES[i].req, "ti:" + i);
export const bannerOk = (S, i) => !!BANNERS[i] && reqMet(S, BANNERS[i].req, "bn:" + i);
// locked cosmetics a reward can hand out (owner-only title excluded)
export function lockedCosmetics(S) {
  const out = []; AVATARS.forEach((_, i) => { if (!avOk(S, "p" + i)) out.push("av:p" + i); }); FRAMES.forEach((_, i) => { if (i && !frameOk(S, i)) out.push("fr:" + i); });
  TITLES.forEach((T, i) => { if (!T.req || !T.req.owner) if (!titleOk(S, i)) out.push("ti:" + i); }); BANNERS.forEach((_, i) => { if (!bannerOk(S, i)) out.push("bn:" + i); }); return out;
}
// avatar markup: portrait webp or flag emoji on a tinted disc, wrapped in the frame ring. size: "s" (rows), "m" (cards), "l" (profile)
export function avatarHtml(av, frame, size = "m") {
  const id = typeof av === "string" ? av : "p0"; const fr = FRAMES[frame | 0] ? FRAMES[frame | 0].id : "none";
  const inner = /^f\d+$/.test(id) && FLAGS[+id.slice(1)] ? `<span class="avf" style="background:linear-gradient(135deg,${FLAGS[+id.slice(1)].cols.slice(0, 3).join(",")})"><b>${flagEmoji(FLAGS[+id.slice(1)].c)}</b></span>` : `<img src="assets/av/${Math.max(0, Math.min(15, +id.slice(1) || 0))}.webp" alt="" decoding="async" draggable="false">`;
  return `<span class="ava ${size} fr-${fr}">${inner}</span>`;
}
export const bannerCss = (i) => { const B = BANNERS[i | 0] || BANNERS[0]; if (B.w) return `url(${worldAsset(B.w, "sky", true)}) center/cover`; if ((i | 0) === 7) return "linear-gradient(120deg,#3a2400,#ffc845 45%,#7a4a00)"; return "linear-gradient(120deg,#141c33,#0a0f1d)"; };
export function rankBadge(rp, small) { const R = rankOf(rp | 0); return `<span class="rkb ${small ? "s" : ""}" style="--a:${R.c[0]};--b:${R.c[1]}"><svg viewBox="0 0 24 24"><path d="M12 2 20 5v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5Z"/><path d="M12 7l1.5 3 3.3.4-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.4Z" class="st"/></svg></span>`; }
