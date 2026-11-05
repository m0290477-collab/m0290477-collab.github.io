// popq: achievement pop-ups wait while the results card is up and show one by one after it is dismissed (they used to
// stack over the card header for ~2 s when several unlocked at once). Pure queue, no DOM: the caller passes
//   blocked()  -> true while the results card is on screen (nothing is shown then)
//   show(a)    -> shows one pop-up
//   gap()      -> ms to wait before the next one (short in menus where 3 stack, a full toast life in a match)
//   later(f,ms)-> timer (setTimeout by default; tests pass a fake clock)
// Nothing here touches coins, the store or the server: achievements are already granted and saved before they queue.
export function makeAchQueue({ blocked, show, gap, later = (f, ms) => setTimeout(f, ms) }) {
  const q = []; let timer = 0;
  const step = () => {
    timer = 0;
    if (!q.length || blocked()) return;       // still on the results card: wait for the next drain() (dismiss / lobby / new match)
    show(q.shift());
    if (q.length) timer = later(step, Math.max(0, gap() | 0)) || 1;
  };
  return {
    // results card up, or others already waiting -> queue; otherwise show now (keeps the old behaviour in menus)
    add(a) { q.push(a); if (!timer) step(); },
    addAll(list) { for (const a of list || []) q.push(a); if (!timer) step(); },
    drain() { if (!timer) step(); },
    get size() { return q.length; },
  };
}
