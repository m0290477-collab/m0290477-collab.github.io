// Collision regression: what is drawn is what kills. Run: node collide.test.mjs
const M = await import((process.env.SIM || new URL('../js/sim.js', import.meta.url).href) + '?' + Date.now());
const { Sim, bodyPoints, HEAD_K, HIT_K, taperAt, sampleSp, radiusOf } = M;
let fail = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++; };
function world() { const s = new Sim({ dt: 1 / 60, seed: 3, powerups: false }); s.snakes.length = 0; s.byId.clear(); return s; }
function put(S, name, x, y, a, m) { const s = S.addSnake(name, {}, { pos: [x, y], m }); s.reset(x, y, a, m); s.bornTick = 0; return s; }
// rendered body points exactly as render3d computes them (spacing max(0.25,r*0.5), interpolation o=1,f=1 == newest sample)
function rendered(s) { let sp = Math.max(0.25, s.r * 0.5); if (s.len / sp > 174) sp = s.len / 174; const out = new Float32Array(1200); const n = bodyPoints(s, 0, 0, sp, s.len, out, 176); return { out, n, sp }; }
for (const mB of [24, 300, 3000]) {
  const rb = radiusOf(mB);
  for (const frac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const S = world(); const B = put(S, 'B', 0, 0, 0, mB); const { out, n } = rendered(B); const j = Math.round(frac * (n - 1));
    const A = put(S, 'A', out[j * 2], out[j * 2 + 1] + 0.0, Math.PI / 2, 24);
    S.buildGrid(); S.collide();
    const headsTouch = Math.hypot(A.x - B.x, A.y - B.y) < (A.r + B.r) * HEAD_K * HIT_K;
    ok(!A.alive && (B.alive || headsTouch), `head placed ON rendered body point (B mass ${mB}, ${Math.round(frac * 100)}% down the body) -> A dies` + (headsTouch ? ' (heads touch too -> both die)' : ', B lives'));
    { let k = -1; for (let q = 0; q < S.evDie.length; q += 3) if (S.evDie[q] === A.id) k = S.evDie[q + 1]; ok(k === B.id, '  killer credited to B'); }
  }
  // edge contact: head edge just touching the rendered side of the body mid-way
  { const S = world(); const B = put(S, 'B', 0, 0, 0, mB); const xm = -B.len * 0.3, A0 = 24, ra = radiusOf(A0) * HEAD_K, side = rb * taperAt(0.3);
    const A = put(S, 'A', xm, side + ra - 0.035 * (side + ra), -Math.PI / 2, A0); S.buildGrid(); S.collide(); ok(!A.alive, `edges overlap by 3.5% (B mass ${mB}) -> death`);
    const S2 = world(); const B2 = put(S2, 'B', 0, 0, 0, mB); const A2 = put(S2, 'A', xm, (side + ra) * 1.06, -Math.PI / 2, A0); S2.buildGrid(); S2.collide(); ok(A2.alive, `6% gap between edges (B mass ${mB}) -> alive`); }
}
// body crossing body without heads = harmless
{ const S = world(); const A = put(S, 'A', 0, 0, 0, 400); const B = put(S, 'B', -A.len * 0.5, A.len * 0.4, -Math.PI / 2, 400); // B's body crosses A's body far from both heads
  // move B's head away from A's body: B points down (-y) and starts above; its head at y=+0.4len, body extends upward
  S.buildGrid(); S.collide(); ok(A.alive && B.alive, 'body crossing body (no head contact) is harmless'); }
// head-on: both die
{ const S = world(); const A = put(S, 'A', -0.5, 0, 0, 60); const B = put(S, 'B', 0.5, 0, Math.PI, 60); S.buildGrid(); S.collide(); ok(!A.alive && !B.alive, 'head-on -> both die'); }
// ghost passes through, shield absorbs one hit
{ const S = world(); const B = put(S, 'B', 0, 0, 0, 200); const { out } = rendered(B); const A = put(S, 'A', out[20], out[21], 1.57, 24); A.pu[4] = 3; S.buildGrid(); S.collide(); ok(A.alive, 'ghost power-up passes through bodies');
  A.pu[4] = 0; A.pu[1] = 10; S.buildGrid(); S.collide(); ok(A.alive && A.pu[1] === 0 && S.evShield.length === 2, 'shield absorbs one hit');
  A.inv = 0; S.buildGrid(); S.collide(); ok(!A.alive, 'second hit after shield is used -> death'); }
// client-side hitTest (online self-report) agrees with the server collide
{ const S = world(); const B = put(S, 'B', 0, 0, 0, 300); const { out, n } = rendered(B); let agree = 0, tot = 0;
  for (let j = 1; j < n; j += 3) for (const off of [0, 0.5, 1.2, 3]) { const x = out[j * 2], y = out[j * 2 + 1] + off; const h = Sim.hitTest(x, y, radiusOf(24), [B], new Float32Array(1200)); const S2 = world(); const B2 = put(S2, 'B', 0, 0, 0, 300); const A = put(S2, 'A', x, y, 1.57, 24); S2.buildGrid(); S2.collide(); tot++; if (!!h === !A.alive) agree++; }
  ok(agree / tot > 0.97, `client hitTest matches server collide (${agree}/${tot})`); }
console.log(fail ? `\n${fail} FAILED` : '\nALL PASS'); process.exit(fail ? 1 : 0);
