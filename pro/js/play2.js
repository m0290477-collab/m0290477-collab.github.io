// play2: weekend rule banner (lobby), home-screen icon variants (Profile), one-thumb + bounty strings. No sound, nothing flashes.
import { t, addStrings } from "./i18n.js?v=top1";
import { mutNow, weekendMut } from "./sim.js?v=top1";
import { CF } from "./admin2.js?v=top1";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const MUT_IC = { df: "🍬", fb: "⚡", bs: "🐍", ff: "🌱" };
// the rule in force now (owner override from the server config, else the Fri-Sun UTC schedule) and, Mon-Thu, the next weekend's
export function mutState(now = Date.now()) { const ov = (CF.cfg && CF.cfg.mut) || "auto", k = mutNow(ov, now); if (k) return { k, live: 1 };
  if (ov !== "auto") return null; const d = new Date(now), wd = d.getUTCDay(), fri = now + ((5 - wd + 7) % 7) * 86400000; return { k: weekendMut(Date.UTC(new Date(fri).getUTCFullYear(), new Date(fri).getUTCMonth(), new Date(fri).getUTCDate(), 12)), live: 0 }; }
export function mutBar() { const host = document.querySelector("#s-lobby .col-c"); if (!host) return; let el = $("l-mut"); const M = mutState();
  if (!M || !M.k) { if (el) el.classList.add("x-hide"); return; }
  if (!el) { el = document.createElement("div"); el.id = "l-mut"; el.className = "mut-pill glass"; el.setAttribute("role", "status"); host.insertBefore(el, host.firstChild); }
  el.classList.remove("x-hide"); el.classList.toggle("live", !!M.live);
  el.innerHTML = `<span class="mi" aria-hidden="true">${MUT_IC[M.k]}</span><span class="mt"><b>${esc(t(M.live ? "p2_mutNow" : "p2_mutNext"))}: ${esc(t("p2_mut_" + M.k))}</b><small>${esc(t("p2_mutSub_" + M.k))} · ${esc(t("p2_mutWhen"))}</small></span>`; }

// ---------- home-screen icon variants (unlocked by level) ----------
export const ICONS = [{ id: 0, lv: 1, n: "p2_ic0" }, { id: 1, lv: 10, n: "p2_ic1" }, { id: 2, lv: 25, n: "p2_ic2" }, { id: 3, lv: 50, n: "p2_ic3" }];
const icSrc = (i, sz) => (i ? `assets/ic/i${i}-${sz}.png` : `assets/icon-${sz}.png`);
export const iconId = () => { try { const v = +localStorage.getItem("ssp-icon") || 0; return ICONS[v] ? v : 0; } catch (_) { return 0; } };
export function applyIcon(i = iconId()) { const a = document.querySelector('link[rel="apple-touch-icon"]'), m = document.querySelector('link[rel="manifest"]');
  if (a) a.setAttribute("href", icSrc(i, 180)); if (m) m.setAttribute("href", i ? `manifest-i${i}.webmanifest` : "manifest.webmanifest"); }
export function iconCard(lv) { const cur = iconId();
  return `<div class="pv-card p2-ic"><div class="pv-h">📱 ${t("p2_icT")}</div><p class="fine">${t("p2_icSub")}</p><div class="p2-ics">${ICONS.map((I) => { const ok = lv >= I.lv, on = I.id === cur;
    return `<button class="p2-icb ${on ? "on" : ""} ${ok ? "" : "lock"}" data-ic="${I.id}" aria-pressed="${on}" ${ok ? "" : 'aria-disabled="true"'}><img src="${icSrc(I.id, 180)}" alt="" width="56" height="56" loading="lazy"><b>${t(I.n)}</b><small>${on ? "✓ " + t("equipped") : ok ? t("equip") : "🔒 " + t("p2_icLv", { n: I.lv })}</small></button>`; }).join("")}</div></div>`; }
export function bindIcon(ui, el, lv) { el.querySelectorAll("[data-ic]").forEach((b) => ui.click(b, () => { const I = ICONS[+b.dataset.ic]; if (!I) return;
  if (lv < I.lv) { ui.toast("🔒 " + t("p2_icLv", { n: I.lv })); return; } try { localStorage.setItem("ssp-icon", String(I.id)); } catch (_) {} applyIcon(I.id); ui.renderProfile(); ui.toast("✓ " + t("p2_icDone"), "good", 5200); }, "tab")); }

addStrings({
  p2_mutNow: ["Weekend rule", "قانون الويكند", "Hafta sonu kuralı", "Règle du week-end", "Regla de fin de semana", "वीकेंड नियम"],
  p2_mutNext: ["This weekend", "هذا الويكند", "Bu hafta sonu", "Ce week-end", "Este fin de semana", "इस वीकेंड"],
  p2_mutWhen: ["online rooms, Fri–Sun UTC", "غرف الأونلاين، جمعة–أحد UTC", "çevrim içi odalar, Cum–Paz UTC", "salons en ligne, ven–dim UTC", "salas online, vie–dom UTC", "ऑनलाइन रूम, शुक्र–रवि UTC"],
  p2_mut_df: ["Double food", "أكل دبل", "Çift yem", "Nourriture x2", "Comida doble", "दोगुना खाना"],
  p2_mut_fb: ["Free boost", "تسريع ببلاش", "Bedava hız", "Boost gratuit", "Turbo gratis", "मुफ़्त बूस्ट"],
  p2_mut_bs: ["Big start", "بداية كبيرة", "Büyük başlangıç", "Gros départ", "Inicio grande", "बड़ी शुरुआत"],
  p2_mut_ff: ["Fast food", "أكل سريع", "Hızlı yem", "Nourriture rapide", "Comida rápida", "तेज़ खाना"],
  p2_mutSub_df: ["every candy counts twice", "كل حلاوة تنحسب مرتين", "her şeker iki kat", "chaque bonbon compte double", "cada dulce cuenta doble", "हर कैंडी दोगुनी"],
  p2_mutSub_fb: ["boosting costs no mass", "التسريع ما ياكل من حجمك", "hızlanmak kütle harcamaz", "le boost ne coûte rien", "el turbo no gasta masa", "बूस्ट में द्रव्यमान नहीं घटता"],
  p2_mutSub_bs: ["every snake starts 3× bigger", "كل حية تبدي أكبر ٣ مرات", "her yılan 3× büyük başlar", "chaque serpent démarre 3× plus gros", "cada serpiente empieza 3× más grande", "हर साँप 3× बड़ा शुरू"],
  p2_mutSub_ff: ["food grows back twice as fast", "الأكل يرجع أسرع بمرتين", "yem iki kat hızlı çıkar", "la nourriture repousse 2× plus vite", "la comida reaparece 2× más rápido", "खाना दोगुनी तेज़ी से"],
  p2_mutOn: ["Weekend rule: {k}", "قانون الويكند: {k}", "Hafta sonu kuralı: {k}", "Règle du week-end : {k}", "Regla del finde: {k}", "वीकेंड नियम: {k}"],
  p2_btyGot: ["Bounty claimed! +◆{n}", "صدت الجايزة! +◆{n}", "Ödül senin! +◆{n}", "Prime empochée ! +◆{n}", "¡Recompensa cobrada! +◆{n}", "इनाम मिला! +◆{n}"],
  p2_btyOnMe: ["You wear the crown: bounty ◆{n}", "التاج عليك: الجايزة ◆{n}", "Taç sende: ödül ◆{n}", "Tu portes la couronne : prime ◆{n}", "Llevas la corona: recompensa ◆{n}", "ताज तुम्हारा: इनाम ◆{n}"],
  p2_icT: ["Home-screen icon", "أيقونة الشاشة الرئيسية", "Ana ekran simgesi", "Icône d'écran d'accueil", "Icono de inicio", "होम-स्क्रीन आइकन"],
  p2_icSub: ["Pick a style. To apply it, remove the game from your home screen and add it again.", "اختار شكل. حتى يتطبق، شيل اللعبة من الشاشة الرئيسية وضيفها من جديد.", "Bir stil seç. Uygulamak için oyunu ana ekrandan kaldırıp yeniden ekle.", "Choisis un style. Pour l'appliquer, retire le jeu de l'écran d'accueil puis ajoute-le à nouveau.", "Elige un estilo. Para aplicarlo, quita el juego de la pantalla de inicio y vuelve a añadirlo.", "स्टाइल चुनो। लागू करने के लिए गेम को होम स्क्रीन से हटाकर फिर से जोड़ो।"],
  p2_icDone: ["Icon saved. Re-add the game to your home screen to see it.", "انحفظت الأيقونة. ضيف اللعبة للشاشة الرئيسية من جديد حتى تشوفها.", "Simge kaydedildi. Görmek için oyunu ana ekrana yeniden ekle.", "Icône enregistrée. Ajoute à nouveau le jeu à l'écran d'accueil pour la voir.", "Icono guardado. Vuelve a añadir el juego a la pantalla de inicio para verlo.", "आइकन सेव हुआ। देखने के लिए गेम को होम स्क्रीन पर फिर से जोड़ो।"],
  p2_icLv: ["Level {n}", "مستوى {n}", "Seviye {n}", "Niveau {n}", "Nivel {n}", "लेवल {n}"],
  p2_ic0: ["Gold", "ذهبي", "Altın", "Or", "Oro", "सुनहरा"], p2_ic1: ["Emerald", "زمرد", "Zümrüt", "Émeraude", "Esmeralda", "पन्ना"], p2_ic2: ["Amethyst", "جمشت", "Ametist", "Améthyste", "Amatista", "जामुनी"], p2_ic3: ["Frost", "ثلجي", "Buz", "Givre", "Escarcha", "पाला"],
  p2_one: ["One-thumb mode", "وضع الإبهام الواحد", "Tek başparmak modu", "Mode une main", "Modo un pulgar", "एक-अंगूठा मोड"],
  p2_oneSub: ["Drag anywhere to steer. Boost: hold a second finger, or double-tap and hold.", "اسحب بأي مكان للتوجيه. التسريع: ثبّت إصبع ثاني، أو دگ دگتين وثبّت.", "Yönlendirmek için her yerde sürükle. Hız: ikinci parmağı basılı tut ya da çift dokunup basılı tut.", "Glisse n'importe où pour diriger. Boost : garde un 2e doigt posé, ou double-touche et maintiens.", "Arrastra en cualquier lugar para girar. Turbo: mantén un segundo dedo o toca dos veces y mantén.", "कहीं भी खींचकर मोड़ो। बूस्ट: दूसरी उंगली दबाए रखो, या डबल-टैप करके दबाए रखो।"],
  a2_mut: ["Weekend rule", "قانون الويكند", "Hafta sonu kuralı", "Règle du week-end", "Regla del finde", "वीकेंड नियम"],
  a2_mutAuto: ["Auto (Fri–Sun UTC)", "تلقائي (جمعة–أحد UTC)", "Otomatik (Cum–Paz UTC)", "Auto (ven–dim UTC)", "Auto (vie–dom UTC)", "ऑटो (शुक्र–रवि UTC)"],
  a2_mutOff: ["Off", "مطفي", "Kapalı", "Désactivé", "Apagado", "बंद"],
  a2_mutNowIs: ["In force now", "شغال هسه", "Şu an geçerli", "En vigueur", "Activa ahora", "अभी लागू"],
  a2_flags: ["All flags", "كل الأعلام", "Tüm bayraklar", "Tous les drapeaux", "Todas las banderas", "सभी झंडे"],
});
