// Living world environments: panoramic sky with procedural clouds/aurora/nebula, PBR ground with anti-tiling,
// animated water/lava, swaying instanced foliage, decor, weather (rain/snow/sandstorm/ash/stars), ambient
// creatures, time-of-day lighting. Textures stream per world (lazy WebP) and swap in when ready.
import * as THREE from "../vendor/three.module.min.js?v=feast1";
import { W3D, worldAsset } from "../worlds.js?v=feast1";

const loader = new THREE.TextureLoader();
const texCache = new Map();
export function loadTex(url, srgb = true) {
  if (texCache.has(url)) return texCache.get(url);
  const p = new Promise((res) => { loader.load(url, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)); });
  texCache.set(url, p); return p;
}
export function prefetchWorld(w, lo) { const k = w.id; const out = [loadTex(worldAsset(w, "sky", lo)), loadTex(worldAsset(w, "g", lo)), loadTex(worldAsset(w, "n"), false)]; if (W3D[k].emissiveK) out.push(loadTex(worldAsset(w, "e"), false)); return Promise.all(out); }

const SKY_VS = "varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,0.0)).xyz); vec4 p = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0); gl_Position = p.xyww; }";
const SKY_FS = /* glsl */ `
uniform sampler2D tSky; uniform float uHas, uT, uRot, uClouds, uAurora, uNebula, uNight; uniform vec3 uTint, uFog, uSunDir; varying vec3 vDir;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=vn(p)*a; p=p*2.02+vec2(3.1,1.7); a*=0.5; } return s; }
void main(){
  vec3 d=normalize(vDir); float lon=atan(d.z,d.x)+uRot; float lat=asin(clamp(d.y,-1.0,1.0));
  vec2 uv=vec2(fract(lon/6.2831853+0.5), clamp(0.5+lat/3.14159265*1.0, 0.002, 0.998));
  // seam-safe derivatives: at the panorama wrap fract() jumps 1->0, which made the GPU pick the tiniest mip (a dashed line in the sky)
  vec3 ddx=dFdx(d), ddy=dFdy(d); float q=max(d.x*d.x+d.z*d.z,1e-5); vec2 gu=vec2(d.x*ddx.z-d.z*ddx.x, d.x*ddy.z-d.z*ddy.x)/(q*6.2831853); // analytic d(lon), continuous across the wrap
  vec3 c=uFog; if(uHas>0.5) c=textureGrad(tSky,uv,vec2(gu.x,dFdx(uv.y)),vec2(gu.y,dFdy(uv.y))).rgb;
  c*=uTint;
  float el=d.y;
  if(uClouds>0.0 && el>0.02){ vec2 cp=d.xz/(el+0.18)*1.6+vec2(uT*0.02,uT*0.008); float cl=smoothstep(0.52,0.8,fbm(cp)); c=mix(c, mix(vec3(1.0),uTint*vec3(1.0,0.85,0.75),0.4)*(0.8+0.2*uTint.r), cl*0.55*smoothstep(0.02,0.25,el)*uClouds); }
  if(uAurora>0.0 && el>0.05){ vec2 ap=vec2(lon*2.0, el*3.0); float band=fbm(vec2(lon*3.0+uT*0.05, uT*0.03)); float curtain=smoothstep(0.0,0.4,el)*smoothstep(0.75,0.25,el)*smoothstep(0.35,0.75,band);
    float rays=0.6+0.4*sin(lon*80.0+fbm(vec2(lon*10.0,uT*0.2))*6.0); c+=mix(vec3(0.1,1.0,0.5),vec3(0.6,0.2,1.0),smoothstep(0.2,0.6,el))*curtain*rays*0.9*uAurora; }
  if(uNebula>0.0){ float n=fbm(d.xz*2.0+d.y+vec2(uT*0.01,0.0)); c+=vec3(0.5,0.15,0.7)*pow(n,3.0)*0.35*uNebula; float tw=step(0.997,h21(floor(uv*vec2(900.0,450.0))))*(0.5+0.5*sin(uT*3.0+h21(floor(uv*vec2(900.0,450.0)))*40.0)); c+=vec3(tw)*uNebula; }
  // sun glow
  float sd=max(dot(d,uSunDir),0.0); c+=vec3(1.0,0.85,0.6)*pow(sd,180.0)*1.5*(1.0-uNight)+vec3(1.0,0.7,0.4)*pow(sd,8.0)*0.12*(1.0-uNight);
  // horizon haze into the fog colour (seamless with scene fog)
  c=mix(c,uFog,smoothstep(0.12,-0.05,el)*0.85);
  gl_FragColor=vec4(c,1.0);
  #include <colorspace_fragment>
}`;

// GPU weather / ambient particles: positions wrap around the camera so a fixed count fills the view forever.
const WX_VS = /* glsl */ `
uniform float uT, uScale, uKind, uInt; uniform vec3 uCam; attribute vec4 seed; varying float vA; varying float vK;
void main(){ vec3 p=position; float t=uT; vK=uKind; vA=1.0;
  if(uKind<0.5){ p.x+=sin(t*0.7+seed.x*6.3)*2.0; p.z+=cos(t*0.6+seed.y*6.3)*2.0; p.y=0.6+1.8*seed.z+sin(t*1.3+seed.w*9.0)*0.6; vA=(0.5+0.5*sin(t*2.5+seed.x*40.0))*uInt; }
  else if(uKind<1.5){ p.x+=mod(t*(14.0+seed.w*10.0)+seed.x*80.0,80.0)-40.0; p.z+=sin(t*0.5+seed.y*6.0)*3.0; p.y=0.2+seed.z*seed.z*6.0; vA=0.55*uInt; }
  else if(uKind<2.5){ p.y=16.0-mod(t*(1.3+seed.z)+seed.w*16.0,16.0); p.x+=sin(t+seed.x*6.0)*1.4; p.z+=cos(t*0.8+seed.y*6.0)*1.0; vA=0.9*uInt; }
  else if(uKind<3.5){ p.y=-0.4-seed.z*5.0; vA=(0.4+0.6*abs(sin(t*0.8+seed.x*30.0)))*uInt; }
  else if(uKind<4.5){ p.y=mod(t*(1.0+seed.z*1.5)+seed.w*14.0,14.0); p.x+=sin(t*0.9+seed.x*6.0)*1.5; vA=(1.0-p.y/14.0)*uInt; }
  else { p.y=18.0-mod(t*(22.0+seed.z*8.0)+seed.w*18.0,18.0); p.x+=p.y*0.12; vA=0.5*uInt; }
  p.x=uCam.x+mod(p.x-uCam.x+60.0,120.0)-60.0; p.z=uCam.z+mod(p.z-uCam.z+60.0,120.0)-60.0;
  vec4 mv=modelViewMatrix*vec4(p,1.0); float sz=uKind>4.5?0.12:(uKind>3.5?0.32:(uKind>2.5?0.25:(uKind>1.5?0.32:(uKind>0.5?0.5:0.42))));
  gl_PointSize=sz*uScale/max(1.0,-mv.z); gl_Position=projectionMatrix*mv; }`;
const WX_FS = "uniform vec3 uC; varying float vA; varying float vK; void main(){ vec2 c=gl_PointCoord-0.5; if(vK>4.5){ c.x*=5.0; } else if(vK>0.5&&vK<1.5){ c.y*=3.0; } float d=length(c); float a=smoothstep(0.5,0.0,d); gl_FragColor=vec4(uC*(vK>3.5&&vK<4.5?2.2:1.2), a*vA); }";

const GROUND_VS_PATCH = (sh) => {
  sh.vertexShader = "varying vec3 vWp;\n" + sh.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vWp = (modelMatrix*vec4(transformed,1.0)).xyz;");
};

export class World {
  constructor(r3, W, idx, Q, R) {
    this.r3 = r3; this.W = W; this.idx = idx; this.Q = Q; this.X = W3D[W.id]; this.R0 = R; this.t = 0;
    this.group = new THREE.Group(); this.scaled = []; this.decor = []; this.spinners = []; this.anims = [];
    this.uT = { value: 0 }; this.weatherI = { value: this.X.weather[0] === "clear" ? 0 : 1 };
    this._sky(); this._ground(); this._border(); this._water(); this._decor(); this._foliage(); this._weather(); this._creatures();
    this._load();
  }
  _sky() {
    const X = this.X, W = this.W;
    this.skyU = { tSky: { value: null }, uHas: { value: 0 }, uT: this.uT, uRot: { value: 0 }, uClouds: { value: X.clouds && this.Q.post ? 1 : 0 }, uAurora: { value: X.aurora ? (this.Q.post ? 1 : 0.6) : 0 }, uNebula: { value: X.nebula && this.Q.post ? 1 : 0 }, uNight: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) }, uFog: { value: new THREE.Color(W.fog) }, uSunDir: { value: new THREE.Vector3(-0.4, 0.5, 0.3).normalize() } };
    const m = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(390, 48, 24), m); sky.frustumCulled = false; sky.renderOrder = -10; this.sky = sky; this.group.add(sky);
  }
  _ground() {
    const X = this.X, W = this.W, R = this.R0;
    const mat = this.Q.mat === "lambert" ? new THREE.MeshLambertMaterial({ color: 0xffffff }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: X.rough, metalness: X.id === "neon" ? 0.4 : 0.0, envMapIntensity: X.reflect ? 1.4 : 0.8 });
    mat.color.set(W.ground); // placeholder until the texture streams in
    const self = this; this.groundU = { uT: this.uT, tRefl: { value: null }, uRefl: { value: 0 }, uMat: { value: new THREE.Matrix4() }, uEm: { value: X.emissiveK || 0 }, uKind: { value: this.idx }, uDesat: { value: X.desat || 0 }, uFlat: { value: new THREE.Color(W.calm ? W.calm.ground : W.ground).multiplyScalar(2.6) }, uFlatK: { value: 0.92 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, self.groundU); GROUND_VS_PATCH(sh);
      sh.fragmentShader = "varying vec3 vWp; uniform float uT, uRefl, uEm, uKind, uDesat, uFlatK; uniform vec3 uFlat; uniform sampler2D tRefl; uniform mat4 uMat;\nfloat gh(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }\nfloat gn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y); }\n" + sh.fragmentShader
        .replace("#include <map_fragment>", `#ifdef USE_MAP
          vec4 t1 = texture2D(map, vMapUv); vec4 t2 = texture2D(map, vMapUv*0.37+vec2(0.31,0.17)); float m = gn(vWp.xz*0.035);
          vec4 sampledDiffuseColor = mix(t1, t2, smoothstep(0.35,0.65,m)*0.55); float macro = 0.82+0.36*gn(vWp.xz*0.012); diffuseColor *= sampledDiffuseColor; diffuseColor.rgb *= macro; diffuseColor.rgb = mix(diffuseColor.rgb, uFlat * (0.9 + 0.2 * macro), uFlatK); { float cl = gn(vWp.xz*0.016 + uT*vec2(0.011,0.006)) * 0.65 + gn(vWp.xz*0.041 - uT*vec2(0.006,0.013)) * 0.35; diffuseColor.rgb *= 1.0 - 0.17*smoothstep(0.42,0.78,cl); } diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.299,0.587,0.114))), uDesat);
        #endif`)
        .replace("#include <emissivemap_fragment>", `#ifdef USE_EMISSIVEMAP
          float em = texture2D(emissiveMap, vEmissiveMapUv).r; float pulse = 0.32; totalEmissiveRadiance = emissive*em*em*uEm*pulse;
        #endif`)
        .replace("#include <opaque_fragment>", `if(uRefl>0.0){ vec4 pc = uMat*vec4(vWp,1.0); vec2 ruv = pc.xy/pc.w + normal.xy*0.03; vec3 rc = texture2D(tRefl, ruv).rgb; float fr = 0.25+0.75*pow(1.0-clamp(dot(normal, normalize(vViewPosition)),0.0,1.0),4.0); outgoingLight = mix(outgoingLight, outgoingLight+rc*0.9, uRefl*fr); }
          #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => "ground" + (mat.map ? 1 : 0) + (mat.emissiveMap ? 1 : 0) + (mat.normalMap ? 1 : 0);
    const g = new THREE.Mesh(new THREE.CircleGeometry(R + 150, 128).rotateX(-Math.PI / 2), mat); g.position.y = -0.01; g.receiveShadow = !!this.Q.shadows; g.layers.enable(2);
    this.ground = g; this.groundMat = mat; this.group.add(g);
  }
  _border() {
    const W = this.W, R = this.R0;
    const om = new THREE.Mesh(new THREE.RingGeometry(R, R + 6, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    om.position.y = 0.03; this.group.add(om); this.scaled.push(om);
    const rimC = new THREE.Color(W.rim);
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R, 0.32, 10, 220).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: rimC.clone().multiplyScalar(2.6), toneMapped: false }));
    torus.position.y = 0.18; this.group.add(torus); this.scaled.push(torus);
    const wallMat = new THREE.ShaderMaterial({ uniforms: { uC: { value: new THREE.Color(W.wall) }, uT: this.uT }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: "varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: `uniform vec3 uC; uniform float uT; varying vec2 vU;
        void main(){ vec2 p=vec2(vU.x*900.0, vU.y*8.0); vec2 h=vec2(p.x+mod(floor(p.y),2.0)*0.5, p.y); vec2 f=fract(h)-0.5; float hex=smoothstep(0.42,0.5,max(abs(f.x)*1.15+abs(f.y)*0.6, abs(f.y)*1.2));
        float flow=0.5+0.5*sin(vU.x*1400.0-uT*4.0+vU.y*6.0); float a=(1.0-vU.y)*(0.32+hex*0.5*flow)+pow(1.0-vU.y,6.0)*0.4; gl_FragColor=vec4(uC*1.8,a*0.7); }` });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 3.2, 220, 1, true), wallMat); wall.position.y = 1.6; this.group.add(wall); this.scaled.push(wall);
  }
  _water() {
    const X = this.X, R = this.R0; if (X.water === "none") return;
    const lava = X.water === "lava";
    const geo = new THREE.RingGeometry(R + 9, R + 70, 160, 1).rotateX(-Math.PI / 2);
    let mat;
    if (lava) {
      mat = new THREE.ShaderMaterial({ uniforms: { uT: this.uT }, fog: false, vertexShader: "varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.0); }",
        fragmentShader: `uniform float uT; varying vec3 vW; float h(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); } float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
          float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=n(p)*a; p=p*2.0+1.3; a*=0.5; } return s; }
          void main(){ vec2 p=vW.xz*0.06; float f=fb(p+vec2(uT*0.05,uT*0.03)+fb(p*1.7-uT*0.04)); float crust=smoothstep(0.45,0.62,f); vec3 hot=mix(vec3(1.6,0.35,0.02),vec3(2.4,1.3,0.3),smoothstep(0.2,0.45,f)); vec3 c=mix(hot, vec3(0.06,0.025,0.02), crust); gl_FragColor=vec4(c,1.0);\n#include <colorspace_fragment>\n}` });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(X.waterC), roughness: 0.06, metalness: 0.1, envMapIntensity: 1.6, transparent: true, opacity: 0.92 });
      const U = { uT: this.uT, tRefl: this.groundU.tRefl, uRefl: this.groundU.uRefl, uMat: this.groundU.uMat };
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U); GROUND_VS_PATCH(sh);
        sh.fragmentShader = "varying vec3 vWp; uniform float uT, uRefl; uniform sampler2D tRefl; uniform mat4 uMat;\n" + sh.fragmentShader
          .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
            { vec2 p=vWp.xz; float w1=sin(p.x*0.35+uT*1.3)+sin(p.y*0.29-uT*1.1)+sin((p.x+p.y)*0.6+uT*2.1)*0.5+sin((p.x-p.y)*1.3-uT*2.7)*0.25;
              vec3 wn=normalize(vec3(cos(p.x*0.35+uT*1.3)*0.35+cos((p.x+p.y)*0.6+uT*2.1)*0.3, 6.0, cos(p.y*0.29-uT*1.1)*0.29+cos((p.x-p.y)*1.3-uT*2.7)*0.33));
              normal=normalize(normal+(viewMatrix*vec4(wn.x,0.0,wn.z,0.0)).xyz*1.2); }`)
          .replace("#include <opaque_fragment>", `{ float fr=0.3+0.7*pow(1.0-clamp(dot(normal, normalize(vViewPosition)),0.0,1.0),3.0); if(uRefl>0.0){ vec4 pc=uMat*vec4(vWp,1.0); vec3 rc=texture2D(tRefl, pc.xy/pc.w+normal.xy*0.05).rgb; outgoingLight=mix(outgoingLight, rc, fr*0.75); } diffuseColor.a=mix(0.75,1.0,fr); }
            #include <opaque_fragment>`);
      };
      mat.customProgramCacheKey = () => "water";
    }
    const m = new THREE.Mesh(geo, mat); m.position.y = lava ? -0.25 : -0.2; m.layers.enable(2); this.group.add(m); this.water = m; this.scaled.push(m);
    // shore / bank between the arena and the water
    const bank = new THREE.Mesh(new THREE.RingGeometry(R + 2, R + 11, 160, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: lava ? 0x140a08 : 0x3a3222, roughness: 1 }));
    bank.position.y = 0.0; this.group.add(bank); this.scaled.push(bank);
  }
  _mat(c, o = {}) { if (this.Q.mat === "lambert") return new THREE.MeshLambertMaterial({ color: c, flatShading: !!o.flat, emissive: new THREE.Color(o.e || 0), emissiveIntensity: o.ei ?? 1, transparent: !!o.tr, opacity: o.op ?? 1 }); return new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.85, metalness: o.m ?? 0, flatShading: !!o.flat, emissive: new THREE.Color(o.e || 0), emissiveIntensity: o.ei ?? 1, transparent: !!o.tr, opacity: o.op ?? 1, envMapIntensity: o.env ?? 1 }); }
  _decor() {
    const W = this.W, R = this.R0, M = (c, o) => this._mat(c, o);
    const kits = {
      tree: () => { const g = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.9, 7, 8), M(0x4a2f18)); tr.position.y = 3.5; g.add(tr);
        for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(3.4 - k * 0.55, 1), M([0x2d7a34, 0x3f9a45, 0x24682c, 0x4aa84e][k], { flat: true })); f.position.set(Math.sin(k * 2.1) * 1.2, 7 + k * 1.7, Math.cos(k * 2.1) * 1.2); g.add(f); } g.userData.sway = 1; return g; },
      bush: () => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), M(0x357f3a, { flat: true })); m.position.y = 0.9; m.scale.y = 0.7; return m; },
      rock: () => { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1.8, 1), M(this.idx === 4 ? 0x1e1512 : 0x6c7470, { flat: true, r: 0.95 })); m.position.y = 0.5; m.scale.set(1.4, 0.75, 1.1); return m; },
      ziggurat: () => { const g = new THREE.Group(); for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(14 - k * 2.2, 2.1, 14 - k * 2.2), M(k % 2 ? 0xc9904e : 0xb27838)); b.position.y = 1 + k * 2.1; b.castShadow = true; g.add(b); }
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.7), toneMapped: false })); top.position.y = 13.4; g.add(top); return g; },
      obelisk: () => { const g = new THREE.Group(); const o = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1, 10, 4), M(0xd8b070, { r: 0.6 })); o.position.y = 5; o.rotation.y = Math.PI / 4; g.add(o);
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.4, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2, 0.6), toneMapped: false })); t.position.y = 10.7; t.rotation.y = Math.PI / 4; g.add(t); return g; },
      palm: () => { const g = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 8, 7), M(0x8a6239)); tr.position.y = 4; tr.rotation.z = 0.14; g.add(tr);
        for (let k = 0; k < 7; k++) { const l = new THREE.Mesh(new THREE.ConeGeometry(0.55, 5, 4), M(0x4f9a3a, { flat: true })); l.position.set(Math.cos(k) * 1.8 + 1, 8, Math.sin(k) * 1.8); l.rotation.set(Math.sin(k) * 1.35, 0, -Math.cos(k) * 1.35 + 0.1); g.add(l); } g.userData.sway = 1; return g; },
      pillar: () => { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 7, 12), M(0xe0c08a, { r: 0.7 })); p.position.y = 3.5; g.add(p);
        const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2.4), M(0xcfae78)); c.position.y = 7.2; g.add(c); return g; },
      crystal: () => { const g = new THREE.Group(); const col = this.idx === 5 ? [0xc49bff, 0x5a2cff] : [0x9fe8ff, 0x2a7fb0]; for (let k = 0; k < 4; k++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(1.3 + k * 0.4, 0), new THREE.MeshPhysicalMaterial({ color: col[0], roughness: 0.05, metalness: 0.1, transmission: 0, clearcoat: 1, iridescence: 0.6, emissive: col[1], emissiveIntensity: 0.9, envMapIntensity: 2 }));
        c.scale.y = 2.4; c.position.set((k - 1.5) * 1.4, 2.8 + k * 0.4, (k % 2) * 1.3); c.rotation.z = (k - 1.5) * 0.28; g.add(c); } return g; },
      pine: () => { const g = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.5, 6), M(0x5b4030)); tr.position.y = 1.2; g.add(tr);
        for (let k = 0; k < 4; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(2.8 - k * 0.6, 3, 8), M(k >= 2 ? 0xf2f8ff : 0x2c5d4a, { flat: true })); c.position.y = 3 + k * 1.6; g.add(c); } return g; },
      iceberg: () => { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(3, 1), new THREE.MeshPhysicalMaterial({ color: 0xe8f8ff, roughness: 0.15, clearcoat: 1, flatShading: true, envMapIntensity: 1.6 })); m.position.y = 1; m.scale.set(1.4, 0.9, 1.1); return m; },
      asteroid: () => { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 1), M(0x4a4560, { r: 0.8, flat: true, e: 0x1a0f40, ei: 0.6 })); m.position.y = 4 + Math.random() * 6; m.userData.spin = 0.3 + Math.random() * 0.5; m.userData.bob = 1; return m; },
      pylon: () => { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), M(0x1a1440, { r: 0.35, m: 0.6 })); p.position.y = 4.5; g.add(p);
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9.1, 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.4, 2.8), toneMapped: false })); l.position.set(0, 4.5, 0.42); g.add(l);
        const t = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 0.4, 2.4), toneMapped: false })); t.position.y = 10; t.userData.spin = 1; g.add(t); this.spinners.push(t); return g; },
      tower: () => { const g = new THREE.Group(); const h = 14 + Math.random() * 22; const b = new THREE.Mesh(new THREE.BoxGeometry(5, h, 5), M(0x0d0b1c, { r: 0.25, m: 0.7, e: 0xffffff, ei: 1 })); b.material.emissiveMap = this._windows(); b.position.y = h / 2; g.add(b);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 5.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(Math.random() < 0.5 ? 2.6 : 0.2, 0.4, Math.random() < 0.5 ? 2.6 : 2.2), toneMapped: false })); cap.position.y = h; g.add(cap); g.userData.far = 1; return g; },
      spire: () => { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.ConeGeometry(2.2, 12, 7), M(0x1a100d, { flat: true, r: 0.95 })); s.position.y = 6; g.add(s);
        const v = new THREE.Mesh(new THREE.ConeGeometry(0.6, 12.2, 7), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.7, 0.1), toneMapped: false, transparent: true, opacity: 0.35 })); v.position.y = 6; g.add(v); return g; },
      vent: () => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 1.6, 9), M(0x231512, { flat: true })); c.position.y = 0.8; g.add(c);
        const l = new THREE.Mesh(new THREE.CircleGeometry(1.1, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.9, 0.1), toneMapped: false })); l.position.y = 1.62; g.add(l); g.userData.vent = 1; return g; },
      ringplanet: () => { const g = new THREE.Group(); const p = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 20), M(0x7a4cff, { r: 0.6, e: 0x2a1060, ei: 0.8 })); g.add(p);
        const r = new THREE.Mesh(new THREE.RingGeometry(9, 12.5, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.8, 2.2), side: THREE.DoubleSide, transparent: true, opacity: 0.7, toneMapped: false })); r.rotation.x = 1.2; g.add(r); g.position.y = 18; g.userData.far = 1; g.userData.spin = 0.05; return g; },
    };
    const n = Math.round(48 * this.Q.decor); let s = 99 + this.idx * 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    this.vents = [];
    for (let k = 0; k < n; k++) {
      const kind = W.decor[k % W.decor.length], o = kits[kind](); const a = (k / n) * Math.PI * 2 + rnd() * 0.12;
      const d = o.userData.far ? R + 62 + rnd() * 40 : R + 7 + rnd() * 32 + (k % 3) * 7;
      o.position.x = Math.cos(a) * d; o.position.z = Math.sin(a) * d; o.rotation.y = rnd() * 6.28;
      const sc = 0.8 + rnd() * 0.6; o.scale.multiplyScalar(sc); o.userData.a = a; o.userData.d = d; o.userData.y0 = o.position.y; o.userData.ph = rnd() * 6;
      o.traverse((c) => { if (c.isMesh && this.Q.shadows && !o.userData.far) c.castShadow = true; });
      this.group.add(o); this.decor.push(o); if (o.userData.spin) this.spinners.push(o); if (o.userData.vent) this.vents.push(o);
    }
  }
  _windows() {
    if (this._winTex) return this._winTex; const cv = document.createElement("canvas"); cv.width = 64; cv.height = 128; const g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 64, 128);
    for (let y = 2; y < 128; y += 6) for (let x = 3; x < 64; x += 7) if (Math.random() < 0.45) { g.fillStyle = ["#ff3fd8", "#3fe8ff", "#ffd36a", "#8a7bff"][(Math.random() * 4) | 0]; g.globalAlpha = 0.5 + Math.random() * 0.5; g.fillRect(x, y, 4, 3); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; this._winTex = t; return t;
  }
  _foliage() {
    const X = this.X; if (X.foliage === "none" || !this.Q.foliage) return;
    // blade atlas drawn once on a canvas (no texture download)
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128; const g = cv.getContext("2d");
    const cols = { fern: ["#3f8f3a", "#5fb04a", "#2c6e2c"], reed: ["#c9b06a", "#9a8a4a", "#e0c77a"], frost: ["#e8f8ff", "#bfe6ff", "#ffffff"] }[X.foliage];
    for (let i = 0; i < 14; i++) { const x = 20 + Math.random() * 88, h = 60 + Math.random() * 64, bend = (Math.random() - 0.5) * 30; g.strokeStyle = cols[i % 3]; g.lineWidth = X.foliage === "frost" ? 3 : 4 + Math.random() * 3; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + bend * 0.3, 128 - h * 0.6, x + bend, 128 - h); g.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0); const q2 = quad.clone().rotateY(Math.PI / 2); const pos = [...quad.attributes.position.array, ...q2.attributes.position.array]; const uv = [...quad.attributes.uv.array, ...q2.attributes.uv.array];
    const idx = [...quad.index.array, ...Array.from(q2.index.array, (i) => i + 4)];
    const geo = new THREE.InstancedBufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const N = Math.round(1800 * this.Q.foliage); const off = new Float32Array(N * 4); const R = this.R0;
    let s = 7 + this.idx; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < N; i++) { const inner = i < N * 0.55; const a = rnd() * 6.283; const d = inner ? Math.sqrt(rnd()) * (R - 4) : R + 3 + rnd() * 40; off[i * 4] = Math.cos(a) * d; off[i * 4 + 1] = Math.sin(a) * d; off[i * 4 + 2] = inner ? 0.35 + rnd() * 0.5 : 1.2 + rnd() * 2.2; off[i * 4 + 3] = rnd() * 6.28; }
    geo.setAttribute("off", new THREE.InstancedBufferAttribute(off, 4)); geo.instanceCount = N;
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
    const U = { uT: this.uT };
    mat.onBeforeCompile = (sh) => { sh.uniforms.uT = U.uT; sh.vertexShader = "attribute vec4 off; uniform float uT;\n" + sh.vertexShader.replace("#include <begin_vertex>", `vec3 transformed = position; float c=cos(off.w), sn=sin(off.w); transformed.xz = mat2(c,-sn,sn,c)*transformed.xz; transformed *= off.z;
      float sw = sin(uT*1.6+off.x*0.15+off.y*0.11)*0.18+sin(uT*3.1+off.w*4.0)*0.05; transformed.x += sw*position.y*off.z; transformed.z += sw*0.6*position.y*off.z; transformed.xz += off.xy;`)
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0,1.0,0.0);"); };
    mat.customProgramCacheKey = () => "foliage";
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; this.group.add(m); this.foliage = m;
  }
  _weather() {
    const X = this.X, W = this.W; const kindMap = { firefly: 0, sandstorm: 1, dust: 1, snow: 2, stars: 3, star: 3, ash: 4, ember: 4, rain: 5 };
    const kinds = new Set([W.amb.kind]); for (const k of X.weather) if (k !== "clear") kinds.add(k); if (X.id === "jungle") kinds.add("firefly");
    this.wx = [];
    for (const kind of kinds) {
      const n = Math.round((kind === "rain" ? 900 : kind === "sandstorm" ? 700 : W.amb.n) * this.Q.ambient); if (n <= 0) continue;
      const g = new THREE.BufferGeometry(), ap = new Float32Array(n * 3), as = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) { ap[k * 3] = (Math.random() - 0.5) * 120; ap[k * 3 + 1] = 1; ap[k * 3 + 2] = (Math.random() - 0.5) * 120; for (let q = 0; q < 4; q++) as[k * 4 + q] = Math.random(); }
      g.setAttribute("position", new THREE.BufferAttribute(ap, 3)); g.setAttribute("seed", new THREE.BufferAttribute(as, 4));
      const col = { rain: "#a8d8ff", sandstorm: "#e8c08a", snow: "#ffffff", ash: "#ff7a2a", ember: "#ff8a2a", stars: "#ffffff", star: "#ffffff", firefly: "#d9ff7a", dust: "#ffe0b0" }[kind] || W.amb.color;
      const isWeather = X.weather.includes(kind) && X.weather[0] === "clear"; const firefly = kind === "firefly";
      const U = { uT: this.uT, uScale: this.r3.ptScale, uC: { value: new THREE.Color(col) }, uKind: { value: kindMap[kind] ?? 0 }, uInt: firefly ? (this.nightI = { value: 0.2 }) : isWeather ? this.weatherI : { value: 1 }, uCam: this.r3.camU };
      const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: WX_VS, fragmentShader: WX_FS, transparent: true, depthWrite: false, blending: kind === "sandstorm" || kind === "snow" ? THREE.NormalBlending : THREE.AdditiveBlending });
      const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 6; this.group.add(p); this.wx.push(p);
    }
  }
  _creatures() {
    const X = this.X; if (!this.Q.creatures) return; const kind = X.creatures; const N = kind === "drones" ? 18 : kind === "comets" ? 10 : 26;
    let geo; const col = { birds: 0x1a1a1a, owls: 0xf2f6ff, bats: 0x150806, drones: 0x222233, comets: 0xffffff }[kind];
    if (kind === "comets") { geo = new THREE.PlaneGeometry(1, 0.08); geo.translate(-0.5, 0, 0); }
    else if (kind === "drones") geo = new THREE.BoxGeometry(0.9, 0.25, 0.9);
    else { geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.3, 0, 0, 0.3, -1.3, 0, 0, 0, 0, -0.3, 1.3, 0, 0, 0, 0, 0.3, 0, 0, -0.3, 0.7, 0, 0, 0, 0, 0.3], 3)); geo.computeVertexNormals(); }
    const ig = new THREE.InstancedBufferGeometry(); ig.index = geo.index; for (const k in geo.attributes) ig.setAttribute(k, geo.attributes[k]);
    const sd = new Float32Array(N * 4); for (let i = 0; i < N; i++) { sd[i * 4] = Math.random(); sd[i * 4 + 1] = Math.random(); sd[i * 4 + 2] = Math.random(); sd[i * 4 + 3] = (i / N) * 6.283; }
    ig.setAttribute("sd", new THREE.InstancedBufferAttribute(sd, 4)); ig.instanceCount = N;
    const R = this.R0, glow = kind === "comets" || kind === "drones";
    const mat = new THREE.ShaderMaterial({ uniforms: { uT: this.uT, uR: { value: R } }, side: THREE.DoubleSide, transparent: glow, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !glow, fog: false,
      vertexShader: `uniform float uT, uR; attribute vec4 sd; varying float vF; varying vec3 vP;
        void main(){ vec3 p=position; float kind=${{ birds: 0, owls: 0, bats: 0, drones: 1, comets: 2 }[kind]}.0; vF=p.x;
          if(kind<0.5){ float flap=sin(uT*(9.0+sd.x*5.0)+sd.y*6.0); p.y+=abs(p.x)*flap*0.55; float a=sd.w+uT*(0.06+sd.z*0.05)*(sd.x<0.5?1.0:-1.0); float rad=uR*(0.55+sd.y*0.8);
            vec3 c=vec3(cos(a)*rad, 20.0+sd.z*16.0+sin(uT*0.5+sd.x*9.0)*2.0, sin(a)*rad); float yaw=-a+(sd.x<0.5?0.0:3.14159); float cy=cos(yaw), sy=sin(yaw); p*=1.6+sd.z; p.xz=mat2(cy,-sy,sy,cy)*p.xz; p+=c; }
          else if(kind<1.5){ float a=sd.w+uT*0.12*(sd.x-0.5); float rad=uR*(0.3+sd.y*0.9); p+=vec3(cos(a)*rad, 8.0+sd.z*10.0+sin(uT*1.5+sd.x*20.0)*1.2, sin(a)*rad); }
          else { float a=sd.w; float ph=fract(uT*0.03+sd.x); p.x*=18.0+sd.z*14.0; p.y*=3.0; float rad=300.0; vec3 c=vec3(cos(a)*rad*(1.0-ph*0.4), 80.0+sd.y*90.0-ph*60.0, sin(a)*rad); float yaw=-a+1.2; float cy=cos(yaw), sy=sin(yaw); p.xz=mat2(cy,-sy,sy,cy)*p.xz; p+=c; }
          vP=p; gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0); }`,
      fragmentShader: `varying float vF; varying vec3 vP; void main(){ ${kind === "comets" ? "float a=smoothstep(-1.0,0.0,vF); gl_FragColor=vec4(vec3(0.7,0.85,1.0)*2.0*a, a);" : kind === "drones" ? "gl_FragColor=vec4(vec3(0.2,1.8,2.4)*(0.6+0.4*sin(vP.x*3.0)),0.9);" : `gl_FragColor=vec4(vec3(${new THREE.Color(col).toArray().map((v) => v.toFixed(3)).join(",")}),1.0);`} }`,
    });
    const m = new THREE.Mesh(ig, mat); m.frustumCulled = false; this.group.add(m); this.creatures = m;
  }
  async _load() {
    const W = this.W, X = this.X, lo = this.Q.texLo;
    const [sky, gmap, nmap, emap] = await prefetchWorld(W, lo); if (this.disposed) return;
    const r = this.r3.r;
    if (sky) { sky.wrapS = THREE.RepeatWrapping; sky.anisotropy = 4; this.skyU.tSky.value = sky; this.skyU.uHas.value = 1;
      try { const pm = this.r3.pmrem; const e = pm.fromEquirectangular(sky); this.envRT = e; this.r3.scene.environment = e.texture; this.r3.scene.environmentIntensity = X.reflect ? 1.0 : 0.8; } catch (_) {}
      this.fogColor = sampleHorizon(sky.image, W.fog); this.r3.scene.fog && this.r3.scene.fog.color.set(this.fogColor); this.skyU.uFog.value.set(this.fogColor); }
    const rep = (this.R0 + 150) * 2 / (X.id === "neon" ? 26 : 22); // calm1: larger tiles = lower-frequency ground
    if (gmap) { gmap.wrapS = gmap.wrapT = THREE.RepeatWrapping; gmap.repeat.set(rep, rep); gmap.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy()); this.groundMat.map = gmap; this.groundMat.color.set(0xffffff); }
    if (nmap && this.Q.normalMaps) { nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping; nmap.repeat.set(rep, rep); this.groundMat.normalMap = nmap; this.groundMat.normalScale.set(0.3, 0.3); }
    if (emap) { emap.wrapS = emap.wrapT = THREE.RepeatWrapping; emap.repeat.set(rep, rep); this.groundMat.emissiveMap = emap; this.groundMat.emissive.set(X.id === "volcano" ? 0xff5a10 : X.id === "neon" ? 0xd040ff : 0x9a6cff); }
    this.groundMat.needsUpdate = true; this.r3.warm = this.r3.prewarm ? this.r3.prewarm() : null; if (this.r3.warm) await this.r3.warm; this.ready = true; this.r3.onWorldReady && this.r3.onWorldReady(this.idx);
  }
  fit(R) { const k = R / this.R0; for (const m of this.scaled) m.scale.set(k, 1, k); for (const o of this.decor) { const d = o.userData.d - this.R0 + R; o.position.x = Math.cos(o.userData.a) * d; o.position.z = Math.sin(o.userData.a) * d; } if (this.foliage) this.foliage.scale.set(k, 1, k); }
  // per-frame animation: time of day, weather intensity cycle, decor life
  update(t, dt, r3) {
    this.t = t; this.uT.value = t; const X = this.X, W = this.W;
    // time of day: sun travels; dusk tint + night blue, never too dark to play
    let night = 0, tint = r3._tint || (r3._tint = new THREE.Color());
    if (X.tod) { const ph = (t / X.tod) % 1; const el = Math.sin(ph * Math.PI * 2) * 0.5 + 0.5; // 0 night .. 1 noon
      night = Math.max(0, 0.55 - el) / 0.55; const dusk = Math.max(0, 1 - Math.abs(el - 0.35) / 0.25);
      tint.set(1, 1, 1).lerp(new THREE.Color(X.dusk), dusk * 0.45).lerp(new THREE.Color(X.night), night * 0.6);
      r3.sun.intensity = W.sunI * (0.35 + 0.65 * el); r3.sun.color.set(W.sun).lerp(new THREE.Color(X.dusk), dusk * 0.6).lerp(new THREE.Color(0x9fb8ff), night);
      r3.hemi.intensity = W.hemiI * (0.55 + 0.45 * el); const sa = ph * Math.PI * 2; r3.sunDir.set(-Math.cos(sa) * 0.6, 0.35 + el * 0.6, 0.45).normalize();
    } else { tint.set(1, 1, 1); r3.sun.intensity = W.sunI; r3.sun.color.set(W.sun); r3.hemi.intensity = W.hemiI; r3.sunDir.set(-0.45, 0.75, 0.35).normalize(); }
    this.skyU.uTint.value.copy(tint); this.skyU.uNight.value = night; this.skyU.uSunDir.value.copy(r3.sunDir); this.skyU.uRot.value = t * 0.004;
    if (this.nightI) this.nightI.value = 0.15 + night * 1.1;
    // weather comes and goes (clear ↔ rain / sandstorm) on a slow cycle
    if (X.weather[0] === "clear" && X.weather.length > 1) { const w = Math.sin(t / 70 + this.idx) * 0.5 + 0.5; this.weatherI.value = Math.max(0, (w - 0.35) / 0.65); }
    r3.weatherLevel = this.weatherI.value * (X.weather[0] === "clear" ? 1 : 0.6);
    for (const o of this.spinners) { o.rotation.y += dt * o.userData.spin; }
    for (const o of this.decor) { if (o.userData.sway) o.rotation.z = Math.sin(t * 0.9 + o.userData.ph) * 0.025; if (o.userData.bob) o.position.y = o.userData.y0 + Math.sin(t * 0.6 + o.userData.ph) * 0.6; }
    if (this.vents.length && r3.pMax && Math.random() < 0.5) { const v = this.vents[(Math.random() * this.vents.length) | 0]; r3.emit(v.position.x + (Math.random() - 0.5), 1.8, v.position.z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.6, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6, [1, 0.35, 0.05], 1.6, 0.9, 0.2); }
  }
  dispose() {
    this.disposed = true; if (this.envRT) this.envRT.dispose();
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const k of ["emissiveMap"]) if (o.material[k] && o.material[k] !== this._winTex) o.material[k].dispose(); o.material.dispose(); } });
    if (this._winTex) this._winTex.dispose();
  }
}
// average colour along the panorama horizon → fog colour that melts the ground into the sky
function sampleHorizon(img, fallback) {
  try { const c = document.createElement("canvas"); c.width = 64; c.height = 32; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 64, 32); const d = g.getImageData(0, 14, 64, 4).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace); } catch (_) { return new THREE.Color(fallback); }
}
