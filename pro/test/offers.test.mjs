// perf2 offers: weekly rotation at Monday 00:00, monthly at the 1st, deterministic per date, owned items skipped,
// rarity-aware discounts with floors, occasion picking for sample dates, clock-tamper resilience
const mem = new Map(); globalThis.window = globalThis; globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.addEventListener = () => {}; globalThis.document = { hidden: false, addEventListener() {} }; globalThis.matchMedia = () => ({ matches: false });
const { Store, KV } = await import("../js/store.js"); const O = await import("../js/offers.js");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const S = new Store(); S.p.xp = 0; const ids = (w) => w.items.map((it) => it.k + it.i).join(",");
const sun = new Date(2026, 10, 8, 23, 59), mon = new Date(2026, 10, 9, 0, 0), tue = new Date(2026, 10, 10, 15, 0);
ok(ids(O.weeklyOffers(S, mon)) === ids(O.weeklyOffers(S, tue)), "same week -> same set (Mon 00:00 and Tue)");
ok(ids(O.weeklyOffers(S, sun)) !== ids(O.weeklyOffers(S, mon)), "Sunday 23:59 -> Monday 00:00 rotates");
ok(ids(O.weeklyOffers(S, tue)) === ids(O.weeklyOffers(new Store(), tue)), "deterministic for a given date (fresh profile)");
const w = O.weeklyOffers(S, tue); ok(w.items.length === 4 && w.items.every((it) => it.off >= 15 && it.off <= 40), "4 items, 15-40% off");
ok(w.items.filter((it) => it.rar === "legendary").every((it) => it.off <= 25 && it.price >= Math.ceil(it.base * 0.75)), "legendary: <= 25% off, above floor");
ok(w.ends === new Date(2026, 10, 16).getTime(), "countdown ends next Monday 00:00 local");
const first = w.items[0]; if (first.k === "skin") S.p.owned.push(SKINS_ID(first)); else S.p.flags.push(first.i);
function SKINS_ID(it) { return it.id; }
const w2 = O.weeklyOffers(S, tue); ok(!w2.items.some((it) => it.k === first.k && it.i === first.i) && w2.items.length === 4, "owned item skipped, fallback keeps 4");
const m1 = O.monthlyBundle(S, new Date(2026, 10, 30, 23, 59)), m2 = O.monthlyBundle(S, new Date(2026, 11, 1, 0, 0)), m3 = O.monthlyBundle(S, new Date(2026, 10, 3));
ok(m1.key === m3.key && JSON.stringify(m1.items) === JSON.stringify(m3.items) && m1.key !== m2.key, "monthly bundle: stable in the month, rotates on the 1st");
ok(m1.price < m1.base && m1.price >= Math.ceil(m1.base * 0.6) && m1.ends === new Date(2026, 11, 1).getTime(), "monthly bundle priced below sum, above floor, ends on the 1st");
const occ = (y, m, d) => { const o = O.occasionFor(new Date(y, m - 1, d, 12)); return o ? o.id : null; };
const cases = [[2026, 3, 1, "ramadan"], [2026, 3, 20, "eidFitr"], [2026, 3, 22, "eidFitr"], [2026, 5, 28, "eidAdha"], [2027, 2, 20, "ramadan"], [2030, 4, 14, "eidAdha"], [2026, 12, 31, "newYear"], [2027, 1, 1, "newYear"], [2026, 2, 14, "valentine"], [2026, 10, 3, "iraqDay"], [2026, 10, 31, "halloween"], [2026, 12, 25, "christmas"], [2026, 11, 7, "weekend"], [2026, 11, 4, null]];
for (const [y, m, d, want] of cases) ok(occ(y, m, d) === want, `occasion ${y}-${m}-${d} -> ${want} (${occ(y, m, d)})`);
const ob = O.occasionBundle(S, new Date(2026, 9, 3, 12)); ok(ob && ob.items.some((it) => it.k === "flag" && it.id === "IQ"), "Iraqi National Day bundle features the Iraq flag");
// clock jumps back: keep the last seen rotation
mem.clear(); const t1 = new Date(2026, 10, 10).getTime(); O.stableNow(KV, t1); const back = O.stableNow(KV, t1 - 9 * 86400000); ok(back.getTime() === t1, "clock moved back 9 days -> last seen rotation kept");
// bundle purchase is atomic
// coin1: bundles are bought from the server wallet (in-process real worker): price checked against this month's bundle
{ const { useServerWallet } = await import("./_wallet_srv.mjs"); const WS = await useServerWallet(S); S.p.coins = 100000; await WS.online();
  const b = O.monthlyBundle(S, new Date()); const c0 = S.p.coins; ok((await S.buyBundle(b.key, b.items, b.price)) === "ok" && S.p.coins === c0 - b.price && WS.bal() === c0 - b.price && b.items.every((it) => it.k === "skin" ? S.unlocked("skin", it.i) : S.p.flags.includes(it.i)), "bundle bought: one charge on the server, all items granted");
  S._lastBuy = null; ok((await S.buyBundle(b.key + "x", b.items, b.price)) === "own" && S.p.coins === c0 - b.price && WS.bal() === c0 - b.price, "bundle with owned items refused, no charge"); }
// store1: table covers 2026-2030; weekly always 3-4 items at 15-40 % off with integer prices accepted by the store
for (const y of [2026, 2027, 2028, 2029, 2030]) { const H = O.HIJRI[y]; ok(H && ["ramadan", "eidFitr", "eidAdha"].every((id, k) => { const [yy, mm, dd] = H[k].split("-").map(Number); return occ(yy, mm, dd + 1) === id; }), "Hijri occasions resolve in " + y); }
{ let bad = 0; const S3 = new Store(); for (let w = 0; w < 260; w++) { const d = new Date(2026, 0, 5 + w * 7, 12), o = O.weeklyOffers(S3, d); if (o.items.length < 3 || o.items.length > 4 || o.items.some((it) => it.off < 15 || it.off > 40 || !S3._priceOk(it.price, it.base))) bad++; } ok(bad === 0, "260 weeks 2026-2030: 3-4 items, 15-40 % off, prices within store bounds (bad " + bad + ")"); }
console.log(fail ? "FAILED " + fail : "ALL PASS"); process.exit(fail ? 1 : 0);
