// 3D renderer (Three.js, self-hosted). Tilted perspective camera, lit & shaded instanced snake bodies with scale bump,
// fresnel rim, blob shadows, emissive food with halos, pooled GPU particles, themed worlds, optional bloom.
// Zero per-frame allocation: every instance buffer is written in place.
import * as THREE from "./vendor/three.module.min.js";
import { EffectComposer } from "./vendor/EffectComposer.js";
import { RenderPass } from "./vendor/RenderPass.js";
import { UnrealBloomPass } from "./vendor/UnrealBloomPass.js";
import { OutputPass } from "./vendor/OutputPass.js";
import { bodyPoints } from "./sim.js";
import { WORLDS, paintGround } from "./worlds.js";
import { EYES, TRAILS } from "./skins.js";

export const QUALITY = {
  low: { dpr: 1, seg: [8, 6], bloom: false, shadowStep: 2, particles: 500, decor: 0.45, names: 1, bump: false, ambient: 0.4, spacing: 0.62 },
  medium: { dpr: 1.5, seg: [12, 8], bloom: false, shadowStep: 1, particles: 1000, decor: 0.75, names: 2, bump: true, ambient: 0.7, spacing: 0.52 },
  high: { dpr: 2, seg: [16, 10], bloom: true, shadowStep: 1, particles: 1600, decor: 1, names: 2, bump: true, ambient: 1, spacing: 0.46 },
  ultra: { dpr: 2.5, seg: [20, 14], bloom: true, shadowStep: 1, particles: 2400, decor: 1.3, names: 2, bump: true, ambient: 1.3, spacing: 0.4 },
};
const MAX_SEG = 7000, MAX_FOOD = 1400, MAX_HEAD = 64, MAX_GEM = 300;
const toLin = (v) => (v <= 0 ? 0 : v * v * (0.7 + 0.3 * v)); // cheap sRGB→linear
const hex3 = (h) => { const n = parseInt(h.slice(1), 16); return [toLin((n >> 16 & 255) / 255), toLin((n >> 8 & 255) / 255), toLin((n & 255) / 255)]; };
const EYEC = EYES.map((e) => ({ w: hex3(e.ec), p: hex3(e.pc) })); const TRAILC = TRAILS.map((t) => (t.c ? t.c.map(hex3) : null));

export class Renderer3D {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance", stencil: false }) || canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) throw new Error("webgl");
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" });
    this.r.outputColorSpace = THREE.SRGBColorSpace; this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(48, 2, 0.5, 400);
    this.camPos = new THREE.Vector3(0, 30, 20); this.camLook = new THREE.Vector3();
    this.shakeA = 0; this.reduceMotion = false; this.juice = true; this.postFx = true; this.cb = false;
    this.qName = opts.quality || "high"; this.Q = QUALITY[this.qName];
    this.tmp = new Float32Array(1600); this.col = [0, 0, 0];
    this.time = 0;
    this._initLights(); this._initMeshes(); this._initParticles(); this._initLabels();
    this.worldI = -1; this.setWorld(opts.world || 0);
    this.resize();
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; opts.onLost && opts.onLost(); });
    canvas.addEventListener("webglcontextrestored", () => { this.lost = false; opts.onRestored && opts.onRestored(); });
  }

  _initLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x223322, 0.9); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.8); this.sun.position.set(-30, 60, 25); this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0x88aaff, 0.35); this.fill.position.set(30, 20, -30); this.scene.add(this.fill);
  }

  _scaleTex() { // procedural scale pattern used as a bump map on every body sphere
    const S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S; const g = cv.getContext("2d");
    g.fillStyle = "#808080"; g.fillRect(0, 0, S, S);
    const rows = 8, cols = 16, w = S / cols, h = S / rows;
    for (let y = -1; y <= rows; y++) for (let x = -1; x <= cols; x++) {
      const cx = (x + (y % 2 ? 0.5 : 0)) * w, cy = y * h; const gr = g.createRadialGradient(cx, cy - h * 0.2, 0, cx, cy, w * 0.75);
      gr.addColorStop(0, "#d0d0d0"); gr.addColorStop(0.7, "#8a8a8a"); gr.addColorStop(1, "#404040"); g.fillStyle = gr;
      g.beginPath(); g.ellipse(cx, cy, w * 0.62, h * 0.7, 0, 0, 6.29); g.fill();
    }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  _radialTex(inner, outer, size = 64) {
    const cv = document.createElement("canvas"); cv.width = cv.height = size; const g = cv.getContext("2d");
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, size, size); const t = new THREE.CanvasTexture(cv); return t;
  }
  _rim(mat, strength) { // fresnel rim light for a premium sheen
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = { value: strength };
      sh.fragmentShader = "uniform float uRim;\n" + sh.fragmentShader.replace("#include <opaque_fragment>",
        "outgoingLight += vec3(0.55,0.65,0.8) * uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);\n#include <opaque_fragment>");
    };
  }

  _initMeshes() {
    const Q = this.Q;
    this.scaleTex = this._scaleTex();
    // body
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.36, metalness: 0.12 });
    if (Q.bump) { this.bodyMat.bumpMap = this.scaleTex; this.bodyMat.bumpScale = 1.4; }
    this._rim(this.bodyMat, 0.55);
    this.body = this._inst(new THREE.SphereGeometry(1, Q.seg[0], Q.seg[1]), this.bodyMat, MAX_SEG, true);
    // heads
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.12 }); this._rim(this.headMat, 0.6);
    this.head = this._inst(new THREE.SphereGeometry(1, Q.seg[0] + 4, Q.seg[1] + 2), this.headMat, MAX_HEAD, true);
    this.eyeW = this._inst(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15 }), MAX_HEAD * 2, true);
    this.eyeP = this._inst(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX_HEAD * 2, true);
    this.lid = this._inst(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), MAX_HEAD * 2, true);
    // forked tongue that flicks out now and then
    const tg = new THREE.BoxGeometry(1, 0.08, 0.12); tg.translate(0.5, 0, 0); const tf1 = new THREE.BoxGeometry(0.35, 0.08, 0.1); tf1.rotateY(0.6); tf1.translate(1.1, 0, -0.1); const tf2 = new THREE.BoxGeometry(0.35, 0.08, 0.1); tf2.rotateY(-0.6); tf2.translate(1.1, 0, 0.1);
    this.tongue = this._inst(mergeGeos([tg, tf1, tf2]), new THREE.MeshStandardMaterial({ color: 0xff2a55, roughness: 0.4, emissive: 0x550010 }), MAX_HEAD, false);
    // big food (from fallen snakes) = spinning gems
    this.gem = this._inst(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.35, flatShading: true }), MAX_GEM, true);
    // blob shadows
    const shTex = this._radialTex("rgba(0,0,0,0.55)", "rgba(0,0,0,0)");
    this.shadow = this._inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, toneMapped: false }), MAX_SEG, false);
    this.shadow.renderOrder = 1;
    // food core + halo
    this.food = this._inst(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false }), MAX_FOOD, true);
    const haloTex = this._radialTex("rgba(255,255,255,0.9)", "rgba(255,255,255,0)");
    this.halo = this._inst(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), MAX_FOOD, true);
    this.halo.renderOrder = 3;
    // shock rings (kills)
    this.rings = []; const rg = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); m.visible = false; m.userData.t = 1; this.scene.add(m); this.rings.push(m); }
    this.dummyM = new THREE.Matrix4();
  }
  _inst(geo, mat, n, color) {
    const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (color) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    m.count = 0; m.frustumCulled = false; this.scene.add(m); return m;
  }

  _initParticles() {
    const N = 2600; this.pN = N; this.pMax = this.Q.particles;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 4); this.pSize = new Float32Array(N);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMaxL = new Float32Array(N); this.pBase = new Float32Array(N * 3); this.pS0 = new Float32Array(N); this.pDrag = new Float32Array(N);
    g.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("col", new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "attribute float size; attribute vec4 col; varying vec4 vC; uniform float uScale; void main(){ vC=col; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uScale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "varying vec4 vC; void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p); float a=smoothstep(0.5,0.0,d); a*=a; gl_FragColor=vec4(vC.rgb*1.6, vC.a*a); }",
    });
    this.pts = new THREE.Points(g, this.pMat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; this.scene.add(this.pts);
    this.pHead = 0; this.pAlive = 0;
    // ambient (GPU-animated, zero CPU): fireflies, dust, snow, stars
    this.ambMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uScale: { value: 300 }, uC: { value: new THREE.Color(1, 1, 1) }, uKind: { value: 0 }, uCam: { value: new THREE.Vector3() } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uT, uScale, uKind; uniform vec3 uCam; attribute vec4 seed; varying float vA;
        void main(){ vec3 p = position; float t = uT;
          if (uKind < 0.5) { p.x += sin(t*0.7+seed.x*6.3)*2.0; p.z += cos(t*0.6+seed.y*6.3)*2.0; p.y = 0.6+1.8*seed.z+sin(t*1.3+seed.w*9.0)*0.6; vA = 0.5+0.5*sin(t*2.5+seed.x*40.0); }
          else if (uKind < 1.5) { p.x += mod(t*1.6+seed.x*80.0, 80.0)-40.0; p.y = 0.3+seed.z*3.0; vA = 0.35; }
          else if (uKind < 2.5) { p.y = 14.0 - mod(t*(1.2+seed.z)+seed.w*14.0, 14.0); p.x += sin(t+seed.x*6.0)*1.2; vA = 0.8; }
          else { p.y = -0.5 - seed.z*6.0; vA = 0.4+0.6*abs(sin(t*0.8+seed.x*30.0)); }
          p.x = uCam.x + mod(p.x - uCam.x + 60.0, 120.0) - 60.0; p.z = uCam.z + mod(p.z - uCam.z + 60.0, 120.0) - 60.0;
          vec4 mv = modelViewMatrix*vec4(p,1.0); gl_PointSize = (uKind > 2.5 ? 0.25 : (uKind > 1.5 ? 0.35 : 0.42))*uScale/max(1.0,-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: "uniform vec3 uC; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d); gl_FragColor=vec4(uC, a*vA); }",
    });
  }
  _initLabels() { this.labels = new Map(); this.labelPool = []; }

  setQuality(name) {
    if (!QUALITY[name] || name === this.qName && this.composer !== undefined) { if (QUALITY[name]) this._applyDpr(); return; }
    const old = this.qName; this.qName = name; this.Q = QUALITY[name]; this.pMax = this.Q.particles;
    if (old && QUALITY[old].seg[0] !== this.Q.seg[0]) {
      this.body.geometry.dispose(); this.body.geometry = new THREE.SphereGeometry(1, this.Q.seg[0], this.Q.seg[1]);
      this.head.geometry.dispose(); this.head.geometry = new THREE.SphereGeometry(1, this.Q.seg[0] + 4, this.Q.seg[1] + 2);
    }
    this.bodyMat.bumpMap = this.Q.bump ? this.scaleTex : null; this.bodyMat.needsUpdate = true;
    const w = this.worldI; this.worldI = -1; this.setWorld(w);
    this._applyDpr();
  }
  setOptions(o) { Object.assign(this, o); this._applyDpr(); }
  _applyDpr() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.Q.dpr); this.dpr = dpr;
    this.r.setPixelRatio(dpr); this.r.setSize(this.w || 1, this.h || 1, false);
    const wantBloom = this.Q.bloom && this.postFx;
    if (wantBloom && !this.composer) {
      this.composer = new EffectComposer(this.r); this.composer.addPass(new RenderPass(this.scene, this.cam));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, (this.W && this.W.bloomT) || 0.86); this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    }
    if (this.composer) { this.composer.setPixelRatio(Math.min(dpr, 1.5)); this.composer.setSize(this.w || 1, this.h || 1); }
    this.useBloom = wantBloom;
    const sc = (this.h || 400) * dpr * 0.5 / Math.tan((this.cam.fov * Math.PI) / 360);
    this.pMat.uniforms.uScale.value = sc; this.ambMat.uniforms.uScale.value = sc;
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight; this.w = w; this.h = h;
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); this._applyDpr();
  }

  setWorld(i) {
    if (i === this.worldI) return; this.worldI = i; const W = WORLDS[i] || WORLDS[0]; this.W = W;
    if (this.worldGroup) { this.scene.remove(this.worldGroup); this.worldGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
    const G = new THREE.Group(); this.worldGroup = G; this.scene.add(G);
    this.scene.background = new THREE.Color(W.fog); this.scene.fog = new THREE.Fog(W.fog, W.fogNear, W.fogFar);
    this.r.toneMappingExposure = W.exposure || 1.05; if (this.bloom) this.bloom.threshold = W.bloomT || 0.86; this.hemi.color.set(W.sky); this.hemi.groundColor.set(W.ground); this.hemi.intensity = W.hemiI; this.sun.color.set(W.sun); this.sun.intensity = W.sunI;
    const R = 130; this.R0 = R; this.scaled = [];
    // ground
    const tex = new THREE.CanvasTexture(paintGround(W, this.qName === "low" ? 256 : 512)); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set((R + 120) / 9, (R + 120) / 9);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(4, this.r.capabilities.getMaxAnisotropy());
    const gm = new THREE.Mesh(new THREE.CircleGeometry(R + 120, 96).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex, emissive: W.emissiveGround ? new THREE.Color(0.35, 0.3, 0.9) : new THREE.Color(0, 0, 0), emissiveMap: W.emissiveGround ? tex : null }));
    gm.position.y = -0.01; G.add(gm);
    // outside-the-arena darkening ring
    const om = new THREE.Mesh(new THREE.RingGeometry(R, R + 125, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    om.position.y = 0.02; G.add(om); this.scaled.push(om);
    // energy fence: glowing ring + translucent gradient wall
    const rimC = new THREE.Color(W.rim);
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 8, 160).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: rimC.clone().multiplyScalar(2.2), toneMapped: false }));
    torus.position.y = 0.2; G.add(torus); this.scaled.push(torus);
    const wallMat = new THREE.ShaderMaterial({ uniforms: { uC: { value: new THREE.Color(W.wall) }, uT: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: "varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 uC; uniform float uT; varying vec2 vU; void main(){ float a=(1.0-vU.y)*0.55; a*=0.75+0.25*sin(vU.x*600.0+uT*3.0); gl_FragColor=vec4(uC*1.5,a); }" });
    this.wallMat = wallMat;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2.6, 160, 1, true), wallMat); wall.position.y = 1.3; G.add(wall); this.scaled.push(wall);
    this._decor(G, W, R);
    // ambient particles
    const n = Math.round(W.amb.n * this.Q.ambient), ag = new THREE.BufferGeometry(), ap = new Float32Array(n * 3), as = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) { ap[k * 3] = (Math.random() - 0.5) * 120; ap[k * 3 + 1] = 1; ap[k * 3 + 2] = (Math.random() - 0.5) * 120; for (let q = 0; q < 4; q++) as[k * 4 + q] = Math.random(); }
    ag.setAttribute("position", new THREE.BufferAttribute(ap, 3)); ag.setAttribute("seed", new THREE.BufferAttribute(as, 4));
    this.ambMat.uniforms.uC.value.set(W.amb.color); this.ambMat.uniforms.uKind.value = { firefly: 0, dust: 1, snow: 2, star: 3 }[W.amb.kind];
    const amb = new THREE.Points(ag, this.ambMat); amb.frustumCulled = false; amb.renderOrder = 6; G.add(amb);
    this.ambMat.dispose = () => {}; // shared material survives world swaps
    this._fitArena(); try { this.r.compile(this.scene, this.cam); } catch (_) {}
  }
  // arena size changes never rebuild the world (no hitch between menu and match): fence + decor are rescaled in place
  setArena(R) { this.arenaR = R; this._fitArena(); }
  _fitArena() {
    const R = this.arenaR || 130, k = R / (this.R0 || 130);
    if (this.scaled) for (const m of this.scaled) m.scale.set(k, 1, k);
    if (this.decor) for (const o of this.decor) { const d = o.userData.d - this.R0 + R; o.position.x = Math.cos(o.userData.a) * d; o.position.z = Math.sin(o.userData.a) * d; }
  }

  _decor(G, W, R) {
    const kits = {
      tree: () => { const g = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 5, 7), new THREE.MeshLambertMaterial({ color: 0x5a3a1e })); tr.position.y = 2.5; g.add(tr);
        for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2 - k * 0.7, 0), new THREE.MeshLambertMaterial({ color: [0x2f8f3a, 0x3fa847, 0x267a30][k], flatShading: true })); f.position.y = 5.5 + k * 2; g.add(f); } return g; },
      bush: () => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 0), new THREE.MeshLambertMaterial({ color: 0x3c9a44, flatShading: true })); m.position.y = 0.9; m.scale.y = 0.7; return m; },
      rock: () => { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 0), new THREE.MeshLambertMaterial({ color: 0x6f7a72, flatShading: true })); m.position.y = 0.6; m.scale.set(1.3, 0.7, 1); return m; },
      ziggurat: () => { const g = new THREE.Group(); for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(12 - k * 2.2, 2, 12 - k * 2.2), new THREE.MeshLambertMaterial({ color: k % 2 ? 0xc48a4a : 0xb57a3c })); b.position.y = 1 + k * 2; g.add(b); }
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.6), toneMapped: false })); top.position.y = 11; g.add(top); return g; },
      obelisk: () => { const g = new THREE.Group(); const o = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1, 9, 4), new THREE.MeshLambertMaterial({ color: 0xd8b070 })); o.position.y = 4.5; o.rotation.y = Math.PI / 4; g.add(o);
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.4, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.5), toneMapped: false })); t.position.y = 9.7; t.rotation.y = Math.PI / 4; g.add(t); return g; },
      palm: () => { const g = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 7, 6), new THREE.MeshLambertMaterial({ color: 0x8a6239 })); tr.position.y = 3.5; tr.rotation.z = 0.12; g.add(tr);
        for (let k = 0; k < 6; k++) { const l = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4.5, 4), new THREE.MeshLambertMaterial({ color: 0x4f9a3a, flatShading: true })); l.position.set(Math.cos(k) * 1.6 + 0.8, 7, Math.sin(k) * 1.6); l.rotation.set(Math.sin(k) * 1.3, 0, -Math.cos(k) * 1.3 + 0.1); g.add(l); } return g; },
      pillar: () => { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 6, 10), new THREE.MeshLambertMaterial({ color: 0xe0c08a })); p.position.y = 3; g.add(p);
        const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2.4), new THREE.MeshLambertMaterial({ color: 0xcfae78 })); c.position.y = 6.2; g.add(c); return g; },
      crystal: () => { const g = new THREE.Group(); for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(1.4 + k * 0.4, 0), new THREE.MeshStandardMaterial({ color: 0x9fe8ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85, emissive: 0x2a7fb0, emissiveIntensity: 0.6 })); c.scale.y = 2.2; c.position.set((k - 1) * 1.5, 2.6 + k * 0.4, (k % 2) * 1.2); c.rotation.z = (k - 1) * 0.3; g.add(c); } return g; },
      pine: () => { const g = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.5, 6), new THREE.MeshLambertMaterial({ color: 0x5b4030 })); tr.position.y = 1.2; g.add(tr);
        for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(2.6 - k * 0.6, 3, 7), new THREE.MeshLambertMaterial({ color: k === 2 ? 0xffffff : 0x2c5d4a, flatShading: true })); c.position.y = 3 + k * 1.7; g.add(c); } return g; },
      iceberg: () => { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(3, 0), new THREE.MeshStandardMaterial({ color: 0xe8f8ff, roughness: 0.2, flatShading: true })); m.position.y = 1; m.scale.set(1.4, 0.9, 1.1); return m; },
      asteroid: () => { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 0), new THREE.MeshStandardMaterial({ color: 0x4a4560, roughness: 0.8, flatShading: true, emissive: 0x1a0f40 })); m.position.y = 3 + Math.random() * 4; m.userData.spin = 0.3 + Math.random() * 0.5; return m; },
      pylon: () => { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), new THREE.MeshStandardMaterial({ color: 0x1a1440, roughness: 0.4 })); p.position.y = 4; g.add(p);
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.1, 0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.2, 2.6), toneMapped: false })); l.position.set(0, 4, 0.42); g.add(l);
        const t = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.4, 2.2), toneMapped: false })); t.position.y = 8.9; g.add(t); return g; },
      ringplanet: () => { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), new THREE.MeshStandardMaterial({ color: 0x7a4cff, roughness: 0.6, emissive: 0x2a1060 })); g.add(p);
        const r = new THREE.Mesh(new THREE.RingGeometry(8, 11, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.8, 2.2), side: THREE.DoubleSide, transparent: true, opacity: 0.7, toneMapped: false })); r.rotation.x = 1.2; g.add(r); g.position.y = 14; g.userData.far = 1; return g; },
    };
    const n = Math.round(46 * this.Q.decor); this.spinners = []; this.decor = [];
    let s = 99 + this.worldI * 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < n; k++) {
      const kind = W.decor[k % W.decor.length], o = kits[kind](); const a = (k / n) * Math.PI * 2 + rnd() * 0.12;
      const d = o.userData.far ? R + 55 + rnd() * 30 : R + 6 + rnd() * 30 + (k % 3) * 6;
      o.position.x = Math.cos(a) * d; o.position.z = Math.sin(a) * d; o.rotation.y = rnd() * 6.28;
      const sc = 0.8 + rnd() * 0.6; o.scale.multiplyScalar(sc); o.userData.a = a; o.userData.d = d; G.add(o); this.decor.push(o); if (o.userData.spin) this.spinners.push(o);
    }
  }

  // ---------- effects ----------
  burst(x, y, rgb, n, spd = 6, life = 0.8, size = 0.5, up = 3) {
    n = Math.min(n, this.pMax);
    for (let k = 0; k < n; k++) {
      const i = this.pHead; this.pHead = (this.pHead + 1) % this.pMax;
      const a = Math.random() * 6.283, v = spd * (0.3 + Math.random() * 0.7);
      this.pBase[i * 3] = x; this.pBase[i * 3 + 1] = 0.6 + Math.random() * 0.6; this.pBase[i * 3 + 2] = y;
      this.pVel[i * 3] = Math.cos(a) * v; this.pVel[i * 3 + 1] = up * (0.4 + Math.random()); this.pVel[i * 3 + 2] = Math.sin(a) * v;
      this.pLife[i] = this.pMaxL[i] = life * (0.6 + Math.random() * 0.6); this.pS0[i] = size * (0.6 + Math.random() * 0.8); this.pDrag[i] = 2.2;
      this.pCol[i * 4] = rgb[0]; this.pCol[i * 4 + 1] = rgb[1]; this.pCol[i * 4 + 2] = rgb[2];
    }
  }
  emit(x, h, y, vx, vy, vz, rgb, life, size, drag = 1) {
    const i = this.pHead; this.pHead = (this.pHead + 1) % this.pMax;
    this.pBase[i * 3] = x; this.pBase[i * 3 + 1] = h; this.pBase[i * 3 + 2] = y; this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pLife[i] = this.pMaxL[i] = life; this.pS0[i] = size; this.pDrag[i] = drag; this.pCol[i * 4] = rgb[0]; this.pCol[i * 4 + 1] = rgb[1]; this.pCol[i * 4 + 2] = rgb[2];
  }
  shatter(s, fn, n0 = 60) {
    const pts = this.tmp, sp = Math.max(0.4, s.r * 0.7), n = bodyPoints(s, 0, 0, sp, s.len, pts, 790), step = Math.max(1, Math.ceil(n / n0)), col = this.col;
    for (let j = 0; j < n; j += step) { fn(j, n, this.time, col); const rgb = [toLin(col[0]), toLin(col[1]), toLin(col[2])]; const a = Math.random() * 6.283, v = 2 + Math.random() * 5;
      this.emit(pts[j * 2], s.r, pts[j * 2 + 1], Math.cos(a) * v, 2 + Math.random() * 4, Math.sin(a) * v, rgb, 0.8 + Math.random() * 0.6, s.r * 1.6, 1.6); }
  }
  ring(x, y, rgb, maxR = 8) { const m = this.rings.find((r) => !r.visible) || this.rings[0]; m.visible = true; m.userData.t = 0; m.userData.R = maxR; m.position.set(x, 0.15, y); m.material.color.setRGB(rgb[0] * 2, rgb[1] * 2, rgb[2] * 2); }
  shake(a) { if (this.juice && !this.reduceMotion) this.shakeA = Math.min(1.2, this.shakeA + a); }

  _label(id, name, color, me) {
    let L = this.labels.get(id);
    if (!L || L.name !== name || L.color !== color) {
      if (!L) { L = this.labelPool.pop(); if (!L) { const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false })); sp.renderOrder = 10; L = { cv, tex, sp }; } this.scene.add(L.sp); this.labels.set(id, L); }
      const g = L.cv.getContext("2d"); g.clearRect(0, 0, 256, 64); g.font = `700 ${me ? 34 : 30}px -apple-system, "SF Pro Display", "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.55)"; g.strokeText(name, 128, 34); g.fillStyle = color; g.fillText(name, 128, 34);
      L.tex.needsUpdate = true; L.name = name; L.color = color;
    }
    L.used = true; return L;
  }

  // ---------- frame ----------
  frame(v) {
    if (this.lost) return;
    const t = v.t, dt = Math.min(0.05, v.dt); this.time = t; const Q = this.Q;
    // camera
    const zoom = v.cam.zoom, hgt = 17.5 * zoom, back = hgt * 0.68;
    const fov = 48 + (v.cam.boost && !this.reduceMotion ? 7 : 0); if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov += (fov - this.cam.fov) * (1 - Math.exp(-dt * 6)); this.cam.updateProjectionMatrix(); }
    const k = 1 - Math.exp(-dt * (v.cam.snap ? 60 : 9));
    this.camLook.x += (v.cam.x - this.camLook.x) * k; this.camLook.z += (v.cam.y - this.camLook.z) * k;
    if (v.cam.orbit !== undefined) { const a = v.cam.orbit; this.cam.position.set(this.camLook.x + Math.sin(a) * back * 1.6, hgt * 0.75, this.camLook.z + Math.cos(a) * back * 1.6); }
    else this.cam.position.set(this.camLook.x, this.camPos.y += (hgt - this.camPos.y) * (1 - Math.exp(-dt * 3)), this.camLook.z + this.camPos.y * 0.68);
    let sx = 0, sz = 0; if (this.shakeA > 0.001) { sx = (Math.random() - 0.5) * this.shakeA; sz = (Math.random() - 0.5) * this.shakeA; this.shakeA *= Math.exp(-dt * 7); }
    this.cam.position.x += sx; this.cam.position.z += sz;
    this.cam.lookAt(this.camLook.x + sx, 0, this.camLook.z - hgt * 0.05 + sz);
    this.sun.position.set(this.camLook.x - 30, 60, this.camLook.z + 25); this.sun.target.position.set(this.camLook.x, 0, this.camLook.z);
    const vx = this.camLook.x, vz = this.camLook.z - hgt * 0.35, vr = Math.min(hgt * 2.1, 64), vr2 = vr * vr;
    // snakes
    const B = this.body.instanceMatrix.array, BC = this.body.instanceColor.array, S = this.shadow.instanceMatrix.array;
    const H = this.head.instanceMatrix.array, HC = this.head.instanceColor.array, EW = this.eyeW.instanceMatrix.array, EWC = this.eyeW.instanceColor.array, EP = this.eyeP.instanceMatrix.array, EPC = this.eyeP.instanceColor.array;
    const LD = this.lid.instanceMatrix.array, LDC = this.lid.instanceColor.array;
    let nb = 0, ns = 0, nh = 0, ne = 0, np = 0, nl = 0, nt = 0; const pts = this.tmp, col = this.col;
    for (const L of this.labels.values()) L.used = false;
    for (const d of v.snakes) {
      const s = d.s; const hx0 = s.sx(d.o), hy0 = s.sy(d.o); const dx0 = hx0 - vx, dz0 = hy0 - vz;
      if (dx0 * dx0 + dz0 * dz0 > (vr + s.len) * (vr + s.len)) continue;
      const r = s.r * (d.scale || 1), sp = Math.max(0.28, r * Q.spacing);
      const n = bodyPoints(s, d.o, d.f, sp, s.len, pts, 790);
      if (d.ox || d.oy) for (let j = 0; j < n; j++) { pts[j * 2] += d.ox; pts[j * 2 + 1] += d.oy; }
      const fn = d.fn, wave = d.boost ? 9 : 5.5, amp = r * 0.16, alive = d.alpha;
      // body: tail first, so heads draw over (depth handles the rest)
      for (let j = n - 1; j >= 1; j--) {
        if (nb >= MAX_SEG) break;
        let x = pts[j * 2], y = pts[j * 2 + 1];
        const ddx = x - vx, ddz = y - vz; if (ddx * ddx + ddz * ddz > vr2) continue;
        // slither: lateral wave travelling down the body (visual only, < 0.16 r so collisions still read true)
        const jn = Math.min(j + 1, n - 1), jp = j - 1, tx = pts[jp * 2] - pts[jn * 2], ty = pts[jp * 2 + 1] - pts[jn * 2 + 1], tl = Math.sqrt(tx * tx + ty * ty) || 1;
        const wv = Math.sin(j * 0.42 - t * wave) * amp * Math.min(1, j / 6); x += (-ty / tl) * wv; y += (tx / tl) * wv;
        const u = j / (n - 1), taper = u > 0.72 ? 1 - ((u - 0.72) / 0.28) * 0.6 : 1, rr = r * taper * alive;
        const o = nb * 16; B[o] = rr; B[o + 1] = 0; B[o + 2] = 0; B[o + 3] = 0; B[o + 4] = 0; B[o + 5] = rr * 0.86; B[o + 6] = 0; B[o + 7] = 0; B[o + 8] = 0; B[o + 9] = 0; B[o + 10] = rr; B[o + 11] = 0; B[o + 12] = x; B[o + 13] = rr * 0.82; B[o + 14] = y; B[o + 15] = 1;
        fn(j, n, t, col); const hl = d.boost ? 1.15 + 0.6 * Math.max(0, Math.sin(j * 0.55 - t * 16)) : 1; BC[nb * 3] = toLin(col[0]) * hl; BC[nb * 3 + 1] = toLin(col[1]) * hl; BC[nb * 3 + 2] = toLin(col[2]) * hl; nb++;
        if (j % Q.shadowStep === 0 && ns < MAX_SEG) { const so = ns * 16, sr = rr * 2.4; S[so] = sr; S[so + 1] = 0; S[so + 2] = 0; S[so + 3] = 0; S[so + 4] = 0; S[so + 5] = 1; S[so + 6] = 0; S[so + 7] = 0; S[so + 8] = 0; S[so + 9] = 0; S[so + 10] = sr; S[so + 11] = 0; S[so + 12] = x + rr * 0.45; S[so + 13] = 0.03; S[so + 14] = y + rr * 0.35; S[so + 15] = 1; ns++; }
      }
      // head (oriented ellipsoid) + eyes looking where the snake steers
      if (nh < MAX_HEAD && n > 1) {
        const hx = pts[0], hy = pts[1]; const a = Math.atan2(pts[1] - pts[3], pts[0] - pts[2]); const c = Math.cos(a), sn = Math.sin(a);
        const hr = r * 1.08 * alive, o = nh * 16;
        // R_y(-a): x→(c,0,s) z→(-s,0,c)
        H[o] = c * hr * 1.18; H[o + 1] = 0; H[o + 2] = sn * hr * 1.18; H[o + 3] = 0; H[o + 4] = 0; H[o + 5] = hr * 0.84; H[o + 6] = 0; H[o + 7] = 0; H[o + 8] = -sn * hr; H[o + 9] = 0; H[o + 10] = c * hr; H[o + 11] = 0; H[o + 12] = hx; H[o + 13] = hr * 0.8; H[o + 14] = hy; H[o + 15] = 1;
        fn(1, n, t, col); HC[nh * 3] = toLin(col[0]); HC[nh * 3 + 1] = toLin(col[1]); HC[nh * 3 + 2] = toLin(col[2]); nh++;
        if (ns < MAX_SEG) { const so = ns * 16, sr = hr * 2.6; S[so] = sr; S[so + 5] = 1; S[so + 10] = sr; S[so + 1] = S[so + 2] = S[so + 3] = S[so + 4] = S[so + 6] = S[so + 7] = S[so + 8] = S[so + 9] = S[so + 11] = 0; S[so + 12] = hx + hr * 0.45; S[so + 13] = 0.03; S[so + 14] = hy + hr * 0.35; S[so + 15] = 1; ns++; }
        const tph = (t * 0.45 + s.id * 0.37) % 1; if (tph < 0.09 && nt < MAX_HEAD && alive > 0.9) { const ext = Math.sin((tph / 0.09) * Math.PI) * hr * 1.3, T2 = this.tongue.instanceMatrix.array, to = nt * 16, flick = Math.sin(t * 60) * 0.25, ca = Math.cos(a + flick), sa = Math.sin(a + flick);
          T2[to] = ca * ext; T2[to + 1] = 0; T2[to + 2] = sa * ext; T2[to + 3] = 0; T2[to + 4] = 0; T2[to + 5] = hr; T2[to + 6] = 0; T2[to + 7] = 0; T2[to + 8] = -sa * hr; T2[to + 9] = 0; T2[to + 10] = ca * hr; T2[to + 11] = 0; T2[to + 12] = hx + c * hr * 0.9; T2[to + 13] = hr * 0.62; T2[to + 14] = hy + sn * hr * 0.9; T2[to + 15] = 1; nt++; }
        const E = EYES[d.eye] || EYES[0], er = hr * 0.34 * E.s, la = d.look ?? a, lc = Math.cos(la), ls = Math.sin(la);
        const EC = EYEC[d.eye] || EYEC[0], ew = EC.w, pc = EC.p, glow = E.glow ? 3 : 1;
        for (let q = 0; q < E.n; q++) {
          const side = E.n === 1 ? 0 : (q ? 1 : -1) * hr * 0.46;
          const ex = hx + c * hr * 0.55 - sn * side, ey = hy + sn * hr * 0.55 + c * side, eh = hr * 1.25;
          const eo = ne * 16; EW[eo] = er; EW[eo + 5] = er; EW[eo + 10] = er; EW[eo + 1] = EW[eo + 2] = EW[eo + 3] = EW[eo + 4] = EW[eo + 6] = EW[eo + 7] = EW[eo + 8] = EW[eo + 9] = EW[eo + 11] = 0; EW[eo + 12] = ex; EW[eo + 13] = eh; EW[eo + 14] = ey; EW[eo + 15] = 1;
          EWC[ne * 3] = ew[0]; EWC[ne * 3 + 1] = ew[1]; EWC[ne * 3 + 2] = ew[2]; ne++;
          const pr = er * E.p, po = np * 16, pd = er * 0.62;
          EP[po] = pr; EP[po + 5] = pr; EP[po + 10] = pr; EP[po + 1] = EP[po + 2] = EP[po + 3] = EP[po + 4] = EP[po + 6] = EP[po + 7] = EP[po + 8] = EP[po + 9] = EP[po + 11] = 0;
          EP[po + 12] = ex + lc * pd; EP[po + 13] = eh + er * 0.5; EP[po + 14] = ey + ls * pd; EP[po + 15] = 1;
          EPC[np * 3] = pc[0] * glow; EPC[np * 3 + 1] = pc[1] * glow; EPC[np * 3 + 2] = pc[2] * glow; np++;
          if (E.lid) { const lo = nl * 16, lr = er * 1.08; LD[lo] = lr; LD[lo + 5] = lr; LD[lo + 10] = lr; LD[lo + 1] = LD[lo + 2] = LD[lo + 3] = LD[lo + 4] = LD[lo + 6] = LD[lo + 7] = LD[lo + 8] = LD[lo + 9] = LD[lo + 11] = 0; LD[lo + 12] = ex; LD[lo + 13] = eh + er * 0.05; LD[lo + 14] = ey; LD[lo + 15] = 1; LDC[nl * 3] = HC[(nh - 1) * 3]; LDC[nl * 3 + 1] = HC[(nh - 1) * 3 + 1]; LDC[nl * 3 + 2] = HC[(nh - 1) * 3 + 2]; nl++; }
        }
        // trail particles from the tail while boosting (or always for fancy trails)
        const T = TRAILS[d.trail]; if (T && T.c && (d.boost || Math.random() < 0.25) && this.pMax > 0) {
          const tj = Math.max(1, n - 2), tx2 = pts[tj * 2], ty2 = pts[tj * 2 + 1], cc = TRAILC[d.trail][(Math.random() * 2) | 0];
          const up = d.trail === 5 ? 1.5 : 0.8; this.emit(tx2 + (Math.random() - 0.5) * r, r, ty2 + (Math.random() - 0.5) * r, (Math.random() - 0.5), up, (Math.random() - 0.5), cc, 0.7, d.trail === 6 ? 0.35 : 0.5, 0.6);
        } else if (d.boost && Math.random() < 0.6) { const tj = Math.max(1, n - 2); fn(tj, n, t, col); this.emit(pts[tj * 2], r * 0.8, pts[tj * 2 + 1], (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2, [toLin(col[0]), toLin(col[1]), toLin(col[2])], 0.5, 0.55, 1.5); }
        if (d.name && (Q.names > 1 || d.me || d.top)) { const L = this._label(s.id, d.name, d.nc || "#fff", d.me); L.sp.position.set(hx, hr * 2.6 + 0.8, hy - hr * 0.4); const sw = Math.max(5.5, hr * 4.5) * (d.me ? 1.05 : 0.9); L.sp.scale.set(sw, sw / 4, 1); L.sp.material.opacity = alive; L.sp.visible = true; }
      }
    }
    for (const [id, L] of this.labels) if (!L.used) { this.scene.remove(L.sp); this.labels.delete(id); this.labelPool.push(L); }
    this._flush(this.body, nb); this._flush(this.shadow, ns, true); this._flush(this.head, nh); this._flush(this.eyeW, ne); this._flush(this.eyeP, np); this._flush(this.lid, nl); this._flush(this.tongue, nt, true);
    // food
    const F = v.food, FM = this.food.instanceMatrix.array, FC = this.food.instanceColor.array, HM = this.halo.instanceMatrix.array, HCc = this.halo.instanceColor.array;
    const cq = this.cam.quaternion, m = this.dummyM; m.makeRotationFromQuaternion(cq); const me = m.elements; // halos face the camera
    let nf = 0, ng = 0; const pal = v.foodPal, GM = this.gem.instanceMatrix.array, GC = this.gem.instanceColor.array, gr = t * 1.8, gc = Math.cos(gr), gs = Math.sin(gr);
    for (let i = 0; i < F.FM && nf < MAX_FOOD; i++) {
      if (!F.fa[i]) continue; const x = F.fx[i], y = F.fy[i], dx = x - vx, dz = y - vz; if (dx * dx + dz * dz > vr2) continue;
      const age = F.age ? F.age(i) : 1, grow = age < 1 ? age * age * (3 - 2 * age) : 1;
      const val = F.fv[i], fr = (0.22 + Math.sqrt(val) * 0.16) * grow, bob = 0.45 + fr + Math.sin(t * 3 + i) * 0.12, cc = pal[F.fc[i] % pal.length];
      if (val >= 4 && ng < MAX_GEM) { const go = ng * 16, gz = fr * 1.25; GM[go] = gc * gz; GM[go + 1] = 0; GM[go + 2] = -gs * gz; GM[go + 3] = 0; GM[go + 4] = 0; GM[go + 5] = gz * 1.5; GM[go + 6] = 0; GM[go + 7] = 0; GM[go + 8] = gs * gz; GM[go + 9] = 0; GM[go + 10] = gc * gz; GM[go + 11] = 0; GM[go + 12] = x; GM[go + 13] = bob + 0.2; GM[go + 14] = y; GM[go + 15] = 1;
        GC[ng * 3] = cc[0]; GC[ng * 3 + 1] = cc[1]; GC[ng * 3 + 2] = cc[2]; ng++;
        const o2 = nf * 16, hs2 = fr * 5.5; for (let q = 0; q < 16; q++) FM[o2 + q] = 0; FM[o2 + 15] = 1;
        HM[o2] = me[0] * hs2; HM[o2 + 1] = me[1] * hs2; HM[o2 + 2] = me[2] * hs2; HM[o2 + 3] = 0; HM[o2 + 4] = me[4] * hs2; HM[o2 + 5] = me[5] * hs2; HM[o2 + 6] = me[6] * hs2; HM[o2 + 7] = 0; HM[o2 + 8] = me[8]; HM[o2 + 9] = me[9]; HM[o2 + 10] = me[10]; HM[o2 + 11] = 0; HM[o2 + 12] = x; HM[o2 + 13] = bob; HM[o2 + 14] = y; HM[o2 + 15] = 1;
        HCc[nf * 3] = cc[0] * 0.6; HCc[nf * 3 + 1] = cc[1] * 0.6; HCc[nf * 3 + 2] = cc[2] * 0.6; nf++; continue; }
      const o = nf * 16; FM[o] = fr; FM[o + 5] = fr; FM[o + 10] = fr; FM[o + 1] = FM[o + 2] = FM[o + 3] = FM[o + 4] = FM[o + 6] = FM[o + 7] = FM[o + 8] = FM[o + 9] = FM[o + 11] = 0; FM[o + 12] = x; FM[o + 13] = bob; FM[o + 14] = y; FM[o + 15] = 1;
      FC[nf * 3] = cc[0]; FC[nf * 3 + 1] = cc[1]; FC[nf * 3 + 2] = cc[2];
      const hs = fr * (4.2 + Math.sin(t * 4 + i * 1.7) * 0.6);
      HM[o] = me[0] * hs; HM[o + 1] = me[1] * hs; HM[o + 2] = me[2] * hs; HM[o + 3] = 0; HM[o + 4] = me[4] * hs; HM[o + 5] = me[5] * hs; HM[o + 6] = me[6] * hs; HM[o + 7] = 0; HM[o + 8] = me[8]; HM[o + 9] = me[9]; HM[o + 10] = me[10]; HM[o + 11] = 0; HM[o + 12] = x; HM[o + 13] = bob; HM[o + 14] = y; HM[o + 15] = 1;
      HCc[nf * 3] = cc[0] * 0.45; HCc[nf * 3 + 1] = cc[1] * 0.45; HCc[nf * 3 + 2] = cc[2] * 0.45; nf++;
    }
    // food being swallowed: flies into the mouth
    if (v.ghosts) for (const gh of v.ghosts) {
      if (nf >= MAX_FOOD) break; const u = gh.t, x = gh.x + (gh.tx - gh.x) * u, y = gh.y + (gh.ty - gh.y) * u, fr = gh.r * (1 - u * 0.8), cc = pal[gh.c % pal.length];
      const o = nf * 16; FM[o] = fr; FM[o + 5] = fr; FM[o + 10] = fr; FM[o + 1] = FM[o + 2] = FM[o + 3] = FM[o + 4] = FM[o + 6] = FM[o + 7] = FM[o + 8] = FM[o + 9] = FM[o + 11] = 0; FM[o + 12] = x; FM[o + 13] = 0.6; FM[o + 14] = y; FM[o + 15] = 1;
      FC[nf * 3] = cc[0]; FC[nf * 3 + 1] = cc[1]; FC[nf * 3 + 2] = cc[2];
      for (let q = 0; q < 16; q++) HM[o + q] = 0; HM[o + 15] = 1; nf++;
    }
    this._flush(this.food, nf); this._flush(this.halo, nf, true); this._flush(this.gem, ng);
    // particles (CPU integrate, pooled)
    const P = this.pPos, PC = this.pCol, PS = this.pSize; let alive = 0;
    for (let i = 0; i < this.pMax; i++) {
      if (this.pLife[i] <= 0) { if (PS[i] !== 0) { PS[i] = 0; } continue; }
      this.pLife[i] -= dt; const l = Math.max(0, this.pLife[i] / this.pMaxL[i]); const dr = Math.exp(-dt * this.pDrag[i]);
      this.pVel[i * 3] *= dr; this.pVel[i * 3 + 2] *= dr; this.pVel[i * 3 + 1] -= 4 * dt;
      this.pBase[i * 3] += this.pVel[i * 3] * dt; this.pBase[i * 3 + 1] = Math.max(0.1, this.pBase[i * 3 + 1] + this.pVel[i * 3 + 1] * dt); this.pBase[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      P[i * 3] = this.pBase[i * 3]; P[i * 3 + 1] = this.pBase[i * 3 + 1]; P[i * 3 + 2] = this.pBase[i * 3 + 2];
      PC[i * 4 + 3] = l; PS[i] = this.pS0[i] * (0.4 + l * 0.6); alive++;
    }
    const pg = this.pts.geometry; pg.attributes.position.needsUpdate = true; pg.attributes.col.needsUpdate = true; pg.attributes.size.needsUpdate = true; pg.setDrawRange(0, this.pMax);
    // rings, ambient, decor spin
    for (const rg of this.rings) if (rg.visible) { rg.userData.t += dt * 1.6; const u = rg.userData.t; if (u >= 1) { rg.visible = false; continue; } const s2 = 1 + u * rg.userData.R; rg.scale.set(s2, 1, s2); rg.material.opacity = (1 - u) * 0.9; }
    this.ambMat.uniforms.uT.value = t; this.ambMat.uniforms.uCam.value.set(this.camLook.x, 0, this.camLook.z); if (this.wallMat) this.wallMat.uniforms.uT.value = t;
    if (this.spinners) for (const o of this.spinners) { o.rotation.y += dt * o.userData.spin; o.rotation.x += dt * o.userData.spin * 0.5; }
    if (this.useBloom) this.composer.render(dt); else this.r.render(this.scene, this.cam);
  }
  _flush(m, n, noColor) { m.count = n; m.instanceMatrix.needsUpdate = true; if (!noColor && m.instanceColor) m.instanceColor.needsUpdate = true; else if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  // world → screen (for DOM effects like floating "+10")
  project(x, y, h = 1) { const p = new THREE.Vector3(x, h, y).project(this.cam); return [(p.x * 0.5 + 0.5) * this.w, (-p.y * 0.5 + 0.5) * this.h, p.z < 1]; }
  info() { const i = this.r.info; return { calls: i.render.calls, tris: i.render.triangles }; }
  dispose() { this.lost = true; try { if (this.composer) this.composer.dispose(); this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); this.r.dispose(); this.r.forceContextLoss(); } catch (_) {} }
}

// merge simple non-indexed/indexed box geometries into one (keeps the tongue a single instanced draw)
function mergeGeos(list) {
  const pos = [], nor = [], idx = []; let off = 0;
  for (const g of list) { const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index ? g.index.array : null; for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); } const cnt = p.length / 3; if (ix) for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off); else for (let i = 0; i < cnt; i++) idx.push(i + off); off += cnt; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
}
