// Dash rule (owner-approved): while a snake has pu[7] > 0 (Dash) its body and head are harmless to others, it passes
// through bodies and cannot die from them itself. Same rule in Sim.collide (offline + server) and Sim.hitTest (client).
// Run: node dash.test.mjs
const M = await import((process.env.SIM || new URL('../js/sim.js', import.meta.url).href) + '?' + Date.now());
const { Sim, bodyPoints } = M;
let fail = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++; };
function world() { const s = new Sim({ dt: 1 / 60, seed: 3, powerups: false }); s.snakes.length = 0; s.byId.clear(); return s; }
function put(S, name, x, y, a, m) { const s = S.addSnake(name, {}, { pos: [x, y], m }); s.reset(x, y, a, m); s.bornTick = 0; return s; }
function rendered(s) { let sp = Math.max(0.25, s.r * 0.5); if (s.len / sp > 174) sp = s.len / 174; const out = new Float32Array(1200); const n = bodyPoints(s, 0, 0, sp, s.len, out, 176); return { out, n }; }
const T = new Float32Array(1200), T2 = new Float32Array(1200);
for (const mB of [60, 400, 3000]) for (const frac of [0.2, 0.5, 0.8]) {
  // control: B not dashing -> A's head on B's body dies (server) and the client test reports B
  { const S = world(); const B = put(S, 'B', 0, 0, 0, mB); const { out, n } = rendered(B); const j = Math.round(frac * (n - 1)); const A = put(S, 'A', out[j * 2], out[j * 2 + 1], Math.PI / 2, 24);
    ok(Sim.hitTest(A.x, A.y, A.r, [B], T, A, T2) === B.id, `control (B ${mB}, ${frac * 100}%): client hitTest reports B`);
    S.buildGrid(); S.collide(); ok(!A.alive && B.alive, `control (B ${mB}, ${frac * 100}%): A dies on B's body`); }
  // B dashing -> its body is harmless: A lives, on the server sim and in the client test
  { const S = world(); const B = put(S, 'B', 0, 0, 0, mB); B.pu[7] = 1.6; const { out, n } = rendered(B); const j = Math.round(frac * (n - 1)); const A = put(S, 'A', out[j * 2], out[j * 2 + 1], Math.PI / 2, 24);
    ok(Sim.hitTest(A.x, A.y, A.r, [B], T, A, T2) === 0, `dashing B (${mB}, ${frac * 100}%): client hitTest reports no hit`);
    S.buildGrid(); S.collide(); ok(A.alive && B.alive && A.pu[1] === 0, `dashing B (${mB}, ${frac * 100}%): A lives, B lives`); }
  // A dashing through B's body: A cannot die (unchanged rule)
  { const S = world(); const B = put(S, 'B', 0, 0, 0, mB); const { out, n } = rendered(B); const j = Math.round(frac * (n - 1)); const A = put(S, 'A', out[j * 2], out[j * 2 + 1], Math.PI / 2, 24); A.pu[7] = 1.6;
    S.buildGrid(); S.collide(); ok(A.alive && B.alive, `dashing A passes through B (${mB}, ${frac * 100}%): both live`); }
}
// head-on with a dashing snake: neither dies (the dasher is harmless and cannot die)
{ const S = world(); const A = put(S, 'A', -0.5, 0, 0, 60); const B = put(S, 'B', 0.5, 0, Math.PI, 60); B.pu[7] = 1.6; S.buildGrid(); S.collide(); ok(A.alive && B.alive, 'head-on vs a dashing snake: nobody dies'); }
// the owner's case: a dashing snake crossing inside a coil -> the coiled snake's head touching it lives
{ const S = world(); const O = put(S, 'Onyx', 0, 0, 0, 300); O.pu[7] = 1.6; const { out, n } = rendered(O); const j = Math.round(n * 0.6); const A = put(S, 'A', out[j * 2], out[j * 2 + 1], -1.57, 900); S.buildGrid(); S.collide(); ok(A.alive && O.alive, "a dashing Onyx's body under the player's head is harmless"); }
// a shield is not spent on a dashing snake's body
{ const S = world(); const B = put(S, 'B', 0, 0, 0, 400); B.pu[7] = 1; const { out, n } = rendered(B); const j = n >> 1; const A = put(S, 'A', out[j * 2], out[j * 2 + 1], 1.57, 24); A.pu[1] = 10; S.buildGrid(); S.collide(); ok(A.alive && A.pu[1] === 10, 'shield is not spent on a dashing body'); }
// dash ends -> lethal again
{ const S = world(); const B = put(S, 'B', 0, 0, 0, 400); B.pu[7] = 0; const { out, n } = rendered(B); const j = n >> 1; const A = put(S, 'A', out[j * 2], out[j * 2 + 1], 1.57, 24); S.buildGrid(); S.collide(); ok(!A.alive, 'after the dash ends (pu[7] = 0) the body kills again'); }
// with two snakes under the head, a dashing one is skipped but a normal one still kills
{ const S = world(); const B = put(S, 'B', 0, 0, 0, 400); B.pu[7] = 1; const { out, n } = rendered(B); const j = n >> 1; const C2 = put(S, 'C', out[j * 2] + 0.2, out[j * 2 + 1] + 6, -Math.PI / 2, 400);
  const A = put(S, 'A', out[j * 2], out[j * 2 + 1], 1.57, 24); S.buildGrid(); S.collide(); const k = (() => { for (let q = 0; q < S.evDie.length; q += 3) if (S.evDie[q] === A.id) return S.evDie[q + 1]; return -1; })();
  ok(A.alive ? Sim.hitTest(A.x, A.y, A.r, [B, C2], T, A, T2) === 0 : k === C2.id, 'mixed: a kill can only be credited to the non-dashing snake'); }
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
