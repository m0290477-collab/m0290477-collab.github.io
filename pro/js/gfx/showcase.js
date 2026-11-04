// Studio showcase: the player's snake coiled on a lit pedestal (lobby, locker, rarity reveals).
import * as THREE from "../vendor/three.module.min.js?v=ops1";
import { RoomEnvironment } from "../vendor/RoomEnvironment.js?v=ops1";

const AURA_VS = /* glsl */ `
uniform float uT, uK, uScale; uniform vec3 uC1, uC2; attribute vec4 seed; varying vec3 vC; varying float vA;
vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
void main(){
  int k=int(uK+0.5); float t=uT; vec3 q=vec3(0.0); float a=seed.x*6.2831; float sz=0.08; vA=1.0; vC=mix(uC1,uC2,seed.z);
  float ph=fract(t*(0.12+seed.w*0.12)+seed.y); float life=sin(ph*3.14159);
  if(k==1){ float r=1.0+seed.z*2.0; a+=t*0.1; q=vec3(cos(a)*r, ph*4.2, sin(a)*r); q.x+=sin(t*2.0+seed.y*9.0)*0.15; sz=0.05+0.07*seed.w; vC=mix(uC2*1.4,uC1,ph); vA=life; }               // magma: embers rising
  else if(k==2){ float r=2.3+seed.z*1.4; a+=t*(0.08+seed.w*0.08); q=vec3(cos(a)*r, 1.2+sin(a*2.0+seed.y*6.0)*0.6+(seed.y-0.5)*0.8, sin(a)*r); sz=0.03+0.06*seed.w*seed.w; vC=mix(vec3(1.0),uC1,seed.z*0.6); vA=0.55+0.45*sin(t*1.5+seed.y*40.0); }  // cosmos: orbiting starfield
  else if(k==3){ float r=2.6+seed.z*0.6, e=seed.y*2.0-0.4; q=vec3(cos(a)*r*cos(e), 1.2+sin(e)*r*0.8, sin(a)*r*cos(e)); sz=0.06+0.05*seed.w; vC=hue(seed.z+t*0.05)*0.7+0.5; vA=pow(0.5+0.5*sin(t*1.2+seed.w*30.0),4.0); }     // prism: slow rainbow glints
  else if(k==4){ float y=fract(t*0.18+seed.y*0.15)*4.5; float band=exp(-pow((seed.y*4.5-y)*2.2,2.0)); q=vec3(cos(a)*2.8, seed.y*4.5, sin(a)*2.8); sz=0.05; vC=mix(uC1,uC2,0.5+0.5*sin(a*3.0+t)); vA=0.15+band*0.85; }     // hologram: scanning ring
  else if(k==5){ float r=1.4+seed.z*1.6; float f=fract(t*1.6+seed.y); a+=floor(t*1.6+seed.y)*2.4; q=vec3(cos(a)*r, 0.3+seed.w*2.4, sin(a)*r); sz=0.04+0.05*(1.0-f); vC=mix(vec3(1.0),uC1,f); vA=(1.0-f)*(1.0-f); }  // storm: crackling sparks
  else if(k==6){ float r=1.2+seed.z*2.2; a+=t*0.25+ph*2.0; q=vec3(cos(a)*r, ph*3.8, sin(a)*r); sz=0.05+0.06*seed.w; vC=mix(vec3(1.0,0.78,0.3),vec3(1.0,0.95,0.7),seed.z)*1.3; vA=life*0.9; }   // dragon: gold dust spiral
  else if(k==7){ float r=1.0+seed.z*2.2; a+=t*0.05; q=vec3(cos(a)*r+sin(t*0.6+seed.y*7.0)*0.3, ph*3.6, sin(a)*r); sz=0.16+0.18*seed.w; vC=uC1*0.8; vA=life*0.35; }   // phantom: drifting wisps
  else if(k==8){ float f=fract(t*0.35+seed.y*0.999); float r=0.8+f*3.6; q=vec3(cos(a)*r, 0.04, sin(a)*r); sz=0.05; vC=mix(uC1,uC2,step(0.5,fract(seed.y*2.0))); vA=(1.0-f)*smoothstep(0.0,0.1,f)*0.9; }  // pulse: expanding floor rings
  else if(k==9){ float f=fract(t*0.2+seed.y); float r=0.6+(1.0-f)*3.4; a+=f*5.0; q=vec3(cos(a)*r, 0.2+(1.0-f)*2.6*seed.z, sin(a)*r); sz=0.04+0.05*seed.w; vC=mix(uC1,uC2,f); vA=f*(1.0-f)*3.5; }  // void: inward spiral
  else if(k==10){ float r=3.0; float y=1.6+sin(a*3.0+t*0.7)*0.5+seed.y*1.3; q=vec3(cos(a)*r, y, sin(a)*r); sz=0.07; vC=mix(uC1,uC2,seed.y); vA=0.25+0.4*smoothstep(0.0,1.0,seed.y)*(0.6+0.4*sin(a*5.0-t)); }  // aurora: curtain
  else if(k==11){ float r=0.5+seed.z*3.2; q=vec3(cos(a)*r+sin(t*0.5+seed.y*6.0)*0.3, 5.0-ph*5.4, sin(a)*r); sz=0.04+0.05*seed.w; vC=vec3(0.9,0.97,1.0); vA=life*0.9; }   // frost: snowfall
  else if(k==12){ float r=2.0+seed.z*0.5; float b=ph*3.14159; float ca=a+t*0.06; q=vec3(cos(ca)*(r+sin(b)*0.4), sin(b)*1.2+0.2, sin(ca)*(r+sin(b)*0.4)); sz=0.05+0.05*seed.w; vC=mix(uC2,uC1,ph)*1.2; vA=life; }  // solar: prominences
  else if(k==13){ float r=0.6+seed.z*2.4; a+=t*0.12; float y=ph*ph*4.6; q=vec3(cos(a)*r*(1.0-ph*0.5), y, sin(a)*r*(1.0-ph*0.5)); q.x+=sin(t*3.0+seed.y*9.0)*0.12; sz=(0.07+0.08*seed.w)*(1.0-ph*0.6); vC=mix(vec3(1.0,0.85,0.45),uC1,ph)*1.4; vA=life; }  // phoenix: flames
  else { vA=0.0; }
  vec4 mv=modelViewMatrix*vec4(q,1.0); gl_PointSize=sz*uScale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }`;
const AURA_FS = /* glsl */ `varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-0.5)*2.0; float a=exp(-d*d*3.5)*(1.0-d); float c=exp(-d*d*20.0); if(a<=0.0) discard; gl_FragColor=vec4(vC*(a+c*1.2), (a+c)*vA); }`;

export class Studio {
  constructor(r3) {
    this.r3 = r3; const S = (this.scene = new THREE.Scene()); this.t = 0;
    S.fog = new THREE.Fog(0x05070d, 14, 34);
    const bg = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uT: { value: 0 }, uA: { value: new THREE.Color(0x1a2c55) }, uB: { value: new THREE.Color(0x05060b) }, uG: { value: new THREE.Color(0xffb636) } },
      vertexShader: "varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: `uniform float uT; uniform vec3 uA,uB,uG; varying vec3 vD; void main(){ float y=vD.y; vec3 c=mix(uB,uA,smoothstep(-0.2,0.6,y)*0.7); float glow=pow(max(0.0,dot(normalize(vD),normalize(vec3(0.0,0.25,-1.0)))),6.0); c+=uG*glow*0.18;
        float rays=pow(max(0.0,sin(atan(vD.x,-vD.z)*9.0+uT*0.15)),12.0)*smoothstep(-0.1,0.5,y)*0.05; c+=uA*rays; gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}` }));
    this.bg = bg; S.add(bg);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.9, metalness: 0 }) /* tidy1: matte floor, no big cyan/white rim-light glare behind the UI */);
    floor.position.y = -0.62; floor.receiveShadow = true; S.add(floor); this.floor = floor;
    // pedestal: dark metal base, glossy top, emissive gold rings
    const ped = (this.ped = new THREE.Group());
    const baseM = new THREE.MeshPhysicalMaterial({ color: 0x141821, roughness: 0.28, metalness: 0.9, clearcoat: 1, clearcoatRoughness: 0.1 });
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 0.42, 72), baseM); b1.position.y = -0.41; b1.receiveShadow = true; b1.castShadow = true; ped.add(b1);
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.45, 0.22, 72), new THREE.MeshPhysicalMaterial({ color: 0x0d1018, roughness: 0.18, metalness: 0.6, clearcoat: 1 })); b2.position.y = -0.11; b2.receiveShadow = true; ped.add(b2);
    this.ringM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.9, 0.3), toneMapped: false });
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(3.47, 0.035, 8, 160).rotateX(Math.PI / 2), this.ringM); r1.position.y = -0.02; ped.add(r1);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(3.88, 0.05, 8, 160).rotateX(Math.PI / 2), this.ringM); r2.position.y = -0.21; ped.add(r2);
    const ticks = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.05, 96, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(1.6, 1.1, 0.4) } },
      vertexShader: "varying vec2 vU; void main(){ vU=position.xz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform float uT; uniform vec3 uC; varying vec2 vU; void main(){ float a=atan(vU.y,vU.x); float t=step(0.82,fract(a*24.0/6.2831+uT*0.05)); float r=length(vU); float ed=smoothstep(2.7,2.78,r)*smoothstep(3.05,2.97,r); gl_FragColor=vec4(uC, t*ed*0.8); }" }));
    ticks.position.y = 0.005; this.ticks = ticks; ped.add(ticks); S.add(ped);
    // lights: key spot (soft shadow), two coloured rims, low fill
    S.add(new THREE.HemisphereLight(0x9fb8ff, 0x1a1208, 0.35));
    const key = new THREE.SpotLight(0xfff1dc, 75, 40, 0.5, 0.6, 1.6); key.position.set(3.5, 11, 7); key.target.position.set(0, 0.6, 0); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; S.add(key); S.add(key.target); this.key = key;
    this.rimA = new THREE.DirectionalLight(0x3ad8ff, 2.2); this.rimA.position.set(-8, 4, -6); S.add(this.rimA);
    this.rimB = new THREE.DirectionalLight(0xffa13a, 2.0); this.rimB.position.set(8, 3, -5); S.add(this.rimB);
    this.cam = new THREE.PerspectiveCamera(32, 2, 0.1, 120); this.cam.position.set(0, 3.4, 11.5); this.look = new THREE.Vector3(0, 1.45, 0);
    // aura motes
    const n = 160, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), sd = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, d = 1 + Math.random() * 2.6; p[i * 3] = Math.cos(a) * d; p[i * 3 + 1] = 0; p[i * 3 + 2] = Math.sin(a) * d; for (let k = 0; k < 4; k++) sd[i * 4 + k] = Math.random(); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("seed", new THREE.BufferAttribute(sd, 4));
    this.moteU = { uT: { value: 0 }, uScale: r3.ptScale, uC: { value: new THREE.Color(1, 0.8, 0.4) }, uI: { value: 0.6 } };
    this.motes = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "uniform float uT,uScale; attribute vec4 seed; varying float vA; void main(){ vec3 q=position; float ph=fract(uT*(0.08+seed.x*0.1)+seed.y); q.y=ph*4.5; float a=uT*0.3*(seed.z-0.5); q.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*q.xz; vA=sin(ph*3.14159); vec4 mv=modelViewMatrix*vec4(q,1.0); gl_PointSize=(0.05+seed.w*0.08)*uScale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "uniform vec3 uC; uniform float uI; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(uC*2.0, smoothstep(0.5,0.0,d)*vA*uI); }" }));
    this.motes.frustumCulled = false; S.add(this.motes);
    // aaa2: legendary signature aura - one GPU-animated point cloud, motion chosen per legendary in the vertex shader (zero CPU per frame)
    { const N = 260, g2 = new THREE.BufferGeometry(), p2 = new Float32Array(N * 3), s2 = new Float32Array(N * 4); for (let i = 0; i < N * 4; i++) s2[i] = Math.random();
      g2.setAttribute("position", new THREE.BufferAttribute(p2, 3)); g2.setAttribute("seed", new THREE.BufferAttribute(s2, 4)); g2.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
      this.auraU = { uT: { value: 0 }, uK: { value: 0 }, uScale: r3.ptScale, uC1: { value: new THREE.Color(1, 0.5, 0.1) }, uC2: { value: new THREE.Color(1, 0.9, 0.4) }, uI: { value: 0 } };
      this.aura = new THREE.Points(g2, new THREE.ShaderMaterial({ uniforms: this.auraU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, vertexShader: AURA_VS, fragmentShader: AURA_FS }));
      this.aura.frustumCulled = false; this.aura.renderOrder = 5; S.add(this.aura);
      // soft overhead light beam onto the pedestal (legendaries only)
      this.beamU = { uT: { value: 0 }, uC: { value: new THREE.Color(1, 0.8, 0.5) }, uA: { value: 0 } };
      this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 3.3, 12, 40, 1, true).translate(0, 6, 0), new THREE.ShaderMaterial({ uniforms: this.beamU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
        vertexShader: "varying vec2 vU; varying vec3 vN; varying vec3 vV; void main(){ vU=uv; vec4 w=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-w.xyz); gl_Position=projectionMatrix*w; }",
        fragmentShader: "uniform float uT, uA; uniform vec3 uC; varying vec2 vU; varying vec3 vN; varying vec3 vV; void main(){ float edge=pow(1.0-abs(dot(vN,vV)),1.5); float side=1.0-edge; float h=vU.y; float s=0.8+0.2*sin(vU.x*37.7+uT*0.6)*sin(vU.x*13.0-uT*0.4); float a=side*side*smoothstep(1.0,0.35,h)*smoothstep(0.0,0.12,h)*s*uA; gl_FragColor=vec4(uC*a, a); }" }));
      this.beam.position.y = -0.1; this.beam.renderOrder = 4; this.beam.visible = false; S.add(this.beam);
      this.legK = -1; }
    this.view = { x: 0.25, zoom: 1 }; // horizontal framing (fraction of width the pedestal sits right of centre)
    try { const pm = r3.pmrem; this.envRT = pm.fromScene(new RoomEnvironment(), 0.04); S.environment = this.envRT.texture; S.environmentIntensity = 0.5; } catch (_) {}
  }
  setQuality(Q) { // cheap studio surfaces on low/medium (full-screen physical shading is the costliest thing here)
    const want = Q.physical && Q.irid; if (this._phys === want) return; this._phys = want; const old = this.floor.material;
    this.floor.material = want ? new THREE.MeshPhysicalMaterial({ color: 0x0a0d16, roughness: 0.32, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.2 }) : new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.4, metalness: 0.3 }); old.dispose();
  }
  // per-legendary studio look: aura motion + colours, beam, rim lights and reflections tuned to the skin
  setLegend(fx, L) {
    if (this.legK === fx) return; this.legK = fx; const on = fx > 0 && !!L;
    this.auraU.uK.value = (L && L.au) || fx; this.auraU.uI.value = on ? 1 : 0; this.aura.visible = on; this.beam.visible = on; this.beamU.uA.value = on ? 0.16 : 0; this.moteU.uI.value = on ? 0.25 : 0.6;
    if (on) { this.auraU.uC1.value.set(L.tr[0]); this.auraU.uC2.value.set(L.tr[1]); this.beamU.uC.value.set(L.glow).lerp(new THREE.Color(1, 1, 1), 0.45); this.rimA.color.set(L.tr[1]).lerp(new THREE.Color(0x3ad8ff), 0.3); this.rimA.intensity = 2.6; this.rimB.intensity = 2.2; if (this.scene.environmentIntensity !== undefined) this.scene.environmentIntensity = 0.3; this.key.intensity = 68; }
    else { this.rimA.color.set(0x3ad8ff); this.rimA.intensity = 2.2; this.rimB.intensity = 2.0; if (this.scene.environmentIntensity !== undefined) this.scene.environmentIntensity = 0.5; this.key.intensity = 75; }
  }
  setGlow(hex) { const c = new THREE.Color(hex || "#ffb636"); this.ringM.color.copy(c).lerp(new THREE.Color(0xfff1d6), 0.4).multiplyScalar(0.9); this.moteU.uC.value.copy(c); this.ticks.material.uniforms.uC.value.copy(c).multiplyScalar(1.4); this.rimB.color.copy(c).lerp(new THREE.Color(0xffa13a), 0.4); this.bg.material.uniforms.uG.value.copy(c); }
  // coiled pose: head-first points + heights; idle style animates it
  pose(t, idle, r, out, ys) {
    const L = 46, sp = Math.max(0.2, r * 0.5), n = Math.min(170, Math.floor(L / sp));
    const rear = idle === "rear" ? 0.6 + 0.4 * Math.sin(t * 1.3) : 0.85, coilK = idle === "coil" ? 1 + 0.08 * Math.sin(t * 2) : 1, rot = idle === "orbit" ? t * 0.35 : 0;
    const hover = idle === "hover" ? 0.35 + Math.sin(t * 1.6) * 0.25 : 0, neckW = idle === "wave" ? 0.5 : 0.18;
    for (let j = 0; j < n; j++) {
      const d = j * sp; let x, z, y;
      const headLen = 9;
      if (d < headLen) { // neck rises from the coil to a proud head looking at the camera
        const u = d / headLen; const lift = (1 - u) * (1 - u) * 2.0 * rear; const sway = Math.sin(t * 1.4 - u * 3) * neckW * (1 - u);
        x = sway + Math.sin(u * 2.2) * 0.9; z = 1.15 - u * 2.1 + (1 - u) * 0.3; y = lift;
      } else { // flat spiral, outward toward the tail
        const u = (d - headLen) / (L - headLen); const ang = -1.2 + u * Math.PI * 2 * 1.65 + rot; const rad = (1.25 + u * 1.55) * coilK;
        x = Math.cos(ang) * rad; z = Math.sin(ang) * rad; y = 0;
      }
      out[j * 2] = x; out[j * 2 + 1] = z; ys[j] = y + hover;
    }
    return { n, len: (n - 1) * sp };
  }
  update(t, dt) { this.t = t; this.bg.material.uniforms.uT.value = t; this.ticks.material.uniforms.uT.value = t; this.moteU.uT.value = t; this.auraU.uT.value = t; this.beamU.uT.value = t; if (this.aura.visible) this.aura.rotation.y = this.ped.rotation.y * 4; }
  // fit1: lobby framing fits the snake + pedestal into the free box the UI leaves (fit.k widens the FOV, fit.dy moves it in px)
  resize(w, h) { const F = this.fit || (this.fit = { k: 1, dy: 0 }); this.cam.fov = 2 * Math.atan(Math.tan((32 * Math.PI) / 360) * F.k) * 180 / Math.PI; this.cam.aspect = w / h; const shift = this.view.x * w + (F.dx || 0); this.cam.setViewOffset(w, h, -shift, -F.dy, w, h); this.cam.updateProjectionMatrix(); }
  dispose() { if (this.envRT) this.envRT.dispose(); this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
}
