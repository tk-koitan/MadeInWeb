// glTF / VRM の EXT_meshopt_compression（メッシュの圧縮）を展開する。
// 公式の展開処理は WebAssembly を使うが、サンドボックスの CSP では WebAssembly を動かせない（動かせるようにすると守りが弱くなる）。
// そこで meshoptimizer に付属の JavaScript だけの展開処理（reference）を使い、
// それが対応していない EXPONENTIAL フィルタだけをここで展開する。
// tools/vrm-slim.mjs --meshopt が書き出すのは、フィルタなしと EXPONENTIAL だけ
import { MeshoptDecoder as Reference } from '../vendor/meshoptimizer/meshopt_decoder_reference.js';

/** EXPONENTIAL フィルタ：32 ビットごとに、上位 8 ビットが指数・下位 24 ビットが仮数（どちらも符号付き） */
function decodeExponential(target) {
  const n = target.byteLength >> 2;
  const v = new Int32Array(target.buffer, target.byteOffset, n);
  const f = new Float32Array(target.buffer, target.byteOffset, n);
  for (let i = 0; i < n; i++) {
    const x = v[i];
    f[i] = ((x << 8) >> 8) * 2 ** (x >> 24);
  }
}

export const MeshoptDecoder = {
  supported: true,
  ready: Promise.resolve(),
  decodeGltfBuffer(target, count, size, source, mode, filter) {
    if (filter && filter !== 'NONE' && filter !== 'EXPONENTIAL') {
      throw new Error(`この VRM / glTF の圧縮（meshopt の ${filter} フィルタ）には対応していません。tools/vrm-slim.mjs --meshopt で作り直してください`);
    }
    Reference.decodeGltfBuffer(target, count, size, source, mode);
    if (filter === 'EXPONENTIAL') decodeExponential(target);
  },
};
