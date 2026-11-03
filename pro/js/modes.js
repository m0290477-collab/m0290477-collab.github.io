// Track B · extra offline modes + weekly skill chain. Kept out of game.js: the game calls a handful of hooks
// (setup / rule / view / hud / lb / respawn / onAnyDeath / timeUp / score) on XMODES[mode] when it exists.
//   goldrush  · collect gold orbs, carry them, bank them inside the moving vault; first to 30 banked or most at 3:00
//   infection · two sides; anyone the infected kill comes back infected (you too); humans survive 2:30 to win
//   duel      · best of three rounds against one champion-level bot in a small arena
//   daily     · the same seed, world and difficulty for everyone on a given day, 3:00, local leaderboard
import { t, fmtNum } from "./i18n.js?v=aaa2a";
import { GOLD_FC, C } from "./sim.js?v=aaa2a";
import { SKINS } from "./skins.js?v=aaa2a";
import { haptic } from "./audio.js?v=aaa2a";

export const XMODE_CFG = {
  goldrush: { bots: 18, R: 200, dur: 180, target: 30 },
  infection: { bots: 22, R: 190, dur: 150 },
  duel: { bots: 0, R: 92, rounds: 3, noRespawn: true },
  daily: { bots: 26, R: 220, dur: 180 },
};
export const XMODE_EVENTS = { goldrush: ["rain"], infection: [], duel: [], daily: true };
export const XMODE_LIST = ["goldrush", "infection", "duel", "daily"];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pill = (cls, html, bar) => `<div class="mode-pill ${cls}">${html}${bar !== undefined ? `<div class="cap"><i style="width:${Math.max(0, Math.min(100, bar * 100))}%"></i></div>` : ""}</div>`;
const line = (g, html) => { if (g._xl !== html) { g._xl = html; g.hud.modeLine(html); } };

// ---------- daily challenge: one seed per calendar day ----------
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
export function dailyDef() { const k = dayKey(), h = hash("ssp-daily-" + k); return { key: k, seed: h % 1000000007, world: h % 3, diff: 2 }; }
export function dailyBoard(p) { const k = dayKey(); if (!p.dailyLb || p.dailyLb.d !== k) p.dailyLb = { d: k, n: 0, list: [] }; return p.dailyLb; }

// ---------- gold rush ----------
const GR = {
  setup(g) {
    const S = g.backend.sim; g.gr = { bank: new Map(), carry: new Map(), chk: 0 };
    g.hill = { x: 0, y: 0, r: 15, t: 0 }; S.attractPt = { x: 0, y: 0, r: 15, w: 0.16 }; GR.move(g, true);
    const orig = S.removeFood.bind(S); // count gold orbs as they are eaten (by = eater id)
    S.removeFood = (i, by) => { if (by && S.fa[i] && S.fc[i] === GOLD_FC && g.gr) { g.gr.carry.set(by, (g.gr.carry.get(by) || 0) + 1); const me = g.backend.me; if (me && by === me.id) g.app.audio.play("coin"); } orig(i, by); };
    GR.top(g, 26); g.hud.banner("◆ " + t("grStart"), 2200);
  },
  move(g, first) { const R = g.backend.R, a = Math.random() * 6.283, d = first ? R * 0.12 : R * (0.2 + Math.random() * 0.4), h = g.hill; h.x = Math.cos(a) * d; h.y = Math.sin(a) * d; h.t = 0; const P = g.backend.sim.attractPt; if (P) { P.x = h.x; P.y = h.y; } if (!first) { g.hud.banner("◆ " + t("grMoved"), 1500); g.app.audio.play("warn"); } },
  top(g, want) { const S = g.backend.sim; let n = 0; for (let i = 0; i < S.FM; i++) if (S.fa[i] && S.fc[i] === GOLD_FC) n++; for (let k = n; k < want; k++) { const [x, y] = S.randPos(g.backend.R - 6); if (S.fCount < S.FM - 80) S.spawnFood(x, y, 3.5, GOLD_FC); } },
  rule(g, dt) {
    const S = g.backend.sim, G = g.gr, h = g.hill, me = g.backend.me; h.t += dt; if (h.t > 45) GR.move(g);
    if ((G.chk += dt) > 1) { G.chk = 0; GR.top(g, 26); }
    for (const s of S.snakes) { if (!s.alive) continue; const c = G.carry.get(s.id) || 0; if (!c) continue;
      if (Math.hypot(s.x - h.x, s.y - h.y) < h.r) { const b = (G.bank.get(s.id) || 0) + c; G.bank.set(s.id, b); G.carry.set(s.id, 0);
        if (me && s === me) { g.app.audio.play("chime"); haptic.pattern([12, 30, 12]); g.hud.banner("◆ " + t("grBanked", { n: c }), 1300, "sub"); g.r.ring && g.r.ring(h.x, h.y, [1, 0.85, 0.35], h.r); }
        if (b >= g.M.target) { g.endMatch(s === me, "goldrush"); return; } } }
    const c = me ? G.carry.get(me.id) || 0 : 0, b = me ? G.bank.get(me.id) || 0 : 0;
    line(g, pill("gr " + (c >= 5 ? "hot" : ""), `◆ ${t("grCarry", { n: c })} · ${t("grBank", { n: b, x: g.M.target })}${c >= 5 ? " · " + t("grHint") : ""}`, b / g.M.target));
  },
  view(g, v) { const h = g.hill, me = g.backend.me, c = me ? g.gr.carry.get(me.id) || 0 : 0; v.hill = { x: h.x, y: h.y, r: h.r, c: c > 0 ? [0.35, 1, 0.55] : [1, 0.8, 0.25] }; },
  lb(g) { return [...g.gr.bank.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => ({ s: g.findSnake(id), v })).filter((x) => x.s); },
  onAnyDeath(g, s) { const G = g.gr; if (!G) return; const c = G.carry.get(s.id) || 0; G.carry.delete(s.id); const S = g.backend.sim; for (let k = 0; k < c; k++) { const a = Math.random() * 6.283, d = 1 + Math.random() * 5; if (S.fCount < S.FM - 60) S.spawnFood(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 3.5, GOLD_FC); } },
  respawn() { return true; },
  timeUp(g) { g.killer = null; const r = [...g.gr.bank.entries()].sort((a, b) => b[1] - a[1]); const me = g.backend.me; g.endMatch(!!(me && r.length && r[0][0] === me.id && r[0][1] > 0), "goldrush"); },
  score(g) { const me = g.backend.me; return (me ? g.gr.bank.get(me.id) || 0 : 0) * 100 + g.stats.kills * 50; },
  hud() { return { kind: "x" }; },
  stat(g) { const me = g.backend.me; return { gold: me ? g.gr.bank.get(me.id) || 0 : 0 }; },
};

// ---------- infection ----------
const INF = {
  setup(g) {
    const S = g.backend.sim, me = g.backend.me; S.teams = true; S.botAggro = 1.25; g.inf = { me: false, mine: 0, turned: 0, humanT: 0 };
    let k = 0; for (const s of S.snakes) { if (s === me) { s.team = 0; continue; } s.team = k++ < 3 ? 1 : 0; if (s.team === 1) s.setMass(C.START_M + 70); }
    g.hud.banner("☣ " + t("infStart"), 2400);
  },
  rule(g, dt) {
    const S = g.backend.sim, me = g.backend.me, I = g.inf; let hum = 0, inf = 0;
    for (const s of S.snakes) { if (s.team === undefined) s.team = s === me ? (I.me ? 1 : 0) : 1; if (!s.alive) continue; if (s.team === 0) hum++; else inf++; }
    if (me && me.alive && !I.me) I.humanT += dt;
    if (I.me && hum === 0 && !g.ended) { g.endMatch(true, "infection"); return; }
    line(g, pill("inf " + (I.me ? "hot" : ""), `☣ ${t("infHumans", { n: hum })} · ${t("infInfected", { n: inf })} · ${I.me ? t("infHunt") : t("infSurvive")}`, hum / Math.max(1, hum + inf)));
  },
  onAnyDeath(g, s, by) { const I = g.inf, me = g.backend.me; if (!I || s.team !== 0) return; I.turned++; const k = by ? g.findSnake(by) : null; if (me && k === me && I.me) { I.mine++; g.hud.banner("☣ " + t("infPlus"), 1000, "sub"); } },
  respawn(g) { const I = g.inf; if (!I.me) { I.me = true; setTimeout(() => g.backend && g.hud.banner("☣ " + t("infTurned"), 2400), 1950); } return true; },
  timeUp(g) { g.killer = null; g.endMatch(!g.inf.me, g.inf.me ? "infection_h" : "infection_s"); },
  score(g) { return Math.round(g.inf.humanT * 10) + g.inf.mine * 150 + g.stats.kills * 50; },
  hud() { return { kind: "x" }; },
  stat(g) { return { infect: g.inf.mine }; },
};

// ---------- duel ----------
const LEG = () => { const L = SKINS.map((s, i) => i).filter((i) => SKINS[i].fx); return L.length ? L[(Math.random() * L.length) | 0] : 0; };
const DUEL = {
  setup(g) { g.duel = { me: 0, riv: 0, round: 1, rival: null, at: 0, skin: LEG() }; DUEL.rival(g); g.hud.banner(t("duelRound", { n: 1 }), 1600); },
  rival(g) {
    const b = g.backend, S = b.sim, me = b.me, a = Math.random() * 6.283;
    const s = S.addSnake(t("duelRival"), { k: "skin", i: g.duel.skin, e: 5, t: 0, n: 0 }, { bot: true, diff: 3, m: C.START_M + 30, pos: me ? [-me.x * 0.2 + Math.cos(a) * b.R * 0.5, -me.y * 0.2 + Math.sin(a) * b.R * 0.5] : undefined });
    s.avt = "p" + ((Math.random() * 16) | 0); s.fr = 3; s.rival = true; if (s.ai && me) s.ai.prey = me.id; g.duel.rival = s;
  },
  rule(g) {
    const D = g.duel, now = performance.now(), S = g.backend.sim, me = g.backend.me;
    if (D.at && now > D.at) { D.at = 0; if (D.rival) S.removeSnake(D.rival); DUEL.rival(g); D.round++; g.hud.banner(t("duelRound", { n: D.round }), 1400); g.app.audio.play("go"); }
    if (D.rival && D.rival.alive && D.rival.ai && me && me.alive && S.tick % 30 === 0) D.rival.ai.prey = me.id;
    line(g, pill("duel", `⚔ ${t("duelScore", { n: D.me, x: D.riv })} · ${t("duelRound", { n: D.round })}`));
  },
  onAnyDeath(g, s) {
    const D = g.duel, me = g.backend.me; if (!D || s !== D.rival || g.ended) return; D.me++; g.app.audio.play("streak");
    if (D.me >= 2) { g.endMatch(true, "duel"); return; }
    g.hud.banner("⚔ " + t("duelWonRound"), 1400); D.at = performance.now() + 1700; g.respawnAt = performance.now() + 1700; // fresh round for both
  },
  respawn(g) { const D = g.duel; D.riv++; if (D.riv >= 2) return false; D.at = performance.now() + 1900; return true; },
  score(g) { return g.duel.me * 1000 + (g.win ? 2000 : 0) + g.stats.kills * 50; },
  hud() { return { kind: "x" }; },
  stat(g) { return {}; },
};

// ---------- daily ----------
const DAILY = {
  setup(g) { g.hud.banner("★ " + t("dailyStart"), 2000); },
  rule() {},
  hud() { return null; },
  stat() { return { daily: 1 }; },
};

export const XMODES = { goldrush: GR, infection: INF, duel: DUEL, daily: DAILY };

// ---------- skill tracking during any match (fury = 3 kills within 20 s, each while boosting) ----------
export const XT = {
  start(g) { g.xt = { ks: [], fury: 0, big: 0 }; g.comboMax = 1; },
  tick(g) { if ((g.comboMulShown || 1) > (g.comboMax || 1)) g.comboMax = g.comboMulShown; },
  kill(g, v) { const X = g.xt || (g.xt = { ks: [], fury: 0, big: 0 }), me = g.backend && g.backend.me, now = performance.now(); if (!me) return;
    if (v && v.m > me.m) X.big++;
    if (me.boosting) { X.ks.push(now); while (X.ks.length && now - X.ks[0] > 20000) X.ks.shift(); if (X.ks.length >= 3) { X.fury++; X.ks.length = 0; g.hud.banner("⚡ " + t("wc_fury"), 1500, "sub"); g.app.audio.play("streak"); } } else { X.ks.length = 0; } },
};

// ---------- weekly skill chain: 3 tiers x 2 skill missions, tier rewards, new set every ISO week ----------
const POOL = [
  ["combo4", "daily", "bigKill", "pu5", "top3"],
  ["fury", "gold15", "infect4", "survive180", "duelRound"],
  ["duelWin", "fury2", "rank1", "goldWin", "infWin"],
];
export const WC_REWARD = [300, 700, 1500];
const isoWeek = () => { const d = new Date(); const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = u.getUTCDay() || 7; u.setUTCDate(u.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(u.getUTCFullYear(), 0, 1)); return u.getUTCFullYear() + "-W" + Math.ceil(((u - y0) / 86400000 + 1) / 7); };
export function wchain(p) {
  const w = isoWeek(); if (p.wchain && p.wchain.w === w && Array.isArray(p.wchain.m)) return p.wchain;
  let h = hash("wc-" + w); const r = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  const m = POOL.map((pool) => { const a = [...pool]; const out = []; while (out.length < 2) out.push(a.splice((r() * a.length) | 0, 1)[0]); return out; });
  p.wchain = { w, m, tier: 0, done: [] }; return p.wchain;
}
export function wcCurrent(p) { const W = wchain(p); if (W.tier >= 3) return null; const id = W.m[W.tier].find((x) => !W.done.includes(x)); return id ? { id, tier: W.tier } : null; }
function met(id, e) {
  switch (id) {
    case "combo4": return e.comboMax >= 4; case "daily": return e.mode === "daily"; case "bigKill": return e.big > 0; case "pu5": return e.pu >= 5; case "top3": return e.mode !== "zen" && e.rank > 0 && e.rank <= 3;
    case "fury": return e.fury >= 1; case "gold15": return (e.gold || 0) >= 15; case "infect4": return (e.infect || 0) >= 4; case "survive180": return e.life >= 180; case "duelRound": return e.mode === "duel" && e.duelMe >= 1;
    case "duelWin": return e.mode === "duel" && e.win; case "fury2": return e.fury >= 2; case "rank1": return e.mode !== "zen" && e.rank === 1; case "goldWin": return e.mode === "goldrush" && e.win; case "infWin": return (e.mode === "infection") && e.win;
  }
  return false;
}
// called once per finished match; returns { done: [ids], tiers: [{n, coins}] } and pays tier rewards
export function wcProgress(p, e) {
  const W = wchain(p), out = { done: [], tiers: [] };
  while (W.tier < 3) { const set = W.m[W.tier]; let any = false; for (const id of set) if (!W.done.includes(id) && met(id, e)) { W.done.push(id); out.done.push(id); any = true; }
    if (set.every((x) => W.done.includes(x))) { const c = WC_REWARD[W.tier]; p.coins += c; out.tiers.push({ n: W.tier + 1, coins: c }); W.tier++; } else break; if (!any) break; }
  return out;
}
// finish hook: weekly chain + daily board; the UI reads game.xres for the results card
export function xFinish(g, score) {
  const p = g.app.store.p, st = g.stats, me = g.backend && g.backend.me, X = g.xt || {}, xm = XMODES[g.mode];
  const e = { mode: g.mode, win: !!g.win, comboMax: g.comboMax || 1, big: X.big || 0, fury: X.fury || 0, pu: st.pu || 0, rank: st.rankBest < 99 ? st.rankBest : 0, life: st.life || 0, duelMe: g.duel ? g.duel.me : 0, ...(xm && xm.stat ? xm.stat(g) : {}) };
  const res = { wc: wcProgress(p, e), daily: null };
  if (g.mode === "daily") { const B = dailyBoard(p); B.n++; const first = B.n === 1; B.list.push({ s: Math.round(score), d: Date.now() }); B.list.sort((a, b) => b.s - a.s); B.list = B.list.slice(0, 10); const pos = B.list.findIndex((x) => x.s === Math.round(score)) + 1; let bonus = 0; if (first) { bonus = 150; p.coins += bonus; } res.daily = { pos, n: B.n, best: B.list[0].s, bonus, list: B.list.slice(0, 5) }; }
  return res;
}
export const wcText = (id) => t("wc_" + id);
export { fmtNum, esc };
