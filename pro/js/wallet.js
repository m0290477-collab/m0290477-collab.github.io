// coin1: the device side of the server wallet. The server holds the balance and the owned items and decides every coin:
// this module shows the last balance the server sent (+ rewards still queued for it), queues reward claims (offline too,
// each with a unique claim id so it can be paid only once), imports the device balance once on the first updated connect,
// and buys only online. Nothing here can raise the balance: the server prices every claim itself.
import { SEASON, UNLOCKS, COS_KEY } from "./econ.js?v=play2";

const KC = "ssp-wc", KQ = "ssp-wq", MAXQ = 200, XPK = new Set(["match", "ms", "wk"]);
export const WL = { S: null, ui: null, call: null, up: () => false, st: null, q: [], busy: null, migrating: false, kv: null, jp: null, onBal: null };
const key = () => (WL.S && WL.S.p && /^[0-9a-f]{32}$/.test(WL.S.p.dev || "") ? WL.S.p.dev : "");
const store = (k) => { const o = WL.jp(WL.kv.get(k) || "null"); return o && typeof o === "object" ? o : {}; };
function load() { const k = key(); const C = store(KC), Q = store(KQ); WL.st = (k && C[k]) || null; WL.q = (k && Array.isArray(Q[k]) ? Q[k] : []).filter((x) => x && x.ck); WL._k = k; }
function save() { const k = key(); if (!k) return; const C = store(KC), Q = store(KQ); if (WL.st) C[k] = WL.st; Q[k] = WL.q.slice(-MAXQ); try { WL.kv.set(KC, JSON.stringify(C)); WL.kv.set(KQ, JSON.stringify(Q)); } catch (_) {} }
function sync() { if (WL._k !== key()) load(); } // the device switched profile (local accounts / sign-in): each has its own wallet
export function walletInit(S, kv, jparse) { WL.S = S; WL.kv = kv; WL.jp = jparse; load(); }
export const migrated = () => { sync(); return !!(WL.st && WL.st.mig); };
export const pending = () => { sync(); return WL.q.reduce((a, x) => a + Math.max(0, x.l | 0), 0); };
export const cachedBal = () => (migrated() ? WL.st.bal : null);
const rid = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const claimId = () => rid();

// the server's word: balance (+ what is still queued) and the item list it holds
export function apply(w) {
  sync(); if (!w || !Number.isFinite(+w.bal)) return; const S = WL.S, p = S.p; WL.st = { ...(WL.st || {}), ...w, own: Array.isArray(w.own) ? w.own : (WL.st && WL.st.own) || [], t: Date.now() }; delete WL.st.w;
  p.coins = Math.max(0, Math.floor(+w.bal)) + pending();
  // fix1: the server's XP is the level's truth; the device may run ahead only by what is still queued (+ a small slack)
  if (Number.isFinite(+w.sx) && !WL.q.some((x) => XPK.has(x.k)) && p.xp > +w.sx + 3000) { console.info("wallet: xp set to the server's", p.xp, "->", +w.sx); p.xp = Math.max(0, Math.floor(+w.sx)); }
  for (const it of WL.st.own) { const s = String(it);
    if (/^fl:\d+$/.test(s)) { const i = +s.slice(3); if (!p.flags.includes(i)) p.flags.push(i); }
    else if (COS_KEY.test(s)) { if (!p.cos.includes(s)) p.cos.push(s); }
    else if (!p.owned.includes(s)) p.owned.push(s); }
  save(); S.save(); if (WL.onBal) try { WL.onBal(p.coins); } catch (_) {}
}
// a reward the device earned: shown at once (the caller already added `local` to p.coins), paid by the server when it sees it
export function claim(k, ck, a = {}, local = 0) {
  sync(); if (!key()) return; if (!migrated() && !WL.migrating) return; // before the one-time import, earnings stay on the device and are imported with it
  if (WL.q.some((x) => x.ck === ck)) return; WL.q.push({ k, ck, a, l: Math.max(0, local | 0), n: 0 }); if (WL.q.length > MAXQ) WL.q.splice(0, WL.q.length - MAXQ); save(); later();
}
function later(ms = 400) { clearTimeout(WL._ft); WL._ft = setTimeout(() => flush(), ms); }
export async function flush() {
  sync(); if (!WL.call || !migrated() || !WL.q.length) return; if (WL.busy) return WL.busy;
  WL.busy = (async () => { try {
    const batch = WL.q.slice(0, 25), r = await WL.call("w_claims", { l: batch.map(({ k, ck, a }) => ({ k, ck, a })), cn: Date.now() });
    if (!r || r.err || !Array.isArray(r.res)) { if (r && r.err === "mig") { WL.st = { ...(WL.st || {}), mig: 0 }; save(); } return; } // offline: the queue waits
    const keep = new Set(r.res.filter((x) => x.keep).map((x) => x.ck)), done = new Set(batch.map((x) => x.ck));
    WL.q = WL.q.filter((x) => !done.has(x.ck) || (keep.has(x.ck) && ++x.n < 30)); apply(r.w);
    const cut = r.res.filter((x) => x.cut && x.cut.length); if (cut.length) console.info("wallet: server trimmed", cut.length, "claim(s)");
    if (WL.q.length && WL.q.length > keep.size) later(600);
  } finally { WL.busy = null; } })(); return WL.busy;
}
// every reward this device already paid itself before the update (so the server never pays them a second time)
function doneKeys(S) {
  const p = S.p, out = []; for (const id in p.ach || {}) out.push("ach:" + id);
  if (p.login && p.login.d) out.push("login:" + p.login.d); if (p.bonus) out.push("bonus:" + p.bonus); if (p.spin) out.push("spin:" + p.spin);
  if (p.daily && Array.isArray(p.daily.m)) p.daily.m.forEach((m, i) => { if (m && m.c) out.push("ms:" + p.daily.d + ":" + i); });
  if (p.weekly && Array.isArray(p.weekly.m)) p.weekly.m.forEach((m, i) => { if (m && m.c) out.push("wk:" + p.weekly.w + ":" + i); });
  for (const k of (p.season && p.season.claimed) || []) out.push("tier:" + SEASON.id + ":" + k);
  if (p.wchain && p.wchain.w) for (let t = 0; t < (p.wchain.tier | 0); t++) out.push("wc:" + p.wchain.w + ":" + t);
  if (p.dailyLb && p.dailyLb.d && p.dailyLb.n > 0) out.push("dm:" + p.dailyLb.d);
  for (const k of p.rc || []) if (!/^adm:/.test(k)) out.push("rw:" + k);
  for (const id of UNLOCKS) if ((p.owned || []).includes(id)) out.push("unl:" + id);
  return out.filter((x) => /^[a-z]{1,6}:[A-Za-z0-9:._-]{1,80}$/.test(x)).slice(0, 600);
}
async function migrate() {
  const S = WL.S, p = S.p; if (WL.migrating) return; WL.migrating = true;
  try { const own = [...new Set([...(p.owned || []), ...(p.flags || []).map((i) => "fl:" + i), ...(p.cos || [])])].slice(0, 800);
    const r = await WL.call("w_mig", { coins: Math.max(0, Math.floor(p.coins - pending())), own, lv: S.level(), ck: doneKeys(S), ld: (p.login && p.login.d) || "", ln: p.login ? p.login.n : -1, sd: p.spin || "", bd: p.bonus || "" });
    if (r && r.w && r.w.mig) { apply(r.w); if (r.mig && r.mig.cut > 0) console.info("wallet: device balance imported with a cap", r.mig); } }
  finally { WL.migrating = false; } flush();
}
// the social socket said hello (it carries the wallet) or came back: show the server balance, import once, send the queue
export async function online(w) {
  sync(); if (!WL.call) return; if (!w) { const r = await WL.call("w_get"); if (!r || r.err || !r.w) return; w = r.w; }
  if (w.mig) { apply(w); flush(); } else await migrate();
}
// admin2: an owner edit of this wallet (items given / removed, level set): the server's state wins for those keys
export function admSet(m) { sync(); if (!m || !m.w) return; const p = WL.S.p; for (const k of m.rm || []) { const s = String(k); if (/^fl:\d+$/.test(s)) p.flags = p.flags.filter((x) => x !== +s.slice(3)); else if (COS_KEY.test(s)) p.cos = p.cos.filter((x) => x !== s); else p.owned = p.owned.filter((x) => x !== s); }
  if (Number.isFinite(+m.xp)) p.xp = Math.max(0, Math.floor(+m.xp)); if (migrated()) apply({ ...WL.st, ...m.w }); else { save(); WL.S.save(); } }
// pushes from the server: an online life paid by the room, an owner gift
export function onPush(m) { if (m && Number.isFinite(+m.bal)) { sync(); if (migrated()) apply({ ...WL.st, bal: +m.bal }); } }
const ERR = { noCoins: "noCoins", own: "own", badPrice: "badPrice", na: "na", rate: "busy", sold: "sold", max: "max", price: "badPrice" };
const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
async function ready() { if (offline()) return false; if (!migrated()) await online(); return migrated(); }
// a purchase: only online, priced and paid by the server; queued rewards go first so they count toward the balance
export async function buy(desc) {
  if (!WL.call || !(await ready())) return "offline"; await flush();
  const r = await WL.call("w_buy", { ...desc, rid: rid() }); if (r && r.w) apply(r.w);
  if (r && r.ok) return "ok"; if (!r || r.err === "offline" || r.err === "mig") return "offline"; return ERR[r.err] || "oops";
}
export async function buySid(n, price) {
  if (!WL.call || !(await ready())) return { err: "offline" }; await flush();
  const r = await WL.call("w_sid", { n, price }); if (r && r.w) apply(r.w); return r || { err: "offline" };
}
export async function spin(d, cos) { if (!WL.call || !(await ready())) return { err: "offline" }; await flush(); const r = await WL.call("w_spin", { d, cos }); if (r && r.w) apply(r.w); return r || { err: "offline" }; }
