// Generates public/icon/{16,32,48,128}.png (a lens on a dark rounded square) with no dependencies.
// Run with `npm run icons`; the PNGs are committed, so this is only needed to change the design.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const BACKGROUND = [15, 23, 42]; // slate-900
const FOREGROUND = [248, 250, 252]; // slate-50
const ACCENT = [56, 189, 248]; // sky-400
const SAMPLES = 4; // supersampling per axis, for smooth edges

/** Signed distance helpers in unit coordinates (0..1). */
const roundedBox = (x, y, radius) => {
  const dx = Math.abs(x - 0.5) - (0.5 - radius);
  const dy = Math.abs(y - 0.5) - (0.5 - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
};
const segment = (x, y, ax, ay, bx, by) => {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - t * dx, py - t * dy);
};

/** Returns [r, g, b, a] (0..1 alpha) for one sample point. */
function shade(x, y) {
  if (roundedBox(x, y, 0.22) > 0) return [0, 0, 0, 0];
  const ring = Math.abs(Math.hypot(x - 0.45, y - 0.45) - 0.24);
  if (ring < 0.055) return [...FOREGROUND, 1];
  if (segment(x, y, 0.64, 0.64, 0.82, 0.82) < 0.06) return [...FOREGROUND, 1];
  if (Math.hypot(x - 0.45, y - 0.45) < 0.1) return [...ACCENT, 1];
  return [...BACKGROUND, 1];
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

function png(size) {
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0 + RGBA
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [sr, sg, sb, sa] = shade((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }
      const offset = 1 + px * 4;
      if (a > 0) {
        row[offset] = Math.round(r / a);
        row[offset + 1] = Math.round(g / a);
        row[offset + 2] = Math.round(b / a);
      }
      row[offset + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icon', { recursive: true });
for (const size of SIZES) writeFileSync(`public/icon/${size}.png`, png(size));
console.log(`Wrote ${SIZES.map((s) => `public/icon/${s}.png`).join(', ')}`);
