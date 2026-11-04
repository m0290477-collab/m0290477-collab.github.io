// perf2: shop offers (coins only, no real money, no server). Pure + deterministic: the same date gives every player the
// same rotation (items already owned are skipped in favour of the next ones in that week's seeded order).
//  - weekly: 4 discounted cosmetics, rotating Monday 00:00 local (ISO week seed), 15-40 % off
//  - monthly: one featured bundle per calendar month (a coin skin + two flags)
//  - occasions: Ramadan, Eid al-Fitr, Eid al-Adha (hardcoded Gregorian table 2026-2030), New Year, Valentine's,
//    Halloween, Christmas, Iraqi National Day (Oct 3), weekend fallback; one themed bundle each
// Rarity-aware: legendary skins get smaller discounts (15-25 %) than flags (15-40 %), never below a floor.
// The clock only changes WHICH items are discounted; nothing is granted by time. If the device clock jumps backwards,
// the last seen rotation is kept (stableNow).
import { SKINS, FLAGS, FLAG_PRICE } from "./skins.js?v=srv2";
const DAY = 86400000;
// purchasable with coins: legendary skins whose source is "coins:N", and every flag
export const coinSkins = () => SKINS.map((s, i) => [s, i]).filter(([s]) => s.src && s.src.startsWith("coins:")).map(([s, i]) => ({ k: "skin", i, id: s.id, base: +s.src.split(":")[1], rar: s.rar }));
export const coinFlags = () => FLAGS.map((f, i) => (f ? { k: "flag", i, id: f.c, base: FLAG_PRICE, rar: "rare" } : null)).filter(Boolean);
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0; return h; }
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const round5 = (x) => Math.max(5, Math.round(x / 5) * 5);
// discount range + floor by rarity
const RANGE = { legendary: [0.15, 0.25], epic: [0.15, 0.35], rare: [0.15, 0.4], common: [0.15, 0.4] };
export function priceFor(it, r) { const [lo, hi] = RANGE[it.rar] || RANGE.rare, off = lo + (hi - lo) * r, floor = Math.ceil(it.base * (1 - hi)); return { off: Math.round(off * 100), price: Math.max(floor, round5(it.base * (1 - off))) }; }
// local calendar helpers
export function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; } // Monday 00:00 local
export function isoWeekKey(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + "-W" + String(Math.ceil(((t - y0) / DAY + 1) / 7)).padStart(2, "0"); }
const owns = (S, it) => (it.k === "skin" ? S.unlocked("skin", it.i) : S.p.flags.includes(it.i));
export function weeklyOffers(S, d) {
  const key = isoWeekKey(d), r = rng(hash("wk:" + key)); const skins = shuffled(coinSkins(), r), flags = shuffled(coinFlags(), r);
  const out = []; const take = (list, n) => { for (const it of list) { if (n <= 0) break; if (owns(S, it)) continue; out.push({ ...it, ...priceFor(it, rng(hash(key + it.k + it.i))()) }); n--; } };
  take(skins, 2); take(flags, 4 - out.length); // 2 skins (fewer if all owned) + flags to make 4
  const next = weekStart(d); next.setDate(next.getDate() + 7); return { key, items: out, ends: next.getTime() };
}
function bundle(S, key, nFlags, pref) {
  const r = rng(hash(key)); const skin = shuffled(coinSkins(), r).find((it) => !owns(S, it)); let flags = shuffled(coinFlags(), r);
  if (pref) flags = [...flags.filter((f) => pref.includes(f.id)), ...flags.filter((f) => !pref.includes(f.id))];
  const fl = flags.filter((it) => !owns(S, it)).slice(0, nFlags); const items = [skin, ...fl].filter(Boolean); if (!items.length) return null;
  const base = items.reduce((a, it) => a + it.base, 0), off = skin ? 0.25 : 0.35, price = Math.max(Math.ceil(base * 0.6), round5(base * (1 - off)));
  return { key, items, base, price, off: Math.round((1 - price / base) * 100) };
}
export function monthlyBundle(S, d) { const key = "mo:" + d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); const b = bundle(S, key, 2); const ends = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); return b ? { ...b, ends } : null; }
// Islamic dates (Gregorian, astronomical estimates; local sighting can shift them by a day): [ramadanStart, eidFitr, eidAdha]
export const HIJRI = { 2026: ["2026-02-18", "2026-03-20", "2026-05-27"], 2027: ["2027-02-08", "2027-03-10", "2027-05-16"], 2028: ["2028-01-28", "2028-02-26", "2028-05-05"], 2029: ["2029-01-16", "2029-02-14", "2029-04-24"], 2030: ["2030-01-05", "2030-02-04", "2030-04-13"] };
const ymd = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
// occasions in priority order; each: id, theme, start/end (local, end exclusive), preferred flags for its bundle
export function occasionFor(d) {
  const y = d.getFullYear(), at = d.getTime(), L = [];
  for (const yy of [y - 1, y]) { const H = HIJRI[yy]; if (!H) continue; const R = ymd(H[0]), F = ymd(H[1]), A = ymd(H[2]);
    L.push({ id: "eidAdha", theme: "eid", s: A, e: new Date(A.getTime() + 4 * DAY), pref: ["IQ", "SA"] }, { id: "eidFitr", theme: "eid", s: F, e: new Date(F.getTime() + 3 * DAY), pref: ["IQ", "SA"] }, { id: "ramadan", theme: "ramadan", s: R, e: F, pref: ["IQ", "EG"] }); }
  L.push({ id: "newYear", theme: "fireworks", s: new Date(y - 1, 11, 31), e: new Date(y, 0, 3) }, { id: "newYear", theme: "fireworks", s: new Date(y, 11, 31), e: new Date(y + 1, 0, 3) },
    { id: "valentine", theme: "hearts", s: new Date(y, 1, 12), e: new Date(y, 1, 15) }, { id: "iraqDay", theme: "iraq", s: new Date(y, 9, 1), e: new Date(y, 9, 4), pref: ["IQ"] },
    { id: "halloween", theme: "pumpkins", s: new Date(y, 9, 29), e: new Date(y, 10, 1) }, { id: "christmas", theme: "snow", s: new Date(y, 11, 22), e: new Date(y, 11, 27) });
  const hit = L.find((o) => at >= o.s.getTime() && at < o.e.getTime());
  if (hit) return { id: hit.id, theme: hit.theme, start: hit.s.getTime(), ends: hit.e.getTime(), pref: hit.pref || null, key: hit.id + ":" + hit.s.getFullYear() + "-" + (hit.s.getMonth() + 1) + "-" + hit.s.getDate() };
  const wd = d.getDay(); if (wd === 5 || wd === 6 || wd === 0) { const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((wd + 2) % 7)); return { id: "weekend", theme: "stars", start: s.getTime(), ends: s.getTime() + 3 * DAY, pref: null, key: "weekend:" + s.toDateString() }; } // Fri 00:00 - Mon 00:00
  return null;
}
export function occasionBundle(S, d) { const o = occasionFor(d); if (!o) return null; const b = bundle(S, "occ:" + o.key, 1, o.pref); return b ? { ...b, occ: o, ends: o.ends } : { occ: o, items: [], ends: o.ends }; }
// clock-tamper resilience: never go back to an older rotation when the device clock jumps backwards (> 1 h)
export function stableNow(KV, now = Date.now()) { const last = +(KV.get("ssp-offt") || 0); if (last && now < last - 3600000) return new Date(last); if (now > last) KV.set("ssp-offt", String(now)); return new Date(now); }
export function fmtLeft(ms) { ms = Math.max(0, ms); const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000); return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`; }
