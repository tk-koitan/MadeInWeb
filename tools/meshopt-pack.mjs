// glTF / VRM のメッシュのデータを EXT_meshopt_compression で圧縮する（tools/model-slim.mjs --meshopt から使う）
//
// - JSON の中身（VRM の骨・表情・揺れものなど）は変えず、bufferView の持ち方だけを変える
// - bits を付けると、位置・法線・接線・UV・表情（モーフ）の差分の精度を落として、さらに小さくする（EXPONENTIAL フィルタ）。
//   14 ビットなら、誤差は値の大きさの 1/16000 ほど（身長 1.6m のモデルで 0.1mm 程度。見た目には分からない）
// - 骨の重み・骨の番号・三角形の並びなどは、精度を落とさずに圧縮する
// - アニメーションも圧縮する。時刻は精度を落とさず、値（回転・位置・大きさ・モーフ）は bits の精度にする
// - サンドボックスの展開処理（sandbox/meshopt.js）は、フィルタなしと EXPONENTIAL だけに対応している
import { MeshoptEncoder } from './lib/meshopt_encoder.module.js';

const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const elemSize = a => COMP[a.componentType] * NUM[a.type];
const LOSSY = /^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+)$/;

/** bufferView ごとに、どう圧縮するかを決める。Map(bufferView の番号 → { mode, stride, count, lossy, group: 'mesh' | 'anim' }) */
export function planMeshopt(json) {
  const use = new Map();
  const mark = (bv, kind, size, tri = false, lossy = false) => {
    if (bv == null) return;
    const u = use.get(bv) || { kinds: new Set(), sizes: new Set(), triangles: true, lossy: true };
    u.kinds.add(kind); u.sizes.add(size);
    if (!tri) u.triangles = false;
    if (!lossy) u.lossy = false;
    use.set(bv, u);
  };
  const attr = new Set(), lossyAcc = new Set(), index = new Map();
  for (const m of json.meshes || []) for (const p of m.primitives) {
    for (const [k, a] of Object.entries(p.attributes)) { attr.add(a); if (LOSSY.test(k)) lossyAcc.add(a); }
    for (const t of p.targets || []) for (const [k, a] of Object.entries(t)) { attr.add(a); if (LOSSY.test(k)) lossyAcc.add(a); }
    if (p.indices != null) index.set(p.indices, (p.mode ?? 4) === 4);
  }
  for (const s of json.skins || []) if (s.inverseBindMatrices != null) attr.add(s.inverseBindMatrices);
  // アニメーション：時刻（input）は精度を落とさない。値（output）は落としてよい
  const animAcc = new Set();
  for (const an of json.animations || []) for (const s of an.samplers) {
    attr.add(s.input); animAcc.add(s.input);
    attr.add(s.output); animAcc.add(s.output); lossyAcc.add(s.output);
  }
  const animViews = new Set();
  for (const [i, a] of (json.accessors || []).entries()) {
    const lossy = lossyAcc.has(i) && a.componentType === 5126;
    if (a.sparse) {
      mark(a.sparse.indices.bufferView, 'attr', COMP[a.sparse.indices.componentType]);
      mark(a.sparse.values.bufferView, 'attr', elemSize(a), false, lossy);
    }
    if (a.bufferView == null) continue;
    if (animAcc.has(i)) animViews.add(a.bufferView);
    if (index.has(i)) mark(a.bufferView, 'index', elemSize(a), index.get(i));
    else if (attr.has(i)) mark(a.bufferView, 'attr', elemSize(a), false, lossy);
    else mark(a.bufferView, 'other', 0);
  }
  const plan = new Map();
  for (const [i, u] of use) {
    if (u.kinds.size !== 1 || u.sizes.size !== 1) continue;
    const bv = json.bufferViews[i], kind = [...u.kinds][0], size = bv.byteStride || [...u.sizes][0];
    if (kind === 'attr' && size % 4 === 0 && size <= 256 && bv.byteLength % size === 0) {
      plan.set(i, { mode: 'ATTRIBUTES', stride: size, count: bv.byteLength / size, lossy: u.lossy, group: animViews.has(i) ? 'anim' : 'mesh' });
    } else if (kind === 'index' && (size === 2 || size === 4) && bv.byteLength % size === 0) {
      const count = bv.byteLength / size;
      plan.set(i, { mode: u.triangles && count % 3 === 0 ? 'TRIANGLES' : 'INDICES', stride: size, count, lossy: false, group: 'mesh' });
    }
  }
  return plan;
}

/** 1つの bufferView を圧縮する。{ data, filter? } を返す */
export async function encodeMeshopt(data, p, bits) {
  await MeshoptEncoder.ready;
  let raw = new Uint8Array(data);
  let filter;
  if (bits && p.lossy && p.mode === 'ATTRIBUTES') {
    const f = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    raw = MeshoptEncoder.encodeFilterExp(f, p.count, p.stride, bits, 'SharedComponent');
    filter = 'EXPONENTIAL';
  }
  return { data: Buffer.from(MeshoptEncoder.encodeGltfBuffer(raw, p.count, p.stride, p.mode)), filter };
}
