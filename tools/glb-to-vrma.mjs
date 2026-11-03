// 人型の glb のアニメーションを、VRM 用のアニメーション（.vrma）に変換する（外部ライブラリなし。計算は vendor の three.js）
//
//   node tools/glb-to-vrma.mjs <入力.glb> <出力フォルダ> --tpose <T ポーズのアニメーション名> [--clips 名前,名前,...] [--fps 30]
//
// - 骨の名前が Unreal Engine 形式（pelvis, spine_01, upperarm_l …）のモデルに対応（Quaternius の Universal Animation Library など）
// - アニメーション 1 つにつき .vrma を 1 つ書き出す（ファイル名はアニメーション名）
// - 元の骨の動きを「T ポーズからの回転」に直して焼き込む。VRMA 側の骨は、回転なしの T ポーズを基準にする
//   （VRM 1.0 と同じく、キャラクターは +Z を向く。元のモデルが -Z を向いていれば自動で向きを直す）
// - 腰（hips）の位置の動きも入れる。指・つま先も入れる
// - 書き出した .vrma はそのまま ctx.loadVRMAnimation で読める。tools/model-slim.mjs --meshopt でさらに軽くできる
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from '../vendor/three.module.min.js';

const args = process.argv.slice(2), flags = {}, pos = [];
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i]; else pos.push(args[i]); }
const [input, outDir] = pos;
if (!input || !outDir || !flags.tpose) {
  console.error('usage: node tools/glb-to-vrma.mjs <in.glb> <outDir> --tpose <T ポーズのアニメーション名> [--clips a,b,c] [--fps 30]');
  process.exit(1);
}
const FPS = Number(flags.fps) || 30;

// ---- glb を読む
const src = readFileSync(input);
if (src.toString('ascii', 0, 4) !== 'glTF') throw new Error('glb 形式ではありません');
const jsonLen = src.readUInt32LE(12);
const json = JSON.parse(src.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8;
const bin = src.subarray(binStart, binStart + src.readUInt32LE(20 + jsonLen));
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(i) {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
  if (a.componentType !== 5126) throw new Error('float 以外のアニメーションには対応していません');
  const n = NUM[a.type], stride = (bv.byteStride || n * 4) / 4;
  const f = new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), (a.count - 1) * stride + n);
  const out = new Float32Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = f[k * stride + c];
  return out;
}

// ---- 骨の対応（Unreal Engine 形式 → VRM の humanoid）
const MAP = { pelvis: 'hips', spine_01: 'spine', spine_02: 'chest', spine_03: 'upperChest', neck_01: 'neck', Head: 'head', head: 'head' };
for (const [s, S] of [['l', 'left'], ['r', 'right']]) {
  Object.assign(MAP, {
    [`clavicle_${s}`]: `${S}Shoulder`, [`upperarm_${s}`]: `${S}UpperArm`, [`lowerarm_${s}`]: `${S}LowerArm`, [`hand_${s}`]: `${S}Hand`,
    [`thigh_${s}`]: `${S}UpperLeg`, [`calf_${s}`]: `${S}LowerLeg`, [`foot_${s}`]: `${S}Foot`, [`ball_${s}`]: `${S}Toes`,
    [`thumb_01_${s}`]: `${S}ThumbMetacarpal`, [`thumb_02_${s}`]: `${S}ThumbProximal`, [`thumb_03_${s}`]: `${S}ThumbDistal`,
  });
  for (const [f, F] of [['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Little']]) {
    Object.assign(MAP, { [`${f}_01_${s}`]: `${S}${F}Proximal`, [`${f}_02_${s}`]: `${S}${F}Intermediate`, [`${f}_03_${s}`]: `${S}${F}Distal` });
  }
}
// VRM の骨の親子（出力する VRMA の階層）
const PARENT = { hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck' };
for (const S of ['left', 'right']) {
  Object.assign(PARENT, {
    [`${S}Shoulder`]: 'upperChest', [`${S}UpperArm`]: `${S}Shoulder`, [`${S}LowerArm`]: `${S}UpperArm`, [`${S}Hand`]: `${S}LowerArm`,
    [`${S}UpperLeg`]: 'hips', [`${S}LowerLeg`]: `${S}UpperLeg`, [`${S}Foot`]: `${S}LowerLeg`, [`${S}Toes`]: `${S}Foot`,
    [`${S}ThumbMetacarpal`]: `${S}Hand`, [`${S}ThumbProximal`]: `${S}ThumbMetacarpal`, [`${S}ThumbDistal`]: `${S}ThumbProximal`,
  });
  for (const F of ['Index', 'Middle', 'Ring', 'Little']) {
    Object.assign(PARENT, { [`${S}${F}Proximal`]: `${S}Hand`, [`${S}${F}Intermediate`]: `${S}${F}Proximal`, [`${S}${F}Distal`]: `${S}${F}Intermediate` });
  }
}
const nodeOf = {};                 // humanoid の名前 → 元のノード番号
json.nodes.forEach((n, i) => { const h = MAP[n.name]; if (h && !(h in nodeOf)) nodeOf[h] = i; });
const bones = Object.keys(PARENT).filter(h => h in nodeOf);
const effectiveParent = h => { let p = PARENT[h]; while (p && !(p in nodeOf)) p = PARENT[p]; return p; };   // upperChest がないモデルなど
if (!nodeOf.hips) throw new Error('腰の骨（pelvis）が見つかりません');

// ---- 元のモデルを three の物体として組み立てる（骨の位置・回転を計算するため）
const objs = json.nodes.map(n => {
  const o = new THREE.Object3D();
  o.name = n.name || '';
  if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
  if (n.translation) o.position.fromArray(n.translation);
  if (n.rotation) o.quaternion.fromArray(n.rotation);
  if (n.scale) o.scale.fromArray(n.scale);
  return o;
});
const rest = objs.map(o => ({ p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
json.nodes.forEach((n, i) => (n.children || []).forEach(c => objs[i].add(objs[c])));
const world = new THREE.Object3D();
for (const r of json.scenes[json.scene || 0].nodes) world.add(objs[r]);

/** アニメーションの時刻 t の姿勢にする（チャンネルのないノードは元の姿勢） */
function poseAt(anim, t) {
  objs.forEach((o, i) => { o.position.copy(rest[i].p); o.quaternion.copy(rest[i].q); o.scale.copy(rest[i].s); });
  for (const ch of anim.channels) {
    const s = anim._samplers[ch.sampler], o = objs[ch.target.node];
    if (!o || !['translation', 'rotation', 'scale'].includes(ch.target.path)) continue;
    const times = s.input, n = ch.target.path === 'rotation' ? 4 : 3;
    let k = 0;
    while (k < times.length - 2 && times[k + 1] <= t) k++;
    const t0 = times[k], t1 = times[Math.min(k + 1, times.length - 1)];
    const a = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    const k1 = Math.min(k + 1, times.length - 1);
    const v = i => s.output.subarray(i * n, i * n + n);
    if (ch.target.path === 'rotation') {
      const q0 = new THREE.Quaternion().fromArray(v(k)), q1 = new THREE.Quaternion().fromArray(v(k1));
      o.quaternion.copy(s.interpolation === 'STEP' ? q0 : q0.slerp(q1, a));
    } else {
      const p0 = new THREE.Vector3().fromArray(v(k)), p1 = new THREE.Vector3().fromArray(v(k1));
      (ch.target.path === 'translation' ? o.position : o.scale).copy(s.interpolation === 'STEP' ? p0 : p0.lerp(p1, a));
    }
  }
  world.updateMatrixWorld(true);
}
for (const a of json.animations) {
  a._samplers = a.samplers.map(s => ({ input: readAccessor(s.input), output: readAccessor(s.output), interpolation: s.interpolation || 'LINEAR' }));
  a._duration = Math.max(...a._samplers.map(s => s.input[s.input.length - 1]));
}

// ---- T ポーズ（基準の姿勢）
const tposeAnim = json.animations.find(a => a.name === flags.tpose);
if (!tposeAnim) throw new Error(`T ポーズのアニメーション「${flags.tpose}」がありません。あるもの: ${json.animations.map(a => a.name).join(', ')}`);
poseAt(tposeAnim, 0);
const wPos = h => objs[nodeOf[h]].getWorldPosition(new THREE.Vector3());
const wRot = h => objs[nodeOf[h]].getWorldQuaternion(new THREE.Quaternion());
// 向き：VRM はキャラクターの左手が +X、前が +Z。逆なら Y 軸まわりに 180° 回す
const facingFlip = wPos('leftHand') && wPos('leftHand').x < wPos('rightHand').x;
const FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingFlip ? Math.PI : 0);
const fixV = v => v.applyQuaternion(FIX);
const restWorldRot = {}, restWorldPos = {};
for (const h of bones) { restWorldRot[h] = wRot(h); restWorldPos[h] = fixV(wPos(h)); }
const toe = bones.includes('leftToes') ? restWorldPos.leftToes.z - restWorldPos.leftFoot.z : 0;
console.log(`骨 ${bones.length} 本 / 向きの補正 ${facingFlip ? 'あり（180°）' : 'なし'} / つま先が前 ${toe > 0 ? 'OK' : '？'} / 腰の高さ ${restWorldPos.hips.y.toFixed(3)}m`);

// ---- VRMA を書き出す
function writeVrma(anim, file) {
  const frames = Math.max(2, Math.round(anim._duration * FPS) + 1);
  const times = new Float32Array(frames);
  const rot = Object.fromEntries(bones.map(h => [h, new Float32Array(frames * 4)]));
  const hipsPos = new Float32Array(frames * 3);
  const delta = {};
  for (let f = 0; f < frames; f++) {
    const t = Math.min(anim._duration, f / FPS);
    times[f] = t;
    poseAt(anim, t);
    // T ポーズからの回転（ワールド座標）：Δ = 今の回転 × T ポーズの回転⁻¹。向きの補正もここで掛ける
    for (const h of bones) delta[h] = FIX.clone().multiply(wRot(h)).multiply(restWorldRot[h].clone().invert()).multiply(FIX.clone().invert());
    for (const h of bones) {
      const p = effectiveParent(h);
      const local = p ? delta[p].clone().invert().multiply(delta[h]) : delta[h].clone();
      // 前のフレームと符号をそろえる（補間で遠回りしないように）
      if (f > 0) {
        const r = rot[h], d = local.x * r[(f - 1) * 4] + local.y * r[(f - 1) * 4 + 1] + local.z * r[(f - 1) * 4 + 2] + local.w * r[(f - 1) * 4 + 3];
        if (d < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      }
      rot[h].set([local.x, local.y, local.z, local.w], f * 4);
    }
    hipsPos.set(fixV(wPos('hips')).toArray(), f * 3);
  }

  // glTF を組み立てる。同じ種類のデータ（時刻 / 回転 / 位置）は 1 つの bufferView にまとめる
  // （bufferView が骨の数だけあると JSON が大きくなり、meshopt で圧縮するときも区切りごとの設定が増えるため）
  const parts = [], bufferViews = [], accessors = [];
  let offset = 0;
  const groups = { SCALAR: [], VEC4: [], VEC3: [] };
  const addAccessor = (arr, type, minmax) => {
    const acc = { componentType: 5126, count: arr.length / NUM[type], type, _data: arr };
    if (minmax) { acc.min = [Math.min(...arr)]; acc.max = [Math.max(...arr)]; }
    accessors.push(acc);
    groups[type].push(acc);
    return accessors.length - 1;
  };
  const packViews = () => {
    for (const type of ['SCALAR', 'VEC4', 'VEC3']) {
      if (!groups[type].length) continue;
      let inView = 0;
      for (const acc of groups[type]) {
        const buf = Buffer.from(acc._data.buffer, acc._data.byteOffset, acc._data.byteLength);
        parts.push(buf);
        acc.bufferView = bufferViews.length;
        acc.byteOffset = inView;
        inView += buf.length;
        delete acc._data;
      }
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: inView });
      offset += inView;
    }
  };
  const nodes = bones.map(h => {
    const p = effectiveParent(h);
    const t = restWorldPos[h].clone().sub(p ? restWorldPos[p] : new THREE.Vector3());
    return { name: h, translation: t.toArray() };
  });
  bones.forEach((h, i) => {
    const kids = bones.map((c, j) => (effectiveParent(c) === h ? j : -1)).filter(j => j >= 0);
    if (kids.length) nodes[i].children = kids;
  });
  const timeAcc = addAccessor(times, 'SCALAR', true);
  const samplers = [], channels = [];
  bones.forEach((h, i) => {
    samplers.push({ input: timeAcc, output: addAccessor(rot[h], 'VEC4'), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: i, path: 'rotation' } });
  });
  samplers.push({ input: timeAcc, output: addAccessor(hipsPos, 'VEC3'), interpolation: 'LINEAR' });
  channels.push({ sampler: samplers.length - 1, target: { node: bones.indexOf('hips'), path: 'translation' } });
  packViews();
  const binOut = Buffer.concat(parts);
  const out = {
    asset: { version: '2.0', generator: 'MadeInWeb tools/glb-to-vrma.mjs' },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones: Object.fromEntries(bones.map((h, i) => [h, { node: i }])) } } },
    scene: 0,
    scenes: [{ nodes: [bones.indexOf('hips')] }],
    nodes,
    animations: [{ name: anim.name, samplers, channels }],
    accessors, bufferViews,
    buffers: [{ byteLength: binOut.length }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(out), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const bpad = (4 - (binOut.length % 4)) % 4;
  const binBuf = bpad ? Buffer.concat([binOut, Buffer.alloc(bpad)]) : binOut;
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  jh.writeUInt32LE(jsonBuf.length, 0); jh.write('JSON', 4);
  bh.writeUInt32LE(binBuf.length, 0); bh.write('BIN\0', 4);
  writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, binBuf]));
  console.log(`  ${anim.name}: ${anim._duration.toFixed(2)}秒 ${frames}フレーム → ${file}（${(binBuf.length / 1024).toFixed(0)}KB）`);
}

mkdirSync(outDir, { recursive: true });
const wanted = flags.clips ? flags.clips.split(',') : json.animations.map(a => a.name);
for (const name of wanted) {
  const anim = json.animations.find(a => a.name === name);
  if (!anim) { console.log(`  ${name}: ありません`); continue; }
  writeVrma(anim, join(outDir, `${name}.vrma`));
}
