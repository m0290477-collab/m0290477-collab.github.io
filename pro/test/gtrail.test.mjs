// trail1: ground trails. Purchase / equip through the atomic coin path, profile slot validation, decal pool caps and
// calm envelope, and the effect staying out of the simulation (sim.js / server never import it).
import { readFileSync } from "node:fs";
const mem = new Map(); globalThis.window = globalThis; globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.addEventListener = () => {}; globalThis.document = { hidden: false, addEventListener() {} }; globalThis.matchMedia = () => ({ matches: false });
const { Store, econSum, KV } = await import("../js/store.js"); const { GTRAILS, gtIndex } = await import("../js/skins.js"); const { GTrail, GT_CAP } = await import("../js/gfx/gtrail.js");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } else console.log("ok", m); };
ok(GTRAILS.length === 10 && GTRAILS.map((g) => g.id).join() === "dust,ripples,sparks,flowers,snow,toxic,cracks,electric,lava,gold", "exactly the 10 approved trails");
ok(GTRAILS.filter((g) => !g.price).map((g) => g.id).join() === "dust,ripples", "dust + ripples free, the rest paid");
ok(Math.max(...GTRAILS.map((g) => g.price)) === GTRAILS[gtIndex("gold")].price && GTRAILS.filter((g) => g.price === GTRAILS[gtIndex("gold")].price).length === 1, "gold is the most expensive");
ok(GTRAILS.every((g) => g.life >= 0.6 && g.life <= 1.5 && g.a <= 0.8), "life 0.6-1.5 s, soft alpha");
const S = new Store(); const p = S.p; ok(p.gt === "", "default slot: none");
ok(S.equipGTrail(gtIndex("dust")) === "ok" && p.gt === "dust", "free trail equips without buying");
const L = gtIndex("lava"), price = GTRAILS[L].price;
ok(S.equipGTrail(L) === "locked" && p.gt === "dust", "paid trail cannot be equipped before buying");
const { useServerWallet } = await import("./_wallet_srv.mjs"); const WS = await useServerWallet(S); p.coins = price - 1; await WS.online(); // coin1: server wallet (in-process real worker)
ok((await S.buyGTrail(L)) === "noCoins" && p.coins === price - 1 && !p.owned.includes("gt:lava"), "not enough coins: nothing changes");
ok(S.buyGTrail(gtIndex("dust")) === "na", "free trails are never sold");
p.coins = price + 50; ok((await S.buyGTrail(L, 1)) === "badPrice" && p.coins === price + 50, "price below the 60% floor refused");
ok((await S.buyGTrail(L, price + 1)) === "badPrice", "price above catalogue refused");
WS.add(51); const ck0 = econSum(p); ok((await S.buyGTrail(L)) === "ok" && p.coins === 50 && WS.bal() === 50 && p.owned.includes("gt:lava"), "buy: coins deducted on the server, owned");
ok(econSum(p) !== ck0, "ownership is part of the economy checksum");
{ const a = await S.buyGTrail(L); ok(a === "busy" || a === "own", "second buy refused"); }
S._lastBuy = null; ok((await S.buyGTrail(L)) === "own" && WS.bal() === 50, "already owned (no second charge)");
ok(S.equipGTrail(L) === "ok" && p.gt === "lava", "equip after buying"); ok(S.equipGTrail(-1) === "ok" && p.gt === "", "unequip -> none");
S.equipGTrail(L); S.flush(); const S2 = new Store(); ok(S2.p.gt === "lava" && S2.p.owned.includes("gt:lava"), "slot + ownership survive a reload (autosave)");
ok(S._sig().includes("~lava"), "autosave signature tracks the slot");
// tampered slot: an unknown id or an unowned paid trail is cleared on load
const raw = JSON.parse(KV.get("ssp-guest")); raw.gt = "gold"; KV.set("ssp-guest", JSON.stringify(raw)); ok(new Store().p.gt === "", "unowned paid trail in the save -> none");
raw.gt = "<x>"; KV.set("ssp-guest", JSON.stringify(raw)); ok(new Store().p.gt === "", "unknown id -> none");
// decal pool
const snake = { id: 1, alive: true, r: 0.8, X: 0, Y: 0, sx() { return this.X; }, sy() { return this.Y; } }, v = { snakes: [{ me: true, s: snake, o: 0 }] };
const G = new GTrail(); let maxLive = 0, maxA = 0;
for (let f = 0; f < 600; f++) { snake.X += 0.3; G.step(v, 1 / 60, gtIndex("sparks"), { calm: false, low: false, gov: 0 }); maxLive = Math.max(maxLive, G.live); for (let i = 0; i < GT_CAP; i++) maxA = Math.max(maxA, G.ca[i]); }
ok(maxLive > 20 && maxLive <= 120, "hard cap 120 live decals (peak " + maxLive + ")"); ok(maxA <= 0.8, "peak alpha soft (" + maxA.toFixed(2) + ")");
const G2 = new GTrail(); let m2 = 0; for (let f = 0; f < 600; f++) { snake.X += 0.3; G2.step(v, 1 / 60, gtIndex("sparks"), { calm: false, low: true, gov: 0 }); m2 = Math.max(m2, G2.live); } ok(m2 <= 40, "Low quality: <= 40 (" + m2 + ")");
const G3 = new GTrail(); for (let f = 0; f < 200; f++) { snake.X += 0.3; G3.step(v, 1 / 60, gtIndex("lava"), { calm: false, low: false, gov: 3 }); } ok(G3.live === 0, "governor level 3: none");
const G4 = new GTrail(); let a4 = 0, s4 = new Set(); for (let f = 0; f < 300; f++) { snake.X += 0.3; G4.step(v, 1 / 60, gtIndex("electric"), { calm: true, low: false, gov: 0 }); for (let i = 0; i < GT_CAP; i++) if (G4.ca[i] > 0) { a4 = Math.max(a4, G4.ca[i]); s4.add(G4.cs[i]); } }
ok(G4.live > 0 && a4 <= 0.22 && s4.size === 1, "calm: static (no growth), alpha <= 0.22 (" + a4.toFixed(2) + ")");
const G5 = new GTrail(); for (let f = 0; f < 100; f++) { snake.X += 0.3; G5.step(v, 1 / 60, -1, { calm: false, low: false, gov: 0 }); } ok(G5.live === 0, "no trail equipped: nothing spawned");
const v6 = { snakes: [{ me: false, s: snake, o: 0 }] }, G6 = new GTrail(); for (let f = 0; f < 100; f++) { snake.X += 0.3; G6.step(v6, 1 / 60, 0, { calm: false, low: false, gov: 0 }); } ok(G6.live === 0, "other snakes never spawn the local trail");
const G7 = new GTrail(); snake.X = 0; for (let f = 0; f < 120; f++) { snake.X += 0.3; G7.step(v, 1 / 60, gtIndex("dust"), { calm: false, low: false, gov: 0 }); } snake.alive = false; for (let f = 0; f < 120; f++) G7.step(v, 1 / 60, gtIndex("dust"), { calm: false, low: false, gov: 0 }); ok(G7.live === 0, "after death every decal fades out within 2 s"); snake.alive = true;
// cosmetic only
const sim = readFileSync(new URL("../js/sim.js", import.meta.url), "utf8"), srv = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
{ const gl = sim.split("\n").filter((l) => /gtrail|GTRAILS|\bgt\b|GT_IDS/.test(l)); // srv1 (owner-approved): only the sanitizeSkin whitelist + the id list; no rule reads it
  ok(gl.length <= 3 && gl.every((l) => /sanitizeSkin|o\.gt = d\.gt|export const GT_IDS|ground trail ids/.test(l)) && !/\.gt\b/.test(sim.replace(/.*o\.gt = d\.gt.*\n/, "")) && !/gtrail|GTRAILS/.test(srv), "ground trails stay cosmetic: sim.js only whitelists the id for online skins, no rule/collision reads it"); }
console.log(fail ? fail + " FAILED" : "ALL OK"); process.exit(fail ? 1 : 0);
