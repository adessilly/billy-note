// Génère src-tauri/icons/source.png (1024×1024) : carré arrondi noir et
// quelques lignes de texte blanches. Sans dépendance (PNG écrit à la main).
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const S = 1024;
const pad = 100, r = 190; // grille macOS : ~824 px utiles
const lines = [
  { x: 250, y: 330, w: 150, h: 64, c: [255, 255, 255, 120] }, // « # »
  { x: 430, y: 330, w: 340, h: 64, c: [255, 255, 255, 255] },
  { x: 250, y: 470, w: 520, h: 40, c: [255, 255, 255, 200] },
  { x: 250, y: 560, w: 460, h: 40, c: [255, 255, 255, 200] },
  { x: 250, y: 650, w: 300, h: 40, c: [255, 255, 255, 200] },
];

const inRound = (x, y, x0, y0, x1, y1, rad) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
};

const px = Buffer.alloc(S * S * 4);
const SS = 4;
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  let bg = 0, acc = [0, 0, 0, 0];
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
    if (!inRound(fx, fy, pad, pad, S - pad, S - pad, r)) continue;
    bg++;
    let col = [14, 14, 16, 255];
    for (const l of lines) if (inRound(fx, fy, l.x, l.y, l.x + l.w, l.y + l.h, l.h / 2)) {
      const a = l.c[3] / 255;
      col = [col[0] * (1 - a) + l.c[0] * a, col[1] * (1 - a) + l.c[1] * a, col[2] * (1 - a) + l.c[2] * a, 255];
    }
    for (let i = 0; i < 4; i++) acc[i] += col[i];
  }
  const o = (y * S + x) * 4, n = SS * SS;
  if (bg) { px[o] = acc[0] / bg; px[o + 1] = acc[1] / bg; px[o + 2] = acc[2] / bg; px[o + 3] = (255 * bg) / n; }
}

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync("src-tauri/icons/source.png", Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]));
console.log("icône source écrite");
