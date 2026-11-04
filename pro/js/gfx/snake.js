// Spline-tube snake bodies. One continuous tube per snake, deformed entirely in the vertex shader:
// the simulation's exact body path (bodyPoints) is uploaded each frame into a float spine texture,
// the vertex shader Catmull-Rom interpolates it, builds a moving frame and extrudes an elliptical
// cross-section with a sculpted head, neck, tail taper, lateral undulation, head bob, eat squash and a
// growth pulse running down the body. Fragment stage = PBR (clearcoat/iridescence/sheen) + procedural
// scales + 12 legendary shader effects. All snakes = 1 instanced draw (+1 for ghost/transparent skins).
import * as THREE from "../vendor/three.module.min.js?v=comp1";

export const SW = 176; // spine samples per snake (2 texels each)
export const MAXS = 56; // snake rows (last row reserved for the showcase)
export const SHOW_ROW = MAXS - 1;

const GLSL_COMMON = /* glsl */ `
uniform highp sampler2D uSpine; uniform float uT;
attribute vec3 tb; attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
varying vec3 vSk; varying vec4 vFx; varying vec3 vCol; varying vec3 vGlow; varying float vR; varying vec3 vLocal;
vec4 spA(int i, int row){ return texelFetch(uSpine, ivec2(i*2, row), 0); }
vec4 spB(int i, int row){ return texelFetch(uSpine, ivec2(i*2+1, row), 0); }
vec3 unpackCol(float f){ float v=max(f,0.0); float r=floor(v/65536.0); v-=r*65536.0; float g=floor(v/256.0); float b=v-g*256.0; return vec3(r,g,b)/255.0; }
vec3 cr(vec3 P0, vec3 P1, vec3 P2, vec3 P3, float f){ float f2=f*f, f3=f2*f; return 0.5*((2.0*P1)+(-P0+P2)*f+(2.0*P0-5.0*P1+4.0*P2-P3)*f2+(-P0+3.0*P1-3.0*P2+P3)*f3); }
vec3 crd(vec3 P0, vec3 P1, vec3 P2, vec3 P3, float f){ float f2=f*f; return 0.5*((-P0+P2)+2.0*(2.0*P0-5.0*P1+4.0*P2-P3)*f+3.0*(-P0+3.0*P1-3.0*P2+P3)*f2); }
void snakeVertex(out vec3 pos, out vec3 nrm){
  int row=int(iA.x+0.5); float n=max(iA.y,2.0); float len=iA.z; int N=int(n)-1;
  float s=clamp(tb.x,0.0,1.0); float fi=s*(n-1.0); int i1=min(int(floor(fi)),N-1); float f=fi-float(i1);
  int i0=max(i1-1,0), i2=min(i1+1,N), i3=min(i1+2,N);
  vec4 a=spA(i0,row), b=spA(i1,row), c=spA(i2,row), d=spA(i3,row);
  vec4 a2=spB(i0,row), b2=spB(i1,row), c2=spB(i2,row), d2=spB(i3,row);
  vec3 P0=vec3(a.x,a2.x,a.y), P1=vec3(b.x,b2.x,b.y), P2=vec3(c.x,c2.x,c.y), P3=vec3(d.x,d2.x,d.y);
  vec3 C=cr(P0,P1,P2,P3,f); vec3 T=crd(P0,P1,P2,P3,f);
  if (dot(T,T)<1e-8) T=vec3(1.0,0.0,0.0);
  T=normalize(T); // head -> tail
  vec3 side=normalize(vec3(-T.z,0.0,T.x)+vec3(1e-5,0.0,0.0)); vec3 upv=normalize(cross(T,side)); if(upv.y<0.0) upv=-upv;
  float r=mix(b.z,c.z,f); float dist=s*len; float alpha=iB.w;
  vCol=unpackCol(f<0.5?b.w:c.w);
  float u=s;
  // profile: sculpted head + neck + long tail taper
  // MUST match sim.js: head disc = r*HEAD_K (1.12), body half-width = r*taperAt(u) -> collision == what you see
  float hw=1.0+0.12*exp(-pow(dist/(0.9*r),2.0))-0.06*exp(-pow((dist-2.4*r)/(0.8*r),2.0));
  float taper=1.0-0.74*smoothstep(0.58,1.0,u);
  // growth pulse travelling head -> tail
  float pt=(uT-iB.x)*(16.0+len*0.5); float pulse=0.24*exp(-pow((dist-pt)/(1.7*r),2.0))*step(0.0,pt)*(1.0-smoothstep(len*0.85,len*1.05,pt));
  float sq=iB.y*exp(-dist/(2.6*r));
  float w=r*hw*taper*(1.0+pulse)*(1.0+0.3*sq)*alpha; float h=r*hw*taper*0.8*(1.0+pulse)*(1.0-0.24*sq)*alpha;
  // lateral undulation (visual only, 0.04 r so collisions read true) + head bob
  float boost=iB.z; float wave=mix(5.5,10.0,boost);
  float wv=sin(dist/(max(r,0.5)*1.25)-uT*wave)*r*0.04*smoothstep(0.0,3.2*r,dist);
  C+=side*wv;
  C.y+=sin(uT*3.1+iC.w*6.0)*0.07*r*exp(-dist/(2.2*r));
  float th=tb.y, cs=cos(th), sn=sin(th);
  float hh=sn<0.0?h*0.72:h; // flatter belly
  vec3 base=C+vec3(0.0,r*0.8*alpha,0.0);
  vec3 off=side*(cs*w)+upv*(sn*hh);
  vec3 en=normalize(side*(cs/max(w,1e-3))+upv*(sn/max(hh,1e-3)));
  float k=tb.z;
  if(k<0.0){ // head cap: rounded, slightly flattened snout
    float kk=-k; float ang=kk*1.5707963; vec3 fw=-T;
    base+=fw*(r*hw*sin(ang)*alpha); off*=cos(ang); off.y*=mix(1.0,0.78,kk); en=normalize(mix(en,fw,sin(ang)));
  } else if(k>0.0){ // pointed tail tip
    float ang=k*1.5707963; base+=T*(r*taper*1.0*sin(ang)*alpha); off*=cos(ang); en=normalize(mix(en,T,sin(ang)));
  }
  pos=base+off; nrm=en;
  vSk=vec3(dist,th,k); vR=max(r,0.05); vFx=vec4(iA.w,boost,alpha,iC.w); vGlow=iC.rgb; vLocal=vec3(dist,th,sq);
}
`;

const GLSL_FRAG_COMMON = /* glsl */ `
uniform float uT; uniform float uGhost; uniform float uSheen;
varying vec3 vSk; varying vec4 vFx; varying vec3 vCol; varying vec3 vGlow; varying float vR; varying vec3 vLocal;
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=vn(p)*a; p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
float vor(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8.0,d2=8.0; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 o=vec2(h21(i+g),h21(i+g+17.1)); vec2 r=g+o-f; float d=dot(r,r); if(d<d1){d2=d1;d1=d;} else if(d<d2) d2=d; } return sqrt(d2)-sqrt(d1); }
vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
`;

// fragment injection: base colour/material + bump + emission
const FRAG_COLOR = /* glsl */ `
  int fx=int(vFx.x+0.5); float boost=vFx.y;
  vec2 q=vec2(vSk.x, vSk.y*vR); // body-space (along, around) in world units
  vec3 base=vCol; float sRough=0.26, sMetal=0.04, sIrid=0.12, sCC=1.0, sAlpha=1.0, bumpK=0.75;
  // procedural scales (offset rows of domed plates), dorsal darkening, lighter belly
  vec2 sc=vec2(vSk.x/(vR*0.5), vSk.y*1.4323);
  sc.y+=mod(floor(sc.x),2.0)*0.5; vec2 cl=fract(sc)-0.5; float sd=length(cl*vec2(1.0,1.25));
  float sh=smoothstep(0.62,0.12,sd);
  float up=sin(vSk.y);
  base*=mix(1.0,0.84,smoothstep(0.55,1.0,up)); base=mix(base, base*1.25+0.06, smoothstep(-0.2,-0.9,up));
  base*=0.84+0.2*sh;
#ifdef SNAKE_FX
  if(fx==1){ // magma: basalt plates + flowing molten cracks
    vec2 p=q*0.75+vec2(-uT*0.9,0.0); float e=vor(p); float n=fbm(q*0.5);
    base=mix(vec3(0.045,0.02,0.015),vec3(0.16,0.07,0.04),n); sRough=0.82; sCC=0.2; sIrid=0.0; bumpK=1.6;
  } else if(fx==2){ // cosmos
    float n=fbm(q*0.35+vec2(uT*0.12,0.0)); base=mix(vec3(0.004,0.002,0.016),vec3(0.05,0.012,0.12),n*n); sRough=0.3; sIrid=0.0; sCC=0.8; bumpK=0.0;
  } else if(fx==3){ // prism diamond
    base=vec3(0.1,0.17,0.24); sRough=0.02; sMetal=0.65; sIrid=1.0; bumpK=0.0;
  } else if(fx==4){ // hologram
    base=vec3(0.04,0.05,0.07); sRough=0.08; sIrid=1.0; sMetal=0.3; bumpK=0.3;
  } else if(fx==5){ // storm caller
    base=mix(vec3(0.02,0.035,0.09),vec3(0.05,0.1,0.22),fbm(q*0.4)); sRough=0.28; sIrid=0.2;
  } else if(fx==6){ // golden dragon
    base=mix(vec3(0.78,0.46,0.1),vec3(0.95,0.74,0.34),sh); base*=mix(0.4,1.0,smoothstep(0.62,0.3,sd)); sMetal=1.0; sRough=0.22+0.25*(1.0-sh); sIrid=0.1; bumpK=1.3;
  } else if(fx==7){ // phantom
    base=vec3(0.16,0.32,0.42); sRough=0.1; sIrid=0.6;
  } else if(fx==8){ // neon pulse
    base=vec3(0.012,0.01,0.018); sRough=0.18; sIrid=0.0; sCC=0.6; bumpK=0.6;
  } else if(fx==9){ // void
    base=vec3(0.008,0.006,0.014); sRough=0.55; sCC=0.6; sIrid=0.4;
  } else if(fx==10){ // aurora
    base=mix(vec3(0.004,0.02,0.03),vec3(0.03,0.008,0.06),fbm(q*0.3+uT*0.1)); sRough=0.2; sIrid=0.25; sCC=0.7;
  } else if(fx==11){ // frost king
    base=vec3(0.72,0.88,1.0)*mix(0.8,1.05,sh); sRough=0.06; sMetal=0.25; sIrid=0.7; bumpK=1.4;
  } else if(fx==12){ // solar flare
    base=vec3(0.55,0.16,0.02); sRough=0.45; sCC=0.4; sIrid=0.0;
  } else if(fx==13){ // phoenix: layered flame feathers, dark ember roots
    float fe=abs(fract(q.x*0.55+abs(cos(vSk.y))*0.9)-0.5); base=mix(vec3(0.09,0.01,0.0),vec3(0.55,0.08,0.01),smoothstep(0.5,0.15,fe)); sRough=0.42; sCC=0.5; sIrid=0.1; bumpK=0.4;
  } else if(fx==14){ base=mix(vCol,vCol*1.15+0.03,sh); sRough=0.1; sCC=1.0; sMetal=0.1; sIrid=0.15; bumpK=1.2;      // babylon: glazed lapis tiles
  } else if(fx==15){ sRough=0.08; sCC=1.0; sIrid=0.35; bumpK=0.5;                                                     // tigris: wet river sheen
  } else if(fx==16){ base*=0.9+0.15*sin(q.x*3.0)*sin(vSk.y*6.0); sMetal=0.45; sRough=0.3; bumpK=1.4;                   // date palm: woven gold
  } else if(fx==17){ base*=0.9+0.2*fbm(q*2.0); sRough=0.7; sCC=0.3; sIrid=0.0; bumpK=1.6;                             // desert viper: rough sand scales
  } else if(fx==18){ sRough=0.25; sCC=0.9; sIrid=0.3;                                                                  // midnight
  } else if(fx==19){ sRough=0.04; sCC=1.0; sIrid=0.25; bumpK=0.4;                                                      // cherry: candy gloss
  } else if(fx==20){ sRough=0.1; sCC=1.0; bumpK=0.5;                                                                   // mango
  } else if(fx==21){ base=mix(base,vec3(1.0),0.1*fbm(q*3.0)); sRough=0.65; sCC=0.2; sIrid=0.1; bumpK=0.6;              // arctic fox: soft frost
  } else if(fx==22){ float gd=step(0.3,vCol.r-vCol.b); sMetal=mix(0.15,1.0,gd); sRough=mix(0.4,0.2,gd); bumpK=1.3;      // king cobra: gold bands
  } else if(fx==23){ sRough=0.12; sCC=1.0; sIrid=0.3;                                                                  // ocean deep
  } else if(fx==24){ base*=0.55; sRough=0.15; sMetal=0.3; sIrid=0.5;                                                   // cyber
  } else if(fx==25){ sMetal=0.85; sRough=0.2; bumpK=1.3; sIrid=0.1;                                                    // emperor: gold and crimson
  } else if(fx==26){ base*=0.85; sRough=0.14; sCC=1.0; sIrid=0.2; bumpK=1.0;                                           // jade dragon
  } else if(fx==27){ base*=0.85+0.25*fbm(q*1.2+vec2(uT*0.6,0.0)); sRough=0.75; sCC=0.2; sIrid=0.0; bumpK=1.5;          // sandstorm: drifting grains
  } else if(fx==28){ float gd=step(0.3,vCol.r-vCol.b); base=mix(vCol,vCol*1.15+0.03,sh); sMetal=mix(0.1,1.0,gd); sRough=mix(0.12,0.2,gd); sCC=1.0; bumpK=1.3; // lapis lion: glazed lapis, gold mane bands
  } else if(fx==29){ sRough=0.06; sCC=1.0; sMetal=0.2; bumpK=0.7;                                                     // ronin: lacquered armour plates
  } else if(fx==30){ sRough=0.05; sCC=1.0; sIrid=0.35; bumpK=0.5;                                                     // koi: pearl scales
  } else if(fx==31){ float cr=fbm(q*0.9); float seam=smoothstep(0.05,0.0,abs(cr-0.5)); base=mix(vec3(0.035,0.025,0.04),vec3(0.6,0.15,0.02),seam); sRough=0.6; sCC=0.3; bumpK=1.6; // titan: obsidian with lava seams
  }
#endif
  diffuseColor.rgb=base;
`;
const FRAG_BUMP = /* glsl */ `
  { // derivative bump from the scale height field (three.js bump technique, no tangents needed)
    float hgt=sh*0.05*vR*bumpK*(1.0-smoothstep(0.15,0.5,length(fwidth(sc)))); // aaa2: fade sub-pixel scales (no sparkle noise)
#ifdef SNAKE_FX
    if(fx==3){ hgt=abs(fract(q.x*0.9+q.y*0.6)-0.5)*0.06*vR+abs(fract(q.x*0.9-q.y*0.6)-0.5)*0.06*vR; }
#endif
    vec3 dpx=dFdx(-vViewPosition), dpy=dFdy(-vViewPosition); float hx=dFdx(hgt), hy=dFdy(hgt);
    vec3 r1=cross(dpy,normal), r2=cross(normal,dpx); float det=dot(dpx,r1);
    vec3 grad=sign(det)*(hx*r1+hy*r2); normal=normalize(abs(det)*normal-grad);
  }
`;
const FRAG_EMIT = /* glsl */ `
  {
    vec3 V=normalize(vViewPosition); float fres=pow(1.0-clamp(dot(normal,V),0.0,1.0),3.0);
    vec3 em=vec3(0.0);
#ifdef SNAKE_FX
    if(fx==1){ vec2 p=q*0.75+vec2(-uT*0.9,0.0); float e=vor(p); float crack=smoothstep(0.11,0.0,e); float hot=0.6+0.4*sin(uT*3.0+q.x*0.7);
      em=mix(vec3(1.0,0.16,0.0),vec3(1.0,0.5,0.06),crack)*crack*(1.9*hot)+vec3(1.0,0.25,0.02)*fres*0.22; }
    else if(fx==2){ vec2 g=q*2.4+V.xy*vR*0.6+vec2(uT*0.5,0.0); vec2 ci=floor(g); float st=step(0.9,h21(ci))*smoothstep(0.42,0.0,length(fract(g)-0.5))*(0.55+0.45*sin(uT*1.5+h21(ci+3.0)*30.0));
      vec2 g2=q*5.0+vec2(uT*0.9,0.0); float st2=step(0.96,h21(floor(g2)))*smoothstep(0.3,0.0,length(fract(g2)-0.5));
      float n=fbm(q*0.35+vec2(uT*0.12,0.0)); em=mix(vec3(0.4,0.05,0.75),vec3(0.05,0.25,0.7),n)*0.55*smoothstep(0.45,0.85,n)+vec3(1.0,0.95,1.0)*(st*2.6+st2*1.2)+vec3(0.42,0.12,0.9)*fres*0.32; }
    else if(fx==3){ vec2 g=q*3.0; float gl=step(0.965,h21(floor(g)))*smoothstep(0.35,0.0,length(fract(g)-0.5))*pow(0.5+0.5*sin(uT*1.6+h21(floor(g)+5.0)*40.0),3.0); em=vec3(1.0)*gl*3.0+vec3(0.55,0.85,1.0)*pow(fres,1.5)*0.8+hue(fres*2.2+vSk.x*0.05+uT*0.1)*fres*0.75+vec3(0.35,0.55,0.7)*pow(abs(sin(q.x*0.9+q.y*0.6+uT*0.3)),12.0)*0.5; }
    else if(fx==4){ float scan=smoothstep(0.35,0.5,abs(fract(vSk.x*0.6-uT*0.5)-0.5))*0.14; em=(hue(fres*1.6+vSk.x*0.04+uT*0.12)*0.6+0.4)*(0.18+fres*1.3)+vec3(0.4,1.0,1.0)*scan*(0.4+fres); }
    else if(fx==5){ float l1=abs(fbm(q*vec2(0.35,1.1)+vec2(uT*3.1,uT*1.3))-0.5); float l2=abs(fbm(q*vec2(0.5,1.6)-vec2(uT*2.3,-uT*1.9)+7.0)-0.5);
      float bolt=smoothstep(0.03,0.0,l1)+smoothstep(0.022,0.0,l2)*0.8; float fl=0.85+0.15*sin(uT*4.0); em=vec3(0.55,0.85,1.0)*bolt*4.0*fl+vec3(0.2,0.55,1.0)*fres*0.9; }
    else if(fx==6){ em=vec3(1.0,0.45,0.08)*pow(fres,1.5)*0.9+vec3(1.0,0.6,0.1)*smoothstep(0.55,0.62,sd)*0.12; }
    else if(fx==7){ float w=fbm(q*0.5+vec2(uT*0.8,0.0)); em=vec3(0.45,0.9,1.0)*(fres*1.6+smoothstep(0.55,0.8,w)*0.5); }
    else if(fx==8){ float band=pow(0.5+0.5*sin(vSk.x*1.25-uT*5.0),14.0); float line=smoothstep(0.12,0.0,abs(cos(vSk.y)))*0.9; vec3 c=mix(vec3(1.0,0.17,0.84),vec3(0.0,0.9,1.0),0.5+0.5*sin(vSk.x*0.18+uT*1.5));
      em=c*(band*2.2+line*1.1+fres*0.6); }
    else if(fx==9){ float fl=fbm(q*0.6+vec2(uT*1.6,-uT*0.7)); em=vec3(0.6,0.15,1.0)*pow(fres,1.6)*(1.0+fl*2.4)+vec3(1.0,0.2,0.9)*smoothstep(0.7,0.95,fl)*0.5; }
    else if(fx==10){ float b=fbm(vec2(vSk.x*0.12-uT*0.6, vSk.y*0.8)); float bands=smoothstep(0.35,0.75,b); em=mix(vec3(0.0,1.0,0.55),vec3(0.5,0.15,1.0),fbm(q*0.2+uT*0.2))*bands*1.2+vec3(0.1,0.8,0.6)*pow(fres,2.0)*0.35; }
    else if(fx==11){ vec2 g=q*4.0; float sp=step(0.95,h21(floor(g)))*smoothstep(0.3,0.0,length(fract(g)-0.5))*pow(0.5+0.5*sin(uT*1.3+h21(floor(g)+9.0)*40.0),3.0); em=vec3(0.85,0.95,1.0)*sp*2.8+vec3(0.5,0.8,1.0)*fres*0.9; }
    else if(fx==13){ float fe=abs(fract(q.x*0.55+abs(cos(vSk.y))*0.9)-0.5); float fl=fbm(vec2(q.x*0.35+uT*1.8, q.y*0.9)); float tip=smoothstep(0.32,0.05,fe);
      em=mix(vec3(1.0,0.2,0.0),vec3(1.0,0.62,0.12),fl)*(tip*(0.5+fl*0.9))+vec3(1.0,0.35,0.04)*pow(fres,1.6)*0.45; }
    else if(fx==12){ float pl=fbm(q*0.45+vec2(-uT*1.4,uT*0.5)); float pl2=fbm(q*0.9-vec2(uT*2.0,0.0)); em=mix(vec3(1.0,0.2,0.0),vec3(1.0,0.6,0.1),pl)*(0.18+smoothstep(0.5,0.8,pl2)*0.95)+vec3(1.0,0.42,0.04)*pow(fres,1.6)*0.35; }
    else if(fx==14){ em=vec3(1.0,0.72,0.22)*smoothstep(0.57,0.66,sd)*0.22+vec3(0.2,0.4,1.0)*pow(fres,1.8)*0.35; }
    else if(fx==15){ float w=fbm(q*vec2(0.4,1.2)+vec2(-uT*1.2,0.0)); em=vec3(0.3,1.0,0.9)*smoothstep(0.55,0.8,w)*0.6+vec3(0.4,1.0,0.95)*pow(fres,1.8)*0.5; }
    else if(fx==16){ em=vec3(1.0,0.75,0.35)*pow(0.5+0.5*sin(q.x*0.6-uT*1.2),12.0)*0.5+vec3(1.0,0.7,0.3)*pow(fres,1.8)*0.35; }
    else if(fx==17){ em=vec3(1.0,0.75,0.4)*pow(fres,1.8)*0.4+vec3(1.0,0.85,0.55)*smoothstep(0.75,0.95,fbm(q*0.8+vec2(uT*0.8,0.0)))*0.25; }
    else if(fx==18){ vec2 g=q*3.0+vec2(uT*0.3,0.0); float st=step(0.93,h21(floor(g)))*smoothstep(0.4,0.0,length(fract(g)-0.5))*(0.6+0.4*sin(uT*1.2+h21(floor(g)+3.0)*30.0)); em=vec3(0.85,0.9,1.0)*st*2.2+vec3(0.35,0.45,1.0)*pow(fres,1.6)*0.55; }
    else if(fx==19){ em=vec3(1.0,0.3,0.4)*pow(fres,2.0)*0.6+vCol*0.08+vec3(1.0,0.75,0.8)*pow(0.5+0.5*sin(q.x*0.9-uT*1.4+cos(vSk.y)*1.5),18.0)*0.45; }
    else if(fx==20){ float jw=0.5+0.5*sin(q.x*0.35-uT*1.1); em=vec3(1.0,0.6,0.1)*pow(fres,1.6)*0.45+vCol*(0.08+0.12*jw); }
    else if(fx==21){ vec2 g=q*4.0; float sp=step(0.955,h21(floor(g)))*smoothstep(0.3,0.0,length(fract(g)-0.5))*pow(0.5+0.5*sin(uT*1.1+h21(floor(g)+9.0)*40.0),3.0); em=vec3(0.9,0.97,1.0)*sp*2.0+vec3(0.7,0.85,1.0)*pow(fres,1.8)*0.5; }
    else if(fx==22){ float gd=step(0.3,vCol.r-vCol.b); em=vec3(1.0,0.7,0.15)*pow(fres,1.5)*(0.25+gd*0.6)+vec3(1.0,0.85,0.4)*gd*pow(0.5+0.5*sin(q.x*0.45-uT*1.6),10.0)*0.55; }
    else if(fx==23){ float cs=smoothstep(0.08,0.0,vor(q*0.9+vec2(uT*0.5,uT*0.2))); em=vec3(0.4,0.9,1.0)*cs*0.7+vec3(0.2,0.6,1.0)*pow(fres,1.7)*0.5; }
    else if(fx==24){ vec2 g=fract(q*vec2(0.8,1.6))-0.5; float ln=smoothstep(0.06,0.0,min(abs(g.x),abs(g.y))); float run=pow(0.5+0.5*sin(vSk.x*0.5-uT*2.0),6.0); em=vCol*ln*(0.35+run*1.2)+hue(vSk.x*0.03+uT*0.08)*pow(fres,1.6)*0.5; }
    else if(fx==25){ em=vec3(1.0,0.75,0.25)*pow(fres,1.4)*0.6+vec3(1.0,0.9,0.6)*pow(0.5+0.5*sin(q.x*0.5-uT*1.0),14.0)*0.5; }
    else if(fx==26){ float n=fbm(q*0.6+vec2(uT*0.3,0.0)); em=vec3(0.1,0.9,0.5)*smoothstep(0.45,0.8,n)*0.35+vec3(1.0,0.8,0.3)*smoothstep(0.52,0.62,sd)*0.35+vec3(0.3,1.0,0.7)*pow(fres,1.8)*0.45; }
    else if(fx==27){ float s2=fbm(q*vec2(0.6,1.5)+vec2(uT*2.0,0.0)); em=vec3(1.0,0.8,0.5)*smoothstep(0.6,0.85,s2)*0.45+vec3(1.0,0.7,0.35)*pow(fres,1.8)*0.35; }
    else if(fx==28){ float gd=step(0.3,vCol.r-vCol.b); em=vec3(1.0,0.78,0.3)*gd*pow(0.5+0.5*sin(q.x*0.45-uT*1.5),10.0)*0.6+vec3(0.25,0.45,1.0)*pow(fres,1.8)*0.4; }
    else if(fx==29){ em=vec3(1.0,0.15,0.2)*pow(fres,2.0)*0.55+vec3(1.0,0.4,0.4)*pow(0.5+0.5*sin(vSk.x*0.6-uT*3.0),20.0)*smoothstep(0.2,0.0,abs(cos(vSk.y)))*0.8; }
    else if(fx==30){ float w=0.5+0.5*sin(q.x*0.5-uT*1.2+cos(vSk.y)*2.0); em=vec3(1.0,0.7,0.5)*pow(fres,1.8)*0.4+vec3(1.0,0.95,0.9)*pow(w,14.0)*0.4; }
    else if(fx==31){ float cr=fbm(q*0.9); float fl=fbm(q*0.5+vec2(uT*0.8,0.0)); em=mix(vec3(1.0,0.25,0.0),vec3(1.0,0.7,0.1),fl)*smoothstep(0.05,0.0,abs(cr-0.5))*(0.9+fl*1.2)+vec3(1.0,0.35,0.05)*pow(fres,1.6)*0.35; }
    else
#endif
    { em=vCol*fres*0.2+vec3(0.55,0.65,0.8)*pow(fres,2.2)*0.14; }
    // anim1: slow living sheen gliding down every body (calm / reduce motion -> uSheen 0)
    em+=mix(vCol,vec3(1.0),0.35)*uSheen*pow(0.5+0.5*sin(vSk.x*0.28-uT*1.8),16.0)*(0.22+fres*0.5);
    // boost: energy streaks racing down the body; team/legend tint on the rim
    em+=mix(vCol+0.15,vec3(1.0),0.25)*boost*pow(0.5+0.5*sin(vSk.x*0.85-uT*24.0),6.0)*1.6;
    em+=vGlow*fres*1.2;
    totalEmissiveRadiance+=em;
#ifdef SNAKE_FX
    if(fx==7){ sAlpha=0.16+0.84*fres; }
#endif
  }
`;

function patch(mat, isDepth, uniforms, ghost, fxOn) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSpine = uniforms.uSpine; sh.uniforms.uT = uniforms.uT; sh.uniforms.uSheen = uniforms.uSheen || { value: 0 }; sh.uniforms.uGhost = { value: ghost ? 1 : 0 };
    sh.vertexShader = GLSL_COMMON + sh.vertexShader;
    if (isDepth) {
      sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", "vec3 snP, snN; snakeVertex(snP, snN); vec3 transformed = snP;");
    } else {
      sh.vertexShader = sh.vertexShader.replace("#include <beginnormal_vertex>", "vec3 snP, objectNormal; snakeVertex(snP, objectNormal);")
        .replace("#include <begin_vertex>", "vec3 transformed = snP;");
      let fs = (fxOn ? "#define SNAKE_FX\n" : "") + GLSL_FRAG_COMMON + sh.fragmentShader;
      fs = fs.replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_COLOR)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = sRough;")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n metalnessFactor = sMetal;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + FRAG_BUMP)
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + FRAG_EMIT)
        .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n#ifdef USE_IRIDESCENCE\n material.iridescence = sIrid;\n#endif\n#ifdef USE_CLEARCOAT\n material.clearcoat = sCC;\n#endif\n");
      if (ghost) fs = fs.replace("#include <opaque_fragment>", "diffuseColor.a = sAlpha;\n#include <opaque_fragment>");
      sh.fragmentShader = fs;
    }
  };
  mat.customProgramCacheKey = () => (isDepth ? "snakeD" : "snake" + (ghost ? "G" : "") + (fxOn ? "F" : "") + (mat.isMeshPhysicalMaterial ? "P" : mat.isMeshLambertMaterial ? "L" : "S"));
}

// Tube template: head cap rings + body rings + tail cap rings, each with (radial+1) vertices.
export function tubeGeometry(rings, radial) {
  const HC = 6, TC = 4, total = HC + rings + TC, cols = radial + 1;
  const tb = new Float32Array(total * cols * 3); const pos = new Float32Array(total * cols * 3);
  let v = 0;
  for (let r = 0; r < total; r++) {
    let s = 0, k = 0;
    if (r < HC) { s = 0; k = -(1 - r / HC); } // -1 tip .. near 0
    else if (r < HC + rings) { s = (r - HC) / (rings - 1); s = Math.pow(s, 1.08); } // a bit denser near the head
    else { s = 1; k = (r - HC - rings + 1) / TC; }
    for (let c = 0; c < cols; c++) { const th = (c / radial) * Math.PI * 2; tb[v * 3] = s; tb[v * 3 + 1] = th; tb[v * 3 + 2] = k; v++; }
  }
  const idx = [];
  for (let r = 0; r < total - 1; r++) for (let c = 0; c < radial; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1; idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("tb", new THREE.BufferAttribute(tb, 3)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

export class SnakeSystem {
  constructor(renderer, Q) {
    this.r3 = renderer; this.data = new Float32Array(SW * 2 * MAXS * 4);
    this.tex = new THREE.DataTexture(this.data, SW * 2, MAXS, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter; this.tex.generateMipmaps = false; this.tex.needsUpdate = true;
    this.uniforms = { uSpine: { value: this.tex }, uT: { value: 0 }, uSheen: { value: 1 } };
    this.build(Q);
  }
  build(Q) {
    this.dispose(true); this.Q = Q;
    this.geo = tubeGeometry(Q.rings, Q.radial);
    const phys0 = Q.physical && Q.mat !== "standard";
    const mk = (ghost, fxOn, studio) => {
      const phys = studio ? Q.mat !== "lambert" : phys0; // aaa2: the showcase snake always gets the full clearcoat/sheen/iridescence material (one snake, menus only)
      const m = Q.mat === "lambert" ? new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: ghost }) : phys ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: Q.irid || studio ? 0.2 : 0, iridescenceIOR: 1.6, sheen: Q.irid && !studio ? 0.12 : 0, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.5, 0.6, 0.7), envMapIntensity: 1.15, transparent: ghost, depthWrite: true })
        : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.05, envMapIntensity: 1.2, transparent: ghost });
      patch(m, false, this.uniforms, ghost, fxOn); return m;
    };
    this.mat = mk(false, false); this.matF = mk(false, true); this.matG = mk(true, true);
    this.matS = mk(false, false, true); this.matSF = mk(false, true, true); this.matSG = mk(true, true, true);
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); patch(this.depth, true, this.uniforms, false, false);
    // instance groups share the template buffers: plain skins, legendary shader skins, ghost (transparent) skins, + showcase copies
    const group = (n, mat, shadow) => {
      const g = new THREE.InstancedBufferGeometry(); g.index = this.geo.index; g.setAttribute("position", this.geo.attributes.position); g.setAttribute("tb", this.geo.attributes.tb);
      const A = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage), B = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage), C = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("iA", A); g.setAttribute("iB", B); g.setAttribute("iC", C); g.boundingSphere = this.geo.boundingSphere; g.instanceCount = 0;
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; if (shadow) { m.customDepthMaterial = this.depth; m.castShadow = !!Q.shadows; m.receiveShadow = !!Q.shadows; }
      return { g, A, B, C, m };
    };
    this.G = { i: group(MAXS, this.mat, true), f: group(24, this.matF, true), g: group(16, this.matG, false), s: group(1, this.matS, true), sf: group(1, this.matSF, true), sg: group(1, this.matSG, false) };
    this.G.g.m.renderOrder = 2; this.G.sg.m.renderOrder = 2;
    // aaa2: soft contact shadow = the same tube flattened onto the ground along the sun, alpha falling off to the edges.
    // Replaces snake shadow-map casting in the world (one cheap transparent draw per group instead of a depth pass).
    this.shU = { uSpine: this.uniforms.uSpine, uT: this.uniforms.uT, uSun: { value: new THREE.Vector3(-0.45, 0.75, 0.35).normalize() }, uK: { value: 0.65 } };
    this.shMat = new THREE.ShaderMaterial({ uniforms: this.shU, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false,
      vertexShader: GLSL_COMMON + `uniform vec3 uSun; varying float vS; varying float vE;
        void main(){ vec3 pos, nrm; snakeVertex(pos, nrm); float sn=sin(tb.y), cs=cos(tb.y); vS=sn; vE=1.0-cs*cs;
          vec2 sh=uSun.xz/max(uSun.y,0.2); vec3 c=pos; c.xz-=sh*c.y*0.55; c.xz+=normalize(nrm.xz+vec2(1e-4,0.0))*vR*0.45*abs(cs); c.y=0.04;
          gl_Position=projectionMatrix*viewMatrix*vec4(c,1.0); }`,
      fragmentShader: `uniform float uK; varying float vS; varying float vE; varying vec4 vFx;
        void main(){ if(vS<0.0) discard; float a=pow(clamp(vE,0.0,1.0),0.9)*uK*vFx.z; gl_FragColor=vec4(0.0,0.0,0.0,a); }` });
    const shM = (G) => { const m = new THREE.Mesh(G.g, this.shMat); m.frustumCulled = false; m.renderOrder = 1; return m; };
    this.shadowMeshes = [shM(this.G.i), shM(this.G.f)];
    for (const k of ["i", "f"]) this.G[k].m.castShadow = false;
    this.mesh = this.G.i.m; this.meshF = this.G.f.m; this.meshG = this.G.g.m;
    this.worldMeshes = [this.G.i.m, this.G.f.m, this.G.g.m, ...this.shadowMeshes]; this.showMeshes = [this.G.s.m, this.G.sf.m, this.G.sg.m];
  }
  setShow(fx) { const k = fx === 7 ? "sg" : fx ? "sf" : "s"; for (const n of ["s", "sf", "sg"]) { this.G[n].g.instanceCount = n === k ? 1 : 0; this.G[n].m.visible = n === k; } return k; }
  // write one snake: pts = [x0,z0,x1,z1...] head first, ys optional heights, colorAt(j, n) -> packed int
  writeRow(row, pts, n, r, ys, colors) {
    const D = this.data, base = row * SW * 2 * 4;
    for (let j = 0; j < n; j++) { const o = base + j * 8; D[o] = pts[j * 2]; D[o + 1] = pts[j * 2 + 1]; D[o + 2] = r; D[o + 3] = colors[j]; D[o + 4] = ys ? ys[j] : 0; }
  }
  set(grp, k, a, b, c) { const G = this.G[grp]; G.A.array.set(a, k * 4); G.B.array.set(b, k * 4); G.C.array.set(c, k * 4); }
  commit(ni, nf, ng) {
    this.G.i.g.instanceCount = ni; this.G.f.g.instanceCount = nf; this.G.g.g.instanceCount = ng;
    for (const k in this.G) { const G = this.G[k]; G.A.needsUpdate = G.B.needsUpdate = G.C.needsUpdate = true; }
    this.tex.needsUpdate = true;
  }
  dispose(keepTex) {
    if (this.G) { for (const k in this.G) { const G = this.G[k]; if (G.m.parent) G.m.parent.remove(G.m); G.g.dispose(); } this.geo.dispose(); if (this.shadowMeshes) { for (const m of this.shadowMeshes) if (m.parent) m.parent.remove(m); this.shMat.dispose(); } this.mat.dispose(); this.matF.dispose(); this.matG.dispose(); this.matS.dispose(); this.matSF.dispose(); this.matSG.dispose(); this.depth.dispose(); this.G = null; }
    if (!keepTex && this.tex) this.tex.dispose();
  }
}
export const packCol = (r, g, b) => { const R = Math.max(0, Math.min(255, Math.round(r * 255))), G = Math.max(0, Math.min(255, Math.round(g * 255))), B = Math.max(0, Math.min(255, Math.round(b * 255))); return R * 65536 + G * 256 + B; };
