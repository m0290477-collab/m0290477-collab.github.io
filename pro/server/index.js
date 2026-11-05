// super-snake-online — Cloudflare Worker + Durable Object (one DO per room). No database, no payments, nothing stored.
// The room runs the SAME sim.js as the client at 30 Hz and is authoritative for movement, food, mass, collisions and kills.
// Clients predict their own snake (input seq/ack reconciliation) and interpolate everyone else.
import { periodId, Sim, C, radiusOf, lengthOf, angDiff, moveSnake, sanitizeSkin, cleanName, BOT_NAMES, pickBotName, TROPHY, trophyDelta, seasonCarry, seasonId, weekId, prevPeriodId, botTrophies, filterText, idKind, idPrice, ID_PRICES, SPECIAL_REP, SPECIAL_SEQ, MSG_MAX, CHAT_KEEP, EVENTS, MUTS, mutNow, Terr, TER } from "./sim.js";
import { DAY, LOGIN, LOGIN_NOCOS, SPIN, SPIN_NOCOS, spinPick, RANDOM_COS, SEASON, seasonReward, UNLOCKS, ACH_COINS, levelCoins, bonusCoins, dailyMissions, weeklyCoins, WC_REWARD, DAILY_MODE_BONUS,
  leagueSeasonReward, CONQ_REWARD, rankReward, mileReward, CONTESTS, matchCoins, matchXp, plausible, OFF, ONLINE, catItem, validKey, offerCandidates, gtPrice, SHOP_TRAILS, BOUNTY, btyVal } from "./econ.js"; // coin1: shared economy tables
import { SKINS, EYES, TRAILS, FLAG_PRICE, FLAG_PRICE0, setFlagPrice, FUSION_FEE, FUSION_FEE0, setFusionFee, fusable, fuKey, fusionDef } from "./skins.js";
// ---------- fix1: equipped cosmetics checked against the server wallet (own list + server level). Requirements mirror
// js/profile.js (AVATARS / FRAMES; test/fix1s.test.mjs keeps them equal): number = level, "g" = granted only (must be owned),
// 0 = free, "x" = achievement / stat / season (the server does not hold those: accepted).
export const AV_REQ = [0, 0, 0, 0, 5, 8, 12, 15, 20, 25, "x", "x", "x", 40, "x", "x", 30, 10, 18, 45, "x", "x", 22, "x"];
export const FR_REQ = [0, 5, 15, 30, 50, 75, "x", 10, 20, 35, "x", "x", 60, 12, "x", "g", "g", "g"];
const reqOk = (r, lv, own, key) => r === 0 || r === "x" || own.has(key) || (typeof r === "number" && lv >= r);
// returns [checked skin, list of fields that fell back to the default]. V = { own: Set, lv, o (owner) } or null (no identity: nothing owned, level 1)
export function verifySkin(sk, V) {
  if (V && V.o) return [sk, []]; const own = V ? V.own : new Set(), lv = V ? Math.max(1, V.lv | 0) : 1, d = sanitizeSkin(null), o = { ...sk }, cut = [];
  if (o.k === "skin") { const S = SKINS[o.i]; let ok = !!S; if (S) { if (S.src) { const [k, n] = S.src.split(":"); ok = own.has(S.id) || (k === "level" && lv >= +n); } else ok = lv >= (S.lv | 0); } if (!ok) { o.k = d.k; o.i = d.i; cut.push("skin"); } }
  else if (o.k === "flag" && !own.has("fl:" + o.i)) { o.k = d.k; o.i = d.i; cut.push("flag"); }
  else if (o.k === "fu") { const F = fusionDef(o.i); if (!F || !own.has(F.key)) { o.k = d.k; o.i = d.i; cut.push("fusion"); } } // land1: a fusion skin must be owned
  if (o.e && !(EYES[o.e] && lv >= EYES[o.e].lv)) { o.e = 0; cut.push("eye"); }
  if (o.t && !(TRAILS[o.t] && lv >= TRAILS[o.t].lv)) { o.t = 0; cut.push("trail"); }
  if (o.gt) { const pr = gtPrice(o.gt); if (pr < 0 || (pr && !own.has("gt:" + o.gt))) { delete o.gt; cut.push("gt"); } }
  if (o.fr && !(o.fr < FR_REQ.length && reqOk(FR_REQ[o.fr], lv, own, "fr:" + o.fr))) { o.fr = 0; cut.push("frame"); }
  if (typeof o.av === "string" && /^p\d+$/.test(o.av)) { const i = +o.av.slice(1); if (!(i < AV_REQ.length && reqOk(AV_REQ[i], lv, own, "av:" + o.av))) { o.av = "p0"; cut.push("avatar"); } }
  return [o, cut];
}
// fix1: server XP. Credited only by server-judged events (offline match claims within plausible(), room-observed online lives,
// missions, weekly tasks, the server-rolled spin), each bounded, and XP.DAY per UTC day in total. Level-up claims and
// snapshots can not go above it.
export const XP = { MATCH: 4 * OFF.PER_MATCH, LIFE: 4 * ONLINE.PER_LIFE, DAY: 60000, SLACK: 3000, MIG_LV: 20 };
export const cumXp = (L) => { let x = 0; for (let n = 1; n < Math.min(L, LV_MAX); n++) x += xpNeed(n); return x; };

const TICK = 1 / 30, MAX_HUMANS = 12, TARGET_SNAKES = 30, VERSION = 14; // v14 (land1): territory rooms (tp-<bracket>-<n> public via the matchmaker, t-<code> private; server-owned cells, delta sync, 3-min rounds, placement trophies), skin fusion (w_fuse, fee px.fusion), territory switch; v13 (warm2): public rooms start as a world ~2-3 min old (seeded grown bots, curved bodies, corpse trails, steady-state food) + 45-tick settle instead of a 240-tick fast-forward; bounty restarts at base after any warm-up; v12 (play2): crown bounty on #1 in public rooms, weekend mutators (owner override a_mut), offline claims refused for switched-off modes, flag price editable; v11 (admin2): owner admin (coins/items/level/ids, announcement, gift-all, promo codes, maintenance, modes/events, prices, rooms + kick, chat delete, trophies, stats, backup now); warm rooms fast-forward; v10 (grow1): ids first seen after coin1 import 0 coins / level 1; challenge links (/c);  v9 (fix1): rooms check equipped cosmetics against the server wallet (unowned -> default, logged); server-side XP (sxp) with per-match bounds + daily cap gates level-up claims and snapshots. v8 (ops1): owner-only /admin/snap (JSON snapshot of the social + board objects), /admin/restore (merge, idempotent), /admin/trim (ledger rows older than 60 days summarised per player). v7 v7 (coin1): server wallet (balance, owned items, purchases, idempotent claims, room-paid online coins). v6 v6 (srv2): accounts (device -> account link, Google / Apple / email sign-in, versioned profile snapshots), owner admin (id 1), bans / mutes, matchmaker "mm-v1" (skill brackets, warm rooms) · v5 (srv1): social object "social-v1" (public ids, special ids, friends, chat, invites, live /sws), snake "u" = public id, skins carry "gt" · v4 (comp1): server-decided trophies ("tro"), snake league "tr", board DO "board-v1" (leaderboards, contests, seasons) · v2: power-ups (pus / pu+ / pu- / sh) · v3: 11 power-ups, arena events (evt / met), emotes (emo), avatars in skins
const ORIGINS = [/^https:\/\/(www\.)?billke\.com$/, /^https:\/\/m0290477-collab\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// look1: bots never share a look with any live snake (players included)
const uniqSkin = (snakes, i) => { const used = new Set(); for (const o of snakes) if (o.alive && o.skin) used.add(o.skin.k + ":" + o.skin.i); for (let k = 0; k < 60; k++) { const c = BOT_SKINS(i + k * 5); if (!used.has(c.k + ":" + c.i)) return c; } return BOT_SKINS(i); };
const BOT_SKINS = (i) => ({ k: i % 3 === 0 ? "flag" : "skin", i: i % 3 === 0 ? (i * 37) % 197 : i % 24, e: i % 4, t: 0, n: 0, av: i % 3 === 0 ? "f" + ((i * 37) % 197) : "p" + ((i * 7) % 24), fr: i % 5 === 0 ? 0 : 1 + (i % 4) });
const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
const SOCIAL = "social-v1"; // srv1: the one social object (same Room class, SQLite-backed; no new migration)
const OWNER_H = "f7fbde3c1fea505ba93f50420658e738b482e0fd55dea9bf270829ecb8d0fa78"; // srv1: SHA-256 of the one-time founder claim code (id 1); the code itself is not in any file that ships
const BAK = "bak-v1"; // admin2: owner "Backup now" snapshots live in this object (same Room class, SQLite; last 5 kept)
const BOARD = "board-v1"; // name of the single leaderboard object (same Room class, SQLite-backed; no new migration needed)
// anonymous device player id: the client keeps a random secret (pk); the public id is a hash of it, so nobody can write to
// or claim for another player's id without the secret. Sign-in can later link a pid to an account.
async function pidOf(pk) { if (typeof pk !== "string" || !/^[0-9a-f]{32,64}$/.test(pk)) return ""; const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + pk)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); }
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: cors });

// ---------- srv2: accounts, sign-in, matchmaking ----------
const MM = "mm-v1";
const ACCT_OPS = new Set(["acst", "snap", "pull", "out", "adel", "em1", "em2", "idt", "nonce", "gack"]); // the matchmaker: one in-memory object (same Room class) that rooms report to and players pick a room from
export const BRACKETS = ["bs", "gp", "dc", "cq"]; // Bronze–Silver, Gold–Platinum, Diamond–Crown, Conqueror (comp1 leagues)
export const bracketOf = (tr, cq) => (cq ? "cq" : tr >= 2800 ? "dc" : tr >= 1000 ? "gp" : "bs");
export const MM_CFG = { WAIT: 5000, LOW: 3, HB_MS: 30000, LIVE_MS: 75000, WARM_MS: 8 * 60000, LINGER_MS: 30000, MAX: MAX_HUMANS };
// admin2: modes the owner can switch off (ids = client MODE_LIST) and the warm-room fast-forward (headless ticks, no humans)
export const ADM_MODES = ["classic", "daily", "goldrush", "infection", "duel", "br", "koth", "boss", "team", "time", "survival", "zen", "online", "territory"]; // land1: territory (offline + online rooms)
// warm2: a new public room is SEEDED as if ~2-3 min old (no CPU spent simulating those minutes), then settles for SIM ticks.
// MQ = bot mass quantiles 0,5,..,100 % measured from 8 cold 30-bot rooms after 60/120/180 s of play (work/warm2/calib.mjs);
// kills ~ Poisson(0.3 + m/180) (same calibration); FRESH whole corpses + OLD half-eaten ones; food total = target x FOOD_K,
// corpse food replacing ambient food (steady state ~ half the food is remains). Seeded bots are ordinary bots (same rules).
export const WARM2 = { SIM: 45, RESUME: 45, MQ: [24, 29, 31, 32, 32, 32, 32, 34, 36, 40, 46, 55, 64, 81, 94, 111, 133, 158, 196, 249, 439], FRESH: 4, OLD: 14, FOOD_K: 1.01, TRY: 10 };
export const FF = { TICKS: WARM2.SIM, RESUME: WARM2.RESUME }; // admin2 names kept (tests / owner view); warm2: short settle only
export const warmMass = (u) => { const Q = WARM2.MQ, x = Math.max(0, Math.min(0.9999, u)) * (Q.length - 1), i = x | 0; return Q[i] + (Q[i + 1] - Q[i]) * (x - i); };
// warm2: one natural body: a head away from the wall and from other bodies, a heading, and a gently curving path walked backwards.
// occ = coarse grid of placed body samples (null = no clearance check, used for corpses). Returns {xs, ys, a} head-first or null.
let warmSeq = 0;
function warmBody(S, m, occ) { const R = S.R, r = radiusOf(m), len = lengthOf(m), sp = C.SPEED * S.dt, N = Math.min(C.CAP - 8, Math.ceil(len / sp) + 6), rnd = S.rand, G = 6;
  const key = (x, y) => (Math.floor(x / G) + 512) * 4096 + Math.floor(y / G) + 512;
  const free = (x, y, rr, own, idx) => { if (!occ) return true; const cx = Math.floor(x / G), cy = Math.floor(y / G);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const L = occ.get((cx + i + 512) * 4096 + cy + j + 512); if (!L) continue;
      for (let k = 0; k < L.length; k += 5) { const dx = L[k] - x, dy = L[k + 1] - y, need = own === L[k + 3] ? (Math.abs(idx - L[k + 4]) * sp > 6 * rr + 4 ? 2 * rr + 1.5 : -1) : rr + L[k + 2] + 2.5; if (need > 0 && dx * dx + dy * dy < need * need) return false; } }
    return true; };
  for (let t = 0; t < WARM2.TRY; t++) { const [hx, hy] = S.randPos(R * 0.8), d0 = Math.hypot(hx, hy);
    const a = d0 > R * 0.5 ? Math.atan2(-hy, -hx) + (rnd() - 0.5) * 2.4 : rnd() * 6.283185307179586;
    let ok = true; for (let k = 1; k <= 6 && ok; k++) { const px = hx + Math.cos(a) * k * 2, py = hy + Math.sin(a) * k * 2; if (px * px + py * py > (R * 0.9) ** 2 || !free(px, py, r, -1, 0)) ok = false; } // room ahead
    if (!ok) continue;
    const xs = new Float32Array(N), ys = new Float32Array(N), me = ++warmSeq; let x = hx, y = hy, th = a + Math.PI, w = (rnd() - 0.5) * 0.12; xs[0] = x; ys[0] = y; const mine = [];
    const add = (px, py, i) => { const k = key(px, py); let L = occ.get(k); if (!L) occ.set(k, (L = [])); L.push(px, py, r, me, i); mine.push(L); };
    for (let i = 1; i < N; i++) { w += (rnd() - 0.5) * 0.026 - w * 0.008; if (w > 0.16) w = 0.16; else if (w < -0.16) w = -0.16; th += w * sp;
      const dd = x * x + y * y; if (dd > (R * 0.84) ** 2) th += angDiff(Math.atan2(-y, -x), th) * 0.06; // the tail bends away from the wall
      x += Math.cos(th) * sp; y += Math.sin(th) * sp; xs[i] = x; ys[i] = y;
      if (x * x + y * y > (R - r - 2) ** 2) { ok = false; break; }
      if (occ && i % 3 === 0) { if (!free(x, y, r, me, i)) { ok = false; break; } add(x, y, i); } } // own samples go in as we walk (self-crossing check)
    if (occ && ok && !free(hx, hy, r, me, 0)) ok = false;
    if (!ok) { for (let q = mine.length - 1; q >= 0; q--) mine[q].length -= 5; continue; } // drop this attempt's samples
    if (occ) add(hx, hy, 0);
    return { xs, ys, a }; }
  return null; }
// write a head-first path into a snake's ring buffer (tail pushed first)
function warmApply(s, B) { s.h = 0; s.n = 0; for (let i = B.xs.length - 1; i >= 0; i--) s.push(B.xs[i], B.ys[i]); s.x = B.xs[0]; s.y = B.ys[0];
  const a = Math.atan2(B.ys[0] - B.ys[1], B.xs[0] - B.xs[1]); s.a = s.ta = s.lastA = a; s.av = 0; if (s.ai) s.ai.wa = a; }
const poisson = (rnd, lam) => { let k = 0, p = Math.exp(-lam), c = p, u = rnd(); while (u > c && k < 12) { k++; p *= lam / k; c += p; } return k; };
const PX0 = new Map(); // admin2: catalogue prices before any owner override
export function applyPx(px) { px = px || {};
  for (const S of SKINS) { if (!S.src || !/^coins:/.test(S.src)) continue; if (!PX0.has(S.id)) PX0.set(S.id, +S.src.split(":")[1]); const v = px[S.id] | 0; S.src = "coins:" + (v > 0 ? v : PX0.get(S.id)); }
  for (const G of SHOP_TRAILS) { if (!G.price) continue; const k = "gt:" + G.id; if (!PX0.has(k)) PX0.set(k, G.price | 0); const v = px[k] | 0; G.price = v > 0 ? v : PX0.get(k); }
  if (!PX0.has("flags")) PX0.set("flags", FLAG_PRICE0); setFlagPrice(px.flags | 0); // play2: one price for every flag
  if (!PX0.has("fusion")) PX0.set("fusion", FUSION_FEE0); setFusionFee(px.fusion | 0); } // land1: skin fusion fee
export const pxBase = (k) => PX0.get(k);
const SNAP_MAX = 64000, WARM_TICKS = 6, WARM_MASS = [24, 60, 140, 32, 220, 90, 420, 48, 170, 700, 36, 260, 110, 30, 520, 75, 1100, 40, 190, 330, 28, 130, 900, 55, 240, 26, 380, 66, 150, 1500]; // one profile snapshot (JSON text)
export const LV_MAX = 100, xpNeed = (n) => Math.round(100 * n ** 1.6); // same curve as js/store.js
export function lvOf(xp) { let n = 1, x = +xp || 0, need = xpNeed(1); while (n < LV_MAX && x >= need) { x -= need; n++; need = xpNeed(n); } return n; }
// what a snapshot may gain between two saves without a server grant (coins / xp). Anything above is cut back and counted.
export const allowance = (mins) => ({ coins: Math.round(4000 + 250 * Math.min(mins, 2880)), xp: Math.round(30000 + 3000 * Math.min(mins, 2880)) });
// ---------- coin1: wallet rules ----------
// migration: the device balance is imported ONCE, capped: the founder up to 10M; an account with a server snapshot up to that
// snapshot's coins + the srv2 allowance for the time since it was saved; everyone else up to 200,000. Cuts are logged.
export const CH_MODES = new Set(["classic", "time", "survival", "br", "koth", "boss", "team", "goldrush", "infection", "duel", "territory"]), CH_AB = "abcdefghjkmnpqrstuvwxyz23456789", CH_TTL = 30 * DAY; // grow1: challenge links (offline modes)
export const MIG = { FIRST: 200000, OWNER: 10000000, ITEMS: 800, CKS: 600, CUT: Date.parse("2026-11-04T18:35:00Z") };
// grow1: only ids the server knew before the coin1 release (acct row or a device seen before CUT) keep the one-time import;
// a device id first seen after it imports 0 coins, no items, level 1 (fresh ids could otherwise mint 200k each).
export const LV_DAY = 15; // level-up rewards claimable per UTC day (fast early levels fit, a forged level jump does not)
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const dNum = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? Math.floor(Date.parse(s + "T00:00:00Z") / DAY) : NaN);
const prevDay = (s) => new Date(Date.parse(s + "T00:00:00Z") - DAY).toISOString().slice(0, 10);
// a device's calendar day ("YYYY-MM-DD", local) is accepted from 3 days back (claims queued offline) to 1 day ahead (time zones)
export const dayOk = (s, now = Date.now(), back = 3) => { const n = dNum(s), t = Math.floor(now / DAY); return Number.isFinite(n) && n >= t - back && n <= t + 1; };
const isoWkU = (ms) => { const d = new Date(ms), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = Date.UTC(t.getUTCFullYear(), 0, 1); return t.getUTCFullYear() + "-W" + Math.ceil(((t - y0) / DAY + 1) / 7); }; // store.js format (no zero pad)
export const weekOk = (w, now = Date.now()) => { for (let k = -3; k <= 1; k++) if (isoWkU(now + k * DAY) === w) return true; return false; };
const S_MAX = 9000; // coin1: a claim batch (25) / the one-time migration (item list) may be larger than other social ops (1,200)
const CK_RE = /^[a-z]{1,6}:[A-Za-z0-9:._-]{1,80}$/;
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rnd = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); };
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const b64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export const IDP = { // ID-token issuers (OpenID Connect): Google Identity Services and Sign in with Apple
  g: { jwks: "https://www.googleapis.com/oauth2/v3/certs", iss: ["accounts.google.com", "https://accounts.google.com"] },
  a: { jwks: "https://appleid.apple.com/auth/keys", iss: ["https://appleid.apple.com"] },
};
const JWK_CACHE = new Map(); // jwks url -> { t, keys } (per isolate, 1 h)
async function jwks(url, fetcher, force) { const c = JWK_CACHE.get(url); if (c && !force && Date.now() - c.t < 3600000) return c.keys;
  const r = await fetcher(url); if (!r.ok) throw new Error("jwks " + r.status); const j = await r.json(); const keys = Array.isArray(j && j.keys) ? j.keys : []; JWK_CACHE.set(url, { t: Date.now(), keys }); return keys; }
// verifies an RS256 ID token against the issuer's JWKS: signature, iss, aud, exp / iat (60 s skew). Returns the claims or throws.
export async function verifyIdToken(tok, { jwks: url, iss, aud, now = Date.now(), fetcher = (u) => fetch(u) }) {
  if (!aud) throw new Error("not configured"); const parts = String(tok || "").split("."); if (parts.length !== 3 || tok.length > 8000) throw new Error("malformed");
  let h, c; try { h = JSON.parse(new TextDecoder().decode(b64u(parts[0]))); c = JSON.parse(new TextDecoder().decode(b64u(parts[1]))); } catch (_) { throw new Error("malformed"); }
  if (!h || h.alg !== "RS256" || typeof h.kid !== "string") throw new Error("alg");
  let keys = await jwks(url, fetcher), k = keys.find((x) => x.kid === h.kid); if (!k) { keys = await jwks(url, fetcher, true); k = keys.find((x) => x.kid === h.kid); } if (!k) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", { kty: k.kty, n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1])); if (!ok) throw new Error("signature");
  if (!iss.includes(c.iss)) throw new Error("iss"); const auds = Array.isArray(c.aud) ? c.aud : [c.aud]; if (!auds.includes(aud)) throw new Error("aud");
  const s = now / 1000; if (!(c.exp > s - 60)) throw new Error("expired"); if (c.iat && c.iat > s + 300) throw new Error("iat"); if (typeof c.sub !== "string" || !c.sub || c.sub.length > 255) throw new Error("sub");
  return c;
}
// srv2: pick a room. R: room name -> {room, br, i, h humans, b bots, t last report, pend just sent here}; P: recent pickers.
// 1) a room of the player's own bracket that has players and space; 2) a neighbouring bracket's populated room when the own
// bracket is quiet (fewer than LOW players looked for a match in 2 min) or the player has already waited WAIT ms; 3) while the
// own bracket is busy but has no open populated room, hold (the client asks again in 2.5 s); 4) the bracket's warm room (still
// in memory, bots playing) or its first room with space. A friend invite never comes here (it names the room).
export function mmPick(R, P, { pid, br, w = 0, x = "", now = Date.now(), md = "" }) { // land1: md "t" = territory rooms (tp-<br>-<n>), "" = classic (pub-)
  P.set(pid, { br, t: now, md }); if (P.size > 5000) for (const [k, v] of P) if (now - v.t > 120000) P.delete(k);
  const pre = md === "t" ? "tp-" : "pub-", rooms = [...R.values()].filter((r) => (r.md || "") === md), live = (r) => now - r.t < MM_CFG.LIVE_MS, cap = (r) => r.h + (r.pend || 0) < MM_CFG.MAX && r.room !== x;
  const withP = (b) => rooms.filter((r) => r.br === b && live(r) && r.h > 0 && cap(r)).sort((a, c) => c.h - a.h || a.i - c.i);
  const out = (r, fb, why) => { r.pend = (r.pend || 0) + 1; return { room: r.room, br: r.br, i: r.i, h: r.h, b: r.b, fb: fb || "", why, my: br }; };
  const own = withP(br); if (own.length) return out(own[0], "", "match");
  const pop = [...P.entries()].filter(([k, v]) => k !== pid && v.br === br && (v.md || "") === md && now - v.t < 120000).length, bi = BRACKETS.indexOf(br);
  const nb = [bi - 1, bi + 1].filter((i) => i >= 0 && i < BRACKETS.length).map((i) => BRACKETS[i]);
  if (w >= MM_CFG.WAIT || pop < MM_CFG.LOW) { const c = nb.flatMap(withP).sort((a, b2) => b2.h - a.h); if (c.length) return out(c[0], c[0].br, w >= MM_CFG.WAIT ? "wait" : "low"); }
  else return { hold: 1, br, wait: 2500, my: br };
  const warm = rooms.filter((r) => r.br === br && now - r.t < MM_CFG.WARM_MS && cap(r)).sort((a, c) => c.t - a.t)[0]; if (warm) return out(warm, "", "warm");
  for (let i = 1; i <= 60; i++) { const n = pre + br + "-" + i; let r = R.get(n); if (r && !cap(r)) continue; if (!r) { r = { room: n, br, i, h: 0, b: md === "t" ? TER.SNAKES : TARGET_SNAKES, t: now, pend: 0, up: now, md }; R.set(n, r); } return out(r, "", "new"); }
  return { room: pre + br + "-1", br, i: 1, h: 0, b: 0, fb: "", why: "overflow", my: br };
}
const EMAIL_RE = /^[^\s@<>"'`()[\]\\,;:]{1,64}@(?:[^\s@<>"'`()[\]\\,;:.]+\.)+[^\s@<>"'`()[\]\\,;:.\d]{2,24}$/u, PERM = 9e15;
export const maskEm = (e) => { const [u, d] = String(e).split("@"); return (u || "").slice(0, 2) + "***@" + (d || ""); };
// owner grants: cosmetics ("av:", "fr:", "ti:", "bn:", "bd:") go to p.cos, every other item id to p.owned (same fields the client uses)
export function applyItems(P, items) { if (!Array.isArray(P.owned)) P.owned = []; if (!Array.isArray(P.cos)) P.cos = []; for (const it of items) { const L = /^(av|fr|ti|bn|bd):/.test(it) ? P.cos : P.owned; if (!L.includes(it)) L.push(it); } }
// email codes go out through an HTTP mail API only when MAIL_API_KEY + MAIL_FROM are configured (Resend-compatible by default)
async function sendMail(env, to, code) {
  if (!env.MAIL_API_KEY || !env.MAIL_FROM) return "off";
  try { const r = await fetch(env.MAIL_API_URL || "https://api.resend.com/emails", { method: "POST", headers: { authorization: "Bearer " + env.MAIL_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: "Super Snake sign-in code: " + code, text: "Your Super Snake sign-in code is " + code + ". It expires in 10 minutes. If you did not ask for it, you can ignore this email.\n\nرمز الدخول إلى Super Snake هو " + code + " وينتهي خلال 10 دقائق." }) }); return r.ok ? "ok" : "fail"; } catch (_) { return "fail"; } }
const cfgOf = (env) => ({ g: (env && env.GOOGLE_CLIENT_ID) || "", a: (env && env.APPLE_SERVICES_ID) || "", ar: (env && env.APPLE_REDIRECT_URI) || "https://billke.com/pro/", em: env && env.MAIL_API_KEY && env.MAIL_FROM ? 1 : 0 });
const pre = (req) => { const origin = req.headers.get("Origin"); return origin && !ORIGINS.some((r) => r.test(origin)) ? new Response("origin not allowed", { status: 403 }) : null; };
const opts = (m) => new Response(null, { headers: { ...cors, "access-control-allow-methods": m, "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });

// ops1: owner-only backup API. Auth = header x-admin-key equal to the ADMIN_KEY secret (no CORS: scripts only).
// GET /admin/snap streams {v, wv, t, social:{table:[rows]}, board:{...}}; POST /admin/restore[?dry=1] merges a snapshot
// back (INSERT OR REPLACE, so a second run changes nothing); POST /admin/trim?days=60 summarises old ledger rows per player.
const keyEq = (a, b) => { a = String(a || ""); b = String(b || ""); if (!b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
async function adminHttp(req, env, url) {
  if (!env.ADMIN_KEY || !keyEq(req.headers.get("x-admin-key"), env.ADMIN_KEY)) return new Response('{"err":"auth"}', { status: 403, headers: { "content-type": "application/json" } });
  const so = env.ROOMS.get(env.ROOMS.idFromName(SOCIAL)), bo = env.ROOMS.get(env.ROOMS.idFromName(BOARD)), jh = { "content-type": "application/json" };
  if (url.pathname === "/admin/snap" && req.method === "GET") {
    const { readable, writable } = new TransformStream(), w = writable.getWriter(), te = new TextEncoder();
    (async () => { try { await w.write(te.encode('{"v":1,"wv":' + VERSION + ',"t":' + Date.now() + ',"social":'));
      for (const [o, nm, last] of [[so, "s", 0], [bo, "b", 1]]) { const r = await o.fetch("https://ops/x/snap?o=" + nm); if (!r.ok) throw new Error("snap " + nm);
        const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; await w.write(value); } await w.write(te.encode(last ? "}" : ',"board":')); }
      await w.close(); } catch (e) { try { await w.abort(e); } catch (_) {} } })();
    return new Response(readable, { headers: { ...jh, "cache-control": "no-store" } });
  }
  if (url.pathname === "/admin/restore" && req.method === "POST") { let B; try { B = JSON.parse(await req.text()); } catch (_) { return new Response('{"err":"json"}', { status: 400, headers: jh }); }
    if (!B || B.v !== 1) return new Response('{"err":"format"}', { status: 400, headers: jh }); const dry = url.searchParams.get("dry") === "1" ? "&dry=1" : "", out = {};
    for (const [o, nm, k] of [[so, "s", "social"], [bo, "b", "board"]]) if (B[k]) out[k] = await (await o.fetch("https://ops/x/restore?o=" + nm + dry, { method: "POST", body: JSON.stringify(B[k]) })).json();
    return new Response(JSON.stringify(out), { headers: jh }); }
  if (url.pathname === "/admin/trim" && req.method === "POST") return so.fetch("https://ops/x/trim?days=" + Math.max(30, Math.min(3650, +url.searchParams.get("days") || 60)), { method: "POST" });
  return new Response('{"err":"op"}', { status: 404, headers: jh });
}
export const OPS_SKIP = ["nonce", "ecode"]; // short-lived sign-in secrets: not worth keeping in a backup
export function opsSnap(q) { const out = {};
  for (const { name } of q.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").toArray()) if (!OPS_SKIP.includes(name)) out[name] = q.exec(`SELECT * FROM "${name}"`).toArray();
  return out; }
export function opsRestore(q, D, dry) { const have = new Set(q.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray().map((r) => r.name)), res = {};
  for (const [t, rows] of Object.entries(D || {})) { if (!/^[a-z0-9_]{1,32}$/.test(t) || !have.has(t) || OPS_SKIP.includes(t) || !Array.isArray(rows)) { res[t] = { skip: 1 }; continue; }
    const r = { rows: rows.length, live: q.exec(`SELECT COUNT(*) AS n FROM "${t}"`).one().n, put: 0, bad: 0 };
    if (!dry) for (const row of rows) { const ks = Object.keys(row || {}).filter((k) => /^[a-z0-9_]{1,32}$/.test(k)); if (!ks.length) { r.bad++; continue; }
      try { q.exec(`INSERT OR REPLACE INTO "${t}" (${ks.map((k) => '"' + k + '"').join(", ")}) VALUES (${ks.map(() => "?").join(", ")})`, ...ks.map((k) => row[k])); r.put++; } catch (_) { r.bad++; } }
    res[t] = r; }
  return res; }
// ledger trim: per player, rows older than the cutoff collapse into ONE row (kept under the id of the newest old row, k "sum", d = their
// total, bal = that row's balance), so the sum of d, every balance and the newest rows stay exact; restoring an older snapshot puts the detail back.
export function opsTrim(q, days = 60, now = Date.now()) { const cut = now - days * 86400000; let pl = 0, rm = 0;
  for (const g of q.exec("SELECT pid, COUNT(*) AS n, MAX(id) AS mx, SUM(d) AS sd FROM led WHERE t < ? GROUP BY pid HAVING n > 1", cut).toArray()) {
    const keep = q.exec("SELECT id, k FROM led WHERE id = ?", g.mx).one(); const n0 = g.n - 1;
    q.exec("DELETE FROM led WHERE pid = ? AND t < ? AND id < ?", g.pid, cut, g.mx); q.exec("UPDATE led SET k = 'sum', d = ?, ref = '', note = ? WHERE id = ?", g.sd, ("trim " + g.n + " rows" + (keep && keep.k === "sum" ? " (incl. earlier sum)" : "")).slice(0, 60), g.mx); pl++; rm += n0; }
  return { ok: 1, players: pl, removed: rm, cut }; }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response(JSON.stringify({ ok: true, name: "super-snake-online", v: VERSION, t: Date.now() }), { headers: cors });
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const origin = req.headers.get("Origin");
      if (origin && !ORIGINS.some((r) => r.test(origin))) return new Response("origin not allowed", { status: 403 });
      let room = (url.searchParams.get("room") || "pub-1").toLowerCase();
      if (!/^[a-z0-9-]{1,24}$/.test(room)) room = "pub-1";
      const id = env.ROOMS.idFromName(room);
      return env.ROOMS.get(id).fetch(new Request("https://room/ws?" + url.searchParams.toString() + "&name_room=" + room, req));
    }
    // comp1: public leaderboard / contest / season API -> the one board object (SQLite storage). /b/rec is internal only (room -> board).
    if (url.pathname === "/lb/top" || url.pathname === "/lb/me" || url.pathname === "/lb/claim") {
      if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
      const origin = req.headers.get("Origin"); if (origin && !ORIGINS.some((r) => r.test(origin))) return new Response("origin not allowed", { status: 403 });
      if (req.method === "POST" && +(req.headers.get("content-length") || 0) > 600) return new Response('{"err":"big"}', { status: 413, headers: cors });
      const body = req.method === "POST" ? await req.text() : null;
      return env.ROOMS.get(env.ROOMS.idFromName(BOARD)).fetch(new Request("https://board/b/" + url.pathname.slice(4) + url.search, { method: req.method === "POST" ? "POST" : "GET", body: body ? body.slice(0, 600) : null }));
    }
    // srv1: social API. POST /s {pk, op, ...} (HTTP fallback) and the live socket /sws?pk= (both -> the one social object)
    if (url.pathname === "/s" || url.pathname === "/sws") {
      if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
      const origin = req.headers.get("Origin"); if (origin && !ORIGINS.some((r) => r.test(origin))) return new Response("origin not allowed", { status: 403 });
      const so = env.ROOMS.get(env.ROOMS.idFromName(SOCIAL));
      if (url.pathname === "/sws") { if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 }); return so.fetch(new Request("https://social/sws?pk=" + encodeURIComponent(url.searchParams.get("pk") || ""), req)); }
      if (req.method !== "POST") return J({ err: "method" }, 405); if (+(req.headers.get("content-length") || 0) > S_MAX) return new Response('{"err":"big"}', { status: 413, headers: cors });
      return so.fetch(new Request("https://social/s/op", { method: "POST", body: (await req.text()).slice(0, S_MAX) }));
    }
    // srv2: sign-in config (client ids are public values; empty = that button stays hidden)
    if (url.pathname === "/cfg") return new Response(JSON.stringify(cfgOf(env)), { headers: { ...cors, "cache-control": "public, max-age=300" } });
    // srv2: accounts + sign-in. Google / Apple ID tokens are verified HERE (JWKS); only verified claims reach the social object.
    if (url.pathname === "/a") {
      if (req.method === "OPTIONS") return opts("POST"); const bad = pre(req); if (bad) return bad; if (req.method !== "POST") return J({ err: "method" }, 405);
      if (+(req.headers.get("content-length") || 0) > SNAP_MAX + 2000) return new Response('{"err":"big"}', { status: 413, headers: cors });
      let B; try { B = JSON.parse((await req.text()).slice(0, SNAP_MAX + 2000)); } catch (_) { return J({ err: "json" }, 400); } if (!B || typeof B !== "object") return J({ err: "json" }, 400);
      delete B._v; const C = cfgOf(env);
      if (B.op === "google" || B.op === "apple") { const k = B.op === "google" ? "g" : "a";
        try { const c = await verifyIdToken(String(B.tok || ""), { ...IDP[k], aud: k === "g" ? C.g : C.a }); const ev = c.email_verified === true || c.email_verified === "true";
          B._v = { k, sub: c.sub, em: ev && typeof c.email === "string" ? c.email.toLowerCase().slice(0, 254) : "", n: typeof c.nonce === "string" ? c.nonce : "" }; B.op = "idt"; }
        catch (e) { return J({ err: "token", m: String(e && e.message).slice(0, 60) }); } }
      else if (B.op === "test") { if (!env.TEST_KEY || typeof B.key !== "string" || B.key !== env.TEST_KEY) return J({ err: "op" }); const nm = String(B.name || "").toLowerCase(); if (!/^[a-z0-9-]{3,32}$/.test(nm)) return J({ err: "bad" }); B._v = { k: "t", sub: nm, em: "", n: "" }; B.op = "idt"; B.nn = 1; }
      return env.ROOMS.get(env.ROOMS.idFromName(SOCIAL)).fetch(new Request("https://social/a/op", { method: "POST", body: JSON.stringify(B) }));
    }
    // srv2: matchmaking -> the matchmaker picks a live room in the player's skill bracket (server-decided from the board)
    if (url.pathname === "/mm") {
      if (req.method === "OPTIONS") return opts("GET"); const bad = pre(req); if (bad) return bad;
      const pid = await pidOf(url.searchParams.get("pk") || ""); if (!pid) return J({ err: "pk" }, 400);
      return env.ROOMS.get(env.ROOMS.idFromName(MM)).fetch(new Request("https://mm/m/pick?pid=" + pid + "&w=" + (Math.max(0, Math.min(60000, +url.searchParams.get("w") || 0)) | 0) + "&x=" + encodeURIComponent((url.searchParams.get("x") || "").slice(0, 24)) + (url.searchParams.get("md") === "t" ? "&md=t" : "")));
    }
    if (url.pathname.startsWith("/admin/")) return adminHttp(req, env, url); // ops1: owner-only backups (ADMIN_KEY secret, never from a browser)
    return new Response("Super Snake online server", { headers: { "content-type": "text/plain" } });
  },
};

export class Room {
  constructor(state, env) { this.state = state; this.env = env; this.clients = new Set(); this.sim = null; this.timer = null; this.botSeq = 0; }
  init(params) {
    this.noBots = params.get("bots") === "0" && !/^(pub|tp)-/.test(params.get("name_room") || "");
    this.room = params.get("name_room") || "pub-1"; const mb = /^pub-(bs|gp|dc|cq)-(\d{1,2})$/.exec(this.room); this.br = mb ? mb[1] : ""; this.bi = mb ? +mb[2] : 0; // srv2: bracket room
    // land1: territory rooms: tp-<bracket>-<n> = public (matchmaker, trophies), t-<code> = private (friends + bots, no trophies)
    const mt = /^tp-(bs|gp|dc|cq)-(\d{1,2})$/.exec(this.room); if (mt) { this.br = mt[1]; this.bi = +mt[2]; } this.terOn = !!mt || /^t-[a-z0-9-]{1,22}$/.test(this.room); this.pub = this.room.startsWith("pub-") || !!mt;
    this.sim = new Sim({ dt: TICK, R: this.terOn ? TER.R_ON : undefined, seed: (Date.now() & 0xffffff) ^ 0x5eed, netMode: true, powerups: true, events: true, evtFirst: 35 });
    this.ter = null; if (this.terOn) { this.ter = this.sim.ter = new Terr(TER.R_ON, { dt: TICK, track: true, rand: this.sim.rand }); this.trd = { n: 1, end: this.sim.tick + Math.round(TER.DUR / TICK) }; }
    this.sim.diff = 1; this.errs = this.errs || 0; this.t0 = Date.now(); this.mutOv = this.mutOv || "auto"; this.sim.mut = mutNow(this.mutOv, Date.now()); this.bty = null; // play2
    this.wOff = (Math.random() * WARM_MASS.length) | 0;
    if (this.ter) { this.fill(false); this.ffMs = this.warmUp(WARM_TICKS); } // land1: a territory round starts fresh (start-size bots, small patches)
    else if (this.room.startsWith("pub-") && !this.noBots) { const t0 = performance.now(); this.seedWarm(); this.seedMs = Math.round((performance.now() - t0) * 10) / 10; this.ffMs = this.warmUp(FF.TICKS); } // warm2: seeded ~2-3 min old world + short settle
    else { this.fill(true); this.ffMs = this.warmUp(WARM_TICKS); } // admin2: other rooms unchanged
    this.btyReset(); // warm2: the crown bounty starts at its base value; seeded / simulated time never counts
    this.last = Date.now(); this.acc = 0;
  }
  fill(warm) {
    if (this.noBots) return;
    const alive = this.sim.snakes.filter((s) => s.alive).length; let want = (this.ter ? TER.SNAKES : TARGET_SNAKES) - alive; // land1: 16 snakes on the territory map
    // srv2: a fresh public room starts mid-game: bots spawn at mixed sizes (same rules as every other snake), later refills start small
    while (want-- > 0) { const i = this.botSeq++; const m = warm && !this.noBots ? Math.round(WARM_MASS[(i + (this.wOff | 0)) % WARM_MASS.length] * (0.8 + Math.random() * 0.4)) : undefined; const b = this.sim.addSnake(pickBotName(this.sim.snakes, i), uniqSkin(this.sim.snakes, i), { bot: true, diff: [1, 1, 2, 2, 3][i % 5], m }); if (b) { b.tr = botTrophies(i); if (m) b.kills = Math.floor(Math.sqrt(m) / 6 * Math.random()); } } // admin2: aged bots carry some kills (leaderboard looks mid-match)
  }
  // warm2: build the world of a public room that has been running for ~2-3 minutes, without simulating those minutes
  seedWarm() { const S = this.sim, rnd = S.rand, n = TARGET_SNAKES, occ = new Map(), bs = S.mut === "bs" ? 2 * C.START_M : 0;
    const us = []; for (let i = 0; i < n; i++) us.push((i + rnd()) / n); for (let i = n - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [us[i], us[j]] = [us[j], us[i]]; } // stratified: every room gets a full spread
    // biggest first, so the long bodies find room; each bot is an ordinary bot (same rules as any other snake)
    const ord = us.map((u, i) => [u, i]).sort((p, q) => q[0] - p[0]);
    for (const [u] of ord) { const i = this.botSeq++, m = Math.round(warmMass(u) * (0.92 + rnd() * 0.16)) + bs, B = warmBody(S, m, occ);
      const b = S.addSnake(pickBotName(S.snakes, i), uniqSkin(S.snakes, i), { bot: true, diff: [1, 1, 2, 2, 3][i % 5], m, pos: B ? [B.xs[0], B.ys[0]] : undefined });
      if (!b) continue; if (B) warmApply(b, B); b.tr = botTrophies(i); b.kills = Math.min(9, poisson(rnd, 0.3 + m / 180)); }
    // remains: a few fresh corpses (bots race to them) and older half-eaten trails; they replace ambient food so the total stays at steady state
    for (let k = 0; k < WARM2.FRESH + WARM2.OLD; k++) { const old = k >= WARM2.FRESH, m = Math.round(warmMass(0.45 + rnd() * 0.53)), B = warmBody(S, m, null); if (!B) continue;
      const c = S.addSnake("", null, { bot: true, m, pos: [B.xs[0], B.ys[0]] }); if (!c) continue; warmApply(c, B); const e0 = S.evSpawn.length; S.kill(c, 0, 2); S.removeSnake(c);
      if (old) { const keep = 0.35 + rnd() * 0.35; for (let j = e0; j < S.evSpawn.length; j++) if (rnd() > keep) S.removeFood(S.evSpawn[j], 0); S.feasts = S.feasts.filter((f) => f.id !== c.id); } }
    const want = Math.round(S.foodTarget * WARM2.FOOD_K); let over = S.fCount - want;
    if (over > 0) { const amb = []; for (let i = 0; i < S.FM; i++) if (S.fa[i] && S.fcl[i]) amb.push(i); for (let i = amb.length - 1; i > 0 && over > 0; i--) { const j = (rnd() * (i + 1)) | 0; S.removeFood(amb[j], 0); amb[j] = amb[i]; over--; } }
    S.drain(); this.fill(); S.drain(); }
  btyReset() { this.bty = null; if (!this.sim) return; const top = this.sim.snakes.filter((s) => s.alive).sort((a, b2) => b2.m - a.m)[0]; this.btyTrack(top, Date.now()); }
  // admin2: headless fast-forward (no humans, nothing sent): bots move, eat, die and respawn; returns the CPU ms it took
  warmUp(n) { const S = this.sim, t0 = performance.now(); for (let k = 0; k < n; k++) { S.step(() => true); S.drain(); if (k % 30 === 29) { for (const d of S.snakes.filter((x) => !x.alive)) S.removeSnake(d); this.fill(); } }
    S.drain(); for (const d of S.snakes.filter((x) => !x.alive)) S.removeSnake(d); this.fill(); S.drain(); return Math.round((performance.now() - t0) * 10) / 10; }
  lbMsg() { const srt = this.sim.snakes.filter((s) => s.alive).sort((a, b2) => b2.m - a.m); return JSON.stringify({ t: "lb", lb: srt.slice(0, 10).map((s) => [s.id, Math.round(s.m), s.kills]), humans: [...this.clients].filter((c) => c.joined).length, bt: this.btyMsg(), ...(this.ter ? { rl: this.terLeft(), rn: this.trd.n } : {}) }); }
  terLeft() { return this.ter ? Math.max(0, Math.round((this.trd.end - this.sim.tick) * TICK)) : 0; } // land1: seconds left in this round (tick clock: a sleeping room's round waits)
  // play2: crown bounty = the #1 snake of a public room; grows with its time at #1; the human who kills it is paid by this room
  btyTrack(top, now) { if (!this.ranked() || this.ter || !top) { this.bty = null; return; } /* land1: no crown bounty in territory */ if (!this.bty || this.bty.id !== top.id) this.bty = { id: top.id, t0: now }; }
  btyMsg() { const B = this.bty; return B ? [B.id, btyVal((Date.now() - B.t0) / 1000)] : null; }
  btyKill(dead) { const B = this.bty; if (!B) return; const d = dead.find((x) => x[0] === B.id); if (!d) return; this.bty = null; const by = d[1]; if (!by || d[2] === 5) return;
    const v = btyVal((Date.now() - B.t0) / 1000), c = [...this.clients].find((o) => o.snake && o.snake.id === by && o.pid); if (!c) return;
    const body = JSON.stringify({ pid: c.pid, ck: ("on:bty:" + this.room + ":" + (this.t0 || 0) + ":" + B.id + ":" + by + ":" + this.sim.tick).slice(0, 93), bty: v });
    try { this.env.ROOMS.get(this.env.ROOMS.idFromName(SOCIAL)).fetch("https://social/s/earn", { method: "POST", body }).then((r) => r.json()).then((r) => { if (r && r.ok && this.clients.has(c)) this.send(c, JSON.stringify({ t: "bty", c: r.c, v, bal: r.bal })); }).catch(() => {}); } catch (_) {} }
  // play2: weekend rule (schedule + owner override), checked once a second; the owner override is re-read from social every 60 s while players are in
  mutTick(now) { if (this.clients.size && now - (this.mutT || 0) > 60000) { this.mutT = now; try { this.env.ROOMS.get(this.env.ROOMS.idFromName(SOCIAL)).fetch("https://social/s/mu").then((r) => r.json()).then((r) => { if (r && typeof r.mu === "string") this.mutOv = r.mu; }).catch(() => {}); } catch (_) {} }
    const k = mutNow(this.mutOv, now); if (k !== (this.sim.mut || "")) { this.sim.mut = k; this.bcast(JSON.stringify({ t: "mut", k })); } }
  // srv2: the room tells the matchmaker who is here (on join / leave and every 30 s while players are in). No alarms: an empty room costs nothing.
  hb(force) { const now = Date.now(); if (!this.pub || (!force && now - (this.hbT || 0) < MM_CFG.HB_MS)) return; this.hbT = now;
    const h = [...this.clients].filter((c) => c.joined).length, b = this.sim ? this.sim.snakes.filter((s) => s.alive && s.bot).length : 0;
    const body = JSON.stringify({ room: this.room, br: this.br, i: this.bi, h, b, e: this.errs | 0, up: this.t0 || now });
    try { const r = this.env.ROOMS.get(this.env.ROOMS.idFromName(MM)).fetch("https://mm/m/hb", { method: "POST", body }); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/x/keep" || url.pathname === "/x/bk") { const q = this.state.storage.sql; q.exec("CREATE TABLE IF NOT EXISTS bk (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, sz INTEGER, n INTEGER)"); q.exec("CREATE TABLE IF NOT EXISTS bkp (id INTEGER, i INTEGER, js TEXT, PRIMARY KEY (id, i))");
      if (url.pathname === "/x/bk") return J({ list: q.exec("SELECT id, t, sz, n FROM bk ORDER BY id DESC").toArray() });
      const js = await req.text(), CH = 900000, n = Math.ceil(js.length / CH); q.exec("INSERT INTO bk (t, sz, n) VALUES (?, ?, ?)", Date.now(), js.length, n); const id = q.exec("SELECT MAX(id) AS m FROM bk").one().m;
      for (let i = 0; i < n; i++) q.exec("INSERT INTO bkp (id, i, js) VALUES (?, ?, ?)", id, i, js.slice(i * CH, (i + 1) * CH));
      for (const o of q.exec("SELECT id FROM bk ORDER BY id DESC LIMIT -1 OFFSET 5").toArray()) { q.exec("DELETE FROM bkp WHERE id = ?", o.id); q.exec("DELETE FROM bk WHERE id = ?", o.id); }
      return J({ ok: 1, id, kept: q.exec("SELECT COUNT(*) AS n FROM bk").one().n }); } // admin2 (internal only: the worker never routes /x/ from outside)
    if (url.pathname.startsWith("/x/")) { // ops1: backups (only the worker's owner-checked /admin/* builds these requests)
      const q = url.searchParams.get("o") === "b" ? this.db() : this.sdb(), J2 = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
      if (url.pathname === "/x/snap") return J2(opsSnap(q));
      if (url.pathname === "/x/restore") { let D = {}; try { D = JSON.parse(await req.text()); } catch (_) {} return J2(opsRestore(q, D, url.searchParams.get("dry") === "1")); }
      if (url.pathname === "/x/trim") return J2(opsTrim(this.sdb(), +url.searchParams.get("days") || 60));
      return J2({ err: "op" }); }
    if (url.pathname === "/r/info" || url.pathname === "/r/kick") { // admin2: owner room view / kick (only the social object builds these requests; never inits a room)
      const cl = [...this.clients].filter((c) => c.joined);
      if (url.pathname === "/r/info") return J({ room: this.room || "", live: this.timer ? 1 : 0, br: this.br || "", md: this.ter ? "t" : "", h: cl.length, b: this.sim ? this.sim.snakes.filter((s) => s.alive && s.bot).length : 0, ff: this.ffMs || 0, sd: this.seedMs || 0, pl: cl.map((c) => ({ u: c.uid || "", n: c.name, m: c.snake && c.snake.alive ? Math.round(c.snake.m) : 0 })) });
      const u = url.searchParams.get("u") || "", all = url.searchParams.get("all") === "1", why = (url.searchParams.get("k") || "kick").slice(0, 8); let n = 0;
      for (const c of [...this.clients]) if (all ? c.uid !== "1" : u && c.uid === u) { n++; this.send(c, JSON.stringify({ t: "kick", k: why, m: (url.searchParams.get("m") || "").slice(0, 200) })); if (c.snake && c.snake.alive) this.sim.kill(c.snake, 0, 4); try { c.ws.close(4012, why); } catch (_) {} this.drop(c); }
      return J({ ok: 1, n }); }
    if (url.pathname.startsWith("/b/")) return this.board(req, url); // comp1: this instance is the board object
    if (url.pathname.startsWith("/s/") || url.pathname === "/sws" || url.pathname === "/a/op") this.maint(); // srv2: owner maintenance set at deploy time (never via a request)
    if (url.pathname.startsWith("/s/")) return this.socialHttp(req, url); // srv1: this instance is the social object
    if (url.pathname === "/sws") return this.socialWs(req, url);
    if (url.pathname === "/a/op") return this.acctHttp(req); // srv2: accounts (only the worker builds this request)
    if (url.pathname.startsWith("/m/")) return this.mmHttp(req, url); // srv2: this instance is the matchmaker
    // srv2: a room kept in memory while empty resumes where it was; after WARM_MS it starts a fresh warm world
    if (this.sim && !this.clients.size && this.idleAt && Date.now() - this.idleAt > MM_CFG.WARM_MS) this.sim = null;
    else if (this.sim && !this.clients.size && !this.timer && this.idleAt && this.room.startsWith("pub-")) { this.ffMs = this.warmUp(Math.min(FF.RESUME, Math.round((Date.now() - this.idleAt - MM_CFG.LINGER_MS) / 1000 * 30))); this.btyReset(); } // admin2: a paused room catches up (bounded); warm2: 45 ticks max, bounty back to base (paused time never pays)
    if (!this.sim) this.init(url.searchParams); this.idleAt = 0; clearTimeout(this.lingerT); this.lingerT = 0;
    const humans = [...this.clients].length;
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair); server.accept();
    if (humans >= MAX_HUMANS) { server.send(JSON.stringify({ t: "full" })); server.close(4001, "full"); return new Response(null, { status: 101, webSocket: client }); }
    const c = { ws: server, snake: null, q: [], ack: 0xffff, extra: 0, name: "Guest", skin: sanitizeSkin(null), msgs: 0, win: Date.now(), joined: false, lastTa: 0, lastBoost: 0 };
    this.clients.add(c);
    server.addEventListener("message", (e) => this.onMsg(c, e.data));
    server.addEventListener("close", () => this.drop(c));
    server.addEventListener("error", () => this.drop(c));
    if (!this.timer) { this.last = Date.now(); this.acc = 0; this.timer = setInterval(() => this.loop(), 16); }
    return new Response(null, { status: 101, webSocket: client });
  }
  drop(c) {
    if (!this.clients.has(c)) return; this.clients.delete(c);
    if (c.snake && c.snake.alive) { this.sim.kill(c.snake, 0, 4); this.score(c, c.snake); }
    this.hb(true);
    // srv2: the world keeps running for LINGER_MS after the last player leaves (a quick "play again" lands in the same live
    // world), then pauses in memory; no timer is left behind, so an empty room makes no requests at all
    if (!this.clients.size && this.timer) { this.idleAt = Date.now(); clearTimeout(this.lingerT); this.lingerT = setTimeout(() => { if (!this.clients.size && this.timer) { clearInterval(this.timer); this.timer = null; } }, MM_CFG.LINGER_MS); }
  }
  send(c, m) { try { c.ws.send(typeof m === "string" ? m : m); } catch (_) {} }
  bcast(m) { for (const c of this.clients) if (c.joined) this.send(c, m); }
  snakeMsg(s) { // full description of one snake incl. its recent path (enough to draw the whole body)
    const pts = []; const k = Math.min(s.n, Math.ceil(s.len / (C.SPEED * TICK)) + 4);
    for (let i = k - 1; i >= 0; i--) pts.push(Math.round(s.sx(i) * 100) / 100, Math.round(s.sy(i) * 100) / 100);
    return { id: s.id, name: s.name, skin: s.skin, bot: s.bot ? 1 : 0, m: Math.round(s.m), a: s.a, path: pts, tick: this.sim.tick, tr: Number.isFinite(s.tr) ? s.tr : -1, u: s.uid || "" }; // srv1: u = public player id (humans)
  }
  onMsg(c, data) {
    const now = Date.now(); if (now - c.win > 1000) { c.win = now; c.msgs = 0; } if (++c.msgs > 90) { c.ws.close(4008, "rate"); return; }
    if (typeof data !== "string") { // binary input batch: u8 2, u8 n, n × (u16 seq, u16 ta, u8 boost)
      const v = new DataView(data); if (v.byteLength < 2 || v.getUint8(0) !== 2) return; const n = Math.min(10, v.getUint8(1));
      for (let i = 0; i < n && 2 + i * 5 + 5 <= v.byteLength; i++) { const o = 2 + i * 5; c.q.push(v.getUint16(o, true), (v.getUint16(o + 2, true) / 65536) * Math.PI * 2 - Math.PI, v.getUint8(o + 4)); }
      if (c.q.length > 60) c.q.splice(0, c.q.length - 30);
      return;
    }
    if (data.length > 2000) return; let m; try { m = JSON.parse(data); } catch (_) { return; }
    if (!m || typeof m.t !== "string") return;
    if (m.t === "hello") {
      c.name = cleanName(m.name); c.skin = sanitizeSkin(m.skin); c.joined = true;
      // srv2: device -> account (canonical player id) + ban / mute first, then trophies for that account
      if (!c.pidP && typeof m.pk === "string") c.pidP = pidOf(m.pk).then(async (dp) => { if (!dp) return; c.dp = dp; const u = await this.uidOf(c, 1); this.verC(c, u); c.verDone = 1; c.pid = (u && u.cp) || dp; if (!this.clients.has(c) || c.banned) return; if (!this.ranked()) return; try { const r = await (await this.boardStub().fetch("https://board/b/get?pid=" + c.pid)).json(); if (r && Number.isFinite(r.tr)) { c.tr = r.tr; if (c.snake) c.snake.tr = r.tr; this.send(c, JSON.stringify({ t: "tro0", tr: r.tr, ss: r.ss })); } } catch (_) {} }).catch(() => {}).finally(() => { if (!c.verDone) { c.verDone = 1; this.verC(c, null); } });
      else if (!c.pidP) { c.verDone = 1; this.verC(c, null); } // no device key: nothing owned on the server
      const hs = [...this.clients].filter((o) => o.joined).length;
      this.send(c, JSON.stringify({ t: "welcome", v: VERSION, room: this.room, br: this.br, bi: this.bi, h: hs, b: this.sim.snakes.filter((s) => s.alive && s.bot).length, tick: this.sim.tick, dt: TICK, R: this.sim.R, mu: this.sim.mut || "", ...(this.ter ? { ter: { cell: this.ter.cell, n: this.trd.n, left: this.terLeft(), pub: this.pub ? 1 : 0 } } : {}), snakes: this.sim.snakes.filter((s) => s.alive).map((s) => this.snakeMsg(s)) }));
      if (this.ter) this.send(c, this.ter.full()); // land1: the whole map once (runs), then deltas
      this.hb(true);
      this.send(c, this.foodFull()); this.send(c, this.lbMsg()); // admin2: leaderboard at once
      this.send(c, JSON.stringify({ t: "pus", l: this.sim.pus.map((p) => [p.id, p.k, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) }));
      const E = this.sim.evt; if (E) this.send(c, JSON.stringify({ t: "evt", k: E.k, ph: "start", id: E.id || 0, d: Math.max(1, Math.round(E.t)), late: 1 }));
      if (this.sim.mets.length) this.send(c, JSON.stringify({ t: "met", l: this.sim.mets.map((M) => [M.id, Math.round(M.x * 100) / 100, Math.round(M.y * 100) / 100, M.r, +M.t.toFixed(2), M.T]) }));
    } else if (m.t === "spawn") {
      if (!c.joined || c.banned || (c.snake && c.snake.alive)) return;
      if (c.pidP && !c.verDone) { if (!c.spW) { c.spW = 1; c.pidP.finally(() => { c.spW = 0; if (this.clients.has(c)) this.onMsg(c, data); }); } return; } // fix1: spawn once the wallet check is in
      if (c.snake) this.sim.removeSnake(c.snake);
      if (typeof m.name === "string") c.name = cleanName(m.name); if (m.skin) { c.skin = sanitizeSkin(m.skin); this.verC(c); }
      // a human replaces one bot so rooms stay the same size
      const bot = this.sim.snakes.find((s) => s.bot && s.alive); if (bot && !this.noBots) { bot.alive = false; this.sim.evDie.push(bot.id, 0, 5); }
      const s = this.sim.addSnake(c.name, c.skin, {}); c.snake = s; if (c.uid) s.uid = c.uid; c.q.length = 0; c.ack = 0xffff; c.extra = 0;
      s.tr = c.tr; c.life = { t0: Date.now(), best: 99, field: this.sim.snakes.filter((o) => o.alive).length, bm: s.m, done: false, pk: 0 }; // comp1: what this life is judged on
      if (this.ter && (!c.rd || c.rd.n !== this.trd.n)) c.rd = { n: this.trd.n, t0: Date.now(), k: 0 }; // land1: first life of this player in this round
      this.send(c, JSON.stringify({ t: "you", id: s.id, x: s.x, y: s.y, a: s.a, m: s.m, tick: this.sim.tick, seq: (m.seq | 0) & 0xffff }));
      c.q.length = 0; c.seq0 = (m.seq | 0) & 0xffff; c.buf = true;
    } else if (m.t === "die") { // the client saw its own head touch a body: accept at once (it can only hurt itself), credit the hit snake
      const s = c.snake; if (!s || !s.alive) return; const k = this.sim.byId.get(m.hit | 0);
      let by = 0; if (k && k.alive && k !== s) { const dx = k.x - s.x, dy = k.y - s.y; by = dx * dx + dy * dy < (k.len + 8) ** 2 ? k.id : 0; }
      if (k === s) return; // noself1: own body never kills (an old client's self report is ignored)
      this.sim.kill(s, by, by ? 3 : 1);
    } else if (m.t === "emo") { // quick emote: one per second per player, relayed to everyone else in the room
      const s = c.snake, e = m.e | 0; if (!s || !s.alive || e < 0 || e > 5 || now - (c.lastEmo || 0) < 1000 || (c.mute && c.mute > now)) return; c.lastEmo = now; // srv2: muted players send no emotes
      const msg = JSON.stringify({ t: "emo", id: s.id, e }); for (const o of this.clients) if (o !== c && o.joined) this.send(o, msg);
    } else if (m.t === "ping") this.send(c, JSON.stringify({ t: "pong", c: m.c, s: Date.now(), tick: this.sim.tick }));
  }
  // srv1: public id of a human in this room (shown on the in-match player card, used to add them as a friend)
  // srv2: also returns the account (canonical pid), a ban (the room refuses the player) and a chat mute
  // fix1: keep the wallet view (V) of this player and check the equipped cosmetics against it; a fallback is counted + logged
  verC(c, u) { if (u !== undefined) c.V = u && u.w ? { own: new Set(u.w.own || []), lv: u.w.lv | 0, o: u.w.o ? 1 : 0 } : null;
    const [sk, cut] = verifySkin(c.skin, c.V); c.skin = sk; if (cut.length) { this.cosCut = (this.cosCut | 0) + 1; console.log(JSON.stringify({ fix1: "cos_fallback", room: this.room, u: c.uid || "", cut })); } }
  uidOf(c, w) { return this.env.ROOMS.get(this.env.ROOMS.idFromName(SOCIAL)).fetch("https://social/s/uid?pid=" + c.dp + (w ? "&w=1" : "") + (this.ter ? "&md=t" : "")).then((r) => r.json()).then((r) => { if (!r || !/^\d{1,7}$/.test(r.id || "")) return r;
    if (r.ban) { c.banned = 1; this.send(c, JSON.stringify({ t: "ban", u: r.ban })); if (c.snake && c.snake.alive) this.sim.kill(c.snake, 0, 4); try { c.ws.close(4003, "banned"); } catch (_) {} return r; }
    if (r.mt) { this.send(c, JSON.stringify({ t: "kick", k: r.mt.k, m: r.mt.m || "" })); if (c.snake && c.snake.alive) this.sim.kill(c.snake, 0, 4); try { c.ws.close(4011, r.mt.k); } catch (_) {} return r; } // admin2: maintenance / online switched off (owner exempt)
    if (Array.isArray(r.evo)) this.sim.events = EVENTS.filter((k) => !r.evo.includes(k)); if (typeof r.mu === "string" && r.mu !== this.mutOv) { this.mutOv = r.mu; this.mutTick(Date.now()); } // play2 // admin2: events the owner switched off
    c.mute = r.mute || 0; c.uid = r.id; if (r.nm) { c.name = cleanName(r.nm); if (c.snake) c.snake.name = c.name; }
    const s = c.snake; if (s && s.alive && s.uid !== r.id) { s.uid = r.id; this.bcast(JSON.stringify({ t: "uid", id: s.id, u: r.id })); } this.send(c, JSON.stringify({ t: "myid", u: r.id })); return r; }).catch(() => null); }
  // ---------- comp1: trophies (server-decided), board object (leaderboards, weekly/monthly contests, monthly seasons) ----------
  ranked() { return !!this.pub && !this.noBots; } // land1: public territory rooms (tp-) are ranked too (placement at round end) // private rooms never move trophies (no farming with friends)
  boardStub() { return this.env.ROOMS.get(this.env.ROOMS.idFromName(BOARD)); }
  score(c, s) { // one finished life of a human -> trophies, judged only on what this server saw
    const L = c.life; if (!L || L.done) return; L.done = true; if (c.pid && !this.noBots) this.earn(c, s, L);
    if (this.ter) { if (c.rd && c.rd.n === this.trd.n) { c.rd.k += s.kills | 0; this.terDied(c, s); } return; } // land1: territory trophies come from the round placement (roundEnd), lives pay coins only
    if (!c.pid || !this.ranked()) return;
    const alive = this.sim.snakes.filter((o) => o.alive).length, field = Math.max(L.field, alive + 1, 2);
    const atDeath = 1 + this.sim.snakes.filter((o) => o.alive && o !== s && o.m > s.m).length, place = Math.min(L.best, atDeath);
    const kills = s.kills | 0, life = (Date.now() - L.t0) / 1000, sc = Math.round(Math.max(L.bm, s.m));
    const d = trophyDelta({ place, field, kills, life, t: c.tr | 0, online: 1 });
    const body = JSON.stringify({ pid: c.pid, name: c.name, d, kl: kills, sc: life >= TROPHY.LIFE_MIN ? sc : 0, u: c.uid || "" });
    this.boardStub().fetch("https://board/b/rec", { method: "POST", body }).then((r) => r.json()).then((r) => {
      if (!r || !r.ok) return; c.tr = r.tr; if (c.snake === s) s.tr = r.tr;
      if (this.clients.has(c)) this.send(c, JSON.stringify({ t: "tro", d: r.d, tr: r.tr, ss: r.ss, pl: place, f: field, k: kills, sc, life: Math.round(life) }));
    }).catch(() => { if (this.clients.has(c)) this.send(c, JSON.stringify({ t: "tro", err: 1 })); });
  }
  // coin1: coins for one online life, judged on what this room saw (the device claims nothing for online play)
  earn(c, s, L) { const body = JSON.stringify({ pid: c.pid, ck: ("on:" + this.room + ":" + (this.t0 || 0) + ":" + s.id + ":" + L.t0).slice(0, 93), best: Math.round(Math.max(L.bm, s.m, (L.pk || 0) * TER.PCT_BEST)), /* land1: land % counts like mass (x30), same formula + caps */ kills: s.kills | 0, dur: Math.round((Date.now() - L.t0) / 1000) });
    try { this.env.ROOMS.get(this.env.ROOMS.idFromName(SOCIAL)).fetch("https://social/s/earn", { method: "POST", body }).then((r) => r.json()).then((r) => { if (r && r.ok && this.clients.has(c)) this.send(c, JSON.stringify({ t: "coin", c: r.c, bal: r.bal })); }).catch(() => {}); } catch (_) {} }
  db() {
    if (this._db) return this._db; const q = this.state.storage.sql; this._db = q; this.lbc = new Map();
    q.exec("CREATE TABLE IF NOT EXISTS pl (pid TEXT PRIMARY KEY, name TEXT, tr INTEGER, ss TEXT, pk INTEGER, wk TEXT, wtr INTEGER, wkl INTEGER, wsc INTEGER, mo TEXT, mtr INTEGER, mkl INTEGER, msc INTEGER, n INTEGER, upd INTEGER)");
    for (const [n, c] of [["ss", "tr"], ["wk", "wtr"], ["wk", "wkl"], ["wk", "wsc"], ["mo", "mtr"], ["mo", "mkl"], ["mo", "msc"]]) q.exec(`CREATE INDEX IF NOT EXISTS i_${n}_${c} ON pl(${n}, ${c} DESC)`);
    q.exec("CREATE TABLE IF NOT EXISTS fin (per TEXT, met TEXT, pid TEXT, rk INTEGER, v INTEGER, cl INTEGER DEFAULT 0, PRIMARY KEY (per, met, pid))");
    q.exec("CREATE INDEX IF NOT EXISTS i_fin_pid ON fin(pid, cl)"); try { q.exec("ALTER TABLE pl ADD COLUMN u TEXT"); } catch (_) {} /* srv2: public id (premium ids styled on the leaderboard) */ q.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
    return q;
  }
  // period rollover (lazy, on the first request of a new week / month): freeze the final top lists that earn rewards
  roll(now) {
    const q = this.db(), get = (k) => { const r = q.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0]; return r ? r.v : ""; }, set = (k, v) => q.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, v);
    const W = weekId(now), M = seasonId(now), w0 = get("w"), m0 = get("m");
    const snap = (per, met, col, where, id, lim) => q.exec(`INSERT OR IGNORE INTO fin (per, met, pid, rk, v) SELECT ?, ?, pid, ROW_NUMBER() OVER (ORDER BY ${col} DESC, upd ASC), ${col} FROM pl WHERE ${where} ORDER BY ${col} DESC, upd ASC LIMIT ${lim}`, per, met, ...id);
    if (w0 !== W) { if (w0) for (const [met, col] of [["tr", "wtr"], ["kl", "wkl"], ["sc", "wsc"]]) snap("w:" + w0, met, col, `wk = ? AND ${col} > 0`, [w0], 50); set("w", W); this.lbc.clear(); }
    if (m0 !== M) { if (m0) { for (const [met, col] of [["tr", "mtr"], ["kl", "mkl"], ["sc", "msc"]]) snap("m:" + m0, met, col, `mo = ? AND ${col} > 0`, [m0], 100); snap("s:" + m0, "cq", "tr", "ss = ? AND tr >= ?", [m0, TROPHY.CONQ_MIN], TROPHY.CONQ_N); } set("m", M); this.lbc.clear(); }
    return { W, M };
  }
  async board(req, url) {
    try {
      const now = Date.now(), { W, M } = this.roll(now), q = this.db(), op = url.pathname.slice(3);
      const row = (pid) => q.exec("SELECT * FROM pl WHERE pid = ?", pid).toArray()[0] || null;
      const view = (r) => { // the player's state as of now (season soft reset + period counters applied, nothing written)
        if (!r) return { tr: 0, ss: M, pk: 0, wtr: 0, wkl: 0, wsc: 0, mtr: 0, mkl: 0, msc: 0 };
        const o = { ...r }; if (o.ss !== M) { o.tr = seasonCarry(o.tr); o.pk = o.tr; o.ss = M; } if (o.wk !== W) { o.wk = W; o.wtr = o.wkl = o.wsc = 0; } if (o.mo !== M) { o.mo = M; o.mtr = o.mkl = o.msc = 0; } return o; };
      let B = {}; if (req.method === "POST") { try { B = JSON.parse((await req.text()).slice(0, 600)) || {}; } catch (_) { B = {}; } }
      if (op === "get") { const pid = url.searchParams.get("pid") || ""; if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400); const v = view(row(pid));
        const cq = v.tr >= TROPHY.CONQ_MIN && q.exec("SELECT COUNT(*) AS n FROM pl WHERE ss = ? AND tr > ?", M, v.tr).one().n < TROPHY.CONQ_N ? 1 : 0; return J({ tr: v.tr, ss: M, cq }); } // srv2: cq = Conqueror (top 50 with 4,100+)
      if (op === "del") { const pid = url.searchParams.get("pid") || ""; if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400); q.exec("DELETE FROM pl WHERE pid = ?", pid); q.exec("DELETE FROM fin WHERE pid = ?", pid); this.lbc.clear(); return J({ ok: 1 }); } // srv2: account delete (internal)
      if (op === "aset") { const pid = String(B.pid || ""); if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400); const tr = Math.max(0, Math.min(100000, B.tr | 0)); // admin2: owner sets trophies (internal)
        if (row(pid)) q.exec("UPDATE pl SET tr = ?, ss = ?, pk = MAX(pk, ?), upd = ? WHERE pid = ?", tr, M, tr, now, pid); else q.exec("INSERT INTO pl (pid, name, tr, ss, pk, n, upd) VALUES (?, ?, ?, ?, ?, 0, ?)", pid, String(B.name || "Player").slice(0, 16), tr, M, tr, now); this.lbc.clear(); return J({ ok: 1, tr }); }
      if (op === "fin") { // internal (coin1): final contest ranks for a wallet claim -> { fin: { "sv:<per>:<met>": rk } }
        const pids = (Array.isArray(B.pids) ? B.pids : []).map(String).filter((x) => /^[0-9a-f]{20}$/.test(x)).slice(0, 3), fin = {};
        for (const k of (Array.isArray(B.keys) ? B.keys : []).map(String).slice(0, 10)) { const j = k.lastIndexOf(":"), per = k.slice(0, j), met = k.slice(j + 1); if (!/^[wms]:\d{4}-(W\d{2}|\d{2})$/.test(per)) continue;
          for (const p of pids) { const r = q.exec("SELECT rk FROM fin WHERE per = ? AND met = ? AND pid = ?", per, met, p).toArray()[0]; if (r) { fin["sv:" + k] = r.rk; break; } } }
        return J({ fin }); }
      if (op === "rec") { // internal: a room reports one finished life
        const pid = String(B.pid || ""); if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400);
        const d = Math.max(TROPHY.ON_MIN, Math.min(TROPHY.ON_MAX, B.d | 0)), kl = Math.max(0, Math.min(60, B.kl | 0)), sc = Math.max(0, Math.min(1e6, B.sc | 0));
        const v = view(row(pid)), tr = Math.max(0, Math.min(TROPHY.MAX, v.tr + d)), ap = tr - v.tr;
        q.exec("INSERT OR REPLACE INTO pl (pid, name, tr, ss, pk, wk, wtr, wkl, wsc, mo, mtr, mkl, msc, n, upd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          pid, cleanName(B.name), tr, M, Math.max(v.pk | 0, tr), W, (v.wtr | 0) + ap, (v.wkl | 0) + kl, Math.max(v.wsc | 0, sc), M, (v.mtr | 0) + ap, (v.mkl | 0) + kl, Math.max(v.msc | 0, sc), ((v.n | 0) + 1), now);
        if (/^\d{1,7}$/.test(String(B.u || ""))) q.exec("UPDATE pl SET u = ? WHERE pid = ?", String(B.u), pid);
        return J({ ok: 1, d: ap, tr, ss: M });
      }
      if (op === "top") { // ?k=tr|wtr|wkl|wsc|mtr|mkl|msc  -> top 50 (cached 20 s; ids shown shortened)
        const k = url.searchParams.get("k") || "tr"; if (!["tr", "wtr", "wkl", "wsc", "mtr", "mkl", "msc"].includes(k)) return J({ err: "k" }, 400);
        const c = this.lbc.get(k); if (c && now - c.t < 20000) return J(c.o);
        const where = k === "tr" ? "ss = ?" : k[0] === "w" ? `wk = ? AND ${k} > 0` : `mo = ? AND ${k} > 0`, per = k === "tr" || k[0] === "m" ? M : W;
        const list = q.exec(`SELECT pid, name, u, ${k} AS v FROM pl WHERE ${where} ORDER BY ${k} DESC, upd ASC LIMIT 50`, per).toArray().map((r, i) => ({ r: i + 1, n: r.name, v: r.v, id: r.pid.slice(0, 6), u: r.u || "" }));
        const o = { k, per, list, conqN: TROPHY.CONQ_N, conqMin: TROPHY.CONQ_MIN, t: now }; this.lbc.set(k, { t: now, o }); return J(o);
      }
      if (op === "me" || op === "claim") {
        const pid = await pidOf(String(B.pk || "")); if (!pid) return J({ err: "pk" }, 400);
        if (op === "claim") { const per = String(B.per || ""), met = String(B.met || ""); if (!/^[wms]:\d{4}-(W\d{2}|\d{2})$/.test(per) || !["tr", "kl", "sc", "cq"].includes(met)) return J({ err: "bad" }, 400);
          const r = q.exec("SELECT rk, v FROM fin WHERE per = ? AND met = ? AND pid = ? AND cl = 0", per, met, pid).toArray()[0]; if (!r) return J({ err: "none" });
          q.exec("UPDATE fin SET cl = 1 WHERE per = ? AND met = ? AND pid = ?", per, met, pid); return J({ ok: 1, per, met, rk: r.rk, v: r.v }); }
        const v = view(row(pid)), rank = (col, val, where, per) => (val > 0 ? q.exec(`SELECT COUNT(*) AS n FROM pl WHERE ${where} AND ${col} > ?`, per, val).one().n + 1 : 0);
        const rk = rank("tr", v.tr, "ss = ?", M);
        const out = { pid: pid.slice(0, 6), tr: v.tr, ss: M, pk: v.pk | 0, rank: rk, conq: rk > 0 && rk <= TROPHY.CONQ_N && v.tr >= TROPHY.CONQ_MIN ? 1 : 0, w: W, m: M,
          c: { w_rush: [v.wtr | 0, rank("wtr", v.wtr | 0, "wk = ?", W)], w_hunt: [v.wkl | 0, rank("wkl", v.wkl | 0, "wk = ?", W)], w_score: [v.wsc | 0, rank("wsc", v.wsc | 0, "wk = ?", W)],
            m_rush: [v.mtr | 0, rank("mtr", v.mtr | 0, "mo = ?", M)], m_hunt: [v.mkl | 0, rank("mkl", v.mkl | 0, "mo = ?", M)], m_score: [v.msc | 0, rank("msc", v.msc | 0, "mo = ?", M)] },
          claims: q.exec("SELECT per, met, rk, v FROM fin WHERE pid = ? AND cl = 0 LIMIT 20", pid).toArray(), t: now };
        return J(out);
      }
      return J({ err: "op" }, 404);
    } catch (e) { return J({ err: "server", m: String(e && e.message).slice(0, 120) }, 500); }
  }
  // ---------- srv1: social object "social-v1" (same Room class, SQLite): public ids, special ids, friends, 1:1 chat, invites ----------
  // Live delivery uses the Hibernation WebSocket API (state.acceptWebSocket, one tag = the player's pid), so idle lobby sockets
  // cost no duration while nothing happens. Everything here is synchronous SQL inside one object = atomic per request.
  sdb() {
    if (this._sdb) return this._sdb; const q = this.state.storage.sql; this._sdb = q; this.rl = new Map();
    q.exec("CREATE TABLE IF NOT EXISTS acct (pid TEXT PRIMARY KEY, id7 TEXT, vis TEXT, name TEXT, av TEXT, fr INTEGER, lv INTEGER, own INTEGER DEFAULT 0, seen INTEGER, t INTEGER)");
    q.exec("CREATE TABLE IF NOT EXISTS ids (num TEXT PRIMARY KEY, pid TEXT, kind TEXT, t INTEGER, tok TEXT)"); q.exec("CREATE INDEX IF NOT EXISTS i_ids_pid ON ids(pid)");
    q.exec("CREATE TABLE IF NOT EXISTS rq (a TEXT, b TEXT, t INTEGER, PRIMARY KEY (a, b))"); q.exec("CREATE INDEX IF NOT EXISTS i_rq_b ON rq(b)");
    q.exec("CREATE TABLE IF NOT EXISTS fr (a TEXT, b TEXT, t INTEGER, PRIMARY KEY (a, b))");
    q.exec("CREATE TABLE IF NOT EXISTS bl (a TEXT, b TEXT, t INTEGER, PRIMARY KEY (a, b))");
    q.exec("CREATE TABLE IF NOT EXISTS msg (id INTEGER PRIMARY KEY AUTOINCREMENT, cv TEXT, f TEXT, tx TEXT, t INTEGER)"); q.exec("CREATE INDEX IF NOT EXISTS i_msg_cv ON msg(cv, id)");
    q.exec("CREATE TABLE IF NOT EXISTS rd (pid TEXT, cv TEXT, last INTEGER, PRIMARY KEY (pid, cv))");
    q.exec("CREATE TABLE IF NOT EXISTS inv (a TEXT, b TEXT, room TEXT, t INTEGER, PRIMARY KEY (a, b))");
    q.exec("CREATE TABLE IF NOT EXISTS rep (id INTEGER PRIMARY KEY AUTOINCREMENT, by TEXT, who TEXT, mid INTEGER, tx TEXT, t INTEGER)");
    // srv2: accounts. au = one account (pid = its canonical player id: the device id it was created from); dl = device -> account;
    // snp = versioned profile snapshot per canonical id; dv = devices seen; ban / mute; gr = owner grants; aud = admin audit log
    q.exec("CREATE TABLE IF NOT EXISTS au (aid TEXT PRIMARY KEY, pid TEXT UNIQUE, email TEXT, gsub TEXT, asub TEXT, tsub TEXT, t INTEGER, last INTEGER)");
    for (const c of ["email", "gsub", "asub", "tsub"]) q.exec(`CREATE INDEX IF NOT EXISTS i_au_${c} ON au(${c})`);
    q.exec("CREATE TABLE IF NOT EXISTS dl (dp TEXT PRIMARY KEY, aid TEXT, t INTEGER)"); q.exec("CREATE INDEX IF NOT EXISTS i_dl_aid ON dl(aid)");
    q.exec("CREATE TABLE IF NOT EXISTS snp (pid TEXT PRIMARY KEY, sv INTEGER, coins INTEGER, xp INTEGER, lv INTEGER, js TEXT, t INTEGER, sus INTEGER DEFAULT 0)");
    q.exec("CREATE TABLE IF NOT EXISTS dv (dp TEXT PRIMARY KEY, cp TEXT, t0 INTEGER, t1 INTEGER, ua TEXT)"); q.exec("CREATE INDEX IF NOT EXISTS i_dv_cp ON dv(cp)");
    q.exec("CREATE TABLE IF NOT EXISTS ecode (email TEXT PRIMARY KEY, h TEXT, exp INTEGER, n INTEGER, dp TEXT, t INTEGER)");
    q.exec("CREATE TABLE IF NOT EXISTS nonce (n TEXT PRIMARY KEY, dp TEXT, t INTEGER)");
    q.exec("CREATE TABLE IF NOT EXISTS ban (pid TEXT PRIMARY KEY, until INTEGER, why TEXT, t INTEGER)");
    q.exec("CREATE TABLE IF NOT EXISTS mute (pid TEXT PRIMARY KEY, until INTEGER, why TEXT, t INTEGER)");
    q.exec("CREATE TABLE IF NOT EXISTS gr (gid INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT, coins INTEGER, items TEXT, why TEXT, t INTEGER, ack INTEGER DEFAULT 0)"); q.exec("CREATE INDEX IF NOT EXISTS i_gr_pid ON gr(pid, ack)");
    q.exec("CREATE TABLE IF NOT EXISTS aud (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, act TEXT, tgt TEXT, why TEXT, d TEXT)");
    for (const c of ["res INTEGER DEFAULT 0", "rwhy TEXT", "rt INTEGER"]) try { q.exec("ALTER TABLE rep ADD COLUMN " + c); } catch (_) {} // srv2: reports can be resolved
    for (const c of ["nr INTEGER DEFAULT 0", "nro TEXT"]) try { q.exec("ALTER TABLE acct ADD COLUMN " + c); } catch (_) {} // srv2: name reset by the owner (rooms use the server name)
    // coin1: the wallet. wal = balance + the day markers that keep daily rewards once per day; own = items held on the server;
    // clm = every claim id ever paid (idempotency); led = ledger of every coin movement (with the cuts of a claim that was trimmed)
    q.exec("CREATE TABLE IF NOT EXISTS wal (pid TEXT PRIMARY KEY, bal INTEGER NOT NULL DEFAULT 0, mig INTEGER DEFAULT 0, lvm INTEGER DEFAULT 0, ld TEXT DEFAULT '', ln INTEGER DEFAULT -1, sd TEXT DEFAULT '', bd TEXT DEFAULT '', mat INTEGER DEFAULT 0, od TEXT DEFAULT '', oe INTEGER DEFAULT 0, fd TEXT DEFAULT '', fe INTEGER DEFAULT 0, lvd TEXT DEFAULT '', lvn INTEGER DEFAULT 0, cuts INTEGER DEFAULT 0, t INTEGER)");
    q.exec("CREATE TABLE IF NOT EXISTS own (pid TEXT, it TEXT, src TEXT, t INTEGER, PRIMARY KEY (pid, it))");
    q.exec("CREATE TABLE IF NOT EXISTS clm (pid TEXT, ck TEXT, t INTEGER, PRIMARY KEY (pid, ck))");
    q.exec("CREATE TABLE IF NOT EXISTS led (id INTEGER PRIMARY KEY AUTOINCREMENT, pid TEXT, k TEXT, d INTEGER, bal INTEGER, ref TEXT, note TEXT, t INTEGER)"); q.exec("CREATE INDEX IF NOT EXISTS i_led_pid ON led(pid, id)");
    try { q.exec("ALTER TABLE gr ADD COLUMN w INTEGER DEFAULT 0"); } catch (_) {} // coin1: 1 = this grant's coins are in the wallet
    // grow1: challenge links. chl = one shared run (seed + mode + the sender's score); chr = each opener's result (n = 0 until the sender saw it)
    q.exec("CREATE TABLE IF NOT EXISTS chl (c TEXT PRIMARY KEY, pid TEXT, seed INTEGER, mode TEXT, wo INTEGER, df INTEGER, sc INTEGER, t INTEGER)"); q.exec("CREATE INDEX IF NOT EXISTS i_chl_pid ON chl(pid, t)");
    q.exec("CREATE TABLE IF NOT EXISTS chr (c TEXT, pid TEXT, sc INTEGER, seen INTEGER DEFAULT 0, t INTEGER, PRIMARY KEY (c, pid))");
    for (const c of ["sxp INTEGER", "xd TEXT DEFAULT ''", "xn INTEGER DEFAULT 0", "xcut INTEGER DEFAULT 0"]) try { q.exec("ALTER TABLE wal ADD COLUMN " + c); } catch (_) {} // fix1: server XP, its UTC day + amount credited that day
    // admin2: owner config (announcement, maintenance, modes / events off, price overrides), gift-to-all + claims, promo codes + redemptions, daily actives
    q.exec("CREATE TABLE IF NOT EXISTS cfg (k TEXT PRIMARY KEY, v TEXT)");
    q.exec("CREATE TABLE IF NOT EXISTS gift (id INTEGER PRIMARY KEY AUTOINCREMENT, coins INTEGER, items TEXT, why TEXT, exp INTEGER, t INTEGER, n INTEGER DEFAULT 0)");
    q.exec("CREATE TABLE IF NOT EXISTS gcl (gid INTEGER, pid TEXT, t INTEGER, PRIMARY KEY (gid, pid))");
    q.exec("CREATE TABLE IF NOT EXISTS promo (code TEXT PRIMARY KEY, coins INTEGER, items TEXT, max INTEGER, used INTEGER DEFAULT 0, exp INTEGER, off INTEGER DEFAULT 0, t INTEGER)");
    q.exec("CREATE TABLE IF NOT EXISTS prr (code TEXT, pid TEXT, t INTEGER, PRIMARY KEY (code, pid))");
    q.exec("CREATE TABLE IF NOT EXISTS dau (d TEXT, pid TEXT, PRIMARY KEY (d, pid))");
    this._cfg = null; this.cfgApply();
    q.exec("INSERT OR IGNORE INTO ids (num, pid, kind, t) VALUES ('1', '', 'o', 0)"); // id 1 is reserved for the founder: never assigned at random, only by the one-time claim
    return q;
  }
  srow(pid) { return this.sdb().exec("SELECT * FROM acct WHERE pid = ?", pid).toArray()[0] || null; }
  // ---------- admin2: owner config + gift-to-all ----------
  cfgAll() { if (!this._cfg) { this._cfg = {}; for (const r of this.sdb().exec("SELECT k, v FROM cfg").toArray()) { try { this._cfg[r.k] = JSON.parse(r.v); } catch (_) {} } } return this._cfg; }
  cfgGet(k) { return this.cfgAll()[k]; }
  cfgSet(k, v) { const q = this.sdb(); if (v == null) q.exec("DELETE FROM cfg WHERE k = ?", k); else q.exec("INSERT OR REPLACE INTO cfg (k, v) VALUES (?, ?)", k, JSON.stringify(v)); this._cfg = null; if (k === "px") this.cfgApply(); }
  cfgApply() { applyPx(this.cfgGet("px") || {}); } // price overrides edit the shared catalogue, so catItem / offers price from them
  cfgPub() { const c = this.cfgAll(), now = Date.now(), a = c.ann && c.ann.tx && c.ann.exp > now ? c.ann : null; return { ann: a, mnt: c.mnt && c.mnt.on ? { on: 1, msg: c.mnt.msg || "" } : null, moff: c.moff || [], eoff: c.eoff || [], px: c.px || {}, mut: MUTS.includes(c.mut) || c.mut === "off" ? c.mut : "auto" }; }
  sPushAll(o) { let ws = []; try { ws = this.state.getWebSockets(); } catch (_) {} const s = JSON.stringify({ t: "ev", ...o }); let n = 0; for (const w of ws) try { w.send(s); n++; } catch (_) {} return n; }
  giftClaim(cp) { const q = this.sdb(), now = Date.now(), a = this.srow(cp); if (!a) return 0; let n = 0;
    for (const g of q.exec("SELECT * FROM gift WHERE exp > ? AND t > ? ORDER BY id", now, a.t || 0).toArray()) { if (q.exec("SELECT gid FROM gcl WHERE gid = ? AND pid = ?", g.id, cp).toArray().length) continue;
      q.exec("INSERT INTO gcl (gid, pid, t) VALUES (?, ?, ?)", g.id, cp, now); q.exec("UPDATE gift SET n = n + 1 WHERE id = ?", g.id); this.grantTo(cp, g.coins | 0, JSON.parse(g.items || "[]"), "gift:" + g.id + (g.why ? " " + g.why : "")); n++; }
    return n; }
  sAcct(pid) { // every player gets a 7-digit public id the first time the server sees them (random, unique, never sequential)
    const q = this.sdb(); let r = this.srow(pid); if (r) return r; const now = Date.now();
    for (let k = 0; k < 40; k++) { const b = new Uint32Array(1); crypto.getRandomValues(b); const n = String(1000000 + (b[0] % 9000000));
      if (q.exec("SELECT num FROM ids WHERE num = ?", n).toArray().length) continue;
      q.exec("INSERT INTO ids (num, pid, kind, t) VALUES (?, ?, 'b', ?)", n, pid, now); q.exec("INSERT INTO acct (pid, id7, vis, name, av, fr, lv, own, seen, t) VALUES (?, ?, ?, 'Guest', 'p0', 0, 1, 0, ?, ?)", pid, n, n, now, now); return this.srow(pid); }
    throw new Error("id space");
  }
  sCard(pid, me) { const r = this.srow(pid); if (!r) return null; const c = { id: r.vis, n: r.name, av: r.av, fr: r.fr | 0, lv: r.lv | 0 }; if (r.own) c.own = 1; if (me) c.st = this.sPres(pid); return c; }
  sPid(id) { id = String(id || ""); if (!/^\d{1,7}$/.test(id)) return ""; const r = this.sdb().exec("SELECT pid FROM ids WHERE num = ?", id).toArray()[0]; return r && r.pid ? r.pid : ""; }
  sPres(pid, excl) { let ws = []; try { ws = this.state.getWebSockets(pid); } catch (_) {} let st = "off"; for (const w of ws) { if (w === excl) continue; let a = null; try { a = w.deserializeAttachment(); } catch (_) {} if (!a) continue; if (a.st === "match") return "match"; st = "lobby"; } return st; }
  sPush(pid, o) { let ws = []; try { ws = this.state.getWebSockets(pid); } catch (_) {} const s = JSON.stringify({ t: "ev", ...o }); let n = 0; for (const w of ws) try { w.send(s); n++; } catch (_) {} return n; }
  sFriends(pid) { return this.sdb().exec("SELECT b FROM fr WHERE a = ?", pid).toArray().map((r) => r.b); }
  sPresAll(pid, excl) { const r = this.srow(pid); if (!r) return; const st = this.sPres(pid, excl); for (const f of this.sFriends(pid)) this.sPush(f, { k: "pres", id: r.vis, st }); }
  sVis(pid) { const q = this.sdb(), r = this.srow(pid); if (!r) return; const p = q.exec("SELECT num FROM ids WHERE pid = ? AND kind = 'p' ORDER BY t DESC LIMIT 1", pid).toArray()[0];
    const v = r.own ? "1" : p ? p.num : r.id7; if (v !== r.vis) q.exec("UPDATE acct SET vis = ? WHERE pid = ?", v, pid); return v; }
  sMe(pid) { const r = this.srow(pid), q = this.sdb(); return { id: r.vis, id7: r.id7, prem: q.exec("SELECT num FROM ids WHERE pid = ? AND kind = 'p' ORDER BY t", pid).toArray().map((x) => x.num), own: r.own ? 1 : 0 }; }
  chMsg(r, opid, sc) { const o = this.sCard(opid) || { n: "?" }; return { c: r.c, n: o.n, id: o.id, s: sc, my: r.sc, mode: r.mode, w: sc > r.sc ? 1 : 0 }; } // grow1: one result for the sender
  chPend(pid) { const q = this.sdb(), L = q.exec("SELECT chr.c AS c, chr.pid AS o, chr.sc AS sc FROM chr JOIN chl ON chl.c = chr.c WHERE chl.pid = ? AND chr.seen = 0 ORDER BY chr.t LIMIT 10", pid).toArray();
    const out = L.map((x) => this.chMsg(q.exec("SELECT * FROM chl WHERE c = ?", x.c).one(), x.o, x.sc)); for (const x of L) q.exec("UPDATE chr SET seen = 1 WHERE c = ? AND pid = ?", x.c, x.o); return out; }
  sLimit(pid, k, n, win = 60000) { const now = Date.now(), key = pid + "|" + k; let e = this.rl.get(key); if (!e || now - e.t > win) { e = { t: now, n: 0 }; this.rl.set(key, e); } if (this.rl.size > 20000) this.rl.clear(); return ++e.n > n; }
  sBlocked(a, b) { return this.sdb().exec("SELECT a FROM bl WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", a, b, b, a).toArray().length > 0; }
  static cv(a, b) { return a < b ? a + ":" + b : b + ":" + a; }
  sop(pid, m) {
    const q = this.sdb(), now = Date.now(), op = String(m.op || ""); if (this.sLimit(pid, "*", 240)) return { err: "rate" };
    const me = this.sAcct(pid); const other = () => { const o = this.sPid(m.id); return o && o !== pid ? o : ""; };
    if (op === "hello") { // profile summary for friend lists + cards (name filtered like chat)
      const nm = filterText(cleanName(m.n)).t.slice(0, 16) || "Guest", av = typeof m.av === "string" && /^(p([0-9]|1[0-9]|2[0-3])|f\d{1,3})$/.test(m.av) ? m.av : "p0";
      const keep = me.nr && (nm === me.nro || nm === me.name); // srv2: after an owner name reset the old name is refused; the server name stands until the player picks a new one
      q.exec("UPDATE acct SET name = ?, av = ?, fr = ?, lv = ?, seen = ?, nr = ? WHERE pid = ?", keep ? me.name : nm, av, Math.max(0, Math.min(17, m.fr | 0)), Math.max(1, Math.min((() => { const W = q.exec("SELECT * FROM wal WHERE pid = ?", pid).toArray()[0]; return W && W.mig && !me.own ? lvOf(this.wSx(pid, W)) : 100; })(), m.lv | 0)), now, keep ? 1 : 0, pid); this.sVis(pid);
      if (keep) return { ok: 1, me: this.sMe(pid), rn: me.name };
      return { ok: 1, me: this.sMe(pid) }; }
    if (op === "me") return { me: this.sMe(pid) };
    if (op === "list") {
      const fr = this.sFriends(pid).map((b) => { const c = this.sCard(b, 1); if (!c) return null; const cv = Room.cv(pid, b), rd = q.exec("SELECT last FROM rd WHERE pid = ? AND cv = ?", pid, cv).toArray()[0];
        c.un = q.exec("SELECT COUNT(*) AS n FROM msg WHERE cv = ? AND f != ? AND id > ?", cv, pid, rd ? rd.last : 0).one().n; return c; }).filter(Boolean);
      const cards = (rows, k) => rows.map((r) => this.sCard(r[k])).filter(Boolean);
      return { me: this.sMe(pid), fr, inq: cards(q.exec("SELECT a FROM rq WHERE b = ? ORDER BY t DESC LIMIT 50", pid).toArray(), "a"), outq: cards(q.exec("SELECT b FROM rq WHERE a = ? ORDER BY t DESC LIMIT 50", pid).toArray(), "b"),
        bl: cards(q.exec("SELECT b FROM bl WHERE a = ? LIMIT 100", pid).toArray(), "b"), inv: q.exec("SELECT a, room, t FROM inv WHERE b = ? AND t > ?", pid, now - 120000).toArray().map((r) => ({ from: this.sCard(r.a), room: r.room, t: r.t })).filter((x) => x.from) };
    }
    if (op === "find") { if (this.sLimit(pid, "find", 30)) return { err: "rate" }; const o = this.sPid(m.id); if (!o) return { err: "notfound" }; if (o === pid) return { err: "self" };
      const c = this.sCard(o); c.rel = q.exec("SELECT a FROM fr WHERE a = ? AND b = ?", pid, o).toArray().length ? "fr" : q.exec("SELECT a FROM rq WHERE a = ? AND b = ?", pid, o).toArray().length ? "out" : q.exec("SELECT a FROM rq WHERE a = ? AND b = ?", o, pid).toArray().length ? "in" : q.exec("SELECT a FROM bl WHERE a = ? AND b = ?", pid, o).toArray().length ? "bl" : ""; return { card: c }; }
    if (op === "req") { if (this.sLimit(pid, "req", 10)) return { err: "rate" }; const o = this.sPid(m.id); if (!o) return { err: "notfound" }; if (o === pid) return { err: "self" };
      if (q.exec("SELECT a FROM fr WHERE a = ? AND b = ?", pid, o).toArray().length) return { err: "already" };
      if (q.exec("SELECT a FROM bl WHERE a = ? AND b = ?", pid, o).toArray().length) return { err: "blocked" };
      if (q.exec("SELECT a FROM bl WHERE a = ? AND b = ?", o, pid).toArray().length) return { ok: 1, sent: 1 }; // they blocked me: looks sent, never delivered
      if (q.exec("SELECT a FROM rq WHERE a = ? AND b = ?", o, pid).toArray().length) return this.sop(pid, { op: "acc", id: m.id }); // they asked first: accept
      if (q.exec("SELECT COUNT(*) AS n FROM fr WHERE a = ?", pid).one().n >= 200) return { err: "full" };
      if (q.exec("SELECT COUNT(*) AS n FROM rq WHERE a = ?", pid).one().n >= 30) return { err: "pending" };
      q.exec("INSERT OR REPLACE INTO rq (a, b, t) VALUES (?, ?, ?)", pid, o, now); this.sPush(o, { k: "req", from: this.sCard(pid) }); return { ok: 1, sent: 1 }; }
    if (op === "acc") { const o = other(); if (!o || !q.exec("SELECT a FROM rq WHERE a = ? AND b = ?", o, pid).toArray().length) return { err: "none" };
      q.exec("DELETE FROM rq WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", o, pid, pid, o); q.exec("INSERT OR IGNORE INTO fr (a, b, t) VALUES (?, ?, ?)", pid, o, now); q.exec("INSERT OR IGNORE INTO fr (a, b, t) VALUES (?, ?, ?)", o, pid, now);
      this.sPush(o, { k: "acc", from: this.sCard(pid, 1) }); return { ok: 1, card: this.sCard(o, 1) }; }
    if (op === "dec") { const o = other(); if (!o) return { err: "none" }; q.exec("DELETE FROM rq WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", o, pid, pid, o); return { ok: 1 }; } // also cancels my own request
    if (op === "rem") { const o = other(); if (!o) return { err: "none" }; q.exec("DELETE FROM fr WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", o, pid, pid, o); q.exec("DELETE FROM inv WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", o, pid, pid, o); this.sPush(o, { k: "rem", id: me.vis }); return { ok: 1 }; }
    if (op === "blk") { const o = other(); if (!o) return { err: "none" }; for (const T of ["fr", "rq", "inv"]) q.exec(`DELETE FROM ${T} WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)`, o, pid, pid, o);
      q.exec("INSERT OR REPLACE INTO bl (a, b, t) VALUES (?, ?, ?)", pid, o, now); this.sPush(o, { k: "rem", id: me.vis }); return { ok: 1 }; }
    if (op === "unb") { const o = other(); if (!o) return { err: "none" }; q.exec("DELETE FROM bl WHERE a = ? AND b = ?", pid, o); return { ok: 1 }; }
    const isFr = (o) => q.exec("SELECT a FROM fr WHERE a = ? AND b = ?", pid, o).toArray().length > 0;
    if (op === "msgs") { const o = other(); if (!o || !isFr(o)) return { err: "notfriend" }; const cv = Room.cv(pid, o);
      const list = q.exec("SELECT id, f, tx, t FROM msg WHERE cv = ? ORDER BY id DESC LIMIT ?", cv, CHAT_KEEP).toArray().reverse().map((r) => ({ i: r.id, me: r.f === pid ? 1 : 0, tx: r.tx, t: r.t }));
      if (list.length) q.exec("INSERT OR REPLACE INTO rd (pid, cv, last) VALUES (?, ?, ?)", pid, cv, list[list.length - 1].i); return { id: m.id, list, card: this.sCard(o, 1) }; }
    if (op === "read") { const o = other(); if (!o) return { err: "none" }; const cv = Room.cv(pid, o), r = q.exec("SELECT MAX(id) AS n FROM msg WHERE cv = ?", cv).one(); if (r && r.n) q.exec("INSERT OR REPLACE INTO rd (pid, cv, last) VALUES (?, ?, ?)", pid, cv, r.n); return { ok: 1 }; }
    if (op === "send") { const o = other(); if (!o || !isFr(o)) return { err: "notfriend" }; if (this.sBlocked(pid, o)) return { err: "blocked" }; const mu = this.muteOf(pid); if (mu) return { err: "muted", until: mu };
      const raw = String(m.tx || ""); if (!raw.trim()) return { err: "empty" }; if ([...raw].length > MSG_MAX) return { err: "long" }; if (this.sLimit(pid, "send", 20) || this.sLimit(pid, "send1", 3, 2000)) return { err: "rate" }; const f = filterText(raw); if (!f.t) return { err: "empty" };
      const cv = Room.cv(pid, o); q.exec("INSERT INTO msg (cv, f, tx, t) VALUES (?, ?, ?, ?)", cv, pid, f.t, now); const id = q.exec("SELECT MAX(id) AS n FROM msg WHERE cv = ?", cv).one().n;
      const cut = q.exec("SELECT id FROM msg WHERE cv = ? ORDER BY id DESC LIMIT 1 OFFSET ?", cv, CHAT_KEEP - 1).toArray()[0]; if (cut) q.exec("DELETE FROM msg WHERE cv = ? AND id < ?", cv, cut.id); // keep the last 100
      q.exec("INSERT OR REPLACE INTO rd (pid, cv, last) VALUES (?, ?, ?)", pid, cv, id);
      this.sPush(o, { k: "msg", from: this.sCard(pid), m: { i: id, me: 0, tx: f.t, t: now } }); return { ok: 1, m: { i: id, me: 1, tx: f.t, t: now }, filt: f.hit ? 1 : 0 }; }
    if (op === "ch_new") { if (this.sLimit(pid, "chn", 12, 600000)) return { err: "rate" }; const mode = String(m.mode || ""); if (!CH_MODES.has(mode)) return { err: "bad" };
      const seed = Math.floor(+m.seed), sc = Math.floor(+m.sc); if (!(seed >= 0 && seed < 2 ** 31) || !(sc >= 0 && sc <= 1e7)) return { err: "bad" };
      let c = ""; for (let k = 0; k < 6 && !c; k++) { const b = crypto.getRandomValues(new Uint8Array(7)); const x = [...b].map((v) => CH_AB[v % CH_AB.length]).join(""); if (!q.exec("SELECT c FROM chl WHERE c = ?", x).toArray().length) c = x; } if (!c) return { err: "server" };
      q.exec("INSERT INTO chl (c, pid, seed, mode, wo, df, sc, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", c, pid, seed, mode, Math.max(0, Math.min(9, m.wo | 0)), Math.max(0, Math.min(3, m.df | 0)), sc, now); return { ok: 1, c }; }
    if (op === "ch_get" || op === "ch_res") { const r = q.exec("SELECT * FROM chl WHERE c = ?", String(m.c || "").slice(0, 12)).toArray()[0]; if (!r || now - r.t > CH_TTL) return { err: "notfound" }; const by = this.sCard(r.pid) || { n: "?" };
      if (op === "ch_get") return { ok: 1, ch: { c: r.c, seed: r.seed, mode: r.mode, wo: r.wo, df: r.df, sc: r.sc, n: by.n, id: by.id, mine: r.pid === pid ? 1 : 0 } };
      if (r.pid === pid) return { ok: 1, self: 1 }; if (this.sLimit(pid, "chr", 20)) return { err: "rate" }; const sc = Math.max(0, Math.min(1e7, Math.floor(+m.sc || 0)));
      const old = q.exec("SELECT sc FROM chr WHERE c = ? AND pid = ?", r.c, pid).toArray()[0]; if (old && old.sc >= sc) return { ok: 1, best: old.sc }; // only a better run is sent again
      const live = this.sPush(r.pid, { k: "chr", ...this.chMsg(r, pid, sc) }); q.exec("INSERT OR REPLACE INTO chr (c, pid, sc, seen, t) VALUES (?, ?, ?, ?, ?)", r.c, pid, sc, live ? 1 : 0, now); return { ok: 1, win: sc > r.sc ? 1 : 0 }; }
    if (op === "fb") { if (this.sLimit(pid, "fb", 3, 600000)) return { err: "rate" }; const tx = String(m.tx || "").trim().slice(0, 500); if (tx.length < 3) return { err: "empty" }; // coin1: feedback to the owner (kept with the reports)
      q.exec("INSERT INTO rep (by, who, mid, tx, t) VALUES (?, 'fb', 0, ?, ?)", pid, tx, now); return { ok: 1 }; }
    if (op === "rep") { if (this.sLimit(pid, "rep", 10)) return { err: "rate" }; const o = other(); if (!o) return { err: "none" }; const r = q.exec("SELECT tx FROM msg WHERE id = ? AND cv = ? AND f = ?", m.mid | 0, Room.cv(pid, o), o).toArray()[0];
      q.exec("INSERT INTO rep (by, who, mid, tx, t) VALUES (?, ?, ?, ?, ?)", pid, o, m.mid | 0, r ? r.tx : "", now); return { ok: 1 }; }
    if (op === "inv") { if (this.sLimit(pid, "inv", 6)) return { err: "rate" }; const o = other(); if (!o || !isFr(o)) return { err: "notfriend" };
      let room = String(m.room || "").toLowerCase(); if (!/^[a-z0-9-]{1,24}$/.test(room)) { const b = new Uint8Array(4); crypto.getRandomValues(b); room = "f-" + [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 7); }
      q.exec("INSERT OR REPLACE INTO inv (a, b, room, t) VALUES (?, ?, ?, ?)", pid, o, room, now); const live = this.sPush(o, { k: "inv", from: this.sCard(pid), room, at: now }); return { ok: 1, room, live: live ? 1 : 0, st: this.sPres(o) }; }
    if (op === "invr") { const o = other(); if (!o) return { err: "none" }; const r = q.exec("SELECT room FROM inv WHERE a = ? AND b = ? AND t > ?", o, pid, now - 120000).toArray()[0]; q.exec("DELETE FROM inv WHERE a = ? AND b = ?", o, pid);
      if (!r) return { err: "expired" }; this.sPush(o, { k: "invr", from: this.sCard(pid), ok: m.ok ? 1 : 0, room: r.room }); return { ok: 1, room: r.room }; }
    // ---- special ids (shop). coin1: sold only through w_sid (ownership + coins in one transaction, see wop) ----
    if (op === "shop") { const sold = new Set(q.exec("SELECT num FROM ids WHERE length(num) = 5").toArray().map((r) => r.num)); const pick = [];
      const seed = Math.floor(now / 3600000); let h = seed * 2654435761 >>> 0; for (let k = 0; k < 200 && pick.length < 8; k++) { h = (Math.imul(h ^ (h >>> 13), 1274126177) + 0x9e3779b9) >>> 0; const n = String(10000 + (h % 90000)); if (idKind(n) === "std" && !sold.has(n) && !pick.includes(n)) pick.push(n); }
      return { prices: ID_PRICES, rep: SPECIAL_REP.map((n) => ({ n, s: sold.has(n) ? 1 : 0 })), seq: SPECIAL_SEQ.map((n) => ({ n, s: sold.has(n) ? 1 : 0 })), std: pick, me: this.sMe(pid) }; }
    if (op === "chk") { const n = String(m.n || ""), k = idKind(n); if (!k) return { err: "bad" }; return { n, kind: k, price: idPrice(n), sold: q.exec("SELECT num FROM ids WHERE num = ?", n).toArray().length ? 1 : 0 }; }
    if (op === "promo") { if (this.sLimit(pid, "promo", 8)) return { err: "rate" }; const code = String(m.code || "").trim().toUpperCase(); if (!/^[A-Z0-9]{4,16}$/.test(code)) return { err: "bad" }; // admin2: redeem a promo code (one per player)
      const r = q.exec("SELECT * FROM promo WHERE code = ?", code).toArray()[0]; if (!r || r.off) return { err: "bad" }; if (r.exp <= now) return { err: "exp" }; if (q.exec("SELECT code FROM prr WHERE code = ? AND pid = ?", code, pid).toArray().length) return { err: "used" }; if ((r.used | 0) >= r.max) return { err: "max" };
      q.exec("INSERT INTO prr (code, pid, t) VALUES (?, ?, ?)", code, pid, now); q.exec("UPDATE promo SET used = used + 1 WHERE code = ?", code); const it = JSON.parse(r.items || "[]"); const g = this.grantTo(pid, r.coins | 0, it, "promo:" + code); return { ok: 1, c: r.coins | 0, it, gid: g.gid }; }
    if (op === "buyid") return { err: "update" }; // coin1: special ids are bought in one server transaction (w_sid); older builds must reload
    if (op === "undoid") { const n = String(m.n || ""), r = q.exec("SELECT * FROM ids WHERE num = ? AND pid = ? AND kind = 'p'", n, pid).toArray()[0]; // the coin payment failed on the device: give the id back
      if (!r || !m.tok || r.tok !== String(m.tok) || now - r.t > 600000) return { err: "none" }; q.exec("DELETE FROM ids WHERE num = ?", n); this.sVis(pid); return { ok: 1, me: this.sMe(pid) }; }
    if (op === "paid") { q.exec("UPDATE ids SET tok = NULL WHERE num = ? AND pid = ? AND kind = 'p'", String(m.n || ""), pid); return { ok: 1 }; } // payment done: the sale can no longer be undone
    return { err: "op" };
  }
  // ---------- coin1: server wallet (balance, owned items, purchases, claims). Everything below runs synchronously inside the one
  // social object: a check and the write that depends on it never have an await between them, so two requests can not both
  // spend the same coins, and a claim id can be paid only once.
  wRow(cp) { const q = this.sdb(); let r = q.exec("SELECT * FROM wal WHERE pid = ?", cp).toArray()[0]; if (r) return r; q.exec("INSERT OR IGNORE INTO wal (pid, bal, mig, t) VALUES (?, 0, 0, ?)", cp, Date.now()); return q.exec("SELECT * FROM wal WHERE pid = ?", cp).toArray()[0]; }
  wOwn(cp) { return this.sdb().exec("SELECT it FROM own WHERE pid = ? ORDER BY t, it", cp).toArray().map((r) => r.it); }
  wState(cp, full = true) { const q = this.sdb(), r = q.exec("SELECT * FROM wal WHERE pid = ?", cp).toArray()[0]; if (!r) return { bal: 0, mig: 0, own: [] };
    const o = { bal: r.bal, mig: r.mig ? 1 : 0, ld: r.ld || "", ln: r.ln, sd: r.sd || "", bd: r.bd || "", lvm: r.lvm | 0 }; if (r.mig) o.sx = this.wSx(cp, r); if (full) o.own = this.wOwn(cp); return o; }
  // fix1: server XP. A wallet from before fix1 starts from the start of the level it already had (lvm), plus the in-level
  // progress of its last snapshot when that fits inside that level.
  wSx(cp, W) { if (W.sxp != null) return W.sxp | 0; const L = Math.max(1, W.lvm | 0), lo = cumXp(L), hi = cumXp(L + 1) - 1, sn = this.sdb().exec("SELECT xp FROM snp WHERE pid = ?", cp).toArray()[0];
    const x = sn ? Math.max(lo, Math.min(hi, sn.xp | 0)) : lo; this.sdb().exec("UPDATE wal SET sxp = ? WHERE pid = ? AND sxp IS NULL", x, cp); return x; }
  wXp(cp, n, why) { n = Math.max(0, Math.round(+n || 0)); const q = this.sdb(), W = q.exec("SELECT * FROM wal WHERE pid = ?", cp).toArray()[0]; if (!W || !n) return 0;
    const sx = this.wSx(cp, W), td = utcDay(Date.now()), used = W.xd === td ? W.xn | 0 : 0, g = Math.max(0, Math.min(n, XP.DAY - used));
    q.exec("UPDATE wal SET sxp = ?, xd = ?, xn = ?, xcut = xcut + ? WHERE pid = ?", sx + g, td, used + g, g < n ? 1 : 0, cp); if (g < n) console.log(JSON.stringify({ fix1: "xp_day", why, want: n, got: g })); return g; }
  wHas(cp, it) { return this.sdb().exec("SELECT it FROM own WHERE pid = ? AND it = ?", cp, it).toArray().length > 0; }
  wGive(cp, it, src) { this.sdb().exec("INSERT OR IGNORE INTO own (pid, it, src, t) VALUES (?, ?, ?, ?)", cp, it, src, Date.now()); }
  wLed(cp, k, d, ref, note) { const q = this.sdb(), b = q.exec("SELECT bal FROM wal WHERE pid = ?", cp).one(); q.exec("INSERT INTO led (pid, k, d, bal, ref, note, t) VALUES (?, ?, ?, ?, ?, ?, ?)", cp, k, d, b ? b.bal : 0, String(ref || "").slice(0, 90), note ? JSON.stringify(note).slice(0, 300) : null, Date.now()); }
  wAdd(cp, d, k, ref, note) { if (d) this.sdb().exec("UPDATE wal SET bal = bal + ? WHERE pid = ?", d, cp); this.wLed(cp, k, d, ref, note); }
  // the only way coins leave a wallet: one conditional update (balance >= price) in the same synchronous step as the check
  wPay(cp, price, k, ref) { const q = this.sdb(), r = q.exec("SELECT bal FROM wal WHERE pid = ?", cp).one(); if (!r || r.bal < price) return false; q.exec("UPDATE wal SET bal = bal - ? WHERE pid = ? AND bal >= ?", price, cp, price); this.wLed(cp, k, -price, ref); return true; }
  wClaimed(cp, ck) { return this.sdb().exec("SELECT ck FROM clm WHERE pid = ? AND ck = ?", cp, ck).toArray().length > 0; }
  wMark(cp, ck) { this.sdb().exec("INSERT OR IGNORE INTO clm (pid, ck, t) VALUES (?, ?, ?)", cp, ck, Date.now()); }
  wPre(cp) { const q = this.sdb(), C = MIG.CUT, a = q.exec("SELECT t FROM acct WHERE pid = ?", cp).toArray()[0];
    if (a && (a.t == null || a.t < C)) return true; return q.exec("SELECT dp FROM dv WHERE cp = ? AND t0 < ? LIMIT 1", cp, C).toArray().length > 0 || q.exec("SELECT pid FROM snp WHERE pid = ? AND t < ?", cp, C).toArray().length > 0; }
  // first connect of an updated game: the device's balance + items come in once (capped, logged); afterwards the device only shows
  wMig(cp, m) {
    const q = this.sdb(), now = Date.now(), W = this.wRow(cp); if (W.mig) return { err: "done", w: this.wState(cp) };
    const dev = Math.max(0, Math.min(1e9, Math.floor(+m.coins || 0))), me = this.srow(cp), sn = q.exec("SELECT coins, xp, t FROM snp WHERE pid = ?", cp).toArray()[0];
    const pre = (me && me.own) || this.wPre(cp);
    const rule = me && me.own ? "owner" : !pre ? "new" : sn ? "snapshot" : "first", cap = rule === "owner" ? MIG.OWNER : rule === "new" ? 0 : rule === "snapshot" ? sn.coins + allowance((now - sn.t) / 60000).coins : MIG.FIRST;
    const imp = Math.min(dev, cap), pend = q.exec("SELECT COALESCE(SUM(coins), 0) AS n FROM gr WHERE pid = ? AND (w = 0 OR w IS NULL) AND ack = 0", cp).one().n | 0; // owner grants this device never applied
    let items = 0; for (const it of (pre && Array.isArray(m.own) ? m.own : []).slice(0, MIG.ITEMS)) { const k = String(it); if (!validKey(k)) continue;
      if (k.startsWith("sid:") && !q.exec("SELECT num FROM ids WHERE num = ? AND pid = ? AND kind = 'p'", k.slice(4), cp).toArray().length) continue; this.wGive(cp, k, "mig"); items++; }
    for (const r of q.exec("SELECT num FROM ids WHERE pid = ? AND kind = 'p'", cp).toArray()) this.wGive(cp, "sid:" + r.num, "id");
    let cks = 0; for (const c of (Array.isArray(m.ck) ? m.ck : []).slice(0, MIG.CKS)) { const k = String(c); if (CK_RE.test(k)) { this.wMark(cp, k); cks++; } } // rewards this device already paid itself
    const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "");
    q.exec("UPDATE wal SET bal = bal + ?, mig = 1, lvm = ?, ld = ?, ln = ?, sd = ?, bd = ?, mat = ?, cuts = cuts + ?, t = ? WHERE pid = ?", imp + pend, Math.max(1, Math.min(rule === "owner" ? 100 : rule === "new" ? 1 : sn ? Math.max(lvOf(sn.xp), 1) : XP.MIG_LV, m.lv | 0)), day(m.ld), Math.max(-1, Math.min(6, m.ln | 0)), day(m.sd), day(m.bd), now - 3600000, dev > imp ? 1 : 0, now, cp); // mat: a match that began up to 1 h before the import (still running) can be claimed
    q.exec("UPDATE gr SET w = 1 WHERE pid = ?", cp);
    const note = { dev, cap, rule, cut: dev - imp, pend, items, cks }; this.wLed(cp, "mig", imp + pend, rule, note);
    return { ok: 1, mig: note, w: this.wState(cp) };
  }
  // what an item costs right now: the catalogue price, or this moment's offer price (weekly / monthly / occasion)
  wPrice(cp, m) {
    const price = Math.floor(+m.price || 0); let list, base, offer = null;
    if (m.k === "bundle") { const its = Array.isArray(m.items) ? m.items.slice(0, 6) : []; list = its.map((x) => (x && (x.k === "skin" || x.k === "flag") ? catItem(x.k, x.i) : null)); if (!list.length || list.some((x) => !x)) return { err: "na" }; base = list.reduce((a, x) => a + x.base, 0); offer = String(m.key || ""); }
    else { const one = catItem(String(m.k || ""), m.ix); if (!one) return { err: "na" }; list = [one]; base = one.base; } // ix, not i: "i" is the socket request id
    if (!(price > 0) || price > base) return { err: "badPrice", price: base };
    if (list.some((x) => this.wHas(cp, x.key))) return { err: "own" };
    if (price < base || offer) { const C = offerCandidates(new Set(this.wOwn(cp)));
      const hit = offer ? C.bundles.some((b) => b.key === offer && b.price === price && b.items.length === list.length && b.items.every((x, i) => catItem(x.k, x.i).key === list[i].key))
        : m.k !== "gt" && C.single.some((x) => x.k === m.k && x.i === (m.ix | 0) && x.price === price);
      if (!hit) return { err: "badPrice", price: base }; }
    return { price, keys: list.map((x) => x.key), base };
  }
  // one reward claim (the device names it, the server prices it). Returns { ck, c } paid, { ck, dup } already paid,
  // { ck, err, keep } refused (keep = try again later: the queue keeps it)
  wClaim(cp, cl, ctx) {
    const now = Date.now(), k = String(cl && cl.k || ""), ck = String(cl && cl.ck || ""), a = (cl && typeof cl.a === "object" && cl.a) || {}; if (!CK_RE.test(ck)) return { ck, err: "bad" };
    if (this.wClaimed(cp, ck)) return { ck, dup: 1 }; const q = this.sdb(), W = this.wRow(cp); let c = 0, give = [], note = null, extra = {}, set = null;
    const want = (s) => ck === s; const bad = { ck, err: "bad" };
    if (k === "lv") { const n = a.n | 0; if (!want("lv:" + n) || n < 2 || n > 100) return bad; if (n <= (W.lvm | 0)) { this.wMark(cp, ck); return { ck, err: "old" }; }
      if (n > lvOf(this.wSx(cp, this.wRow(cp)))) return { ck, err: "xp", keep: 1 }; // fix1: the server's XP must have reached that level
      const td = utcDay(now), used = W.lvd === td ? W.lvn | 0 : 0; if (used >= LV_DAY) return { ck, err: "rate", keep: 1 }; c = levelCoins(n); set = ["lvd = ?, lvn = ?", td, used + 1]; }
    else if (k === "ach") { const id = String(a.id || ""); if (!want("ach:" + id) || !ACH_COINS[id]) return bad; c = ACH_COINS[id]; }
    else if (k === "ms") { const d = String(a.d || ""), i = a.i | 0; if (!want("ms:" + d + ":" + i) || i < 0 || i > 2 || !dayOk(d, now)) return bad; c = dailyMissions(d)[i].r; }
    else if (k === "wk") { const w = String(a.w || ""), i = a.i | 0; if (!want("wk:" + w + ":" + i) || i < 0 || i > 2 || !weekOk(w, now)) return bad; c = weeklyCoins(i); }
    else if (k === "wc") { const w = String(a.w || ""), t = a.t | 0; if (!want("wc:" + w + ":" + t) || t < 0 || t > 2 || !weekOk(w, now)) return bad; c = WC_REWARD[t]; }
    else if (k === "dm") { const d = String(a.d || ""); if (!want("dm:" + d) || !dayOk(d, now)) return bad; c = DAILY_MODE_BONUS; }
    else if (k === "tier") { const t = a.k | 0; if (!want("tier:" + SEASON.id + ":" + t) || t < 1 || t > SEASON.tiers) return bad; const r = seasonReward(t); c = r.coins | 0; if (r.skin) give.push(r.skin); }
    else if (k === "unl") { const id = String(a.id || ""); if (!want("unl:" + id) || !UNLOCKS.has(id)) return bad; give.push(id); }
    else if (k === "bonus") { const d = String(a.d || ""); if (!want("bonus:" + d) || !dayOk(d, now)) return bad; if (W.bd && d <= W.bd) { this.wMark(cp, ck); return { ck, err: "day" }; } c = bonusCoins(a.lv); set = ["bd = ?", d]; }
    else if (k === "login") { const d = String(a.d || ""); if (!want("login:" + d) || !dayOk(d, now)) return bad; if (W.ld && d <= W.ld) { this.wMark(cp, ck); return { ck, err: "day" }; }
      const n = W.ld && W.ld === prevDay(d) ? ((W.ln | 0) + 1) % 7 : 0; c = LOGIN[n]; extra.n = n;
      if (n === 6) { const cos = String(a.cos || ""); if (RANDOM_COS.test(cos) && !this.wHas(cp, cos)) { give.push(cos); extra.cos = cos; } else c += LOGIN_NOCOS; } set = ["ld = ?, ln = ?", d, n]; }
    else if (k === "rw") { const key = String(a.key || ""); if (!want("rw:" + key)) return bad; let rw = null, mm;
      if ((mm = /^ss:(\d{4}-\d{2})$/.exec(key))) { if (mm[1] >= seasonId(now)) return bad; rw = leagueSeasonReward(Math.max(0, Math.min(5, a.li | 0))); }
      else if ((mm = /^ms:([a-z_]{4,8}):(\d{4}-(?:W\d{2}|\d{2})):([0-2])$/.exec(key))) { const C = CONTESTS.find((x) => x.id === mm[1]); if (!C) return bad;
        const per = C.per, okP = [periodId(per, now), prevPeriodId(per, now)]; if (!okP.includes(mm[2])) return bad; rw = mileReward(C, +mm[3]); }
      else if ((mm = /^sv:([wms]:\d{4}-(?:W\d{2}|\d{2})):(tr|kl|sc|cq)$/.exec(key))) { const rk = ctx && ctx.fin ? ctx.fin[key] : 0; if (!rk) return { ck, err: "none", keep: ctx && ctx.finErr ? 1 : 0 };
        rw = mm[1][0] === "s" && mm[2] === "cq" ? CONQ_REWARD : rankReward(mm[1][0], rk); if (!rw) { this.wMark(cp, ck); return { ck, err: "none" }; } extra.rk = rk; }
      else return bad; c = rw.coins | 0; give.push(...(rw.cos || [])); }
    else if (k === "match") { // offline / bot match: possible for the time played, no overlap with the previous one, capped per match and per day
      // a.at = when it ended on the device clock; ctx.skew moves it onto the server clock (the device sends its "now" with the batch)
      const at = Math.floor(+a.at || 0) + ((ctx && ctx.skew) | 0); if (!/^m:[0-9a-f]{8,24}$/.test(ck) || !(at > now - 3 * DAY && at < now + 60000)) return bad;
      { const mo = this.cfgGet("moff") || [], am = String(a.mode || ""); if (am && mo.includes(am) && !(this.srow(cp) || {}).own) return { ck, err: "off" }; } // play2: switched-off mode earns nothing (owner exempt)
      const P = plausible(a), td = utcDay(at), used = W.fd === td ? W.fe | 0 : 0, start = at - Math.min(OFF.MAX_S, Math.max(0, +a.dur || 0)) * 1000; let cut = P.cut.slice(); c = P.c;
      if (start < (Number(W.mat) || 0) - 30000) { c = 0; cut.push("overlap"); } if (c > OFF.PER_DAY - used) { c = Math.max(0, OFF.PER_DAY - used); cut.push("day"); }
      set = ["mat = MAX(mat, ?), fd = ?, fe = ?", at, td, used + c]; if (cut.length) note = { cut, full: P.full, got: c }; }
    else return { ck, err: "kind" };
    if (set) q.exec("UPDATE wal SET " + set[0] + " WHERE pid = ?", ...set.slice(1), cp);
    if (note) q.exec("UPDATE wal SET cuts = cuts + 1 WHERE pid = ?", cp);
    for (const it of give) this.wGive(cp, it, k); this.wMark(cp, ck); this.wAdd(cp, c, note ? "cut" : k, ck, note);
    if (k === "ms" || k === "wk") extra.x = this.wXp(cp, c, k); // the device adds the mission reward as XP too
    else if (k === "match") { const P = plausible(a); let x = (+a.dur || 0) < OFF.MIN_S || (note && note.cut.includes("overlap")) ? 0 : Math.min(XP.MATCH, matchXp({ ...a, ...P.o })); extra.x = this.wXp(cp, x, "match"); }
    return { ck, c, ...(give.length ? { it: give } : {}), ...(note ? { cut: note.cut } : {}), ...extra };
  }
  async wop(dp, cp, m) {
    const q = this.sdb(), now = Date.now(), op = String(m.op); if (this.sLimit(cp, "w", 90)) return { err: "rate" }; this.sAcct(cp);
    if (op === "w_get") { this.wRow(cp); return { w: this.wState(cp) }; }
    if (op === "w_mig") return this.wMig(cp, m);
    const W = this.wRow(cp); if (!W.mig) return { err: "mig", w: this.wState(cp) };
    if (op === "w_buy") { // a shop item or offer: price + ownership + balance checked and paid in one step
      const rid = /^[0-9a-f]{8,24}$/.test(String(m.rid || "")) ? "buy:" + m.rid : ""; if (rid && this.wClaimed(cp, rid)) return { ok: 1, dup: 1, w: this.wState(cp) };
      if (this.sLimit(cp, "wbuy", 20)) return { err: "rate" };
      const P = this.wPrice(cp, m); if (P.err) return { ...P, w: this.wState(cp) };
      if (!this.wPay(cp, P.price, "buy", P.keys.join(","))) return { err: "noCoins", w: this.wState(cp) };
      for (const k of P.keys) this.wGive(cp, k, "buy"); if (rid) this.wMark(cp, rid); return { ok: 1, price: P.price, it: P.keys, w: this.wState(cp) }; }
    if (op === "w_fuse") { // land1: skin fusion. Both skins owned (bought / earned; not level-free, flags or owner-only), this pair never fused
      // before, the fee paid and the new skin given in ONE step (no await in between); rid makes a retried request a no-op
      const rid = /^[0-9a-f]{8,24}$/.test(String(m.rid || "")) ? "fuse:" + m.rid : ""; if (rid && this.wClaimed(cp, rid)) return { ok: 1, dup: 1, w: this.wState(cp) };
      if (this.sLimit(cp, "wfuse", 12)) return { err: "rate" };
      const a = m.a | 0, b = m.b | 0; if (a === b || String(a) !== String(m.a) || String(b) !== String(m.b) || !fusable(a) || !fusable(b)) return { err: "na" };
      const key = fuKey(a, b); if (!this.wHas(cp, SKINS[a].id) || !this.wHas(cp, SKINS[b].id)) return { err: "notOwned", w: this.wState(cp) };
      if (this.wHas(cp, key)) return { err: "own", key, w: this.wState(cp) };
      if (m.fee != null && Number(m.fee) !== FUSION_FEE) return { err: "price", fee: FUSION_FEE, w: this.wState(cp) };
      if (!this.wPay(cp, FUSION_FEE, "fuse", key)) return { err: "noCoins", w: this.wState(cp) };
      this.wGive(cp, key, "fuse"); if (rid) this.wMark(cp, rid); return { ok: 1, key, fee: FUSION_FEE, w: this.wState(cp) }; }
    if (op === "w_sid") { // a special id: who gets it AND its coins, one transaction (no grant-then-refund)
      if (this.sLimit(cp, "buy", 6)) return { err: "rate" }; const n = String(m.n || ""), kd = idKind(n); if (!kd) return { err: "bad" };
      const price = idPrice(n); if (Number(m.price) !== price) return { err: "price", price };
      if (q.exec("SELECT COUNT(*) AS c FROM ids WHERE pid = ? AND kind = 'p'", cp).one().c >= 5) return { err: "max" };
      if (q.exec("SELECT num FROM ids WHERE num = ?", n).toArray().length) return { err: "sold" };
      if (!this.wPay(cp, price, "sid", "sid:" + n)) return { err: "noCoins", w: this.wState(cp) };
      q.exec("INSERT INTO ids (num, pid, kind, t, tok) VALUES (?, ?, 'p', ?, NULL)", n, cp, now); this.wGive(cp, "sid:" + n, "buy"); this.sVis(cp); this.sPresAll(cp);
      return { ok: 1, n, price, me: this.sMe(cp), w: this.wState(cp) }; }
    if (op === "w_spin") { // the wheel is rolled here; the device only animates to the segment it is told
      const d = String(m.d || ""); if (!dayOk(d, now, 1)) return { err: "bad" }; if (W.sd && d <= W.sd) return { err: "day", w: this.wState(cp) }; const ck = "spin:" + d; if (this.wClaimed(cp, ck)) return { err: "day", w: this.wState(cp) };
      const b = new Uint32Array(1); crypto.getRandomValues(b); const i = spinPick(b[0] / 4294967296), sg = SPIN[i]; let c = sg.c | 0, cos = null;
      if (sg.cos) { const want = String(m.cos || ""); if (RANDOM_COS.test(want) && !this.wHas(cp, want)) { cos = want; this.wGive(cp, cos, "spin"); } else c = SPIN_NOCOS; }
      q.exec("UPDATE wal SET sd = ? WHERE pid = ?", d, cp); this.wMark(cp, ck); this.wAdd(cp, c, "spin", ck); if (sg.x) this.wXp(cp, sg.x, "spin");
      return { ok: 1, i, c, x: sg.x | 0, cos, w: this.wState(cp) }; }
    if (op === "w_claims") { const L = (Array.isArray(m.l) ? m.l : []).slice(0, 25).filter((x) => x && typeof x === "object");
      L.sort((x, y) => (+(x.a && x.a.at) || 0) - (+(y.a && y.a.at) || 0)); // offline matches in the order they were played
      const cn = +m.cn || 0, ctx = { fin: {}, finErr: 0, skew: cn > 0 ? Math.max(-7 * DAY, Math.min(7 * DAY, now - cn)) : 0 }; const sv = L.filter((x) => x.k === "rw" && /^rw:sv:/.test(String(x.ck || "")) && !this.wClaimed(cp, String(x.ck)));
      if (sv.length) { try { const r = await (await this.boardStub().fetch("https://board/b/fin", { method: "POST", body: JSON.stringify({ pids: [...new Set([cp, dp])], keys: sv.slice(0, 10).map((x) => String(x.ck).slice(6)) }) })).json(); if (r && r.fin) ctx.fin = r.fin; else ctx.finErr = 1; } catch (_) { ctx.finErr = 1; } }
      const res = L.map((x) => { try { return this.wClaim(cp, x, ctx); } catch (e) { this.serr = (this.serr | 0) + 1; return { ck: String(x.ck || ""), err: "server", keep: 1 }; } });
      return { res, w: this.wState(cp) }; }
    return { err: "op" };
  }
  // coin1: an online life seen by a game room -> its coins (same formula as the device, capped per life and per day)
  wEarn(B) { const cp = String(B.pid || ""), ck = String(B.ck || ""), now = Date.now(); if (!/^[0-9a-f]{20}$/.test(cp) || !/^on:[a-z0-9:-]{6,90}$/.test(ck)) return { err: "bad" };
    const q = this.sdb(), W = q.exec("SELECT * FROM wal WHERE pid = ?", cp).toArray()[0]; if (!W || !W.mig) return { err: "mig" }; if (this.wClaimed(cp, ck)) return { dup: 1 };
    const bty = B.bty ? Math.max(0, Math.min(BOUNTY.MAX, B.bty | 0)) : 0; // play2: crown bounty (no XP), same daily online cap
    let c = bty || Math.min(ONLINE.PER_LIFE, matchCoins({ mode: "online", diff: 1, best: Math.max(0, Math.min(1e6, +B.best || 0)), kills: Math.max(0, Math.min(60, B.kills | 0)), dur: Math.max(0, Math.min(7200, +B.dur || 0)) }));
    const td = utcDay(now), used = W.od === td ? W.oe | 0 : 0; let note = null; if (c > ONLINE.PER_DAY - used) { note = { cut: ["day"], full: c }; c = Math.max(0, ONLINE.PER_DAY - used); }
    q.exec("UPDATE wal SET od = ?, oe = ? WHERE pid = ?", td, used + c, cp); this.wMark(cp, ck); this.wAdd(cp, c, bty ? "bounty" : "online", ck, note);
    if (bty) { const bal = q.exec("SELECT bal FROM wal WHERE pid = ?", cp).one().bal; this.sPush(cp, { k: "wal", bal, e: { k: "bounty", c } }); return { ok: 1, c, bal, bty: 1 }; }
    const dur = Math.max(0, Math.min(7200, +B.dur || 0)); this.wXp(cp, dur < OFF.MIN_S ? 0 : Math.min(XP.LIFE, matchXp({ mode: "online", diff: 1, best: Math.max(0, Math.min(1e6, +B.best || 0)), kills: Math.max(0, Math.min(60, B.kills | 0)), dur })), "online"); // fix1
    const bal = q.exec("SELECT bal FROM wal WHERE pid = ?", cp).one().bal; this.sPush(cp, { k: "wal", bal, e: { k: "online", c } }); return { ok: 1, c, bal }; }
  // srv2: the device id (dp) a request came from -> the account's canonical player id. Every social row is keyed by the canonical
  // id, so a device that signs in sees that account's id, friends, chats and special ids at once.
  canon(dp) { const q = this.sdb(); const r = q.exec("SELECT a.pid AS p FROM dl JOIN au a ON a.aid = dl.aid WHERE dl.dp = ?", dp).toArray()[0]; return r && r.p ? r.p : dp; }
  banOf(cp, dp) { const q = this.sdb(), now = Date.now(); const r = q.exec("SELECT until FROM ban WHERE pid IN (?, ?) AND until > ? ORDER BY until DESC LIMIT 1", cp, dp || cp, now).toArray()[0]; return r ? r.until : 0; }
  muteOf(cp) { const r = this.sdb().exec("SELECT until FROM mute WHERE pid = ? AND until > ?", cp, Date.now()).toArray()[0]; return r ? r.until : 0; }
  async sOp(dp, m) { // the ops that need an await (hashing, mail, sign-in) are resolved here, then everything else is synchronous
    m = m || {}; const pid = this.canon(dp), op = String(m.op || "");
    try { if (ACCT_OPS.has(op)) return await this.aop(dp, pid, m); if (op.startsWith("a_")) return await this.adm(pid, m); } catch (e) { this.serr = (this.serr | 0) + 1; return { err: "server", m: String(e && e.message).slice(0, 100) }; }
    const bu = this.banOf(pid, dp); if (bu && op !== "me" && op !== "w_get") return { err: "banned", until: bu };
    if (op.startsWith("w_")) { try { return await this.wop(dp, pid, m); } catch (e) { this.serr = (this.serr | 0) + 1; return { err: "server", m: String(e && e.message).slice(0, 100) }; } } // coin1: wallet
    if (m && m.op === "claim1") { if (this.sLimit(pid, "claim", 5, 600000)) return { err: "rate" }; this.sAcct(pid);
      const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-own|" + String(m.code || "").trim().toUpperCase())))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const q = this.sdb(), r = q.exec("SELECT pid FROM ids WHERE num = '1'").toArray()[0];
      if (h !== OWNER_H) return { err: "bad" }; if (r && r.pid && r.pid !== pid) return { err: "taken" };
      q.exec("UPDATE ids SET pid = ?, t = ? WHERE num = '1'", pid, Date.now()); q.exec("UPDATE acct SET own = 1 WHERE pid = ?", pid); this.sVis(pid); return { ok: 1, me: this.sMe(pid) }; }
    try { return this.sop(pid, m || {}); } catch (e) { this.serr = (this.serr | 0) + 1; return { err: "server", m: String(e && e.message).slice(0, 100) }; }
  }
  // ---------- srv2: accounts (link a device to an account, sign-in, profile snapshots) ----------
  devAcct(dp) { return this.sdb().exec("SELECT a.* FROM dl JOIN au a ON a.aid = dl.aid WHERE dl.dp = ?", dp).toArray()[0] || null; }
  aView(dp) { const A = this.devAcct(dp); if (!A) return null; const r = this.srow(A.pid); return { aid: A.aid.slice(0, 8), g: A.gsub ? 1 : 0, a: A.asub ? 1 : 0, e: A.email ? maskEm(A.email) : "", tt: A.tsub ? 1 : 0, own: r && r.own ? 1 : 0, since: A.t }; }
  snapSv(cp) { const r = this.sdb().exec("SELECT sv FROM snp WHERE pid = ?", cp).toArray()[0]; return r ? r.sv : 0; }
  link(dp, cp, k, sub) {
    const q = this.sdb(), now = Date.now(), col = { e: "email", g: "gsub", a: "asub", t: "tsub" }[k]; if (!col) return { err: "bad" };
    const A = q.exec(`SELECT * FROM au WHERE ${col} = ?`, sub).toArray()[0], cur = this.devAcct(dp); let mode;
    if (A) { if (cur && cur.aid === A.aid) mode = "same"; else { q.exec("INSERT OR REPLACE INTO dl (dp, aid, t) VALUES (?, ?, ?)", dp, A.aid, now); mode = "restore"; } } // a known account: this device now plays as it
    else if (cur) { if (cur[col]) return { err: "has" }; q.exec(`UPDATE au SET ${col} = ? WHERE aid = ?`, sub, cur.aid); mode = "added"; } // signed in already: one more way to sign in
    else { const mine = q.exec("SELECT * FROM au WHERE pid = ?", cp).toArray()[0];
      if (mine) { if (mine[col]) return { err: "has" }; q.exec(`UPDATE au SET ${col} = ? WHERE aid = ?`, sub, mine.aid); q.exec("INSERT OR REPLACE INTO dl (dp, aid, t) VALUES (?, ?, ?)", dp, mine.aid, now); mode = "added"; }
      else { const aid = rnd(12); q.exec("INSERT INTO au (aid, pid, email, gsub, asub, tsub, t, last) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", aid, cp, k === "e" ? sub : null, k === "g" ? sub : null, k === "a" ? sub : null, k === "t" ? sub : null, now, now);
        q.exec("INSERT OR REPLACE INTO dl (dp, aid, t) VALUES (?, ?, ?)", dp, aid, now); mode = "new"; } } // a new account from this device's current profile (keeps its id, friends, id 1 if it holds it)
    q.exec("UPDATE au SET last = ? WHERE aid = (SELECT aid FROM dl WHERE dp = ?)", now, dp);
    const ncp = this.canon(dp); this.sAcct(ncp); const sn = q.exec("SELECT sv, js FROM snp WHERE pid = ?", ncp).toArray()[0];
    q.exec("UPDATE dv SET cp = ? WHERE dp = ?", ncp, dp);
    return { ok: 1, mode, acct: this.aView(dp), me: this.sMe(ncp), snap: mode === "restore" && sn ? { sv: sn.sv, js: sn.js } : null, sv: sn ? sn.sv : 0 };
  }
  // a real delete: the account, its links, snapshot, social rows, special ids and board row. Ban rows stay (they only hold ids).
  purge(cp) {
    const q = this.sdb(), A = q.exec("SELECT aid FROM au WHERE pid = ?", cp).toArray()[0], me = this.srow(cp), fr = this.sFriends(cp);
    if (A) { q.exec("DELETE FROM dl WHERE aid = ?", A.aid); q.exec("DELETE FROM au WHERE aid = ?", A.aid); } q.exec("DELETE FROM dl WHERE dp = ?", cp);
    for (const T of ["fr", "rq", "bl", "inv"]) q.exec(`DELETE FROM ${T} WHERE a = ? OR b = ?`, cp, cp);
    q.exec("DELETE FROM msg WHERE cv LIKE ? OR cv LIKE ?", cp + ":%", "%:" + cp); q.exec("DELETE FROM rd WHERE pid = ? OR cv LIKE ? OR cv LIKE ?", cp, cp + ":%", "%:" + cp);
    q.exec("DELETE FROM rep WHERE by = ? OR who = ?", cp, cp); for (const T of ["gr", "snp", "mute", "nonce", "wal", "own", "clm", "led"]) q.exec(`DELETE FROM ${T} WHERE ${T === "nonce" ? "dp" : "pid"} = ?`, cp);
    q.exec("DELETE FROM dv WHERE cp = ? OR dp = ?", cp, cp); q.exec("DELETE FROM ids WHERE pid = ? AND num != '1'", cp); q.exec("DELETE FROM acct WHERE pid = ?", cp);
    if (me) for (const f of fr) this.sPush(f, { k: "rem", id: me.vis });
    let ws = []; try { ws = this.state.getWebSockets(cp); } catch (_) {} for (const w of ws) try { w.send('{"t":"ev","k":"gone"}'); w.close(4010, "deleted"); } catch (_) {}
    try { const r = this.boardStub().fetch("https://board/b/del?pid=" + cp); if (r && r.catch) r.catch(() => {}); } catch (_) {}
  }
  snapOp(dp, cp, m) {
    const q = this.sdb(), now = Date.now(), js = String(m.js || ""); if (js.length > SNAP_MAX) return { err: "big" }; if (this.sLimit(cp, "snap", 20)) return { err: "rate" };
    let P; try { P = JSON.parse(js, (k, v) => (k === "__proto__" || k === "constructor" || k === "prototype" ? undefined : v)); } catch (_) { return { err: "json" }; }
    if (!P || typeof P !== "object" || Array.isArray(P) || !Number.isFinite(+P.coins) || !Number.isFinite(+P.xp) || +P.coins < 0 || +P.xp < 0) return { err: "bad" };
    delete P.dev; delete P._ck; delete P.ssv; // the device secret never leaves the device; checksums are rebuilt on restore
    const prev = q.exec("SELECT sv, coins, xp, t, sus FROM snp WHERE pid = ?", cp).toArray()[0];
    if (prev && (m.sv | 0) !== prev.sv) return { err: "stale", sv: prev.sv, js: q.exec("SELECT js FROM snp WHERE pid = ?", cp).one().js }; // another device saved first: take that save
    let coins = Math.floor(+P.coins), xp = Math.floor(+P.xp), adj = null, sus = prev ? prev.sus | 0 : 0;
    // server-checked economy: coins / xp may only rise as fast as play can earn them (owner grants are added here directly)
    const al = prev ? allowance((now - prev.t) / 60000) : { coins: 5e6, xp: 5e8 }, bc = prev ? prev.coins : 0, bx = prev ? prev.xp : 0;
    const Wl = this.sdb().exec("SELECT bal, mig FROM wal WHERE pid = ?", cp).toArray()[0]; // coin1: once the wallet exists the snapshot just mirrors it
    if (Wl && Wl.mig) { if (coins !== Wl.bal) adj = { coins: Wl.bal }; coins = Wl.bal; } else if (coins > bc + al.coins) { coins = bc + al.coins; adj = { coins }; sus++; } if (Wl && Wl.mig) { const sx = this.wSx(cp, this.wRow(cp)); if (xp > sx + XP.SLACK) { xp = sx; adj = { ...(adj || {}), xp }; } } /* fix1: server XP decides */ else if (xp > bx + al.xp) { xp = bx + al.xp; adj = { ...(adj || {}), xp }; sus++; }
    P.coins = coins; P.xp = xp; const sv = (prev ? prev.sv : 0) + 1, lv = lvOf(xp);
    q.exec("INSERT OR REPLACE INTO snp (pid, sv, coins, xp, lv, js, t, sus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", cp, sv, coins, xp, lv, JSON.stringify(P), now, sus);
    let ws = []; try { ws = this.state.getWebSockets(cp); } catch (_) {} for (const w of ws) if (w !== m._ws) try { w.send(JSON.stringify({ t: "ev", k: "snap", sv })); } catch (_) {} // other signed-in devices
    return { ok: 1, sv, adj, lv };
  }
  async aop(dp, cp, m) {
    const q = this.sdb(), now = Date.now(), op = m.op;
    if (op === "acst") return { acct: this.aView(dp), sv: this.snapSv(cp), ban: this.banOf(cp, dp), mute: this.muteOf(cp), me: this.sMe(this.sAcct(cp).pid) };
    if (op === "snap") return this.snapOp(dp, cp, m);
    if (op === "pull") { const r = q.exec("SELECT sv, js FROM snp WHERE pid = ?", cp).toArray()[0]; return r ? { sv: r.sv, js: r.js } : { sv: 0, js: "" }; }
    if (op === "gack") { const ids = (Array.isArray(m.ids) ? m.ids : []).slice(0, 20).map((x) => x | 0); for (const g of ids) q.exec("UPDATE gr SET ack = 1 WHERE gid = ? AND pid = ?", g, cp); return { ok: 1 }; }
    if (op === "nonce") { if (this.sLimit(dp, "nonce", 10)) return { err: "rate" }; const n = rnd(16); q.exec("DELETE FROM nonce WHERE t < ?", now - 900000); q.exec("INSERT INTO nonce (n, dp, t) VALUES (?, ?, ?)", n, dp, now); return { n }; }
    if (op === "idt") { const v = m._v; if (!v || !["g", "a", "t"].includes(v.k) || typeof v.sub !== "string") return { err: "token" }; if (this.sLimit(dp, "link", 10)) return { err: "rate" };
      if (v.k !== "t") { const r = q.exec("SELECT n FROM nonce WHERE n = ? AND dp = ? AND t > ?", String(v.n || ""), dp, now - 900000).toArray()[0]; if (!r) return { err: "nonce" }; q.exec("DELETE FROM nonce WHERE n = ?", r.n); } // one use, this device, 15 min
      return this.link(dp, cp, v.k, v.sub); }
    if (op === "em1") { const em = String(m.email || "").trim().toLowerCase(); if (!EMAIL_RE.test(em) || em.length > 254) return { err: "email" };
      if (!this.env || !this.env.MAIL_API_KEY || !this.env.MAIL_FROM) return { err: "mail_off" };
      if (this.sLimit(dp, "em1", 3, 600000) || this.sLimit(em, "em1", 4, 3600000)) return { err: "rate" };
      const b = new Uint32Array(1); crypto.getRandomValues(b); const code = String(100000 + (b[0] % 900000));
      q.exec("INSERT OR REPLACE INTO ecode (email, h, exp, n, dp, t) VALUES (?, ?, ?, 0, ?, ?)", em, await sha("ssp-em|" + em + "|" + code), now + 600000, dp, now);
      const st = await sendMail(this.env, em, code); if (st !== "ok") { q.exec("DELETE FROM ecode WHERE email = ?", em); return { err: "mail_fail" }; } return { ok: 1, exp: 600 }; }
    if (op === "em2") { const em = String(m.email || "").trim().toLowerCase(), code = String(m.code || "").replace(/\D/g, ""); const r = q.exec("SELECT * FROM ecode WHERE email = ?", em).toArray()[0];
      if (!r || r.exp < now) return { err: "expired" }; if (r.dp !== dp) return { err: "expired" }; if (r.n >= 5) return { err: "tries" };
      if ((await sha("ssp-em|" + em + "|" + code)) !== r.h) { q.exec("UPDATE ecode SET n = n + 1 WHERE email = ?", em); return { err: "code", left: 4 - r.n }; }
      q.exec("DELETE FROM ecode WHERE email = ?", em); return this.link(dp, cp, "e", em); }
    if (op === "out") { q.exec("DELETE FROM dl WHERE dp = ?", dp); q.exec("UPDATE dv SET cp = ? WHERE dp = ?", dp, dp); return { ok: 1 }; }
    if (op === "adel") { const A = this.devAcct(dp); if (!A) { const g = this.srow(cp); if (g && g.own) return { err: "owner" }; if (this.sLimit(dp, "adel", 3, 600000)) return { err: "rate" }; this.purge(cp); return { ok: 1, guest: 1 }; } /* coin1: a guest deletes its online data too */ const r = this.srow(A.pid); if (r && r.own) return { err: "owner" }; this.purge(A.pid); return { ok: 1 }; }
    return { err: "op" };
  }
  async acctHttp(req) { let B = {}; try { B = JSON.parse(await req.text()) || {}; } catch (_) {} const dp = await pidOf(String(B.pk || "")); if (!dp) return J({ err: "pk" }, 400); return J(await this.sOp(dp, B)); }
  // ---------- srv2: owner-only maintenance. Input comes ONLY from the deployment (worker binding MAINT, set by
  // /workspace/work/srv2/move_id1.sh with the Cloudflare API token); no request can choose what runs. Each MAINT key runs once.
  maint() {
    const raw = this.env && this.env.MAINT; if (!raw || this._mDone === raw) return; this._mDone = raw; let M; try { M = JSON.parse(raw); } catch (_) { return; }
    const q = this.sdb(); q.exec("CREATE TABLE IF NOT EXISTS smeta (k TEXT PRIMARY KEY, v TEXT)"); if (!M || !/^[0-9a-f]{16,64}$/.test(M.key || "")) return;
    if (q.exec("SELECT v FROM smeta WHERE k = ?", "maint:" + M.key).toArray().length) return; let out;
    try { out = M.op === "move1" ? this.moveId1(String(M.to || "")) : { err: "op" }; } catch (e) { out = { err: "server", m: String(e && e.message).slice(0, 100) }; }
    q.exec("INSERT OR REPLACE INTO smeta (k, v) VALUES (?, ?)", "maint:" + M.key, JSON.stringify({ t: Date.now(), ...out }));
    if (out.ok) q.exec("INSERT INTO aud (t, act, tgt, why, d) VALUES (?, 'move1', '1', ?, ?)", Date.now(), "owner maintenance: id 1 moved to the account of " + M.to, JSON.stringify(out).slice(0, 400));
  }
  // id 1 -> the account that holds 7-digit id `to` (its coins, skins, friends, level and trophies stay: they are keyed by that account);
  // the 7-digit number is released. A previous holder of id 1 (if any) loses the owner flag and gets a fresh 7-digit id.
  moveId1(to) {
    const q = this.sdb(), now = Date.now(); if (!/^[1-9]\d{6}$/.test(to)) return { err: "bad" };
    const r = q.exec("SELECT pid FROM ids WHERE num = ? AND kind = 'b'", to).toArray()[0]; if (!r || !r.pid) return { err: "notfound" }; const tp = r.pid;
    const one = q.exec("SELECT pid FROM ids WHERE num = '1'").toArray()[0], old = one && one.pid && one.pid !== tp ? one.pid : "";
    if (old) { q.exec("UPDATE acct SET own = 0 WHERE pid = ?", old); let n = ""; for (let k = 0; k < 40 && !n; k++) { const b = new Uint32Array(1); crypto.getRandomValues(b); const c = String(1000000 + (b[0] % 9000000)); if (!q.exec("SELECT num FROM ids WHERE num = ?", c).toArray().length) n = c; }
      q.exec("INSERT INTO ids (num, pid, kind, t) VALUES (?, ?, 'b', ?)", n, old, now); q.exec("UPDATE acct SET id7 = ? WHERE pid = ?", n, old); this.sVis(old); }
    q.exec("UPDATE ids SET pid = ?, t = ? WHERE num = '1'", tp, now); q.exec("UPDATE acct SET own = 1, id7 = '1' WHERE pid = ?", tp); q.exec("DELETE FROM ids WHERE num = ? AND pid = ?", to, tp); this.sVis(tp);
    let ws = []; try { ws = this.state.getWebSockets(tp); } catch (_) {} for (const w of ws) try { w.close(4012, "id changed"); } catch (_) {} // the game reconnects and gets id 1
    this.sPresAll(tp); return { ok: 1, to, prev: old ? "moved" : "none", friends: this.sFriends(tp).length };
  }
  // ---------- srv2: owner admin (only the account holding id 1; checked here on every call, never on the client) ----------
  grantTo(cp, coins, items, why) {
    const q = this.sdb(), now = Date.now(); q.exec("INSERT INTO gr (pid, coins, items, why, t) VALUES (?, ?, ?, ?, ?)", cp, coins, JSON.stringify(items), why, now);
    const gid = q.exec("SELECT MAX(gid) AS n FROM gr WHERE pid = ?", cp).one().n, r = q.exec("SELECT * FROM snp WHERE pid = ?", cp).toArray()[0]; let sv = 0;
    // coin1: items go to the server-held list at once; coins go into the wallet (or, before this player's first updated connect,
    // wait in gr and are added by the migration unless an older build already applied them on the device)
    for (const it of items) if (validKey(it)) this.wGive(cp, it, "grant"); const W = this.wRow(cp); let bal = null;
    if (W.mig) { q.exec("UPDATE gr SET w = 1 WHERE gid = ?", gid); this.wAdd(cp, coins, "grant", "adm:" + gid, why ? { why: String(why).slice(0, 80) } : null); bal = q.exec("SELECT bal FROM wal WHERE pid = ?", cp).one().bal; }
    if (r) { let P = null; try { P = JSON.parse(r.js); } catch (_) {} if (P) { P.coins = bal != null ? bal : (+P.coins || 0) + coins; applyItems(P, items); if (!Array.isArray(P.rc)) P.rc = []; P.rc.push("adm:" + gid); sv = r.sv + 1; q.exec("UPDATE snp SET sv = ?, coins = ?, js = ? WHERE pid = ?", sv, P.coins, JSON.stringify(P), cp); } }
    const live = this.sPush(cp, { k: "grant", g: { id: gid, c: coins, it: items }, sv, ...(bal != null ? { bal } : {}) }); return { gid, sv, live, bal };
  }
  async adm(cp, m) {
    const q = this.sdb(), now = Date.now(), op = String(m.op), me = this.srow(cp);
    if (!me || !me.own) { this.denied = (this.denied | 0) + 1; return { err: "forbidden" }; } if (this.sLimit(cp, "adm", 150)) return { err: "rate" };
    const why = String(m.why || "").trim().slice(0, 200), card = (p) => { if (p === "fb") return { id: "—", n: "✉ Feedback" }; const r = this.srow(p); return r ? { id: r.vis, n: r.name, lv: r.lv | 0, av: r.av, fr: r.fr | 0, own: r.own ? 1 : 0 } : { id: "—", n: "(deleted)" }; };
    const log = (act, tgt, d) => q.exec("INSERT INTO aud (t, act, tgt, why, d) VALUES (?, ?, ?, ?, ?)", now, act, tgt || "", why, JSON.stringify(d || {}).slice(0, 400));
    const devs = (p) => [...new Set([p, ...q.exec("SELECT dl.dp AS d FROM dl JOIN au a ON a.aid = dl.aid WHERE a.pid = ?", p).toArray().map((r) => r.d), ...q.exec("SELECT dp AS d FROM dv WHERE cp = ?", p).toArray().map((r) => r.d)])];
    if (op === "a_find") { const s = String(m.q || "").trim().slice(0, 24); if (!s) return { list: [] }; const pids = new Set(); const byId = this.sPid(s); if (byId) pids.add(byId);
      if (!/^\d+$/.test(s)) for (const r of q.exec("SELECT pid FROM acct WHERE name LIKE ? ESCAPE '\\' ORDER BY seen DESC LIMIT 25", "%" + s.replace(/[\\%_]/g, (c) => "\\" + c) + "%").toArray()) pids.add(r.pid);
      return { list: [...pids].slice(0, 25).map((p) => ({ ...card(p), ban: this.banOf(p) ? 1 : 0, mute: this.muteOf(p) ? 1 : 0, acc: q.exec("SELECT aid FROM au WHERE pid = ?", p).toArray().length ? 1 : 0, seen: (this.srow(p) || {}).seen || 0 })) }; }
    if (op === "a_view") { const t = this.sPid(m.id); if (!t) return { err: "notfound" }; const r = this.srow(t), A = q.exec("SELECT * FROM au WHERE pid = ?", t).toArray()[0], sn = q.exec("SELECT sv, coins, xp, lv, t, sus, length(js) AS sz FROM snp WHERE pid = ?", t).toArray()[0];
      const linked = new Set(A ? q.exec("SELECT dp FROM dl WHERE aid = ?", A.aid).toArray().map((x) => x.dp) : []), bn = q.exec("SELECT until, why, t FROM ban WHERE pid = ? AND until > ?", t, now).toArray()[0], mu = q.exec("SELECT until, why, t FROM mute WHERE pid = ? AND until > ?", t, now).toArray()[0];
      return { card: { ...card(t), id7: r.id7, seen: r.seen, t: r.t, nr: r.nr ? 1 : 0 }, pid: t.slice(0, 8),
        acct: A ? { g: A.gsub ? 1 : 0, a: A.asub ? 1 : 0, e: A.email ? maskEm(A.email) : "", tt: A.tsub ? 1 : 0, since: A.t, last: A.last } : null, snap: sn || null,
        devices: q.exec("SELECT dp, ua, t0, t1 FROM dv WHERE cp = ? ORDER BY t1 DESC LIMIT 12", t).toArray().map((d) => ({ d: d.dp.slice(0, 6), ua: d.ua, t0: d.t0, t1: d.t1, ln: linked.has(d.dp) ? 1 : 0 })),
        reps: q.exec("SELECT id, by, tx, t, res FROM rep WHERE who = ? ORDER BY id DESC LIMIT 30", t).toArray().map((x) => ({ id: x.id, by: card(x.by), tx: x.tx, t: x.t, res: x.res | 0 })), repBy: q.exec("SELECT COUNT(*) AS n FROM rep WHERE by = ?", t).one().n,
        ban: bn || null, mute: mu || null, grants: q.exec("SELECT gid, coins, items, why, t, ack FROM gr WHERE pid = ? ORDER BY gid DESC LIMIT 10", t).toArray(), friends: q.exec("SELECT COUNT(*) AS n FROM fr WHERE a = ?", t).one().n, prem: this.sMe(t).prem, items: this.wOwn(t), msgs: q.exec("SELECT COUNT(*) AS n FROM msg WHERE f = ?", t).one().n,
        tr: await (async () => { try { return (await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(BOARD)).fetch("https://board/b/get?pid=" + t)).json()).tr | 0; } catch (_) { return null; } })(), lv: (() => { const W = q.exec("SELECT * FROM wal WHERE pid = ?", t).toArray()[0]; return W && W.mig ? lvOf(this.wSx(t, W)) : null; })(),
        wal: (() => { const w = q.exec("SELECT bal, mig, cuts, t FROM wal WHERE pid = ?", t).toArray()[0]; return w ? { ...w, own: q.exec("SELECT COUNT(*) AS n FROM own WHERE pid = ?", t).one().n, led: q.exec("SELECT k, d, bal, ref, note, t FROM led WHERE pid = ? ORDER BY id DESC LIMIT 12", t).toArray() } : null; })() }; }
    if (op === "a_srv") { let mm = null; try { mm = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(MM)).fetch("https://mm/m/list")).json(); } catch (_) {}
      let ws = []; try { ws = this.state.getWebSockets(); } catch (_) {} const seen = new Map(); for (const w of ws) { let a = null; try { a = w.deserializeAttachment(); } catch (_) {} if (a && a.pid) seen.set(a.pid, seen.get(a.pid) === "match" ? "match" : a.st); }
      const st = [...seen.values()], rooms = (mm && mm.rooms) || [];
      return { rooms, online: seen.size, lobby: st.filter((x) => x !== "match").length, match: st.filter((x) => x === "match").length, inRooms: rooms.reduce((a, r) => a + (r.live ? r.h : 0), 0),
        msgMin: q.exec("SELECT COUNT(*) AS n FROM msg WHERE t > ?", now - 60000).one().n, msg10: q.exec("SELECT COUNT(*) AS n FROM msg WHERE t > ?", now - 600000).one().n / 10,
        errs: { social: this.serr | 0, rooms: rooms.reduce((a, r) => a + (r.e | 0), 0), denied: this.denied | 0 }, players: q.exec("SELECT COUNT(*) AS n FROM acct").one().n, accounts: q.exec("SELECT COUNT(*) AS n FROM au").one().n,
        open: q.exec("SELECT COUNT(*) AS n FROM rep WHERE res = 0 OR res IS NULL").one().n, mm: mm ? 1 : 0, at: now }; }
    if (op === "a_reps") return { list: q.exec("SELECT id, by, who, tx, t, res, rwhy FROM rep ORDER BY (res = 1) ASC, id DESC LIMIT 60").toArray().map((x) => ({ id: x.id, by: card(x.by), who: card(x.who), tx: x.tx, t: x.t, res: x.res | 0, rwhy: x.rwhy || "" })) };
    if (op === "a_aud") return { list: q.exec("SELECT id, t, act, tgt, why, d FROM aud ORDER BY id DESC LIMIT 100").toArray() };
    // ---------- admin2 read-only views ----------
    if (op === "a_stats") { let ws = []; try { ws = this.state.getWebSockets(); } catch (_) {} const on = new Set(); for (const w of ws) { let a = null; try { a = w.deserializeAttachment(); } catch (_) {} if (a && a.pid) on.add(a.pid); }
      const days = []; for (let i = 6; i >= 0; i--) { const d = utcDay(now - i * 86400000), d0 = Date.parse(d + "T00:00:00Z"); let act = q.exec("SELECT COUNT(*) AS n FROM dau WHERE d = ?", d).one().n; if (i === 0) act = Math.max(act, q.exec("SELECT COUNT(*) AS n FROM acct WHERE seen >= ?", d0).one().n);
        days.push({ d, act, nw: q.exec("SELECT COUNT(*) AS n FROM acct WHERE t >= ? AND t < ?", d0, d0 + 86400000).one().n }); }
      return { online: on.size, today: days[6].act, nw: days[6].nw, days, players: q.exec("SELECT COUNT(*) AS n FROM acct").one().n, at: now }; }
    if (op === "a_cfg") return { cfg: this.cfgPub(), raw: { ann: this.cfgGet("ann") || null, mnt: this.cfgGet("mnt") || null }, modes: ADM_MODES, events: EVENTS, prices: [...SKINS.filter((x) => x.src && /^coins:/.test(x.src)).map((x) => ({ k: x.id, p: +x.src.split(":")[1], b: pxBase(x.id) })), { k: "flags", p: FLAG_PRICE, b: pxBase("flags") }, { k: "fusion", p: FUSION_FEE, b: pxBase("fusion") }, ...SHOP_TRAILS.filter((g) => g.price).map((g) => ({ k: "gt:" + g.id, p: g.price, b: pxBase("gt:" + g.id) }))],
      gifts: q.exec("SELECT id, coins, items, why, exp, t, n FROM gift ORDER BY id DESC LIMIT 10").toArray(), promos: q.exec("SELECT code, coins, items, max, used, exp, off, t FROM promo ORDER BY t DESC LIMIT 30").toArray() };
    if (op === "a_rooms") { let mm = null; try { mm = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(MM)).fetch("https://mm/m/list")).json(); } catch (_) {}
      const rooms = ((mm && mm.rooms) || []).slice(0, 24), out = await Promise.all(rooms.map(async (r) => { let d = null; try { d = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(r.room)).fetch("https://room/r/info")).json(); } catch (_) {} return { ...r, mode: "online", info: d }; }));
      return { rooms: out, mm: mm ? 1 : 0 }; }
    if (op === "a_msgs") { const t = this.sPid(m.id); if (!t) return { err: "notfound" }; return { list: q.exec("SELECT id, cv, tx, t FROM msg WHERE f = ? ORDER BY id DESC LIMIT 40", t).toArray() }; }
    if (why.length < 3) return { err: "reason" }; // every action below needs a reason and goes into the audit log
    const sure = m.sure === 1, items = (Array.isArray(m.items) ? m.items : []).map(String).filter((x) => validKey(x)).slice(0, 10);
    if (op === "a_ann") { const tx = String(m.tx || "").trim().slice(0, 280), h = Math.max(1, Math.min(720, m.hours | 0 || 24)); const v = tx ? { tx, exp: now + h * 3600000, id: now } : null; this.cfgSet("ann", v); this.sPushAll({ k: "cfg", cfg: this.cfgPub() }); log("ann", "", { tx: tx.slice(0, 80), h }); return { ok: 1, ann: v }; }
    if (op === "a_mnt") { const on = m.on ? 1 : 0; if (on && !sure) return { err: "sure" }; this.cfgSet("mnt", { on, msg: String(m.msg || "").trim().slice(0, 200) }); this.sPushAll({ k: "cfg", cfg: this.cfgPub() }); let kicked = 0;
      if (on) { let mm = null; try { mm = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(MM)).fetch("https://mm/m/list")).json(); } catch (_) {} for (const r of ((mm && mm.rooms) || []).filter((x) => x.h > 0).slice(0, 24)) { try { kicked += ((await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(r.room)).fetch("https://room/r/kick?all=1&k=maint&m=" + encodeURIComponent(String(m.msg || "").slice(0, 200)))).json()).n | 0); } catch (_) {} } }
      log("maint", "", { on, kicked }); return { ok: 1, on, kicked }; }
    if (op === "a_modes") { const mo = (Array.isArray(m.moff) ? m.moff : []).map(String).filter((x) => ADM_MODES.includes(x)), eo = (Array.isArray(m.eoff) ? m.eoff : []).map(String).filter((x) => EVENTS.includes(x));
      this.cfgSet("moff", mo); this.cfgSet("eoff", eo); this.sPushAll({ k: "cfg", cfg: this.cfgPub() }); log("modes", "", { moff: mo, eoff: eo }); return { ok: 1, moff: mo, eoff: eo }; }
    if (op === "a_mut") { const k = String(m.k || "auto"); if (k !== "auto" && k !== "off" && !MUTS.includes(k)) return { err: "bad" }; this.cfgSet("mut", k); this.sPushAll({ k: "cfg", cfg: this.cfgPub() }); log("mut", "", { k }); return { ok: 1, mut: k }; } // play2: weekend rule override
    if (op === "a_price") { const k = String(m.key || ""), p = Math.floor(+m.price || 0); if (pxBase(k) == null) return { err: "na" }; if (p < 0 || p > 1000000) return { err: "bad" }; const px = { ...(this.cfgGet("px") || {}) };
      if (p && p !== pxBase(k)) px[k] = p; else delete px[k]; this.cfgSet("px", px); this.sPushAll({ k: "cfg", cfg: this.cfgPub() }); log("price", "", { k, p: p || pxBase(k), was: pxBase(k) }); return { ok: 1, px }; }
    if (op === "a_gift") { const coins = Math.max(0, Math.min(100000, Math.floor(+m.coins || 0))), d = Math.max(1, Math.min(60, m.days | 0 || 7)); if (!coins && !items.length) return { err: "empty" };
      q.exec("INSERT INTO gift (coins, items, why, exp, t) VALUES (?, ?, ?, ?, ?)", coins, JSON.stringify(items), why, now + d * 86400000, now); const gid = q.exec("SELECT MAX(id) AS n FROM gift").one().n;
      let ws = []; try { ws = this.state.getWebSockets(); } catch (_) {} const on = new Set(); for (const w of ws) { let a = null; try { a = w.deserializeAttachment(); } catch (_) {} if (a && a.pid) on.add(a.pid); } let live = 0; for (const p of on) live += this.giftClaim(p);
      log("gift", "", { gid, coins, items, d, live }); return { ok: 1, gid, live }; }
    if (op === "a_promo") { const code = String(m.code || "").trim().toUpperCase(); if (!/^[A-Z0-9]{4,16}$/.test(code)) return { err: "bad" };
      if (m.off) { if (!q.exec("SELECT code FROM promo WHERE code = ?", code).toArray().length) return { err: "none" }; q.exec("UPDATE promo SET off = 1 WHERE code = ?", code); log("promo_off", "", { code }); return { ok: 1 }; }
      const coins = Math.max(0, Math.min(100000, Math.floor(+m.coins || 0))), mx = Math.max(1, Math.min(100000, m.max | 0 || 100)), d = Math.max(1, Math.min(365, m.days | 0 || 7)); if (!coins && !items.length) return { err: "empty" };
      if (q.exec("SELECT code FROM promo WHERE code = ?", code).toArray().length) return { err: "taken" }; q.exec("INSERT INTO promo (code, coins, items, max, used, exp, off, t) VALUES (?, ?, ?, ?, 0, ?, 0, ?)", code, coins, JSON.stringify(items), mx, now + d * 86400000, now); log("promo", "", { code, coins, items, max: mx, d }); return { ok: 1, code }; }
    if (op === "a_kick") { if (!sure) return { err: "sure" }; const room = String(m.room || ""), u = String(m.u || ""); if (!/^pub-[a-z0-9-]{1,20}$/.test(room) || !/^\d{1,7}$/.test(u) || u === "1") return { err: "bad" };
      let r = null; try { r = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(room)).fetch("https://room/r/kick?u=" + u)).json(); } catch (_) {} log("kick", u, { room, n: r ? r.n : 0 }); return { ok: 1, n: r ? r.n | 0 : 0 }; }
    if (op === "a_mdel") { if (!sure) return { err: "sure" }; const mid = m.mid | 0, r = q.exec("SELECT f, tx FROM msg WHERE id = ?", mid).toArray()[0]; if (!r) return { err: "none" }; q.exec("DELETE FROM msg WHERE id = ?", mid); const fr = this.srow(r.f); log("msg_del", fr ? fr.vis : "", { mid, tx: String(r.tx).slice(0, 60) }); return { ok: 1 }; }
    if (op === "a_bak") { const so = opsSnap(this.sdb()); let bo = null; try { bo = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(BOARD)).fetch("https://ops/x/snap?o=b")).json(); } catch (_) {} if (!bo) return { err: "board" };
      const js = JSON.stringify({ v: 1, wv: VERSION, t: now, social: so, board: bo }); let r = null; try { r = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(BAK)).fetch("https://ops/x/keep", { method: "POST", body: js })).json(); } catch (_) {}
      if (!r || !r.ok) return { err: "server" }; log("backup", "", { id: r.id, sz: js.length, rows: Object.values(so).reduce((a, x) => a + x.length, 0) }); return { ok: 1, id: r.id, sz: js.length, kept: r.kept }; }
    if (op === "a_res") { const rid = m.rid | 0; if (!q.exec("SELECT id FROM rep WHERE id = ?", rid).toArray().length) return { err: "none" }; q.exec("UPDATE rep SET res = 1, rwhy = ?, rt = ? WHERE id = ?", why, now, rid); log("resolve", "", { rid }); return { ok: 1 }; }
    const t = this.sPid(m.id); if (!t) return { err: "notfound" }; if (t === cp) return { err: "self" }; const tr = this.srow(t), tid = tr.vis; if (tr.own) return { err: "owner" };
    if (op === "a_ban") { const mins = Math.max(0, Math.min(525600, m.mins | 0)), until = mins ? now + mins * 60000 : PERM; for (const d of devs(t)) q.exec("INSERT OR REPLACE INTO ban (pid, until, why, t) VALUES (?, ?, ?, ?)", d, until, why, now);
      this.sPush(t, { k: "ban", u: until }); log("ban", tid, { mins: mins || "perm" }); return { ok: 1, until }; }
    if (op === "a_unban") { for (const d of devs(t)) q.exec("DELETE FROM ban WHERE pid = ?", d); this.sPush(t, { k: "unban" }); log("unban", tid); return { ok: 1 }; }
    if (op === "a_mute") { const mins = Math.max(0, Math.min(525600, m.mins | 0)), until = mins ? now + mins * 60000 : PERM; q.exec("INSERT OR REPLACE INTO mute (pid, until, why, t) VALUES (?, ?, ?, ?)", t, until, why, now); this.sPush(t, { k: "mute", u: until }); log("mute", tid, { mins: mins || "perm" }); return { ok: 1, until }; }
    if (op === "a_unmute") { q.exec("DELETE FROM mute WHERE pid = ?", t); this.sPush(t, { k: "unmute" }); log("unmute", tid); return { ok: 1 }; }
    if (op === "a_grant") { const coins = Math.max(0, Math.min(1000000, Math.floor(+m.coins || 0))), items = (Array.isArray(m.items) ? m.items : []).map(String).filter((x) => /^[a-z0-9_:.-]{1,32}$/i.test(x)).slice(0, 10);
      if (!coins && !items.length) return { err: "empty" }; const g = this.grantTo(t, coins, items, why); log("grant", tid, { coins, items, gid: g.gid }); return { ok: 1, ...g }; }
    if (op === "a_rname") { const nm = "Player" + String(tid).slice(-4); q.exec("UPDATE acct SET name = ?, nro = ?, nr = 1 WHERE pid = ?", nm, tr.name, t);
      const sr = q.exec("SELECT js FROM snp WHERE pid = ?", t).toArray()[0]; if (sr) { try { const P = JSON.parse(sr.js); P.name = nm; q.exec("UPDATE snp SET js = ? WHERE pid = ?", JSON.stringify(P), t); } catch (_) {} }
      this.sPush(t, { k: "rname", n: nm }); log("rename", tid, { old: tr.name, nw: nm }); return { ok: 1, n: nm }; }
    // ---------- admin2: one player ----------
    if (op === "a_coins") { const bal = Math.floor(+m.bal); if (!Number.isFinite(bal) || bal < 0 || bal > 100000000) return { err: "bad" }; const W = this.wRow(t); if (!W.mig) return { err: "nomig" }; const d = bal - (W.bal | 0); if (d < 0 && !sure) return { err: "sure" };
      this.wAdd(t, d, "adm", "adm:set", { why: why.slice(0, 80) }); const sr = q.exec("SELECT js FROM snp WHERE pid = ?", t).toArray()[0]; if (sr) { try { const P = JSON.parse(sr.js); P.coins = bal; q.exec("UPDATE snp SET coins = ?, js = ? WHERE pid = ?", bal, JSON.stringify(P), t); } catch (_) {} }
      const live = this.sPush(t, { k: "wal", bal }); log("coins", tid, { from: W.bal | 0, to: bal }); return { ok: 1, bal, live }; }
    if (op === "a_item") { const it = String(m.it || ""); if (!validKey(it)) return { err: "na" }; if (it.startsWith("sid:")) return { err: "use_sid" }; const rm = !!m.rm; if (rm && !sure) return { err: "sure" };
      if (rm) q.exec("DELETE FROM own WHERE pid = ? AND it = ?", t, it); else this.wGive(t, it, "adm"); this.wLed(t, rm ? "adm_rm" : "adm_give", 0, it, { why: why.slice(0, 80) });
      const live = this.sPush(t, { k: "adm", w: this.wState(t), rm: rm ? [it] : [] }); log(rm ? "item_rm" : "item_give", tid, { it }); return { ok: 1, live }; }
    if (op === "a_lvl") { const lv = Math.max(1, Math.min(100, m.lv | 0)), W = this.wRow(t); if (!W.mig) return { err: "nomig" }; const old = lvOf(this.wSx(t, W)); if (lv < old && !sure) return { err: "sure" };
      const sx = cumXp(lv) + Math.max(0, Math.min(xpNeed(lv) - 1, m.xp | 0)); q.exec("UPDATE wal SET sxp = ?, lvm = MAX(lvm, ?) WHERE pid = ?", sx, lv, t); q.exec("UPDATE acct SET lv = ? WHERE pid = ?", lv, t); q.exec("UPDATE snp SET xp = ?, lv = ? WHERE pid = ?", sx, lv, t);
      const live = this.sPush(t, { k: "adm", w: this.wState(t), xp: sx }); log("level", tid, { from: old, to: lv, xp: sx }); return { ok: 1, lv, sx, live }; }
    if (op === "a_sid") { const n = String(m.n || ""); if (!idKind(n) || n === "1") return { err: "bad" }; const rm = !!m.rm;
      if (rm) { if (!sure) return { err: "sure" }; if (!q.exec("SELECT num FROM ids WHERE num = ? AND pid = ? AND kind = 'p'", n, t).toArray().length) return { err: "none" }; q.exec("DELETE FROM ids WHERE num = ? AND pid = ?", n, t); q.exec("DELETE FROM own WHERE pid = ? AND it = ?", t, "sid:" + n); }
      else { if (q.exec("SELECT num FROM ids WHERE num = ?", n).toArray().length) return { err: "sold" }; q.exec("INSERT INTO ids (num, pid, kind, t, tok) VALUES (?, ?, 'p', ?, NULL)", n, t, now); this.wGive(t, "sid:" + n, "adm"); }
      this.sVis(t); this.sPresAll(t); const live = this.sPush(t, { k: "adm", w: this.wState(t), me: this.sMe(t), rm: rm ? ["sid:" + n] : [] }); log(rm ? "sid_rm" : "sid_give", tid, { n }); return { ok: 1, me: this.sMe(t), live }; }
    if (op === "a_trs") { const reset = !!m.reset; if (!sure) return { err: "sure" }; let r = null;
      try { r = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(BOARD)).fetch(reset ? "https://board/b/del?pid=" + t : "https://board/b/aset", reset ? undefined : { method: "POST", body: JSON.stringify({ pid: t, tr: m.tr | 0, name: tr.name }) })).json(); } catch (_) {}
      if (!r || !r.ok) return { err: "server" }; log(reset ? "tr_reset" : "tr_set", tid, reset ? {} : { tr: r.tr }); return { ok: 1, tr: reset ? 0 : r.tr }; }
    if (op === "a_mclr") { if (!sure) return { err: "sure" }; const n = q.exec("SELECT COUNT(*) AS n FROM msg WHERE f = ?", t).one().n; q.exec("DELETE FROM msg WHERE f = ?", t); log("msg_clr", tid, { n }); return { ok: 1, n }; }
    if (op === "a_del") { this.purge(t); log("delete", tid, { name: tr.name }); return { ok: 1 }; }
    return { err: "op" };
  }
  async socialHttp(req, url) {
    if (url.pathname === "/s/uid") { const dp = url.searchParams.get("pid") || ""; if (!/^[0-9a-f]{20}$/.test(dp)) return J({ err: "pid" }, 400); // internal: room / matchmaker -> social
      try { const cp = this.canon(dp), a = this.sAcct(cp); const o = { id: a.vis, cp, ban: this.banOf(cp, dp), mute: this.muteOf(cp), nm: a.nr ? a.name : "" }; const mt = this.cfgGet("mnt"), mo = this.cfgGet("moff") || [];
        if (!a.own && mt && mt.on) o.mt = { k: "maint", m: mt.msg || "" }; else if (!a.own && (mo.includes("online") || (url.searchParams.get("md") === "t" && mo.includes("territory")))) o.mt = { k: "off", m: "" }; /* land1: territory rooms follow the territory switch too */ o.evo = this.cfgGet("eoff") || []; o.mu = this.cfgPub().mut; // play2
        if (url.searchParams.get("w")) { const W = this.sdb().exec("SELECT * FROM wal WHERE pid = ?", cp).toArray()[0]; o.w = { own: this.wOwn(cp), lv: W ? lvOf(this.wSx(cp, W)) : 1, o: a.own ? 1 : 0 }; } return J(o); } catch (e) { return J({ err: "server" }, 500); } }
    if (url.pathname === "/s/mu") return J({ mu: this.cfgPub().mut, evo: this.cfgGet("eoff") || [] }); // play2: internal room -> social (weekend rule override)
    if (url.pathname === "/s/earn") { let E = {}; try { E = JSON.parse(await req.text()) || {}; } catch (_) {} try { return J(this.wEarn(E)); } catch (e) { this.serr = (this.serr | 0) + 1; return J({ err: "server" }, 500); } } // internal: room -> social (online coins)
    let B = {}; try { B = JSON.parse((await req.text()).slice(0, S_MAX)) || {}; } catch (_) {}
    const pid = await pidOf(String(B.pk || "")); if (!pid) return J({ err: "pk" }, 400); delete B._v; if (B.op === "snap") return J({ err: "use_a" }); return J(await this.sOp(pid, B));
  }
  async socialWs(req, url) {
    const dp = await pidOf(url.searchParams.get("pk") || ""); if (!dp) return new Response("pk", { status: 400 });
    const pid = this.canon(dp); this.sAcct(pid); const now = Date.now(); // srv2: sockets are tagged with the account's id (pushes reach every signed-in device); dv = devices seen
    try { const ua = String(req.headers.get("user-agent") || ""), uas = (/iPhone|iPad|Android|Macintosh|Windows|Linux|CrOS/.exec(ua) || ["?"])[0] + " " + ((/Edg|Firefox|CriOS|Chrome|Safari/.exec(ua) || [""])[0]);
      this.sdb().exec("INSERT INTO dv (dp, cp, t0, t1, ua) VALUES (?, ?, ?, ?, ?) ON CONFLICT(dp) DO UPDATE SET cp = excluded.cp, t1 = excluded.t1, ua = excluded.ua", dp, pid, now, now, uas.trim().slice(0, 40)); } catch (_) {}
    const old = this.state.getWebSockets(pid); for (let i = 0; i < old.length - 2; i++) try { old[i].close(4009, "replaced"); } catch (_) {} // at most 3 live tabs per player
    if (!this._auto) { this._auto = 1; try { this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}')); } catch (_) {} } // keep-alive pings never wake the object
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair); this.state.acceptWebSocket(server, [pid]);
    server.serializeAttachment({ pid, dp, st: "lobby" });
    try { this.sdb().exec("INSERT OR IGNORE INTO dau (d, pid) VALUES (?, ?)", utcDay(now), pid); this.giftClaim(pid); } catch (_) {} // admin2: daily actives + gifts to all (one claim each)
    const gr = this.sdb().exec("SELECT gid, coins, items FROM gr WHERE pid = ? AND ack = 0 ORDER BY gid LIMIT 20", pid).toArray().map((g) => ({ id: g.gid, c: g.coins, it: JSON.parse(g.items || "[]") }));
    server.send(JSON.stringify({ t: "hi", me: this.sMe(pid), v: VERSION, ban: this.banOf(pid, dp), mute: this.muteOf(pid), acct: this.aView(dp), sv: this.snapSv(pid), gr, w: this.wState(pid), chr: this.chPend(pid), cfg: this.cfgPub() })); // coin1: wallet on connect this.sPresAll(pid);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, data) { // hibernation API: only the social object's sockets come here (game rooms use accept() + listeners)
    let a = null; try { a = ws.deserializeAttachment(); } catch (_) {} if (!a || !a.pid || typeof data !== "string" || data.length > SNAP_MAX + 400 || (data.length > 1200 && data.indexOf('"op":"snap"') < 0 && !(data.length <= S_MAX && /"op":"w_(claims|mig)"/.test(data)))) return; let m; try { m = JSON.parse(data); } catch (_) { return; }
    if (!m || typeof m !== "object") return; delete m._v; m._ws = ws; // srv2: a verified identity can only come from the worker (never from a socket); snapshots may be large
    if (m.t === "st") { const st = m.s === "match" ? "match" : "lobby"; if (a.st !== st) { a.st = st; ws.serializeAttachment(a); this.sPresAll(a.pid); } return; }
    if (m.t === "ping") { try { ws.send('{"t":"pong"}'); } catch (_) {} return; }
    if (m.t === "op") { const r = await this.sOp(a.dp || a.pid, m); try { ws.send(JSON.stringify({ ...r, t: "r", i: m.i | 0 })); } catch (_) {} }
  }
  async webSocketClose(ws) { let a = null; try { a = ws.deserializeAttachment(); } catch (_) {} if (a && a.pid) this.sPresAll(a.pid, ws); try { ws.close(1000); } catch (_) {} }
  async webSocketError(ws) { return this.webSocketClose(ws); }
  // ---------- srv2: matchmaker "mm-v1" (memory only, no storage rows; rooms report again within 30 s if it was evicted) ----------
  async mmHttp(req, url) {
    const R = this.mmR || (this.mmR = new Map()), P = this.mmP || (this.mmP = new Map()), now = Date.now(), op = url.pathname.slice(3);
    if (op === "hb") { let b = {}; try { b = JSON.parse((await req.text()).slice(0, 400)) || {}; } catch (_) {} const n = String(b.room || ""); if (!/^(pub|tp)-[a-z0-9-]{1,20}$/.test(n)) return J({ err: "room" });
      R.set(n, { room: n, br: BRACKETS.includes(b.br) ? b.br : "", i: b.i | 0, h: Math.max(0, b.h | 0), b: Math.max(0, b.b | 0), e: b.e | 0, up: +b.up || now, t: now, pend: 0, md: n.startsWith("tp-") ? "t" : "" });
      if (R.size > 300) for (const [k, v] of R) if (now - v.t > MM_CFG.WARM_MS) R.delete(k); return J({ ok: 1 }); }
    if (op === "list") return J({ rooms: [...R.values()].filter((r) => now - r.t < MM_CFG.WARM_MS && (r.h > 0 || r.e || now - r.t < MM_CFG.WARM_MS)).sort((a, b) => b.h - a.h || a.room.localeCompare(b.room)).map((r) => ({ room: r.room, br: r.br, md: r.md || "", i: r.i, h: r.h, b: r.b, e: r.e, age: Math.round((now - r.t) / 1000), up: Math.round((now - r.up) / 1000), live: now - r.t < MM_CFG.LIVE_MS && r.h > 0 ? 1 : 0 })),
      pickers: [...P.values()].filter((v) => now - v.t < 300000).length, t: now });
    if (op === "pick") {
      const pid = url.searchParams.get("pid") || "", w = +url.searchParams.get("w") || 0, x = url.searchParams.get("x") || "", md = url.searchParams.get("md") === "t" ? "t" : ""; if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400);
      let cp = pid, tr = 0, cq = 0; // the bracket is decided here from the board (the client's own league is never trusted)
      try { const u = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(SOCIAL)).fetch("https://social/s/uid?pid=" + pid + (md ? "&md=t" : ""))).json(); if (u && u.ban) return J({ err: "banned", u: u.ban }); if (u && u.mt) return J({ err: u.mt.k, m: u.mt.m }); if (u && u.cp) cp = u.cp; } catch (_) {}
      try { const b = await (await this.boardStub().fetch("https://board/b/get?pid=" + cp)).json(); tr = b.tr | 0; cq = b.cq | 0; } catch (_) {}
      return J({ ...mmPick(R, P, { pid: cp, br: bracketOf(tr, cq), w, x, now, md }), tr });
    }
    return J({ err: "op" }, 404);
  }
  // land1: a territory round is over. Placement = land share among the snakes still on the map; humans alive now who played at
  // least TROPHY.LIFE_MIN s of this round get their trophies from it (public rooms; same trophyDelta as every online life).
  // land1b: humans who died during the round (played >= LIFE_MIN s) are placed after every survivor, by land % at death (terDied).
  // Then everybody leaves the map at once (cause 7: no corpse food, no kill credit), the grid clears and the next round starts.
  roundEnd() { const S = this.sim, T = this.ter, R = this.trd, now = Date.now(), live = (sl) => { const o = S.byId.get(T.idOf[sl]); return !!(o && o.alive); }, rk = T.top(0).filter(([sl]) => live(sl));
    const nAlive = Math.max(rk.length, S.snakes.filter((o) => o.alive).length); // land1b: survivors = snakes on the map now (a survivor without land shares the last survivor place)
    const D = R.dead || new Map(); for (const c of this.clients) if (c.pid && c.snake && c.snake.alive && c.joined) D.delete(c.pid); // land1b: alive at the end = survivor
    const dl = [...D.values()].sort((a, b) => b.pct - a.pct || a.t - b.t), field = Math.max(2, nAlive + dl.length);
    const rkOf = (sl) => { const i = rk.findIndex((x) => x[0] === sl); return i >= 0 ? i + 1 : nAlive; };
    const top = rk.slice(0, 5).map(([sl, n]) => { const o = S.byId.get(T.idOf[sl]); return [T.idOf[sl], Math.round((n / T.total) * 1000), o ? o.name : ""]; });
    this.bcast(JSON.stringify({ t: "tend", n: R.n, rk: top, f: field }));
    for (const c of this.clients) { const sn = c.snake; if (!c.joined || !sn || !sn.alive) continue; const L = c.life, pct = T.pctOf(sn.id); if (L) L.pk = Math.max(L.pk || 0, pct);
      const inR = c.rd && c.rd.n === R.n, place = Math.max(1, rkOf(sn.ts)), kills = (inR ? c.rd.k : 0) + (sn.kills | 0), life = inR ? (now - c.rd.t0) / 1000 : 0;
      const tro = this.ranked() && c.pid && life >= TROPHY.LIFE_MIN ? 1 : 0; this.send(c, JSON.stringify({ t: "tme", n: R.n, pl: place, f: field, p: Math.round(pct * 10), tr: tro }));
      if (tro) this.terTro(c, { place, field, kills, life, sc: Math.round(Math.max(L ? L.bm : 0, sn.m)) }); }
    dl.forEach((o, k) => { const place = nAlive + 1 + k, c = o.c; // land1b: the dead, below every survivor, by land % at death
      if (this.clients.has(c)) this.send(c, JSON.stringify({ t: "tme", n: R.n, pl: place, f: field, p: Math.round(o.pct * 10), tr: 1, dd: 1 }));
      this.terTro(c, { place, field, kills: o.kills, life: o.life, sc: o.sc }); }); R.dead = null;
    for (const sn of S.snakes) if (sn.alive) { sn.alive = false; sn.diedTick = S.tick; S.evDie.push(sn.id, 0, 7); }
    T.reset(); this.bcast(T.full()); R.n++; R.end = S.tick + Math.round(TER.DUR / TICK); this.refill = 1; this.rounds = (this.rounds | 0) + 1;
    this.bcast(JSON.stringify({ t: "trd", n: R.n, left: TER.DUR })); }
  // land1b: a player who dies during a round does not escape a low placement. Who played >= TROPHY.LIFE_MIN s of the round
  // (first spawn -> this death) is kept per pid with the land % at death (best death of the round); at round end the dead are
  // ranked below every survivor by that %, and get placement trophies from the same table. Alive again at round end = survivor.
  terDied(c, s) { if (!this.ranked() || !c.pid || !c.rd || c.rd.n !== this.trd.n) return; const T = this.ter, life = (Date.now() - c.rd.t0) / 1000; if (life < TROPHY.LIFE_MIN) return;
    const pct = T.slotOf.get(s.id) ? T.pctOf(s.id) : +s._tp || 0, D = this.trd.dead || (this.trd.dead = new Map()), o = D.get(c.pid);
    if (!o || pct >= o.pct) D.set(c.pid, { c, pct, life, kills: c.rd.k | 0, sc: Math.round(Math.max(c.life ? c.life.bm : 0, s.m)), t: Date.now() }); else { o.life = Math.max(o.life, life); o.kills = c.rd.k | 0; o.c = c; } }
  terTro(c, o) { const d = trophyDelta({ place: o.place, field: o.field, kills: o.kills, life: o.life, t: c.tr | 0, online: 1 });
    const body = JSON.stringify({ pid: c.pid, name: c.name, d, kl: o.kills, sc: o.sc, u: c.uid || "" });
    this.boardStub().fetch("https://board/b/rec", { method: "POST", body }).then((r) => r.json()).then((r) => { if (!r || !r.ok) return; c.tr = r.tr; if (c.snake) c.snake.tr = r.tr;
      if (this.clients.has(c)) this.send(c, JSON.stringify({ t: "tro", rd: 1, d: r.d, tr: r.tr, ss: r.ss, pl: o.place, f: o.field, k: o.kills, sc: o.sc, life: Math.round(o.life) })); })
      .catch(() => { if (this.clients.has(c)) this.send(c, JSON.stringify({ t: "tro", rd: 1, err: 1 })); }); }
  foodFull() {
    const S = this.sim, idx = []; for (let i = 0; i < S.FM; i++) if (S.fa[i]) idx.push(i);
    const b = new ArrayBuffer(3 + idx.length * 12), v = new DataView(b); v.setUint8(0, 3); v.setUint16(1, idx.length, true);
    let o = 3; for (const i of idx) { v.setUint16(o, S.fid[i], true); v.setFloat32(o + 2, S.fx[i], true); v.setFloat32(o + 6, S.fy[i], true); v.setUint8(o + 10, Math.min(255, Math.round(S.fv[i] * 10))); v.setUint8(o + 11, S.fc[i]); o += 12; }
    return b;
  }
  loop() {
    const now = Date.now(); this.acc += (now - this.last) / 1000; this.last = now; if (this.acc > 0.25) this.acc = 0.25; // never spiral
    while (this.acc >= TICK) { this.acc -= TICK; try { this.tick(); } catch (e) { this.errs = (this.errs | 0) + 1; this.lastErr = String(e && e.message).slice(0, 100); } } // srv2: errors are counted for the owner's server view
    if (this.clients.size) this.hb(false);
  }
  tick() {
    const S = this.sim;
    if (this.ter && S.tick >= this.trd.end) this.roundEnd(); // land1
    // apply one queued input per human (two when the queue is long, so a laggy burst catches up instead of piling up)
    for (const c of this.clients) {
      const s = c.snake; if (!s || !s.alive) continue;
      // jitter buffer: after a starve, wait until 2 inputs are queued again so network jitter can't starve every other tick
      if (c.buf && c.q.length >= 6) c.buf = false;
      if (c.buf || c.q.length < 3) { c.buf = true; c.extra++; continue; }
      const take = c.q.length >= 18 ? 2 : 1;
      for (let k = 0; k < take; k++) { c.ack = c.q.shift(); c.lastTa = c.q.shift(); c.lastBoost = c.q.shift(); c.extra = 0; s.ta = c.lastTa; s.boost = c.lastBoost; if (k === 0 && take === 2) S.extraMove(s); } // noself1b: catch-up move eats + collides like step
    }
    S.step(() => true);
    // events
    const dead = []; for (let i = 0; i < S.evDie.length; i += 3) dead.push([S.evDie[i], S.evDie[i + 1], S.evDie[i + 2]]);
    for (const id of S.evNew) { const s = S.byId.get(id); if (s && s.alive) this.bcast(JSON.stringify({ t: "sn", ...this.snakeMsg(s) })); }
    if (this.ter) { const T = this.ter; // land1: slot <-> snake map changes at once, cell changes as one delta frame every 2nd tick (15 Hz)
      if (T.evSlot.length) { const l = []; for (let i = 0; i < T.evSlot.length; i += 2) l.push([T.evSlot[i], T.evSlot[i + 1]]); T.evSlot.length = 0; this.bcast(JSON.stringify({ t: "tsl", l })); }
      if (S.tick % 2 === 0) { const b = T.take(); if (b) { this.terB = (this.terB || 0) + b.byteLength; this.bcast(b); } } }
    for (const [id, by, cause] of dead) this.bcast(JSON.stringify({ t: "dead", id, by, cause }));
    if (dead.length) this.btyKill(dead); // play2
    if (dead.length) for (const c of this.clients) if (c.snake && !c.snake.alive && c.life && !c.life.done && dead.some((d) => d[0] === c.snake.id)) this.score(c, c.snake);
    if (S.evPuNew.length) this.bcast(JSON.stringify({ t: "pu+", l: S.evPuNew.map((p) => [p.id, p.k, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) }));
    if (S.evPu.length) { const l = []; for (let i = 0; i < S.evPu.length; i += 3) l.push([S.evPu[i].id, S.evPu[i + 1], S.evPu[i].k, S.evPu[i + 2] || []]); this.bcast(JSON.stringify({ t: "pu-", l })); }
    for (let i = 0; i < S.evShield.length; i += 2) this.bcast(JSON.stringify({ t: "sh", id: S.evShield[i], by: S.evShield[i + 1] }));
    for (const e of S.evEvt) this.bcast(JSON.stringify({ t: "evt", ...e }));
    if (S.evMet.length) this.bcast(JSON.stringify({ t: "met", l: S.evMet.map((M) => [M.id, Math.round(M.x * 100) / 100, Math.round(M.y * 100) / 100, M.r, M.t, M.T]) }));
    // one binary frame shared by everybody: [0]=1 [1..4]=tick [5..6]=ack [7]=extra (255 = no snake) [8..23]=own x,y,a,av [24]=count, then snakes, eats, spawns
    const alive = S.snakes.filter((s) => s.alive), ne = S.evEat.length / 2, ns = S.evSpawn.length;
    const size = 25 + alive.length * 13 + 2 + ne * 4 + 2 + ns * 12, b = new ArrayBuffer(size), v = new DataView(b);
    v.setUint8(0, 1); v.setUint32(1, S.tick, true);
    let o = 25; v.setUint8(24, alive.length);
    for (const s of alive) { v.setUint16(o, s.id, true); v.setFloat32(o + 2, s.x, true); v.setFloat32(o + 6, s.y, true); v.setUint16(o + 10, Math.min(65535, Math.round(s.m)), true); v.setUint8(o + 12, (s.boosting ? 1 : 0) | (s.bot ? 2 : 0)); o += 13; }
    v.setUint16(o, ne, true); o += 2; for (let i = 0; i < S.evEat.length; i += 2) { v.setUint16(o, S.fid[S.evEat[i]], true); v.setUint16(o + 2, S.evEat[i + 1], true); o += 4; }
    v.setUint16(o, ns, true); o += 2; for (const i of S.evSpawn) { v.setUint16(o, S.fid[i], true); v.setFloat32(o + 2, S.fx[i], true); v.setFloat32(o + 6, S.fy[i], true); v.setUint8(o + 10, Math.min(255, Math.round(S.fv[i] * 10))); v.setUint8(o + 11, S.fc[i]); o += 12; }
    const u8 = new Uint8Array(b);
    for (const c of this.clients) {
      if (!c.joined) continue; const s = c.snake;
      v.setUint16(5, c.ack, true); v.setUint8(7, Math.min(255, c.extra));
      if (s && s.alive) { v.setFloat32(8, s.x, true); v.setFloat32(12, s.y, true); v.setFloat32(16, s.a, true); v.setFloat32(20, s.av, true); v.setUint8(7, Math.min(254, c.extra)); }
      else { v.setFloat32(8, 0, true); v.setFloat32(12, 0, true); v.setFloat32(16, 0, true); v.setFloat32(20, 0, true); v.setUint8(7, 255); }
      this.send(c, u8.slice().buffer);
    }
    S.drain();
    // corpses leave the sim, bots respawn to keep the room lively
    for (const [id] of dead) { const s = S.byId.get(id); if (s) S.removeSnake(s); }
    if (this.refill) { this.refill = 0; this.fill(); } // land1: a new territory round fills the map at once
    if (S.tick % 30 === 0) {
      this.fill();
      const srt = alive.slice().sort((a, b2) => b2.m - a.m), lb = srt.slice(0, 10).map((s) => [s.id, Math.round(s.m), s.kills]);
      for (const c of this.clients) { const L = c.life, s = c.snake; if (!L || L.done || !s || !s.alive) continue; const r = srt.indexOf(s) + 1; if (r > 0 && r < L.best) L.best = r; if (srt.length > L.field) L.field = srt.length; if (s.m > L.bm) L.bm = s.m; if (this.ter) L.pk = Math.max(L.pk || 0, this.ter.pctOf(s.id)); }
      this.btyTrack(srt[0], Date.now()); this.mutTick(Date.now()); // play2
      this.bcast(JSON.stringify({ t: "lb", lb, humans: [...this.clients].filter((c) => c.joined).length, bt: this.btyMsg(), ...(this.ter ? { rl: this.terLeft(), rn: this.trd.n } : {}) }));
    }
  }
}
