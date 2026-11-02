// Boot: storage → language → renderer (3D with 2D fallback) → audio/input → game + UI. Every failure ends in a friendly toast.
import { Store, KV } from "./store.js";
import { setLang, applyI18n, t } from "./i18n.js";
import { Audio, haptic } from "./audio.js";
import { Input } from "./input.js";
import { Game } from "./game.js";
import { UI, Hud } from "./ui.js";
import { Renderer2D } from "./render2d.js";

const $ = (id) => document.getElementById(id);
const bar = (p, msg) => { $("bootbar").style.width = p + "%"; if (msg) $("bootmsg").textContent = msg; };
const app = (window.SSP = {});
let lastErr = 0;
function oops(e) { console.error(e); const n = performance.now(); if (n - lastErr > 4000 && app.ui) { lastErr = n; app.ui.toast(t("oops"), "warn"); } }
addEventListener("error", (e) => oops(e.error || e.message));
addEventListener("unhandledrejection", (e) => oops(e.reason));

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
function autoStart() { return isMobile ? "medium" : "high"; }

async function makeRenderer(kind, quality) {
  const old = $("gl"), cv = document.createElement("canvas"); cv.id = "gl"; cv.setAttribute("aria-hidden", "true"); old.replaceWith(cv);
  if (kind === "3d") {
    try {
      const m = await import("./render3d.js");
      return new m.Renderer3D(cv, { quality, onLost: () => app.ui && app.ui.toast(t("oops"), "warn"), onRestored: () => {} });
    } catch (e) { console.warn("3D unavailable", e); app.noWebgl = true; const c2 = document.createElement("canvas"); c2.id = "gl"; cv.replaceWith(c2); return new Renderer2D(c2); }
  }
  return new Renderer2D(cv);
}

app.applyQuality = (q) => {
  const r = app.renderer; if (!r) return; r.setQuality(q); document.documentElement.classList.toggle("lowfx", q === "low");
  r.setOptions({ postFx: app.store.settings.postFx, juice: app.store.settings.juice && !app.store.settings.reduceMotion, reduceMotion: app.store.settings.reduceMotion });
};
app.switchRenderer = async (kind, auto) => {
  const w = app.game.world ?? app.store.p.last.world ?? 0;
  if (app.renderer) try { app.renderer.dispose(); } catch (_) {}
  const q = app.store.settings.quality === "auto" ? (kind === "3d" ? autoStart() : "low") : app.store.settings.quality;
  app.renderer = await makeRenderer(kind, q); app.game.setRenderer(app.renderer);
  app.renderer.setArena(app.game.backend ? app.game.backend.R : 130); app.renderer.setWorld(w); app.applyQuality(q === "auto" ? autoStart() : q);
  if (auto) { app.store.settings.renderer = "2d"; app.store.save(); app.ui.toast(t("autoLow")); }
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
  bar(12);
  const store = (app.store = new Store()); store.warn = (k) => app.ui && app.ui.toast(t(k), "warn");
  setLang(store.settings.lang); applyI18n(); bar(25, t("loading"));
  app.audio = new Audio(); app.input = new Input($("touch"), $("boost"), $("joy")); app.hud = new Hud(app);
  app.game = new Game(app); app.ui = new UI(app);
  app.input.onPause = () => app.game.pause(!app.game.paused);
  app.input.headScreen = () => { const b = app.game.backend, me = b && b.me; if (!me || !app.renderer) return [innerWidth / 2, innerHeight / 2]; const p = app.renderer.project(me.x, me.y, me.r); return [p[0], p[1]]; };
  bar(40);
  const q = store.settings.quality === "auto" ? autoStart() : store.settings.quality;
  app.renderer = await makeRenderer(store.settings.renderer, q); bar(85);
  app.game.setRenderer(app.renderer); app.applyQuality(q); app.applyAll();
  app.game.startAttract(store.p.last.world || 0);
  addEventListener("resize", () => app.renderer && app.renderer.resize()); addEventListener("orientationchange", () => setTimeout(() => app.renderer && app.renderer.resize(), 300));
  const unlock = () => { app.audio.unlock(); app.audio.music(true, app.game.world || 0); }; addEventListener("pointerdown", unlock, { passive: true }); addEventListener("keydown", unlock);
  bar(100);
  if (store.cur) app.ui.afterLogin(); else app.ui.showAuth();
  setTimeout(() => $("boot").classList.add("out"), 150); setTimeout(() => $("boot").remove(), 800);
  if (!KV.ok) setTimeout(() => app.ui.toast(t("noStorage"), "warn", 6000), 1200);
  if (app.noWebgl) setTimeout(() => app.ui.toast(t("noWebgl"), "warn", 5000), 1500);
  app.ready = true;
}
boot().catch((e) => { console.error(e); $("bootmsg").textContent = "Error: " + (e && e.message ? e.message : e); });
