// Studio showcase: the player's snake coiled on a lit pedestal (lobby, locker, rarity reveals).
import * as THREE from "../vendor/three.module.min.js";
import { RoomEnvironment } from "../vendor/RoomEnvironment.js";

export class Studio {
  constructor(r3) {
    this.r3 = r3; const S = (this.scene = new THREE.Scene()); this.t = 0;
    S.fog = new THREE.Fog(0x05070d, 14, 34);
    const bg = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uT: { value: 0 }, uA: { value: new THREE.Color(0x1a2c55) }, uB: { value: new THREE.Color(0x05060b) }, uG: { value: new THREE.Color(0xffb636) } },
      vertexShader: "varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: `uniform float uT; uniform vec3 uA,uB,uG; varying vec3 vD; void main(){ float y=vD.y; vec3 c=mix(uB,uA,smoothstep(-0.2,0.6,y)*0.7); float glow=pow(max(0.0,dot(normalize(vD),normalize(vec3(0.0,0.25,-1.0)))),6.0); c+=uG*glow*0.18;
        float rays=pow(max(0.0,sin(atan(vD.x,-vD.z)*9.0+uT*0.15)),12.0)*smoothstep(-0.1,0.5,y)*0.05; c+=uA*rays; gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}` }));
    this.bg = bg; S.add(bg);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x0a0d16, roughness: 0.32, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
    floor.position.y = -0.62; floor.receiveShadow = true; S.add(floor); this.floor = floor;
    // pedestal: dark metal base, glossy top, emissive gold rings
    const ped = (this.ped = new THREE.Group());
    const baseM = new THREE.MeshPhysicalMaterial({ color: 0x141821, roughness: 0.28, metalness: 0.9, clearcoat: 1, clearcoatRoughness: 0.1 });
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 0.42, 72), baseM); b1.position.y = -0.41; b1.receiveShadow = true; b1.castShadow = true; ped.add(b1);
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.45, 0.22, 72), new THREE.MeshPhysicalMaterial({ color: 0x0d1018, roughness: 0.18, metalness: 0.6, clearcoat: 1 })); b2.position.y = -0.11; b2.receiveShadow = true; ped.add(b2);
    this.ringM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.5), toneMapped: false });
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
    this.cam = new THREE.PerspectiveCamera(32, 2, 0.1, 120); this.cam.position.set(0, 3.4, 11.5); this.look = new THREE.Vector3(0, 1.0, 0);
    // aura motes
    const n = 160, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), sd = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, d = 1 + Math.random() * 2.6; p[i * 3] = Math.cos(a) * d; p[i * 3 + 1] = 0; p[i * 3 + 2] = Math.sin(a) * d; for (let k = 0; k < 4; k++) sd[i * 4 + k] = Math.random(); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("seed", new THREE.BufferAttribute(sd, 4));
    this.moteU = { uT: { value: 0 }, uScale: r3.ptScale, uC: { value: new THREE.Color(1, 0.8, 0.4) }, uI: { value: 0.6 } };
    this.motes = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "uniform float uT,uScale; attribute vec4 seed; varying float vA; void main(){ vec3 q=position; float ph=fract(uT*(0.08+seed.x*0.1)+seed.y); q.y=ph*4.5; float a=uT*0.3*(seed.z-0.5); q.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*q.xz; vA=sin(ph*3.14159); vec4 mv=modelViewMatrix*vec4(q,1.0); gl_PointSize=(0.05+seed.w*0.08)*uScale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }",
      fragmentShader: "uniform vec3 uC; uniform float uI; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(uC*2.0, smoothstep(0.5,0.0,d)*vA*uI); }" }));
    this.motes.frustumCulled = false; S.add(this.motes);
    this.view = { x: 0.25, zoom: 1 }; // horizontal framing (fraction of width the pedestal sits right of centre)
    try { const pm = r3.pmrem; this.envRT = pm.fromScene(new RoomEnvironment(), 0.04); S.environment = this.envRT.texture; S.environmentIntensity = 0.5; } catch (_) {}
  }
  setQuality(Q) { // cheap studio surfaces on low/medium (full-screen physical shading is the costliest thing here)
    const want = Q.physical && Q.irid; if (this._phys === want) return; this._phys = want; const old = this.floor.material;
    this.floor.material = want ? new THREE.MeshPhysicalMaterial({ color: 0x0a0d16, roughness: 0.32, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.2 }) : new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.4, metalness: 0.3 }); old.dispose();
  }
  setGlow(hex) { const c = new THREE.Color(hex || "#ffb636"); this.ringM.color.copy(c).multiplyScalar(2.4); this.moteU.uC.value.copy(c); this.ticks.material.uniforms.uC.value.copy(c).multiplyScalar(1.4); this.rimB.color.copy(c).lerp(new THREE.Color(0xffa13a), 0.4); this.bg.material.uniforms.uG.value.copy(c); }
  // coiled pose: head-first points + heights; idle style animates it
  pose(t, idle, r, out, ys) {
    const L = 46, sp = Math.max(0.2, r * 0.5), n = Math.min(170, Math.floor(L / sp));
    const rear = idle === "rear" ? 0.6 + 0.4 * Math.sin(t * 1.3) : 0.85, coilK = idle === "coil" ? 1 + 0.08 * Math.sin(t * 2) : 1, rot = idle === "orbit" ? t * 0.35 : 0;
    const hover = idle === "hover" ? 0.35 + Math.sin(t * 1.6) * 0.25 : 0, neckW = idle === "wave" ? 0.5 : 0.18;
    for (let j = 0; j < n; j++) {
      const d = j * sp; let x, z, y;
      const headLen = 9;
      if (d < headLen) { // neck rises from the coil to a proud head looking at the camera
        const u = d / headLen; const lift = (1 - u) * (1 - u) * 2.7 * rear; const sway = Math.sin(t * 1.4 - u * 3) * neckW * (1 - u);
        x = sway + Math.sin(u * 2.2) * 0.9; z = 1.15 - u * 2.1 + (1 - u) * 0.3; y = lift;
      } else { // flat spiral, outward toward the tail
        const u = (d - headLen) / (L - headLen); const ang = -1.2 + u * Math.PI * 2 * 1.65 + rot; const rad = (1.25 + u * 1.55) * coilK;
        x = Math.cos(ang) * rad; z = Math.sin(ang) * rad; y = 0;
      }
      out[j * 2] = x; out[j * 2 + 1] = z; ys[j] = y + hover;
    }
    return { n, len: (n - 1) * sp };
  }
  update(t, dt) { this.t = t; this.bg.material.uniforms.uT.value = t; this.ticks.material.uniforms.uT.value = t; this.moteU.uT.value = t; }
  resize(w, h) { this.cam.aspect = w / h; const shift = this.view.x * w; this.cam.setViewOffset(w, h, -shift, 0, w, h); this.cam.updateProjectionMatrix(); }
  dispose() { if (this.envRT) this.envRT.dispose(); this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
}
