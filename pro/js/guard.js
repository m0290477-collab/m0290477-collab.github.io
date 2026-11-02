// iOS Safari page-gesture guard (taps1). The page itself never moves: html/body are fixed with overflow hidden and
// overscroll-behavior none, every control has touch-action: manipulation (no double-tap zoom, no 300 ms delay) and the
// viewport is pinned at maximum-scale=1. This script only adds what CSS cannot do on iOS:
//  - pinch: Safari's gesture* events and any multi-finger move are cancelled;
//  - page drags: a single-finger move is cancelled only once it has travelled past the tap slop (10 px) and is not
//    inside a real scroll container. Small finger jitter during a tap is never cancelled, because on iOS a cancelled
//    touchmove also cancels the tap's click (that was the "buttons are hard to press" bug);
//  - if the page was offset anyway (address bar, keyboard), it is scrolled back once, without touching the viewport meta.
// Tap feedback: pointerdown marks the pressed control with .prs straight away, so a press shows instantly.
const SCROLLERS = ".pcontent, .modes, .side, .seg, .notif, .mcard, .h-emos, [data-scroll]";
const PRESSABLE = "button, a[href], label, [role=button], .item, .mode, .world, .tab, .sw, .cd";
export function guard() {
  const D = document, opt = { passive: false };
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  const field = (t) => !!(t && t.closest && t.closest("input, textarea, select, [contenteditable]"));
  // Safari's proprietary pinch events
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) D.addEventListener(ev, stop, opt);
  D.addEventListener("dblclick", (e) => { if (!field(e.target)) stop(e); }, opt);
  // the nearest scroll container that can actually scroll (class-marked, no getComputedStyle walk)
  const findScroller = (t) => {
    if (!t || !t.closest || t.closest("#hud")) return null;
    for (let el = t.closest(SCROLLERS); el; el = el.parentElement && el.parentElement.closest(SCROLLERS)) {
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) return el;
    }
    return null;
  };
  let scroller = null, x0 = 0, y0 = 0, dragging = false;
  D.addEventListener("touchstart", (e) => {
    if (e.touches.length > 1) { stop(e); scroller = null; return; }
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dragging = false;
    scroller = field(e.target) ? e.target : findScroller(e.target);
  }, opt);
  D.addEventListener("touchmove", (e) => {
    if (e.touches.length > 1 || (typeof e.scale === "number" && e.scale !== 1)) { stop(e); return; }
    if (scroller) return;
    const t = e.touches[0]; if (!t) return;
    if (!dragging && Math.abs(t.clientX - x0) + Math.abs(t.clientY - y0) < 10) return; // still a tap: leave it alone
    dragging = true; stop(e);
  }, opt);
  D.addEventListener("selectstart", (e) => { if (!field(e.target)) stop(e); });
  D.addEventListener("contextmenu", (e) => { if (!field(e.target)) stop(e); });
  // instant press state
  let pressed = null;
  const unpress = () => { if (pressed) { pressed.classList.remove("prs"); pressed = null; } };
  D.addEventListener("pointerdown", (e) => {
    unpress(); if (e.pointerType === "mouse" && e.button !== 0) return;
    const c = e.target && e.target.closest && e.target.closest(PRESSABLE);
    if (c && !c.disabled) { pressed = c; c.classList.add("prs"); }
  }, { passive: true, capture: true });
  for (const ev of ["pointerup", "pointercancel"]) D.addEventListener(ev, () => setTimeout(unpress, 60), { passive: true, capture: true });
  D.addEventListener("touchmove", (e) => { if (pressed && dragging) unpress(); }, { passive: true });
  addEventListener("blur", unpress);
  // if the page got offset anyway (address bar collapse, keyboard), put it back once; never rewrite the viewport meta
  const fix = () => { if ((window.scrollX || window.scrollY) && !field(D.activeElement)) window.scrollTo(0, 0); };
  const vv = window.visualViewport;
  if (vv) vv.addEventListener("resize", fix);
  addEventListener("scroll", fix, { passive: true });
  addEventListener("orientationchange", () => setTimeout(fix, 350));
  D.addEventListener("focusout", () => setTimeout(fix, 60));
}
