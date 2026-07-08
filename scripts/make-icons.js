'use strict';
// Renders the app icon (schoolhouse on green) to PNG at 192 and 512 px with
// no image libraries — raw RGBA pixels + zlib + hand-built PNG chunks.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;  // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;      // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const GREEN = [0x1e, 0x6b, 0x3a, 255], WHITE = [255, 255, 255, 255],
  RED = [0xb3, 0x28, 0x2d, 255], CLEAR = [0, 0, 0, 0];

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 512;   // design coordinates are on a 512 grid
  const put = (x, y, c) => { const o = (y * size + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3]; };
  const inRect = (x, y, rx, ry, rw, rh) => x >= rx * s && x < (rx + rw) * s && y >= ry * s && y < (ry + rh) * s;
  const r = 96 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // rounded-corner green tile
      let inside = true;
      const cx = x < r ? r : x > size - r ? size - r : x;
      const cy = y < r ? r : y > size - r ? size - r : y;
      if ((x < r || x > size - r) && (y < r || y > size - r)) {
        inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      }
      if (!inside) { put(x, y, CLEAR); continue; }
      let c = GREEN;
      // roof triangle: (256,96)-(96,208)-(416,208)
      const yy = y / s, xx = x / s;
      if (yy >= 96 && yy <= 208) {
        const half = 160 * (yy - 96) / 112;
        if (xx >= 256 - half && xx <= 256 + half) c = WHITE;
      }
      if (inRect(x, y, 128, 208, 256, 180)) c = WHITE;
      if (inRect(x, y, 232, 288, 48, 100)) c = GREEN;   // door
      if (inRect(x, y, 152, 240, 48, 40)) c = GREEN;    // window L
      if (inRect(x, y, 312, 240, 48, 40)) c = GREEN;    // window R
      if (inRect(x, y, 240, 52, 12, 56)) c = WHITE;     // flag pole
      if (yy >= 52 && yy <= 84 && xx >= 252) {          // flag
        const t = (xx - 252) / 50;
        if (t <= 1 && yy >= 52 + t * 14 && yy <= 84 - t * 18 * (1 - 0.2)) c = RED;
      }
      put(x, y, c);
    }
  }
  return png(size, size, px);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), draw(size));
  console.log(`icon-${size}.png written`);
}
