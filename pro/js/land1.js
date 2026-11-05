// land1: Territory mode (وضع الأراضي) on the device side + Skin fusion (مزج السكنات) in the Skins screen.
// Territory: the offline match vs bots (a Track B mode hook set: the shared Terr in sim.js runs inside Sim.step), and the
// helpers the game uses for online territory rooms (the server owns the cells; net.js keeps a mirror): slot colours from
// each snake's skin, the live % list (top 5 + you), the round bar and the round result. Calm: no sound, nothing flashes.
// Fusion: pick two owned skins, see the result, pay the fee on the server (wallet), equip it. All text in 6 languages.
import { t, fmtNum, addStrings } from "./i18n.js?v=3dperf";
import { XMODES, XMODE_CFG, XMODE_EVENTS } from "./modes.js?v=3dperf";
import { Terr, TER } from "./sim.js?v=3dperf";
import { SKINS, primaryColor, swatchCss, FUSABLE, fuIdx, fuKey, fuParse, fusionDef, FUSION_FEE, RAR_COL } from "./skins.js?v=3dperf";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pc = (v) => (Math.round(v * 10) / 10).toFixed(1);

addStrings({
  m_territory: ["Territory", "الأراضي", "Bölge", "Territoire", "Territorio", "क्षेत्र"],
  m_territory_s: ["Paint the map, loop to claim", "لوّن الأرض وسكّر الدائرة", "Haritayı boya, çevirip al", "Peins la carte, boucle pour prendre", "Pinta el mapa y ciérralo", "नक्शा रंगो, घेरकर जीतो"],
  m_territory_d: ["Your snake colours the ground. Close a loop to claim everything inside. 3 minutes: most of the map wins.", "حيّتك تلوّن الأرض اللي تمشي عليها. سكّر دائرة حتى تمتلك كل اللي جوّاها. 3 دقايق: الأكثر أرضاً يفوز.", "Yılanın geçtiği yeri boyar. İçini almak için döngüyü kapat. 3 dakika: haritanın çoğu kimdeyse o kazanır.", "Ton serpent colore le sol. Ferme une boucle pour prendre tout l'intérieur. 3 minutes : le plus de carte gagne.", "Tu serpiente colorea el suelo. Cierra un círculo para quedarte con todo lo de dentro. 3 minutos: gana quien tenga más mapa.", "तुम्हारा साँप ज़मीन रंगता है। अंदर का सब लेने के लिए घेरा बंद करो। 3 मिनट: सबसे ज़्यादा नक्शा जीतता है।"],
  vic_territory: ["You hold the most land", "عندك أكثر أرض", "En çok toprak sende", "Tu tiens le plus de terrain", "Tienes más territorio", "सबसे ज़्यादा ज़मीन तुम्हारी"],
  def_territory: ["Another snake held more land", "حيّة ثانية عندها أرض أكثر", "Başka bir yılan daha çok toprak tuttu", "Un autre serpent avait plus de terrain", "Otra serpiente tenía más territorio", "किसी और साँप के पास ज़्यादा ज़मीन थी"],
  ter_start: ["Paint the ground · close a loop to claim it", "لوّن الأرض · سكّر الدائرة حتى تصير إلك", "Zemini boya · almak için döngüyü kapat", "Peins le sol · ferme la boucle pour le prendre", "Pinta el suelo · cierra el círculo para quedártelo", "ज़मीन रंगो · लेने के लिए घेरा बंद करो"],
  ter_over: ["Round over", "خلص الدور", "Tur bitti", "Manche terminée", "Ronda terminada", "राउंड खत्म"],
  ter_res: ["#{p} · {n}% of the map", "#{p} · {n}% من الخريطة", "#{p} · haritanın %{n}'i", "#{p} · {n} % de la carte", "#{p} · {n}% del mapa", "#{p} · नक्शे का {n}%"],
  ter_land: ["Land", "الأرض", "Toprak", "Terrain", "Territorio", "ज़मीन"],
  ter_round: ["Round {n}", "الدور {n}", "{n}. tur", "Manche {n}", "Ronda {n}", "राउंड {n}"],
  ter_newRound: ["New round · 3:00 · tap Play again", "دور جديد · 3:00 · اضغط العب مرة ثانية", "Yeni tur · 3:00 · Tekrar oyna'ya dokun", "Nouvelle manche · 3:00 · touche Rejouer", "Nueva ronda · 3:00 · toca Jugar otra vez", "नया राउंड · 3:00 · फिर खेलो दबाओ"],
  ter_online: ["Online", "أونلاين", "Çevrimiçi", "En ligne", "En línea", "ऑनलाइन"],
  ter_bots: ["vs Bots", "ضد البوتات", "Botlara karşı", "Contre bots", "Contra bots", "बॉट्स से"],
  ter_codeHint: ["Room code (empty = public)", "رمز الغرفة (فارغ = عامة)", "Oda kodu (boş = herkese açık)", "Code du salon (vide = public)", "Código de sala (vacío = pública)", "रूम कोड (खाली = सार्वजनिक)"],
  ter_fade: ["Your land fades back to neutral", "أرضك ترجع محايدة شوي شوي", "Toprağın yavaşça boşalıyor", "Ton terrain redevient neutre", "Tu territorio vuelve a ser neutral", "तुम्हारी ज़मीन धीरे-धीरे खाली हो रही है"],
  tro_ter: ["Territory trophies come from the round result", "كؤوس الأراضي تجي من نتيجة الدور", "Bölge kupaları tur sonucundan gelir", "Les trophées Territoire viennent du résultat de la manche", "Los trofeos de Territorio salen del resultado de la ronda", "क्षेत्र की ट्रॉफ़ी राउंड के नतीजे से मिलती है"],
  lk_fusion: ["Fusion", "مزج", "Füzyon", "Fusion", "Fusión", "फ़्यूज़न"],
  fu_sub: ["Pick two skins you own. Fusing makes one new skin from both — you keep the two. Each pair once.", "اختار سكنين تملكهم. المزج يسوي سكن جديد من الاثنين — وتبقى عندك الاثنين. كل زوج مرة وحدة.", "Sahip olduğun iki görünüm seç. Füzyon ikisinden yeni bir görünüm yapar — ikisi de sende kalır. Her çift bir kez.", "Choisis deux skins que tu possèdes. La fusion en crée un nouveau — tu gardes les deux. Une fois par paire.", "Elige dos aspectos tuyos. La fusión crea uno nuevo con los dos — conservas ambos. Una vez por pareja.", "अपनी दो स्किन चुनो। फ़्यूज़न दोनों से एक नई स्किन बनाता है — दोनों तुम्हारे पास रहती हैं। हर जोड़ी एक बार।"],
  fu_pick: ["Choose skin {n}", "اختار السكن {n}", "{n}. görünümü seç", "Choisis le skin {n}", "Elige el aspecto {n}", "स्किन {n} चुनो"],
  fu_go: ["Fuse · ◆ {n}", "امزج · ◆ {n}", "Birleştir · ◆ {n}", "Fusionner · ◆ {n}", "Fusionar · ◆ {n}", "फ़्यूज़ करो · ◆ {n}"],
  fu_sure: ["Tap again to fuse · ◆ {n}", "اضغط مرة ثانية للمزج · ◆ {n}", "Birleştirmek için tekrar dokun · ◆ {n}", "Touche encore pour fusionner · ◆ {n}", "Toca otra vez para fusionar · ◆ {n}", "फ़्यूज़ के लिए फिर दबाओ · ◆ {n}"],
  fu_have: ["Already fused", "ممزوج من قبل", "Zaten birleştirildi", "Déjà fusionné", "Ya fusionado", "पहले ही फ़्यूज़ हो चुका"],
  fu_need: ["You need two skins you bought or earned (level skins and flags can't be fused).", "تحتاج سكنين اشتريتهم أو ربحتهم (سكنات المستوى والأعلام ما تنمزج).", "Satın aldığın ya da kazandığın iki görünüm gerekir (seviye görünümleri ve bayraklar birleştirilemez).", "Il te faut deux skins achetés ou gagnés (les skins de niveau et les drapeaux ne fusionnent pas).", "Necesitas dos aspectos comprados o ganados (los de nivel y las banderas no se fusionan).", "दो ख़रीदी या जीती हुई स्किन चाहिए (लेवल स्किन और झंडे फ़्यूज़ नहीं होते)।"],
  fu_mine: ["Your fusion skins", "سكنات المزج مالتك", "Füzyon görünümlerin", "Tes skins de fusion", "Tus aspectos de fusión", "तुम्हारी फ़्यूज़न स्किन"],
  fu_none: ["No fusion skins yet", "ما عندك سكن ممزوج بعد", "Henüz füzyon görünümü yok", "Pas encore de skin de fusion", "Aún no tienes aspectos de fusión", "अभी कोई फ़्यूज़न स्किन नहीं"],
  fu_new: ["New fusion skin: {n}", "سكن ممزوج جديد: {n}", "Yeni füzyon görünümü: {n}", "Nouveau skin de fusion : {n}", "Nuevo aspecto de fusión: {n}", "नई फ़्यूज़न स्किन: {n}"],
  fu_tag: ["Fusion", "مزج", "Füzyon", "Fusion", "Fusión", "फ़्यूज़न"],
  fu_of: ["{a} + {b}", "{a} + {b}", "{a} + {b}", "{a} + {b}", "{a} + {b}", "{a} + {b}"],
  fu_kept: ["Both skins stay yours.", "السكنين يبقون إلك.", "İki görünüm de sende kalır.", "Les deux skins restent à toi.", "Los dos aspectos siguen siendo tuyos.", "दोनों स्किन तुम्हारी रहती हैं।"],
  fu_wait: ["Fusing…", "جاري المزج…", "Birleştiriliyor…", "Fusion…", "Fusionando…", "फ़्यूज़ हो रहा है…"],
});

// ---------- territory: offline match vs bots ----------
Object.assign(XMODE_CFG, { territory: { bots: TER.BOTS_OFF, R: TER.R_OFF, dur: TER.DUR } });
XMODE_EVENTS.territory = ["rain", "drops"];
export const terOf = (g) => { const b = g && g.backend; return b ? (b.sim ? b.sim.ter || null : b.ter || null) : null; };
const mySlot = (g, T) => { const me = g.backend && g.backend.me; return me && me.alive && T ? T.slotOf.get(me.id) || 0 : 0; };
// round result from the player's point of view: place by land among the snakes still on the map
export function terPlace(g) { const T = terOf(g); if (!T) return null; const s = mySlot(g, T), top = T.top(0); return { place: s ? T.rankOf(s) : Math.max(2, top.length + 1), field: Math.max(2, top.length + (s ? 0 : 1)), pct: s ? T.pct(s) : 0 }; }
const TERX = {
  setup(g) { const b = g.backend, S = b.sim; S.ter = new Terr(b.R, { dt: S.dt, rand: S.rand }); g.terPk = 0; g.hud.banner("▦ " + t("ter_start"), 2600); },
  rule(g) { const T = terOf(g); if (!T) return; const s = mySlot(g, T); if (s) g.terPk = Math.max(g.terPk || 0, T.pct(s)); line(g); },
  lb(g) { return terLb(g); },
  respawn() { return true; }, // land fades, the round goes on: back in with a fresh patch
  timeUp(g) { g.killer = null; const P = terPlace(g); g.terFinal = P; g.endMatch(!!(P && P.place === 1 && P.pct > 0), "territory"); },
  score(g) { const P = g.terFinal || terPlace(g) || { pct: 0 }; return Math.round(P.pct * 100) + Math.round((g.terPk || 0) * 40) + g.stats.kills * 50; },
  place(g) { const P = g.terFinal || terPlace(g); return P ? P.place : "—"; },
  field(g) { const P = g.terFinal || terPlace(g); return P ? P.field : 2; },
  best(g) { return Math.max(g.stats.best, (g.terPk || 0) * TER.PCT_BEST); }, // land counts like mass in the coin formula (same caps)
  hud() { return { kind: "x" }; },
  stat(g) { return { land: Math.round(g.terPk || 0) }; },
};
XMODES.territory = TERX;

// ---------- shared by offline and online ----------
const DOT = new Map();
const rgbOf = (skin) => { const k = JSON.stringify(skin || {}); let c = DOT.get(k); if (!c) { const h = primaryColor(skin || {}), n = parseInt(h.slice(1), 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; DOT.set(k, c); if (DOT.size > 400) DOT.delete(DOT.keys().next().value); } return c; };
// each slot takes the colour of its snake's skin (lifted a little toward white so land reads as "ground", not as a body)
export function terColors(g, T) { let ch = 0;
  for (let s = 1; s < 256; s++) { const id = T.idOf[s]; if (!id || T.colOk[s]) continue; let c = null;
    if (id > 0) { const sn = g.findSnake(id); if (!sn) continue; c = rgbOf(sn.skin); } else c = [138, 148, 166]; // a fading slot nobody saw: neutral grey
    const o = s * 3; T.rgb[o] = Math.round(c[0] * 0.82 + 255 * 0.18); T.rgb[o + 1] = Math.round(c[1] * 0.82 + 255 * 0.18); T.rgb[o + 2] = Math.round(c[2] * 0.82 + 255 * 0.18); T.colOk[s] = 1; ch++; }
  if (ch) T.colV++; }
// the renderer's view: the grid + which slot is "you" (drawn a little stronger)
export function terView(g, v) { const T = terOf(g); if (!T) { v.terr = null; return; } if ((g._tcF = (g._tcF | 0) + 1) % 8 === 0 || T.colV === 0) terColors(g, T); const V = g._tv || (g._tv = { T: null, me: 0 }); V.T = T; V.me = mySlot(g, T); v.terr = V; }
// top 5 by land (+ you when lower), for the HUD list; v = "12.3%", rk = real rank
export function terLb(g) { const T = terOf(g); if (!T) return null; const me = g.backend.me, top = T.top(0), out = [];
  for (let i = 0; i < top.length && out.length < 5; i++) { const s = g.findSnake(T.idOf[top[i][0]]); if (s && s.alive) out.push({ s, v: pc((top[i][1] / T.total) * 100) + "%" }); }
  const ms = mySlot(g, T); if (ms && !out.some((x) => x.s === me)) out.push({ s: me, v: pc(T.pct(ms)) + "%", rk: T.rankOf(ms) });
  return out; }
// the top-centre pill: one stacked bar (top 5 in their colours, you outlined) + your share and place
function line(g) { const T = terOf(g); if (!T) return; const top = T.top(5), ms = mySlot(g, T), seg = [];
  for (const [s, n] of top) { const o = s * 3, w = (n / T.total) * 100; if (w < 0.05) continue; seg.push(`<i class="${s === ms ? "me" : ""}" style="width:${w.toFixed(1)}%;background:rgb(${T.rgb[o]},${T.rgb[o + 1]},${T.rgb[o + 2]})"></i>`); }
  if (ms && !top.some((x) => x[0] === ms)) { const o = ms * 3; seg.push(`<i class="me" style="width:${T.pct(ms).toFixed(1)}%;background:rgb(${T.rgb[o]},${T.rgb[o + 1]},${T.rgb[o + 2]})"></i>`); }
  const txt = ms ? `▦ ${esc(t("you"))} <bdi>${pc(T.pct(ms))}%</bdi> · <bdi>#${T.rankOf(ms)}</bdi>` : `▦ ${esc(t("ter_land"))}`; // bdi: numbers read right in Arabic too
  const html = `<div class="mode-pill ter"><span class="tx">${txt}</span><div class="ter-bar" aria-hidden="true">${seg.join("")}</div></div>`;
  if (g._xl !== html) { g._xl = html; g.hud.modeLine(html); } }
export function terTick(g) { if (!g.backend || g.backend.sim) return; const T = terOf(g); if (!T) return; const ms = mySlot(g, T); if (ms) g.terPk = Math.max(g.terPk || 0, T.pct(ms)); line(g); }
// online: seconds left in the room's round
export const terLeft = (g) => { const I = g.backend && g.backend.terInfo; return I ? Math.max(0, (I.end - performance.now()) / 1000) : null; };
// online room events (net.js): joined a territory room, a round ended / began
export function onTerr(g, e) { const el = document.getElementById("h-timer");
  if (e.ph === "on") { g.terOnline = true; g.terPk = 0; if (el) el.classList.remove("x-hide"); if (!g._terHi) { g._terHi = 1; g.hud.banner("▦ " + t("ter_start"), 2600); } }
  else if (e.ph === "end") { const me = g.backend && g.backend.me; if (!(me && me.alive)) g.hud.banner("▦ " + t("ter_over") + " · " + t("ter_newRound"), 2600, "sub"); }
  else if (e.ph === "round") { g.terPk = 0; } }
// the result of an online life in a territory room: round over (cause 7, server placement) or a death mid-round
export function terOnlineRes(g) { const b = g.backend; if (!b || !b.ter) return null; if (g.deathCause === 7 && b.terMe) return { over: 1, place: b.terMe.pl | 0, field: b.terMe.f | 0, pct: (b.terMe.p | 0) / 10, tro: !!b.terMe.tr };
  return g.terDeath ? { over: 0, ...g.terDeath } : null; }
export function terOnDeath(g) { const T = terOf(g), me = g.backend && g.backend.me; g.terDeath = null; if (!T || !me) return; const s = T.slotOf.get(me.id) || 0; g.terDeath = { place: s ? T.rankOf(s) : 0, field: Math.max(2, T.top(0).length), pct: s ? T.pct(s) : 0 }; }

// ---------- lobby: Territory = online rooms (public via the matchmaker or a private code) or offline vs bots ----------
export function terLobby(ui) { const p = ui.p, on = ui.selMode === "territory", host = document.getElementById("l-diff"); let el = document.getElementById("l-ter");
  if (!on) { if (el) el.classList.add("x-hide"); return; } if (!host) return;
  if (!el) { el = document.createElement("div"); el.id = "l-ter"; el.className = "seg small"; el.setAttribute("role", "tablist"); host.parentNode.insertBefore(el, host); }
  const online = p.last.terOn !== false; el.classList.remove("x-hide");
  el.innerHTML = `<button data-to="1" class="${online ? "on" : ""}" role="tab" aria-selected="${online}">${esc(t("ter_online"))}</button><button data-to="0" class="${online ? "" : "on"}" role="tab" aria-selected="${!online}">${esc(t("ter_bots"))}</button>`;
  el.querySelectorAll("[data-to]").forEach((b) => ui.click(b, () => { p.last.terOn = b.dataset.to === "1"; ui.S.save(); ui.renderLobby(); }, "tab"));
  host.classList.toggle("x-hide", online); const room = document.getElementById("l-room"), code = document.getElementById("l-code");
  if (room) room.classList.toggle("x-hide", !online); if (code) { code.value = p.last.troom || ""; code.placeholder = t("ter_codeHint"); } }
// what Play starts in Territory
export function terCfg(ui) { const p = ui.p, w = p.last.world || 0; if (p.last.terOn === false) return { mode: "territory", world: w, diff: p.last.diff ?? 1, room: "" };
  const c = String(p.last.troom || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 22); return { mode: "online", ter: 1, world: w, diff: 1, room: c ? "t-" + c : "" }; }

// ---------- skin fusion (Skins > Fusion) ----------
const skinNm = (i) => { const k = "s_" + SKINS[i].id, v = t(k); return v === k ? SKINS[i].id.charAt(0).toUpperCase() + SKINS[i].id.slice(1) : v; };
export const fuName = (F) => (F ? F.name : "?");
export const ownedFusions = (p) => (p.owned || []).map(fuParse).filter(Boolean).map(([a, b]) => fusionDef(fuIdx(a, b))).filter(Boolean);
export function renderFusion(ui, el) {
  const p = ui.p, S = ui.S, own = FUSABLE.filter((i) => S.unlocked("skin", i) && (p.owned || []).includes(SKINS[i].id)), F = (ui.fu || (ui.fu = { a: -1, b: -1, sure: 0, busy: 0 }));
  if (!own.includes(F.a)) F.a = -1; if (!own.includes(F.b) || F.b === F.a) F.b = -1;
  const pick = (k) => (F.a < 0 ? (F.a = k) : F.b < 0 && k !== F.a ? (F.b = k) : k === F.a ? (F.a = F.b, F.b = -1) : k === F.b ? (F.b = -1) : (F.b = k));
  const res = F.a >= 0 && F.b >= 0 ? fusionDef(fuIdx(F.a, F.b)) : null, have = res ? p.owned.includes(res.key) : false, fee = FUSION_FEE, poor = p.coins < fee;
  const slot = (i, n) => `<div class="fu-slot ${i >= 0 ? "full" : ""}">${i >= 0 ? `<div class="sw" style="background:${swatchCss({ k: "skin", i })}"></div><b>${esc(skinNm(i))}</b>` : `<span>${esc(t("fu_pick", { n }))}</span>`}</div>`;
  const out = res ? `<div class="fu-slot res r-${res.rar}"><div class="sw" style="background:${swatchCss({ k: "fu", i: res.i })}"></div><b>${esc(res.name)}</b><i class="rar ${res.rar}">${esc(t("rar_" + res.rar))}</i></div>` : `<div class="fu-slot res"><span>?</span></div>`;
  const btn = !res ? "" : have ? `<button class="btn ghost wide fu-go" disabled>✓ ${esc(t("fu_have"))}</button>` : `<button class="btn gold wide fu-go ${F.sure ? "sure" : ""}" id="fu-go" ${F.busy || poor ? "disabled" : ""}>${esc(F.busy ? t("fu_wait") : t(F.sure ? "fu_sure" : "fu_go", { n: fmtNum(fee) }))}</button>`;
  const mine = ownedFusions(p), on = (x) => p.skin && p.skin.k === "fu" && p.skin.i === x.i;
  let h = `<div class="lk-head"><h4 class="sub">${esc(t("lk_fusion"))}</h4><span class="cnt"><b>${mine.length}</b></span></div><p class="gt-sub">${esc(t("fu_sub"))}</p>`;
  h += `<div class="fu-row">${slot(F.a, 1)}<em>+</em>${slot(F.b, 2)}<em>=</em>${out}</div>${btn}${res && !have ? `<p class="fu-kept">${esc(t("fu_kept"))}</p>` : ""}`;
  h += own.length < 2 ? `<p class="fu-need">${esc(t("fu_need"))}</p>` : `<div class="grid">` + own.map((i) => { const s = SKINS[i], sel = i === F.a || i === F.b; return `<button class="item lk2 r-${s.rar} ${sel ? "sel on" : ""}" data-fu="${i}" aria-pressed="${sel}"><div class="sw" style="background:${swatchCss({ k: "skin", i })}"></div><div class="meta"><b>${esc(skinNm(i))}</b><i class="rd ${s.rar}"></i></div></button>`; }).join("") + `</div>`;
  h += `<h4 class="sub">${esc(t("fu_mine"))}</h4>` + (mine.length ? `<div class="grid">` + mine.map((x) => `<button class="item lk2 r-${x.rar} ${on(x) ? "on" : ""}" data-fq="${x.i}"><div class="sw" style="background:${swatchCss({ k: "fu", i: x.i })}"><span class="nw">${esc(t("fu_tag"))}</span></div><div class="meta"><b>${esc(x.name)}</b><i class="rd ${x.rar}"></i></div><small class="st ${on(x) ? "on" : ""}">${on(x) ? "✓ " + esc(t("equipped")) : esc(t("equip"))}</small></button>`).join("") + `</div>` : `<p class="fu-need">${esc(t("fu_none"))}</p>`);
  el.innerHTML = h;
  el.querySelectorAll("[data-fu]").forEach((b) => ui.click(b, () => { pick(+b.dataset.fu); F.sure = 0; renderFusion(ui, el); ui.renderInfo(); }, "tab"));
  el.querySelectorAll("[data-fq]").forEach((b) => ui.click(b, () => { p.skin = { k: "fu", i: +b.dataset.fq }; S.save(); ui.sel = null; renderFusion(ui, el); ui.renderInfo(); ui.updateShow(); ui.toast("✓ " + t("equipped"), "good"); }, "tab"));
  const go = document.getElementById("fu-go"); if (go) ui.click(go, async () => {
    if (F.busy) return; if (!F.sure) { F.sure = 1; clearTimeout(F.st); F.st = setTimeout(() => { F.sure = 0; if (ui.cTab === "fusion" && ui.cur === "custom") renderFusion(ui, el); }, 4000); renderFusion(ui, el); return; } // two taps: a 2,000-coin spend is never one stray tap
    F.busy = 1; F.sure = 0; renderFusion(ui, el); const r = await S.fuse(F.a, F.b); F.busy = 0;
    if (r === "ok" || r === "own") { p.skin = { k: "fu", i: res.i }; S.save(); F.a = F.b = -1; renderFusion(ui, el); ui.renderInfo(); ui.updateShow(); ui.coins(p.coins); if (r === "ok") { ui.toast("⚗ " + t("fu_new", { n: res.name }), "gold", 3200); ui.checkAch && ui.checkAch(); } return; }
    renderFusion(ui, el); ui.buyResult(r); }, "reward");
}
// the info card (right side) for a fusion skin
export function fuInfo(ui, d) { const F = fusionDef(d.i); if (!F) return ""; const p = ui.p, on = p.skin && p.skin.k === "fu" && p.skin.i === F.i;
  return `<span class="rar ${F.rar}">${esc(t("rar_" + F.rar))}</span><b>${esc(F.name)}</b><p>${esc(t("fu_tag"))} · ${esc(t("fu_of", { a: skinNm(F.a), b: skinNm(F.b) }))}</p>` + (on ? `<button class="btn ghost wide" disabled>✓ ${esc(t("equipped"))}</button>` : ""); }
export { fuKey, RAR_COL };
