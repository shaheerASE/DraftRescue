/**
 * Generates the placeholder extension icons into public/icon/.
 *
 * These are geometry, not art — a rounded square with a "restore" arrow. They
 * exist so the extension loads and looks deliberate during development. Phase 6
 * flags real icons as a human task; rerun this script until then.
 *
 *   node scripts/make-icons.mjs
 *
 * Written by hand rather than pulled from an image library so the repo stays
 * dependency-free for a build-time concern.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icon');
const SIZES = [16, 32, 48, 96, 128];
const SS = 4; // supersample factor, for cheap antialiasing

const BRAND = [0x5a, 0x6c, 0xf5]; // --color-rescue-500
const GLYPH = [0xff, 0xff, 0xff];

const TAU = Math.PI * 2;

function makeCrcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filter, no interlace

  // One filter byte (0 = None) in front of every scanline.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (1 + width * 4);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, src, src + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle covering the whole canvas. */
function insideRoundedSquare(x, y, n, radius) {
  const inset = n * 0.04;
  const lo = inset;
  const hi = n - inset;
  const cx = Math.min(Math.max(x, lo + radius), hi - radius);
  const cy = Math.min(Math.max(y, lo + radius), hi - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

/** The ring of the restore arrow, with a gap where the arrowhead sits. */
function insideRing(x, y, n) {
  const cx = n / 2;
  const cy = n / 2;
  const r = n * 0.28;
  const halfStroke = n * 0.055;
  const d = Math.hypot(x - cx, y - cy);
  if (Math.abs(d - r) > halfStroke) return false;

  // atan2 with y flipped so angles read counterclockwise from the right,
  // matching how the arrowhead below is placed.
  let a = Math.atan2(cy - y, x - cx);
  if (a < 0) a += TAU;
  const gapFrom = (35 / 360) * TAU;
  const gapTo = (105 / 360) * TAU;
  return !(a > gapFrom && a < gapTo);
}

function insideTriangle(x, y, ax, ay, bx, by, cx2, cy2) {
  const s = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const t = (cx2 - bx) * (y - by) - (cy2 - by) * (x - bx);
  const u = (ax - cx2) * (y - cy2) - (ay - cy2) * (x - cx2);
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
}

/** Arrowhead capping the ring at the gap's clockwise edge. */
function insideArrowhead(x, y, n) {
  const cx = n / 2;
  const cy = n / 2;
  const r = n * 0.28;
  const a = (35 / 360) * TAU;
  const px = cx + Math.cos(a) * r;
  const py = cy - Math.sin(a) * r;
  const size = n * 0.15;
  // Tangent pointing the way the arrow travels (counterclockwise, i.e. towards
  // increasing angle), then a triangle straddling it.
  const tx = -Math.sin(a);
  const ty = -Math.cos(a);
  const nx = Math.cos(a);
  const ny = -Math.sin(a);
  return insideTriangle(
    x,
    y,
    px + tx * size * 1.15,
    py + ty * size * 1.15,
    px - nx * size * 0.85 - tx * size * 0.45,
    py - ny * size * 0.85 - ty * size * 0.45,
    px + nx * size * 0.85 - tx * size * 0.45,
    py + ny * size * 0.85 - ty * size * 0.45,
  );
}

function renderIcon(size) {
  const n = size * SS;
  const radius = n * 0.24;
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          if (!insideRoundedSquare(px, py, n, radius)) continue;
          bg++;
          if (insideRing(px, py, n) || insideArrowhead(px, py, n)) fg++;
        }
      }

      const samples = SS * SS;
      const alpha = bg / samples;
      const glyphMix = bg === 0 ? 0 : fg / bg;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.round(BRAND[c] * (1 - glyphMix) + GLYPH[c] * glyphMix);
      }
      out[i + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, out);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `${size}.png`);
  writeFileSync(file, renderIcon(size));
  console.log(`wrote ${file}`);
}
