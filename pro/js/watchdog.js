// perf2 guardian: app watchdog. Detects and recovers from whole-app problems; logs everything to the local error ring
// (store.logErr, localStorage only, no external service). Recovery is gentle and never flashes: one small toast.
//  - main-thread stalls: a 500 ms heartbeat that arrives > 2.5 s late while the page is visible is a stall. Quality = Auto only
//    (an explicit choice is logged, never changed). Two stalls in a match within 60 s (or one > 8 s) lower the 3D tier one step;
//    at the lowest 3D tier three are needed to drop to 2D for this session. The first 6 s of a match and 15 s after each
//    recovery (its own shader rebuild) are ignored, so one recovery can never cascade into the next.
//  - frozen game loop: no rAF tick for 4 s while visible -> the loop is restarted.
//  - errors / unhandled rejections: logged; 5 within 20 s while in a match -> back to the lobby (game.js already does this
//    for an error thrown inside a frame).
//  - WebGL context loss: logged (main.js already rebuilds 3D on restore and drops to 2D if it stays lost for 6 s).
//  - stuck loading screen: boot not finished after 45 s -> reload once in 2D safe mode (sessionStorage ssp-safe).
import { logErr } from "./store.js?v=comp1";
import { t } from "./i18n.js?v=comp1";
export function startWatchdog(app) {
  const W = (app.watchdog = { stalls: [], errs: [], restarts: 0, lastBeat: performance.now(), recovered: [] });
  const toast = (k) => { try { app.ui && app.ui.toast(t(k), "", 3200); } catch (_) {} };
  const inMatch = () => { const g = app.game; return !!(g && g.backend && g.mode !== "show" && g.mode !== "attract" && !g.ended); };
  const recover = (why) => {
    W.recovered.push([Date.now(), why]); logErr("recover", why);
    // hook: the render/perf governor (perf3) may take over stall recovery; if it handles it, the watchdog does nothing more
    try { if (app.gov && typeof app.gov.onStall === "function" && app.gov.onStall(why) === true) return; } catch (e) { logErr("recover", e); }
    const r = app.renderer; if (!r) return;
    if (!r.is2D) {
      const order = ["low", "medium", "high", "ultra"], i = order.indexOf(r.qName);
      if (i > 0) { app.applyQuality(order[i - 1]); toast("wdLighter"); return; }
      if (app.switchRenderer) { app.switchRenderer("2d", "watchdog"); return; } // shows its own "switched to 2D" toast
    } else if (app.gov) { app.gov.level = 3; r.setGov && r.setGov(3); toast("wdLighter"); }
  };
  // heartbeat (stall detector)
  setInterval(() => {
    const now = performance.now(), gap = now - W.lastBeat; W.lastBeat = now;
    if (document.hidden || gap < 2500) return;
    logErr("stall", Math.round(gap) + " ms" + (inMatch() ? " in match" : ""));
    if (!inMatch() || !app.ready || now - (app.game.matchT0 || 0) < 6000 || now < (W.quietUntil || 0)) return; // match start / our own tier rebuild (shader compiles) are not a device problem
    if (!app.store || app.store.settings.quality !== "auto") return; // an explicit quality choice is the player's: log only
    W.stalls.push(now); while (W.stalls.length && now - W.stalls[0] > 60000) W.stalls.shift();
    const r = app.renderer, atFloor = r && !r.is2D && r.qName === "low", need = atFloor ? 3 : 2; // leaving 3D needs more evidence than a lighter tier
    if (W.stalls.length >= need || (gap > 8000 && !atFloor)) { W.stalls.length = 0; W.quietUntil = now + 15000; recover("stall " + Math.round(gap)); }
  }, 500);
  // frozen loop: the game's frame counter must move while the page is visible
  let lastFi = -1, sameT = performance.now();
  setInterval(() => {
    const g = app.game; if (!g || !app.ready || document.hidden) { sameT = performance.now(); return; }
    const fi = (g.fi | 0) + (g.lastFrame | 0); if (fi !== lastFi) { lastFi = fi; sameT = performance.now(); return; }
    if (performance.now() - sameT > 4000) { sameT = performance.now(); W.restarts++; logErr("loop", "no frame for 4 s, restarting the loop"); try { cancelAnimationFrame(g.raf); } catch (_) {} g.raf = 0; g.startLoop(); }
  }, 1000);
  const onErr = (m) => { const now = performance.now(); logErr("error", m); W.errs.push(now); while (W.errs.length && now - W.errs[0] > 20000) W.errs.shift();
    if (W.errs.length >= 5 && inMatch()) { W.errs.length = 0; W.recovered.push([Date.now(), "errors"]); try { app.game.ended = true; app.game.stopMatch(); app.ui.goLobby(); toast("wdLobby"); } catch (_) {} } };
  addEventListener("error", (e) => onErr(e.error || e.message));
  addEventListener("unhandledrejection", (e) => onErr(e.reason || "rejection"));
  // stuck boot
  setTimeout(() => { if (app.ready) return; logErr("boot", "not ready after 45 s"); let tried = false; try { tried = sessionStorage.getItem("ssp-safe") === "2d"; } catch (_) {}
    if (!tried) { try { sessionStorage.setItem("ssp-safe", "2d"); } catch (_) {} location.reload(); } }, 45000);
  return W;
}
// the canvas fires webglcontextlost on itself (it does not bubble); main.js wires each new 3D canvas through this
// listener hooks only: other modules (renderer / perf) can subscribe with onGL(fn) -> fn("lost" | "restored", canvas); recovery itself stays in main.js
const GL_HOOKS = [];
export function onGL(fn) { if (typeof fn === "function") GL_HOOKS.push(fn); return () => { const i = GL_HOOKS.indexOf(fn); if (i >= 0) GL_HOOKS.splice(i, 1); }; }
const glEmit = (k, cv) => { logErr("gl", "context " + k); for (const f of GL_HOOKS.slice()) try { f(k, cv); } catch (e) { logErr("gl", e); } };
export function watchCanvas(cv) { try { cv.addEventListener("webglcontextlost", () => glEmit("lost", cv), false); cv.addEventListener("webglcontextrestored", () => glEmit("restored", cv), false); } catch (_) {} }
