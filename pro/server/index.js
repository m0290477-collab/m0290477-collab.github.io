// super-snake-online — Cloudflare Worker + Durable Object (one DO per room). No database, no payments, nothing stored.
// The room runs the SAME sim.js as the client at 30 Hz and is authoritative for movement, food, mass, collisions and kills.
// Clients predict their own snake (input seq/ack reconciliation) and interpolate everyone else.
import { periodId, Sim, C, moveSnake, sanitizeSkin, cleanName, BOT_NAMES, pickBotName, TROPHY, trophyDelta, seasonCarry, seasonId, weekId, prevPeriodId, botTrophies, filterText, idKind, idPrice, ID_PRICES, SPECIAL_REP, SPECIAL_SEQ, MSG_MAX, CHAT_KEEP } from "./sim.js";
import { DAY, LOGIN, LOGIN_NOCOS, SPIN, SPIN_NOCOS, spinPick, RANDOM_COS, SEASON, seasonReward, UNLOCKS, ACH_COINS, levelCoins, bonusCoins, dailyMissions, weeklyCoins, WC_REWARD, DAILY_MODE_BONUS,
  leagueSeasonReward, CONQ_REWARD, rankReward, mileReward, CONTESTS, matchCoins, plausible, OFF, ONLINE, catItem, validKey, offerCandidates } from "./econ.js"; // coin1: shared economy tables

const TICK = 1 / 30, MAX_HUMANS = 12, TARGET_SNAKES = 30, VERSION = 7; // v7 (coin1): server wallet (balance, owned items, purchases, idempotent claims, room-paid online coins). v6 v6 (srv2): accounts (device -> account link, Google / Apple / email sign-in, versioned profile snapshots), owner admin (id 1), bans / mutes, matchmaker "mm-v1" (skill brackets, warm rooms) · v5 (srv1): social object "social-v1" (public ids, special ids, friends, chat, invites, live /sws), snake "u" = public id, skins carry "gt" · v4 (comp1): server-decided trophies ("tro"), snake league "tr", board DO "board-v1" (leaderboards, contests, seasons) · v2: power-ups (pus / pu+ / pu- / sh) · v3: 11 power-ups, arena events (evt / met), emotes (emo), avatars in skins
const ORIGINS = [/^https:\/\/(www\.)?billke\.com$/, /^https:\/\/m0290477-collab\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// look1: bots never share a look with any live snake (players included)
const uniqSkin = (snakes, i) => { const used = new Set(); for (const o of snakes) if (o.alive && o.skin) used.add(o.skin.k + ":" + o.skin.i); for (let k = 0; k < 60; k++) { const c = BOT_SKINS(i + k * 5); if (!used.has(c.k + ":" + c.i)) return c; } return BOT_SKINS(i); };
const BOT_SKINS = (i) => ({ k: i % 3 === 0 ? "flag" : "skin", i: i % 3 === 0 ? (i * 37) % 197 : i % 24, e: i % 4, t: 0, n: 0, av: i % 3 === 0 ? "f" + ((i * 37) % 197) : "p" + ((i * 7) % 24), fr: i % 5 === 0 ? 0 : 1 + (i % 4) });
const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
const SOCIAL = "social-v1"; // srv1: the one social object (same Room class, SQLite-backed; no new migration)
const OWNER_H = "f7fbde3c1fea505ba93f50420658e738b482e0fd55dea9bf270829ecb8d0fa78"; // srv1: SHA-256 of the one-time founder claim code (id 1); the code itself is not in any file that ships
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
const SNAP_MAX = 64000, WARM_TICKS = 6, WARM_MASS = [24, 60, 140, 32, 220, 90, 420, 48, 170, 700, 36, 260, 110, 30, 520, 75, 1100, 40, 190, 330, 28, 130, 900, 55, 240, 26, 380, 66, 150, 1500]; // one profile snapshot (JSON text)
export const LV_MAX = 100, xpNeed = (n) => Math.round(100 * n ** 1.6); // same curve as js/store.js
export function lvOf(xp) { let n = 1, x = +xp || 0, need = xpNeed(1); while (n < LV_MAX && x >= need) { x -= need; n++; need = xpNeed(n); } return n; }
// what a snapshot may gain between two saves without a server grant (coins / xp). Anything above is cut back and counted.
export const allowance = (mins) => ({ coins: Math.round(4000 + 250 * Math.min(mins, 2880)), xp: Math.round(30000 + 3000 * Math.min(mins, 2880)) });
// ---------- coin1: wallet rules ----------
// migration: the device balance is imported ONCE, capped: the founder up to 10M; an account with a server snapshot up to that
// snapshot's coins + the srv2 allowance for the time since it was saved; everyone else up to 200,000. Cuts are logged.
export const MIG = { FIRST: 200000, OWNER: 10000000, ITEMS: 800, CKS: 600 };
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
export function mmPick(R, P, { pid, br, w = 0, x = "", now = Date.now() }) {
  P.set(pid, { br, t: now }); if (P.size > 5000) for (const [k, v] of P) if (now - v.t > 120000) P.delete(k);
  const rooms = [...R.values()], live = (r) => now - r.t < MM_CFG.LIVE_MS, cap = (r) => r.h + (r.pend || 0) < MM_CFG.MAX && r.room !== x;
  const withP = (b) => rooms.filter((r) => r.br === b && live(r) && r.h > 0 && cap(r)).sort((a, c) => c.h - a.h || a.i - c.i);
  const out = (r, fb, why) => { r.pend = (r.pend || 0) + 1; return { room: r.room, br: r.br, i: r.i, h: r.h, b: r.b, fb: fb || "", why, my: br }; };
  const own = withP(br); if (own.length) return out(own[0], "", "match");
  const pop = [...P.entries()].filter(([k, v]) => k !== pid && v.br === br && now - v.t < 120000).length, bi = BRACKETS.indexOf(br);
  const nb = [bi - 1, bi + 1].filter((i) => i >= 0 && i < BRACKETS.length).map((i) => BRACKETS[i]);
  if (w >= MM_CFG.WAIT || pop < MM_CFG.LOW) { const c = nb.flatMap(withP).sort((a, b2) => b2.h - a.h); if (c.length) return out(c[0], c[0].br, w >= MM_CFG.WAIT ? "wait" : "low"); }
  else return { hold: 1, br, wait: 2500, my: br };
  const warm = rooms.filter((r) => r.br === br && now - r.t < MM_CFG.WARM_MS && cap(r)).sort((a, c) => c.t - a.t)[0]; if (warm) return out(warm, "", "warm");
  for (let i = 1; i <= 60; i++) { const n = "pub-" + br + "-" + i; let r = R.get(n); if (r && !cap(r)) continue; if (!r) { r = { room: n, br, i, h: 0, b: TARGET_SNAKES, t: now, pend: 0, up: now }; R.set(n, r); } return out(r, "", "new"); }
  return { room: "pub-" + br + "-1", br, i: 1, h: 0, b: 0, fb: "", why: "overflow", my: br };
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
      return env.ROOMS.get(env.ROOMS.idFromName(MM)).fetch(new Request("https://mm/m/pick?pid=" + pid + "&w=" + (Math.max(0, Math.min(60000, +url.searchParams.get("w") || 0)) | 0) + "&x=" + encodeURIComponent((url.searchParams.get("x") || "").slice(0, 24))));
    }
    return new Response("Super Snake online server", { headers: { "content-type": "text/plain" } });
  },
};

export class Room {
  constructor(state, env) { this.state = state; this.env = env; this.clients = new Set(); this.sim = null; this.timer = null; this.botSeq = 0; }
  init(params) {
    this.noBots = params.get("bots") === "0" && !(params.get("name_room") || "").startsWith("pub-");
    this.room = params.get("name_room") || "pub-1"; const mb = /^pub-(bs|gp|dc|cq)-(\d{1,2})$/.exec(this.room); this.br = mb ? mb[1] : ""; this.bi = mb ? +mb[2] : 0; // srv2: bracket room
    this.sim = new Sim({ dt: TICK, seed: (Date.now() & 0xffffff) ^ 0x5eed, netMode: true, powerups: true, events: true, evtFirst: 35 });
    this.sim.diff = 1; this.errs = this.errs || 0; this.t0 = Date.now();
    this.fill(true); for (let k = 0; k < WARM_TICKS; k++) this.sim.step(() => true); this.sim.drain(); for (const d of this.sim.snakes.filter((x) => !x.alive)) this.sim.removeSnake(d); this.fill(); // srv2 warm start: a world already in progress
    this.last = Date.now(); this.acc = 0;
  }
  fill(warm) {
    if (this.noBots) return;
    const alive = this.sim.snakes.filter((s) => s.alive).length; let want = TARGET_SNAKES - alive;
    // srv2: a fresh public room starts mid-game: bots spawn at mixed sizes (same rules as every other snake), later refills start small
    while (want-- > 0) { const i = this.botSeq++; const m = warm && !this.noBots ? WARM_MASS[i % WARM_MASS.length] : undefined; const b = this.sim.addSnake(pickBotName(this.sim.snakes, i), uniqSkin(this.sim.snakes, i), { bot: true, diff: [1, 1, 2, 2, 3][i % 5], m }); if (b) b.tr = botTrophies(i); }
  }
  // srv2: the room tells the matchmaker who is here (on join / leave and every 30 s while players are in). No alarms: an empty room costs nothing.
  hb(force) { const now = Date.now(); if (!this.room.startsWith("pub-") || (!force && now - (this.hbT || 0) < MM_CFG.HB_MS)) return; this.hbT = now;
    const h = [...this.clients].filter((c) => c.joined).length, b = this.sim ? this.sim.snakes.filter((s) => s.alive && s.bot).length : 0;
    const body = JSON.stringify({ room: this.room, br: this.br, i: this.bi, h, b, e: this.errs | 0, up: this.t0 || now });
    try { const r = this.env.ROOMS.get(this.env.ROOMS.idFromName(MM)).fetch("https://mm/m/hb", { method: "POST", body }); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/b/")) return this.board(req, url); // comp1: this instance is the board object
    if (url.pathname.startsWith("/s/") || url.pathname === "/sws" || url.pathname === "/a/op") this.maint(); // srv2: owner maintenance set at deploy time (never via a request)
    if (url.pathname.startsWith("/s/")) return this.socialHttp(req, url); // srv1: this instance is the social object
    if (url.pathname === "/sws") return this.socialWs(req, url);
    if (url.pathname === "/a/op") return this.acctHttp(req); // srv2: accounts (only the worker builds this request)
    if (url.pathname.startsWith("/m/")) return this.mmHttp(req, url); // srv2: this instance is the matchmaker
    // srv2: a room kept in memory while empty resumes where it was; after WARM_MS it starts a fresh warm world
    if (this.sim && !this.clients.size && this.idleAt && Date.now() - this.idleAt > MM_CFG.WARM_MS) this.sim = null;
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
      if (!c.pidP && typeof m.pk === "string") c.pidP = pidOf(m.pk).then(async (dp) => { if (!dp) return; c.dp = dp; const u = await this.uidOf(c); c.pid = (u && u.cp) || dp; if (!this.clients.has(c) || c.banned) return; if (!this.ranked()) return; try { const r = await (await this.boardStub().fetch("https://board/b/get?pid=" + c.pid)).json(); if (r && Number.isFinite(r.tr)) { c.tr = r.tr; if (c.snake) c.snake.tr = r.tr; this.send(c, JSON.stringify({ t: "tro0", tr: r.tr, ss: r.ss })); } } catch (_) {} });
      const hs = [...this.clients].filter((o) => o.joined).length;
      this.send(c, JSON.stringify({ t: "welcome", v: VERSION, room: this.room, br: this.br, bi: this.bi, h: hs, b: this.sim.snakes.filter((s) => s.alive && s.bot).length, tick: this.sim.tick, dt: TICK, R: this.sim.R, snakes: this.sim.snakes.filter((s) => s.alive).map((s) => this.snakeMsg(s)) }));
      this.hb(true);
      this.send(c, this.foodFull());
      this.send(c, JSON.stringify({ t: "pus", l: this.sim.pus.map((p) => [p.id, p.k, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) }));
      const E = this.sim.evt; if (E) this.send(c, JSON.stringify({ t: "evt", k: E.k, ph: "start", id: E.id || 0, d: Math.max(1, Math.round(E.t)), late: 1 }));
      if (this.sim.mets.length) this.send(c, JSON.stringify({ t: "met", l: this.sim.mets.map((M) => [M.id, Math.round(M.x * 100) / 100, Math.round(M.y * 100) / 100, M.r, +M.t.toFixed(2), M.T]) }));
    } else if (m.t === "spawn") {
      if (!c.joined || c.banned || (c.snake && c.snake.alive)) return;
      if (c.snake) this.sim.removeSnake(c.snake);
      if (typeof m.name === "string") c.name = cleanName(m.name); if (m.skin) c.skin = sanitizeSkin(m.skin);
      // a human replaces one bot so rooms stay the same size
      const bot = this.sim.snakes.find((s) => s.bot && s.alive); if (bot && !this.noBots) { bot.alive = false; this.sim.evDie.push(bot.id, 0, 5); }
      const s = this.sim.addSnake(c.name, c.skin, {}); c.snake = s; if (c.uid) s.uid = c.uid; c.q.length = 0; c.ack = 0xffff; c.extra = 0;
      s.tr = c.tr; c.life = { t0: Date.now(), best: 99, field: this.sim.snakes.filter((o) => o.alive).length, bm: s.m, done: false }; // comp1: what this life is judged on
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
  uidOf(c) { return this.env.ROOMS.get(this.env.ROOMS.idFromName(SOCIAL)).fetch("https://social/s/uid?pid=" + c.dp).then((r) => r.json()).then((r) => { if (!r || !/^\d{1,7}$/.test(r.id || "")) return r;
    if (r.ban) { c.banned = 1; this.send(c, JSON.stringify({ t: "ban", u: r.ban })); if (c.snake && c.snake.alive) this.sim.kill(c.snake, 0, 4); try { c.ws.close(4003, "banned"); } catch (_) {} return r; }
    c.mute = r.mute || 0; c.uid = r.id; if (r.nm) { c.name = cleanName(r.nm); if (c.snake) c.snake.name = c.name; }
    const s = c.snake; if (s && s.alive && s.uid !== r.id) { s.uid = r.id; this.bcast(JSON.stringify({ t: "uid", id: s.id, u: r.id })); } this.send(c, JSON.stringify({ t: "myid", u: r.id })); return r; }).catch(() => null); }
  // ---------- comp1: trophies (server-decided), board object (leaderboards, weekly/monthly contests, monthly seasons) ----------
  ranked() { return this.room.startsWith("pub-") && !this.noBots; } // private rooms never move trophies (no farming with friends)
  boardStub() { return this.env.ROOMS.get(this.env.ROOMS.idFromName(BOARD)); }
  score(c, s) { // one finished life of a human -> trophies, judged only on what this server saw
    const L = c.life; if (!L || L.done) return; L.done = true; if (c.pid && !this.noBots) this.earn(c, s, L); if (!c.pid || !this.ranked()) return;
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
  earn(c, s, L) { const body = JSON.stringify({ pid: c.pid, ck: ("on:" + this.room + ":" + (this.t0 || 0) + ":" + s.id + ":" + L.t0).slice(0, 93), best: Math.round(Math.max(L.bm, s.m)), kills: s.kills | 0, dur: Math.round((Date.now() - L.t0) / 1000) });
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
    q.exec("INSERT OR IGNORE INTO ids (num, pid, kind, t) VALUES ('1', '', 'o', 0)"); // id 1 is reserved for the founder: never assigned at random, only by the one-time claim
    return q;
  }
  srow(pid) { return this.sdb().exec("SELECT * FROM acct WHERE pid = ?", pid).toArray()[0] || null; }
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
  sLimit(pid, k, n, win = 60000) { const now = Date.now(), key = pid + "|" + k; let e = this.rl.get(key); if (!e || now - e.t > win) { e = { t: now, n: 0 }; this.rl.set(key, e); } if (this.rl.size > 20000) this.rl.clear(); return ++e.n > n; }
  sBlocked(a, b) { return this.sdb().exec("SELECT a FROM bl WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", a, b, b, a).toArray().length > 0; }
  static cv(a, b) { return a < b ? a + ":" + b : b + ":" + a; }
  sop(pid, m) {
    const q = this.sdb(), now = Date.now(), op = String(m.op || ""); if (this.sLimit(pid, "*", 240)) return { err: "rate" };
    const me = this.sAcct(pid); const other = () => { const o = this.sPid(m.id); return o && o !== pid ? o : ""; };
    if (op === "hello") { // profile summary for friend lists + cards (name filtered like chat)
      const nm = filterText(cleanName(m.n)).t.slice(0, 16) || "Guest", av = typeof m.av === "string" && /^(p([0-9]|1[0-9]|2[0-3])|f\d{1,3})$/.test(m.av) ? m.av : "p0";
      const keep = me.nr && (nm === me.nro || nm === me.name); // srv2: after an owner name reset the old name is refused; the server name stands until the player picks a new one
      q.exec("UPDATE acct SET name = ?, av = ?, fr = ?, lv = ?, seen = ?, nr = ? WHERE pid = ?", keep ? me.name : nm, av, Math.max(0, Math.min(17, m.fr | 0)), Math.max(1, Math.min(100, m.lv | 0)), now, keep ? 1 : 0, pid); this.sVis(pid);
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
    const o = { bal: r.bal, mig: r.mig ? 1 : 0, ld: r.ld || "", ln: r.ln, sd: r.sd || "", bd: r.bd || "", lvm: r.lvm | 0 }; if (full) o.own = this.wOwn(cp); return o; }
  wHas(cp, it) { return this.sdb().exec("SELECT it FROM own WHERE pid = ? AND it = ?", cp, it).toArray().length > 0; }
  wGive(cp, it, src) { this.sdb().exec("INSERT OR IGNORE INTO own (pid, it, src, t) VALUES (?, ?, ?, ?)", cp, it, src, Date.now()); }
  wLed(cp, k, d, ref, note) { const q = this.sdb(), b = q.exec("SELECT bal FROM wal WHERE pid = ?", cp).one(); q.exec("INSERT INTO led (pid, k, d, bal, ref, note, t) VALUES (?, ?, ?, ?, ?, ?, ?)", cp, k, d, b ? b.bal : 0, String(ref || "").slice(0, 90), note ? JSON.stringify(note).slice(0, 300) : null, Date.now()); }
  wAdd(cp, d, k, ref, note) { if (d) this.sdb().exec("UPDATE wal SET bal = bal + ? WHERE pid = ?", d, cp); this.wLed(cp, k, d, ref, note); }
  // the only way coins leave a wallet: one conditional update (balance >= price) in the same synchronous step as the check
  wPay(cp, price, k, ref) { const q = this.sdb(), r = q.exec("SELECT bal FROM wal WHERE pid = ?", cp).one(); if (!r || r.bal < price) return false; q.exec("UPDATE wal SET bal = bal - ? WHERE pid = ? AND bal >= ?", price, cp, price); this.wLed(cp, k, -price, ref); return true; }
  wClaimed(cp, ck) { return this.sdb().exec("SELECT ck FROM clm WHERE pid = ? AND ck = ?", cp, ck).toArray().length > 0; }
  wMark(cp, ck) { this.sdb().exec("INSERT OR IGNORE INTO clm (pid, ck, t) VALUES (?, ?, ?)", cp, ck, Date.now()); }
  // first connect of an updated game: the device's balance + items come in once (capped, logged); afterwards the device only shows
  wMig(cp, m) {
    const q = this.sdb(), now = Date.now(), W = this.wRow(cp); if (W.mig) return { err: "done", w: this.wState(cp) };
    const dev = Math.max(0, Math.min(1e9, Math.floor(+m.coins || 0))), me = this.srow(cp), sn = q.exec("SELECT coins, t FROM snp WHERE pid = ?", cp).toArray()[0];
    const rule = me && me.own ? "owner" : sn ? "snapshot" : "first", cap = rule === "owner" ? MIG.OWNER : rule === "snapshot" ? sn.coins + allowance((now - sn.t) / 60000).coins : MIG.FIRST;
    const imp = Math.min(dev, cap), pend = q.exec("SELECT COALESCE(SUM(coins), 0) AS n FROM gr WHERE pid = ? AND (w = 0 OR w IS NULL) AND ack = 0", cp).one().n | 0; // owner grants this device never applied
    let items = 0; for (const it of (Array.isArray(m.own) ? m.own : []).slice(0, MIG.ITEMS)) { const k = String(it); if (!validKey(k)) continue;
      if (k.startsWith("sid:") && !q.exec("SELECT num FROM ids WHERE num = ? AND pid = ? AND kind = 'p'", k.slice(4), cp).toArray().length) continue; this.wGive(cp, k, "mig"); items++; }
    for (const r of q.exec("SELECT num FROM ids WHERE pid = ? AND kind = 'p'", cp).toArray()) this.wGive(cp, "sid:" + r.num, "id");
    let cks = 0; for (const c of (Array.isArray(m.ck) ? m.ck : []).slice(0, MIG.CKS)) { const k = String(c); if (CK_RE.test(k)) { this.wMark(cp, k); cks++; } } // rewards this device already paid itself
    const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "");
    q.exec("UPDATE wal SET bal = bal + ?, mig = 1, lvm = ?, ld = ?, ln = ?, sd = ?, bd = ?, mat = ?, cuts = cuts + ?, t = ? WHERE pid = ?", imp + pend, Math.max(1, Math.min(100, m.lv | 0)), day(m.ld), Math.max(-1, Math.min(6, m.ln | 0)), day(m.sd), day(m.bd), now - 3600000, dev > imp ? 1 : 0, now, cp); // mat: a match that began up to 1 h before the import (still running) can be claimed
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
      const P = plausible(a), td = utcDay(at), used = W.fd === td ? W.fe | 0 : 0, start = at - Math.min(OFF.MAX_S, Math.max(0, +a.dur || 0)) * 1000; let cut = P.cut.slice(); c = P.c;
      if (start < (Number(W.mat) || 0) - 30000) { c = 0; cut.push("overlap"); } if (c > OFF.PER_DAY - used) { c = Math.max(0, OFF.PER_DAY - used); cut.push("day"); }
      set = ["mat = MAX(mat, ?), fd = ?, fe = ?", at, td, used + c]; if (cut.length) note = { cut, full: P.full, got: c }; }
    else return { ck, err: "kind" };
    if (set) q.exec("UPDATE wal SET " + set[0] + " WHERE pid = ?", ...set.slice(1), cp);
    if (note) q.exec("UPDATE wal SET cuts = cuts + 1 WHERE pid = ?", cp);
    for (const it of give) this.wGive(cp, it, k); this.wMark(cp, ck); this.wAdd(cp, c, note ? "cut" : k, ck, note);
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
      q.exec("UPDATE wal SET sd = ? WHERE pid = ?", d, cp); this.wMark(cp, ck); this.wAdd(cp, c, "spin", ck);
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
    let c = Math.min(ONLINE.PER_LIFE, matchCoins({ mode: "online", diff: 1, best: Math.max(0, Math.min(1e6, +B.best || 0)), kills: Math.max(0, Math.min(60, B.kills | 0)), dur: Math.max(0, Math.min(7200, +B.dur || 0)) }));
    const td = utcDay(now), used = W.od === td ? W.oe | 0 : 0; let note = null; if (c > ONLINE.PER_DAY - used) { note = { cut: ["day"], full: c }; c = Math.max(0, ONLINE.PER_DAY - used); }
    q.exec("UPDATE wal SET od = ?, oe = ? WHERE pid = ?", td, used + c, cp); this.wMark(cp, ck); this.wAdd(cp, c, "online", ck, note);
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
    if (Wl && Wl.mig) { if (coins !== Wl.bal) adj = { coins: Wl.bal }; coins = Wl.bal; } else if (coins > bc + al.coins) { coins = bc + al.coins; adj = { coins }; sus++; } if (xp > bx + al.xp) { xp = bx + al.xp; adj = { ...(adj || {}), xp }; sus++; }
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
        ban: bn || null, mute: mu || null, grants: q.exec("SELECT gid, coins, items, why, t, ack FROM gr WHERE pid = ? ORDER BY gid DESC LIMIT 10", t).toArray(), friends: q.exec("SELECT COUNT(*) AS n FROM fr WHERE a = ?", t).one().n, prem: this.sMe(t).prem,
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
    if (why.length < 3) return { err: "reason" }; // every action below needs a reason and goes into the audit log
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
    if (op === "a_del") { this.purge(t); log("delete", tid, { name: tr.name }); return { ok: 1 }; }
    return { err: "op" };
  }
  async socialHttp(req, url) {
    if (url.pathname === "/s/uid") { const dp = url.searchParams.get("pid") || ""; if (!/^[0-9a-f]{20}$/.test(dp)) return J({ err: "pid" }, 400); // internal: room / matchmaker -> social
      try { const cp = this.canon(dp), a = this.sAcct(cp); return J({ id: a.vis, cp, ban: this.banOf(cp, dp), mute: this.muteOf(cp), nm: a.nr ? a.name : "" }); } catch (e) { return J({ err: "server" }, 500); } }
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
    const gr = this.sdb().exec("SELECT gid, coins, items FROM gr WHERE pid = ? AND ack = 0 ORDER BY gid LIMIT 20", pid).toArray().map((g) => ({ id: g.gid, c: g.coins, it: JSON.parse(g.items || "[]") }));
    server.send(JSON.stringify({ t: "hi", me: this.sMe(pid), v: VERSION, ban: this.banOf(pid, dp), mute: this.muteOf(pid), acct: this.aView(dp), sv: this.snapSv(pid), gr, w: this.wState(pid) })); // coin1: wallet on connect this.sPresAll(pid);
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
    if (op === "hb") { let b = {}; try { b = JSON.parse((await req.text()).slice(0, 400)) || {}; } catch (_) {} const n = String(b.room || ""); if (!/^pub-[a-z0-9-]{1,20}$/.test(n)) return J({ err: "room" });
      R.set(n, { room: n, br: BRACKETS.includes(b.br) ? b.br : "", i: b.i | 0, h: Math.max(0, b.h | 0), b: Math.max(0, b.b | 0), e: b.e | 0, up: +b.up || now, t: now, pend: 0 });
      if (R.size > 300) for (const [k, v] of R) if (now - v.t > MM_CFG.WARM_MS) R.delete(k); return J({ ok: 1 }); }
    if (op === "list") return J({ rooms: [...R.values()].filter((r) => now - r.t < MM_CFG.WARM_MS && (r.h > 0 || r.e || now - r.t < MM_CFG.WARM_MS)).sort((a, b) => b.h - a.h || a.room.localeCompare(b.room)).map((r) => ({ room: r.room, br: r.br, i: r.i, h: r.h, b: r.b, e: r.e, age: Math.round((now - r.t) / 1000), up: Math.round((now - r.up) / 1000), live: now - r.t < MM_CFG.LIVE_MS && r.h > 0 ? 1 : 0 })),
      pickers: [...P.values()].filter((v) => now - v.t < 300000).length, t: now });
    if (op === "pick") {
      const pid = url.searchParams.get("pid") || "", w = +url.searchParams.get("w") || 0, x = url.searchParams.get("x") || ""; if (!/^[0-9a-f]{20}$/.test(pid)) return J({ err: "pid" }, 400);
      let cp = pid, tr = 0, cq = 0; // the bracket is decided here from the board (the client's own league is never trusted)
      try { const u = await (await this.env.ROOMS.get(this.env.ROOMS.idFromName(SOCIAL)).fetch("https://social/s/uid?pid=" + pid)).json(); if (u && u.ban) return J({ err: "banned", u: u.ban }); if (u && u.cp) cp = u.cp; } catch (_) {}
      try { const b = await (await this.boardStub().fetch("https://board/b/get?pid=" + cp)).json(); tr = b.tr | 0; cq = b.cq | 0; } catch (_) {}
      return J({ ...mmPick(R, P, { pid: cp, br: bracketOf(tr, cq), w, x, now }), tr });
    }
    return J({ err: "op" }, 404);
  }
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
    for (const [id, by, cause] of dead) this.bcast(JSON.stringify({ t: "dead", id, by, cause }));
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
    if (S.tick % 30 === 0) {
      this.fill();
      const srt = alive.slice().sort((a, b2) => b2.m - a.m), lb = srt.slice(0, 10).map((s) => [s.id, Math.round(s.m), s.kills]);
      for (const c of this.clients) { const L = c.life, s = c.snake; if (!L || L.done || !s || !s.alive) continue; const r = srt.indexOf(s) + 1; if (r > 0 && r < L.best) L.best = r; if (srt.length > L.field) L.field = srt.length; if (s.m > L.bm) L.bm = s.m; }
      this.bcast(JSON.stringify({ t: "lb", lb, humans: [...this.clients].filter((c) => c.joined).length }));
    }
  }
}
