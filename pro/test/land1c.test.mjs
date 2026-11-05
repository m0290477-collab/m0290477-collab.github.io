// land1 client side: the real Store + js/wallet.js fusing two skins against the real worker code (in process): the server
// decides, the device shows the server's balance and gets the fusion skin in its owned list; a second tap is a no-op.
const mem = new Map();
globalThis.window = globalThis; globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.addEventListener = () => {}; globalThis.document = { hidden: false, addEventListener: () => {} }; globalThis.matchMedia = () => ({ matches: false });
const { Store } = await import("../js/store.js"); const { useServerWallet } = await import("./_wallet_srv.mjs"); const SK = await import("../js/skins.js");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
const S = new Store(), WS = await useServerWallet(S); S.p.coins = 0; await WS.online();
const [a, b] = SK.FUSABLE; for (const i of [a, b]) WS.so.wGive(WS.pid, SK.SKINS[i].id, "test"); WS.add(2500); await WS.online();
ok(S.p.owned.includes(SK.SKINS[a].id) && S.p.coins === 2500, "device sees the two owned skins and the server balance");
const r = await S.fuse(a, b), key = SK.fuKey(a, b); ok(r === "ok" && S.p.owned.includes(key) && WS.bal() === 500 && S.p.coins === 500, "fuse: server charged 2,000 once, the fusion skin is owned on the device (" + key + ")");
const r2 = await S.fuse(b, a); ok(r2 === "own" && WS.bal() === 500, "a second tap on the same pair: no charge");
WS.offline(true); const r3 = await S.fuse(a, SK.FUSABLE[2]); ok(r3 === "offline" || r3 === "na", "offline: fusing needs the server (" + r3 + ")"); WS.offline(false);
const F = SK.fusionDef(SK.fuIdx(a, b)); S.p.skin = { k: "fu", i: F.i }; ok(SK.swatchCss(S.p.skin).startsWith("linear-gradient") && SK.primaryColor(S.p.skin) !== SK.primaryColor({ k: "skin", i: 0 }), "the fusion skin renders from its own palette");
console.log(fail ? "FAIL " + fail : "PASS"); process.exit(fail ? 1 : 0);
