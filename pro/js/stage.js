// resp1: where the menu snake preview stands, in canvas px: the free box the Lobby UI leaves (under the skin name / Locker button,
// above the world thumbnails, inside the show column), or in portrait the Locker stage above its info card. null = default framing.
export function stageBox(R) {
  const q = (id) => { const e = document.getElementById(id); return e && e.offsetWidth ? e.getBoundingClientRect() : null; };
  const lob = document.getElementById("s-lobby"), cus = document.getElementById("s-custom"), H = R.height || innerHeight;
  if (lob && lob.classList.contains("on")) {
    const tag = q("l-showtag"), act = q("l-locker"), wr = q("l-worlds") || q("l-dailyinfo") || q("l-diff") || q("l-room"), ce = document.querySelector("#s-lobby .col-c"), cc = ce && ce.offsetWidth ? ce.getBoundingClientRect() : null;
    let bot = wr ? wr.top : R.top + H * 0.86; if (cc) bot = Math.min(bot, cc.bottom);
    let top = Math.max(tag ? tag.bottom : 0, cc ? cc.top : 0); // resp2: portrait puts the Locker button at the foot of the stage, the snake stands above it
    if (act && cc && act.top > (cc.top + cc.bottom) / 2) bot = Math.min(bot, act.top); else if (act) top = Math.max(top, act.bottom);
    return { top: top - R.top, bot: bot - R.top, cx: cc ? (cc.left + cc.right) / 2 - R.left : null };
  }
  if (cus && cus.classList.contains("on") && innerHeight > innerWidth) {
    const st = cus.querySelector(".lk-show"), inf = q("c-info"); if (!st || !st.offsetWidth) return null; const b = st.getBoundingClientRect();
    return { top: b.top - R.top, bot: (inf && inf.top > b.top + 40 ? inf.top : b.bottom) - R.top, cx: (b.left + b.right) / 2 - R.left };
  }
  return null;
}
