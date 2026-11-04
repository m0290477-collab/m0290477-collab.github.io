// srv2: premium player ids look distinct wherever an id is shown (profile, player card, friends, search, leaderboard, in-match
// name tag). Regular 7-digit ids stay plain. Tiers: id 1 = owner (red-gold + crown badge), repeated 5-digit (77777) = gold +
// crown, sequential (12345) = violet + star, other 5-digit = teal + diamond. HTML uses a static gradient; a slow shimmer runs
// only when neither calm mode nor reduced motion is on (CSS). Canvas name tags (2D + 3D) use the same gradient, static.
import { idKind } from "./sim.js?v=ops1";
export function pidTier(id) { id = String(id ?? ""); if (id === "1") return "own"; const k = idKind(id); return k === "rep" ? "rep" : k === "seq" ? "seq" : k ? "std" : ""; }
const SV = (d) => `<svg class="pid-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const CROWN = SV("M3 18h18l-1.6-9.5-4.9 4.2L12 5l-2.5 7.7-4.9-4.2Z"), STAR = SV("M12 3.2l2.6 5.6 6.1.7-4.5 4.1 1.2 6.1L12 16.8l-5.4 2.9 1.2-6.1-4.5-4.1 6.1-.7Z"), DIAM = SV("M7 4h10l4 5-9 11L3 9Z");
export const PID_IC = { own: CROWN, rep: CROWN, seq: STAR, std: DIAM };
export const PID_GLYPH = { own: "♛", rep: "♛", seq: "★", std: "◆" };
export const PID_GRAD = { own: ["#ff5a4a", "#ffd36a", "#ff7a3d"], rep: ["#fff0a8", "#f2c230", "#d29516"], seq: ["#e6ccff", "#b07cff", "#8a5cff"], std: ["#c4fff6", "#3fe0d6", "#2bb4e8"] };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// "ID 77777" chip; plain ids keep the old look (class so-id only)
export function pidHtml(id, o = {}) { const k = pidTier(id); if (!k) return `<span class="so-id" dir="ltr">${o.bare ? "" : "ID "}${esc(id)}</span>`;
  return `<span class="so-id pid pid-${k}" dir="ltr" title="${k === "own" ? "Founder" : "Special ID"}">${PID_IC[k]}${k === "own" ? '<i class="pid-own">OWNER</i>' : ""}<b>${o.bare ? "" : "ID "}${esc(id)}</b></span>`; }
// big number (profile ID card)
export function pidBig(id) { const k = pidTier(id); return k ? `<b dir="ltr" class="pid pid-${k} pid-big">${PID_IC[k]}<span>${esc(id)}</span>${k === "own" ? '<i class="pid-own">OWNER</i>' : ""}</b>` : `<b dir="ltr">${esc(id)}</b>`; }
// canvas: fill style for a name tag of a snake whose public id is premium (null = keep the normal colour)
export function pidFill(g, tier, x0, x1) { const c = PID_GRAD[tier]; if (!c) return null; const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, c[0]); gr.addColorStop(0.5, c[1]); gr.addColorStop(1, c[2]); return gr; }
