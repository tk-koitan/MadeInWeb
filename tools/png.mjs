// PNG の読み書きと縮小（外部ライブラリなし）。8bit・非インターレースの RGB / RGBA のみ対応
import { inflateSync, deflateSync } from 'node:zlib';

export function decodePNG(buf) {
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
    const row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[prev + x] : 0, c = x >= ch && y ? px[prev + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { w, h, ch, px };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** ch = 3（RGB）か 4（RGBA）。各行に Paeth 以外の簡単なフィルタ（Up）を使って圧縮率を上げる */
export function encodePNG({ w, h, ch, px }) {
  const stride = w * ch, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = y ? 2 : 0;
    for (let x = 0; x < stride; x++) raw[o + 1 + x] = (px[y * stride + x] - (y ? px[(y - 1) * stride + x] : 0)) & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** 長い辺が max 以下になるよう面積平均で縮小する */
export function resize(img, max) {
  const { w, h, ch, px } = img, s = Math.min(1, max / Math.max(w, h));
  if (s === 1) return img;
  const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s)), out = Buffer.alloc(nw * nh * ch);
  const sx = w / nw, sy = h / nh, acc = new Float64Array(ch);
  for (let oy = 0; oy < nh; oy++) {
    const fy0 = oy * sy, fy1 = fy0 + sy;
    for (let ox = 0; ox < nw; ox++) {
      const fx0 = ox * sx, fx1 = fx0 + sx;
      acc.fill(0);
      let area = 0;
      for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) {
        const wy = Math.min(fy1, y + 1) - Math.max(fy0, y);
        for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
          const wgt = wy * (Math.min(fx1, x + 1) - Math.max(fx0, x)), i = (y * w + x) * ch;
          for (let c = 0; c < ch; c++) acc[c] += px[i + c] * wgt;
          area += wgt;
        }
      }
      const o = (oy * nw + ox) * ch;
      for (let c = 0; c < ch; c++) out[o + c] = Math.round(acc[c] / area);
    }
  }
  return { w: nw, h: nh, ch, px: out };
}
