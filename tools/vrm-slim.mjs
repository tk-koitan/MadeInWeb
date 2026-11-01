// VRM（.vrm / .glb）のテクスチャを縮めて軽くする（外部ライブラリなし）
//
//   node tools/vrm-slim.mjs <入力.vrm> <出力.vrm> [--max 1024] [--normal 512] [--thumb 256]
//
// - 色のテクスチャは --max、名前に _nml / normal を含むもの（法線マップ）は --normal、
//   VRM のサムネイルは --thumb の大きさまで縮小する
// - 形（メッシュ）・ボーン・表情・揺れものは変更しない
// - 改変・再配布が許可されているモデルにだけ使うこと（VRM の meta を表示するので確認する）
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePNG, encodePNG, resize } from './png.mjs';

const args = process.argv.slice(2), flags = {}, pos = [];
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) flags[args[i].slice(2)] = Number(args[++i]); else pos.push(args[i]); }
const [input, output] = pos;
if (!input || !output) { console.error('usage: node tools/vrm-slim.mjs <in.vrm> <out.vrm> [--max 1024] [--normal 512] [--thumb 256]'); process.exit(1); }
const MAX = flags.max || 1024, NORMAL = flags.normal || 512, THUMB = flags.thumb || 256;

const src = readFileSync(input);
if (src.toString('ascii', 0, 4) !== 'glTF') throw new Error('glb 形式ではありません');
const jsonLen = src.readUInt32LE(12);
const json = JSON.parse(src.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;
const bin = src.subarray(binStart, binStart + src.readUInt32LE(20 + jsonLen));

const meta = json.extensions?.VRMC_vrm?.meta || json.extensions?.VRM?.meta || {};
console.log(`モデル: ${meta.name || meta.title || '?'} / 作者: ${(meta.authors || [meta.author]).join(', ')}`);
console.log(`再配布: ${meta.allowRedistribution ?? meta.allowedUserName ?? '?'} / 改変: ${meta.modification ?? meta.licenseName ?? '?'}`);

const vrm1Thumb = json.extensions?.VRMC_vrm?.meta?.thumbnailImage;
const vrm0Thumb = json.extensions?.VRM?.meta?.texture != null ? json.textures?.[json.extensions.VRM.meta.texture]?.source : undefined;
const thumbIndex = vrm1Thumb ?? vrm0Thumb;

// 画像ごとに縮小した PNG を用意する
const newImageData = new Map();
for (const [i, im] of (json.images || []).entries()) {
  if (im.mimeType !== 'image/png' || im.bufferView == null) continue;
  const bv = json.bufferViews[im.bufferView];
  const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const limit = i === thumbIndex ? THUMB : /(_nml|normal)/i.test(im.name || '') ? NORMAL : MAX;
  let img;
  try { img = decodePNG(data); } catch (err) { console.log(`  ${i} ${im.name}: そのまま（${err.message}）`); continue; }
  if (Math.max(img.w, img.h) <= limit) continue;
  const out = encodePNG(resize(img, limit));
  if (out.length >= data.length) continue;
  newImageData.set(im.bufferView, out);
  console.log(`  ${i} ${im.name}: ${img.w}x${img.h} ${(data.length / 1024).toFixed(0)}KB → ${limit}px ${(out.length / 1024).toFixed(0)}KB`);
}

// バイナリを組み立て直す（bufferView ごとに 4 バイト境界にそろえて詰め直す）
const parts = [];
let offset = 0;
for (const bv of json.bufferViews) {
  const data = newImageData.get(json.bufferViews.indexOf(bv)) || bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; }
  bv.byteOffset = offset;
  bv.byteLength = data.length;
  parts.push(data);
  offset += data.length;
}
const tail = (4 - (offset % 4)) % 4;
if (tail) parts.push(Buffer.alloc(tail));
const newBin = Buffer.concat(parts);
json.buffers[0].byteLength = newBin.length;

let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
const jpad = (4 - (jsonBuf.length % 4)) % 4;
if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8);
jh.writeUInt32LE(jsonBuf.length, 0); jh.write('JSON', 4);
bh.writeUInt32LE(newBin.length, 0); bh.write('BIN\0', 4);
const result = Buffer.concat([header, jh, jsonBuf, bh, newBin]);
writeFileSync(output, result);
console.log(`${input} (${(src.length / 1e6).toFixed(2)}MB) -> ${output} (${(result.length / 1e6).toFixed(2)}MB)`);
