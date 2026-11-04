// grow1: three sharing features.
//  - Challenge a friend: after an offline match a short link (?c=CODE) stores seed + mode + world + difficulty + score on the
//    server; the opener plays the same seed, sees beat / lose against the sender, and the sender is notified of the result.
//  - Save clip: the last 10 s are re-rendered from the death-replay buffer (recorded positions, never a live capture during
//    play) into a small canvas that MediaRecorder encodes (mp4 on Safari, webm elsewhere); shared through the share sheet.
//    Hidden where MediaRecorder / canvas capture is missing.
//  - Room QR: the private room's join link (?room=CODE&go=1) as a QR code drawn locally (js/qr.js); scanning joins directly.
import { t, fmtNum, addStrings } from "./i18n.js?v=play2";
import { call, errText } from "./social.js?v=play2";
import { qrDraw } from "./qr.js?v=play2";
import { WORLDS } from "./worlds.js?v=play2";

const $ = (id) => document.getElementById(id);
export const CH_MODES = new Set(["classic", "time", "survival", "br", "koth", "boss", "team", "goldrush", "infection", "duel"]); // same list as the server
const base = () => location.origin + location.pathname;

// native share sheet, else copy. Returns shared | copied | abort | gesture (Safari: the tap's activation was used up) | nofile | fail
async function shareOrCopy(o) {
  try {
    if (o.files) { if (navigator.canShare && navigator.canShare({ files: o.files })) { await navigator.share({ files: o.files, title: o.title, text: o.text }); return "shared"; } return "nofile"; }
    if (navigator.share) { await navigator.share({ title: o.title, text: o.text, url: o.url }); return "shared"; }
  } catch (e) { if (e && e.name === "AbortError") return "abort"; if (e && e.name === "NotAllowedError") return "gesture"; }
  if (!o.url) return "fail"; try { await navigator.clipboard.writeText(o.url); return "copied"; } catch (_) { return "fail"; }
}
// the button's text + aria-label; a ready state (gold) also shows on the icon-only buttons of short landscape screens
const label = (id, k) => { const b = $(id), s = b && b.querySelector("span"); if (!s) return; s.dataset.i = k; s.textContent = t(k); b.dataset.ia = k; b.setAttribute("aria-label", t(k)); b.classList.toggle("gold", k === "clipShare" || k === "chShareAgain"); b.classList.toggle("ghost", !(k === "clipShare" || k === "chShareAgain")); };

// ---------- challenge links ----------
async function chShare(ui) {
  const G = ui.app.game, r = ui.lastResults, b = $("r-chal"); if (!r || !G) return;
  if (!ui._ch || ui._ch.r !== r) { b.disabled = true; const x = await call("ch_new", { seed: G.mseed, mode: G.mode, wo: G.cfg.world | 0, df: G.cfg.diff | 0, sc: Math.round(r.score) || 0 }); b.disabled = false;
    if (!x || x.err) { ui.toast(errText(x && x.err), "warn"); return; } ui._ch = { r, url: base() + "?c=" + x.c }; }
  const url = ui._ch.url, st = await shareOrCopy({ title: "Super Snake Pro", text: t("chShareTxt", { n: fmtNum(r.score), m: t("m_" + G.mode) }), url });
  if (st === "copied") ui.toast("🔗 " + t("chCopied"), "", 3000);
  else if (st === "gesture" || st === "fail") { label("r-chal", "chShareAgain"); if (st === "fail") ui.toast(url, "", 6000); } // a second tap shares at once (the link is ready)
}
async function chOpen(ui, c) {
  const r = await call("ch_get", { c }); if (!r || r.err) { ui.toast(r && r.err === "notfound" ? t("chGone") : errText(r && r.err), "warn", 3500); return; }
  const ch = r.ch; if (ch.mine) { ui.toast(t("chOwn"), "", 3500); return; }
  if (!(await ui.confirm(t("chFrom", { n: ch.n, s: fmtNum(ch.sc), m: t("m_" + ch.mode) })))) return;
  const cfg = { mode: ch.mode, world: Math.max(0, Math.min(WORLDS.length - 1, ch.wo | 0)), diff: ch.df | 0, seed: ch.seed, room: "", ch: { c: ch.c, sc: ch.sc, n: ch.n } };
  if (!ui.p.tut) { ui.tutStart(cfg); return; } ui.launch(cfg);
}
export function growStart(ui) { const c = ui.app.chParam; if (!c) return; ui.app.chParam = ""; setTimeout(() => chOpen(ui, c), 1400); }

// ---------- clip: re-render the last 10 s of the replay buffer into a recorder ----------
const MIMES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
export function clipMime() { if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream) return "";
  for (const m of MIMES) try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {} return ""; }
function clipFail(ui) { ui._clip = null; label("r-clip", "clipBtn"); ui.toast(t("clipFail"), "warn", 3500); }
function startClip(ui) {
  const G = ui.app.game, src = $("gl"), mime = clipMime(); if (!src || !mime || !G || !G.rec || !G.rec.clip) return clipFail(ui);
  const k = Math.min(1, 720 / Math.max(1, Math.min(src.width, src.height))), W = Math.max(2, Math.round((src.width * k) / 2) * 2), H = Math.max(2, Math.round((src.height * k) / 2) * 2);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d"); let stream, mr; const chunks = [];
  try { stream = cv.captureStream(30); mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 }); } catch (_) { return clipFail(ui); }
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const rp = $("replay"), tt = rp && rp.querySelector(".rp-tt b"); if (rp) rp.classList.add("rp-cap"); if (tt) tt.textContent = t("clipRec");
  mr.onstop = () => { try { stream.getTracks().forEach((x) => x.stop()); } catch (_) {} if (rp) rp.classList.remove("rp-cap"); if (tt) tt.textContent = t("replay");
    const type = mime.split(";")[0], blob = new Blob(chunks, { type }); if (!blob.size) return clipFail(ui);
    ui._clip = { r: ui.lastResults, file: new File([blob], "super-snake-clip." + (type === "video/mp4" ? "mp4" : "webm"), { type }), url: URL.createObjectURL(blob) }; label("r-clip", "clipShare"); ui.toast("🎬 " + t("clipShare"), "", 2500); };
  // each rendered replay frame is copied right after it is drawn (same task, so no preserveDrawingBuffer is needed)
  const cap = { frame() { try { g.drawImage(src, 0, 0, W, H); } catch (_) {} }, stop() { try { if (mr.state !== "inactive") mr.stop(); } catch (_) {} } };
  try { mr.start(500); } catch (_) { return clipFail(ui); } cap.frame(); label("r-clip", "clipRec");
  if (!G.playReplay(true, cap)) cap.stop();
}
async function shareClip(ui) {
  const C = ui._clip; const st = await shareOrCopy({ files: [C.file], title: "Super Snake Pro", text: t("clipShareTxt") });
  if (st === "nofile" || st === "gesture" || st === "fail") { const a = document.createElement("a"); a.href = C.url; a.download = C.file.name; document.body.appendChild(a); a.click(); a.remove(); } // no file share: download
}

// ---------- room QR ----------
function qrOpen(ui) {
  const code = ui.roomCode(false), url = base() + "?room=" + encodeURIComponent(code) + "&go=1";
  $("qr-t").textContent = t("qrTitle", { n: code }); $("qr-u").textContent = url; qrDraw($("qr-cv"), url, 480); $("m-qr").classList.remove("x-hide"); $("qr-x").focus();
}

export function growBind(ui) {
  if (!$("m-qr")) { const d = document.createElement("div"); d.id = "m-qr"; d.className = "modal x-hide"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.innerHTML = `<div class="glass mcard qr-card"><p id="qr-t"></p><canvas id="qr-cv" width="240" height="240" role="img" data-ia="qrBtn"></canvas><p class="qr-url" dir="ltr" id="qr-u"></p><div class="r-btns"><button class="btn ghost" id="qr-share" data-i="shareRoom"></button><button class="btn gold" id="qr-x" data-i="qrClose"></button></div></div>`;
    document.body.appendChild(d); d.querySelectorAll("[data-i]").forEach((el) => (el.textContent = t(el.dataset.i))); }
  ui.click($("l-qr"), () => qrOpen(ui)); ui.click($("qr-x"), () => $("m-qr").classList.add("x-hide"), "back"); ui.click($("qr-share"), () => ui.shareRoom());
  ui.click($("r-chal"), () => chShare(ui));
  ui.click($("r-clip"), () => { if (ui._clip && ui._clip.r === ui.lastResults) shareClip(ui); else if (!ui.app.game.replay) startClip(ui); });
}

// called at the end of every results screen
export function growResults(ui, r) {
  const G = ui.app.game, cfg = (G && G.cfg) || {};
  $("r-chal").classList.toggle("x-hide", !(CH_MODES.has(r.mode) && G && G.mseed != null && !cfg.room)); if (!ui._ch || ui._ch.r !== r) label("r-chal", "chBtn");
  $("r-clip").classList.toggle("x-hide", !(r.replay && clipMime())); if (!ui._clip || ui._clip.r !== r) { if (ui._clip) try { URL.revokeObjectURL(ui._clip.url); } catch (_) {} ui._clip = null; label("r-clip", "clipBtn"); }
  const box = $("r-chres"), ch = cfg.ch; box.classList.toggle("x-hide", !ch); if (!ch) return;
  const a = Math.round(r.score) || 0, win = a > ch.sc; box.classList.toggle("win", win);
  box.textContent = (win ? "🏆 " : "⚔️ ") + t(win ? "chWin" : "chLose", { n: ch.n, a: fmtNum(a), b: fmtNum(ch.sc) });
  if (G._chSent !== r) { G._chSent = r; call("ch_res", { c: ch.c, sc: a }).catch(() => {}); }
}

addStrings({
  chBtn: ["Challenge a friend", "تحدّى صديق", "Arkadaşına meydan oku", "Défier un ami", "Reta a un amigo", "दोस्त को चुनौती दें"],
  chShareTxt: ["Beat my {n} in {m} on Super Snake!", "اغلب نتيجتي {n} في {m} على Super Snake!", "Super Snake'te {m} modunda {n} skorumu geç!", "Bats mon score de {n} en {m} sur Super Snake !", "¡Supera mis {n} en {m} en Super Snake!", "Super Snake पर {m} में मेरा {n} स्कोर हराओ!"],
  chCopied: ["Challenge link copied", "تم نسخ رابط التحدي", "Meydan okuma bağlantısı kopyalandı", "Lien du défi copié", "Enlace del reto copiado", "चुनौती लिंक कॉपी हुआ"],
  chShareAgain: ["Share link", "شارك الرابط", "Bağlantıyı paylaş", "Partager le lien", "Compartir enlace", "लिंक शेयर करें"],
  chFrom: ["{n} challenges you: beat {s} in {m}. Same map. Play now?", "{n} يتحداك: اغلب {s} في {m}. نفس الخريطة. تلعب هسه؟", "{n} sana meydan okuyor: {m} modunda {s} skorunu geç. Aynı harita. Şimdi oyna?", "{n} te défie : bats {s} en {m}. Même carte. Jouer maintenant ?", "{n} te reta: supera {s} en {m}. Mismo mapa. ¿Jugar ahora?", "{n} ने आपको चुनौती दी: {m} में {s} हराएँ। वही नक्शा। अभी खेलें?"],
  chOwn: ["That's your own challenge. Send it to a friend", "هذا تحديك انت. دزّه لصديق", "Bu senin meydan okuman. Bir arkadaşına gönder", "C'est ton propre défi. Envoie-le à un ami", "Es tu propio reto. Envíalo a un amigo", "यह आपकी अपनी चुनौती है। किसी दोस्त को भेजें"],
  chGone: ["This challenge has expired", "هذا التحدي انتهى", "Bu meydan okumanın süresi doldu", "Ce défi a expiré", "Este reto ha caducado", "यह चुनौती समाप्त हो गई"],
  chWin: ["You beat {n}! {a} vs {b}", "غلبت {n}! {a} مقابل {b}", "{n} oyuncusunu geçtin! {a} - {b}", "Tu as battu {n} ! {a} contre {b}", "¡Superaste a {n}! {a} contra {b}", "आपने {n} को हराया! {a} बनाम {b}"],
  chLose: ["{n} still leads: {b} vs your {a}", "{n} بعده متقدم: {b} مقابل {a} مالتك", "{n} hâlâ önde: {b} - senin {a}", "{n} mène encore : {b} contre ton {a}", "{n} sigue delante: {b} contra tus {a}", "{n} अभी आगे है: {b} बनाम आपका {a}"],
  chResW: ["{n} beat your challenge: {a} vs your {b}", "{n} غلب تحديك: {a} مقابل {b} مالتك", "{n} meydan okumanı geçti: {a} - senin {b}", "{n} a battu ton défi : {a} contre ton {b}", "{n} superó tu reto: {a} contra tus {b}", "{n} ने आपकी चुनौती जीत ली: {a} बनाम आपका {b}"],
  chResL: ["{n} lost your challenge: {a} vs your {b}", "{n} خسر بتحديك: {a} مقابل {b} مالتك", "{n} meydan okumanı geçemedi: {a} - senin {b}", "{n} a perdu ton défi : {a} contre ton {b}", "{n} perdió tu reto: {a} contra tus {b}", "{n} आपकी चुनौती हार गया: {a} बनाम आपका {b}"],
  clipBtn: ["Save clip", "احفظ مقطع", "Klibi kaydet", "Enregistrer le clip", "Guardar clip", "क्लिप सेव करें"],
  clipRec: ["Recording clip…", "جاري تسجيل المقطع…", "Klip kaydediliyor…", "Enregistrement du clip…", "Grabando clip…", "क्लिप रिकॉर्ड हो रही है…"],
  clipShare: ["Share clip", "شارك المقطع", "Klibi paylaş", "Partager le clip", "Compartir clip", "क्लिप शेयर करें"],
  clipShareTxt: ["My last 10 seconds in Super Snake", "آخر 10 ثواني إلي بـ Super Snake", "Super Snake'teki son 10 saniyem", "Mes 10 dernières secondes sur Super Snake", "Mis últimos 10 segundos en Super Snake", "Super Snake में मेरे आखिरी 10 सेकंड"],
  clipFail: ["Couldn't make the clip on this device", "ما گدرنا نسوي المقطع على هذا الجهاز", "Bu cihazda klip oluşturulamadı", "Impossible de créer le clip sur cet appareil", "No se pudo crear el clip en este dispositivo", "इस डिवाइस पर क्लिप नहीं बन सकी"],
  qrBtn: ["Show room QR code", "اعرض رمز QR للغرفة", "Oda QR kodunu göster", "Afficher le QR code de la salle", "Mostrar código QR de la sala", "कमरे का QR कोड दिखाएँ"],
  qrTitle: ["Scan to join room {n}", "امسح الرمز حتى تدخل الغرفة {n}", "{n} odasına katılmak için tara", "Scanne pour rejoindre la salle {n}", "Escanea para unirte a la sala {n}", "कमरे {n} में जुड़ने के लिए स्कैन करें"],
  qrClose: ["Close", "إغلاق", "Kapat", "Fermer", "Cerrar", "बंद करें"],
});
