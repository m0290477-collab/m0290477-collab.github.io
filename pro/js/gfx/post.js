// Post-processing stack: MSAA HDR render → GTAO (ultra) → bloom → depth of field (menus, high+) → ACES output →
// cinematic grade (per-world lift/gain/saturation/contrast, vignette, chromatic aberration kick, speed lines,
// letterbox, flash, film grain). Low quality skips the whole stack (CSS vignette instead).
import * as THREE from "../vendor/three.module.min.js?v=feast1";
import { EffectComposer } from "../vendor/EffectComposer.js?v=feast1";
import { RenderPass } from "../vendor/RenderPass.js?v=feast1";
import { UnrealBloomPass } from "../vendor/UnrealBloomPass.js?v=feast1";
import { OutputPass } from "../vendor/OutputPass.js?v=feast1";
import { ShaderPass } from "../vendor/ShaderPass.js?v=feast1";

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1.1 }, uCon: { value: 1.05 }, uVig: { value: 0.38 }, uCA: { value: 0 }, uSpeed: { value: 0 }, uBox: { value: 0 }, uFlash: { value: new THREE.Vector4(0, 0, 0, 0) }, uT: { value: 0 }, uGrain: { value: 0.035 }, uAspect: { value: 2 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec3 uLift, uGain; uniform float uSat, uCon, uVig, uCA, uSpeed, uBox, uT, uGrain, uAspect; uniform vec4 uFlash; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv=vUv; vec2 c=uv-0.5; float r=length(c*vec2(uAspect,1.0));
      vec3 col;
      if(uCA>0.001){ vec2 o=c*uCA*0.018; col=vec3(texture2D(tDiffuse,uv+o).r, texture2D(tDiffuse,uv).g, texture2D(tDiffuse,uv-o).b); }
      else col=texture2D(tDiffuse,uv).rgb;
      if(uSpeed>0.001){ // radial speed lines + zoom smear while boosting
        float a=atan(c.y,c.x); float ln=step(0.86,fract(sin(floor(a*60.0)*91.7)*437.0+uT*3.0)); float m=smoothstep(0.45,0.85,r)*ln*uSpeed;
        vec3 sm=texture2D(tDiffuse,uv-c*0.02*uSpeed).rgb; col=mix(col,sm,0.18*uSpeed*smoothstep(0.35,0.8,r)); col+=vec3(0.9,0.95,1.0)*m*0.07; }
      col=col*uGain+uLift*(1.0-col);
      float l=dot(col,vec3(0.2126,0.7152,0.0722)); col=mix(vec3(l),col,uSat); col=(col-0.5)*uCon+0.5;
      col*=1.0-uVig*smoothstep(0.35,1.05,r);
      col=mix(col,uFlash.rgb,uFlash.a);
      col+=(h(uv*vec2(1920.0,1080.0)+fract(uT)*91.0)-0.5)*uGrain;
      float bx=uBox*0.11; if(uv.y<bx||uv.y>1.0-bx) col=vec3(0.0);
      gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
    }`,
};

export class Post {
  constructor(r3) {
    this.r3 = r3; this.on = false; this.grade = null; this.dofOn = false;
  }
  build(Q, scene, cam) {
    this.dispose(); this.Q = Q; if (!Q.post) { this.on = false; return; }
    const r = this.r3.r, sz = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(sz.x, sz.y, { type: THREE.HalfFloatType, samples: Q.msaa || 0 });
    const C = (this.composer = new EffectComposer(r, rt));
    this.rp = new RenderPass(scene, cam); C.addPass(this.rp);
    if (Q.gtao) { import("../vendor/GTAOPass.js?v=feast1").then((m) => { if (this.composer !== C) return; try { const g = new m.GTAOPass(scene, cam, sz.x, sz.y); g.output = m.GTAOPass.OUTPUT.Default; g.blendIntensity = 0.85; g.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 }); g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 }); C.insertPass(g, 1); this.gtao = g; } catch (e) { console.warn("gtao", e); } }); }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(sz.x * 0.5, sz.y * 0.5), 0.6, 0.55, 0.82); C.addPass(this.bloom);
    if (Q.dof) import("../vendor/BokehPass.js?v=feast1").then((m) => { if (this.composer !== C) return; try { const b = new m.BokehPass(scene, cam, { focus: 12, aperture: 0.0025, maxblur: 0.005 }); b.enabled = this.dofOn; const i = C.passes.indexOf(this.bloom); C.insertPass(b, i + 1); this.bokeh = b; } catch (e) { console.warn("dof", e); } });
    this.out = new OutputPass(); C.addPass(this.out);
    this.grade = new ShaderPass(GradeShader); C.addPass(this.grade);
    this.on = true; this.setSize();
  }
  setScene(scene, cam) { if (!this.on) return; this.rp.scene = scene; this.rp.camera = cam; if (this.gtao) { this.gtao.scene = scene; this.gtao.camera = cam; } if (this.bokeh) { this.bokeh.scene = scene; this.bokeh.camera = cam; const u = this.bokeh.uniforms; u.nearClip.value = cam.near; u.farClip.value = cam.far; u.aspect.value = cam.aspect; } }
  setDof(on, focus) { this.dofOn = on; if (this.bokeh) { this.bokeh.enabled = on; if (focus) this.bokeh.uniforms.focus.value = focus; } if (this.gtao) this.gtao.enabled = !on; }
  setSize() { if (!this.on) return; const r = this.r3.r, sz = r.getDrawingBufferSize(new THREE.Vector2()); this.composer.setPixelRatio(1); this.composer.setSize(sz.x, sz.y); if (this.grade) this.grade.uniforms.uAspect.value = sz.x / Math.max(1, sz.y); }
  render(dt) { this.composer.render(dt); }
  dispose() { if (this.composer) { try { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); for (const p of this.composer.passes) p.dispose && p.dispose(); } catch (_) {} } this.composer = null; this.on = false; this.gtao = null; this.bokeh = null; }
}
