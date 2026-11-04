// Boot: cinematic loading (real progress) → storage → language → renderer (3D, auto-detected tier, 2D fallback) →
// audio/input → studio intro → title flyover → sign-in or lobby. Every failure ends in a friendly message.
import { guard } from "./guard.js?v=srv1";
import { Store, KV } from "./store.js?v=srv1";
import { setLang, applyI18n, t } from "./i18n.js?v=srv1";
import { Audio, haptic } from "./audio.js?v=srv1";
import { Input } from "./input.js?v=srv1";
import { Game } from "./game.js?v=srv1";
import { UI, Hud } from "./ui.js?v=srv1";
import { Renderer2D } from "./render2d.js?v=srv1";
import { startWatchdog, watchCanvas } from "./watchdog.js?v=srv1"; // perf2 guardian

guard();
// ?room=code (shared room link): open the lobby on Online with that room filled in
try { const q = new URLSearchParams(location.search).get("room"); if (q && /^[a-z0-9-]{1,24}$/i.test(q)) window.__ssRoom = q.toLowerCase(); if (q) history.replaceState(null, "", location.pathname); } catch (_) {}
const $ = (id) => document.getElementById(id);
const app = (window.SSP = {}); app.roomParam = window.__ssRoom || "";
startWatchdog(app);
window.__bt = []; const bar = (p, msg) => { window.__bt.push([Math.round(performance.now()), p]); $("bootbar").style.width = p + "%"; $("bootpct").textContent = Math.round(p) + "%"; if (msg) $("bootmsg").textContent = msg; };
let lastErr = 0;
function oops(e) { console.error(e); const n = performance.now(); if (n - lastErr > 4000 && app.ui) { lastErr = n; app.ui.toast(t("oops"), "warn"); } }
addEventListener("error", (e) => oops(e.error || e.message));
addEventListener("unhandledrejection", (e) => oops(e.reason));

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
// resp1: html.touch = this device can touch (phones, tablets, touch laptops). It shows the on-screen boost button and touch sizing;
// without it (mouse + keyboard only) those are hidden. Hybrid devices (iPad + keyboard, touch laptops) keep both inputs live.
{ const H = document.documentElement; let q = null; try { q = matchMedia("(any-pointer: coarse)"); } catch (_) {}
  const can = () => !!(q && q.matches) || navigator.maxTouchPoints > 0 || "ontouchstart" in window; H.classList.toggle("touch", can());
  if (q && q.addEventListener) q.addEventListener("change", () => H.classList.toggle("touch", can()));
  addEventListener("pointerdown", (e) => { if (e.pointerType === "touch" || e.pointerType === "pen") H.classList.add("touch"); }, { passive: true, capture: true }); }
// device tier from the GPU string + memory + cores; dynamic resolution and auto-quality refine it live
function detect() {
  const nv = navigator, mem = nv.deviceMemory || 4, cores = nv.hardwareConcurrency || 4; let gpu = "";
  try { const c = document.createElement("canvas"), gl = c.getContext("webgl2"); if (!gl) return { q: "low", max: "low" }; const ext = gl.getExtension("WEBGL_debug_renderer_info"); gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase(); const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); } catch (_) { return { q: "low", max: "low" }; }
  app.gpu = gpu;
  if (/swiftshader|llvmpipe|software|mesa offscreen/.test(gpu)) return { q: "low", max: "medium" };
  if (isMobile) {
    if (mem <= 3 && !/apple/.test(gpu)) return { q: "low", max: "medium" };
    if (/apple/.test(gpu)) return { q: "medium", max: "high" };
    const ad = /adreno.*?(\d{3})/.exec(gpu), ma = /mali-g(\d+)/.exec(gpu);
    if (ad) { const n = +ad[1]; return n >= 730 ? { q: "high", max: "high" } : n >= 618 ? { q: "medium", max: "high" } : { q: "low", max: "medium" }; }
    if (ma) { const n = +ma[1]; return n >= 710 || n >= 78 ? { q: "medium", max: "high" } : { q: "low", max: "medium" }; }
    return { q: cores >= 8 ? "medium" : "low", max: "high" };
  }
  if (/nvidia|geforce|radeon|rx \d|apple m\d|apple gpu/.test(gpu)) return { q: "ultra", max: "ultra" };
  return { q: "high", max: "ultra" };
}
const DET = detect(); app.maxAuto = ["low", "medium", "high", "ultra"].indexOf(DET.max);
const autoStart = () => DET.q;

async function makeRenderer(kind, quality) {
  const old = $("gl"), cv = document.createElement("canvas"); cv.id = "gl"; cv.setAttribute("aria-hidden", "true"); old.replaceWith(cv);
  let safe = false; try { safe = sessionStorage.getItem("ssp-safe") === "2d"; } catch (_) {} if (safe) kind = "2d"; // guardian: a stuck boot reloads once in 2D
  if (kind === "3d") watchCanvas(cv);
  if (kind === "3d") {
    try {
      const m = await import("./render3d.js?v=srv1");
      const r = new m.Renderer3D(cv, { quality, world: app.store ? app.store.p.last.world || 0 : 0, onLost: () => { clearTimeout(app._lostT); /* fit1: iOS drops the GL context whenever the tab is backgrounded; only a loss that lasts 6 s while the page is VISIBLE means 3D is broken. A background loss used to end in a silent switch to 2D for the session. */ const arm = () => { clearTimeout(app._lostT); app._lostT = setTimeout(() => { if (document.hidden) return; if (app.renderer && app.renderer.lost && !app.renderer.is2D) app.switchRenderer("2d", "context-lost"); }, 6000); }; if (document.hidden) document.addEventListener("visibilitychange", function v() { if (document.hidden) return; document.removeEventListener("visibilitychange", v); if (app.renderer && app.renderer.lost) arm(); }); else arm(); }, onRestored: () => { clearTimeout(app._lostT); /* fit1: rebuild 3D from scratch after a restore (meshes/textures/targets all fresh) instead of trusting a half-restored GL state */ setTimeout(() => { if (app.renderer && !app.renderer.is2D) app.switchRenderer("3d"); }, 50); } });
      return r;
    } catch (e) { console.warn("3D unavailable", e); app.noWebgl = true; const c2 = document.createElement("canvas"); c2.id = "gl"; cv.replaceWith(c2); return new Renderer2D(c2); }
  }
  return new Renderer2D(cv);
}

app.applyQuality = (q) => {
  const r = app.renderer; if (!r) return; r.setQuality(q); document.documentElement.classList.toggle("lowfx", q === "low"); document.documentElement.classList.remove("blur"); // calm1: no backdrop-filter anywhere (very expensive on iOS)
  const S0 = app.store.settings; r.setOptions({ postFx: S0.postFx && !(isMobile && q !== "high" && q !== "ultra"), juice: S0.juice && !S0.reduceMotion && !S0.calmFx, reduceMotion: S0.reduceMotion, calm: S0.calmFx, resMode: S0.res || "high", userLow: S0.quality === "low" }); document.documentElement.classList.toggle("calm", !!S0.calmFx);
};
app.switchRenderer = async (kind, auto) => {
  const w = app.game.world ?? app.store.p.last.world ?? 0;
  if (app.renderer) try { app.renderer.dispose(); } catch (_) {}
  const q = app.store.settings.quality === "auto" ? (kind === "3d" ? autoStart() : "low") : app.store.settings.quality;
  app.renderer = await makeRenderer(kind, q); app.game.setRenderer(app.renderer);
  app.renderer.setArena(app.game.backend ? app.game.backend.R : 130); app.renderer.setWorld(w); app.applyQuality(q === "auto" ? autoStart() : q);
  // an automatic drop to 2D lasts for this session only: the saved choice stays 3D, so the next launch retries 3D
  if (auto) { app.session2D = true; try { KV.set("ssp-fall2d", JSON.stringify({ t: Date.now(), why: auto === true ? "slow" : String(auto) })); } catch (_) {} app.ui.toast(t("auto2d"), "", 4500); }
  if (app.noWebgl && kind === "3d") { app.ui.toast(t("noWebgl"), "warn", 4500); app.noWebgl = false; }
};
app.applyLang = () => { setLang(app.store.settings.lang); applyI18n(); if (app.ui && app.ui.cur === "lobby") app.ui.renderLobby(); };
app.applySetting = (k) => {
  const s = app.store.settings, H = document.documentElement, r = app.renderer;
  switch (k) {
    case "quality": app.applyQuality(s.quality === "auto" ? autoStart() : s.quality); break;
    case "renderer": app.switchRenderer(s.renderer); break;
    case "showFps": $("h-fps").classList.toggle("x-hide", !s.showFps); break;
    case "minimap": $("h-mini").classList.toggle("x-hide", !s.minimap); break;
    case "res": case "postFx": case "juice": case "reduceMotion": case "calmFx": if (r) app.applyQuality(r.qName || (s.quality === "auto" ? autoStart() : s.quality)); H.classList.toggle("rm", s.reduceMotion); break;
    case "ctrl": case "sens": case "left": app.input.configure(s); H.classList.toggle("lefty", s.left); break;
    case "boostSize": $("boost").style.setProperty("--bs", s.boostSize); break;
    case "boostPos": $("boost").style.setProperty("--bp", s.boostPos); break;
    case "haptics": haptic.on = s.haptics; if (s.haptics && app.ready) haptic.tap(20); break;
    case "vMaster": case "vSfx": case "vMusic": case "vUi": app.audio.setVol({ master: s.vMaster, sfx: s.vSfx, music: s.vMusic, ui: s.vUi ?? 0.8 }); break;
    case "cb": app.game.palettes(); H.classList.toggle("cb", s.cb); break;
    case "bigText": H.classList.toggle("big", s.bigText); break;
    case "lang": app.applyLang(); break;
  }
};
app.applyAll = () => { for (const k of ["showFps", "minimap", "postFx", "ctrl", "boostSize", "boostPos", "haptics", "vMaster", "cb", "bigText"]) app.applySetting(k); app.applyLang(); };

async function boot() {
  bar(6);
  const store = (app.store = new Store()); store.warn = (k) => app.ui && app.ui.toast(t(k), "warn"); store.startAutosave();
  setLang(store.settings.lang); applyI18n(); bar(14, t("loading"));
  const art = new Image(); art.onload = () => document.getElementById("ld-art").classList.add("hi"); art.src = "assets/keyart.webp";
  app.audio = new Audio(); app.input = new Input($("touch"), $("boost"), $("joy")); app.hud = new Hud(app);
  app.game = new Game(app); app.ui = new UI(app); app.ui.tip();
  app.input.onPause = () => app.game.pause(!app.game.paused);
  app.input.headScreen = () => { const b = app.game.backend, me = b && b.me; if (!me || !app.renderer) return [innerWidth / 2, innerHeight / 2]; const p = app.renderer.project(me.x, me.y, me.r); return [p[0], p[1]]; };
  bar(26, t("loadEngine"));
  const q = store.settings.quality === "auto" ? autoStart() : store.settings.quality;
  app.renderer = await makeRenderer(store.settings.renderer, q); bar(62, t("loadWorld"));
  app.game.setRenderer(app.renderer); app.applyQuality(q); app.applyAll();
  // wait for the first world's sky + ground to stream in (bounded), and the display font
  const t0 = performance.now();
  while (app.renderer.worldReady && !app.renderer.worldReady() && performance.now() - t0 < 30000) { bar(62 + Math.min(28, (performance.now() - t0) / 120)); await new Promise((r) => setTimeout(r, 80)); }
  if (app.renderer.warm) { bar(92, t("loadShaders")); await Promise.race([app.renderer.warm, new Promise((r) => setTimeout(r, 20000))]); }
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch (_) {}
  bar(100, t("ready"));
  // resp1: resize / rotation / mobile toolbar changes re-fit the canvas and the menu preview live (no reload); one rAF per burst
  let rzQ = 0; const rz = () => { if (rzQ) return; rzQ = requestAnimationFrame(() => { rzQ = 0; if (app.renderer) app.renderer.resize(); if (app.game) app.game.redraw(); if (app.ui && app.ui.cur && app.game && app.game.mode === "show") app.ui.updateShow(); }); };
  addEventListener("resize", rz); addEventListener("orientationchange", () => setTimeout(rz, 300)); if (window.visualViewport) visualViewport.addEventListener("resize", rz);
  const unlock = () => { app.audio.unlock(); if (!app.audio.musicOn) app.audio.music(true, app.game.world || 0, app.game.mode !== "attract" ? true : true); }; // iOS Safari only lets audio start inside touchend/click (pointerdown alone is not always a valid gesture), and an "interrupted"
  // context (call, Siri, app switch) must be resumed by the next gesture: listen to all of them, unlock() is idempotent and cheap
  for (const ev of ["pointerdown", "touchend", "click", "keydown"]) addEventListener(ev, unlock, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) app.audio.duck(true); else { app.audio.duck(false); if (app.audio.ctx && app.audio.ctx.state !== "running") try { app.audio.ctx.resume(); } catch (_) {} } });
  addEventListener("pageshow", () => { if (app.audio.ctx && app.audio.ctx.state !== "running") try { app.audio.ctx.resume(); } catch (_) {} });
  if (!KV.ok) setTimeout(() => app.ui.toast(t("noStorage"), "warn", 6000), 1200);
  if (store.repairs.some((r) => /restored/.test(r))) setTimeout(() => app.ui.toast(t("wdRestored"), "good", 4500), 1600); // guardian: a damaged save was restored from its backup
  if (app.noWebgl) setTimeout(() => app.ui.toast(t("noWebgl"), "warn", 5000), 1500);
  app.ready = true;
  await new Promise((r) => setTimeout(r, 250));
  app.game.startAttract(store.p.last.world || 0, true);
  $("boot").classList.add("out");
  // fit1: once this tab got past the title, a reload (iOS restores an evicted tab by reloading it) goes straight to the lobby:
  // no studio intro, no second title screen flashing in over the restored page
  let seen = false; try { seen = !!sessionStorage.getItem("ssp-title"); } catch (_) {}
  if (!seen) { await app.ui.intro(); await app.ui.title(); try { sessionStorage.setItem("ssp-title", "1"); } catch (_) {} }
  if (store.cur) app.ui.afterLogin(); else app.ui.showAuth();
}
boot().catch((e) => { console.error(e); $("bootmsg").textContent = "Error: " + (e && e.message ? e.message : e); });
