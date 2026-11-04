// perf2 guardian + purchase protection (Node, mocked localStorage): corruption restore, tamper restore, autosave,
// atomic purchase (double-buy, insufficient coins, bad price, failed-save rollback)
const mem = new Map(); let failWrites = false;
globalThis.window = globalThis; globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { if (failWrites && k !== "ssp-probe" && k !== "ssp-errlog") throw new Error("QuotaExceededError"); mem.set(k, String(v)); }, removeItem: (k) => mem.delete(k) };
const L = {}; globalThis.addEventListener = (e, f) => { (L[e] = L[e] || []).push(f); }; globalThis.document = { hidden: false, addEventListener: (e, f) => { (L["doc:" + e] = L["doc:" + e] || []).push(f); } }; globalThis.matchMedia = () => ({ matches: false });
const { Store, econSum, KV } = await import("../js/store.js"); const { FLAGS } = await import("../js/skins.js");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fresh = () => { const S = new Store(); return S; }; // a "reload": new Store over the same storage (KV caches values, so drop its memo)
const reload = () => { for (const k of [...mem.keys()]) KV.set(k, mem.get(k)); return new Store(); };
// --- autosave: a change is on disk within ~1 s, with no explicit save() call
mem.clear(); let S = fresh(); S.startAutosave(); S.p.coins = 777; S.p.xp = 1234; await sleep(1200);
ok(JSON.parse(mem.get("ssp-guest")).coins === 777, "autosave: coins written within 1.2 s without save()");
S = reload(); ok(S.p.coins === 777 && S.p.xp === 1234, "autosave: value persists after reload");
// --- immediate flush on pagehide
S.startAutosave(); S.p.coins = 778; (L.pagehide || []).slice(-1)[0](); ok(JSON.parse(mem.get("ssp-guest")).coins === 778, "pagehide flushes immediately");
// --- no blind writes: nothing changed -> nothing written
S.flush(); let writes = 0; const set0 = localStorage.setItem; localStorage.setItem = (k, v) => { if (k !== "ssp-errlog") writes++; set0(k, v); }; S.flush(); S.flush(); localStorage.setItem = set0; ok(writes === 0, "unchanged state: zero writes (" + writes + ")");
// --- backup exists after flushes
S._backup(JSON.stringify({ v: 1, a: S.acc }), JSON.stringify(S.guest), true); const bak = JSON.parse(mem.get("ssp-bak")); ok(bak.v === 1 && bak.g.coins === 778 && bak.g._ck === econSum(bak.g), "last-known-good backup written and verifiable");
// --- corruption: truncated guest save -> restored from backup instead of a new profile
mem.set("ssp-guest", mem.get("ssp-guest").slice(0, 40)); S = reload(); ok(S.p.coins === 778 && S.repairs.includes("guest:restored"), "corrupt save restored from backup (coins " + S.p.coins + ")");
// --- tamper: coins edited by hand (checksum mismatch) -> economy restored from backup, nothing granted
S.flush(); S._backup(JSON.stringify({ v: 1, a: S.acc }), JSON.stringify(S.guest), true); const g = JSON.parse(mem.get("ssp-guest")); g.coins = 999999; g.flags = [1, 2, 3]; mem.set("ssp-guest", JSON.stringify(g));
S = reload(); ok(S.p.coins === 778 && S.p.flags.length === 0 && S.repairs.some((r) => /tamper-restored/.test(r)), "tampered coins/flags restored to last-known-good (" + S.p.coins + ")");
ok(JSON.parse(mem.get("ssp-errlog") || "[]").some((e) => e.k === "tamper"), "tamper logged in the local error ring");
// --- purchases
S.p.coins = 1000; S.flush(); const fi = FLAGS.findIndex((f, i) => i > 0 && f); 
ok(S.buyFlag(fi, 300) === "ok" && S.p.coins === 700 && S.p.flags.includes(fi), "buy: deducts and grants atomically");
ok(S.buyFlag(fi, 300) !== "ok" && S.p.coins === 700 && S.p.flags.filter((x) => x === fi).length === 1, "double-buy refused (no second charge)");
const fj = FLAGS.findIndex((f, i) => i > fi && f); S.p.coins = 200; ok(S.buyFlag(fj, 300) === "noCoins" && S.p.coins === 200 && !S.p.flags.includes(fj), "insufficient coins: refused, balance untouched"); S.p.coins = 700;
ok(S.buyFlag(fj, 5000) === "badPrice" && S.buyFlag(fj, 100) === "badPrice" && S.buyFlag(fj, 12.5) === "badPrice" && S.p.coins === 700, "price outside 60-100 % of catalogue / fractional rejected (tampered offer)");
ok(S.buyFlag(fj, -50) === "badPrice" && S.buyFlag(fj, NaN) === "badPrice" && S.p.coins === 700, "negative / NaN price rejected");
S.p.coins = NaN; ok(S.buyFlag(fj, 300) === "badBalance" && S.p.coins === 0, "NaN balance rejected and clamped"); S.p.coins = 700;
await sleep(900); failWrites = true; const r = S.buyFlag(fj, 200); failWrites = false;
ok(r === "saveFail" && S.p.coins === 700 && !S.p.flags.includes(fj), "failed save: purchase rolled back (" + r + ", coins " + S.p.coins + ")");
await sleep(900); ok(S.buyFlag(fj, 200) === "ok" && S.p.coins === 500, "after storage recovers the same purchase works");
const S2 = reload(); ok(S2.p.coins === 500 && S2.p.flags.includes(fi) && S2.p.flags.includes(fj), "purchases persisted immediately (reload)");
console.log(fail ? "FAILED " + fail : "ALL PASS"); process.exit(fail ? 1 : 0);
