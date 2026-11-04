// grow1: tiny local QR encoder (byte mode, error correction M, versions 1-10 = up to 213 bytes). No network, no library.
// Follows ISO/IEC 18004 (same construction as Nayuki's public-domain-style reference): data + Reed-Solomon blocks,
// function patterns, zigzag placement, the mask with the lowest penalty, format + version bits.
const ECC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], BLK = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5]; // per version (M)
const rawMods = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
const gmul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 255; };
function rsDiv(d) { const r = new Array(d).fill(0); r[d - 1] = 1; let root = 1; for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) { r[j] = gmul(r[j], root); if (j + 1 < d) r[j] ^= r[j + 1]; } root = gmul(root, 2); } return r; }
function rsRem(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); for (let i = 0; i < div.length; i++) r[i] ^= gmul(div[i], f); } return r; }
const alignPos = (v, size) => { if (v === 1) return []; const n = Math.floor(v / 7) + 2, step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, out = [6]; for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p); return out; };
const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];

// returns { size, m: Uint8Array(size*size) 1 = dark } or null when the text is too long
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))]; let v = 0, cap = 0;
  for (let k = 1; k <= 10; k++) { const dc = Math.floor(rawMods(k) / 8) - ECC[k - 1] * BLK[k - 1]; if (4 + (k < 10 ? 8 : 16) + bytes.length * 8 <= dc * 8) { v = k; cap = dc; break; } }
  if (!v) return null; const bits = []; const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); for (const b of bytes) put(b, 8); put(0, Math.min(4, cap * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); } for (let p = 0xec; data.length < cap; p ^= 0xec ^ 0x11) data.push(p);
  // blocks + interleave
  const nb = BLK[v - 1], ec = ECC[v - 1], raw = Math.floor(rawMods(v) / 8), nShort = nb - (raw % nb), sLen = Math.floor(raw / nb) - ec, div = rsDiv(ec), D = [], E = [];
  for (let i = 0, k = 0; i < nb; i++) { const len = sLen + (i < nShort ? 0 : 1), d = data.slice(k, k + len); k += len; D.push(d); E.push(rsRem(d, div)); }
  const cw = []; for (let i = 0; i <= sLen; i++) for (const d of D) if (i < d.length) cw.push(d[i]); for (let i = 0; i < ec; i++) for (const e of E) cw.push(e[i]);
  // function patterns
  const size = v * 4 + 17, m = new Uint8Array(size * size), fn = new Uint8Array(size * size); const set = (x, y, d) => { m[y * size + x] = d ? 1 : 0; fn[y * size + x] = 1; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy)); if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const ap = alignPos(v, size); for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) { if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  const format = (mask) => { const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((d << 10) | r) ^ 0x5412, g = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, g(i)); set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i)); set(8, size - 8, true); };
  format(0);
  if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const b = (v << 12) | r; for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, d); set(c, a, d); } }
  // data, zigzag
  let i = 0; for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
    const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert; if (!fn[y * size + x] && i < cw.length * 8) { m[y * size + x] = (cw[i >>> 3] >>> (7 - (i & 7))) & 1; i++; } } }
  // pick the mask with the lowest penalty (runs, 2x2 blocks, finder-like rows/cols, dark balance)
  const apply = (k) => { const f = MASK[k]; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && f(x, y)) m[y * size + x] ^= 1; };
  const penalty = () => { let p = 0, dark = 0; const at = (x, y) => m[y * size + x];
    for (let pass = 0; pass < 2; pass++) for (let a = 0; a < size; a++) { let run = 1, s = ""; for (let b = 0; b < size; b++) { const c = pass ? at(a, b) : at(b, a); s += c; if (b) { const pc = pass ? at(a, b - 1) : at(b - 1, a); if (c === pc) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let q = s.indexOf("1011101"); q >= 0; q = s.indexOf("1011101", q + 1)) { if (s.slice(q - 4, q) === "0000" || s.slice(q + 7, q + 11) === "0000" || q < 4 || q + 7 > size - 4) p += 40; } }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = at(x, y); if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3; }
    for (let k = 0; k < m.length; k++) dark += m[k]; return p + Math.floor(Math.abs(dark * 20 - m.length * 10) / m.length) * 10; };
  let best = 0, bp = Infinity; for (let k = 0; k < 8; k++) { apply(k); format(k); const p = penalty(); if (p < bp) { bp = p; best = k; } apply(k); }
  apply(best); format(best); return { size, m, v, mask: best };
}
// draws the code with a 4-module quiet zone; dark modules in `fg` on white
export function qrDraw(cv, text, px = 240, fg = "#0b1020") {
  const Q = qrMatrix(text); if (!Q) return false; const n = Q.size + 8, s = Math.max(1, Math.floor(px / n)); cv.width = cv.height = n * s; const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = fg; for (let y = 0; y < Q.size; y++) for (let x = 0; x < Q.size; x++) if (Q.m[y * Q.size + x]) g.fillRect((x + 4) * s, (y + 4) * s, s, s); return true;
}
