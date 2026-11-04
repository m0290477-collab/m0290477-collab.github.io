// coin1: Privacy / Terms pages. Shows the player's game language (?lang=, then the game's saved setting, then the browser),
// English without JS. The contact line becomes an email link only when CONTACT_EMAIL is set.
import { CONTACT_EMAIL } from "./legal-config.js?v=fix1";
const L = ["en", "ar", "tr", "fr", "es", "hi"];
function pick() { const q = new URLSearchParams(location.search).get("lang"); if (L.includes(q)) return q;
  try { const s = JSON.parse(localStorage.getItem("ssp-set") || "null"); if (s && L.includes(s.lang)) return s.lang; } catch (_) {}
  const n = (navigator.language || "en").slice(0, 2).toLowerCase(); return L.includes(n) ? n : "en"; }
function show(l) { for (const a of document.querySelectorAll("article[data-l]")) a.hidden = a.dataset.l !== l;
  for (const b of document.querySelectorAll("[data-set]")) b.setAttribute("aria-pressed", String(b.dataset.set === l));
  document.documentElement.lang = l; document.documentElement.dir = l === "ar" ? "rtl" : "ltr"; }
if (CONTACT_EMAIL && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(CONTACT_EMAIL)) for (const p of document.querySelectorAll("[data-ct]")) { p.textContent = p.dataset.mail; const a = document.createElement("a"); a.href = "mailto:" + CONTACT_EMAIL; a.textContent = CONTACT_EMAIL; p.appendChild(a); }
for (const b of document.querySelectorAll("[data-set]")) b.addEventListener("click", () => show(b.dataset.set));
show(pick());
