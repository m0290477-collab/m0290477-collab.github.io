// candy1: candy food. Procedural three.js geometry (no model files) + matching flat 2D sprites.
// Six types, one InstancedMesh each in 3D: wrapped twist sweet, lollipop, gummy bear, macaron, round hard candy,
// mint swirl disc. Stripes/swirls/white parts are computed in the fragment shader from a per-vertex pattern coordinate
// (crisp at any poly count, antialiased with fwidth); the instance colour is the candy's palette colour.
// candy1 was visual only; noself1 made the sim's pickup radius follow this drawing (sim.js foodVisR).

export const CANDY_N = 6; // 0 wrapped, 1 lollipop, 2 gummy, 3 macaron, 4 hard candy, 5 mint
export const T_WRAP = 0, T_LOLLY = 1, T_GUMMY = 2, T_MAC = 3, T_HARD = 4, T_MINT = 5;
// per-type footprint normalisation: every type's visual half-width ~= its size (hard candy / mint are drawn compact)
export const GK = [1.3, 1.4, 1.45, 1.25, 1.75, 1.55];
const NORMAL_T = [T_WRAP, T_GUMMY, T_HARD, T_MINT, T_LOLLY, T_WRAP, T_HARD, T_GUMMY, T_MINT, T_HARD, T_WRAP]; // small food (11: coprime mix)
const BIG_T = [T_MAC, T_LOLLY];

// rich food: drops from dead snakes, food rain, golden bounty, power-up piles and meteor drops are non-integer values
// (or >= 4); ambient food is 1/2/3 and boost trail drops are exactly 1.5. Online values arrive as v/10 bytes, which keeps
// that property.
export function candyBig(v) { return v >= 4 || (v !== (v | 0) && v !== 1.5); }
export function candyType(v, c, big) { const h = (c * 7 + Math.round(v * 10) * 3) >>> 0; return big ? BIG_T[h % 2] : NORMAL_T[h % NORMAL_T.length]; }
// half-size in world units. fix1 drew food at radius 0.11 + sqrt(v) * 0.075 (3D) / 0.15 + sqrt(v) * 0.1 (2D);
// candy is ~2.3x that, rich food ~1.3x more on top (with a floor so small death drops still read as the rich kind).
// noself1: everything 1.4x bigger again (CANDY_SCALE, same constant as sim.js, which sizes the pickup radius to the drawing)
export const CANDY_K = 2.5, BIG_K = 1.3, CANDY_SCALE = 1.4;
export function candySize(v, big) { const s = (0.11 + Math.sqrt(v) * 0.075) * CANDY_K * CANDY_SCALE; return big ? Math.min(1.02 * CANDY_SCALE, Math.max(0.66 * CANDY_SCALE, s * BIG_K)) : s; }

export function candySize2(v, big) { const s = (0.15 + Math.sqrt(v) * 0.1) * 2.2 * CANDY_SCALE; return big ? Math.min(1.25 * CANDY_SCALE, Math.max(0.82 * CANDY_SCALE, s * BIG_K)) : s; } // 2D (fix1 2D dots were larger than 3D)
// candy palette: the hue order of the game's food palette (worlds.js FOOD_COLORS: cherry, orange, lemon, green, mint, sky,
// blue, grape, magenta, peach, white->pink, lime, [12] gold), softened (12% toward grey, x0.92) so it reads as candy, not neon.
// The world palettes are near-grey pastels (fix1) and made every candy look the same; the colour-blind palette is used as is.
const CANDY_HEX = ["#ff4d6d", "#ffa62b", "#ffd84d", "#6ed65a", "#3fd0b0", "#4cc3ff", "#5b7cff", "#a06bff", "#ff6ad5", "#ff7f50", "#ff9ec4", "#9be15d", "#f2c14a"];
const soften = (h) => { const n = parseInt(h.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, l = r * 0.3 + g * 0.59 + b * 0.11, f = (x) => Math.round((x + (l - x) * 0.12) * 0.92); return "#" + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1); };
export const CANDY_CSS = CANDY_HEX.map(soften);
const lin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
export const CANDY_LIN = CANDY_CSS.map((h) => { const n = parseInt(h.slice(1), 16); return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)]; });
// the palette candy uses for a view: the game's colour-blind palette when that setting is on, else the candy palette
export function candyPal(cssPal, cbPal) { return cssPal === cbPal ? null : CANDY_CSS; }
// saturation lift (used for colour-blind palettes only)
export function candyRgb(c, out) { const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11, k = 1.35; out[0] = Math.max(0.02, Math.min(1, l + (c[0] - l) * k)); out[1] = Math.max(0.02, Math.min(1, l + (c[1] - l) * k)); out[2] = Math.max(0.02, Math.min(1, l + (c[2] - l) * k)); return out; }

// ---------------- 3D ----------------
// every part keeps its geometry's uv; a per-type function turns the uv into the stripe coordinate (cuv.x) and the
// amount of white (cuv.y). Fragment: w = cuv.y * band(cuv.x), band = 1 inside fract(u) in [0.5, 1).
function part(T, geo, mtx, pat, out) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(mtx);
  const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv.array;
  for (let i = 0, k = 0; i < p.length; i += 3, k += 2) { out.pos.push(p[i], p[i + 1], p[i + 2]); out.nor.push(n[i], n[i + 1], n[i + 2]); const r = pat(uv[k], uv[k + 1], p[i], p[i + 1], p[i + 2]); out.cuv.push(r[0], r[1]); }
  g.dispose(); if (g !== geo) geo.dispose();
}
const M4 = (T, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
const _r = [0, 0];
const plain = () => ((_r[0] = 0), (_r[1] = 0), _r), white = () => ((_r[0] = 0.75), (_r[1] = 1), _r), cream = () => ((_r[0] = 0.75), (_r[1] = 0.86), _r);

// q: 0 = low-poly (Low preset), 1 = medium, 2 = high
export function candyGeometries(T, q) {
  const f = q === 0 ? 0.6 : q === 1 ? 1 : 1.35, S = (a) => Math.max(4, Math.round(a * f));
  const out = [];
  const mk = (build) => { const o = { pos: [], nor: [], cuv: [] }; build(o); const k = GK[out.length]; for (let i = 0; i < o.pos.length; i++) o.pos[i] *= k; const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(o.pos, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(o.nor, 3)); g.setAttribute("cuv", new T.Float32BufferAttribute(o.cuv, 2)); g.computeBoundingSphere(); return g; };
  // 0 wrapped twist sweet: striped capsule body along x + two pleated twist ends
  out[T_WRAP] = mk((o) => {
    part(T, new T.SphereGeometry(1, S(14), S(9)), M4(T, 0.42, 0.62, 0.42, 0, 0.42, 0, 0, 0, Math.PI / 2), (u, v) => ((_r[0] = u * 4 + v * 2.2), (_r[1] = 1), _r), o);
    for (const sd of [-1, 1]) {
      part(T, new T.CylinderGeometry(0.07, 0.36, 0.36, S(10), 1, true), M4(T, 1, 1, 0.75, sd * 0.8, 0.42, 0, 0, 0, sd * Math.PI / 2), (u) => ((_r[0] = u * 6), (_r[1] = 0.55), _r), o);
      part(T, new T.CircleGeometry(0.36, S(10)), M4(T, 0.75, 1, 1, sd * 0.98, 0.42, 0, 0, sd * Math.PI / 2, 0), plain, o);
    }
  });
  // 1 lollipop lying on the ground: swirl dome + white stick (centred on its footprint)
  out[T_LOLLY] = mk((o) => {
    part(T, new T.SphereGeometry(1, S(16), S(8)), M4(T, 0.62, 0.3, 0.62, 0, 0.31, -0.3), (u, v) => ((_r[0] = u * 3 + v * 2.6), (_r[1] = 0.95), _r), o);
    part(T, new T.CylinderGeometry(0.065, 0.065, 0.8, S(6), 1, false), M4(T, 1, 1, 1, 0, 0.1, 0.66, Math.PI / 2, 0, 0), white, o);
  });
  // 2 gummy bear, lying on its back (reads as a bear from above)
  out[T_GUMMY] = mk((o) => {
    const B = (rx, ry, rz, x, y, z, seg) => part(T, new T.SphereGeometry(1, S(seg), Math.max(3, S(seg * 0.6))), M4(T, rx, ry, rz, x, y, z), plain, o);
    B(0.42, 0.27, 0.48, 0, 0.27, 0.12, 12); B(0.36, 0.25, 0.32, 0, 0.26, -0.5, 12);
    B(0.13, 0.11, 0.13, -0.25, 0.25, -0.76, 7); B(0.13, 0.11, 0.13, 0.25, 0.25, -0.76, 7);
    B(0.15, 0.13, 0.2, -0.43, 0.2, -0.08, 7); B(0.15, 0.13, 0.2, 0.43, 0.2, -0.08, 7);
    B(0.18, 0.15, 0.22, -0.27, 0.18, 0.56, 7); B(0.18, 0.15, 0.22, 0.27, 0.18, 0.56, 7);
  });
  // 3 macaron: two domed shells + cream filling
  out[T_MAC] = mk((o) => {
    part(T, new T.SphereGeometry(1, S(16), S(7), 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M4(T, 0.64, 0.22, 0.64, 0, 0.24, 0), plain, o); // bottom shell (lower half)
    part(T, new T.CylinderGeometry(0.64, 0.64, 0.06, S(16), 1, true), M4(T, 1, 1, 1, 0, 0.27, 0), plain, o);
    part(T, new T.CylinderGeometry(0.57, 0.57, 0.16, S(16), 1, true), M4(T, 1, 1, 1, 0, 0.38, 0), cream, o);
    part(T, new T.CylinderGeometry(0.64, 0.64, 0.06, S(16), 1, true), M4(T, 1, 1, 1, 0, 0.49, 0), plain, o);
    part(T, new T.SphereGeometry(1, S(16), S(7), 0, Math.PI * 2, 0, Math.PI / 2), M4(T, 0.64, 0.26, 0.64, 0, 0.52, 0), plain, o); // top dome
  });
  // 4 round hard candy: a glossy ball with a faint lighter swirl
  out[T_HARD] = mk((o) => { part(T, new T.SphereGeometry(1, S(14), S(10)), M4(T, 0.52, 0.36, 0.52, 0, 0.36, 0), (u, v) => ((_r[0] = u * 2 + v * 1.5), (_r[1] = 0.28), _r), o); });
  // 5 mint swirl disc: flat peppermint with a pinwheel
  out[T_MINT] = mk((o) => { part(T, new T.SphereGeometry(1, S(20), S(7)), M4(T, 0.6, 0.17, 0.6, 0, 0.18, 0), (u, v) => ((_r[0] = u * 8 + v * 1.2), (_r[1] = 1), _r), o); });
  return out;
}

// gold coin for Gold Rush pickups (kept apart from candy: metallic, upright, its own mesh)
export function coinGeometry(T, q) { const g = new T.CylinderGeometry(0.62, 0.62, 0.14, q === 0 ? 12 : 20, 1, false); g.rotateX(Math.PI / 2); g.translate(0, 0.66, 0); return g; }

// patch any lit material: stripes from cuv; gummy adds a cheap translucent body (soft light lift + rim), no glow
export function candyMaterial(T, tier, gummy) {
  const m = tier === "lambert" ? new T.MeshPhongMaterial({ color: 0xffffff, shininess: gummy ? 50 : 70, specular: gummy ? 0x333333 : 0x4a4a4a })
    : tier === "standard" ? new T.MeshStandardMaterial({ color: 0xffffff, roughness: gummy ? 0.34 : 0.26, metalness: 0, envMapIntensity: 0.55 })
    : new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: gummy ? 0.32 : 0.3, metalness: 0, clearcoat: gummy ? 0.5 : 0.85, clearcoatRoughness: 0.12, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 cuv; varying vec2 vCuv;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvCuv = cuv;");
    let fs = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vCuv;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n{ float d = abs(fract(vCuv.x) - 0.75); float aa = max(fwidth(vCuv.x) * 0.8, 0.002); float w = vCuv.y * (1.0 - smoothstep(0.25 - aa, 0.25 + aa, d)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.91, 0.89), w); }");
    if (gummy) fs = fs.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ float fr = 1.0 - abs(dot(normalize(vViewPosition), normal)); totalEmissiveRadiance += diffuseColor.rgb * (0.14 + 0.32 * fr * fr); }");
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => "candy" + (gummy ? "g" : "") + tier;
  return underSnakes(m, "candy" + (gummy ? "g" : "") + tier);
}
// noself1: food always draws UNDER snake bodies. The candy keeps its shape and shading, but its depth is pulled down to the
// ground under each vertex (y = 0.04) with only 5% of its own relief kept (so a candy still sorts its own faces), so any snake
// body above the ground is nearer and covers it, while the candy still covers the ground.
const DEPTH_VS = "\n#ifdef USE_INSTANCING\n{ vec4 wq = modelMatrix * instanceMatrix * vec4(transformed, 1.0); wq.y = 0.04; vec4 cq = projectionMatrix * viewMatrix * wq; float dg = cq.z / cq.w, dv = gl_Position.z / gl_Position.w; gl_Position.z = (dg + (dv - dg) * 0.05) * gl_Position.w; }\n#endif\n";
export function underSnakes(m, key) {
  const prev = m.onBeforeCompile; m.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>" + DEPTH_VS); };
  m.customProgramCacheKey = () => key + "u"; return m;
}
export function coinMaterial(T, tier) {
  return underSnakes(tier === "lambert" ? new T.MeshPhongMaterial({ color: 0xf2c14a, specular: 0xfff0b0, shininess: 90, emissive: 0x2a1a00 })
    : new T.MeshStandardMaterial({ color: 0xffc640, roughness: 0.32, metalness: 0.4, emissive: 0x4a3000, envMapIntensity: 1 }), "coin" + tier);
}

// ---------------- 2D ----------------
// One sprite per (type, css colour), drawn once with flat fills + crisp hard-edged highlights (no blur, no glow).
// Sprite box: 2.4 x 2.4 units (centre at the middle); drawn at half-size s -> box side = s * 2.4 / 1.0 * ... see SPR_K.
export const SPR_K = 1.35; // sprite half-extent in candy units (candy half-size 1 -> sprite covers +-1.2)
function hexRgb(c) { if (c[0] === "#") { const n = parseInt(c.length === 4 ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } const m = c.match(/[\d.]+/g) || [255, 255, 255]; return [+m[0], +m[1], +m[2]]; }
function sat(rgb, k) { const l = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11; return rgb.map((x) => Math.max(0, Math.min(255, Math.round(l + (x - l) * k)))); }
const cs = (a) => `rgb(${a[0]},${a[1]},${a[2]})`, mixc = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
const WH = [238, 232, 226], DK = [24, 18, 26];

export function drawCandySprite(type, css, px) {
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(px, px) : Object.assign(document.createElement("canvas"), { width: px, height: px });
  const g = cv.getContext("2d"), U = px / (2 * SPR_K); g.translate(px / 2, px / 2); g.scale(U * GK[type], U * GK[type]); // 1 unit = candy half-size
  const base = sat(hexRgb(css), 1.0), dark = mixc(base, DK, 0.32), lite = mixc(base, [255, 255, 255], 0.42), TAU = Math.PI * 2;
  const ell = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); };
  // contact shadow (crisp, low alpha), offset down-right like the 3D sun
  g.fillStyle = "rgba(0,0,0,0.2)";
  const shade = (fn) => { g.save(); g.translate(0.09, 0.13); fn(); g.fill(); g.restore(); };
  const hl = (x, y, rx, ry, rot) => { g.fillStyle = "rgba(255,255,255,0.55)"; ell(x, y, rx, ry, rot); g.fill(); };
  if (type === T_WRAP) {
    const body = () => ell(0, 0, 0.58, 0.4);
    const ends = (sd) => { g.beginPath(); g.moveTo(sd * 0.5, 0); g.lineTo(sd * 0.98, -0.36); g.quadraticCurveTo(sd * 0.9, 0, sd * 0.98, 0.36); g.closePath(); };
    shade(() => { body(); }); shade(() => ends(-1)); shade(() => ends(1));
    for (const sd of [-1, 1]) { g.fillStyle = cs(dark); ends(sd); g.fill(); g.strokeStyle = cs(mixc(base, WH, 0.55)); g.lineWidth = 0.05; g.beginPath(); g.moveTo(sd * 0.58, -0.05); g.lineTo(sd * 0.92, -0.24); g.moveTo(sd * 0.58, 0.05); g.lineTo(sd * 0.92, 0.24); g.stroke(); }
    g.fillStyle = cs(base); body(); g.fill();
    g.save(); body(); g.clip(); g.fillStyle = cs(WH); for (let k = -4; k <= 4; k++) { const x = k * 0.26; g.beginPath(); g.moveTo(x - 0.1, -0.5); g.lineTo(x + 0.03, -0.5); g.lineTo(x + 0.2, 0.5); g.lineTo(x + 0.07, 0.5); g.closePath(); g.fill(); }
    g.fillStyle = "rgba(0,0,0,0.12)"; ell(0.06, 0.16, 0.56, 0.3); g.fill(); g.restore();
    hl(-0.18, -0.2, 0.2, 0.07, -0.15);
  } else if (type === T_LOLLY) {
    shade(() => { g.beginPath(); g.rect(-0.05, 0.25, 0.1, 0.78); }); shade(() => ell(0, -0.26, 0.64, 0.64));
    g.fillStyle = cs(WH); g.beginPath(); g.rect(-0.055, 0.2, 0.11, 0.82); g.fill(); g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0.01, 0.2, 0.045, 0.82);
    g.fillStyle = cs(base); ell(0, -0.26, 0.64, 0.64); g.fill();
    g.save(); ell(0, -0.26, 0.64, 0.64); g.clip(); g.translate(0, -0.26); g.fillStyle = cs(WH);
    for (let k = 0; k < 3; k++) { g.save(); g.rotate((k / 3) * TAU); g.beginPath(); for (let s = 0; s <= 24; s++) { const a = (s / 24) * 1.9 * Math.PI, r = 0.04 + (s / 24) * 0.66; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } for (let s = 24; s >= 0; s--) { const a = (s / 24) * 1.9 * Math.PI + 0.55, r = 0.04 + (s / 24) * 0.66; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.restore(); }
    g.fillStyle = "rgba(0,0,0,0.12)"; ell(0.1, 0.14, 0.62, 0.42); g.fill(); g.restore();
    hl(-0.22, -0.5, 0.2, 0.09, -0.6);
  } else if (type === T_GUMMY) {
    const bear = () => { g.beginPath(); const E = (x, y, rx, ry) => { g.moveTo(x + rx, y); g.ellipse(x, y, rx, ry, 0, 0, TAU); }; E(0, 0.1, 0.42, 0.48); E(0, -0.5, 0.36, 0.32); E(-0.25, -0.76, 0.13, 0.13); E(0.25, -0.76, 0.13, 0.13); E(-0.43, -0.08, 0.15, 0.2); E(0.43, -0.08, 0.15, 0.2); E(-0.27, 0.56, 0.18, 0.22); E(0.27, 0.56, 0.18, 0.22); };
    shade(bear); g.fillStyle = cs(mixc(base, WH, 0.12)); bear(); g.fill();
    g.save(); bear(); g.clip(); g.fillStyle = cs(dark); g.globalAlpha = 0.35; ell(0.12, 0.22, 0.42, 0.5); g.fill(); g.globalAlpha = 1; g.fillStyle = cs(lite); g.globalAlpha = 0.55; ell(-0.06, 0.02, 0.24, 0.3); g.fill(); ell(-0.05, -0.55, 0.18, 0.14); g.fill(); g.globalAlpha = 1; g.restore();
    g.fillStyle = cs(mixc(base, DK, 0.55)); ell(-0.12, -0.54, 0.045, 0.045); g.fill(); ell(0.12, -0.54, 0.045, 0.045); g.fill();
    hl(-0.2, -0.64, 0.1, 0.05, -0.4); hl(-0.2, -0.05, 0.12, 0.06, -0.6);
  } else if (type === T_MAC) {
    shade(() => ell(0, 0.04, 0.68, 0.66));
    g.fillStyle = cs(dark); ell(0, 0.17, 0.66, 0.5); g.fill(); // lower shell
    g.fillStyle = cs(WH); ell(0, 0.04, 0.6, 0.5); g.fill(); // cream
    g.fillStyle = cs(base); ell(0, -0.12, 0.66, 0.5); g.fill(); // top shell
    g.fillStyle = cs(mixc(base, WH, 0.2)); ell(-0.06, -0.18, 0.5, 0.36); g.fill();
    hl(-0.24, -0.34, 0.2, 0.08, -0.3);
  } else if (type === T_HARD) {
    shade(() => ell(0, 0, 0.54, 0.54));
    g.fillStyle = cs(base); ell(0, 0, 0.54, 0.54); g.fill();
    g.save(); ell(0, 0, 0.54, 0.54); g.clip(); g.fillStyle = "rgba(0,0,0,0.16)"; ell(0.14, 0.18, 0.52, 0.46); g.fill(); g.fillStyle = cs(mixc(base, WH, 0.3)); g.globalAlpha = 0.6; g.beginPath(); g.arc(0, 0, 0.36, -2.6, -0.6); g.lineWidth = 0.08; g.strokeStyle = g.fillStyle; g.stroke(); g.globalAlpha = 1; g.restore();
    hl(-0.18, -0.24, 0.16, 0.08, -0.6);
  } else { // mint
    shade(() => ell(0, 0, 0.62, 0.62));
    g.fillStyle = cs(base); ell(0, 0, 0.62, 0.62); g.fill(); g.fillStyle = cs(WH);
    for (let k = 0; k < 8; k++) { const a0 = (k / 8) * TAU, a1 = a0 + TAU / 16; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(a0 + 0.35) * 0.4, Math.sin(a0 + 0.35) * 0.4, Math.cos(a0) * 0.6, Math.sin(a0) * 0.6); g.arc(0, 0, 0.6, a0, a1); g.quadraticCurveTo(Math.cos(a1 + 0.35) * 0.4, Math.sin(a1 + 0.35) * 0.4, 0, 0); g.fill(); }
    g.strokeStyle = cs(mixc(base, DK, 0.15)); g.lineWidth = 0.05; ell(0, 0, 0.6, 0.6); g.stroke();
    g.fillStyle = "rgba(0,0,0,0.1)"; g.save(); ell(0, 0, 0.62, 0.62); g.clip(); ell(0.16, 0.2, 0.6, 0.5); g.fill(); g.restore();
    hl(-0.22, -0.3, 0.18, 0.07, -0.5);
  }
  return cv;
}
export function drawCoinSprite(px) {
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(px, px) : Object.assign(document.createElement("canvas"), { width: px, height: px });
  const g = cv.getContext("2d"), U = px / (2 * SPR_K); g.translate(px / 2, px / 2); g.scale(U, U); const TAU = Math.PI * 2;
  g.fillStyle = "rgba(0,0,0,0.22)"; g.beginPath(); g.ellipse(0.08, 0.12, 0.62, 0.62, 0, 0, TAU); g.fill();
  g.fillStyle = "#a8741c"; g.beginPath(); g.arc(0, 0.04, 0.6, 0, TAU); g.fill();
  g.fillStyle = "#f2c14a"; g.beginPath(); g.arc(0, 0, 0.6, 0, TAU); g.fill();
  g.strokeStyle = "#c9922a"; g.lineWidth = 0.07; g.beginPath(); g.arc(0, 0, 0.46, 0, TAU); g.stroke();
  g.fillStyle = "#c9922a"; g.beginPath(); g.moveTo(-0.24, 0.14); g.lineTo(-0.24, -0.14); g.lineTo(-0.12, 0); g.lineTo(0, -0.2); g.lineTo(0.12, 0); g.lineTo(0.24, -0.14); g.lineTo(0.24, 0.14); g.closePath(); g.fill(); // crown, like the concept's coin
  g.fillStyle = "rgba(255,248,220,0.7)"; g.beginPath(); g.ellipse(-0.2, -0.3, 0.17, 0.07, -0.6, 0, TAU); g.fill();
  return cv;
}
