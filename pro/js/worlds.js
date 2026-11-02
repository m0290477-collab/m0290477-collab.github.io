// Themed arenas. Each world: palette, fog, lights, a procedural ground texture, decoration kit and ambient particles.
// Pure data + canvas painters, shared by the 3D renderer and the 2D fallback.
export const WORLDS = [
  {
    id: "jungle", lv: 1,
    bg: "#0b2416", fog: "#0e2a1a", fogNear: 40, fogFar: 135,
    sky: "#9fe6b8", ground: "#163a1f", sun: "#fff1cf", sunI: 1.9, hemiI: 0.85,
    rim: "#7dffb0", wall: "#5dffa0", foodSat: 0.9,
    amb: { kind: "firefly", color: "#d9ff7a", n: 160 },
    decor: ["tree", "tree", "bush", "rock"],
    tex: (g, S) => {
      g.fillStyle = "#1f4a27"; g.fillRect(0, 0, S, S);
      blotches(g, S, ["#24552c", "#1a4023", "#2c6234", "#183a20"], 70, 18, 60);
      for (let i = 0; i < 160; i++) { // leaves and grass blades
        const x = rnd() * S, y = rnd() * S, r = 4 + rnd() * 9, a = rnd() * 6.28;
        g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = ["#2f6e36", "#3b8040", "#25592c", "#4c8f3e"][i % 4]; g.globalAlpha = 0.55;
        g.beginPath(); g.ellipse(0, 0, r, r * 0.38, 0, 0, 6.28); g.fill(); g.restore();
      }
      g.globalAlpha = 0.18; g.strokeStyle = "#9be08a"; g.lineWidth = 1;
      for (let i = 0; i < 90; i++) { const x = rnd() * S, y = rnd() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y - 6 - rnd() * 6); g.stroke(); }
      g.globalAlpha = 1;
    },
  },
  {
    id: "babylon", lv: 4,
    bg: "#3a2414", fog: "#c98a52", fogNear: 45, fogFar: 150,
    sky: "#f6dcbc", ground: "#5e4a36", sun: "#ffe6c8", sunI: 2.0, hemiI: 0.8,
    rim: "#ffcc66", wall: "#ffb347", foodSat: 1,
    amb: { kind: "dust", color: "#ffe0b0", n: 140 },
    decor: ["ziggurat", "obelisk", "palm", "pillar"],
    tex: (g, S) => {
      g.fillStyle = "#d6a868"; g.fillRect(0, 0, S, S);
      blotches(g, S, ["#dcb072", "#cf9d5c", "#e2ba80", "#c99556"], 60, 30, 90);
      g.globalAlpha = 0.22; g.strokeStyle = "#a8743d"; g.lineWidth = 2; // dune ripples
      for (let y = -20; y < S + 20; y += 14) { g.beginPath(); for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin(x * 0.045 + y * 0.3) * 4 + Math.sin(x * 0.11) * 1.5); g.stroke(); }
      g.globalAlpha = 0.12; g.fillStyle = "#7a4f24"; // ancient tiles
      for (let i = 0; i < 6; i++) { const x = rnd() * S, y = rnd() * S; g.fillRect(x, y, 22, 22); }
      g.globalAlpha = 1;
    },
  },
  {
    id: "ice", lv: 8,
    bg: "#0d2238", fog: "#8fb8dc", fogNear: 40, fogFar: 140, exposure: 0.82, bloomT: 0.97,
    sky: "#d8ecff", ground: "#5d86a8", sun: "#fff6e8", sunI: 1.3, hemiI: 0.7,
    rim: "#9fe8ff", wall: "#7fd8ff", foodSat: 0.85,
    amb: { kind: "snow", color: "#ffffff", n: 260 },
    decor: ["crystal", "pine", "crystal", "iceberg"],
    tex: (g, S) => {
      g.fillStyle = "#b7d3ea"; g.fillRect(0, 0, S, S);
      blotches(g, S, ["#cfe3f4", "#9fc0dd", "#e2f0fb", "#8fb3d4"], 70, 25, 80);
      g.globalAlpha = 0.5; g.strokeStyle = "#6f9cc4"; g.lineWidth = 1.4; // cracks
      for (let i = 0; i < 14; i++) { let x = rnd() * S, y = rnd() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
      g.globalAlpha = 0.6; g.fillStyle = "#ffffff";
      for (let i = 0; i < 120; i++) g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
      g.globalAlpha = 1;
    },
  },
  {
    id: "neon", lv: 12,
    bg: "#05030f", fog: "#0a0620", fogNear: 50, fogFar: 160,
    sky: "#6a4cff", ground: "#100a2a", sun: "#c8b8ff", sunI: 1.4, hemiI: 0.7,
    rim: "#ff2bd6", wall: "#00e5ff", foodSat: 1, emissiveGround: true,
    amb: { kind: "rain", color: "#9fd8ff", n: 320 },
    decor: ["tower", "pylon", "tower", "pylon"],
    tex: (g, S) => {
      g.fillStyle = "#0b0720"; g.fillRect(0, 0, S, S);
      blotches(g, S, ["#120b30", "#0e0828", "#160d3a"], 30, 40, 120);
      g.strokeStyle = "#3a2cff"; g.globalAlpha = 0.55; g.lineWidth = 2; // grid
      const n = 4; for (let i = 0; i <= n; i++) { const p = (i / n) * S; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke(); }
      g.strokeStyle = "#ff2bd6"; g.globalAlpha = 0.2; g.lineWidth = 1;
      for (let i = 0; i <= n * 4; i++) { const p = (i / (n * 4)) * S; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke(); }
      g.globalAlpha = 1;
    },
  },
  {
    id: "volcano", lv: 16,
    bg: "#140504", fog: "#2a0a05", fogNear: 40, fogFar: 140, exposure: 1.0,
    sky: "#ff8a4a", ground: "#1a0703", sun: "#ffb27a", sunI: 1.6, hemiI: 0.6,
    rim: "#ff5a1a", wall: "#ff7a1a", foodSat: 1, emissiveGround: true,
    amb: { kind: "ember", color: "#ff8a2a", n: 220 },
    decor: ["spire", "rock", "spire", "vent"],
    tex: (g, S) => {
      g.fillStyle = "#1c1210"; g.fillRect(0, 0, S, S);
      blotches(g, S, ["#241815", "#150d0b", "#2c1d18"], 50, 25, 80);
      g.strokeStyle = "#ff6a00"; g.lineWidth = 2.2; g.globalAlpha = 0.85;
      for (let i = 0; i < 18; i++) { let x = rnd() * S, y = rnd() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
      g.globalAlpha = 1;
    },
  },
  {
    id: "nebula", lv: 20,
    bg: "#05030f", fog: "#0a0620", fogNear: 50, fogFar: 170,
    sky: "#8a6cff", ground: "#100a2a", sun: "#d8c8ff", sunI: 1.5, hemiI: 0.7,
    rim: "#b47cff", wall: "#7af7ff", foodSat: 1, emissiveGround: true,
    amb: { kind: "star", color: "#ffffff", n: 320 },
    decor: ["asteroid", "crystal", "asteroid", "ringplanet"],
    tex: (g, S) => {
      g.fillStyle = "#0b0720"; g.fillRect(0, 0, S, S);
      blotches(g, S, ["#1a0f40", "#0e0828", "#22104a"], 30, 40, 120);
      g.fillStyle = "#ffffff"; for (let i = 0; i < 140; i++) { g.globalAlpha = rnd(); g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5); }
      g.strokeStyle = "#9b6cff"; g.globalAlpha = 0.5; g.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) { let x = rnd() * S, y = rnd() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.5) * 70; g.lineTo(x, y); } g.stroke(); }
      g.globalAlpha = 1;
    },
  },
];
let seed = 7;
function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function blotches(g, S, cols, n, r0, r1) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * S, y = rnd() * S, r = r0 + rnd() * (r1 - r0), c = cols[i % cols.length];
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { // tileable
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, c); gr.addColorStop(1, c + "00");
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, r, 0, 6.28); g.fill();
    }
  }
}
export function paintGround(w, size) {
  const S = size || 512, cv = document.createElement("canvas"); cv.width = cv.height = S; seed = 7 + WORLDS.indexOf(w) * 101;
  const g = cv.getContext("2d"); w.tex(g, S); return cv;
}
export const FOOD_COLORS = ["#ff3b5c", "#ffb300", "#ffe94d", "#7dff4d", "#2dffb3", "#29d8ff", "#3d7bff", "#9b5cff", "#ff4df0", "#ff7a3d", "#ffffff", "#a6ff00", "#ffd23a"]; // [12] = gold (event orbs)
// colour-blind safe palette (Okabe–Ito based) used when the accessibility mode is on
export const FOOD_COLORS_CB = ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7", "#ffffff", "#e69f00", "#56b4e9", "#f0e442", "#cc79a7", "#ffd23a"];

// ---- AAA 3D layer per world: generated sky panorama + PBR ground (lazy-loaded WebP), grading, weather, time of day, life ----
// grade: [lift r,g,b], [gain r,g,b], sat, contrast. tod: day/night cycle seconds (0 = static). reflect: planar reflection strength on high/ultra.
export const W3D = {
  jungle: { sky: "jungle", grade: [[0.0, 0.01, 0.0], [1.02, 1.04, 0.96], 1.12, 1.06], tod: 240, weather: ["clear", "rain"], rough: 0.85, reflect: 0, water: "lake", waterC: "#1f5a4a", foliage: "fern", creatures: "birds", fogK: 0.010, clouds: 1, bloom: 0.5, dusk: "#ff9a5a", night: "#2a3a6a" },
  babylon: { sky: "babylon", desat: 0.38, grade: [[0.015, 0.01, 0.005], [1.02, 1.0, 0.94], 0.94, 1.05], tod: 260, weather: ["clear", "sandstorm"], rough: 0.92, reflect: 0, water: "oasis", waterC: "#2a7a8a", foliage: "reed", creatures: "birds", fogK: 0.009, clouds: 1, bloom: 0.45, dusk: "#ff7a3a", night: "#3a2a5a" },
  ice: { sky: "ice", grade: [[0.0, 0.01, 0.03], [0.94, 1.02, 1.1], 1.05, 1.05], tod: 0, weather: ["snow"], rough: 0.45, reflect: 0.35, water: "none", foliage: "frost", creatures: "owls", fogK: 0.011, aurora: 1, bloom: 0.55 },
  neon: { sky: "neon", grade: [[0.02, 0.0, 0.04], [1.06, 0.94, 1.12], 1.2, 1.1], tod: 0, weather: ["rain"], rough: 0.42, reflect: 0.55, water: "none", foliage: "none", creatures: "drones", fogK: 0.012, bloom: 0.8, emissiveK: 2.2 },
  volcano: { sky: "volcano", grade: [[0.03, 0.0, 0.0], [1.12, 0.96, 0.82], 1.15, 1.12], tod: 0, weather: ["ash"], rough: 0.8, reflect: 0, water: "lava", waterC: "#ff4a00", foliage: "none", creatures: "bats", fogK: 0.011, bloom: 0.9, emissiveK: 1.9 },
  nebula: { sky: "nebula", grade: [[0.01, 0.0, 0.03], [1.04, 0.96, 1.12], 1.18, 1.08], tod: 0, weather: ["stars"], rough: 0.45, reflect: 0.4, water: "none", foliage: "none", creatures: "comets", fogK: 0.006, nebula: 1, bloom: 0.85, emissiveK: 1.8 },
};
for (const k in W3D) W3D[k].id = k;
export const worldAsset = (w, kind, lo) => `assets/w/${w.id}_${kind}${lo ? "_lo" : ""}.webp`;
