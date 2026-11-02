// Boot: cinematic loading (real progress) → storage → language → renderer (3D, auto-detected tier, 2D fallback) →
// audio/input → studio intro → title flyover → sign-in or lobby. Every failure ends in a friendly message.
import { guard } from "./guard.js?v=m1a";
import { Store, KV } from "./store.js?v=m1a";
import { setLang, applyI18n, t } from "./i18n.js?v=m1a";
import { Audio, haptic } from "./audio.js?v=m1a";
import { Input } from "./input.js?v=m1a";
import { Game } from "./game.js?v=m1a";
import { UI, Hud } from "./ui.js?v=m1a";
import { Renderer2D } from "./render2d.js?v=m1a";

guard();
const $ = (id) => document.getElementById(id);
const app = (window.SSP = {});
window.__bt = []; const bar = (p, msg) => { window.__bt.push([Math.round(performance.now()), p]); $("bootbar").style.width = p + "%"; $("bootpct").textContent = Math.round(p) + "%"; if (msg) $("bootmsg").textContent = msg; };
let lastErr = 0;
function oops(e) { console.error(e); const n = performance.now(); if (n - lastErr > 4000 && app.ui) { lastErr = n; app.ui.toast(t("oops"), "warn"); } }
addEventListener("error", (e) => oops(e.error || e.message));
addEventListener("unhandledrejection", (e) => oops(e.reason));

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
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
  if (kind === "3d") {
    try {
      const m = await import("./render3d.js?v=m1a");
      const r = new m.Renderer3D(cv, { quality, world: app.store ? app.store.p.last.world || 0 : 0, onLost: () => { clearTimeout(app._lostT); app._lostT = setTimeout(() => { if (app.renderer && app.renderer.lost && !app.renderer.is2D) app.switchRenderer("2d", "context-lost"); }, 3500); }, onRestored: () => { clearTimeout(app._lostT); } });
      return r;
    } catch (e) { console.warn("3D unavailable", e); app.noWebgl = true; const c2 = document.createElement("canvas"); c2.id = "gl"; cv.replaceWith(c2); return new Renderer2D(c2); }
  }
  return new Renderer2D(cv);
}

app.applyQuality = (q) => {
  const r = app.renderer; if (!r) return; r.setQuality(q); document.documentElement.classList.toggle("lowfx", q === "low"); document.documentElement.classList.toggle("blur", (q === "high" || q === "ultra") && !r.is2D);
  r.setOptions({ postFx: app.store.settings.postFx, juice: app.store.settings.juice && !app.store.settings.reduceMotion, reduceMotion: app.store.settings.reduceMotion });
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
    case "postFx": case "juice": case "reduceMotion": if (r) r.setOptions({ postFx: s.postFx, juice: s.juice && !s.reduceMotion, reduceMotion: s.reduceMotion }); H.classList.toggle("rm", s.reduceMotion); break;
    case "ctrl": case "sens": case "left": app.input.configure(s); H.classList.toggle("lefty", s.left); break;
    case "boostSize": $("boost").style.setProperty("--bs", s.boostSize); break;
    case "boostPos": $("boost").style.setProperty("--bp", s.boostPos); break;
    case "haptics": haptic.on = s.haptics; if (s.haptics && app.ready) haptic.tap(20); break;
    case "vMaster": case "vSfx": case "vMusic": app.audio.setVol({ master: s.vMaster, sfx: s.vSfx, music: s.vMusic }); break;
    case "cb": app.game.palettes(); H.classList.toggle("cb", s.cb); break;
    case "bigText": H.classList.toggle("big", s.bigText); break;
    case "lang": app.applyLang(); break;
  }
};
app.applyAll = () => { for (const k of ["showFps", "minimap", "postFx", "ctrl", "boostSize", "boostPos", "haptics", "vMaster", "cb", "bigText"]) app.applySetting(k); app.applyLang(); };

async function boot() {
  bar(6);
  const store = (app.store = new Store()); store.warn = (k) => app.ui && app.ui.toast(t(k), "warn");
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
  addEventListener("resize", () => app.renderer && app.renderer.resize()); addEventListener("orientationchange", () => setTimeout(() => app.renderer && app.renderer.resize(), 300));
  const unlock = () => { app.audio.unlock(); if (!app.audio.musicOn) app.audio.music(true, app.game.world || 0, app.game.mode !== "attract" ? true : true); }; addEventListener("pointerdown", unlock, { passive: true }); addEventListener("keydown", unlock);
  if (!KV.ok) setTimeout(() => app.ui.toast(t("noStorage"), "warn", 6000), 1200);
  if (app.noWebgl) setTimeout(() => app.ui.toast(t("noWebgl"), "warn", 5000), 1500);
  app.ready = true;
  await new Promise((r) => setTimeout(r, 250));
  app.game.startAttract(store.p.last.world || 0, true);
  $("boot").classList.add("out");
  await app.ui.intro();
  await app.ui.title();
  if (store.cur) app.ui.afterLogin(); else app.ui.showAuth();
}
boot().catch((e) => { console.error(e); $("bootmsg").textContent = "Error: " + (e && e.message ? e.message : e); });
