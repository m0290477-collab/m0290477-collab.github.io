// coin1: in-game links to the Privacy Policy / Terms pages, the feedback form, and the wallet's messages (6 UI languages).
import { t, addStrings, LANG } from "./i18n.js?v=admin2";
import { CONTACT_EMAIL } from "./legal-config.js?v=admin2";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lang = () => (typeof LANG === "function" ? LANG() : LANG) || "en";
export const legalUrl = (k) => `${k}.html?lang=${encodeURIComponent(lang())}`;
// two real buttons (44 px), opened in a new tab so a match / the lobby is never lost
export function legalButtons(cls = "") { return `<div class="ac-btns lg-legal ${cls}"><a class="btn ac-b" href="${legalUrl("privacy")}" target="_blank" rel="noopener">${t("lg_privacy")}</a><a class="btn ac-b" href="${legalUrl("terms")}" target="_blank" rel="noopener">${t("lg_terms")}</a></div>`; }
export const contactNote = () => (CONTACT_EMAIL ? t("lg_mail", { e: esc(CONTACT_EMAIL) }) : t("lg_contact"));
// feedback: a short text to the owner (stored with the reports; deleted with the account)
export function openFeedback(ui, call) {
  let m = document.getElementById("m-fb");
  if (!m) { m = document.createElement("div"); m.id = "m-fb"; m.className = "modal x-hide"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); document.body.appendChild(m); }
  m.innerHTML = `<div class="glass mcard fb-card"><h3>${t("fb_title")}</h3><p class="fine">${t("fb_sub")}</p><textarea id="fb-tx" maxlength="500" rows="5" dir="auto" aria-label="${t("fb_title")}"></textarea>
    <div class="row fb-row"><button class="btn" id="fb-x">${t("so_cancel")}</button><button class="btn primary" id="fb-go">${t("fb_send")}</button></div></div>`;
  m.classList.remove("x-hide"); const tx = m.querySelector("#fb-tx"); setTimeout(() => tx.focus(), 50);
  const close = () => m.classList.add("x-hide"); m.querySelector("#fb-x").onclick = close; m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelector("#fb-go").onclick = async () => { const v = tx.value.trim(); if (v.length < 3) { tx.focus(); return; } const b = m.querySelector("#fb-go"); b.disabled = true;
    const r = await call("fb", { tx: v }); b.disabled = false; if (r && r.ok) { close(); ui.toast("✓ " + t("fb_done"), "good", 3500); } else ui.toast(r && r.err === "rate" ? t("fb_rate") : t("w_offlineS"), "warn", 3500); };
}
addStrings({
  w_offline: ["You're offline. Purchases need a connection — your saved balance is ◆{n}.", "انت مو متصل. الشراء يحتاج إنترنت — رصيدك المحفوظ ◆{n}.", "Çevrimdışısın. Satın almak için bağlantı gerekir — kayıtlı bakiyen ◆{n}.", "Tu es hors ligne. Les achats demandent une connexion — ton solde enregistré : ◆{n}.", "Estás sin conexión. Las compras necesitan conexión — tu saldo guardado es ◆{n}.", "आप ऑफ़लाइन हैं। ख़रीदारी के लिए कनेक्शन चाहिए — आपका सहेजा बैलेंस ◆{n} है।"],
  w_offlineS: ["No connection. Try again when you're online.", "ماكو اتصال. جرّب لمن ترجع أونلاين.", "Bağlantı yok. Çevrimiçi olunca tekrar dene.", "Pas de connexion. Réessaie une fois en ligne.", "Sin conexión. Inténtalo cuando estés en línea.", "कनेक्शन नहीं है। ऑनलाइन होने पर फिर कोशिश करें।"],
  w_price: ["That offer just changed — prices are updated.", "العرض تغيّر هسه — الأسعار تحدّثت.", "Bu teklif az önce değişti — fiyatlar güncellendi.", "Cette offre vient de changer — prix mis à jour.", "La oferta acaba de cambiar — precios actualizados.", "यह ऑफ़र अभी बदला — कीमतें अपडेट हो गईं।"],
  w_spinOff: ["The lucky wheel needs a connection.", "عجلة الحظ تحتاج إنترنت.", "Şans çarkı için bağlantı gerekir.", "La roue de la chance demande une connexion.", "La ruleta necesita conexión.", "लकी व्हील के लिए कनेक्शन चाहिए।"],
  w_bal: ["Coins are kept safe on the server", "الكوينز محفوظة بأمان على السيرفر", "Coinler sunucuda güvende", "Les pièces sont gardées sur le serveur", "Las monedas se guardan en el servidor", "सिक्के सर्वर पर सुरक्षित हैं"],
  lg_privacy: ["Privacy Policy", "سياسة الخصوصية", "Gizlilik Politikası", "Confidentialité", "Privacidad", "गोपनीयता नीति"],
  lg_terms: ["Terms of Use", "شروط الاستخدام", "Kullanım Koşulları", "Conditions", "Términos de uso", "उपयोग की शर्तें"],
  lg_agree: ["By signing in you agree to the Terms of Use and the Privacy Policy.", "بتسجيل الدخول توافق على شروط الاستخدام وسياسة الخصوصية.", "Giriş yaparak Kullanım Koşullarını ve Gizlilik Politikasını kabul edersin.", "En te connectant, tu acceptes les Conditions et la Politique de confidentialité.", "Al iniciar sesión aceptas los Términos de uso y la Política de privacidad.", "साइन इन करके आप उपयोग की शर्तों और गोपनीयता नीति से सहमत होते हैं।"],
  lg_dataSub: ["What we store and how to delete it", "شنو نحفظ وشلون تحذفه", "Ne saklıyoruz, nasıl silinir", "Ce que nous gardons et comment l'effacer", "Qué guardamos y cómo borrarlo", "हम क्या रखते हैं और कैसे हटाएँ"],
  lg_contact: ["Contact: use Send feedback below or Report on a chat message.", "للتواصل: استخدم «أرسل ملاحظة» جوّا أو «إبلاغ» على رسالة بالدردشة.", "İletişim: aşağıdaki Geri bildirim gönder'i veya bir sohbet mesajındaki Bildir'i kullan.", "Contact : utilise « Envoyer un avis » ci-dessous ou « Signaler » sur un message.", "Contacto: usa «Enviar comentarios» abajo o «Denunciar» en un mensaje.", "संपर्क: नीचे «फ़ीडबैक भेजें» या चैट संदेश पर «रिपोर्ट» का उपयोग करें।"],
  lg_mail: ["Contact: {e}", "للتواصل: {e}", "İletişim: {e}", "Contact : {e}", "Contacto: {e}", "संपर्क: {e}"],
  fb_title: ["Send feedback", "أرسل ملاحظة", "Geri bildirim gönder", "Envoyer un avis", "Enviar comentarios", "फ़ीडबैक भेजें"],
  fb_sub: ["Ideas, bugs, questions — the game's owner reads them. Don't include passwords or personal details.", "أفكار، أخطاء، أسئلة — صاحب اللعبة يقراها. لا تكتب كلمات سر أو معلومات شخصية.", "Fikirler, hatalar, sorular — oyunun sahibi okur. Şifre veya kişisel bilgi yazma.", "Idées, bugs, questions — le créateur du jeu les lit. N'écris ni mot de passe ni info personnelle.", "Ideas, errores, preguntas — el dueño del juego las lee. No incluyas contraseñas ni datos personales.", "आइडिया, बग, सवाल — गेम के मालिक पढ़ते हैं। पासवर्ड या निजी जानकारी न लिखें।"],
  fb_send: ["Send", "إرسال", "Gönder", "Envoyer", "Enviar", "भेजें"],
  fb_done: ["Thanks — feedback sent.", "شكراً — انرسلت الملاحظة.", "Teşekkürler — gönderildi.", "Merci — avis envoyé.", "Gracias — comentarios enviados.", "धन्यवाद — फ़ीडबैक भेजा गया।"],
  fb_rate: ["You've sent a lot of feedback — try again later.", "دزّيت هواية ملاحظات — جرّب بعدين.", "Çok fazla gönderdin — sonra tekrar dene.", "Beaucoup d'avis envoyés — réessaie plus tard.", "Has enviado muchos — inténtalo más tarde.", "बहुत फ़ीडबैक भेजा — बाद में कोशिश करें।"],
  ac_delG: ["Delete my online data", "احذف بياناتي على السيرفر", "Çevrimiçi verilerimi sil", "Supprimer mes données en ligne", "Borrar mis datos en línea", "मेरा ऑनलाइन डेटा हटाएँ"],
  ac_delGQ: ["Delete your online data for good? Your ID, friends, chats, coins, items and server backup are removed from the server and this device starts a fresh profile. This can't be undone.", "تحذف بياناتك من السيرفر نهائياً؟ الآيدي والأصدقاء والمحادثات والكوينز والأغراض والنسخة الاحتياطية تنمسح، وهذا الجهاز يبدي ملف جديد. ما ينرجع.", "Çevrimiçi verilerin kalıcı olarak silinsin mi? Kimliğin, arkadaşların, sohbetlerin, coinlerin, eşyaların ve yedeğin sunucudan silinir ve bu cihaz yeni bir profille başlar. Geri alınamaz.", "Supprimer définitivement tes données en ligne ? ID, amis, conversations, pièces, objets et sauvegarde sont effacés du serveur et cet appareil repart d'un profil neuf. Irréversible.", "¿Borrar tus datos en línea para siempre? Tu ID, amigos, chats, monedas, objetos y copia se borran del servidor y este dispositivo empieza un perfil nuevo. No se puede deshacer.", "अपना ऑनलाइन डेटा हमेशा के लिए हटाएँ? आपकी ID, दोस्त, चैट, सिक्के, आइटम और बैकअप सर्वर से हट जाएँगे और यह डिवाइस नई प्रोफ़ाइल से शुरू होगा। इसे वापस नहीं किया जा सकता।"],
  ac_delGDone: ["Your online data was deleted.", "انحذفت بياناتك من السيرفر.", "Çevrimiçi verilerin silindi.", "Tes données en ligne ont été supprimées.", "Tus datos en línea se borraron.", "आपका ऑनलाइन डेटा हटा दिया गया।"],
});
