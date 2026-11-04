// warm2 server checks: a new public room is seeded as a world ~2-3 min old (grown bots, curved bodies, remains, steady-state food,
// leaderboard + crown at base), then settles for a few ticks only; the bounty never pays for seeded / paused time. Node only, no network.
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
process.env.TZ = "UTC";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const dir = mkdtempSync(join(tmpdir(), "ssp-w2-")); copyFileSync(ROOT + "/server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "/js/" + f, join(dir, f));
const W = await import(join(dir, "index.js")); const E = await import(join(dir, "econ.js")); const SM = await import(join(dir, "sim.js"));
class FakeWs { constructor() { this.out = []; this.open = true; this.L = {}; } send(s) { if (!this.open) throw new Error("closed"); this.out.push(typeof s === "string" ? JSON.parse(s) : s); } close() { this.open = false; } accept() {} addEventListener(k, f) { this.L[k] = f; } }
globalThis.WebSocketPair = function () { const a = new FakeWs(), b = new FakeWs(); return { 0: a, 1: b }; };
const R0 = globalThis.Response; globalThis.Response = class extends R0 { constructor(b, i) { super(b, i && i.status === 101 ? { ...i, status: 200 } : i); if (i && i.webSocket) this.webSocket = i.webSocket; } };
let calls = []; globalThis.fetch = (u) => Promise.reject(new Error("no network in tests: " + u));
const env = { ROOMS: { idFromName: (x) => x, get: (id) => ({ fetch: (u, init) => { calls.push(String(u.url || u)); return Promise.resolve(new R0("{}")); } }) } };
const mk = (name) => { const R = new W.Room({ storage: {} }, env); const t0 = performance.now(); R.init(new URLSearchParams("name_room=" + name)); R._ms = performance.now() - t0; return R; };
// 1) quantile table and sampler
ok(W.WARM2.MQ.length === 21 && W.WARM2.MQ.every((v, i, a) => !i || v >= a[i - 1]) && W.warmMass(0) === 24 && W.warmMass(0.99999) <= 439 && Math.abs(W.warmMass(0.5) - 46) < 0.01, "mass quantiles monotone, 24..439, median 46 (measured 1-3 min play)");
// 2) seeded rooms
const tops = [], meds = [], cpu = [];
for (let r = 0; r < 6; r++) { const R = mk("pub-bs-" + (r + 1)), S = R.sim, al = S.snakes.filter((s) => s.alive), ms = al.map((s) => s.m).sort((a, b) => b - a); tops.push(ms[0]); meds.push(ms[15]); cpu.push(R.seedMs + R.ffMs);
  if (r === 0) {
    ok(al.length === 30 && S.tick === W.WARM2.SIM, "30 bots after a " + W.WARM2.SIM + "-tick settle (was a 240-tick fast-forward)");
    // bodies are curved, not straight spawn tails: heading change along the body
    let curved = 0; for (const s of al) { const k = Math.min(s.n - 2, Math.ceil(s.len / (SM.C.SPEED / 30))); let turn = 0; for (let i = 20; i < k - 20; i += 10) { const a1 = Math.atan2(s.sy(i) - s.sy(i + 10), s.sx(i) - s.sx(i + 10)), a2 = Math.atan2(s.sy(i + 10) - s.sy(i + 20), s.sx(i + 10) - s.sx(i + 20)); turn += Math.abs(SM.angDiff(a1, a2)); } if (turn > 0.3) curved++; }
    ok(curved >= 20, "bodies follow natural curved paths (" + curved + "/30 curved)");
    ok(al.every((s) => s.n >= Math.ceil(s.len / (SM.C.SPEED / 30))), "every body has a full path behind it (drawable at once)");
    ok(al.every((s) => s.x * s.x + s.y * s.y < S.R * S.R), "all heads inside the arena");
    let amb = 0, non = 0; for (let i = 0; i < S.FM; i++) if (S.fa[i]) { if (S.fcl[i]) amb++; else non++; }
    ok(Math.abs(S.fCount - S.foodTarget) / S.foodTarget < 0.03, "food at steady state (" + S.fCount + " vs target " + S.foodTarget + ")");
    ok(non > 0.25 * S.fCount && amb > 0.4 * S.fCount, "remains + ambient mix like a running room (" + non + " remains, " + amb + " ambient)");
    ok(S.feasts.length >= 3 && S.feasts.length <= 18, "fresh corpses exist for bots to race to (" + S.feasts.length / 3 + ")");
    const lb = JSON.parse(R.lbMsg()); ok(lb.lb.length === 10 && lb.lb.some((x) => x[2] > 0) && lb.lb[0][1] > lb.lb[9][1], "leaderboard populated with masses and kills");
    ok(R.bty && R.bty.id === al.slice().sort((a, b) => b.m - a.m)[0].id && Date.now() - R.bty.t0 < 2000 && lb.bt && lb.bt[1] === E.BOUNTY.BASE, "crown on the #1 snake at base ◆" + E.BOUNTY.BASE + " (seeded time never counts)");
    ok(al.every((s) => s.bot && !s.uid), "seeded snakes are plain bots (nobody is paid for them)");
    // bounty kill by a bot pays nobody
    calls = []; const top = R.sim.byId.get(R.bty.id); R.btyKill([[top.id, al.find((s) => s !== top).id, 2]]); ok(!calls.some((u) => /earn/.test(u)) && !R.bty, "a bot killing the crowned bot pays nothing");
    // paused room resumes: short catch-up, bounty back to base
    R.btyReset(); R.bty.t0 = Date.now() - 120000; ok(JSON.parse(R.lbMsg()).bt[1] > E.BOUNTY.BASE, "(setup) an old crown is worth more");
    R.idleAt = Date.now() - 300000; R.timer = null; const t1 = R.sim.tick; await R.fetch(new Request("https://room/ws?name_room=pub-bs-1")).catch(() => {}); clearInterval(R.timer); R.timer = null;
    ok(R.sim.tick - t1 === W.WARM2.RESUME && JSON.parse(R.lbMsg()).bt[1] === E.BOUNTY.BASE, "paused room: " + (R.sim.tick - t1) + "-tick catch-up only, crown back to base (paused time never pays)");
  } }
ok(tops.every((m) => m > 150 && m < 700) && meds.every((m) => m > 30 && m < 90), "sizes match 1-3 min of play: top " + tops.map(Math.round).join(",") + "; median " + meds.map(Math.round).join(","));
ok(Math.max(...cpu.slice(1)) < 200, "warm-up CPU per room (seed + settle, node) " + cpu.map((x) => Math.round(x)).join(",") + " ms (< 200)");
// 3) other rooms unchanged: private rooms keep the old 6-tick start, no-bot rooms stay empty
{ const R = mk("prv-abc"); ok(R.sim.tick === 6 && !R.seedMs, "private rooms keep the old start (6 ticks, not seeded)"); }
{ const R = new W.Room({ storage: {} }, env); R.init(new URLSearchParams("name_room=t-x&bots=0")); ok(R.sim.snakes.length === 0, "no-bot rooms stay empty"); }
// 4) big-start weekend: seeded bots start from the bigger start mass
{ const R = new W.Room({ storage: {} }, env); R.mutOv = "bs"; R.init(new URLSearchParams("name_room=pub-gp-9")); const ms = R.sim.snakes.filter((s) => s.alive).map((s) => s.m); ok(Math.min(...ms) >= 60, "big-start weekend: seeded bots are at least the bigger start size (min " + Math.round(Math.min(...ms)) + ")"); }
console.log(fail ? "FAILED " + fail + " of " + n : "ALL PASS " + n); process.exit(fail ? 1 : 0);
