// Storage, local accounts, safe migration from the day-1 game, profile, progression, missions, achievements, stats.
// Pro keys are prefixed "ssp-". The day-1 keys ("ss-acc", "ss-lang") are only ever READ, never written, so the root game is untouched.
import { FLAGS, OLD_FLAG0, SKINS, EYES, TRAILS, FLAG_PRICE, GTRAILS, gtIndex, FUSION_FEE, setFusionFee, fusable, fuKey } from "./skins.js?v=layoutfix";
// coin1: season pass + chains + mission / achievement tables live in econ.js (shared with the worker, which prices every reward)
import { SEASON, seasonReward, CHAINS, dailyMissions, ACH_COINS, levelCoins, UNLOCKS, bonusCoins, weeklyCoins } from "./econ.js?v=layoutfix";
import { walletInit, claim, buy as wBuy, buySid, spin as wSpin, migrated, fuse as wFuse } from "./wallet.js?v=layoutfix";
export { SEASON, seasonReward, CHAINS };
const isoWeek = () => { const d = new Date(); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + "-W" + Math.ceil(((t - y0) / 86400000 + 1) / 7); };
import { WORLDS } from "./worlds.js?v=layoutfix";
import { FRAMES, TITLES } from "./profile.js?v=layoutfix";

export const KV = (() => {
  const mem = new Map(); let ls = null; let full = false;
  try { const s = window.localStorage, k = "ssp-probe"; s.setItem(k, "1"); s.removeItem(k); ls = s; } catch (_) {}
  return {
    ok: !!ls, get full() { return full; },
    get(k) { if (mem.has(k)) return mem.get(k); if (ls) try { return ls.getItem(k); } catch (_) {} return null; },
    set(k, v) { v = String(v); mem.set(k, v); if (!ls) return false; try { ls.setItem(k, v); full = false; return true; } catch (_) { full = true; return false; } },
    del(k) { mem.delete(k); if (ls) try { ls.removeItem(k); } catch (_) {} },
  };
})();
// prototype-pollution-safe JSON
export const jparse = (s) => { try { return JSON.parse(s, (k, v) => (k === "__proto__" || k === "constructor" || k === "prototype" ? undefined : v)); } catch (_) { return null; } };

// ---------- guardian (perf2): error log, economy checksum, last-known-good backups ----------
// local error ring buffer (no external service): [{t, k, m}], newest last, max 30
export function logErr(k, m) { try { const L = jparse(KV.get("ssp-errlog") || "[]"); const a = Array.isArray(L) ? L : []; a.push({ t: Date.now(), k: String(k).slice(0, 24), m: String(m && m.message ? m.message : m).slice(0, 200) }); while (a.length > 30) a.shift(); KV.set("ssp-errlog", JSON.stringify(a)); } catch (_) {} }
// tamper check for the economy fields. A local game cannot be made cheat-proof (the code is on the device); this only
// catches hand-edited saves, which are then restored from the last-known-good backup instead of being trusted.
export function readErrLog() { const L = jparse(KV.get("ssp-errlog") || "[]"); return Array.isArray(L) ? L : []; }
const ECON_K = "ssp-econ-v1";
export function econSum(p) { const srt = (a) => (Array.isArray(a) ? a.slice().sort().join(",") : ""); const str = ECON_K + "|" + (+p.coins || 0) + "|" + (+p.xp || 0) + "|" + srt(p.owned) + "|" + srt(p.flags) + "|" + srt(p.cos) + "|" + ((p.season && +p.season.xp) || 0) + compSig(p);
  let h = 0x811c9dc5, g = 0x01000193; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h = Math.imul(h ^ c, 16777619) >>> 0; g = (Math.imul(g, 31) + c + (h >>> 7)) >>> 0; } return h.toString(36) + g.toString(36); }
const ECON = ["coins", "xp", "owned", "flags", "cos", "season", "lg", "cx", "rc"];
// comp1: trophies / contest progress / claimed reward keys join the checksum, but only once they hold something, so a save
// written by an older build (no such fields) still verifies unchanged
function compSig(p) { const L = p.lg, X = p.cx, R = p.rc; const has = (L && (L.on || L.off || L.pk || L.dg)) || (Array.isArray(R) && R.length) || (X && X.w);
  if (!has) return ""; const x = X || {}; return "|lg:" + (+L.on || 0) + "," + (+L.off || 0) + "," + (+L.pk || 0) + "," + (+L.dg || 0) + "," + (L.ss || "") + "," + (L.day || "") + "|cx:" + [x.w, x.wtr, x.wkl, x.wsc, x.m, x.mtr, x.mkl, x.msc].join(",") + "|rc:" + (Array.isArray(R) ? R.slice().sort().join(",") : ""); }
const sane = (p) => p && typeof p === "object" && Number.isFinite(+p.coins) && +p.coins >= 0 && Number.isFinite(+p.xp) && +p.xp >= 0;
export const LV_MAX = 100, xpNeed = (n) => Math.round(100 * n ** 1.6);
export function lvInfo(xp) { let n = 1, x = xp, need = xpNeed(1); while (n < LV_MAX && x >= need) { x -= need; n++; need = xpNeed(n); } return { n, x: Math.floor(x), need }; }
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export const DEF_SETTINGS = {
  lang: "en", quality: "auto", res: "high", renderer: "3d", rendererPick: "", fpsCap: 60, showFps: false, postFx: true, juice: true, minimap: true,
  // calm1: "Reduce effects" (no shake, flashes, particles, slow-motion) is on by default on phones and tablets
  calmFx: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)),
  ctrl: "joy", sens: 1, left: false, one: false, boostSize: 1, boostPos: 0.5, haptics: true,
  replay: true, vMaster: 0.8, vSfx: 0.9, vMusic: 0.45, vUi: 0.8, cb: false, reduceMotion: false, bigText: false, sv: 2, a2hs: 0,
};
export function newProfile(name) {
  return {
    v: 1, name: name || "Guest", xp: 0, coins: 100, flags: [], skin: { k: "skin", i: 0 }, custom: { p: 10, c: ["#18c964", "#0b7a3b", "#b8ffcf"] },
    eye: 0, trail: 0, gt: "", nc: 0, presets: [null, null, null, null],
    stats: { games: 0, kills: 0, deaths: 0, food: 0, best: 0, time: 0, life: 0, top: 0, boost: 0, online: 0, zen: 0, wave: 0, tbest: 0, wins: 0, brWins: 0, kothWins: 0, teamWins: 0, bossKills: 0, cores: 0 },
    bests: { classic: [], time: [], survival: [], zen: [], online: [], br: [], koth: [], boss: [], team: [] }, ach: {}, daily: { d: "", m: [] }, bonus: "",
    owned: [], season: { id: "s1", xp: 0, claimed: [] }, weekly: { w: "", m: [], done: 0 }, chains: {}, seen: [], introSeen: 0,
    last: { mode: "classic", world: 0, diff: 1, room: "" }, tut: 0,
    // identity (M2): avatar "p0".."p15" or "f<flag>", frame/title/banner index, pinned achievements, last 10 matches,
    // games per mode, ranked points, login calendar, free daily spin, cosmetics granted by rewards
    av: "p0", frame: 0, title: 0, banner: 0, pins: [], hist: [], mg: {}, rp: 0, login: { d: "", n: 0 }, spin: "", cos: [], bio: "", hob: [],
    // comp1: trophies (on = last server-confirmed online total, off = offline part, pk = season peak, ss = season id,
    // dg/day = offline trophies gained today), local contest progress (cx), claimed reward keys (rc), device secret (dev)
    lg: { on: 0, off: 0, pk: 0, ss: "", dg: 0, day: "", conq: 0, rank: 0, sync: 0 }, cx: {}, rc: [], dev: "",
    uid: "", // srv1: last public id the server gave this profile (display cache; the server is the source of truth)
  };
}
export function fixProfile(p) { // fill any missing field from defaults (older or imported profiles)
  const d = newProfile(p && p.name);
  if (!p || typeof p !== "object") return d;
  for (const k in d) if (p[k] === undefined || typeof p[k] !== typeof d[k] || Array.isArray(d[k]) !== Array.isArray(p[k])) p[k] = d[k];
  for (const k in d.stats) if (typeof p.stats[k] !== "number" || !isFinite(p.stats[k])) p.stats[k] = 0;
  for (const k in d.bests) if (!Array.isArray(p.bests[k])) p.bests[k] = [];
  if (!p.season || p.season.id !== "s1" || !Array.isArray(p.season.claimed)) p.season = d.season; p.season.xp = Math.max(0, +p.season.xp || 0);
  if (!p.weekly || !Array.isArray(p.weekly.m)) p.weekly = d.weekly; if (!p.chains || typeof p.chains !== "object") p.chains = {}; p.owned = p.owned.filter((x) => typeof x === "string");
  for (const k in d.last) if (p.last[k] === undefined) p.last[k] = d.last[k];
  p.xp = Math.max(0, +p.xp || 0); p.coins = Math.max(0, +p.coins || 0); p.flags = p.flags.filter((i) => Number.isInteger(i) && FLAGS[i]);
  while (p.presets.length < 4) p.presets.push(null);
  if (!/^(p([0-9]|1[0-5])|f\d{1,3})$/.test(p.av) || (p.av[0] === "f" && !FLAGS[+p.av.slice(1)])) p.av = "p0";
  for (const k of ["frame", "title", "banner", "rp"]) p[k] = Math.max(0, Math.floor(+p[k] || 0)); if (p.frame >= FRAMES.length) p.frame = 0; if (p.title >= TITLES.length) p.title = 0; // comp1: was > 6 / > 13 (reset frames 7..14 on load) if (p.banner > 7) p.banner = 0;
  p.pins = p.pins.filter((x) => typeof x === "string" && Store.ACH.some((a) => a[0] === x)).slice(0, 3); p.cos = p.cos.filter((x) => typeof x === "string" && /^(av|fr|ti|bn|bd):[a-z0-9]{1,4}$/.test(x));
  p.hist = p.hist.filter((h) => h && typeof h === "object" && typeof h.m === "string").slice(0, 10); if (!p.mg || typeof p.mg !== "object" || Array.isArray(p.mg)) p.mg = {};
  for (const k of Object.keys(p.mg)) if (typeof p.mg[k] !== "number" || !isFinite(p.mg[k])) delete p.mg[k];
  { const gi = gtIndex(p.gt); if (gi < 0 || (GTRAILS[gi].price && !p.owned.includes("gt:" + p.gt))) p.gt = ""; } // trail1: ground trail slot ("" = none)
  p.bio = String(p.bio).replace(/[<>]/g, "").slice(0, 90); p.hob = p.hob.filter((x) => typeof x === "string" && /^[a-z]{2,12}$/.test(x)).slice(0, 5);
  if (!p.login || typeof p.login.d !== "string") p.login = { d: "", n: 0 }; p.login.n = Math.max(0, Math.min(6, p.login.n | 0));
  { const L = p.lg, D = d.lg; for (const k in D) if (typeof L[k] !== typeof D[k]) L[k] = D[k]; for (const k of ["on", "off", "pk", "dg", "rank", "sync"]) L[k] = Math.max(0, Math.min(k === "sync" ? 9e15 : 99999, Math.floor(+L[k] || 0))); L.conq = L.conq ? 1 : 0;
    if (!/^(\d{4}-\d{2})?$/.test(L.ss)) L.ss = ""; if (!/^(\d{4}-\d{2}-\d{2})?$/.test(L.day)) L.day = "";
    const X = p.cx; if (!X || typeof X !== "object" || Array.isArray(X)) p.cx = {}; else for (const k of Object.keys(X)) { if (k === "w" || k === "m") { if (typeof X[k] !== "string" || X[k].length > 10) delete X[k]; } else if (["wtr", "wkl", "wsc", "mtr", "mkl", "msc"].includes(k)) X[k] = Math.max(0, Math.min(1e7, Math.floor(+X[k] || 0))); else delete X[k]; }
    p.rc = p.rc.filter((x) => typeof x === "string" && x.length <= 40).slice(-300); if (!/^([0-9a-f]{32})?$/.test(p.dev)) p.dev = ""; }
  if (!/^\d{0,7}$/.test(p.uid)) p.uid = "";
  return p;
}

// ---------- crypto (same scheme as day-1: PBKDF2-SHA256, 16-byte salt) ----------
const SUB = window.crypto && crypto.subtle, TE = new TextEncoder(), IT = 210000;
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h) => new Uint8Array((String(h).match(/../g) || []).map((x) => parseInt(x, 16)));
const same = (a, b) => { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
async function pwHash(pw, salt, it) { const k = await SUB.importKey("raw", TE.encode(pw), "PBKDF2", false, ["deriveBits"]); return hex(await SUB.deriveBits({ name: "PBKDF2", salt, iterations: it, hash: "SHA-256" }, k, 256)); }
function fbOld(pw, salt) { let h = 5381, g = 52711; const s = hex(salt) + ":" + pw; for (let n = 0; n < 2000; n++) for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = (Math.imul(h, 33) ^ c ^ n) >>> 0; g = (Math.imul(g, 31) + c + h) >>> 0; } return "f" + h.toString(16) + g.toString(16); }
async function pwCheck(pw, a) { return a.h[0] === "f" ? same(fbOld(pw, unhex(a.s)), a.h) : same(await pwHash(pw, unhex(a.s), a.it || 100000), a.h); }
const UNAME = /^[\p{L}\p{N}_]{3,16}$/u;
export const unameOk = (u) => typeof u === "string" && UNAME.test(u) && !["__proto__", "constructor", "prototype", "guest"].includes(u.toLowerCase());
export const emailOk = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@<>"'`()[\]\\,;:]{1,64}@(?:[^\s@<>"'`()[\]\\,;:.]+\.)+[^\s@<>"'`()[\]\\,;:.\d]{2,24}$/u.test(e);

export class Store {
  constructor() {
    this.warn = null; // set by the app: (key) => toast
    // guardian: a save that does not parse (truncated write, corruption) is restored from the newest backup that does,
    // instead of starting a new profile. Backups: ssp-bak (recent) and ssp-bak1 (older), each {t, a, g}.
    this.repairs = []; const baks = [jparse(KV.get("ssp-bak") || "null"), jparse(KV.get("ssp-bak1") || "null")].filter((b) => b && typeof b === "object" && b.v === 1);
    const rawA = KV.get("ssp-acc"), rawG = KV.get("ssp-guest"); let o = jparse(rawA || "null"), g0 = jparse(rawG || "null");
    // repair, never wipe: the unreadable text itself is kept aside (ssp-corrupt, newest one) so nothing is lost for good
    const keep = (k, raw) => { try { KV.set("ssp-corrupt", JSON.stringify({ t: Date.now(), k, raw: String(raw).slice(0, 60000) })); } catch (_) {} };
    if (rawA && !(o && o.v === 1 && o.a && typeof o.a === "object")) keep("ssp-acc", rawA);
    if (rawG && !(g0 && typeof g0 === "object")) keep("ssp-guest", rawG);
    if (rawA && !(o && o.v === 1 && o.a && typeof o.a === "object")) { const b = baks.find((x) => x.a && typeof x.a === "object"); o = b ? { v: 1, a: b.a } : null; this.repairs.push(b ? "acc:restored" : "acc:lost"); logErr("save", b ? "accounts unreadable, restored from backup" : "accounts unreadable, no backup"); }
    if (rawG && !(g0 && typeof g0 === "object")) { const b = baks.find((x) => x.g && typeof x.g === "object"); g0 = b ? b.g : null; this.repairs.push(b ? "guest:restored" : "guest:lost"); logErr("save", b ? "guest unreadable, restored from backup" : "guest unreadable, no backup"); }
    this.acc = Object.create(null); if (o && o.v === 1 && o.a && typeof o.a === "object") for (const k of Object.keys(o.a)) { const a = o.a[k]; if (a && a.h && a.s && a.p) { a.p = this._verify(fixProfile(a.p), baks.map((b) => b.a && b.a[k] && b.a[k].p), "acc:" + k); this.acc[k] = a; } }
    this.guest = this._verify(fixProfile(g0), baks.map((b) => b.g), "guest");
    this.cur = null; const c = KV.get("ssp-cur"); if (c && this.acc[c]) this.cur = c;
    this.settings = { ...DEF_SETTINGS }; const st = jparse(KV.get("ssp-set") || "null");
    if (st && typeof st === "object") { for (const k in DEF_SETTINGS) if (typeof st[k] === typeof DEF_SETTINGS[k]) this.settings[k] = st[k]; if (st.sv !== 2) { this.settings.showFps = false; this.settings.sv = 2; } } // v2: the FPS counter is a debug option, off for everyone
    else { // first run: inherit the language chosen in the day-1 game (read-only), honour the OS reduced-motion setting
      const ol = KV.get("ss-lang"); if (["ar", "tr", "fr", "es", "hi"].includes(ol)) this.settings.lang = ol;
      try { this.settings.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}
      const nv = navigator; if ((nv.deviceMemory && nv.deviceMemory <= 2) || (nv.hardwareConcurrency && nv.hardwareConcurrency <= 2)) this.settings.quality = "low";
    }
    // migration: builds before Nov 2026 persisted an automatic 2D fallback as if the player had chosen it. Only an explicit pick in Settings keeps 2D.
    if (this.settings.renderer === "2d" && this.settings.rendererPick !== "2d") this.settings.renderer = "3d";
    this.remember = KV.get("ssp-rem") || "";
    this.fails = Object.create(null); this._t = 0;
    walletInit(this, KV, jparse); // coin1: the server wallet (cached balance + claim queue per profile)
    addEventListener("storage", (e) => { if (e.key === "ssp-acc" && e.newValue) { const o2 = jparse(e.newValue); if (o2 && o2.a) for (const k of Object.keys(o2.a)) if (k !== this.cur && o2.a[k] && o2.a[k].p) { o2.a[k].p = fixProfile(o2.a[k].p); this.acc[k] = o2.a[k]; } } });
  }
  get p() { return this.cur ? this.acc[this.cur].p : this.guest; }
  get isGuest() { return !this.cur; }
  // a profile whose economy checksum does not match was edited outside the game: its coins / XP / owned items come back
  // from the newest backup copy whose own checksum verifies (never granting anything). No checksum yet = older build: trusted.
  _verify(p, cands, label) {
    if (!p._ck || p._ck === econSum(p)) { if (!sane(p)) { p.coins = Math.max(0, +p.coins || 0); p.xp = Math.max(0, +p.xp || 0); } return p; }
    const good = cands.find((c) => c && typeof c === "object" && c._ck && c._ck === econSum(c) && sane(c));
    if (good) { const f = fixProfile(JSON.parse(JSON.stringify(good))); for (const k of ECON) p[k] = f[k]; this.repairs.push(label + ":tamper-restored"); logErr("tamper", label + " economy restored from backup"); }
    else { this.repairs.push(label + ":tamper-unverified"); logErr("tamper", label + " checksum mismatch, no valid backup"); }
    p._ck = econSum(p); return p;
  }
  // guardian autosave: save() coalesces bursts (250 ms); a 1 s watcher compares a cheap signature of everything that
  // matters (no JSON of the big objects) and flushes only when it changed; flush writes only keys whose text changed;
  // the page going away (hidden / pagehide / beforeunload) flushes at once. Failed writes retry with back-off.
  save() { this._dirty = true; clearTimeout(this._t); this._t = setTimeout(() => this.flush(), 250); }
  _sig() { const p = this.p, st = p.stats, d = p.daily, w = p.weekly; let m = 0; if (d && d.m) for (const x of d.m) m += (+x.p || 0) + (x.c ? 1e6 : 0); if (w && w.m) for (const x of w.m) m += (+x.p || 0) + (x.c ? 1e6 : 0);
    const S = this.settings; let sv = ""; for (const k in S) sv += S[k] + ","; // settings: ~30 scalars
    return (this.cur || "") + "|" + p.coins + "|" + p.xp + "|" + p.owned.length + "|" + p.flags.length + "|" + p.cos.length + "|" + JSON.stringify(p.skin) + p.eye + p.trail + "~" + p.gt + p.nc + p.av + p.frame + p.title + p.banner + "|" + p.season.xp + "|" + p.season.claimed.length + "|" + st.games + "|" + st.kills + "|" + st.food + "|" + p.hist.length + "|" + p.rp + "|" + m + "|" + Object.keys(p.ach).length + "|" + p.name + p.bio + "|" + p.last.mode + p.last.world + p.last.diff + p.last.room + "|" + sv; }
  startAutosave() {
    if (this._as) return; this._as = setInterval(() => { const g = this._sig(); if (g !== this._lastSig || this._dirty) this.flush(); }, 1000);
    const now = () => this.flush(); addEventListener("pagehide", now); addEventListener("beforeunload", now); document.addEventListener("visibilitychange", () => { if (document.hidden) now(); });
  }
  flush() {
    clearTimeout(this._t); this._dirty = false; this._lastSig = this._sig();
    for (const a of Object.values(this.acc)) if (a && a.p) a.p._ck = econSum(a.p); this.guest._ck = econSum(this.guest);
    const W = this._w || (this._w = Object.create(null)); let ok = true;
    const put = (k, v) => { if (W[k] === v) return; if (KV.set(k, v)) W[k] = v; else ok = false; };
    const sa = JSON.stringify({ v: 1, a: this.acc }), sg = JSON.stringify(this.guest);
    put("ssp-acc", sa); put("ssp-guest", sg); put("ssp-set", JSON.stringify(this.settings));
    if (this.cur) put("ssp-cur", this.cur); else if (W["ssp-cur"] !== "") { KV.del("ssp-cur"); W["ssp-cur"] = ""; }
    if (KV.ok && !ok) { this._failN = (this._failN || 0) + 1; logErr("save", "write failed (" + this._failN + ")"); if (this._failN === 1 && this.warn) this.warn("storageFull"); clearTimeout(this._rt); this._rt = setTimeout(() => this.flush(), Math.min(60000, 2000 * 2 ** Math.min(5, this._failN - 1))); }
    else if (ok) { this._failN = 0; this._backup(sa, sg); if (this.onFlush) try { this.onFlush(); } catch (_) {} } // srv2: account sync (debounced there)
    return ok || !KV.ok;
  }
  // last-known-good: the state just written (checksums verified) becomes ssp-bak at most every 20 s; ssp-bak moves to
  // ssp-bak1 when it is older than 10 min, so one older copy survives a bad session
  _backup(sa, sg, force) { const now = Date.now(); if (!force && now - (this._bakT || 0) < 20000) return; this._bakT = now;
    try { const prev = jparse(KV.get("ssp-bak") || "null"); if (prev && prev.v === 1 && now - (prev.t || 0) > 600000) KV.set("ssp-bak1", KV.get("ssp-bak")); KV.set("ssp-bak", '{"v":1,"t":' + now + ',"a":' + sa.slice(11, -1) + ',"g":' + sg + "}"); /* sa = {"v":1,"a":{...}} */ } catch (e) { logErr("backup", e); } }
  // ---------- protected purchase (coins only; no real money anywhere) ----------
  // atomic: validate price + balance, deduct, grant, write; if the write fails while storage exists, everything is put
  // back exactly as it was. Re-entrant / double taps on the same item within 800 ms are refused.
  // coin1: the server decides. Local checks only spare a request; the price, ownership and balance are checked and paid
  // on the server in one step, then the item is added here and the balance becomes the server's. Offline = refused.
  async purchase(key, price, grantFn, ownedFn, desc) {
    const p = this.p, now = Date.now(); price = Number(price);
    if (this._buying) return "busy"; if (this._lastBuy && this._lastBuy.k === key && now - this._lastBuy.t < 800) return "busy";
    if (!Number.isFinite(price) || price <= 0 || Math.floor(price) !== price) return "badPrice";
    if (ownedFn()) return "own"; if (migrated() && p.coins < price) return "noCoins";
    this._buying = true;
    try { const r = await wBuy({ ...desc, price }); if (r !== "ok") return r; grantFn(); this.flush(); this._lastBuy = { k: key, t: now }; this._backup(JSON.stringify({ v: 1, a: this.acc }), JSON.stringify(this.guest), true); return "ok"; }
    catch (e) { logErr("buy", e); return "offline"; }
    finally { this._buying = false; }
  }
  // coin1: a Special ID = one server transaction (who gets it + its coins); see social.js buyId
  buySpecialId(n, price) { n = String(n); if (!/^[1-9]\d{4}$/.test(n)) return Promise.resolve({ err: "bad" }); return buySid(n, price).then((r) => { if (r && r.ok && !this.p.owned.includes("sid:" + n)) { this.p.owned.push("sid:" + n); this.flush(); } return r; }); }
  // comp1: atomic reward grant (contest / season / milestone). key is unique per reward (period + contest + rank/milestone):
  // a key already in p.rc is refused, so a reward can never be paid twice on this profile; all-or-nothing on a failed save.
  grantReward(key, rw, a = {}) {
    const p = this.p; key = String(key || ""); if (!key || key.length > 40) return "bad"; if (this._granting) return "busy";
    if (p.rc.includes(key)) return "claimed"; const coins = Math.max(0, Math.min(10000, Math.floor(+(rw && rw.coins) || 0))), cos = ((rw && rw.cos) || []).filter((c) => typeof c === "string" && /^(av|fr|ti|bn|bd):[a-z0-9]{1,4}$/.test(c));
    this._granting = true; const snap = { coins: p.coins, cos: p.cos.slice(), rc: p.rc.slice() };
    try { p.coins += coins; for (const c of cos) if (!p.cos.includes(c)) p.cos.push(c); p.rc.push(key); if (p.rc.length > 300) p.rc.splice(0, p.rc.length - 300);
      const ok = this.flush(); if (!ok) { p.coins = snap.coins; p.cos = snap.cos; p.rc = snap.rc; this.flush(); logErr("grant", "save failed, rolled back " + key); return "saveFail"; }
      claim("rw", "rw:" + key, { key, ...a }, coins); // coin1: the server pays it (priced from its own tables, once per key)
      this._backup(JSON.stringify({ v: 1, a: this.acc }), JSON.stringify(this.guest), true); return "ok"; }
    catch (e) { p.coins = snap.coins; p.cos = snap.cos; p.rc = snap.rc; logErr("grant", e); return "saveFail"; }
    finally { this._granting = false; }
  }
  lockLeft(k) { const f = this.fails[k]; return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
  _fail(k) { const f = this.fails[k] || (this.fails[k] = { n: 0, until: 0, x: 0 }); if (++f.n >= 5) { f.n = 0; f.until = Date.now() + Math.min(900000, 30000 * 2 ** f.x++); } }

  async signUp(u, em, pw, pw2) {
    u = String(u || "").trim().normalize("NFC"); em = String(em || "").trim().toLowerCase(); const k = u.toLowerCase();
    if (!SUB) return { err: "oops" };
    if (!unameOk(u)) return { err: "errUser" };
    if (!emailOk(em)) return { err: "errEmail" };
    if (pw.length < 8 || pw.length > 128) return { err: "errPw" };
    if (pw !== pw2) return { err: "errMatch" };
    if (this.acc[k] || this._old()[k]) return { err: "errTaken" };
    const s = crypto.getRandomValues(new Uint8Array(16)), h = await pwHash(pw, s, IT);
    const p = newProfile(u); // keep anything earned as guest this session
    if (this.guest.xp > 0) { p.xp = this.guest.xp; p.coins = this.guest.coins; p.stats = { ...this.guest.stats }; p.flags = [...this.guest.flags]; p.ach = { ...this.guest.ach }; p.bests = JSON.parse(JSON.stringify(this.guest.bests)); p.tut = this.guest.tut; p.lg = { ...this.guest.lg }; p.cx = { ...this.guest.cx }; p.dev = this.guest.dev; this.guest.dev = ""; this.guest.lg.on = 0; } // comp1: the online id moves with the progress
    this.acc[k] = { u, email: em, h, s: hex(s), it: IT, p }; this.cur = k; this.flush(); return { ok: true };
  }
  async signIn(u, pw, remember) {
    u = String(u || "").trim().normalize("NFC"); const k = u.toLowerCase(); const lk = this.lockLeft(k);
    if (lk) return { err: "errLocked", n: lk };
    if (!SUB) return { err: "oops" };
    let a = this.acc[k], migrated = false;
    if (!a) { // not in Pro yet: look in the day-1 saves (read-only) and import on a correct password
      const old = this._old()[k];
      if (old && await pwCheck(pw, old)) { a = this._migrate(k, old); migrated = true; }
      else { this._fail(k); return { err: "errLogin" }; }
    } else if (!(await pwCheck(pw, a))) { this._fail(k); return { err: "errLogin" }; }
    delete this.fails[k];
    if (a.it !== IT || a.h[0] === "f") { const s = crypto.getRandomValues(new Uint8Array(16)); a.h = await pwHash(pw, s, IT); a.s = hex(s); a.it = IT; }
    this.cur = k; if (remember) { this.remember = u; KV.set("ssp-rem", u); } else { this.remember = ""; KV.del("ssp-rem"); }
    this.flush(); return { ok: true, migrated };
  }
  signOut() { this.flush(); this.cur = null; this.flush(); }
  _old() {
    const o = jparse(KV.get("ss-acc") || "null"), r = Object.create(null);
    if (o && o.v === 1 && o.a && typeof o.a === "object") for (const k of Object.keys(o.a)) { const a = o.a[k]; if (a && typeof a === "object" && typeof a.h === "string" && /^[0-9a-f]{32}$/.test(a.s || "") && a.d && a.d.P) r[k] = a; }
    return r;
  }
  _migrate(k, old) {
    const P = old.d.P || {}, PST = old.d.PST || {}, p = newProfile(old.u || k);
    p.name = String(P.name || old.u || k).slice(0, 16); p.xp = Math.max(0, +P.xp || 0); p.coins = Math.max(100, +P.coins || 0);
    if (P.own && typeof P.own === "object") for (const key of Object.keys(P.own)) { const m = /^s(\d+)$/.exec(key); if (m && P.own[key]) { const fi = +m[1] - OLD_FLAG0; if (FLAGS[fi]) p.flags.push(fi); } }
    p.stats.games = Math.max(0, +PST.games || 0); p.stats.kills = Math.max(0, +PST.kills || 0); p.stats.top = Math.max(0, +PST.wins || 0);
    const a = { u: old.u || k, email: String(old.email || ""), h: old.h, s: old.s, it: old.it, p: fixProfile(p), from: "day1" };
    this.acc[k] = a; return a;
  }
  // srv2: put a profile in place of the current one (account restore / sign-out). The device key of the incoming profile is
  // chosen by the caller; checksums are rebuilt by flush().
  replaceProfile(np) { const f = fixProfile(np); if (this.cur) this.acc[this.cur].p = f; else this.guest = f; this.flush(); return f; }
  resetProgress() { const n = this.p.name; const f = newProfile(n); f.tut = 1; if (this.cur) this.acc[this.cur].p = f; else this.guest = f; this.flush(); }

  // ---------- progression ----------
  level() { return lvInfo(this.p.xp).n; }
  addXp(n) { const before = this.level(); this.p.xp += Math.max(0, Math.round(n)); const after = this.level(); let coins = 0; for (let l = before + 1; l <= after; l++) { coins += levelCoins(l); claim("lv", "lv:" + l, { n: l }, levelCoins(l)); } this.p.coins += coins; return { up: after > before, level: after, coins }; }
  unlocked(kind, i) {
    const lv = this.level();
    if (kind === "skin") { const S = SKINS[i]; if (!S) return false; if (S.src) { if (this.p.owned.includes(S.id)) return true; const [k, n] = S.src.split(":"); return k === "level" && lv >= +n; } return lv >= S.lv; } if (kind === "flag") return this.p.flags.includes(i); if (kind === "eye") return lv >= EYES[i].lv;
    if (kind === "gtrail") { const G = GTRAILS[i]; return !!G && (!G.price || this.p.owned.includes("gt:" + G.id)); }
    if (kind === "trail") return lv >= TRAILS[i].lv; if (kind === "world") return lv >= WORLDS[i].lv; if (kind === "diff") return i < 3 || lv >= 10; return true;
  }
  // offers: several cosmetics for one coin price, through the same atomic purchase (all granted or none). An item owned
  // since the offer was built is refused (the shop rebuilds the bundle without it).
  buyBundle(key, items, price) { if (!Array.isArray(items) || !items.length) return "na"; const own = (it) => (it.k === "skin" ? this.unlocked("skin", it.i) : this.p.flags.includes(it.i));
    for (const it of items) if (!(it.k === "skin" ? SKINS[it.i] && this.legendPrice(it.i) : FLAGS[it.i])) return "na";
    const sum = items.reduce((a, it) => a + (it.k === "skin" ? this.legendPrice(it.i) : FLAG_PRICE), 0); if (Number.isFinite(Number(price)) && Number(price) > 0 && !this._priceOk(price, sum)) return "badPrice";
    return this.purchase("bundle:" + key, price, () => { for (const it of items) { if (it.k === "skin") { const id = SKINS[it.i].id; if (!this.p.owned.includes(id)) this.p.owned.push(id); } else if (!this.p.flags.includes(it.i)) this.p.flags.push(it.i); } }, () => items.some(own), { k: "bundle", key, items: items.map((x) => ({ k: x.k, i: x.i })) }); }
  // a caller-supplied (offer) price must stay inside [60 % .. 100 %] of the catalogue price: the deepest offer is 40 % off
  _priceOk(price, base) { price = Number(price); return Number.isFinite(price) && price > 0 && Math.floor(price) === price && price <= base && price >= Math.ceil(base * 0.6); }
  buyFlag(i, price = FLAG_PRICE) { if (!FLAGS[i]) return "na"; if (Number.isFinite(Number(price)) && Number(price) > 0 && !this._priceOk(price, FLAG_PRICE)) return "badPrice"; return this.purchase("flag:" + i, price, () => { if (!this.p.flags.includes(i)) this.p.flags.push(i); }, () => this.p.flags.includes(i), { k: "flag", ix: i }); }
  // 7-day login calendar: one claim per calendar day; a missed day restarts at day 1. Returns null when already claimed today.
  loginState() { const d = today(), L = this.p.login; if (L.d === d) return { day: L.n, claimed: true }; const y = new Date(); y.setDate(y.getDate() - 1); const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    const next = L.d === yd ? (L.n + 1) % 7 : 0; return { day: next, claimed: false, fresh: L.d !== yd }; }
  claimLogin(LOGIN, pickCos) { const st = this.loginState(); if (st.claimed) return null; const n = st.day, coins = LOGIN[n]; this.p.login = { d: today(), n }; this.p.coins += coins; let cos = null; if (n === 6) { cos = pickCos(); if (cos) this.p.cos.push(cos); else this.p.coins += 500; } claim("login", "login:" + this.p.login.d, { d: this.p.login.d, cos }, coins + (n === 6 && !cos ? 500 : 0)); this.save(); return { day: n, coins, cos }; }
  spinReady() { return this.p.spin !== today(); }
  // one free spin per day: weighted segment, coins / XP / a random locked cosmetic (coins if everything is owned)
  // coin1: the wheel is rolled by the server (online only); XP stays on the device, coins / the cosmetic come from the server
  async spin(SEG, pickCos) { if (!this.spinReady()) return null; const d = today(), cos = pickCos(), r = await wSpin(d, cos);
    if (!r || !r.ok) { if (r && r.err === "day") { this.p.spin = d; this.save(); } return { err: (r && r.err) || "offline" }; }
    const out = { i: r.i, coins: r.c | 0, xp: r.x | 0, cos: r.cos || null, lv: null }; this.p.spin = d; if (out.xp) out.lv = this.addXp(out.xp); if (out.cos && !this.p.cos.includes(out.cos)) this.p.cos.push(out.cos);
    this.save(); return out; }
  pushHistory(h) { this.p.hist.unshift(h); if (this.p.hist.length > 10) this.p.hist.length = 10; this.p.mg[h.m] = (this.p.mg[h.m] || 0) + 1; }
  favMode() { let b = null, n = 0; for (const k in this.p.mg) if (this.p.mg[k] > n) { n = this.p.mg[k]; b = k; } return b; }
  claimDailyBonus() { const d = today(); if (this.p.bonus === d) return 0; this.p.bonus = d; const n = bonusCoins(this.level()); this.p.coins += n; claim("bonus", "bonus:" + d, { d, lv: this.level() }, n); this.save(); return n; }

  // ---------- daily missions (seeded by date, same 3 for everyone on a device that day) ----------
  daily() {
    const d = today(); if (this.p.daily.d === d && this.p.daily.m.length === 3) return this.p.daily.m;
    const pick = dailyMissions(d); // coin1: econ.js (the worker prices mission claims from the same table)
    this.p.daily = { d, m: pick }; this.save(); return pick;
  }
  // progress from a finished life/match; returns missions newly completed
  missionProgress(ev) {
    const out = []; for (const m of this.daily()) {
      if (m.p >= m.g) continue; const was = m.p;
      if (m.id === "eat") m.p += ev.food || 0; else if (m.id === "kill") m.p += ev.kills || 0; else if (m.id === "mass") m.p = Math.max(m.p, Math.floor(ev.mass || 0));
      else if (m.id === "games") m.p += 1; else if (m.id === "survive") m.p = Math.max(m.p, Math.floor(ev.life || 0)); else if (m.id === "boost") m.p += Math.floor(ev.boost || 0); else if (m.id === "online") m.p += ev.online ? 1 : 0;
      m.p = Math.min(m.g, m.p); if (was < m.g && m.p >= m.g) out.push(m);
    }
    this.save(); return out;
  }
  claimMission(i) { const m = this.daily()[i]; if (!m || m.p < m.g || m.c) return null; m.c = 1; this.p.coins += m.r; claim("ms", "ms:" + this.p.daily.d + ":" + i, { d: this.p.daily.d, i }, m.r); const lv = this.addXp(m.r); this.save(); return { coins: m.r, lv }; }

  // ---------- legendary ownership, season pass, weekly challenges, mission chains ----------
  grant(id) { if (!this.p.owned.includes(id)) { this.p.owned.push(id); if (UNLOCKS.has(id)) claim("unl", "unl:" + id, { id }, 0); this.save(); return true; } return false; }
  legendPrice(i) { const S = SKINS[i]; if (!S || !S.src) return 0; const [k, n] = S.src.split(":"); return k === "coins" ? +n : 0; }
  buyLegend(i, price) { const S = SKINS[i], base = this.legendPrice(i); if (!base) return "na"; if (price != null && Number.isFinite(Number(price)) && Number(price) > 0 && !this._priceOk(price, base)) return "badPrice"; return this.purchase("skin:" + i, price ?? base, () => { if (!this.p.owned.includes(S.id)) this.p.owned.push(S.id); }, () => this.unlocked("skin", i), { k: "skin", ix: i }); }
  // trail1: ground trails. Paid ones go through the same atomic coin purchase (price bounds, rollback on a failed save);
  // the free ones are never sold. equipGTrail(-1) clears the slot.
  gtPrice(i) { const G = GTRAILS[i]; return G ? G.price | 0 : 0; }
  buyGTrail(i, price) { const G = GTRAILS[i], base = this.gtPrice(i); if (!G || !base) return "na"; if (price != null && Number.isFinite(Number(price)) && Number(price) > 0 && !this._priceOk(price, base)) return "badPrice";
    return this.purchase("gt:" + i, price ?? base, () => { if (!this.p.owned.includes("gt:" + G.id)) this.p.owned.push("gt:" + G.id); }, () => this.unlocked("gtrail", i), { k: "gt", ix: i }); }
  // land1: skin fusion, decided by the server (ownership, the pair once, the fee). Returns "ok" | "own" | an ERR-style code.
  async fuse(a, b) { if (a === b || !fusable(a) || !fusable(b)) return "na"; const r = await wFuse(a, b, FUSION_FEE);
    if (r && r.err === "price" && r.fee) { setFusionFee(r.fee); return "badPrice"; } if (r && r.ok) { const k = fuKey(a, b); if (!this.p.owned.includes(k)) this.p.owned.push(k); this.save(); return "ok"; }
    if (r && r.err === "own") { const k = fuKey(a, b); if (!this.p.owned.includes(k)) this.p.owned.push(k); this.save(); return "own"; }
    return r && r.err === "offline" ? "offline" : r && r.err === "noCoins" ? "noCoins" : r && r.err === "rate" ? "busy" : r && r.err === "notOwned" ? "na" : "oops"; }
  equipGTrail(i) { if (i < 0) { this.p.gt = ""; this.save(); return "ok"; } const G = GTRAILS[i]; if (!G) return "na"; if (!this.unlocked("gtrail", i)) return "locked"; this.p.gt = G.id; this.save(); return "ok"; }
  seasonTier() { return Math.min(SEASON.tiers, Math.floor(this.p.season.xp / SEASON.per)); }
  addSeasonXp(n) { const b = this.seasonTier(); this.p.season.xp += Math.max(0, Math.round(n)); const a = this.seasonTier(); this.save(); return a > b ? a - b : 0; }
  claimTier(k) {
    const P = this.p.season; if (k < 1 || k > this.seasonTier() || P.claimed.includes(k)) return null; P.claimed.push(k); const r = seasonReward(k);
    if (r.coins) this.p.coins += r.coins; claim("tier", "tier:" + SEASON.id + ":" + k, { k }, r.coins | 0); let skin = null; if (r.skin) { const i = SKINS.findIndex((s) => s.id === r.skin); if (this.grant(r.skin)) skin = i; } this.save(); return { ...r, skinI: skin };
  }
  weekly() {
    const w = isoWeek(); if (this.p.weekly.w === w && this.p.weekly.m.length === 3) return this.p.weekly.m;
    let h = 7; for (const ch of w) h = (Math.imul(h, 33) + ch.charCodeAt(0)) | 0; const rnd = () => { h = (Math.imul(h ^ (h >>> 13), 1597334677) + 0x9e3779b9) | 0; return ((h >>> 0) % 10000) / 10000; };
    const T = [["kill", 40], ["eat", 2500], ["games", 15], ["wins", 3], ["mass", 2000], ["modes", 4], ["boost", 300]]; const pick = [];
    while (pick.length < 3) { const tt = T[(rnd() * T.length) | 0]; if (!pick.some((x) => x.id === tt[0])) pick.push({ id: tt[0], g: tt[1], p: 0, r: weeklyCoins(pick.length), c: 0, ms: [] }); }
    this.p.weekly = { w, m: pick, done: this.p.weekly.done || 0 }; this.save(); return pick;
  }
  claimWeekly(i) { const m = this.weekly()[i]; if (!m || m.p < m.g || m.c) return null; m.c = 1; this.p.coins += m.r; claim("wk", "wk:" + this.p.weekly.w + ":" + i, { w: this.p.weekly.w, i }, m.r); const lv = this.addXp(m.r); let skin = null; if (this.weekly().every((x) => x.c)) { this.p.weekly.done++; if (this.p.weekly.done >= 3 && this.grant("neonpulse")) skin = SKINS.findIndex((s) => s.id === "neonpulse"); } this.save(); return { coins: m.r, lv, skinI: skin }; }
  chain(id) { const c = this.p.chains[id] || (this.p.chains[id] = { s: 0, p: 0 }); return c; }
  // one finished match feeds weekly + chains; returns freshly completed items and legendary unlocks
  matchProgress(ev) {
    const out = { weekly: [], chains: [], legends: [] };
    for (const m of this.weekly()) { if (m.p >= m.g) continue; const was = m.p;
      if (m.id === "kill") m.p += ev.kills || 0; else if (m.id === "eat") m.p += ev.food || 0; else if (m.id === "games") m.p++; else if (m.id === "wins") m.p += ev.win ? 1 : 0; else if (m.id === "mass") m.p = Math.max(m.p, Math.floor(ev.mass || 0));
      else if (m.id === "modes") { m.ms = m.ms || []; if (!m.ms.includes(ev.mode)) m.ms.push(ev.mode); m.p = m.ms.length; } else if (m.id === "boost") m.p += Math.floor(ev.boost || 0);
      m.p = Math.min(m.g, m.p); if (was < m.g && m.p >= m.g) out.weekly.push(m); }
    for (const id in CHAINS) { const C = CHAINS[id], c = this.chain(id); if (c.s >= C.steps.length) continue; const [k, g] = C.steps[c.s];
      const v = k === "kills" ? ev.kills : k === "food" ? ev.food : k === "mass" ? ev.mass : k === "life" ? ev.life : k === "wave" ? ev.wave : k === "teamWin" ? (ev.win && ev.mode === "team" ? 1 : 0) : k === "brWin" ? (ev.win && ev.mode === "br" ? 1 : 0) : 0;
      if (k === "kills" || k === "food" || k.endsWith("Win")) c.p += v || 0; else c.p = Math.max(c.p, Math.floor(v || 0));
      if (c.p >= g) { c.s++; c.p = 0; out.chains.push({ id, step: c.s }); if (c.s >= C.steps.length && this.grant(C.reward)) out.legends.push(SKINS.findIndex((s) => s.id === C.reward)); } }
    if (ev.mode === "boss" && ev.win && this.grant("solar")) out.legends.push(SKINS.findIndex((s) => s.id === "solar"));
    const lvSkin = SKINS.findIndex((s) => s.id === "cosmos"); if (this.level() >= 15 && !this.p.seen.includes("cosmos")) { this.p.seen.push("cosmos"); out.legends.push(lvSkin); }
    this.save(); return out;
  }

  // ---------- owner unlock (redeem code) ----------
  // Only the SHA-256 of the normalised code ships in the client. Unlocks everything for the CURRENT account or guest;
  // idempotent (running it twice changes nothing), saved immediately, and pre-marks legendaries as seen so no reveal queue fires.
  static REDEEM = "becc72b4c1e0d080a5949c8eeaa8e39c2ef4614374418a23f5fcc3604b6e88a4";
  static async hashCode(code) { const c = String(code || "").trim().toUpperCase(); if (!c || !(globalThis.crypto && crypto.subtle)) return ""; const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(c)); return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join(""); }
  async redeem(code) { const h = await Store.hashCode(code); if (!h) return globalThis.crypto && crypto.subtle ? "bad" : "na"; if (h !== Store.REDEEM) return "bad"; this.unlockAll(); return "ok"; }
  unlockAll() {
    const p = this.p; let xp = 0; for (let n = 1; n < LV_MAX; n++) xp += xpNeed(n);
    p.xp = Math.max(p.xp, xp); if (!migrated()) p.coins = Math.max(p.coins, 999999); // coin1: once the wallet is on the server, coins come only from it
    for (const S of SKINS) { if (S.src && !p.owned.includes(S.id)) p.owned.push(S.id); if (S.fx && !p.seen.includes(S.id)) p.seen.push(S.id); }
    p.flags = FLAGS.map((_, i) => i);
    p.season.xp = Math.max(p.season.xp, SEASON.tiers * SEASON.per); for (let k = 1; k <= SEASON.tiers; k++) if (!p.season.claimed.includes(k)) p.season.claimed.push(k);
    for (const id in CHAINS) { const c = this.chain(id); c.s = Math.max(c.s, CHAINS[id].steps.length); c.p = 0; }
    p.weekly.done = Math.max(p.weekly.done || 0, 3);
    const now = Date.now(); for (const [id] of Store.ACH) if (!p.ach[id]) p.ach[id] = now;
    for (let i = 0; i < 16; i++) if (!p.cos.includes("av:p" + i)) p.cos.push("av:p" + i);
    for (let i = 1; i < 7; i++) if (!p.cos.includes("fr:" + i)) p.cos.push("fr:" + i); for (let i = 0; i < 14; i++) if (!p.cos.includes("ti:" + i)) p.cos.push("ti:" + i); for (let i = 0; i < 8; i++) if (!p.cos.includes("bn:" + i)) p.cos.push("bn:" + i);
    p.owner = 1; this.flush();
  }
  // ---------- achievements ----------
  static ACH = [
    ["a_first", "🍏", (p) => p.stats.food >= 1, 20], ["a_hunter", "⚔️", (p) => p.stats.kills >= 10, 100], ["a_predator", "🦖", (p) => p.stats.kills >= 100, 400],
    ["a_glutton", "🍇", (p) => p.stats.food >= 5000, 300], ["a_titan", "🗿", (p) => p.stats.best >= 1000, 200], ["a_colossus", "🏔️", (p) => p.stats.best >= 5000, 600],
    ["a_veteran", "🎖️", (p) => p.stats.games >= 100, 300], ["a_survivor", "⏳", (p) => p.stats.life >= 300, 200], ["a_king", "👑", (p) => p.stats.top >= 1, 250],
    ["a_speed", "⚡", (p) => p.stats.boost >= 600, 150], ["a_zen", "🧘", (p) => p.stats.zen >= 600, 100], ["a_globe", "🌍", (p) => p.flags.length >= 10, 200],
    ["a_online", "🌐", (p) => p.stats.online >= 1, 100], ["a_wave", "🌊", (p) => p.stats.wave >= 10, 300], ["a_time", "⏱️", (p) => p.stats.tbest >= 800, 200],
    ["a_level", "⭐", (p, s) => s.level() >= 10, 200], ["a_master", "🏆", (p, s) => s.level() >= 50, 1000], ["a_style", "🎨", (p) => p.presets.filter(Boolean).length >= 3, 100],
  ];
  checkAch() { const out = []; for (const [id, ic, f, r] of Store.ACH) if (!this.p.ach[id] && f(this.p, this)) { this.p.ach[id] = Date.now(); const c = ACH_COINS[id] ?? r; this.p.coins += c; claim("ach", "ach:" + id, { id }, c); out.push({ id, ic, r: c }); } if (out.length) this.save(); return out; }

  addBest(mode, entry) {
    const L = this.p.bests[mode] || (this.p.bests[mode] = []); L.push(entry); L.sort((a, b) => b.s - a.s); L.length = Math.min(L.length, 10);
    return L.indexOf(entry);
  }
}
