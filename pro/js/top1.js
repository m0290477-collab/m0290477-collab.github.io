// top1: map events (sandstorm veil, portal rings, banners), ping + region corner chip, crash / error reports, monthly season
// (Locker tab + arena accents), and the owner admin parts for them (Errors, Fair play, map event switches, season month).
// All text in the 6 languages; calm / reduced motion: no animation, no flashing; touch targets >= 44 px.
import { t, addStrings, fmtNum, LANG } from "./i18n.js?v=top1";
import { SKINS, swatchCss, SEASON_THEMES, seasonMonth, seasonTheme, seasonSkins } from "./skins.js?v=top1";
import { WORLDS } from "./worlds.js?v=top1";
import { SERVER } from "./net.js?v=top1";
import { MEV, TP_PHASE } from "./sim.js?v=top1";
import { dlg, CF } from "./admin2.js?v=top1";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const APP_V = (() => { try { return (new URL(import.meta.url).searchParams.get("v") || "dev").slice(0, 16); } catch (_) { return "dev"; } })();
const HTTP = SERVER.replace(/^ws/, "http").replace(/\/ws$/, "");

addStrings({
  mev_storm_on: ["Sandstorm — the view is short", "عاصفة رملية — الرؤية قصيرة", "Kum fırtınası — görüş kısa", "Tempête de sable — la vue est réduite", "Tormenta de arena — se ve poco", "रेत का तूफ़ान — दृश्य कम है"],
  mev_storm_end: ["The sandstorm is over", "انتهت العاصفة الرملية", "Kum fırtınası bitti", "La tempête de sable est finie", "La tormenta de arena terminó", "रेत का तूफ़ान ख़त्म"],
  mev_gold_on: ["Golden food rain", "مطر الطعام الذهبي", "Altın yem yağmuru", "Pluie de nourriture dorée", "Lluvia de comida dorada", "सुनहरे खाने की बारिश"],
  mev_gold_end: ["The golden rain stopped", "توقف المطر الذهبي", "Altın yağmur durdu", "La pluie dorée s'arrête", "La lluvia dorada paró", "सुनहरी बारिश रुक गई"],
  mev_portal_on: ["Portals open — go in one, come out of the other", "فُتحت البوابات — ادخل واحدة واخرج من الأخرى", "Portallar açıldı — birinden gir, diğerinden çık", "Portails ouverts — entrez dans l'un, sortez par l'autre", "Portales abiertos — entra por uno y sal por el otro", "पोर्टल खुले — एक में जाओ, दूसरे से निकलो"],
  mev_portal_end: ["The portals closed", "أُغلقت البوابات", "Portallar kapandı", "Les portails sont fermés", "Los portales se cerraron", "पोर्टल बंद हो गए"],
  png_ms: ["{n} ms", "{n} م.ث", "{n} ms", "{n} ms", "{n} ms", "{n} ms"],
  png_lbl: ["Connection", "الاتصال", "Bağlantı", "Connexion", "Conexión", "कनेक्शन"],
  rg_wnam: ["US West", "غرب أمريكا", "ABD Batı", "États-Unis Ouest", "EE. UU. Oeste", "अमेरिका पश्चिम"],
  rg_enam: ["US East", "شرق أمريكا", "ABD Doğu", "États-Unis Est", "EE. UU. Este", "अमेरिका पूर्व"],
  rg_sam: ["South America", "أمريكا الجنوبية", "Güney Amerika", "Amérique du Sud", "Sudamérica", "दक्षिण अमेरिका"],
  rg_weur: ["Europe West", "غرب أوروبا", "Batı Avrupa", "Europe Ouest", "Europa Oeste", "पश्चिमी यूरोप"],
  rg_eeur: ["Europe East", "شرق أوروبا", "Doğu Avrupa", "Europe Est", "Europa Este", "पूर्वी यूरोप"],
  rg_apac: ["Asia", "آسيا", "Asya", "Asie", "Asia", "एशिया"],
  rg_oc: ["Oceania", "أوقيانوسيا", "Okyanusya", "Océanie", "Oceanía", "ओशिनिया"],
  rg_afr: ["Africa", "أفريقيا", "Afrika", "Afrique", "África", "अफ़्रीका"],
  rg_me: ["Middle East", "الشرق الأوسط", "Orta Doğu", "Moyen-Orient", "Oriente Medio", "मध्य पूर्व"],
  rg_far: ["nearest busy room", "أقرب غرفة فيها لاعبون", "en yakın dolu oda", "salle animée la plus proche", "sala con gente más cercana", "सबसे पास का भरा कमरा"],
  ssn_tab: ["Season", "الموسم", "Sezon", "Saison", "Temporada", "सीज़न"],
  ssn_title: ["{n} season", "موسم {n}", "{n} sezonu", "Saison {n}", "Temporada {n}", "{n} सीज़न"],
  ssn_left: ["Leaves the shop in {n}", "يغادر المتجر بعد {n}", "{n} sonra mağazadan çıkar", "Quitte la boutique dans {n}", "Sale de la tienda en {n}", "{n} में दुकान से हटेगा"],
  ssn_d: ["{n} d", "{n} يوم", "{n} g", "{n} j", "{n} d", "{n} दिन"],
  ssn_h: ["{n} h", "{n} س", "{n} sa", "{n} h", "{n} h", "{n} घं"],
  ssn_sub: ["Three skins for this month only, bought with coins. Yours forever once bought.", "ثلاثة أشكال لهذا الشهر فقط، تُشترى بالعملات. تبقى لك للأبد بعد الشراء.", "Yalnızca bu aya özel üç görünüm, jetonla alınır. Alınca sonsuza dek senin.", "Trois skins pour ce mois seulement, achetés avec des pièces. À vous pour toujours.", "Tres aspectos solo este mes, con monedas. Tuyos para siempre al comprarlos.", "सिर्फ़ इस महीने के तीन स्किन, सिक्कों से। ख़रीदने के बाद हमेशा आपके।"],
  ssn_past: ["From past seasons", "من مواسم سابقة", "Geçmiş sezonlardan", "Saisons passées", "De temporadas pasadas", "पिछले सीज़न से"],
  ssn_off: ["Not on sale this month", "غير متاح للبيع هذا الشهر", "Bu ay satışta değil", "Pas en vente ce mois-ci", "No está a la venta este mes", "इस महीने बिक्री में नहीं"],
  rw_held: ["This reward is being checked and will arrive soon", "هذه الجائزة قيد المراجعة وستصلك قريبًا", "Bu ödül kontrol ediliyor, yakında gelecek", "Cette récompense est en vérification, elle arrive bientôt", "Esta recompensa se está revisando y llegará pronto", "यह इनाम जाँच में है, जल्द मिलेगा"],
  // admin
  ad_errs: ["Errors", "الأخطاء", "Hatalar", "Erreurs", "Errores", "त्रुटियाँ"],
  ad_fair: ["Fair play", "اللعب النظيف", "Adil oyun", "Fair-play", "Juego limpio", "निष्पक्ष खेल"],
  er_none: ["No errors reported", "لا توجد أخطاء مُبلغ عنها", "Bildirilen hata yok", "Aucune erreur signalée", "No hay errores", "कोई त्रुटि नहीं"],
  er_cnt: ["{n} times · {u} players", "{n} مرة · {u} لاعب", "{n} kez · {u} oyuncu", "{n} fois · {u} joueurs", "{n} veces · {u} jugadores", "{n} बार · {u} खिलाड़ी"],
  er_first: ["First", "أول مرة", "İlk", "Première", "Primera", "पहली"],
  er_last: ["Last", "آخر مرة", "Son", "Dernière", "Última", "आख़िरी"],
  er_clr: ["Clear", "مسح", "Temizle", "Effacer", "Borrar", "साफ़ करें"],
  er_clrAll: ["Clear all", "مسح الكل", "Hepsini temizle", "Tout effacer", "Borrar todo", "सब साफ़ करें"],
  er_sub: ["Uncaught errors from players' devices, grouped by message. Only an anonymous id, the device type and the app version are kept.", "أخطاء غير معالجة من أجهزة اللاعبين، مجمّعة حسب الرسالة. يُحفظ فقط معرّف مجهول ونوع الجهاز وإصدار التطبيق.", "Oyuncu cihazlarından gelen hatalar, mesaja göre gruplu. Yalnızca anonim kimlik, cihaz türü ve sürüm saklanır.", "Erreurs non gérées des appareils des joueurs, groupées par message. Seuls un id anonyme, le type d'appareil et la version sont gardés.", "Errores no controlados de los dispositivos, agrupados por mensaje. Solo se guarda un id anónimo, el tipo de dispositivo y la versión.", "खिलाड़ियों के डिवाइस की त्रुटियाँ, संदेश के अनुसार। सिर्फ़ गुमनाम आईडी, डिवाइस प्रकार और ऐप संस्करण रखा जाता है।"],
  er_today: ["Today: {n} reports, {d} dropped by the limit", "اليوم: {n} تقرير، {d} تجاوزت الحد", "Bugün: {n} rapor, {d} sınırda düştü", "Aujourd'hui : {n} rapports, {d} écartés par la limite", "Hoy: {n} informes, {d} descartados por el límite", "आज: {n} रिपोर्ट, {d} सीमा से हटीं"],
  fp_sub: ["When a week or month closes, the top 50 are checked against what the servers saw. A flagged reward waits here until you release it.", "عند انتهاء أسبوع أو شهر يُفحص أفضل 50 لاعبًا بما رأته الخوادم. الجائزة المشبوهة تنتظر هنا حتى تُفرج عنها.", "Hafta ya da ay kapanınca ilk 50, sunucuların gördüğüne göre kontrol edilir. İşaretli ödül sen serbest bırakana dek bekler.", "À la fin d'une semaine ou d'un mois, le top 50 est vérifié d'après les serveurs. Une récompense signalée attend ici votre accord.", "Al cerrar una semana o un mes se revisa el top 50 con lo que vieron los servidores. Una recompensa marcada espera aquí hasta que la liberes.", "हफ़्ता या महीना ख़त्म होने पर टॉप 50 की जाँच सर्वर के डेटा से होती है। संदिग्ध इनाम यहाँ रुकता है जब तक आप जारी न करें।"],
  fp_none: ["No checks yet", "لا توجد فحوصات بعد", "Henüz kontrol yok", "Aucune vérification", "Aún no hay revisiones", "अभी कोई जाँच नहीं"],
  fp_held: ["On hold", "معلّقة", "Beklemede", "En attente", "Retenida", "रोका गया"],
  fp_rel: ["Released", "مُفرج عنها", "Serbest", "Libérée", "Liberada", "जारी"],
  fp_clean: ["Clean", "سليم", "Temiz", "Propre", "Limpio", "साफ़"],
  fp_release: ["Release reward", "الإفراج عن الجائزة", "Ödülü serbest bırak", "Libérer la récompense", "Liberar recompensa", "इनाम जारी करें"],
  fp_hold: ["Hold again", "تعليق مجددًا", "Yeniden beklet", "Retenir à nouveau", "Retener otra vez", "फिर रोकें"],
  fp_scan: ["Check this month's top 50 now", "افحص أفضل 50 هذا الشهر الآن", "Bu ayın ilk 50'sini şimdi kontrol et", "Vérifier le top 50 du mois", "Revisar ahora el top 50 del mes", "इस महीने के टॉप 50 अभी जाँचें"],
  fp_scanRes: ["{n} checked · {h} would be held", "فُحص {n} · {h} ستُعلّق", "{n} kontrol · {h} bekletilirdi", "{n} vérifiés · {h} seraient retenus", "{n} revisados · {h} se retendrían", "{n} जाँचे · {h} रोके जाते"],
  fp_lives: ["{n} online lives", "{n} حياة أونلاين", "{n} çevrimiçi can", "{n} vies en ligne", "{n} vidas en línea", "{n} ऑनलाइन लाइफ़"],
  fp_w_kills: ["Too many kills in one life", "قتلات كثيرة جدًا في حياة واحدة", "Tek canda çok fazla öldürme", "Trop d'éliminations en une vie", "Demasiadas eliminaciones en una vida", "एक लाइफ़ में बहुत ज़्यादा किल"],
  fp_w_growth: ["Grew faster than possible", "نما أسرع من الممكن", "Mümkünden hızlı büyüdü", "Croissance impossible", "Creció más rápido de lo posible", "संभव से तेज़ बढ़ा"],
  fp_w_overlap: ["Played in two rooms at once", "لعب في غرفتين معًا", "Aynı anda iki odada oynadı", "Joué dans deux salles à la fois", "Jugó en dos salas a la vez", "एक साथ दो कमरों में खेला"],
  fp_w_rate: ["Too many lives in an hour", "حيوات كثيرة جدًا في ساعة", "Bir saatte çok fazla can", "Trop de vies en une heure", "Demasiadas vidas en una hora", "एक घंटे में बहुत ज़्यादा लाइफ़"],
  fp_w_short: ["Many very short lives that gained trophies", "حيوات قصيرة جدًا كسبت كؤوسًا", "Kupa kazanan çok kısa canlar", "Beaucoup de vies très courtes avec trophées", "Muchas vidas muy cortas con trofeos", "बहुत छोटी लाइफ़ जिनसे ट्रॉफ़ी मिली"],
  mev_card: ["Map events", "أحداث الخريطة", "Harita olayları", "Événements de carte", "Eventos del mapa", "मैप इवेंट"],
  mev_sub: ["Online public rooms: at most one event per match, never more often than every 7 minutes.", "الغرف العامة أونلاين: حدث واحد كحد أقصى في المباراة، ولا يتكرر قبل 7 دقائق.", "Çevrimiçi açık odalar: maç başına en fazla bir olay, 7 dakikadan sık değil.", "Salles publiques en ligne : un événement par partie au plus, jamais plus d'une fois toutes les 7 minutes.", "Salas públicas en línea: como mucho un evento por partida, nunca antes de 7 minutos.", "ऑनलाइन सार्वजनिक कमरे: एक मैच में अधिकतम एक इवेंट, 7 मिनट से पहले नहीं।"],
  mev_all: ["Map events on", "أحداث الخريطة مفعّلة", "Harita olayları açık", "Événements activés", "Eventos activados", "मैप इवेंट चालू"],
  mev_alloff: ["Map events off", "أحداث الخريطة متوقفة", "Harita olayları kapalı", "Événements désactivés", "Eventos desactivados", "मैप इवेंट बंद"],
  mev_k_storm: ["Sandstorm", "عاصفة رملية", "Kum fırtınası", "Tempête de sable", "Tormenta de arena", "रेत का तूफ़ान"],
  mev_k_gold: ["Golden food rain", "مطر الطعام الذهبي", "Altın yem yağmuru", "Pluie dorée", "Lluvia dorada", "सुनहरी बारिश"],
  mev_k_portal: ["Portals", "البوابات", "Portallar", "Portails", "Portales", "पोर्टल"],
  ssn_card: ["Monthly season", "الموسم الشهري", "Aylık sezon", "Saison mensuelle", "Temporada mensual", "मासिक सीज़न"],
  ssn_auto: ["Follow the month (UTC)", "اتبع الشهر (UTC)", "Ayı izle (UTC)", "Suivre le mois (UTC)", "Seguir el mes (UTC)", "महीने के साथ (UTC)"],
  ssn_now: ["On sale now: {n}", "المعروض الآن: {n}", "Şu an satışta: {n}", "En vente : {n}", "A la venta: {n}", "अभी बिक्री में: {n}"],
});
// season theme names (6 languages); season skin names = theme + I / II / III
const STN = {
  st_frostfall: ["Frostfall", "تساقط الصقيع", "Kırağı", "Givre", "Escarcha", "पाला"],
  st_rosebloom: ["Rose Bloom", "تفتّح الورد", "Gül Çiçeği", "Rose en fleur", "Rosa en flor", "गुलाब बहार"],
  st_springjade: ["Spring Jade", "يشم الربيع", "Bahar Yeşimi", "Jade printanier", "Jade primaveral", "वसंत जेड"],
  st_raingarden: ["Rain Garden", "حديقة المطر", "Yağmur Bahçesi", "Jardin de pluie", "Jardín de lluvia", "बारिश बाग़"],
  st_sunflower: ["Sunflower", "دوّار الشمس", "Ayçiçeği", "Tournesol", "Girasol", "सूरजमुखी"],
  st_coralreef: ["Coral Reef", "الشعاب المرجانية", "Mercan Resifi", "Récif corallien", "Arrecife de coral", "मूंगा चट्टान"],
  st_desertsun: ["Desert Sun", "شمس الصحراء", "Çöl Güneşi", "Soleil du désert", "Sol del desierto", "रेगिस्तानी सूरज"],
  st_tropicstorm: ["Tropic Storm", "العاصفة الاستوائية", "Tropik Fırtına", "Tempête tropicale", "Tormenta tropical", "उष्णकटिबंधीय तूफ़ान"],
  st_harvestgold: ["Harvest Gold", "ذهب الحصاد", "Hasat Altını", "Or des moissons", "Oro de cosecha", "फ़सल सोना"],
  st_embernight: ["Ember Night", "ليلة الجمر", "Kor Gecesi", "Nuit de braises", "Noche de brasas", "अंगारों की रात"],
  st_autumncopper: ["Autumn Copper", "نحاس الخريف", "Sonbahar Bakırı", "Cuivre d'automne", "Cobre otoñal", "पतझड़ ताँबा"],
  st_starlitsnow: ["Starlit Snow", "ثلج النجوم", "Yıldızlı Kar", "Neige étoilée", "Nieve estrellada", "तारों भरी बर्फ़"],
};
addStrings(STN);
const ROMAN = ["I", "II", "III"];
for (const T of SEASON_THEMES) T.sk.forEach((_, j) => { const row = STN["st_" + T.id]; if (row) addStrings({ ["s_ss" + String(T.m).padStart(2, "0") + "abc"[j]]: row.map((n) => n + " " + ROMAN[j]) }); });
export function seasonSkinName(i) { const S = SKINS[i]; if (!S || !S.ssn) return ""; const T = seasonTheme(S.ssn), j = "abc".indexOf(S.id.slice(-1)); return t("st_" + T.id) + " " + ROMAN[j]; }

// ---------- styles (injected: one stylesheet for this module) ----------
const CSS = `
#mev-layer{position:fixed;inset:0;pointer-events:none;z-index:4;overflow:hidden}
#mev-storm{position:absolute;inset:-2px;opacity:0;transition:opacity 2s ease;background:radial-gradient(ellipse 62% 70% at 50% 50%,rgba(214,176,118,0) 0,rgba(214,176,118,0) 34%,rgba(201,160,100,.55) 56%,rgba(176,136,84,.9) 76%,rgba(160,122,74,.96) 100%)}
#mev-storm.on{opacity:1}
html.rm #mev-storm,html.calm #mev-storm{transition:none}
.mev-ring{position:absolute;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid rgba(160,120,255,.9);box-shadow:0 0 0 3px rgba(80,230,220,.35) inset;background:radial-gradient(circle,rgba(110,90,220,.28) 0,rgba(60,200,210,.12) 60%,transparent 72%);will-change:transform;display:none}
.mev-ring.b{border-color:rgba(80,230,220,.9);box-shadow:0 0 0 3px rgba(160,120,255,.35) inset}
.mev-ring i{position:absolute;inset:18%;border-radius:50%;border:2px dashed rgba(255,255,255,.45);animation:mevspin 9s linear infinite}
html.rm .mev-ring i,html.calm .mev-ring i{animation:none}
@keyframes mevspin{to{transform:rotate(360deg)}}
.h-ping{position:absolute;bottom:calc(.35rem + var(--sb,0px));inset-inline-start:calc(.6rem + var(--sl,0px));font-size:.625rem;line-height:1;color:var(--tx3,#9aa7b8);opacity:.8;letter-spacing:.02em;display:flex;align-items:center;gap:.3rem;pointer-events:none;white-space:nowrap}
.h-ping s{width:.42rem;height:.42rem;border-radius:50%;background:#3ad07a;display:inline-block}
.h-ping s.fair{background:#e6b84a}.h-ping s.poor{background:#e06a5a}
html.lefty .h-ping{inset-inline-start:auto;inset-inline-end:calc(.6rem + var(--sr,0px))}
.ssn-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem 1rem;margin:.2rem 0 .5rem}
.ssn-head h4{margin:0}.ssn-head small{color:var(--tx3,#9aa7b8)}
.ssn-sub{margin:.1rem 0 .7rem;color:var(--tx2,#c4ccd8);font-size:.8rem}
.ssn-bar{height:4px;border-radius:2px;margin:0 0 .8rem;background:var(--ssn,#e0874a);opacity:.85}
.er-row{padding:.6rem .2rem;border-bottom:1px solid rgba(255,255,255,.07)}.er-row:last-child{border:0}
.er-row b{display:block;word-break:break-word;font-weight:600}.er-row code{display:block;font-size:.7rem;color:var(--tx3,#9aa7b8);word-break:break-all;margin:.2rem 0}
.er-chips{display:flex;flex-wrap:wrap;gap:.3rem;margin:.3rem 0}.er-chips span{font-size:.68rem;padding:.15rem .45rem;border-radius:.6rem;background:rgba(255,255,255,.07)}
.fp-row{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .8rem;padding:.55rem .2rem;border-bottom:1px solid rgba(255,255,255,.07)}.fp-row:last-child{border:0}
.fp-row .fp-who{flex:1 1 12rem;min-width:0}.fp-st{font-size:.7rem;padding:.15rem .5rem;border-radius:.6rem;background:rgba(255,255,255,.08)}
.fp-st.h{background:rgba(224,106,90,.25);color:#ffb3a8}.fp-st.r{background:rgba(58,208,122,.2);color:#9ff0c0}
.t1-btn{min-height:44px;min-width:44px}
`;
function css() { if ($("t1-css")) return; const st = document.createElement("style"); st.id = "t1-css"; st.textContent = CSS; document.head.appendChild(st); }

// ---------- crash / error reports ----------
// uncaught errors and rejections only; at most 5 per page load, the same message once, 2 s apart; nothing typed by the player,
// no URLs with query strings, no names. The server groups them (Admin > Errors) and rate-limits per player and per day.
const ER = { n: 0, seen: new Set(), last: 0, app: null };
export function deviceLabel(ua = navigator.userAgent) { const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Other";
  const ov = (/OS (\d+)_/.exec(ua) || /Android (\d+)/.exec(ua) || [])[1] || ""; const br = /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua) ? "Chrome" : /Edg\//.test(ua) ? "Edge" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "App";
  return (os + (ov ? " " + ov : "") + " " + br).slice(0, 40); }
export function errPayload(e, mode) { let m = "", s = ""; if (e && typeof e === "object") { m = (e.name && e.name !== "Error" ? e.name + ": " : "") + (e.message || String(e)); s = String(e.stack || "").split("\n").find((l) => /\.js/.test(l)) || ""; } else m = String(e);
  m = m.replace(/https?:\/\/\S+/g, "<url>").slice(0, 300); s = s.replace(/https?:\/\/[^/\s]+/g, "").replace(/\?v=[0-9a-z]+/g, "").trim().slice(0, 160); return { m, s, d: deviceLabel(), v: APP_V, mo: String(mode || "").slice(0, 16) }; }
export function reportErr(e) { try { if (ER.n >= 5) return; const P = errPayload(e, ER.app && ER.app.game ? ER.app.game.mode : ""); if (!P.m || /ResizeObserver loop|^Script error\.?$|AbortError|NotAllowedError: play\(\)/i.test(P.m)) return;
    const key = P.m.slice(0, 120); if (ER.seen.has(key)) return; const now = Date.now(); if (now - ER.last < 2000) return; ER.seen.add(key); ER.last = now; ER.n++;
    let pk = ""; try { const S = ER.app && ER.app.store; pk = S && S.p && /^[0-9a-f]{32}$/.test(S.p.dev || "") ? S.p.dev : ""; } catch (_) {}
    if (navigator.onLine === false) return; fetch(HTTP + "/err", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...P, pk }), keepalive: true }).catch(() => {}); } catch (_) {} }

// ---------- ping + region corner chip ----------
export function pingTick(game) { const b = game.backend; let el = $("h-ping"); if (!b || !b.online) { if (el) el.classList.add("x-hide"); return; }
  if (!el) { const hud = $("hud"); if (!hud) return; el = document.createElement("div"); el.id = "h-ping"; el.className = "h-ping"; el.setAttribute("role", "status"); hud.appendChild(el); }
  const rg = (b.server && b.server.rg) || (b.mm && b.mm.rg) || "", q = b.quality || "good", v = (rg ? t("rg_" + rg) + " · " : "") + (b.ping ? t("png_ms", { n: b.ping }) : "…") + "|" + q;
  el.classList.remove("x-hide"); if (el._v === v) return; el._v = v; el.setAttribute("aria-label", t("png_lbl") + ": " + v.split("|")[0]); el.innerHTML = `<s class="${q}"></s><span dir="ltr">${esc(v.split("|")[0])}</span>`; }

// ---------- map events (client side: what the server announced) ----------
const MV = { E: null, rings: [] };
function layer() { let L = $("mev-layer"); if (!L) { L = document.createElement("div"); L.id = "mev-layer"; L.setAttribute("aria-hidden", "true"); L.innerHTML = `<div id="mev-storm"></div><div class="mev-ring a"><i></i></div><div class="mev-ring b"><i></i></div>`; const gl = $("gl"); (gl && gl.parentNode ? gl.parentNode : document.body).insertBefore(L, gl ? gl.nextSibling : null); MV.rings = [...L.querySelectorAll(".mev-ring")]; } return L; }
export function onMev(game, m) { css(); layer(); const st = $("mev-storm");
  if (m.ph === "start" || m.ph === "now") { MV.E = { k: m.k, p: m.p || null, r: m.r || 3.4, t0: performance.now(), d: (m.t || m.d || 20) * 1000 }; if (m.k === "storm") st.classList.add("on"); if (m.ph === "start") game.hud.banner(t("mev_" + m.k + "_on"), 1800, "sub"); }
  else if (m.ph === "end") { const k = MV.E && MV.E.k; MV.E = null; st.classList.remove("on"); for (const r of MV.rings) r.style.display = "none"; if (k) game.hud.banner(t("mev_" + k + "_end"), 1400, "sub"); } }
export function mevClear() { MV.E = null; const st = $("mev-storm"); if (st) st.classList.remove("on"); for (const r of MV.rings) r.style.display = "none"; }
export function mevFrame(game) { const E = MV.E; if (!E || E.k !== "portal" || !E.p || !game.r || !game.r.project) return; const show = game.mode === "online" && !game.replay && !game.ended;
  for (let i = 0; i < 2; i++) { const el = MV.rings[i]; if (!el) continue; if (!show) { el.style.display = "none"; continue; } const P = E.p[i], c = game.r.project(P[0], P[1], 0), e = game.r.project(P[0] + E.r, P[1], 0), R = Math.max(8, Math.hypot(e[0] - c[0], e[1] - c[1]));
    if (!Number.isFinite(c[0]) || c[0] < -200 || c[1] < -200 || c[0] > innerWidth + 200 || c[1] > innerHeight + 200) { el.style.display = "none"; continue; }
    el.style.display = "block"; const k = R / 20; el.style.transform = `translate(${c[0].toFixed(1)}px,${c[1].toFixed(1)}px) scale(${k.toFixed(3)},${(k * 0.62).toFixed(3)})`; } } // flattened: the rings lie on the ground
// a teleported snake: the whole body moves by (dx, dy), then it is harmless / safe for TP_PHASE s (same as the server)
export function applyTp(s, dx, dy) { if (!s) return; for (let i = 0; i < s.px.length; i++) { s.px[i] += dx; s.py[i] += dy; } s.x += dx; s.y += dy; s.ph = TP_PHASE; }

// ---------- monthly season ----------
export const SSN = { ov: 0 };
export const curMonth = () => seasonMonth(Date.now(), SSN.ov);
// arena accents of the current season (wall, rim light, calm edge, ambient motes). Applied before the first world is built.
export function applySeasonTheme(on = true) { const T = seasonTheme(curMonth());
  for (const W of WORLDS) { if (!W._t1) W._t1 = { wall: W.wall, rim: W.rim, edge: W.calm ? W.calm.edge : null, amb: W.amb ? W.amb.color : null };
    const B = W._t1; W.wall = on ? T.wall : B.wall; W.rim = on ? T.rim : B.rim; if (W.calm) W.calm.edge = on ? T.edge : B.edge; if (W.amb) W.amb.color = on ? T.amb : B.amb; } }
const themeOn = true;
applySeasonTheme(themeOn); // module load = before main.js builds the renderer
export function setSeasonOv(ov, app) { ov = ov | 0; if (ov === SSN.ov) return; SSN.ov = ov; applySeasonTheme(themeOn); try { const r = app && app.renderer; if (r && !r.is2D && r.worldI >= 0) { const w = r.worldI; r.worldI = -1; r.setWorld(w); } } catch (_) {} }
const leftTxt = (now = Date.now()) => { const d = new Date(now), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), ms = end - now, days = Math.floor(ms / 86400000); return days >= 1 ? t("ssn_d", { n: days }) : t("ssn_h", { n: Math.max(1, Math.ceil(ms / 3600000)) }); };
export function seasonTabHtml(ui) { const S = ui.S, p = ui.p, m = curMonth(), T = seasonTheme(m), ids = seasonSkins(m);
  const card = (i) => { const s = SKINS[i], ok = S.unlocked("skin", i), on = p.skin.k === "skin" && p.skin.i === i, sel = ui.sel && ui.sel.k === "skin" && ui.sel.i === i, inS = s.ssn === m;
    const st = on ? `<small class="st on">✓ ${t("equipped")}</small>` : ok ? `<small class="st">${t("equip")}</small>` : inS ? `<small class="st buy${sel ? " go" : ""}"><span class="coin"></span>${fmtNum(+s.src.split(":")[1])}</small>` : `<small class="st lk"><span>${t("ssn_off")}</span></small>`;
    return `<button class="item lk2 r-${s.rar} ${on ? "on" : ""} ${sel ? "sel" : ""} ${ok ? "" : "lock"}" data-k="skin" data-v="${i}"><div class="sw" style="background:${swatchCss({ k: "skin", i })}"></div><div class="meta"><b>${esc(seasonSkinName(i))}</b><i class="rd ${s.rar}" title="${t("rar_" + s.rar)}"></i></div>${st}</button>`; };
  const past = SKINS.map((s, i) => i).filter((i) => SKINS[i].ssn && SKINS[i].ssn !== m && S.unlocked("skin", i));
  return `<div class="ssn-head"><h4 class="sub">${esc(t("ssn_title", { n: t("st_" + T.id) }))}</h4><small>${esc(t("ssn_left", { n: leftTxt() }))}</small></div><div class="ssn-bar" style="--ssn:${T.wall}"></div><p class="ssn-sub">${t("ssn_sub")}</p>
    <div class="grid">${ids.map(card).join("")}</div>${past.length ? `<div class="lk-head"><h4 class="sub">${t("ssn_past")}</h4></div><div class="grid">${past.map(card).join("")}</div>` : ""}`; }
export function seasonTab(ui, el) { el.innerHTML = seasonTabHtml(ui); el.querySelectorAll("[data-k]").forEach((b) => ui.click(b, () => ui.pick(b.dataset.k, +b.dataset.v), "tab")); ui.renderInfo(); ui.updateShow(); }
export function lockerTab(ui) { const bar = $("c-tabs"); if (!bar || bar.querySelector('[data-v="season"]')) return; const b = document.createElement("button"); b.dataset.v = "season"; b.dataset.i = "ssn_tab"; b.textContent = t("ssn_tab");
  const off = bar.querySelector('[data-v="legend"]'); bar.insertBefore(b, off ? off.nextSibling : null);
  ui.click(b, () => { ui.cTab = "season"; bar.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); ui.renderCustom(); }, "tab"); }
export const seasonSkinHidden = (i, owned) => !!(SKINS[i] && SKINS[i].ssn) && !owned; // the plain Skins tab shows season skins only once owned

// ---------- owner admin ----------
const ADM = { errs: null, ac: null, scan: null };
export function admReset(tab) { if (tab === "errs") ADM.errs = null; if (tab === "fair") { ADM.ac = null; ADM.scan = null; } }
const fmtT = (x) => { try { return new Date(x).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short" }); } catch (_) { return String(x); } };
const chips = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span dir="ltr">${esc(k)} · ${fmtNum(v)}</span>`).join("");
export function errorsHtml(adm, rer) { const E = ADM.errs; if (!E) { adm("a_errs").then((r) => { ADM.errs = r || { err: "offline" }; rer && rer(); }); return `<p class="fine">${t("loading")}…</p>`; } if (E.err) return `<p class="so-err">${esc(E.err)}</p>`;
  const L = E.list || []; return `<div class="pv-card"><div class="pv-h">🐞 ${t("ad_errs")} · ${L.length}${L.length ? `<button class="btn ac-b ad-sm t1-btn" data-t1="errclr" data-h="*">${t("er_clrAll")}</button>` : ""}<button class="btn ac-b ad-sm t1-btn" data-t1="errref">${t("ad_refresh")}</button></div><p class="fine">${t("er_sub")}</p>${E.day ? `<p class="fine">${esc(t("er_today", { n: fmtNum(E.day.n), d: fmtNum(E.day.drop) }))}</p>` : ""}
    ${L.length ? L.map((r) => `<div class="er-row"><b dir="ltr">${esc(r.m)}</b>${r.src ? `<code dir="ltr">${esc(r.src)}</code>` : ""}<small class="fine">${esc(t("er_cnt", { n: fmtNum(r.n), u: fmtNum(r.u) }))} · ${t("er_first")} ${esc(fmtT(r.t0))} · ${t("er_last")} ${esc(fmtT(r.t1))}${r.mode ? " · " + esc(r.mode) : ""}</small><div class="er-chips">${chips(r.dev)}${chips(r.ver)}</div><button class="btn ac-b ad-sm t1-btn" data-t1="errclr" data-h="${esc(r.h)}">${t("er_clr")}</button></div>`).join("") : `<p class="fine">${t("er_none")}</p>`}</div>`; }
export function fairHtml(adm, rer) { const A = ADM.ac; if (!A) { adm("a_ac").then((r) => { ADM.ac = r || { err: "offline" }; rer && rer(); }); return `<p class="fine">${t("loading")}…</p>`; } if (A.err) return `<p class="so-err">${esc(A.err)}</p>`;
  const L = A.list || [], st = (r) => r.st === 1 ? `<span class="fp-st h">${t("fp_held")}</span>` : r.st === 2 ? `<span class="fp-st r">${t("fp_rel")}</span>` : `<span class="fp-st">${t("fp_clean")}</span>`;
  const S = ADM.scan; return `<div class="pv-card"><div class="pv-h">⚖️ ${t("ad_fair")}<button class="btn ac-b ad-sm t1-btn" data-t1="acscan">${t("fp_scan")}</button></div><p class="fine">${t("fp_sub")}</p>${S ? `<p class="fine">${esc(t("fp_scanRes", { n: S.n | 0, h: S.held | 0 }))}</p>` + (S.preview || []).map((x) => `<p class="fine" dir="ltr">${esc(x.pid.slice(0, 8))} · ${x.why.map((w) => esc(t("fp_w_" + w))).join(", ")}</p>`).join("") : ""}
    ${L.length ? L.filter((r) => r.st || (r.why && r.why.length)).concat(L.filter((r) => !r.st && !(r.why && r.why.length)).slice(0, 20)).map((r) => `<div class="fp-row"><div class="fp-who"><b dir="auto">${esc(r.name || "—")}</b> <small class="fine" dir="ltr">${r.u ? "#" + esc(r.u) : esc(r.pid.slice(0, 8))} · ${esc(r.per)}</small><br><small class="fine">${(r.why || []).map((w) => esc(t("fp_w_" + w))).join(" · ") || "—"}</small></div>${st(r)}
      ${r.st === 1 ? `<button class="btn gold ac-b ad-sm t1-btn" data-t1="acrel" data-pid="${esc(r.pid)}" data-per="${esc(r.per)}">${t("fp_release")}</button>` : r.st === 2 ? `<button class="btn ac-b ad-sm t1-btn" data-t1="achold" data-pid="${esc(r.pid)}" data-per="${esc(r.per)}">${t("fp_hold")}</button>` : ""}</div>`).join("") : `<p class="fine">${t("fp_none")}</p>`}</div>`; }
// extra cards for the Live tab: map event switches + the season month
export function liveCards(cfg) { const mv = (cfg && cfg.mev) || { off: 0, k: [] }, ov = (cfg && cfg.ssn) | 0, m = seasonMonth(Date.now(), ov), T = seasonTheme(m);
  return `<div class="pv-card"><div class="pv-h">🌪 ${t("mev_card")}</div><p class="fine">${t("mev_sub")}</p><div class="a2-chips"><button class="a2-chip t1-btn ${mv.off ? "off" : "on"}" data-t1="mevall" aria-pressed="${!mv.off}">${t(mv.off ? "mev_alloff" : "mev_all")}</button>${MEV.map((k) => `<button class="a2-chip t1-btn ${mv.off || mv.k.includes(k) ? "off" : "on"}" data-t1="mevk" data-k="${k}" aria-pressed="${!mv.k.includes(k)}" ${mv.off ? "disabled" : ""}>${esc(t("mev_k_" + k))}</button>`).join("")}</div></div>
    <div class="pv-card"><div class="pv-h">🗓 ${t("ssn_card")}</div><p class="fine">${esc(t("ssn_now", { n: t("st_" + T.id) }))}</p><select class="a2-sel t1-btn" id="t1-ssn"><option value="0" ${ov ? "" : "selected"}>${t("ssn_auto")}</option>${SEASON_THEMES.map((x) => `<option value="${x.m}" ${ov === x.m ? "selected" : ""}>${x.m} · ${esc(t("st_" + x.id))}</option>`).join("")}</select></div>`; }
// one-step reason prompt (every owner action is audited with a reason, like the other admin actions)
function reason(ui, title, run, done) { dlg(ui, { title, run: (v) => run(v.why), done }); }
export function bindAdm(ui, el, adm, cfg, rer, onCfg) { const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => ui.click(b, () => fn(b), "tab"));
  const done = (then) => (r) => { then && then(r); rer && rer(); };
  on('[data-t1="errref"]', () => { ADM.errs = null; rer && rer(); });
  on('[data-t1="errclr"]', (b) => reason(ui, t("er_clr"), (why) => adm("a_errclr", { h: b.dataset.h, why }), done(() => { ADM.errs = null; })));
  on('[data-t1="acscan"]', () => reason(ui, t("fp_scan"), (why) => adm("a_acscan", { why }), done((r) => { ADM.scan = r; })));
  on('[data-t1="acrel"]', (b) => reason(ui, t("fp_release"), (why) => adm("a_acrel", { pid: b.dataset.pid, per: b.dataset.per, st: 2, why }), done(() => { ADM.ac = null; })));
  on('[data-t1="achold"]', (b) => reason(ui, t("fp_hold"), (why) => adm("a_acrel", { pid: b.dataset.pid, per: b.dataset.per, st: 1, why }), done(() => { ADM.ac = null; })));
  const mv = (cfg && cfg.mev) || { off: 0, k: [] };
  on('[data-t1="mevall"]', () => reason(ui, t("mev_card"), (why) => adm("a_mev", { off: mv.off ? 0 : 1, k: mv.k, why }), done(() => onCfg && onCfg())));
  on('[data-t1="mevk"]', (b) => { const k = b.dataset.k, nk = mv.k.includes(k) ? mv.k.filter((x) => x !== k) : [...mv.k, k]; reason(ui, t("mev_k_" + k), (why) => adm("a_mev", { off: mv.off, k: nk, why }), done(() => onCfg && onCfg())); });
  const sel = el.querySelector("#t1-ssn"); if (sel) sel.addEventListener("change", () => { const v = +sel.value | 0; reason(ui, t("ssn_card"), (why) => adm("a_ssn", { m: v, why }), done(() => onCfg && onCfg())); }); }

// ---------- start ----------
export function top1Init(app) { ER.app = app; css(); CF.onCfg = (c) => setSeasonOv(c.ssn, app); try { if (app.ui) lockerTab(app.ui); } catch (_) {} }
try { if (location.hostname === "localhost") window.__t1 = { MV, ER, SSN }; } catch (_) {} // QA only (local test server)
