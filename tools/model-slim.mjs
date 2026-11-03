// 3D モデル（.glb / .vrm）を軽くする（外部ライブラリなし。meshopt の圧縮処理は tools/lib に同梱）
//
//   node tools/model-slim.mjs <入力.glb|.vrm> <出力> [--max 1024] [--normal 512] [--thumb 256] [--webp 0.85] [--meshopt 14]
//
// おすすめ：node tools/model-slim.mjs 入力.vrm 出力.vrm --webp 0.85 --meshopt 14（.glb も同じ）
// - 1 つのファイルにまとまった glb 形式（.glb / .vrm）だけに対応。.gltf + 別ファイルは不可
// - VRM のときは、ファイルに入っているライセンス情報を表示する
//
// - 色のテクスチャは --max、名前に _nml / normal を含むもの（法線マップ）は --normal、
//   VRM のサムネイルは --thumb の大きさまで縮小する（法線マップは、マテリアルの normalTexture に使われているものも含む）
// - --webp を付けると、テクスチャを WebP（glTF の EXT_texture_webp）にする。PNG の 2〜3 割ほどの大きさになる。
//   数字は品質（0〜1）。法線マップは崩れやすいので、品質を 0.95 以上にする。VRM のサムネイルは PNG のまま
//   （WebP の VRM は three.js / MadeInWeb では読めるが、ほかの VRM アプリでは読めないことがある）
// - --meshopt を付けると、メッシュのデータを EXT_meshopt_compression で圧縮する（tools/meshopt-pack.mjs）。
//   数字は精度（ビット数）。14 がおすすめ（見た目は変わらず、メッシュが 2 割ほどの大きさになる）。
//   これも three.js / MadeInWeb では読めるが、ほかの VRM アプリでは読めないことがある
// - 形（メッシュ）・ボーン・表情・揺れものは変更しない（--meshopt でも、目に見えない誤差が出るだけ）
// - 改変・再配布が許可されているモデルにだけ使うこと（VRM の meta を表示するので確認する）
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePNG, encodePNG, resize } from './png.mjs';
import { toWebP } from './webp.mjs';
import { planMeshopt, encodeMeshopt } from './meshopt-pack.mjs';

const args = process.argv.slice(2), flags = {}, pos = [];
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) flags[args[i].slice(2)] = Number(args[++i]); else pos.push(args[i]); }
const [input, output] = pos;
if (!input || !output) { console.error('usage: node tools/model-slim.mjs <in.glb|in.vrm> <out> [--max 1024] [--normal 512] [--thumb 256] [--webp 0.85] [--meshopt 14]'); process.exit(1); }
const MAX = flags.max || 1024, NORMAL = flags.normal || 512, THUMB = flags.thumb || 256;

const src = readFileSync(input);
if (src.toString('ascii', 0, 4) !== 'glTF') throw new Error('glb 形式ではありません');
const jsonLen = src.readUInt32LE(12);
const json = JSON.parse(src.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;
const bin = src.subarray(binStart, binStart + src.readUInt32LE(20 + jsonLen));

const meta = json.extensions?.VRMC_vrm?.meta || json.extensions?.VRM?.meta;
if (meta) {
  console.log(`VRM: ${meta.name || meta.title || '?'} / 作者: ${(meta.authors || [meta.author]).join(', ')}`);
  console.log(`再配布: ${meta.allowRedistribution ?? meta.allowedUserName ?? '?'} / 改変: ${meta.modification ?? meta.licenseName ?? '?'}`);
} else {
  // glb にはライセンスの決まった入れ場所がない（asset.copyright があれば表示する）。入手元で確かめること
  console.log(`glb: ${json.asset?.generator || ''}${json.asset?.copyright ? ' / ' + json.asset.copyright : ''}（ライセンスは入手元で確かめてください）`);
}

// 法線マップの画像：マテリアルの normalTexture に使われているもの（VRoid のように画像に名前がないモデルもあるため）と、名前に _nml / normal を含むもの
const normalImages = new Set();
for (const m of json.materials || []) {
  const t = m.normalTexture && json.textures?.[m.normalTexture.index];
  if (t) normalImages.add(t.source ?? t.extensions?.EXT_texture_webp?.source);
}
const isNormal = i => normalImages.has(i) || /(_nml|normal)/i.test(json.images[i].name || '');

const vrm1Thumb = json.extensions?.VRMC_vrm?.meta?.thumbnailImage;
const vrm0Thumb = json.extensions?.VRM?.meta?.texture != null ? json.textures?.[json.extensions.VRM.meta.texture]?.source : undefined;
const thumbIndex = vrm1Thumb ?? vrm0Thumb;

// 画像ごとに縮小した PNG を用意する
const newImageData = new Map();
for (const [i, im] of (json.images || []).entries()) {
  if (im.mimeType !== 'image/png' || im.bufferView == null) continue;
  const bv = json.bufferViews[im.bufferView];
  const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const limit = i === thumbIndex ? THUMB : isNormal(i) ? NORMAL : MAX;
  let img;
  try { img = decodePNG(data); } catch (err) { console.log(`  ${i} ${im.name}: そのまま（${err.message}）`); continue; }
  if (Math.max(img.w, img.h) <= limit) continue;
  const out = encodePNG(resize(img, limit));
  if (out.length >= data.length) continue;
  newImageData.set(im.bufferView, out);
  console.log(`  ${i} ${im.name}: ${img.w}x${img.h} ${(data.length / 1024).toFixed(0)}KB → ${limit}px ${(out.length / 1024).toFixed(0)}KB`);
}

// WebP にする（サムネイル以外の PNG / JPEG。小さくならなかったものはそのまま）
if (flags.webp) {
  const usedAsTexture = new Set((json.textures || []).map(t => t.source));
  const targets = (json.images || []).map((im, i) => ({ im, i }))
    .filter(({ im, i }) => i !== thumbIndex && im.bufferView != null && usedAsTexture.has(i) && /image\/(png|jpeg)/.test(im.mimeType));
  const datas = targets.map(({ im }) => {
    const bv = json.bufferViews[im.bufferView];
    return newImageData.get(im.bufferView) || bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  });
  const webps = await toWebP(targets.map(({ im }, k) => ({
    data: datas[k], type: im.mimeType,
    quality: isNormal(targets[k].i) ? Math.max(flags.webp, 0.95) : flags.webp,
  })));
  const converted = new Set();
  targets.forEach(({ im, i }, k) => {
    if (webps[k].length >= datas[k].length) return;
    // サムネイルと同じ画像を共有している bufferView は書き換えない
    if (json.images.some((o, j) => j !== i && o.bufferView === im.bufferView)) return;
    newImageData.set(im.bufferView, webps[k]);
    im.mimeType = 'image/webp';
    converted.add(i);
    console.log(`  ${i} ${im.name}: ${(datas[k].length / 1024).toFixed(0)}KB → WebP ${(webps[k].length / 1024).toFixed(0)}KB`);
  });
  if (converted.size) {
    for (const t of json.textures) {
      if (!converted.has(t.source)) continue;
      t.extensions = { ...t.extensions, EXT_texture_webp: { source: t.source } };
      delete t.source;
    }
    for (const key of ['extensionsUsed', 'extensionsRequired']) json[key] = [...new Set([...(json[key] || []), 'EXT_texture_webp'])];
  }
}

// バイナリを組み立て直す（bufferView ごとに 4 バイト境界にそろえて詰め直す）。
// --meshopt のときは、圧縮したデータを buffer 0 に入れ、bufferView 自体は「元の大きさだけを持つ空の buffer 1（fallback）」を指す
if (json.buffers.length !== 1) throw new Error('buffer が 1 つの glb だけに対応しています');
const plan = flags.meshopt ? planMeshopt(json) : new Map();
const parts = [];
let offset = 0, fallbackSize = 0, meshBefore = 0, meshAfter = 0;
const push = data => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; }
  const at = offset;
  parts.push(data);
  offset += data.length;
  return at;
};
for (const [i, bv] of json.bufferViews.entries()) {
  const data = newImageData.get(i) || bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const p = plan.get(i);
  const enc = p && await encodeMeshopt(data, p, flags.meshopt);
  if (enc && enc.data.length < data.length) {
    const at = push(enc.data);
    fallbackSize += (4 - (fallbackSize % 4)) % 4;
    bv.extensions = { ...bv.extensions, EXT_meshopt_compression: { buffer: 0, byteOffset: at, byteLength: enc.data.length, byteStride: p.stride, count: p.count, mode: p.mode, ...(enc.filter ? { filter: enc.filter } : {}) } };
    bv.buffer = 1;
    bv.byteOffset = fallbackSize;
    bv.byteLength = data.length;
    fallbackSize += data.length;
    meshBefore += data.length; meshAfter += enc.data.length;
  } else {
    bv.byteOffset = push(data);
    bv.byteLength = data.length;
  }
}
const tail = (4 - (offset % 4)) % 4;
if (tail) parts.push(Buffer.alloc(tail));
const newBin = Buffer.concat(parts);
json.buffers[0].byteLength = newBin.length;
if (fallbackSize) {
  json.buffers[1] = { byteLength: fallbackSize, extensions: { EXT_meshopt_compression: { fallback: true } } };
  for (const key of ['extensionsUsed', 'extensionsRequired']) json[key] = [...new Set([...(json[key] || []), 'EXT_meshopt_compression'])];
  console.log(`  メッシュ: ${(meshBefore / 1024).toFixed(0)}KB → meshopt ${(meshAfter / 1024).toFixed(0)}KB`);
}

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
