// Controls: floating joystick, follow-finger, swipe; hold-to-boost button; mouse + keyboard on desktop.
// Produces a target angle in world space (screen right = +x, screen down = +y) and a boost flag.
export class Input {
  constructor(el, boostEl, joyEl) {
    this.el = el; this.boostEl = boostEl; this.joyEl = joyEl; this.knob = joyEl.querySelector(".knob");
    this.mode = "joy"; this.sens = 1; this.left = false; this.angle = null; this.boost = false; this.enabled = false;
    this.steer = null; this.boostId = null; this.keys = new Set(); this.headScreen = () => [innerWidth / 2, innerHeight / 2];
    this.onPause = null; this.usedTouch = false; this.moved = 0;
    const opt = { passive: false };
    el.addEventListener("pointerdown", (e) => this.down(e), opt);
    addEventListener("pointermove", (e) => this.move(e), opt);
    addEventListener("pointerup", (e) => this.up(e), opt); addEventListener("pointercancel", (e) => this.up(e), opt);
    boostEl.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); this.boostId = e.pointerId; this.boost = true; boostEl.classList.add("on"); try { boostEl.setPointerCapture(e.pointerId); } catch (_) {} }, opt);
    const bu = (e) => { if (e.pointerId === this.boostId) { this.boostId = null; this.boost = false; boostEl.classList.remove("on"); } };
    boostEl.addEventListener("pointerup", bu); boostEl.addEventListener("pointercancel", bu); boostEl.addEventListener("lostpointercapture", bu);
    addEventListener("keydown", (e) => { if (!this.enabled) return; const k = e.key.toLowerCase(); this.keys.add(k); if (k === " " || k === "shift") { this.boost = true; e.preventDefault(); } if (k === "escape" || k === "p") this.onPause && this.onPause(); });
    addEventListener("keyup", (e) => { const k = e.key.toLowerCase(); this.keys.delete(k); if ((k === " " || k === "shift") && this.boostId === null && !this.mouseBoost) this.boost = false; });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    addEventListener("blur", () => { this.keys.clear(); this.boost = false; this.steer = null; this.boostEl.classList.remove("on"); this.hideJoy(); });
  }
  configure(s) { this.mode = s.ctrl; this.sens = s.sens; this.left = s.left; }
  reset() { this.angle = null; this.boost = false; this.steer = null; this.boostId = null; this.mouseBoost = false; this.hideJoy(); this.boostEl.classList.remove("on"); this.keys.clear(); }
  down(e) {
    if (!this.enabled) return;
    if (e.pointerType === "mouse") { if (e.button === 0 || e.button === 2) { this.mouseBoost = true; this.boost = true; } this.mouse(e); return; }
    e.preventDefault(); this.usedTouch = true;
    if (this.steer) return;
    this.steer = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY };
    if (this.mode === "joy") this.showJoy(e.clientX, e.clientY);
    if (this.mode === "follow") this.follow(e.clientX, e.clientY);
  }
  move(e) {
    if (!this.enabled) return;
    if (e.pointerType === "mouse") { this.mouse(e); return; }
    const s = this.steer; if (!s || e.pointerId !== s.id) return; e.preventDefault();
    const x = e.clientX, y = e.clientY;
    if (this.mode === "joy") {
      const dx = x - s.x0, dy = y - s.y0, d = Math.hypot(dx, dy), max = 56, dead = 7 / this.sens;
      if (d > dead) this.angle = Math.atan2(dy, dx);
      const k = Math.min(d, max) / (d || 1); this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      if (d > max * 1.6) { s.x0 = x - dx / d * max * 1.6; s.y0 = y - dy / d * max * 1.6; this.joyEl.style.left = s.x0 + "px"; this.joyEl.style.top = s.y0 + "px"; } // base follows a far finger
    } else if (this.mode === "follow") this.follow(x, y);
    else { const dx = x - s.lx, dy = y - s.ly, d = Math.hypot(dx, dy); if (d > 6 / this.sens) { this.angle = Math.atan2(dy, dx); s.lx = x; s.ly = y; } }
  }
  up(e) {
    if (e.pointerType === "mouse") { if (this.mouseBoost) { this.mouseBoost = false; if (!this.keys.has(" ") && !this.keys.has("shift")) this.boost = false; } return; }
    if (this.steer && e.pointerId === this.steer.id) { this.steer = null; this.hideJoy(); }
  }
  follow(x, y) { const [hx, hy] = this.headScreen(); const dx = x - hx, dy = y - hy; if (Math.hypot(dx, dy) > 8 / this.sens) this.angle = Math.atan2(dy, dx); }
  mouse(e) { const [hx, hy] = this.headScreen(); const dx = e.clientX - hx, dy = e.clientY - hy; if (Math.hypot(dx, dy) > 6) this.angle = Math.atan2(dy, dx); }
  showJoy(x, y) { const j = this.joyEl; j.style.left = x + "px"; j.style.top = y + "px"; j.classList.add("on"); this.knob.style.transform = "translate(0,0)"; }
  hideJoy() { this.joyEl.classList.remove("on"); }
  // keyboard steering rotates the current heading
  poll(cur, dt) {
    const k = this.keys; let turn = 0;
    if (k.has("arrowleft") || k.has("a")) turn -= 1; if (k.has("arrowright") || k.has("d")) turn += 1;
    if (turn) this.angle = cur + turn * 3.6 * dt * Math.max(1.5, 4 * this.sens);
    else if (k.has("arrowup") || k.has("w")) this.angle = -Math.PI / 2; else if (k.has("arrowdown") || k.has("s")) this.angle = Math.PI / 2;
    return this.angle;
  }
}
