// 生成した画像をゲーム用の素材に整える（外部ライブラリなし）
//
//   node tools/sprite.mjs <入力.png> <出力.png> [--max 256] [--opaque] [--pad 4]
//
// 透過素材（既定）:
//   - アルファ 16 未満を 0、240 以上を 255 に揃える（生成画像のかすかなゴミと半透明を除く）
//   - 中身の範囲で切り抜き、周りに --pad px の余白を付ける
//   - 長い辺が --max px になるよう縮小する（アルファを考慮した面積平均）
// --opaque: テクスチャ用。アルファ処理と切り抜きをせず、縮小だけする
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const flags = {}, positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--opaque') flags.opaque = true;
  else if (args[i] === '--max' || args[i] === '--pad') flags[args[i].slice(2)] = args[++i];
  else positional.push(args[i]);
}
const opt = (name, def) => flags[name.slice(2)] ?? def;
const [input, output] = positional;
if (!input || !output) {
  console.error('usage: node tools/sprite.mjs <in.png> <out.png> [--max 256] [--opaque] [--pad 4]');
  process.exit(1);
}
const MAX = Number(opt('--max', 256));
const PAD = Number(opt('--pad', 4));
const OPAQUE = !!flags.opaque;

// ---------------------------------------------------------------- PNG 読み込み（8bit, RGB/RGBA, 非インターレース）
function decodePNG(buf) {
  let p = 8, w, h, bd, ct, il;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; il = d[12]; }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (bd !== 8 || il || (ct !== 6 && ct !== 2)) throw new Error(`未対応の PNG 形式です (bitDepth=${bd}, colorType=${ct}, interlace=${il})`);
  const ch = ct === 6 ? 4 : 3, stride = w * ch, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = px[i * ch]; rgba[i * 4 + 1] = px[i * ch + 1]; rgba[i * 4 + 2] = px[i * ch + 2];
    rgba[i * 4 + 3] = ch === 4 ? px[i * ch + 3] : 255;
  }
  return { w, h, rgba };
}

// ---------------------------------------------------------------- PNG 書き出し（RGBA）
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG({ w, h, rgba }) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- 処理
function cleanAlpha(img) {
  const a = img.rgba;
  for (let i = 3; i < a.length; i += 4) { if (a[i] < 16) a[i] = 0; else if (a[i] >= 240) a[i] = 255; }
}
function trim(img, pad) {
  const { w, h, rgba } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('画像が完全に透明です');
  const nw = x1 - x0 + 1 + pad * 2, nh = y1 - y0 + 1 + pad * 2, out = new Uint8Array(nw * nh * 4);
  for (let y = y0; y <= y1; y++) {
    out.set(rgba.subarray((y * w + x0) * 4, (y * w + x1 + 1) * 4), ((y - y0 + pad) * nw + pad) * 4);
  }
  return { w: nw, h: nh, rgba: out };
}
/** 面積平均で縮小。色はアルファで重み付けして、縁が黒ずまないようにする */
function resize(img, max) {
  const { w, h, rgba } = img, s = Math.min(1, max / Math.max(w, h));
  if (s === 1) return img;
  const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s)), out = new Uint8Array(nw * nh * 4);
  const sx = w / nw, sy = h / nh;
  for (let oy = 0; oy < nh; oy++) {
    const fy0 = oy * sy, fy1 = fy0 + sy;
    for (let ox = 0; ox < nw; ox++) {
      const fx0 = ox * sx, fx1 = fx0 + sx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) {
        const wy = Math.min(fy1, y + 1) - Math.max(fy0, y);
        for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
          const wgt = wy * (Math.min(fx1, x + 1) - Math.max(fx0, x)), i = (y * w + x) * 4, al = rgba[i + 3] / 255;
          r += rgba[i] * al * wgt; g += rgba[i + 1] * al * wgt; b += rgba[i + 2] * al * wgt; a += al * wgt; area += wgt;
        }
      }
      const o = (oy * nw + ox) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / area) * 255);
    }
  }
  return { w: nw, h: nh, rgba: out };
}

let img = decodePNG(readFileSync(input));
const before = `${img.w}x${img.h}`;
if (!OPAQUE) { cleanAlpha(img); img = trim(img, PAD); }
img = resize(img, MAX);
if (!OPAQUE) cleanAlpha(img);
else for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
const png = encodePNG(img);
writeFileSync(output, png);
console.log(`${input} (${before}) -> ${output} (${img.w}x${img.h}, ${(png.length / 1024).toFixed(1)} KB)`);
