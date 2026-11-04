// Soft epic VFX (aaa2): one pooled, instanced billboard-orb system + pooled soft ground rings + crown + light shaft.
// Everything is allocated once; per frame only the live instances are written (compacted) and uploaded.
// "Calm" (Reduce effects) keeps these soft, short, low-count and flash-free; no shake, no strobing.
import * as THREE from "../vendor/three.module.min.js?v=play2";

const NO = 480, NR = 12;
const OVS = /* glsl */ `
attribute vec4 aP; attribute vec4 aC; varying vec4 vC; varying vec2 vUv;
void main(){ vC=aC; vUv=position.xy;
  vec4 mv=viewMatrix*vec4(aP.xyz,1.0); mv.xy+=position.xy*aP.w; gl_Position=projectionMatrix*mv; }`;
const OFS = /* glsl */ `
varying vec4 vC; varying vec2 vUv;
void main(){ float d=length(vUv)*2.0; if(d>1.0) discard; float a=exp(-d*d*4.2)*(1.0-d); float core=exp(-d*d*28.0);
  gl_FragColor=vec4(vC.rgb*(a+core*0.35)*0.55, (a+core*0.35)*vC.a*0.7); }`; // fix1: soft, no hot core
const RVS = /* glsl */ `attribute vec4 aP; attribute vec4 aC; varying vec4 vC; varying vec2 vUv; varying float vR;
void main(){ vC=aC; vUv=position.xy; vR=aP.w; vec3 w=vec3(aP.x+position.x*aP.w, aP.y, aP.z+position.y*aP.w); gl_Position=projectionMatrix*viewMatrix*vec4(w,1.0); }`;
const RFS = /* glsl */ `varying vec4 vC; varying vec2 vUv; varying float vR;
void main(){ float r=length(vUv)*2.0; float w=clamp(0.9/max(vR,0.6),0.04,0.35); float e=smoothstep(1.0-w,1.0-w*0.3,r)*(1.0-smoothstep(1.0-w*0.15,1.0,r)); float fill=smoothstep(0.2,1.0,r)*0.18*(1.0-step(1.0,r));
  float a=(e+fill)*vC.a; if(a<0.002) discard; gl_FragColor=vec4(vC.rgb*(e*0.7+fill)*0.6, a*0.6); }`; // fix1: soft rings

function quadGeo(n) {
  const g = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1);
  g.index = q.index; g.setAttribute("position", q.getAttribute("position"));
  const P = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const C = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("aP", P); g.setAttribute("aC", C); g.instanceCount = 0; return g;
}

export class SoftFx {
  constructor(r3) {
    this.r3 = r3; this.group = new THREE.Group();
    // ---- orbs ----
    this.og = quadGeo(NO);
    this.orbs = new THREE.Mesh(this.og, new THREE.ShaderMaterial({ vertexShader: OVS, fragmentShader: OFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    this.orbs.frustumCulled = false; this.orbs.renderOrder = 6; this.group.add(this.orbs);
    const F = (k) => new Float32Array(NO * k);
    this.p = F(3); this.v = F(3); this.c = F(3); this.life = F(1); this.max = F(1); this.sz = F(1); this.drag = F(1); this.grav = F(1); this.home = new Int8Array(NO); this.tgt = F(2); this.hk = F(1); this.n = 0;
    // ---- rings ----
    this.rgG = quadGeo(NR); const rm = new THREE.ShaderMaterial({ vertexShader: RVS, fragmentShader: RFS, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.rgs = new THREE.Mesh(this.rgG, rm); this.rgs.frustumCulled = false; this.rgs.renderOrder = 4; this.group.add(this.rgs);
    this.rp = new Float32Array(NR * 3); this.rc = new Float32Array(NR * 3); this.rt = new Float32Array(NR).fill(1); this.rR = new Float32Array(NR); this.rd = new Float32Array(NR);
    // ---- crown (top-1) ----
    const gold = new THREE.MeshStandardMaterial({ color: 0xffcf4a, metalness: 1, roughness: 0.22, emissive: 0x3a2400, emissiveIntensity: 0.25, envMapIntensity: 1.0, side: THREE.DoubleSide });
    const cg = new THREE.Group(); const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.92, 0.42, 20, 1, true), gold); cg.add(band);
    const spk = new THREE.ConeGeometry(0.2, 0.62, 6); const gem = new THREE.MeshStandardMaterial({ color: 0xff3a5a, roughness: 0.1, metalness: 0.2, emissive: 0x8a0018, emissiveIntensity: 0.15 });
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, m = new THREE.Mesh(spk, gold); m.position.set(Math.cos(a) * 0.94, 0.46, Math.sin(a) * 0.94); cg.add(m);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), i % 2 ? gem : gold); b.position.set(Math.cos(a) * 0.94, 0.8, Math.sin(a) * 0.94); cg.add(b); }
    cg.visible = false; this.crown = cg; this.group.add(cg); this.crownA = 0;
    // ---- light shaft (victory) ----
    const sm = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0 }, uT: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      vertexShader: "varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform float uA, uT; varying vec2 vU; void main(){ float h=vU.y; float s=0.75+0.25*sin(vU.x*25.1+uT*1.5); float a=pow(1.0-h,1.6)*smoothstep(0.0,0.08,h)*s*uA; gl_FragColor=vec4(vec3(1.0,0.86,0.55)*a, a); }" });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.4, 40, 24, 1, true).translate(0, 20, 0), sm); this.shaft.visible = false; this.shaft.renderOrder = 7; this.group.add(this.shaft); this.shaftT = 0; this.shaftX = 0; this.shaftZ = 0;
    this.lastWake = 0; this.punch = 0;
  }
  get calm() { return !!this.r3.calm; }
  // ---------- orbs ----------
  orb(x, y, z, vx, vy, vz, rgb, life, size, drag = 1.5, grav = 0, k = 1) {
    if (this.n >= NO) return -1; const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 3] = rgb[0] * k; this.c[i * 3 + 1] = rgb[1] * k; this.c[i * 3 + 2] = rgb[2] * k; this.life[i] = life; this.max[i] = life; this.sz[i] = size; this.drag[i] = drag; this.grav[i] = grav; this.home[i] = 0; return i;
  }
  homeTo(i, x, z, k) { if (i < 0) return; this.home[i] = 1; this.tgt[i * 2] = x; this.tgt[i * 2 + 1] = z; this.hk[i] = k; }
  // ---------- rings ----------
  ring(x, z, rgb, R, dur = 0.7, y = 0.08) {
    let best = 0, bt = -1; for (let i = 0; i < NR; i++) if (this.rt[i] > bt) { bt = this.rt[i]; best = i; }
    const i = best; this.rp[i * 3] = x; this.rp[i * 3 + 1] = y; this.rp[i * 3 + 2] = z; this.rc[i * 3] = rgb[0]; this.rc[i * 3 + 1] = rgb[1]; this.rc[i * 3 + 2] = rgb[2]; this.rt[i] = 0; this.rR[i] = R; this.rd[i] = dur;
  }
  // ---------- effects ----------
  eat(x, z, hx, hz, rgb, big) { // sparkle at the mouth (the food itself is already pulled in as a ghost)
    const n = this.calm ? (big ? 4 : 2) : big ? 9 : 4;
    for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, s = 1.2 + Math.random() * 2.2; this.orb(hx, 0.9 + Math.random() * 0.4, hz, Math.cos(a) * s, 0.8 + Math.random() * 1.6, Math.sin(a) * s, rgb, 0.34 + Math.random() * 0.2, big ? 1.0 : 0.7, 4, 1, 1.3); }
    if (big) this.ring(hx, hz, rgb, 2.6, 0.45);
  }
  grow(x, z, rgb, r) { this.ring(x, z, rgb, Math.max(3, r * 5), 0.8); }
  levelup(x, z, rgb) {
    this.ring(x, z, [1.2, 0.95, 0.45], 9, 1.0); this.ring(x, z, rgb, 6, 0.75);
    const n = this.calm ? 14 : 34; for (let k = 0; k < n; k++) { const a = (k / n) * 6.283, s = 3 + Math.random() * 3; this.orb(x + Math.cos(a), 0.8, z + Math.sin(a), Math.cos(a) * s, 2.5 + Math.random() * 3, Math.sin(a) * s, k % 3 ? rgb : [1.2, 0.95, 0.5], 0.9 + Math.random() * 0.4, 1.1, 1.6, -0.4, 1.2); }
  }
  wake(x, z, rgb, r) { // boost glow wake: a few soft orbs left behind the tail
    const now = this.r3.time; if (now - this.lastWake < (this.calm ? 0.07 : 0.035)) return; this.lastWake = now;
    this.orb(x + (Math.random() - 0.5) * r, r * 0.7, z + (Math.random() - 0.5) * r, 0, 0.25, 0, rgb, 0.55, r * 2.6, 2, 0, 0.5);
  }
  dissolve(pts, n, rgb, kx, kz, hasK, glow) { // enemy dissolves into glowing orbs that drift (towards the killer)
    const cap = this.calm ? 26 : 60, step = Math.max(1, Math.ceil(n / cap)); const g = glow || rgb;
    for (let j = 0; j < n; j += step) { const x = pts[j * 2], z = pts[j * 2 + 1], a = Math.random() * 6.283, s = 0.6 + Math.random() * 1.4;
      const i = this.orb(x, 0.7 + Math.random() * 0.5, z, Math.cos(a) * s, 1.2 + Math.random() * 1.8, Math.sin(a) * s, (j / step) % 3 ? rgb : g, 0.9 + Math.random() * 0.6, 0.9 + Math.random() * 0.7, 1.2, -0.6, 1.25);
      if (hasK) this.homeTo(i, kx, kz, 2.2 + Math.random() * 1.5); }
    const hx = pts[0], hz = pts[1]; this.ring(hx, hz, g, 8, 0.85); this.ring(hx, hz, [1, 1, 1], 4.5, 0.55);
  }
  win(x, z) { this.shaftT = 0.0001; this.shaftX = x; this.shaftZ = z; this.shaft.visible = true; this.ring(x, z, [1.3, 1.0, 0.5], 12, 1.4); this.levelup(x, z, [1.2, 0.85, 0.3]); }
  setCrown(x, z, y, r, on) { this.crownOn = on; if (on) { if (this._cid !== undefined && Math.hypot(x - this.cx, z - this.cz) > 4) this._cwSnap = true; this._cid = 1; this.cx = x; this.cz = z; this.cy = y; this.cr = r; } }
  clear() { this.n = 0; this.rt.fill(1); this.shaftT = 0; this.shaft.visible = false; this.punch = 0; }
  // ---------- per frame ----------
  update(dt, t) {
    // orbs
    const P = this.og.attributes.aP.array, C = this.og.attributes.aC.array; let w = 0;
    for (let i = 0; i < this.n; i++) {
      let l = this.life[i] - dt; if (l <= 0) continue; const i3 = i * 3;
      let vx = this.v[i3], vy = this.v[i3 + 1], vz = this.v[i3 + 2]; const dr = Math.exp(-dt * this.drag[i]);
      if (this.home[i]) { const u = 1 - l / this.max[i], hk = this.hk[i] * u * u; vx += (this.tgt[i * 2] - this.p[i3]) * hk * dt * 4; vz += (this.tgt[i * 2 + 1] - this.p[i3 + 2]) * hk * dt * 4; }
      vx *= dr; vy = vy * dr - this.grav[i] * dt; vz *= dr;
      const x = this.p[i3] + vx * dt, y = Math.max(0.15, this.p[i3 + 1] + vy * dt), z = this.p[i3 + 2] + vz * dt;
      // compact into slot w
      if (w !== i) { const w3 = w * 3; this.c[w3] = this.c[i3]; this.c[w3 + 1] = this.c[i3 + 1]; this.c[w3 + 2] = this.c[i3 + 2]; this.max[w] = this.max[i]; this.sz[w] = this.sz[i]; this.drag[w] = this.drag[i]; this.grav[w] = this.grav[i]; this.home[w] = this.home[i]; this.tgt[w * 2] = this.tgt[i * 2]; this.tgt[w * 2 + 1] = this.tgt[i * 2 + 1]; this.hk[w] = this.hk[i]; }
      const w3 = w * 3; this.p[w3] = x; this.p[w3 + 1] = y; this.p[w3 + 2] = z; this.v[w3] = vx; this.v[w3 + 1] = vy; this.v[w3 + 2] = vz; this.life[w] = l;
      const u = l / this.max[w], fade = u > 0.85 ? (1 - u) / 0.15 : Math.pow(u / 0.85, 0.8), o = w * 4;
      P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = this.sz[w] * (0.6 + 0.4 * fade); C[o] = this.c[w3]; C[o + 1] = this.c[w3 + 1]; C[o + 2] = this.c[w3 + 2]; C[o + 3] = fade * 0.85; w++;
    }
    this.n = w; this.og.instanceCount = w; if (w) { this.og.attributes.aP.needsUpdate = true; this.og.attributes.aC.needsUpdate = true; } this.orbs.visible = w > 0;
    // rings
    const RP = this.rgG.attributes.aP.array, RC = this.rgG.attributes.aC.array; let nr = 0;
    for (let i = 0; i < NR; i++) { if (this.rt[i] >= 1) continue; this.rt[i] = Math.min(1, this.rt[i] + dt / this.rd[i]); const u = this.rt[i]; if (u >= 1) continue;
      const e = 1 - Math.pow(1 - u, 3), o = nr * 4; RP[o] = this.rp[i * 3]; RP[o + 1] = this.rp[i * 3 + 1]; RP[o + 2] = this.rp[i * 3 + 2]; RP[o + 3] = (0.4 + e * this.rR[i]) * 2;
      const a = (1 - u) * (1 - u) * 0.7; RC[o] = this.rc[i * 3]; RC[o + 1] = this.rc[i * 3 + 1]; RC[o + 2] = this.rc[i * 3 + 2]; RC[o + 3] = a; nr++; }
    this.rgG.instanceCount = nr; if (nr) { this.rgG.attributes.aP.needsUpdate = true; this.rgG.attributes.aC.needsUpdate = true; } this.rgs.visible = nr > 0;
    // crown: eases in/out, floats + slowly turns above the leader's head
    this.crownA += ((this.crownOn ? 1 : 0) - this.crownA) * (1 - Math.exp(-dt * 5));
    // fix1: sits centred on the head top (no bob, no spin) and follows it tightly; snaps when it (re)appears
    const cw = this.crown; if (this.crownA > 0.02) { const s = Math.max(0.42, this.cr * 0.55) * (0.7 + 0.3 * this.crownA), ty = this.cy + s * 0.24 + 0.04, k = !cw.visible || this._cwSnap ? 1 : 1 - Math.exp(-dt * 40); cw.visible = true; this._cwSnap = false; cw.scale.setScalar(s); cw.position.set(cw.position.x + (this.cx - cw.position.x) * k, cw.position.y + (ty - cw.position.y) * k, cw.position.z + (this.cz - cw.position.z) * k); cw.rotation.y = 0.31; } else { cw.visible = false; this._cwSnap = true; }
    // victory light shaft
    if (this.shaftT > 0) { this.shaftT += dt; const u = this.shaftT, a = Math.min(1, u * 1.6) * (u > 3.2 ? Math.max(0, 1 - (u - 3.2) / 0.8) : 1); this.shaft.material.uniforms.uA.value = a * 0.55; this.shaft.material.uniforms.uT.value = t; this.shaft.position.set(this.shaftX, 0, this.shaftZ); if (u > 4) { this.shaftT = 0; this.shaft.visible = false; } }
    this.punch *= Math.exp(-dt * 7);
  }
  dispose() { this.og.dispose(); this.rgG.dispose(); this.orbs.material.dispose(); this.rgs.material.dispose(); this.shaft.geometry.dispose(); this.shaft.material.dispose(); this.crown.traverse((c) => { if (c.isMesh) { c.geometry.dispose(); } }); }
}
