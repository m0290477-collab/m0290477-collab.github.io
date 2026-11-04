// coin1 client side: the real Store + js/wallet.js against the real worker code (in process). Rewards earned on the device are
// queued with their claim ids, paid by the server from its own tables, and the shown balance becomes the server's. Offline,
// claims wait in the queue; purchases are refused. Node only (mocked localStorage).
const mem = new Map();
globalThis.window = globalThis; globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.addEventListener = () => {}; globalThis.document = { hidden: false, addEventListener: () => {} }; globalThis.matchMedia = () => ({ matches: false });
const { Store } = await import("../js/store.js"); const { useServerWallet } = await import("./_wallet_srv.mjs"); const E = await import("../js/econ.js");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const S = new Store(), WS = await useServerWallet(S), W = WS.wl;
S.p.coins = 500; S.p.xp = 0; await WS.online(); ok(WS.bal() === 500 && W.migrated(), "first connect: device balance (500) imported, wallet migrated");
// daily bonus + login + an achievement + two level-ups + a mission, all earned on the device
const b = S.claimDailyBonus(); const lg = S.claimLogin(E.LOGIN, () => null); S.p.stats.food = 5; const ach = S.checkAch();
const lv = S.addXp(E.LV_MAX ? 400 : 0); const m = S.daily(); m[0].p = m[0].g; const ms = S.claimMission(0);
const local = 500 + b + lg.coins + ach.reduce((a, x) => a + x.r, 0) + lv.coins + ms.coins + ms.lv.coins;
ok(S.p.coins === local && W.pending() === local - 500, "rewards show at once on the device (" + local + ") and wait in the claim queue");
await W.flush(); await W.flush();
ok(WS.bal() === local && S.p.coins === local && W.pending() === 0, "the server paid every claim from its own tables: server balance = shown balance (" + WS.bal() + ")");
// forged: the device adds coins by hand -> nothing reaches the server; the next server word puts the display back
S.p.coins += 100000; await WS.online(); ok(S.p.coins === WS.bal() && WS.bal() === local, "a hand-edited device balance is display only and snaps back to the server's");
// replay: the same claims again are paid once
S.p.bonus = ""; const b2 = S.claimDailyBonus(); await W.flush(); ok(b2 > 0 && WS.bal() === local, "a reward claimed again (device state rolled back) is not paid twice");
// offline: claims queue, purchases refused; back online the queue is paid
WS.offline(true); W.claim("match", "m:" + W.claimId(), { mode: "classic", diff: 1, dur: 240, best: 1500, kills: 4, at: Date.now() }, 150); S.p.coins += 150;
const r = await S.buyFlag(5, 300); ok(r === "offline" && W.pending() === 150 && WS.bal() === local, "offline: the match waits in the queue, a purchase is refused (" + r + ")");
WS.offline(false); await W.flush(); const paid = E.plausible({ mode: "classic", diff: 1, dur: 240, best: 1500, kills: 4 }).c;
ok(WS.bal() === local + paid && W.pending() === 0 && S.p.coins === local + paid, "back online the offline match is paid by the server's formula (" + paid + ")");
// queue survives a reload
WS.offline(true); W.claim("ach", "ach:a_hunter", { id: "a_hunter" }, 100); S.flush(); const S2 = new Store(); W.WL.S = S2; ok(W.pending() === 100, "the claim queue survives a reload"); WS.offline(false); await W.flush(); ok(WS.bal() === local + paid + 100, "and is paid after it");
console.log(fail ? "FAILED " + fail : "ALL PASS"); process.exit(fail ? 1 : 0);
