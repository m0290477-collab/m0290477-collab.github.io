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
// --- purchases (coin1: decided by the server wallet; the in-process real worker stands in for it)
const { useServerWallet } = await import("./_wallet_srv.mjs"); const WS = await useServerWallet(S);
S.p.coins = 1000; S.flush(); await WS.online(); ok(WS.bal() === 1000, "first connect imports the device balance once (1,000)"); const fi = FLAGS.findIndex((f, i) => i > 0 && f);
ok((await S.buyFlag(fi, 300)) === "ok" && S.p.coins === 700 && WS.bal() === 700 && S.p.flags.includes(fi), "buy: the server deducts, the device grants");
S._lastBuy = null; const dbl = await S.buyFlag(fi, 300); ok(dbl === "own" && S.p.coins === 700 && WS.bal() === 700 && S.p.flags.filter((x) => x === fi).length === 1, "double-buy refused (no second charge)");
const fj = FLAGS.findIndex((f, i) => i > fi && f); WS.add(-500); S.p.coins = 9999; ok((await S.buyFlag(fj, 300)) === "noCoins" && WS.bal() === 200 && S.p.coins === 200 && !S.p.flags.includes(fj), "insufficient coins on the server: refused even with a forged device balance (shown balance corrected to 200)"); WS.add(500); await WS.online();
ok((await S.buyFlag(fj, 5000)) === "badPrice" && (await S.buyFlag(fj, 100)) === "badPrice" && (await S.buyFlag(fj, 12.5)) === "badPrice" && WS.bal() === 700, "price outside 60-100 % of catalogue / fractional rejected (tampered offer)");
ok((await S.buyFlag(fj, -50)) === "badPrice" && (await S.buyFlag(fj, NaN)) === "badPrice" && WS.bal() === 700, "negative / NaN price rejected");
WS.offline(true); const off = await S.buyFlag(fj, 300); ok(off === "offline" && WS.bal() === 700 && !S.p.flags.includes(fj), "offline: purchase refused, nothing granted"); WS.offline(false);
await sleep(900); failWrites = true; const r = await S.buyFlag(fj, 300); failWrites = false; await sleep(900); S.flush();
ok(r === "ok" && WS.bal() === 400 && S.p.flags.includes(fj), "a failed local write can't lose a purchase: the server holds it and the item stays (" + r + ")");
const S2 = reload(); ok(S2.p.flags.includes(fi) && S2.p.flags.includes(fj), "purchases persisted (reload)");
console.log(fail ? "FAILED " + fail : "ALL PASS"); process.exit(fail ? 1 : 0);
