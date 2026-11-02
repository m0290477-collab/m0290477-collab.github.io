// AAA 3D renderer (Three.js r169, self-hosted). Spline-tube PBR snakes, living worlds, real-time soft shadows,
// planar reflections, HDR post stack, cinematic cameras (title flyover, match-intro sweep, kill-cam, victory
// orbit), studio showcase, GPU particles + instanced debris/confetti. Tiered Ultra/High/Medium/Low with
// dynamic resolution. Same public contract as before (frame(view), project, burst, ring, shatter, shake…).
import * as THREE from "./vendor/three.module.min.js?v=m2b";
import { bodyPoints, PU_COL, PU_ICON, PU_SVG } from "./sim.js?v=m2b";
const GOLDC = [1, 0.75, 0.12]; // golden-bounty ground ring
import { WORLDS, W3D } from "./worlds.js?v=m2b";
import { EYES, TRAILS, LEGEND, SKINS } from "./skins.js?v=m2b";
import { SnakeSystem, SW, MAXS, SHOW_ROW, packCol } from "./gfx/snake.js?v=m2b";
import { World, prefetchWorld } from "./gfx/env.js?v=m2b";
import { Post } from "./gfx/post.js?v=m2b";
import { Studio } from "./gfx/showcase.js?v=m2b";

export const QUALITY = {
  low: { mat: "lambert", food: 1, halo: true, dpr: 1, post: false, msaa: 0, shadows: 0, physical: false, irid: false, rings: 44, radial: 8, particles: 500, decor: 0.45, foliage: 0, creatures: false, ambient: 0.45, reflect: 0, texLo: true, normalMaps: false, names: 1, gtao: false, dof: false, bits: 120 },
  medium: { mat: "standard", food: 1, halo: true, dpr: 1.5, post: true, msaa: 0, shadows: 1, physical: true, irid: false, rings: 72, radial: 12, particles: 1000, decor: 0.75, foliage: 0.5, creatures: true, ambient: 0.7, reflect: 0, texLo: false, normalMaps: true, names: 2, gtao: false, dof: false, bits: 220 },
  high: { mat: "physical", food: 2, halo: true, dpr: 2, post: true, msaa: 4, shadows: 2, physical: true, irid: true, rings: 104, radial: 16, particles: 1600, decor: 1, foliage: 1, creatures: true, ambient: 1, reflect: 0.45, texLo: false, normalMaps: true, names: 2, gtao: false, dof: true, bits: 320 },
  ultra: { mat: "physical", food: 2, halo: true, dpr: 2.5, post: true, msaa: 4, shadows: 2, physical: true, irid: true, rings: 136, radial: 20, particles: 2400, decor: 1.3, foliage: 1.4, creatures: true, ambient: 1.3, reflect: 0.6, texLo: false, normalMaps: true, names: 2, gtao: true, dof: true, bits: 400 },
};
const MAX_FOOD = 1400, MAX_GEM = 300, MAX_HEAD = MAXS;
const toLin = (v) => (v <= 0 ? 0 : v * v * (0.7 + 0.3 * v));
const hex3 = (h) => { const n = parseInt(h.slice(1), 16); return [toLin((n >> 16 & 255) / 255), toLin((n >> 8 & 255) / 255), toLin((n & 255) / 255)]; };
const EYEC = EYES.map((e) => ({ w: hex3(e.ec), p: hex3(e.pc) })); const TRAILC = TRAILS.map((t) => (t.c ? t.c.map(hex3) : null));
const LEGC = {}; for (const k in LEGEND) LEGC[k] = { tr: LEGEND[k].tr.map(hex3), glow: hex3(LEGEND[k].glow) };
const _m2 = new THREE.Matrix4(), _c = new THREE.Color();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class Renderer3D {
  constructor(canvas, opts = {}) {
    const initQ = opts.quality || "high";
    const gl = canvas.getContext("webgl2", { antialias: initQ === "low", alpha: false, powerPreference: "high-performance", stencil: false });
    if (!gl) throw new Error("webgl2");
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, context: gl, antialias: initQ === "low", alpha: false, stencil: false, powerPreference: "high-performance" });
    this.r.outputColorSpace = THREE.SRGBColorSpace; this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.0;
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.r);
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.FogExp2(0x000000, 0.01);
    this.cam = new THREE.PerspectiveCamera(48, 2, 0.4, 900);
    this.camPos = new THREE.Vector3(0, 30, 20); this.camLook = new THREE.Vector3(); this.camU = { value: new THREE.Vector3() }; this.ptScale = { value: 300 };
    this.shakeA = 0; this.reduceMotion = false; this.juice = true; this.postFx = true; this.time = 0; this.ca = 0; this.flash = new THREE.Vector4(); this.box = 0; this.speed = 0; this.dyn = 1; this.dynT = 0; this.ftAcc = 0; this.ftN = 0;
    this.qName = QUALITY[initQ] ? initQ : "high"; this.Q = QUALITY[this.qName];
    this.tmp = new Float32Array(SW * 2 + 64); this.ys = new Float32Array(SW); this.cols = new Float32Array(SW); this.col = [0, 0, 0]; this.state = new Map();
    this.sunDir = new THREE.Vector3(-0.45, 0.75, 0.35).normalize();
    this._initLights(); this.snakes = new SnakeSystem(this, this.Q); for (const m of this.snakes.worldMeshes) this.scene.add(m);
    this._initFood(); this._initParticles(); this._initBits(); this._initFx(); this.labels = new Map(); this.labelPool = [];
    this.eyes = this._eyes(this.scene); this.studio = new Studio(this); for (const m of this.snakes.showMeshes) this.studio.scene.add(m); this.eyesS = this._eyes(this.studio.scene);
    this.post = new Post(this); this.worldI = -1; this.arenaR = 130; this.setWorld(opts.world || 0); this._applyQ(true);
    this.resize();
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; opts.onLost && opts.onLost(); });
    canvas.addEventListener("webglcontextrestored", () => { this.lost = false; opts.onRestored && opts.onRestored(); });
  }
  get is2D() { return false; }
  // compile every material variant up front (async where the driver supports parallel compile) so no shader
  // compiles mid-match: snake groups, ghost/legend variants, debris, confetti, cores, storm, hill, team rings.
  prewarm() {
    const G = this.snakes.G, saved = []; const force = (m, k) => { saved.push([m, k, m[k]]); };
    for (const n in G) { force(G[n].g, "instanceCount"); G[n].g.instanceCount = 1; }
    for (const m of [this.bits, this.conf, this.cores, this.coreHalo, this.teamRing, this.food, this.halo, this.gem, this.eyes.w, this.eyes.p, this.eyes.h, this.eyes.t, this.eyesS.w, this.eyesS.p, this.eyesS.h, this.eyesS.t]) { force(m, "count"); m.count = 1; }
    for (const m of [this.metRing, this.metDisc, this.metRock]) if (m) { force(m, "count"); m.count = 1; }
    for (const o of [this.storm, this.stormOut, this.hill, ...this.rings, ...(this.puSpr || []).slice(0, 1), ...(this.emoSpr || []).slice(0, 1)]) { if (o) { force(o, "visible"); o.visible = true; } }
    if (this.puPillar) { force(this.puPillar, "count"); this.puPillar.count = 1; }
    // a name-tag sprite (fog:false SpriteMaterial) so the first label of a match doesn't compile mid-play
    if (!this._warmLabel) { this._warmLabel = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false })); this._warmLabel.scale.set(0.001, 0.001, 1); this.scene.add(this._warmLabel); }
    for (const m of this.snakes.showMeshes) { force(m, "visible"); m.visible = true; }
    const restore = () => { for (const [o, k, v] of saved) o[k] = v; };
    const t0 = performance.now(); let p;
    try { p = this.r.compileAsync ? Promise.all([this.r.compileAsync(this.scene, this.cam), this.r.compileAsync(this.studio.scene, this.studio.cam)]) : (this.r.compile(this.scene, this.cam), this.r.compile(this.studio.scene, this.studio.cam), Promise.resolve()); } catch (e) { p = Promise.resolve(); }
    restore();
    return p.then(() => { this.prewarmMs = performance.now() - t0; }).catch(() => {});
  }
  _initLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x223322, 0.9); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.8); this.scene.add(this.sun); this.scene.add(this.sun.target);
    const sh = this.sun.shadow; sh.camera.left = -34; sh.camera.right = 34; sh.camera.top = 34; sh.camera.bottom = -34; sh.camera.near = 1; sh.camera.far = 160; sh.bias = -0.0006; sh.normalBias = 0.035;
    this.fill = new THREE.DirectionalLight(0x88aaff, 0.35); this.fill.position.set(30, 20, -30); this.scene.add(this.fill);
    this.fxLight = new THREE.PointLight(0xffffff, 0, 30, 2); this.fxLight.position.set(0, 4, 0); this.scene.add(this.fxLight);
  }
  _inst(scene, geo, mat, n, color) {
    const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (color) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    m.count = 0; m.frustumCulled = false; scene.add(m); return m;
  }
  _radialTex(stops, size = 64) {
    const cv = document.createElement("canvas"); cv.width = cv.height = size; const g = cv.getContext("2d");
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); for (const [o, c] of stops) gr.addColorStop(o, c); g.fillStyle = gr; g.fillRect(0, 0, size, size); return new THREE.CanvasTexture(cv);
  }
  _eyes(scene) {
    const E = {};
    const lo = this.Q.mat === "lambert", M = (o) => (lo ? new THREE.MeshLambertMaterial({ color: o.color, emissive: o.emissive || 0 }) : this.Q.mat === "standard" ? new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.15, emissive: o.emissive || 0 }) : new THREE.MeshPhysicalMaterial(o));
    E.w = this._inst(scene, new THREE.SphereGeometry(1, lo ? 10 : 16, lo ? 8 : 12), M({ color: 0xffffff, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.5 }), MAX_HEAD * 2, true);
    E.p = this._inst(scene, new THREE.SphereGeometry(1, lo ? 8 : 12, lo ? 6 : 8), M({ color: 0xffffff, roughness: 0.02, clearcoat: 1, emissive: 0x000000 }), MAX_HEAD * 2, true);
    E.h = this._inst(scene, new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX_HEAD * 2, false); // catch-light
    const tg = new THREE.CylinderGeometry(0.05, 0.07, 1, 6).rotateZ(Math.PI / 2).translate(0.5, 0, 0); const f1 = new THREE.CylinderGeometry(0.03, 0.05, 0.4, 5).rotateZ(Math.PI / 2).rotateY(0.55).translate(1.13, 0, -0.1); const f2 = new THREE.CylinderGeometry(0.03, 0.05, 0.4, 5).rotateZ(Math.PI / 2).rotateY(-0.55).translate(1.13, 0, 0.1);
    E.t = this._inst(scene, mergeGeos([tg, f1, f2]), M({ color: 0xff2a55, roughness: 0.3, clearcoat: 1, emissive: 0x3a0010 }), MAX_HEAD, false);
    return E;
  }
  _initFood() {
    this.food = this._inst(this.scene, new THREE.IcosahedronGeometry(1, this.Q.food), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false }), MAX_FOOD, true);
    this.halo = this._inst(this.scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this._radialTex([[0, "rgba(255,255,255,0.95)"], [0.25, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }), MAX_FOOD, true);
    this.halo.renderOrder = 3;
    this.gem = this._inst(this.scene, new THREE.OctahedronGeometry(1, 0), this.Q.mat === "physical" ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.2, clearcoat: 1, iridescence: 0.8, emissive: 0xffffff, emissiveIntensity: 0.25, flatShading: true, envMapIntensity: 2 }) : new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x444444, flatShading: true }), MAX_GEM, true);
  }
  _initParticles() {
    const N = 2600; this.pN = N; this.pMax = this.Q.particles;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 4); this.pSize = new Float32Array(N);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMaxL = new Float32Array(N); this.pS0 = new Float32Array(N); this.pDrag = new Float32Array(N); this.pGrav = new Float32Array(N);
    g.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("col", new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.ptScale }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "attribute float size; attribute vec4 col; varying vec4 vC; uniform float uScale; void main(){ vC=col; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uScale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "varying vec4 vC; void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p); float a=smoothstep(0.5,0.0,d); float core=smoothstep(0.18,0.0,d); gl_FragColor=vec4(vC.rgb*(1.4+core*2.0), vC.a*a*a); }",
    });
    this.pts = new THREE.Points(g, this.pMat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; this.scene.add(this.pts);
    this.pHead = 0;
  }
  _initBits() { // instanced debris shards + confetti (CPU physics, GPU instancing)
    const N = 400; this.bN = N; this.bits = this._inst(this.scene, new THREE.TetrahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.3, flatShading: true, emissive: 0x111111 }), N, true);
    this.conf = this._inst(this.scene, new THREE.PlaneGeometry(1, 0.55), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide, emissive: 0x222222 }), N, true);
    this.bD = []; this.cD = [];
  }
  _initFx() {
    // shockwave rings: thin hot leading edge + soft trailing glow (width stays fine as the ring grows)
    this.rings = []; const rg = new THREE.RingGeometry(0.55, 1, 96, 1).rotateX(-Math.PI / 2);
    const RVS = "varying vec2 vP; void main(){ vP=position.xz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }";
    const RFS = "uniform vec3 color; uniform float opacity, uS; varying vec2 vP; void main(){ float r=length(vP); float w=0.03+0.25/max(uS,1.0); float edge=smoothstep(1.0-w,1.0-w*0.35,r)*(1.0-smoothstep(1.0-w*0.2,1.0,r)); float trail=pow(smoothstep(0.55,1.0,r),5.0)*0.22; gl_FragColor=vec4(color*(edge+trail), (edge+trail)*opacity); }";
    for (let i = 0; i < 8; i++) { const mat = new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(1, 1, 1) }, opacity: { value: 1 }, uS: { value: 1 } }, vertexShader: RVS, fragmentShader: RFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      Object.defineProperty(mat, "color", { get() { return this.uniforms.color.value; } }); const m = new THREE.Mesh(rg, mat); m.visible = false; m.userData.t = 1; this.scene.add(m); this.rings.push(m); }
    // battle-royale storm wall + king-of-the-hill zone + boss weak cores
    this.stormU = { uT: { value: 0 } };
    this.storm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 26, 160, 1, true), new THREE.ShaderMaterial({ uniforms: this.stormU, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: "varying vec2 vU; varying vec3 vW; void main(){ vU=uv; vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.0); }",
      fragmentShader: `uniform float uT; varying vec2 vU; varying vec3 vW; float h(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); } float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
        void main(){ vec2 p=vec2(vU.x*120.0, vU.y*6.0); float c=n(p+vec2(uT*0.6,-uT*0.9))*0.6+n(p*2.3-vec2(uT,uT*0.4))*0.4; float bolt=step(0.985,n(vec2(vU.x*400.0,uT*6.0))); float a=(0.25+0.45*c)*(1.0-vU.y*0.7)+bolt*0.6;
        gl_FragColor=vec4(mix(vec3(0.45,0.12,0.9),vec3(1.2,0.5,1.6),c+bolt),a); }` }));
    this.storm.visible = false; this.storm.renderOrder = 4; this.scene.add(this.storm);
    this.stormOut = new THREE.Mesh(new THREE.RingGeometry(1, 40, 128, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a0a6a, transparent: true, opacity: 0.45, depthWrite: false })); this.stormOut.position.y = 0.06; this.stormOut.visible = false; this.scene.add(this.stormOut);
    this.hill = new THREE.Group(); const hr = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.8, 0.4), toneMapped: false, transparent: true, depthWrite: false }));
    const hd = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc845, transparent: true, opacity: 0.12, depthWrite: false }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 30, 48, 1, true), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uT: this.stormU.uT, uC: { value: new THREE.Color(1.2, 0.9, 0.2) } },
      vertexShader: "varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }", fragmentShader: "uniform float uT; uniform vec3 uC; varying vec2 vU; void main(){ float a=(1.0-vU.y)*(0.25+0.15*sin(vU.x*60.0+uT*3.0)); gl_FragColor=vec4(uC,a*0.6); }" }));
    beam.position.y = 15; this.hillBeam = beam; this.hillRing = hr; this.hillDisc = hd; hd.material.opacity = 0.2; this.hill.add(hr, hd, beam); hr.position.y = 0.08; hd.position.y = 0.05; this.hill.visible = false; this.scene.add(this.hill);
    this.cores = this._inst(this.scene, new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 16, true);
    this.coreHalo = this._inst(this.scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this._radialTex([[0, "rgba(255,80,60,1)"], [0.4, "rgba(255,40,40,0.4)"], [1, "rgba(255,0,0,0)"]]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 16, false);
    this.teamRing = this._inst(this.scene, new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }), MAXS, true);
    this.mirrorCam = new THREE.PerspectiveCamera(); this.mirrorMat = new THREE.Matrix4();
    this._initPu(); this._initMet(); this._initEmo();
  }
  // power-up pickups: a spinning glowing 3D icon per kind + pulsing halo + light pillar + emoji badge above it
  _initPu() {
    const T = THREE, g = [
      new T.TorusGeometry(0.62, 0.22, 10, 20, Math.PI).rotateZ(Math.PI), // magnet (U)
      new T.CylinderGeometry(0.85, 0.85, 0.26, 6).rotateX(Math.PI / 2), // shield (hex plate)
      new T.OctahedronGeometry(0.75, 0).scale(0.55, 1.35, 0.55), // speed (bolt crystal)
      new T.BoxGeometry(0.95, 0.95, 0.95), // x2 (cube)
      new T.SphereGeometry(0.72, 14, 10).scale(1, 1.2, 1), // ghost (orb)
      new T.IcosahedronGeometry(0.8, 0), // freeze (ice crystal)
      new T.DodecahedronGeometry(0.85, 0), // mega orb (gem)
      new T.ConeGeometry(0.62, 1.5, 6).rotateZ(-Math.PI / 2), // dash (arrowhead)
      new T.TorusGeometry(0.62, 0.2, 10, 24), // invisible (glass ring)
      new T.OctahedronGeometry(0.95, 0).scale(1, 1.25, 1), // giant (big crystal)
      new T.SphereGeometry(0.62, 12, 10).scale(1, 1.35, 1), // food rain (droplet)
    ];
    this.puMesh = g.map((geo, k) => { const c = new T.Color(PU_COL[k]); const m = this._inst(this.scene, geo, new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.25, roughness: 0.22, metalness: 0.35, flatShading: k !== 4 && k !== 10, transparent: k === 4 || k === 8, opacity: k === 4 ? 0.8 : k === 8 ? 0.55 : 1 }), 12, false); m.castShadow = !!this.Q.shadows; return m; });
    this.puHalo = this._inst(this.scene, new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: this._radialTex([[0, "rgba(255,255,255,1)"], [0.3, "rgba(255,255,255,0.4)"], [1, "rgba(255,255,255,0)"]]), transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false, fog: false }), 40, true); this.puHalo.renderOrder = 3;
    this.puPillar = this._inst(this.scene, new T.CylinderGeometry(0.5, 0.9, 8, 16, 1, true).translate(0, 4, 0), new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, uniforms: { uT: this.stormU.uT },
      vertexShader: "varying float vY; varying vec3 vC; void main(){ vY=position.y/8.0; vC=instanceColor; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform float uT; varying float vY; varying vec3 vC; void main(){ float a=(1.0-vY)*(0.35+0.25*sin(vY*20.0-uT*6.0)); gl_FragColor=vec4(vC*1.6,a*0.55); }" }), 40, true);
    this.puTex = PU_ICON.map((ic, k) => { const cv = document.createElement("canvas"); cv.width = cv.height = 96; const x = cv.getContext("2d"); x.fillStyle = "rgba(10,12,24,0.72)"; x.beginPath(); x.arc(48, 48, 44, 0, 6.283); x.fill(); x.lineWidth = 6; x.strokeStyle = PU_COL[k]; x.stroke(); x.save(); x.translate(48 - 26, 48 - 26); x.scale(52 / 24, 52 / 24); x.fillStyle = "#fff"; x.shadowColor = PU_COL[k]; x.shadowBlur = 6; x.fill(new Path2D(PU_SVG[k]), "evenodd"); x.restore(); const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace; return tx; });
    this.puSpr = []; for (let i = 0; i < 24; i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: this.puTex[0], depthWrite: false, depthTest: false, toneMapped: false, transparent: true })); sp.visible = false; sp.renderOrder = 9; this.scene.add(sp); this.puSpr.push(sp); }
  }
  // meteor shower: a pulsing red warning ring + filling disc on the ground, and the burning rock falling into it
  _initMet() {
    const T = THREE; this.metRing = this._inst(this.scene, new T.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: T.DoubleSide, fog: false }), 24, true);
    this.metDisc = this._inst(this.scene, new T.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false, side: T.DoubleSide, fog: false }), 24, true);
    this.metRock = this._inst(this.scene, new T.IcosahedronGeometry(1, 1), new T.MeshStandardMaterial({ color: 0x3a2418, emissive: 0xff5a1a, emissiveIntensity: 1.8, roughness: 0.8, flatShading: true }), 24, false);
    this.metRing.renderOrder = 2; this.metDisc.renderOrder = 2;
  }
  _meteors(v, t) {
    const L = v.mets || []; let n = 0; const RM = this.metRing.instanceMatrix.array, RC = this.metRing.instanceColor.array, DM = this.metDisc.instanceMatrix.array, DC = this.metDisc.instanceColor.array, KM = this.metRock.instanceMatrix.array;
    for (let i = 0; i < L.length && n < 24; i++) {
      const M = L[i], u = Math.max(0, Math.min(1, 1 - M.t / (M.T || 1.9))), pl = 0.75 + 0.25 * Math.sin(t * 18 + i), r = M.r;
      _m2.makeScale(r, 1, r).setPosition(M.x, 0.12, M.y); _m2.toArray(RM, n * 16); RC[n * 3] = 1; RC[n * 3 + 1] = 0.1 + 0.15 * pl; RC[n * 3 + 2] = 0.06;
      const dr = r * (0.15 + 0.85 * u); _m2.makeScale(dr, 1, dr).setPosition(M.x, 0.1, M.y); _m2.toArray(DM, n * 16); DC[n * 3] = 1; DC[n * 3 + 1] = 0.12 + 0.3 * u; DC[n * 3 + 2] = 0.05;
      const f = Math.pow(1 - u, 1.4), hx = M.x + 14 * f, hy = 1 + 46 * f, hz = M.y - 9 * f, rs = 0.9 + 0.5 * u;
      _q.setFromEuler(_e.set(t * 3 + i, t * 2, 0)); _m2.compose(_v.set(hx, hy, hz), _q, _s.set(rs, rs, rs)); _m2.toArray(KM, n * 16);
      if (this.pMax && Math.random() < 0.9) this.emit(hx + (Math.random() - 0.5), hy + 0.5, hz + (Math.random() - 0.5), 4 + Math.random() * 3, 3, -2.6, [1.6, 0.55 + Math.random() * 0.3, 0.15], 0.5, 0.7, 1, 0);
      n++;
    }
    this._flush(this.metRing, n); this._flush(this.metDisc, n); this._flush(this.metRock, n);
  }
  // quick emotes: one cached bubble texture per emote, a small sprite pool above the heads
  _initEmo() {
    const T = THREE, E = ["👋", "😂", "😡", "🔥", "👍", "GG"];
    this.emoTex = E.map((e) => { const cv = document.createElement("canvas"); cv.width = cv.height = 128; const x = cv.getContext("2d"); x.fillStyle = "rgba(10,14,26,0.85)"; x.strokeStyle = "rgba(255,220,140,0.95)"; x.lineWidth = 6;
      x.beginPath(); x.arc(64, 58, 48, 0, 6.283); x.fill(); x.stroke(); x.beginPath(); x.moveTo(52, 102); x.lineTo(64, 122); x.lineTo(76, 102); x.closePath(); x.fill();
      x.textAlign = "center"; x.textBaseline = "middle"; if (e === "GG") { x.font = "800 46px Oxanium, sans-serif"; x.fillStyle = "#ffd23a"; x.fillText(e, 64, 60); } else { x.font = "60px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif"; x.fillText(e, 64, 62); }
      const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace; return tx; });
    this.emoSpr = []; for (let i = 0; i < 10; i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: this.emoTex[0], transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false })); sp.visible = false; sp.renderOrder = 11; this.scene.add(sp); this.emoSpr.push(sp); }
  }
  _pus(v, t) {
    const L = v.pus || [], cnt = this._puCnt || (this._puCnt = new Int32Array(this.puMesh.length)); cnt.fill(0); let nh = 0; _m.makeRotationFromQuaternion(this.cam.quaternion); const me = _m.elements;
    const HM = this.puHalo.instanceMatrix.array, HC = this.puHalo.instanceColor.array, PM = this.puPillar.instanceMatrix.array, PC = this.puPillar.instanceColor.array;
    for (let i = 0; i < L.length && nh < 24; i++) {
      const p = L[i], k = p.k, mesh = this.puMesh[k]; if (!mesh || cnt[k] >= 12) continue; const c = _c.set(PU_COL[k]);
      const age = p.b === undefined || v.tick === undefined ? 1 : Math.min(1, (v.tick - p.b) / 40); const sc = 1.25 * (0.3 + 0.7 * Math.min(1, age + 0.3)), hgt = 1.9 + Math.sin(t * 2.2 + p.id) * 0.35;
      _q.setFromEuler(_e.set(0.35 * Math.sin(t + p.id), t * 1.8 + p.id, 0)); _m2.compose(_v.set(p.x, hgt, p.y), _q, _s.set(sc, sc, sc)); _m2.toArray(mesh.instanceMatrix.array, cnt[k] * 16); cnt[k]++;
      const o = nh * 16, hs = 5.2 + Math.sin(t * 5 + p.id) * 0.8; HM[o] = me[0] * hs; HM[o + 1] = me[1] * hs; HM[o + 2] = me[2] * hs; HM[o + 3] = 0; HM[o + 4] = me[4] * hs; HM[o + 5] = me[5] * hs; HM[o + 6] = me[6] * hs; HM[o + 7] = 0; HM[o + 8] = me[8]; HM[o + 9] = me[9]; HM[o + 10] = me[10]; HM[o + 11] = 0; HM[o + 12] = p.x; HM[o + 13] = hgt; HM[o + 14] = p.y; HM[o + 15] = 1;
      HC[nh * 3] = c.r * 0.9; HC[nh * 3 + 1] = c.g * 0.9; HC[nh * 3 + 2] = c.b * 0.9;
      _m2.makeTranslation(p.x, 0, p.y); _m2.toArray(PM, nh * 16); PC[nh * 3] = c.r; PC[nh * 3 + 1] = c.g; PC[nh * 3 + 2] = c.b;
      const sp = this.puSpr[nh]; sp.visible = true; if (sp.material.map !== this.puTex[k]) { sp.material.map = this.puTex[k]; sp.material.needsUpdate = true; } sp.position.set(p.x, hgt + 2.1, p.y); sp.scale.set(2.1, 2.1, 1);
      if (Math.random() < 0.25 && this.pMax) this.emit(p.x + (Math.random() - 0.5) * 1.6, 0.4, p.y + (Math.random() - 0.5) * 1.6, 0, 2 + Math.random() * 2, 0, [c.r, c.g, c.b], 0.9, 0.35, 1, -0.5);
      nh++;
    }
    for (let k = 0; k < this.puMesh.length; k++) this._flush(this.puMesh[k], cnt[k]); this._flush(this.puHalo, nh); this._flush(this.puPillar, nh);
    for (let i = nh; i < this.puSpr.length; i++) this.puSpr[i].visible = false;
  }

  // ---------- quality ----------
  setQuality(name) { if (!QUALITY[name]) return; if (name === this.qName && this._built) { this._applyDpr(); return; } this.qName = name; this.Q = QUALITY[name]; this._applyQ(); }
  _applyQ(first) {
    const Q = this.Q; this.pMax = Q.particles;
    this.r.shadowMap.enabled = Q.shadows > 0; this.r.shadowMap.type = Q.shadows > 1 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.sun.castShadow = Q.shadows > 0; const ms = Q.shadows > 1 ? 2048 : 1024; if (this.sun.shadow.map && this.sun.shadow.mapSize.x !== ms) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } this.sun.shadow.mapSize.set(ms, ms);
    this.fxLight.visible = true; // constant light count: toggling a light recompiles every lit material mid-match this.studio.key.castShadow = Q.shadows > 0; this.studio.setQuality(Q);
    if (!first) { this.snakes.build(Q); for (const m of this.snakes.worldMeshes) this.scene.add(m); for (const m of this.snakes.showMeshes) this.studio.scene.add(m); }
    if (!first && this._matTier !== Q.mat + Q.food) { for (const E of [this.eyes, this.eyesS]) for (const k in E) { E[k].parent.remove(E[k]); E[k].geometry.dispose(); E[k].material.dispose(); } for (const m of [this.food, this.halo, this.gem]) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } this._initFood(); this.eyes = this._eyes(this.scene); this.eyesS = this._eyes(this.studio.scene); }
    this._matTier = Q.mat + Q.food;
    const w = this.worldI; if (!first) { this.worldI = -1; this.setWorld(w); }
    this._built = true; this._applyDpr(); this.warm = this.prewarm && this.studio ? this.prewarm() : null;
  }
  setOptions(o) { Object.assign(this, o); this._applyDpr(); }
  _applyDpr() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.Q.dpr) * this.dyn; this.dpr = dpr;
    this.r.setPixelRatio(dpr); this.r.setSize(this.w || 1, this.h || 1, false);
    const want = this.Q.post && this.postFx;
    if (want && (!this.post.on || this.post.Q !== this.Q)) { this.post.build(this.Q, this.scene, this.cam); this._grade(); }
    if (!want && this.post.on) this.post.dispose();
    if (this.post.on) this.post.setSize();
    document.documentElement.classList.toggle("nopost", !this.post.on);
    if (this.Q.reflect && this.W3 && (this.W3.reflect || this.W3.water !== "none")) { const s = this.Q.reflect, w = Math.max(64, (this.w * dpr * s) | 0), h = Math.max(64, (this.h * dpr * s) | 0); if (!this.mirrorRT) this.mirrorRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }); else this.mirrorRT.setSize(w, h); }
    const sc = (this.h || 400) * dpr * 0.5 / Math.tan((this.cam.fov * Math.PI) / 360); this.ptScale.value = sc;
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight; this.w = w; this.h = h;
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); this.studio.resize(w, h); this._applyDpr();
  }
  // dynamic resolution: keeps frame time on target by scaling the render resolution (55%–100%)
  _dynRes(dt) {
    this.ftAcc += dt; this.ftN++; this.dynT += dt; if (this.dynT < 1.2) return;
    const avg = this.ftAcc / this.ftN, target = 1 / (this.fpsTarget || 60); this.ftAcc = 0; this.ftN = 0; this.dynT = 0;
    let d = this.dyn; if (avg > target * 1.22) d = Math.max(0.55, d - 0.1); else if (avg < target * 1.04) d = Math.min(1, d + 0.05);
    if (Math.abs(d - this.dyn) > 0.01) { this.dyn = d; this._applyDpr(); }
  }

  // ---------- worlds ----------
  setWorld(i) {
    if (i === this.worldI) return; this.worldI = i; const W = WORLDS[i] || WORLDS[0]; this.W = W; this.W3 = W3D[W.id];
    if (this.world) { this.scene.remove(this.world.group); this.world.dispose(); }
    this.world = new World(this, W, i, this.Q, 130); this.scene.add(this.world.group); this.world.fit(this.arenaR);
    this.scene.fog.color.set(W.fog); this.scene.fog.density = this.W3.fogK; this.scene.background = new THREE.Color(W.fog);
    this.r.toneMappingExposure = W.exposure || 1.0; this.hemi.color.set(W.sky); this.hemi.groundColor.set(W.ground); this.hemi.intensity = W.hemiI; this.sun.color.set(W.sun); this.sun.intensity = W.sunI;
    this._grade();
    if (this.Q.reflect && (this.W3.reflect || this.W3.water !== "none")) this._applyDpr();
    if (this._built) this.warm = this.prewarm();
    // stream the neighbouring world in the background
    const nx = WORLDS[(i + 1) % WORLDS.length]; setTimeout(() => prefetchWorld(nx, this.Q.texLo), 2500);
  }
  _grade() { if (!this.W3) return; if (this.post.bloom) this.post.bloom.strength = this.W3.bloom; const gu = this.post.grade && this.post.grade.uniforms, G = this.W3.grade; if (gu) { gu.uLift.value.set(...G[0]); gu.uGain.value.set(...G[1]); gu.uSat.value = G[2]; gu.uCon.value = G[3]; } }
  setArena(R) { this.arenaR = R; if (this.world) this.world.fit(R); }
  worldReady() { return !!(this.world && this.world.ready); }

  // ---------- effects ----------
  burst(x, y, rgb, n, spd = 6, life = 0.8, size = 0.5, up = 3) {
    n = Math.min(n, this.pMax);
    for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, v = spd * (0.3 + Math.random() * 0.7); this.emit(x, 0.6 + Math.random() * 0.6, y, Math.cos(a) * v, up * (0.4 + Math.random()), Math.sin(a) * v, rgb, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), 2.2); }
  }
  emit(x, h, y, vx, vy, vz, rgb, life, size, drag = 1, grav = 4) {
    if (!this.pMax) return; const i = this.pHead; this.pHead = (this.pHead + 1) % this.pMax;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = h; this.pPos[i * 3 + 2] = y; this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pLife[i] = this.pMaxL[i] = life; this.pS0[i] = size; this.pDrag[i] = drag; this.pGrav[i] = grav; this.pCol[i * 4] = rgb[0]; this.pCol[i * 4 + 1] = rgb[1]; this.pCol[i * 4 + 2] = rgb[2];
  }
  shard(x, h, y, vx, vy, vz, rgb, size, life, conf) {
    const L = conf ? this.cD : this.bD; if (L.length >= this.Q.bits) L.shift();
    L.push({ x, h, y, vx, vy, vz, c: rgb, s: size, l: life, ml: life, rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6, wx: (Math.random() - 0.5) * 12, wy: (Math.random() - 0.5) * 12, conf });
  }
  shatter(s, fn, n0 = 60) {
    const pts = this.tmp, sp = Math.max(0.4, s.r * 0.7), n = bodyPoints(s, 0, 0, sp, s.len, pts, SW), step = Math.max(1, Math.ceil(n / n0)), col = this.col;
    const fx = s.skin && s.skin.k === "skin" && SKINS[s.skin.i] ? SKINS[s.skin.i].fx : 0;
    for (let j = 0; j < n; j += step) { fn(j, n, this.time, col); const rgb = [toLin(col[0]), toLin(col[1]), toLin(col[2])]; const a = Math.random() * 6.283, v = 2 + Math.random() * 5;
      this.emit(pts[j * 2], s.r, pts[j * 2 + 1], Math.cos(a) * v, 2 + Math.random() * 4, Math.sin(a) * v, rgb, 0.8 + Math.random() * 0.6, s.r * 1.6, 1.6);
      if (j % (step * 2) === 0) this.shard(pts[j * 2], s.r, pts[j * 2 + 1], Math.cos(a) * v * 1.4, 4 + Math.random() * 6, Math.sin(a) * v * 1.4, rgb, s.r * (0.25 + Math.random() * 0.3), 1.6 + Math.random()); }
    if (fx) this.legendDeath(fx, s, pts, n);
  }
  legendDeath(fx, s, pts, n) {
    const L = LEGEND[fx], C = LEGC[fx], x = s.x, y = s.y, r = s.r; if (!L) return; const c0 = C.tr[0], c1 = C.tr[1];
    const up = (k, spd, life, size, colA, colB, grav = 2) => { for (let i = 0; i < k; i++) { const a = Math.random() * 6.283, v = spd * Math.random(); this.emit(x + Math.cos(a) * r, r, y + Math.sin(a) * r, Math.cos(a) * v, 3 + Math.random() * spd, Math.sin(a) * v, Math.random() < 0.5 ? colA : colB, life, size, 1, grav); } };
    switch (L.death) {
      case "eruption": case "dragonfire": case "nova": up(90, 9, 1.4, 0.9, c0, c1, -1); this.ring(x, y, c0, 14); this.kick(0.5, [1, 0.6, 0.2]); break;
      case "supernova": up(120, 12, 1.6, 0.6, [1.5, 1.5, 1.5], c0, 0); this.ring(x, y, c0, 20); this.ring(x, y, [1, 1, 1], 10); this.kick(0.7, [0.9, 0.8, 1]); break;
      case "shatter": case "freeze": for (let i = 0; i < 40; i++) { const j = (i * 7) % Math.max(1, n); this.shard(pts[j * 2], r, pts[j * 2 + 1], (Math.random() - 0.5) * 12, 6 + Math.random() * 8, (Math.random() - 0.5) * 12, c0, r * 0.4, 2); } this.ring(x, y, c1, 12); break;
      case "glitch": for (let i = 0; i < 60; i++) this.shard(x + (Math.random() - 0.5) * 6, r, y + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 5 + Math.random() * 6, (Math.random() - 0.5) * 6, Math.random() < 0.5 ? c0 : c1, 0.35, 1.4, true); break;
      case "thunder": up(80, 14, 0.6, 0.5, [1.6, 1.8, 2], c0, 0); this.ring(x, y, c0, 16); this.kick(0.9, [0.7, 0.9, 1]); break;
      case "fade": case "aurora": up(70, 3, 2.2, 1.1, c0, c1, -2); break;
      case "neonburst": this.ring(x, y, c0, 10); this.ring(x, y, c1, 16); this.ring(x, y, c0, 22); up(60, 10, 0.9, 0.6, c0, c1); break;
      case "implode": for (let i = 0; i < 80; i++) { const a = Math.random() * 6.283, d = 8 + Math.random() * 6; this.emit(x + Math.cos(a) * d, 1 + Math.random() * 2, y + Math.sin(a) * d, -Math.cos(a) * d * 2.2, 0, -Math.sin(a) * d * 2.2, i % 2 ? c0 : c1, 0.45, 0.7, 0.2, 0); } this.ring(x, y, c0, 9); break;
    }
  }
  ring(x, y, rgb, maxR = 8) { const m = this.rings.find((r) => !r.visible) || this.rings[0]; m.visible = true; m.userData.t = 0; m.userData.R = maxR; m.position.set(x, 0.15, y); m.material.color.setRGB(rgb[0] * 2.2, rgb[1] * 2.2, rgb[2] * 2.2); }
  shake(a) { if (this.juice && !this.reduceMotion) this.shakeA = Math.min(1.4, this.shakeA + a); }
  kick(ca, flashRgb, flashA = 0.18) { if (this.reduceMotion) return; this.ca = Math.min(1.5, this.ca + ca); if (flashRgb) { this.flash.set(flashRgb[0], flashRgb[1], flashRgb[2], Math.max(this.flash.w, flashA)); } }
  light(x, y, rgb, k = 1) { if (!this.Q.post) return; this.fxLight.position.set(x, 3, y); this.fxLight.color.setRGB(rgb[0], rgb[1], rgb[2]); this.fxLight.intensity = 32 * k; }
  confetti(x, y, n = 160) { const P = [[1, 0.2, 0.3], [1, 0.8, 0.1], [0.2, 0.9, 1], [0.6, 0.3, 1], [0.2, 1, 0.5], [1, 1, 1]]; for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = 2 + Math.random() * 9; this.shard(x + Math.cos(a) * 2, 2 + Math.random() * 3, y + Math.sin(a) * 2, Math.cos(a) * v, 9 + Math.random() * 10, Math.sin(a) * v, P[i % P.length], 0.35 + Math.random() * 0.2, 3 + Math.random() * 2, true); } }

  _label(id, name, color, me) {
    let L = this.labels.get(id);
    if (!L || L.name !== name || L.color !== color) {
      if (!L) { L = this.labelPool.pop(); if (!L) { const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false })); sp.renderOrder = 10; L = { cv, tex, sp }; } this.scene.add(L.sp); this.labels.set(id, L); }
      const g = L.cv.getContext("2d"); g.clearRect(0, 0, 256, 64); g.font = `700 ${me ? 32 : 28}px Oxanium, "Cairo", -apple-system, "Segoe UI", Roboto, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 7; g.strokeStyle = "rgba(0,0,0,0.6)"; g.strokeText(name, 128, 34); g.fillStyle = color; g.fillText(name, 128, 34);
      L.tex.needsUpdate = true; L.name = name; L.color = color;
    }
    L.used = true; return L;
  }

  // ---------- one snake → spine row + instance + eyes ----------
  _snake(d, row, slot, ghost, E, t, cnt, show) {
    const s = d.s, Q = this.Q, pts = this.tmp, col = this.col, ys = this.ys, C = this.cols;
    let st = this.state.get(s.id); if (!st) { st = { m: s.m, pulse: -9, sq: 0, blink: 2 + Math.random() * 4, seed: Math.random() }; this.state.set(s.id, st); }
    st.used = true;
    const r = s.r * (d.scale || 1);
    let n, len;
    if (show) { const P = this.studio.pose(t, d.idle, r, pts, ys); n = P.n; len = P.len; }
    else {
      let sp = Math.max(0.25, r * 0.5); if (s.len / sp > SW - 2) sp = s.len / (SW - 2);
      n = bodyPoints(s, d.o, d.f, sp, s.len, pts, SW); len = (n - 1) * sp;
      if (d.ox || d.oy) for (let j = 0; j < n; j++) { pts[j * 2] += d.ox; pts[j * 2 + 1] += d.oy; }
      ys.fill(0, 0, n);
      if (s.m > st.m + 0.4) { st.sq = Math.min(1, st.sq + 0.6); if (s.m > st.m + 2.5 || (st.acc = (st.acc || 0) + s.m - st.m) > 6) { st.pulse = t; st.acc = 0; } } st.m = s.m;
    }
    if (n < 2) return 0;
    st.sq *= Math.exp(-(this.dt || 0.016) * 7);
    const fn = d.fn; for (let j = 0; j < n; j++) { fn(j, n, t, col); C[j] = packCol(toLin(col[0]), toLin(col[1]), toLin(col[2])); }
    this.snakes.writeRow(row, pts, n, r, ys, C);
    const fx = d.fx || 0, glow = d.glow || (fx && LEGC[fx] ? LEGC[fx].glow : null);
    const gk = d.team ? 0.9 : d.gold ? 1.1 : fx ? 0.35 : 0;
    this.snakes.set(show ? this._showGrp : ghost ? "g" : fx ? "f" : "i", slot, [row, n, len, fx], [show ? (d.pulse ?? st.pulse) : st.pulse, st.sq, d.boost ? 1 : 0, d.alpha ?? 1], [glow ? glow[0] * gk : 0, glow ? glow[1] * gk : 0, glow ? glow[2] * gk : 0, st.seed]);
    // eyes / tongue: follow the head frame exactly as the vertex shader builds it
    const hx = pts[0], hz = pts[1], hy = ys[0], fxw = pts[0] - pts[2], fzw = pts[1] - pts[3], fl = Math.hypot(fxw, fzw, ys[0] - ys[1]) || 1;
    const fwx = fxw / fl, fwz = fzw / fl, fwy = (ys[0] - ys[1]) / fl, sdx = -fwz, sdz = fwx; const alpha = d.alpha ?? 1;
    const bob = Math.sin(t * 3.1 + st.seed * 6) * 0.07 * r; const hr = r * 1.12 * alpha;
    st.blink -= this.dt || 0.016; let bk = 1; if (st.blink < 0.14) { bk = Math.max(0.08, Math.abs(st.blink - 0.07) / 0.07); if (st.blink < 0) st.blink = 2.5 + Math.random() * 4; }
    const Ed = EYES[d.eye] || EYES[0], EC = EYEC[d.eye] || EYEC[0], er = r * 0.36 * Ed.s * alpha, la = d.look ?? Math.atan2(fwz, fwx), lc = Math.cos(la), ls = Math.sin(la);
    const W = E.w.instanceMatrix.array, WC = E.w.instanceColor.array, P = E.p.instanceMatrix.array, PC = E.p.instanceColor.array, H = E.h.instanceMatrix.array; const glowE = Ed.glow ? 3 : 1;
    for (let q = 0; q < Ed.n; q++) {
      const side = Ed.n === 1 ? 0 : (q ? 1 : -1) * hr * 0.5;
      const ex = hx + fwx * hr * 0.55 + sdx * side, ez = hz + fwz * hr * 0.55 + sdz * side, ey = hy + r * 0.8 * alpha + bob + hr * 0.5 + fwy * hr * 0.4;
      const e = cnt.e++; _m.makeScale(er, er * bk, er).setPosition(ex, ey, ez); _m.toArray(W, e * 16); WC[e * 3] = EC.w[0]; WC[e * 3 + 1] = EC.w[1]; WC[e * 3 + 2] = EC.w[2];
      const pr = er * Ed.p, pd = er * 0.7, slit = Ed.id === "fierce" || Ed.id === "demon" ? 0.45 : 1;
      _q.setFromAxisAngle(_v.set(0, 1, 0), -la); _s.set(pr * slit, pr * bk, pr); _m.compose(_v2.set(ex + lc * pd, ey + er * 0.25 * bk, ez + ls * pd), _q, _s); _m.toArray(P, e * 16);
      PC[e * 3] = EC.p[0] * glowE; PC[e * 3 + 1] = EC.p[1] * glowE; PC[e * 3 + 2] = EC.p[2] * glowE;
      _m.makeScale(er * 0.18 * bk, er * 0.18 * bk, er * 0.18 * bk).setPosition(ex + lc * pd * 0.9 - 0.15 * er, ey + er * 0.7 * bk, ez + ls * pd * 0.9 + 0.1 * er); _m.toArray(H, e * 16);
    }
    const tph = (t * 0.45 + s.id * 0.37) % 1;
    if (tph < 0.1 && alpha > 0.9) { const ext = Math.sin((tph / 0.1) * Math.PI) * hr * 1.4, flick = Math.sin(t * 60) * 0.25, a = Math.atan2(fwz, fwx) + flick; const T2 = E.t.instanceMatrix.array, ti = cnt.t++;
      _q.setFromAxisAngle(_v.set(0, 1, 0), -a); _s.set(ext, hr * 0.9, hr * 0.9); _m.compose(_v2.set(hx + fwx * hr * 1.2, hy + r * 0.8 * alpha + bob + hr * 0.05, hz + fwz * hr * 1.2), _q, _s); _m.toArray(T2, ti * 16); }
    d._hx = hx; d._hz = hz; d._hr = hr; d._n = n;
    // trails: legendary signature or equipped trail
    if (!show && this.pMax && alpha > 0.5) {
      const L = fx ? LEGEND[fx] : null; const tj = Math.max(1, n - 3), tx = pts[tj * 2], tz = pts[tj * 2 + 1];
      if (L && (d.boost || Math.random() < 0.35)) { const cc = LEGC[fx].tr[(Math.random() * 2) | 0], k = L.tk; const jj = (Math.random() * n) | 0, bx = pts[jj * 2], bz = pts[jj * 2 + 1];
        if (k === "ember" || k === "flare") this.emit(bx + (Math.random() - 0.5) * r, r * 1.2, bz + (Math.random() - 0.5) * r, (Math.random() - 0.5) * 0.6, 1.6 + Math.random(), (Math.random() - 0.5) * 0.6, cc, 0.9, 0.42, 0.6, -0.5);
        else if (k === "stars" || k === "glint" || k === "snow") this.emit(bx + (Math.random() - 0.5) * r * 2, r * (0.6 + Math.random()), bz + (Math.random() - 0.5) * r * 2, 0, 0.3, 0, cc, 0.8, 0.3, 1, 0);
        else if (k === "sparks") this.emit(bx, r, bz, (Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8, cc, 0.35, 0.28, 3, 6);
        else if (k === "wisps" || k === "smoke") this.emit(tx, r, tz, (Math.random() - 0.5) * 0.8, 0.8, (Math.random() - 0.5) * 0.8, cc, 1.5, 0.9, 0.5, -0.3);
        else this.emit(tx + (Math.random() - 0.5) * r, r, tz + (Math.random() - 0.5) * r, (Math.random() - 0.5), 0.8, (Math.random() - 0.5), cc, 0.8, 0.5, 0.6);
      } else { const T = TRAILS[d.trail]; if (T && T.c && (d.boost || Math.random() < 0.25)) { const cc = TRAILC[d.trail][(Math.random() * 2) | 0]; this.emit(tx + (Math.random() - 0.5) * r, r, tz + (Math.random() - 0.5) * r, (Math.random() - 0.5), d.trail === 5 ? 1.5 : 0.8, (Math.random() - 0.5), cc, 0.7, d.trail === 6 ? 0.35 : 0.5, 0.6); }
        else if (d.boost && Math.random() < 0.8) { fn(tj, n, t, col); this.emit(tx, r * 0.8, tz, (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2, [toLin(col[0]) * 1.5, toLin(col[1]) * 1.5, toLin(col[2]) * 1.5], 0.55, 0.6, 1.5); } }
    }
    return n;
  }

  // ---------- frame ----------
  frame(v) {
    if (this.lost) return;
    const t = v.t, dt = Math.min(0.05, v.dt); this.time = t; this.dt = dt; const Q = this.Q;
    this.snakes.uniforms.uT.value = t; this.stormU.uT.value = t;
    if (!this.reduceMotion && Q.post) this._dynRes(v.dt); this.fpsTarget = v.fpsTarget || 60;
    for (const st of this.state.values()) st.used = false;
    if (v.scene === "show") { this._frameShow(v, t, dt); } else this._frameWorld(v, t, dt);
    for (const [id, st] of this.state) if (!st.used) this.state.delete(id);
  }
  _camera(v, dt) {
    const cam = this.cam, c = v.cam, zoom = c.zoom || 1, hgt = 17.5 * zoom, back = hgt * 0.68;
    const fov = 48 + (c.boost && !this.reduceMotion ? 8 : 0) + (c.fovAdd || 0); if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 6)); cam.updateProjectionMatrix(); this._applyDpr(); }
    const k = 1 - Math.exp(-dt * (c.snap ? 60 : 9));
    this.camLook.x += (c.x - this.camLook.x) * k; this.camLook.z += (c.y - this.camLook.z) * k;
    this.camPos.y += (hgt - this.camPos.y) * (1 - Math.exp(-dt * 3));
    // gameplay camera
    let px = this.camLook.x, py = this.camPos.y, pz = this.camLook.z + this.camPos.y * 0.68, lx = this.camLook.x, ly = 0, lz = this.camLook.z - hgt * 0.05;
    if (c.orbit !== undefined) { const a = c.orbit; px = this.camLook.x + Math.sin(a) * back * 1.6; py = hgt * 0.75; pz = this.camLook.z + Math.cos(a) * back * 1.6; }
    if (c.title !== undefined) { // title flyover: sweeping low path across the arena with the sky in view
      const a = c.title * 0.06, R = (this.arenaR || 130) * 0.62; px = Math.cos(a) * R; pz = Math.sin(a) * R; py = 9 + Math.sin(c.title * 0.13) * 3; lx = Math.cos(a + 0.9) * R * 0.5; lz = Math.sin(a + 0.9) * R * 0.5; ly = 2.5;
    }
    let w = 0, cx = 0, cy = 0, cz = 0, tx = 0, ty = 0, tz = 0;
    if (c.intro !== undefined && c.intro > 0) { // match intro sweep: from a wide orbit down into the play view
      const u = c.intro, a = 2.4 * u + 0.4; w = u * u * (3 - 2 * u); cx = c.x + Math.sin(a) * 26; cz = c.y + Math.cos(a) * 26; cy = 6 + 22 * u; tx = c.x; ty = 0.8; tz = c.y;
    }
    if (c.kill) { const K = c.kill, a = t2(K.t) * 0.9 + K.a0; w = Math.max(w, K.w); cx = K.x + Math.sin(a) * 9; cz = K.y + Math.cos(a) * 9; cy = 4.5; tx = K.x; ty = 0.8; tz = K.y; }
    if (c.victory !== undefined) { const a = c.victory * 0.5; w = Math.min(1, c.victory * 1.4); cx = c.x + Math.sin(a) * 14; cz = c.y + Math.cos(a) * 14; cy = 7.5 + Math.sin(c.victory * 0.7); tx = c.x; ty = 1; tz = c.y; }
    if (w > 0) { px += (cx - px) * w; py += (cy - py) * w; pz += (cz - pz) * w; lx += (tx - lx) * w; ly += (ty - ly) * w; lz += (tz - lz) * w; }
    let sx = 0, sz = 0; if (this.shakeA > 0.001) { sx = (Math.random() - 0.5) * this.shakeA; sz = (Math.random() - 0.5) * this.shakeA; this.shakeA *= Math.exp(-dt * 7); }
    cam.position.set(px + sx, py, pz + sz); cam.lookAt(lx + sx, ly, lz + sz); cam.updateMatrixWorld();
    function t2(x) { return x; }
  }
  _frameWorld(v, t, dt) {
    const Q = this.Q, cam = this.cam; this._camera(v, dt);
    const vx = this.camLook.x, vz = this.camLook.z - 17.5 * (v.cam.zoom || 1) * 0.35; const vr = Math.min(17.5 * (v.cam.zoom || 1) * 2.2, 70), vr2 = vr * vr;
    const far = v.cam.title !== undefined || v.cam.kill || v.cam.intro > 0 || v.cam.victory !== undefined; const cullR = far ? 1e9 : vr;
    this.camU.value.set(cam.position.x, 0, cam.position.z);
    // sun + shadow frustum follow the action
    this.world.update(t, dt, this);
    this.world.sky.position.copy(cam.position); const zk = Math.max(1, (v.cam.zoom || 1) * (far ? 1.6 : 1)); if (Math.abs((this._shZ || 0) - zk) > 0.05) { this._shZ = zk; const sc = this.sun.shadow.camera; sc.left = sc.bottom = -34 * zk; sc.right = sc.top = 34 * zk; sc.updateProjectionMatrix(); }
    this.sun.position.set(this.camLook.x + this.sunDir.x * 70, this.sunDir.y * 70, this.camLook.z + this.sunDir.z * 70); this.sun.target.position.set(this.camLook.x, 0, this.camLook.z);
    // snakes
    const E = this.eyes, cnt = { e: 0, t: 0 }; let ni = 0, ng = 0, nfx = 0, row = 0; const TR = this.teamRing.instanceMatrix.array, TRC = this.teamRing.instanceColor.array; let nt = 0;
    for (const L of this.labels.values()) L.used = false; let ne = 0;
    for (const d of v.snakes) {
      if (row >= SHOW_ROW) break; const s = d.s; const hx0 = s.sx(d.o), hy0 = s.sy(d.o), dx0 = hx0 - vx, dz0 = hy0 - vz;
      if (dx0 * dx0 + dz0 * dz0 > (cullR + s.len) * (cullR + s.len)) continue;
      const ghost = d.fx === 7 || d.inv, lf = !ghost && d.fx > 0; if ((ghost && ng >= 16) || (lf && nfx >= 24)) continue; const slot = ghost ? ng : lf ? nfx : ni;
      const n = this._snake(d, row, slot, ghost, E, t, cnt, false); if (!n) continue; row++; if (ghost) ng++; else if (lf) nfx++; else ni++;
      if ((d.team || d.gold) && nt < MAXS) { const tc = d.gold ? GOLDC : d.team, rr = d._hr * (d.gold ? 3.2 + 0.3 * Math.sin(t * 6) : 2.3); _m.makeScale(rr, 1, rr).setPosition(d._hx, 0.07, d._hz); _m.toArray(TR, nt * 16); TRC[nt * 3] = tc[0] * 2; TRC[nt * 3 + 1] = tc[1] * 2; TRC[nt * 3 + 2] = tc[2] * 2; nt++; }
      if (d.emo && ne < this.emoSpr.length && !v.hideNames) { const sp = this.emoSpr[ne++], ti = d.emoI | 0; if (sp.material.map !== this.emoTex[ti]) { sp.material.map = this.emoTex[ti]; sp.material.needsUpdate = true; } const es = Math.max(3.4, d._hr * 3); sp.position.set(d._hx, d._hr * 2.6 + 1.0 + es * 0.75, d._hz - d._hr * 0.4); sp.scale.set(es, es, 1); sp.visible = true; }
      if (d.gold && this.pMax && Math.random() < 0.5) this.emit(d._hx + (Math.random() - 0.5) * d._hr * 3, d._hr * 2, d._hz + (Math.random() - 0.5) * d._hr * 3, 0, 1.5, 0, [1.6, 1.2, 0.3], 0.7, 0.3, 1, -0.3);
      if (d.name && (Q.names > 1 || d.me || d.top) && !v.hideNames && !(d.inv && !d.me)) { const L = this._label(s.id, d.name, d.nc || "#fff", d.me); L.sp.position.set(d._hx, d._hr * 2.6 + 1.0, d._hz - d._hr * 0.4); const sw = Math.max(5.5, d._hr * 4.5) * (d.me ? 1.05 : 0.9); L.sp.scale.set(sw, sw / 4, 1); L.sp.material.opacity = d.alpha ?? 1; L.sp.visible = true; }
    }
    for (const [id, L] of this.labels) if (!L.used) { this.scene.remove(L.sp); this.labels.delete(id); this.labelPool.push(L); }
    for (let i = ne; i < this.emoSpr.length; i++) this.emoSpr[i].visible = false;
    this.snakes.commit(ni, nfx, ng); this._flushE(E, cnt); this._flush(this.teamRing, nt);
    if (v.cam.title !== undefined) { this.food.count = this.halo.count = this.gem.count = 0; } else this._food(v, t, vx, vz, far ? 1e9 : vr2);
    this._modeFx(v, t); this._pus(v, t); this._meteors(v, t);
    if (this.pMax && v.rain) { const h = v.rain; for (let k = 0; k < 6; k++) { const a = Math.random() * 6.283, d = 3 + Math.random() * 16; this.emit(h.x + Math.cos(a) * d, 10 + Math.random() * 4, h.y + Math.sin(a) * d, 0, -18, 0, [0.8, 1.6, 0.3], 0.6, 0.35, 1, 0); } }
    if (this.pMax && v.goldRain) { const h = v.goldRain; for (let k = 0; k < 4; k++) { const a = Math.random() * 6.283, d = 2 + Math.random() * 28; this.emit(h.x + Math.cos(a) * d, 11 + Math.random() * 5, h.y + Math.sin(a) * d, 0, -16, 0, [1.8, 1.3, 0.3], 0.7, 0.4, 1, 0); } }
    this._particles(dt); this._bitsUpdate(dt);
    for (const rg of this.rings) if (rg.visible) { rg.userData.t += dt * 1.5; const u = rg.userData.t; if (u >= 1) { rg.visible = false; continue; } const s2 = 1 + (1 - Math.pow(1 - u, 3)) * rg.userData.R; rg.scale.set(s2, 1, s2); rg.material.uniforms.opacity.value = (1 - u) * 0.95; rg.material.uniforms.uS.value = s2; }
    if (this.fxLight.intensity > 0.1) this.fxLight.intensity *= Math.exp(-dt * 6); else this.fxLight.intensity = 0;
    // post uniforms
    this.ca *= Math.exp(-dt * 5); this.flash.w *= Math.exp(-dt * 6); this.speed += ((v.cam.boost && !this.reduceMotion ? 1 : 0) - this.speed) * (1 - Math.exp(-dt * 5)); this.box += ((v.letterbox ? 1 : 0) - this.box) * (1 - Math.exp(-dt * 6));
    document.documentElement.style.setProperty("--box", this.post.on ? 0 : this.box.toFixed(3));
    if (this.post.on) { const u = this.post.grade.uniforms; u.uCA.value = this.ca + this.speed * 0.25; u.uSpeed.value = this.speed; u.uBox.value = this.box; u.uFlash.value.copy(this.flash); u.uT.value = t; u.uVig.value = 0.36 + this.box * 0.2; this.post.setScene(this.scene, cam); if (this.post.dofOn) this.post.setDof(false); }
    // planar reflection (high/ultra): mirrored camera renders the scene minus ground/water into a half-res target
    const gu = this.world.groundU; gu.uRefl.value = 0;
    if (this.mirrorRT && Q.reflect && (this.W3.reflect || (this.world.water && this.W3.water !== "lava"))) { this._mirror(); gu.tRefl.value = this.mirrorRT.texture; gu.uRefl.value = this.W3.reflect || 0.0001; }
    if (this.post.on) this.post.render(dt); else this.r.render(this.scene, cam);
  }
  _mirror() {
    const cam = this.cam, mc = this.mirrorCam; const cp = _v.setFromMatrixPosition(cam.matrixWorld);
    _m.extractRotation(cam.matrixWorld); const look = _v2.set(0, 0, -1).applyMatrix4(_m).add(cp);
    mc.position.set(cp.x, -cp.y, cp.z); const target = new THREE.Vector3(look.x, -look.y, look.z); mc.up.set(0, 1, 0).applyMatrix4(_m); mc.up.y = -mc.up.y; mc.lookAt(target);
    mc.fov = cam.fov; mc.aspect = cam.aspect; mc.near = cam.near; mc.far = cam.far; mc.updateMatrixWorld(); mc.projectionMatrix.copy(cam.projectionMatrix);
    this.mirrorMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse); this.world.groundU.uMat.value.copy(this.mirrorMat);
    const g = this.world.ground, w = this.world.water, vis = []; g.visible = false; if (w) w.visible = false; for (const L of this.labels.values()) { vis.push(L.sp); L.sp.visible = false; } this.pts.visible = false;
    const shadow = this.r.shadowMap.autoUpdate; this.r.shadowMap.autoUpdate = false;
    const prev = this.r.getRenderTarget(); this.r.setRenderTarget(this.mirrorRT); this.r.clear(); this.r.render(this.scene, mc); this.r.setRenderTarget(prev);
    this.r.shadowMap.autoUpdate = shadow; g.visible = true; if (w) w.visible = true; for (const s of vis) s.visible = true; this.pts.visible = true;
  }
  _food(v, t, vx, vz, vr2) {
    const F = v.food; if (!F) { this.food.count = 0; this.halo.count = 0; this.gem.count = 0; return; }
    const FM = this.food.instanceMatrix.array, FC = this.food.instanceColor.array, HM = this.halo.instanceMatrix.array, HCc = this.halo.instanceColor.array;
    const m = _m; m.makeRotationFromQuaternion(this.cam.quaternion); const me = m.elements;
    let nf = 0, ng = 0; const pal = v.foodPal, GM = this.gem.instanceMatrix.array, GC = this.gem.instanceColor.array, gr = t * 1.8, gc = Math.cos(gr), gs = Math.sin(gr);
    for (let i = 0; i < F.FM && nf < MAX_FOOD; i++) {
      if (!F.fa[i]) continue; const x = F.fx[i], y = F.fy[i], dx = x - vx, dz = y - vz; if (dx * dx + dz * dz > vr2) continue;
      const age = F.age ? F.age(i) : 1, grow = age < 1 ? age * age * (3 - 2 * age) : 1;
      const val = F.fv[i], fr = (0.24 + Math.sqrt(val) * 0.17) * grow, bob = 0.5 + fr + Math.sin(t * 3 + i) * 0.14, cc = pal[F.fc[i] % pal.length];
      const o = nf * 16;
      if (val >= 4 && ng < MAX_GEM) { const go = ng * 16, gz = fr * 1.3; GM[go] = gc * gz; GM[go + 1] = 0; GM[go + 2] = -gs * gz; GM[go + 3] = 0; GM[go + 4] = 0; GM[go + 5] = gz * 1.5; GM[go + 6] = 0; GM[go + 7] = 0; GM[go + 8] = gs * gz; GM[go + 9] = 0; GM[go + 10] = gc * gz; GM[go + 11] = 0; GM[go + 12] = x; GM[go + 13] = bob + 0.2; GM[go + 14] = y; GM[go + 15] = 1;
        GC[ng * 3] = cc[0]; GC[ng * 3 + 1] = cc[1]; GC[ng * 3 + 2] = cc[2]; ng++; for (let q = 0; q < 16; q++) FM[o + q] = 0; FM[o + 15] = 1; }
      else { FM[o] = fr; FM[o + 5] = fr; FM[o + 10] = fr; FM[o + 1] = FM[o + 2] = FM[o + 3] = FM[o + 4] = FM[o + 6] = FM[o + 7] = FM[o + 8] = FM[o + 9] = FM[o + 11] = 0; FM[o + 12] = x; FM[o + 13] = bob; FM[o + 14] = y; FM[o + 15] = 1; }
      FC[nf * 3] = cc[0]; FC[nf * 3 + 1] = cc[1]; FC[nf * 3 + 2] = cc[2];
      const hs = fr * (val >= 4 ? 6 : 4.4 + Math.sin(t * 4 + i * 1.7) * 0.6);
      HM[o] = me[0] * hs; HM[o + 1] = me[1] * hs; HM[o + 2] = me[2] * hs; HM[o + 3] = 0; HM[o + 4] = me[4] * hs; HM[o + 5] = me[5] * hs; HM[o + 6] = me[6] * hs; HM[o + 7] = 0; HM[o + 8] = me[8]; HM[o + 9] = me[9]; HM[o + 10] = me[10]; HM[o + 11] = 0; HM[o + 12] = x; HM[o + 13] = bob; HM[o + 14] = y; HM[o + 15] = 1;
      HCc[nf * 3] = cc[0] * 0.5; HCc[nf * 3 + 1] = cc[1] * 0.5; HCc[nf * 3 + 2] = cc[2] * 0.5; nf++;
    }
    // swallowed food streams into the mouth, shedding sparkles (absorb effect)
    if (v.ghosts) for (const gh of v.ghosts) {
      if (nf >= MAX_FOOD) break; const u = gh.t, e = u * u, x = gh.x + (gh.tx - gh.x) * e, y = gh.y + (gh.ty - gh.y) * e, fr = gh.r * (1 - u * 0.85), cc = pal[gh.c % pal.length], hgt = 0.6 + Math.sin(u * Math.PI) * 0.9;
      const o = nf * 16; FM[o] = fr; FM[o + 5] = fr; FM[o + 10] = fr; FM[o + 1] = FM[o + 2] = FM[o + 3] = FM[o + 4] = FM[o + 6] = FM[o + 7] = FM[o + 8] = FM[o + 9] = FM[o + 11] = 0; FM[o + 12] = x; FM[o + 13] = hgt; FM[o + 14] = y; FM[o + 15] = 1;
      FC[nf * 3] = cc[0]; FC[nf * 3 + 1] = cc[1]; FC[nf * 3 + 2] = cc[2]; const hs = fr * 3; HM[o] = me[0] * hs; HM[o + 1] = me[1] * hs; HM[o + 2] = me[2] * hs; HM[o + 4] = me[4] * hs; HM[o + 5] = me[5] * hs; HM[o + 6] = me[6] * hs; HM[o + 8] = me[8]; HM[o + 9] = me[9]; HM[o + 10] = me[10]; HM[o + 3] = HM[o + 7] = HM[o + 11] = 0; HM[o + 12] = x; HM[o + 13] = hgt; HM[o + 14] = y; HM[o + 15] = 1;
      HCc[nf * 3] = cc[0]; HCc[nf * 3 + 1] = cc[1]; HCc[nf * 3 + 2] = cc[2]; nf++;
      if (gh.mine && Math.random() < 0.7) this.emit(x, hgt, y, (Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6, cc, 0.35, 0.28, 2, 0);
    }
    this._flush(this.food, nf); this._flush(this.halo, this.Q.halo ? nf : 0); this._flush(this.gem, ng);
  }
  _modeFx(v, t) {
    const z = v.zone; this.storm.visible = this.stormOut.visible = !!z;
    if (z) { this.storm.scale.set(z.r, 1, z.r); this.storm.position.set(z.x, 13, z.y); this.stormOut.position.set(z.x, 0.06, z.y); this.stormOut.scale.set(z.r, 1, z.r); }
    const h = v.hill; this.hill.visible = !!h;
    if (h) { this.hill.position.set(h.x, 0, h.y); this.hill.scale.set(h.r, 1, h.r); this.hillBeam.scale.set(0.08, 1, 0.08); this.hillBeam.position.y = 15; const c = h.c || [1, 0.8, 0.2]; const pl = 0.8 + 0.25 * Math.sin(t * 4); this.hillRing.material.color.setRGB(c[0] * 1.5 * pl, c[1] * 1.5 * pl, c[2] * 1.5 * pl); this.hillDisc.material.color.setRGB(c[0], c[1], c[2]); this.hillDisc.material.opacity = 0.14 + 0.08 * pl; this.hillBeam.material.uniforms.uC.value.setRGB(c[0], c[1], c[2]); }
    const cs = v.cores || []; const CM = this.cores.instanceMatrix.array, CC = this.cores.instanceColor.array, HM = this.coreHalo.instanceMatrix.array; _m.makeRotationFromQuaternion(this.cam.quaternion); const me = _m.elements;
    for (let i = 0; i < cs.length && i < 16; i++) { const c = cs[i], s = 0.9 + Math.sin(t * 6 + i) * 0.15; const o = i * 16; for (let q = 0; q < 16; q++) CM[o + q] = 0; CM[o] = CM[o + 5] = CM[o + 10] = s * (c.r || 1); CM[o + 12] = c.x; CM[o + 13] = c.h || 2.5; CM[o + 14] = c.y; CM[o + 15] = 1; CC[i * 3] = 3; CC[i * 3 + 1] = 0.5; CC[i * 3 + 2] = 0.3;
      const hs = 5 * s * (c.r || 1); HM[o] = me[0] * hs; HM[o + 1] = me[1] * hs; HM[o + 2] = me[2] * hs; HM[o + 3] = 0; HM[o + 4] = me[4] * hs; HM[o + 5] = me[5] * hs; HM[o + 6] = me[6] * hs; HM[o + 7] = 0; HM[o + 8] = me[8]; HM[o + 9] = me[9]; HM[o + 10] = me[10]; HM[o + 11] = 0; HM[o + 12] = c.x; HM[o + 13] = c.h || 2.5; HM[o + 14] = c.y; HM[o + 15] = 1; }
    this._flush(this.cores, Math.min(16, cs.length)); this._flush(this.coreHalo, Math.min(16, cs.length));
  }
  _particles(dt) {
    const P = this.pPos, PC = this.pCol, PS = this.pSize, V = this.pVel;
    for (let i = 0; i < this.pMax; i++) {
      if (this.pLife[i] <= 0) { if (PS[i] !== 0) PS[i] = 0; continue; }
      this.pLife[i] -= dt; const l = Math.max(0, this.pLife[i] / this.pMaxL[i]); const dr = Math.exp(-dt * this.pDrag[i]);
      V[i * 3] *= dr; V[i * 3 + 2] *= dr; V[i * 3 + 1] -= this.pGrav[i] * dt;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] = Math.max(0.1, P[i * 3 + 1] + V[i * 3 + 1] * dt); P[i * 3 + 2] += V[i * 3 + 2] * dt;
      PC[i * 4 + 3] = l; PS[i] = this.pS0[i] * (0.4 + l * 0.6);
    }
    const pg = this.pts.geometry; pg.attributes.position.needsUpdate = true; pg.attributes.col.needsUpdate = true; pg.attributes.size.needsUpdate = true; pg.setDrawRange(0, this.pMax);
  }
  _bitsUpdate(dt) {
    for (const [L, mesh] of [[this.bD, this.bits], [this.cD, this.conf]]) {
      const M = mesh.instanceMatrix.array, Cc = mesh.instanceColor.array; let n = 0;
      for (let i = L.length - 1; i >= 0; i--) { const b = L[i]; b.l -= dt; if (b.l <= 0) { L.splice(i, 1); continue; }
        const drag = b.conf ? Math.exp(-dt * 1.6) : Math.exp(-dt * 0.6); b.vx *= drag; b.vz *= drag; b.vy -= (b.conf ? 5 : 18) * dt; if (b.conf) b.vy = Math.max(b.vy, -2.2);
        b.x += b.vx * dt; b.h += b.vy * dt; b.y += b.vz * dt; if (b.h < 0.1) { b.h = 0.1; b.vy *= -0.35; b.vx *= 0.7; b.vz *= 0.7; b.wx *= 0.6; b.wy *= 0.6; }
        b.rx += b.wx * dt; b.ry += b.wy * dt; const k = Math.min(1, b.l / (b.ml * 0.3)); _e.set(b.rx, b.ry, b.rz); _q.setFromEuler(_e); _s.setScalar(b.s * k); _m.compose(_v.set(b.x, b.h, b.y), _q, _s); _m.toArray(M, n * 16); Cc[n * 3] = b.c[0]; Cc[n * 3 + 1] = b.c[1]; Cc[n * 3 + 2] = b.c[2]; n++; }
      this._flush(mesh, n);
    }
  }
  _flushE(E, cnt) { this._flush(E.w, cnt.e); this._flush(E.p, cnt.e); this._flush(E.h, cnt.e); this._flush(E.t, cnt.t); }
  _flush(m, n) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

  // ---------- studio showcase (lobby / locker / reveals) ----------
  _frameShow(v, t, dt) {
    const S = this.studio, sv = v.show || {}; S.update(t, dt); const ex0 = this.r.toneMappingExposure; this.r.toneMappingExposure = 0.8;
    if (sv.x !== undefined && Math.abs(S.view.x - sv.x) > 0.001) { S.view.x += (sv.x - S.view.x) * (1 - Math.exp(-dt * 5)); S.resize(this.w, this.h); }
    const spin = (sv.spin || 0) + (sv.idle === "spin" ? 0.9 : 0.12); S.rot = (S.rot || 0) + dt * spin + (sv.drag || 0); S.ped.rotation.y = S.rot * 0.25;
    const d = sv.d; const cnt = { e: 0, t: 0 };
    if (d) { if (S._g !== sv.glow) { S._g = sv.glow; S.setGlow(sv.glow); }
      this._showGrp = this.snakes.setShow(d.fx); for (const m of this.snakes.showMeshes) m.rotation.y = S.rot; for (const k of ["w", "p", "h", "t"]) this.eyesS[k].rotation.y = S.rot;
      d.scale = sv.idle === "breathe" ? 1 + Math.sin(t * 2) * 0.04 : 1; d.pulse = sv.idle === "pulse" ? Math.floor(t / 1.6) * 1.6 : -9;
      this._snake(d, SHOW_ROW, 0, false, this.eyesS, t, cnt, true); this.snakes.commit(0, 0, 0);
      if (sv.idle === "charge" && Math.random() < 0.3) this._showSpark(S, d); }
    this._flushE(this.eyesS, cnt);
    const z = sv.zoom || 1, cam = S.cam; const tgtPos = _v.set(Math.sin(sv.orbit || 0) * 11.5 * z, 3.6 * z + (sv.lift || 0), Math.cos(sv.orbit || 0) * 11.5 * z);
    cam.position.lerp(tgtPos, 1 - Math.exp(-dt * 3)); cam.lookAt(S.look);
    this.ca *= Math.exp(-dt * 5); this.flash.w *= Math.exp(-dt * 4);
    if (this.post.on) { const u = this.post.grade.uniforms; u.uCA.value = this.ca; u.uSpeed.value = 0; u.uBox.value = 0; u.uFlash.value.copy(this.flash); u.uT.value = t; u.uVig.value = 0.5; u.uLift.value.set(0, 0, 0.01); u.uGain.value.set(1.02, 1.0, 1.0); u.uSat.value = 1.12; u.uCon.value = 1.06;
      this.post.setScene(S.scene, cam); if (this.post.bloom) { this.post.bloom.strength = 0.32; this.post.bloom.threshold = 0.92; } if (this.Q.dof) this.post.setDof(true, cam.position.distanceTo(S.look) - 0.6); this.post.render(dt); if (this.post.bloom) { this.post.bloom.threshold = 0.82; this.post.bloom.strength = this.W3 ? this.W3.bloom : 0.6; }
      // restore the world grade for the next game frame
      const G = this.W3.grade; u.uLift.value.set(...G[0]); u.uGain.value.set(...G[1]); u.uSat.value = G[2]; u.uCon.value = G[3]; }
    else this.r.render(S.scene, cam);
    this.r.toneMappingExposure = ex0;
  }
  _showSpark() {}
  reveal() { this.kick(0.8, [1, 0.9, 0.7], 0.55); this.studio.rot = (this.studio.rot || 0) + 2; }
  // world → screen (for DOM effects like floating "+10")
  project(x, y, h = 1) { const p = new THREE.Vector3(x, h, y).project(this.cam); return [(p.x * 0.5 + 0.5) * this.w, (-p.y * 0.5 + 0.5) * this.h, p.z < 1]; }
  info() { const i = this.r.info; return { calls: i.render.calls, tris: i.render.triangles, dyn: this.dyn, q: this.qName }; }
  dispose() { this.lost = true; try { this.post.dispose(); if (this.world) this.world.dispose(); this.studio.dispose(); this.snakes.dispose(); this.pmrem.dispose(); this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); this.r.dispose(); this.r.forceContextLoss(); } catch (_) {} }
}

function mergeGeos(list) {
  const pos = [], nor = [], idx = []; let off = 0;
  for (const g of list) { const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index ? g.index.array : null; for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); } const cnt = p.length / 3; if (ix) for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off); else for (let i = 0; i < cnt; i++) idx.push(i + off); off += cnt; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); return g;
}
