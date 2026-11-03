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
    ok(!A.alive && B.alive, `head placed ON rendered body point (B mass ${mB}, ${Math.round(frac * 100)}% down the body) -> A dies` + (headsTouch ? ' (heads touch too: only A, the deeper head, dies)' : ', B lives'));
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
// noself1 head-on rule: exactly ONE dies (the deeper head relative to its own radius; tie -> smaller mass), the survivor gets the kill
const dieBy = (S, id) => { for (let j = 0; j < S.evDie.length; j += 3) if (S.evDie[j] === id) return S.evDie[j + 1]; return -1; };
{ const S = world(); const A = put(S, 'A', -0.5, 0, 0, 60); const B = put(S, 'B', 0.5, 0, Math.PI, 60); S.buildGrid(); S.collide();
  ok(A.alive !== B.alive, 'head-on, equal mass, equal depth -> exactly one dies'); const L = A.alive ? B : A, W = A.alive ? A : B; ok(dieBy(S, L.id) === W.id && W.kills === 1, 'the survivor is credited with the kill'); }
{ const S = world(); const A = put(S, 'A', -0.5, 0, 0, 60); const B = put(S, 'B', 0.5, 0, Math.PI, 200); S.buildGrid(); S.collide(); ok(!A.alive && B.alive && dieBy(S, A.id) === B.id, 'head-on, the smaller head (deeper relative to its radius) dies, the bigger survives with the kill'); }
{ const S = world(); const A = put(S, 'A', -0.5, 0, 0, 200); const B = put(S, 'B', 0.5, 0, Math.PI, 60); S.buildGrid(); S.collide(); ok(A.alive && !B.alive, 'same, order swapped'); }
{ const S = world(); const A = put(S, 'A', 0, 0, 0, 60); A.bot = true; const B = put(S, 'B', 0, 0, 0, 60); B.reset(0.6, 0.9, Math.PI, 60); S.buildGrid(); S.collide(); ok(A.alive !== B.alive, 'player vs bot head-on (equal) -> exactly one dies'); }
for (let t = 0; t < 200; t++) { // random head-on sweep: never two deaths between the same pair on one tick
  const S = world(); const mA = 24 + (t * 37) % 900, mB = 24 + (t * 91) % 900, d = 0.2 + (t % 9) * 0.25, a = (t % 13) * 0.4;
  const A = put(S, 'A', 0, 0, a, mA); const B = put(S, 'B', Math.cos(a) * d, Math.sin(a) * d + ((t % 5) - 2) * 0.3, a + Math.PI + ((t % 7) - 3) * 0.2, mB); if (t & 1) A.bot = true;
  S.buildGrid(); S.collide(); if (!A.alive && !B.alive) { ok(false, `double head-on death at case ${t}`); break; } if (t === 199) ok(true, '200 random head-on placements: never both die'); }
// fix1: the ghost power-up is gone (a stale pu[4] does nothing), shield absorbs one hit
{ const S = world(); const B = put(S, 'B', 0, 0, 0, 200); const { out } = rendered(B); const A = put(S, 'A', out[20], out[21], 1.57, 24); A.pu[4] = 3; A.pu[1] = 10; S.buildGrid(); S.collide(); ok(A.alive && A.pu[1] === 0 && S.evShield.length === 2, 'shield absorbs one hit');
  A.inv = 0; S.buildGrid(); S.collide(); ok(!A.alive, 'second hit after shield is used -> death'); }
// client-side hitTest (online self-report) agrees with the server collide
{ const S = world(); const B = put(S, 'B', 0, 0, 0, 300); const { out, n } = rendered(B); let agree = 0, tot = 0;
  for (let j = 1; j < n; j += 3) for (const off of [0, 0.5, 1.2, 3]) { const x = out[j * 2], y = out[j * 2 + 1] + off; const h = Sim.hitTest(x, y, radiusOf(24), [B], new Float32Array(1200)); const S2 = world(); const B2 = put(S2, 'B', 0, 0, 0, 300); const A = put(S2, 'A', x, y, 1.57, 24); S2.buildGrid(); S2.collide(); tot++; if (!!h === !A.alive) agree++; }
  ok(agree / tot > 0.97, `client hitTest matches server collide (${agree}/${tot})`); }
// noself1: client hitTest WITH head-on resolution (me passed) agrees with the server collide on head-on placements
{ let agree = 0, tot = 0; const t1 = new Float32Array(1200), t2 = new Float32Array(1200);
  for (let t = 0; t < 300; t++) { const S = world(); const mA = 24 + (t * 53) % 700, mB = 24 + (t * 29) % 700, d = 0.1 + (t % 11) * 0.22, a = (t % 17) * 0.37;
    const A = put(S, 'A', 0, 0, a, mA); const B = put(S, 'B', Math.cos(a) * d + ((t % 3) - 1) * 0.2, Math.sin(a) * d + ((t % 5) - 2) * 0.25, a + Math.PI + ((t % 7) - 3) * 0.25, mB);
    const hA = Sim.hitTest(A.x, A.y, A.r, [B], t1, A, t2), mut = Sim.mutual; S.buildGrid(); S.collide(); tot++;
    const server = !A.alive ? B.id : 0; if (hA === server) agree++; }
  ok(agree / tot > 0.97, `client hitTest (head-on aware) matches server collide on head-ons (${agree}/${tot})`); }
console.log(fail ? `\n${fail} FAILED` : '\nALL PASS'); process.exit(fail ? 1 : 0);
