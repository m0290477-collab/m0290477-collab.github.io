// Tiny shared event bus (Track A renderers + Track B audio/UI subscribe; game.js emits).
// Events (payload fields):
//   fx.eat      {me, x, y, v, c}       food eaten (me = by the player; c = food colour index; v = value)
//   fx.grow     {x, y, m}              the player grew past a mass step (ripple runs down the body)
//   fx.levelup  {x, y, n}              the player reached a size tier in-match (n = tier 1..)
//   fx.boost    {on}                   the player started / stopped boosting
//   fx.kill     {x, y, id, by}         a snake died near the player (by = killer id, 0 = wall/self)
//   fx.mykill   {x, y, id}             the player killed someone
//   fx.death    {x, y, cause}          the player died
//   fx.rank1    {x, y}                 the player took first place
//   fx.win      {x, y, reason}         victory (match won / top-1 finish)
// No allocation on the hot path: emit passes the payload object straight through; callers reuse objects.
const L = new Map();
export function on(name, fn) { let a = L.get(name); if (!a) L.set(name, (a = [])); a.push(fn); return () => off(name, fn); }
export function off(name, fn) { const a = L.get(name); if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
export function emit(name, p) { const a = L.get(name); if (!a) return; for (let i = 0; i < a.length; i++) { try { a[i](p); } catch (e) { console.warn("evt", name, e); } } }
