// iOS Safari page-gesture guard. Safari ignores user-scalable=no for accessibility, so double-tap zoom, pinch zoom,
// text selection, the long-press callout and rubber-band scrolling are stopped here as well as in CSS. Scrollable panels
// (settings, locker, season) and form fields keep their native behaviour.
export function guard() {
  const D = document, opt = { passive: false };
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  const field = (t) => !!(t && t.closest && t.closest("input, textarea, select, [contenteditable]"));
  // Safari's proprietary pinch events
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) D.addEventListener(ev, stop, opt);
  D.addEventListener("dblclick", (e) => { if (!field(e.target)) stop(e); }, opt);
  // double-tap guard: a second tap close in time and space would zoom; cancel it, but keep the tap's click on controls
  let lastT = 0, lx = -99, ly = -99;
  D.addEventListener("touchend", (e) => {
    const n = performance.now(), t = e.changedTouches && e.changedTouches[0]; if (!t) return;
    const quick = n - lastT < 350 && Math.abs(t.clientX - lx) < 48 && Math.abs(t.clientY - ly) < 48;
    lastT = n; lx = t.clientX; ly = t.clientY;
    if (!quick || field(e.target) || e.touches.length) return;
    stop(e); lastT = 0; // a third tap starts a fresh pair
    const c = e.target.closest && e.target.closest("button, a, label, [role=button], .item, .tab, .mode, .sw, [data-v]");
    if (c && !c.disabled) c.click();
  }, opt);
  // pinch / multi-finger and page drags: allow single-finger scrolling only inside a real scroll container
  let scroller = null;
  const findScroller = (el) => {
    for (; el && el !== D.body && el !== D.documentElement; el = el.parentElement) {
      if (el.id === "hud" || el.id === "touch") return null;
      const cs = getComputedStyle(el), oy = cs.overflowY, ox = cs.overflowX;
      if (((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) || ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1)) return el;
    }
    return null;
  };
  D.addEventListener("touchstart", (e) => { if (e.touches.length > 1) { stop(e); scroller = null; return; } scroller = field(e.target) ? e.target : findScroller(e.target); }, opt);
  D.addEventListener("touchmove", (e) => { if (e.touches.length > 1 || (typeof e.scale === "number" && e.scale !== 1) || !scroller) stop(e); }, opt);
  D.addEventListener("selectstart", (e) => { if (!field(e.target)) stop(e); });
  D.addEventListener("contextmenu", (e) => { if (!field(e.target)) stop(e); });
  // if a zoom or page offset slipped through anyway (e.g. the address bar collapsing), snap back
  const vv = window.visualViewport, meta = D.querySelector('meta[name="viewport"]');
  const fix = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    if (vv && vv.scale > 1.01 && meta && !field(D.activeElement)) { const c = meta.content; meta.content = c + ",maximum-scale=1.0"; requestAnimationFrame(() => (meta.content = c)); }
  };
  if (vv) { vv.addEventListener("resize", fix); vv.addEventListener("scroll", fix); }
  addEventListener("scroll", fix, { passive: true }); addEventListener("orientationchange", () => setTimeout(fix, 350));
}
