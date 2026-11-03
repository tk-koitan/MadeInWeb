// MadeInWeb SDK ランタイム（サンドボックス iframe の中で動く）
// - 本体とは postMessage だけでやり取りする
// - ミニゲーム（games/<id>/main.js）を読み込み、ctx API を渡して動かす
// - 座標は論理解像度 540×960（左上が原点、y は下向き）
import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three-addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/three-addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three-addons/postprocessing/OutputPass.js';
import { loadPlanck, createPhysics, physicsStep, push as pushNode } from './physics.js';
import { loadCannon, createPhysics3d, physics3dStep } from './physics3d.js';

const W = 540, H = 960;
// ゲーム内時間は 120bpm 基準（1拍 = 0.5秒）。テンポが上がると dt に倍率が掛かる。
const BASE_BPM = 120, SEC_PER_BEAT = 60 / BASE_BPM;
// ヒットストップ：勝敗が決まった瞬間、HITSTOP_SEC 秒（実時間）だけ時間の進みを HITSTOP_SCALE 倍にする
const HITSTOP_SEC = 0.25, HITSTOP_SCALE = 0.15;
const parentWin = window.parent;
const send = msg => parentWin.postMessage(msg, '*');

// ---------------------------------------------------------------- 描画
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  send({ type: 'fatal', message: `WebGL を初期化できません。ブラウザのハードウェアアクセラレーション設定を確認してください。\n${err && err.message ? err.message : err}` });
  throw err;
}
self.__mwBooted = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0xffffff);
renderer.autoClear = false;
// 影：ライトと物体で castShadow / receiveShadow を true にしたときだけ描かれる（使わないゲームには影響しない）
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let pmrem = null;   // 環境マップ（ctx.environment）を作る道具。使うゲームが出たときに作る
const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };
/** 3D の層を描く直前に、そのゲームのトーンマッピングにする（2D の層はかけない） */
function useTone(v, on) {
  renderer.toneMapping = on && v.toneMapping ? v.toneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = on && v.toneMapping ? v.exposure : 1;
}
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

// 2層で描く：先に 3D の層（s.scene + s.camera3D）、その上に 2D の層（s.scene2D + camera2D）を重ねる。
// three の座標では y が上向きなので、Node が y を反転して置く（画面の (x, y) → three の (x, -y)）。
// シーンとカメラはゲーム（セッション）ごとに持つ。次のゲームを裏で読み込んでいる間も、いまのゲームを描き続けられる
const camera2D = new THREE.OrthographicCamera(0, W, 0, -H, 0.1, 4000);
camera2D.position.set(0, 0, 2000);

/**
 * 3D の層のカメラを作る（ゲームごとに作り直すので、前のゲームの変更は残らない）。
 * どちらのカメラでも、奥行き z = 0 の面がちょうど 540×960 の画面に一致する。
 *   ortho       … 遠近感なし（2D と同じ映り方）
 *   perspective … 遠近感あり。z がプラス（手前）ほど大きく、マイナス（奥）ほど小さく映る
 */
function makeCamera3D(kind) {
  if (kind === 'perspective') {
    const fov = 50, dist = (H / 2) / Math.tan((fov / 2) * Math.PI / 180);
    const cam = new THREE.PerspectiveCamera(fov, W / H, 1, 8000);
    cam.position.set(W / 2, -H / 2, dist);
    cam.lookAt(W / 2, -H / 2, 0);
    return cam;
  }
  const cam = new THREE.OrthographicCamera(0, W, 0, -H, 0.1, 4000);
  cam.position.set(0, 0, 2000);
  return cam;
}

// ---------------------------------------------------------------- 素材ファイルの取得
// サンドボックスは通信できない（CSP）ので、本体に頼んで「自分のゲームフォルダ内のファイル」だけを受け取る
const assetRequests = new Map();
let assetReqId = 0;
function fetchAsset(s, path) {
  return new Promise((resolve, reject) => {
    const reqId = ++assetReqId;
    assetRequests.set(reqId, { resolve, reject });
    send({ type: 'fetchAsset', runId: s.runId, reqId, path: String(path) });
    setTimeout(() => { if (assetRequests.delete(reqId)) reject(new Error(`読み込みがタイムアウトしました: ${path}`)); }, 30000);
  });
}

// ---------------------------------------------------------------- 読み込みの内訳（本体のデバッグ表示に出す）
/** t0 からの経過時間を本体に知らせて、いまの時刻を返す */
function timing(s, label, t0) {
  const now = performance.now();
  send({ type: 'loadinfo', runId: s.runId, label, ms: Math.round(now - t0) });
  return now;
}

// ---------------------------------------------------------------- glTF / VRM（使うゲームが呼んだときだけライブラリを読み込む）
let gltfLib = null, vrmLib = null;
// meshopt で圧縮したメッシュ（tools/model-slim.mjs --meshopt）も読めるように、展開処理も一緒に読み込む
const loadGltfLib = () => (gltfLib ||= Promise.all([import('../vendor/three-addons/loaders/GLTFLoader.js'), import('./meshopt.js')])
  .then(([gltf, meshopt]) => ({ ...gltf, ...meshopt })));
function loadVrmLib() {
  vrmLib ||= Promise.all([
    loadGltfLib(),
    import('../vendor/three-vrm/three-vrm.module.min.js'),
    import('../vendor/three-vrm/three-vrm-animation.module.min.js'),
  ]).then(([gltf, vrm, anim]) => ({ ...gltf, ...vrm, ...anim }));
  return vrmLib;
}
let vrmUtils = null;   // 片付け用（読み込み後にセット）

// glTF の埋め込み画像は Blob の URL になる。three の標準の ImageBitmapLoader は fetch を使うので CSP で止まる。
// そこで URL から元の Blob を引けるように記録しておき、createImageBitmap(blob) で直接展開する（通信なし）。
// createImageBitmap は別スレッドで画像を展開するので、最初の描画で画面が止まらない
const blobOfUrl = new Map();
{
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = obj => { const url = create(obj); if (obj instanceof Blob) blobOfUrl.set(url, obj); return url; };
  URL.revokeObjectURL = url => { blobOfUrl.delete(url); revoke(url); };
}
// 古い Safari（16 以前）の createImageBitmap は glTF のテクスチャで不具合があるので使わない（three の GLTFLoader と同じ判断）
const safariVersion = (/^((?!chrome|android).)*safari/i.test(navigator.userAgent) && (navigator.userAgent.match(/Version\/(\d+)/) || [])[1]) || 0;
const USE_BITMAP = typeof createImageBitmap === 'function' && !(safariVersion && Number(safariVersion) < 17);
const embeddedImageLoader = {
  isImageBitmapLoader: true,        // GLTFLoader は onLoad の結果（ImageBitmap か <img>）から Texture を作る
  setCrossOrigin() { return this; },
  setRequestHeader() { return this; },
  load(url, onLoad, onProgress, onError) {
    const viaImg = () => new THREE.ImageLoader().load(url, onLoad, undefined, onError);
    const blob = blobOfUrl.get(url);
    if (USE_BITMAP && blob) createImageBitmap(blob, { premultiplyAlpha: 'none' }).then(onLoad, viaImg);
    else viaImg();
  },
};

/** glTF / VRM を読み込むローダー。埋め込み画像は通信を使わずに読む（CSP で fetch が使えないため） */
function makeGltfLoader(lib, plugin) {
  const loader = new lib.GLTFLoader();
  loader.setMeshoptDecoder(lib.MeshoptDecoder);
  loader.register(parser => {
    parser.textureLoader = embeddedImageLoader;
    return { name: 'madeinweb_embedded_images' };
  });
  if (plugin) loader.register(plugin);
  return loader;
}

// ---------------------------------------------------------------- ポストエフェクト
// ミニゲームが ctx.bloom() / ctx.addPass() を呼んだときだけ使う（使わないゲームは今までどおり直接描く）。
// layers: '3d' … 3D の層だけにかける（2D の層はあとから、くっきりしたまま重ねる）
//         'all' … 2D の層も含めた画面全体にかける
const FX_PIXEL_RATIO = () => Math.min(renderer.getPixelRatio(), 1.5);   // スマホで重くなりすぎないように
function ensureComposer(s, layers) {
  if (s.composer) return s.composer;
  s.fxLayers = layers === 'all' ? 'all' : '3d';
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(FX_PIXEL_RATIO());
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(s.scene, s.camera3D));
  if (s.fxLayers === 'all') {
    const p2 = new RenderPass(s.scene2D, camera2D);
    p2.clear = false;
    p2.clearDepth = true;
    composer.addPass(p2);
  }
  composer.addPass(new OutputPass());   // 色空間の変換。常に最後
  s.composer = composer;
  return composer;
}
/** 出力の手前（OutputPass の前）にパスを追加する */
function insertPass(s, pass, layers) {
  const c = ensureComposer(s, layers);
  c.insertPass(pass, c.passes.length - 1);
  return pass;
}
function disposeComposer(s) {
  if (!s.composer) return;
  for (const pass of s.composer.passes) if (pass.dispose) pass.dispose();
  s.composer.dispose();
  s.composer = null;
}

const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight, true);
  for (const s of [session, nextSession]) if (s && s.composer) s.composer.setSize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', resize);

/** 物体と、その中の形・マテリアル・テクスチャ（map 以外の normalMap なども）をすべて片付ける */
function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
  });
}

// ---------------------------------------------------------------- Node（画面上の物体）
let seq = 0;

class Node {
  constructor(s, obj, shape, layer = s.scene2D) {
    this._s = s;
    this.obj = obj;            // three の Object3D
    this.shape = shape;        // 当たり判定 { type: 'circle', r } | { type: 'rect', w, h }
    this._x = 0; this._y = 0; this._rot = 0; this._scale = 1; this._alpha = 1; this._z = 0;
    this.vx = 0; this.vy = 0; this.vr = 0;   // 速度（px/秒、ラジアン/秒）。毎フレーム自動で加算される
    this.draggable = false;    // true / 'x'（横だけ）/ 'y'（縦だけ）
    this.removed = false;
    this._seq = ++seq;
    this._tap = []; this._drag = []; this._drop = [];
    this._baseScale = obj.scale.clone();
    obj.userData.node = this;
    s.nodes.add(this);
    layer.add(obj);
    this._order();
  }
  get x() { return this._x; }
  set x(v) { this._x = v; this.obj.position.x = v; }
  get y() { return this._y; }
  set y(v) { this._y = v; this.obj.position.y = -v; }
  /** 回転（ラジアン、時計回りが正） */
  get rotation() { return this._rot; }
  set rotation(v) { this._rot = v; this.obj.rotation.z = -v; }
  get scale() { return this._scale; }
  set scale(v) {
    this._scale = v;
    this.obj.scale.copy(this._baseScale).multiplyScalar(v);
    if (this._flipX) this.obj.scale.x *= -1;
  }
  /** 左右反転（true で裏返す） */
  get flipX() { return !!this._flipX; }
  set flipX(v) { this._flipX = !!v; this.scale = this._scale; }
  get alpha() { return this._alpha; }
  set alpha(v) { this._alpha = v; this._eachMat(m => { m.opacity = v; m.transparent = true; }); }
  /** 重なり順。大きいほど手前。同じなら後から作ったものが手前 */
  get z() { return this._z; }
  set z(v) { this._z = v; this._order(); }
  get color() { return this._color; }
  set color(v) { this._color = v; this._eachMat(m => m.color && m.color.set(v)); }
  /** 画像（sprite だけ）。代入すると差し替わる */
  get image() { return this._image; }
  set image(v) { if (this._swapImage && v !== this._image) { this._image = v; this._swapImage(v); } }
  get visible() { return this.obj.visible; }
  set visible(v) { this.obj.visible = v; }

  /** タップ（指が触れた瞬間）で呼ばれる。いちばん手前の物体だけが反応する */
  onTap(fn) { this._tap.push(fn); return this; }
  /** ドラッグ中に呼ばれる（draggable のとき） */
  onDrag(fn) { this._drag.push(fn); return this; }
  /** ドラッグを離したときに呼ばれる */
  onDrop(fn) { this._drop.push(fn); return this; }

  /** 勢いをつける（速度 px/秒 を足す）。物理が付いた物体でも使える */
  push(dx, dy) { pushNode(this, dx, dy); return this; }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this._s.nodes.delete(this);
    if (this.obj.parent) this.obj.parent.remove(this.obj);
    disposeObject(this.obj);
  }
  contains(px, py) {
    if (this.removed || !this.obj.visible) return false;
    const dx = px - this._x, dy = py - this._y;
    const c = Math.cos(this._rot), s = Math.sin(this._rot);
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    const sc = this._scale;
    if (this.shape.type === 'circle') return Math.hypot(lx, ly) <= this.shape.r * sc;
    return Math.abs(lx) <= this.shape.w * sc / 2 && Math.abs(ly) <= this.shape.h * sc / 2;
  }
  _order() {
    const o = this._z * 100000 + this._seq;
    this.obj.traverse(c => { c.renderOrder = o; });
  }
  _eachMat(fn) {
    this.obj.traverse(o => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach(fn);
    });
  }
}

function overlap(a, b) {
  if (!a || !b || a.removed || b.removed) return false;
  const A = a.shape, B = b.shape, sa = a.scale, sb = b.scale;
  if (A.type === 'circle' && B.type === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) < A.r * sa + B.r * sb;
  if (A.type === 'rect' && B.type === 'rect') {
    return Math.abs(a.x - b.x) < (A.w * sa + B.w * sb) / 2 && Math.abs(a.y - b.y) < (A.h * sa + B.h * sb) / 2;
  }
  const [c, r] = A.type === 'circle' ? [a, b] : [b, a];
  const cr = c.shape.r * c.scale, hw = r.shape.w * r.scale / 2, hh = r.shape.h * r.scale / 2;
  const nx = Math.max(r.x - hw, Math.min(c.x, r.x + hw));
  const ny = Math.max(r.y - hh, Math.min(c.y, r.y + hh));
  return Math.hypot(c.x - nx, c.y - ny) < cr;
}

// ---------------------------------------------------------------- 2D 図形
const flatMat = (color, map = null) => new THREE.MeshBasicMaterial({
  color: new THREE.Color(color), map, transparent: true, depthTest: false, depthWrite: false,
});

function roundRectGeo(w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return new THREE.ShapeGeometry(s, 8);
}

function place(node, { x = W / 2, y = H / 2, z = 0, rotation = 0, scale = 1, alpha = 1 } = {}) {
  node.x = x; node.y = y; node.rotation = rotation; node.scale = scale;
  if (z) node.z = z;
  if (alpha !== 1) node.alpha = alpha;
  return node;
}

class TextNode extends Node {
  constructor(s, str, opts) {
    const mat = flatMat('#ffffff');
    super(s, new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat), { type: 'rect', w: 1, h: 1 });
    this._t = {
      size: opts.size ?? 48, color: opts.color ?? '#222222', weight: opts.weight ?? 'bold',
      font: opts.font ?? 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
      stroke: opts.stroke ?? null, strokeWidth: opts.strokeWidth ?? 0,
    };
    this._canvas = document.createElement('canvas');
    this.text = str;
  }
  // 文字色は描き直しで変える（マテリアルの色で染めると暗くなるため）
  get color() { return this._t ? this._t.color : undefined; }
  set color(v) { if (!this._t) return; this._t.color = v; this.text = this._text; }
  get text() { return this._text; }
  set text(v) {
    this._text = String(v);
    const t = this._t, k = 2, c = this._canvas, g = c.getContext('2d');
    const font = `${t.weight} ${t.size * k}px ${t.font}`;
    g.font = font;
    const lines = this._text.split('\n');
    const pad = (t.size * 0.2 + t.strokeWidth) * k;
    const lh = t.size * 1.25 * k;
    c.width = Math.max(1, Math.ceil(Math.max(...lines.map(l => g.measureText(l).width)) + pad * 2));
    c.height = Math.max(1, Math.ceil(lh * lines.length + pad * 2));
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    lines.forEach((l, i) => {
      const yy = pad + lh * (i + 0.5);
      if (t.stroke && t.strokeWidth) { g.strokeStyle = t.stroke; g.lineWidth = t.strokeWidth * 2 * k; g.strokeText(l, c.width / 2, yy); }
      g.fillStyle = t.color; g.fillText(l, c.width / 2, yy);
    });
    const mesh = this.obj;
    if (mesh.material.map) mesh.material.map.dispose();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mesh.material.map = tex;
    mesh.material.needsUpdate = true;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(c.width / k, c.height / k);
    this.shape = { type: 'rect', w: c.width / k, h: c.height / k };
  }
}

// ---------------------------------------------------------------- 乱数（シード付き）
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EASE = {
  linear: t => t,
  in: t => t * t,
  out: t => 1 - (1 - t) * (1 - t),
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

// ---------------------------------------------------------------- ctx（ミニゲームに渡す API）
function makeCtx(s, m) {
  const rand = mulberry32(m.seed >>> 0);
  const random = (a = 0, b = 1) => a + rand() * (b - a);
  const beats = Number(m.beats) === 16 ? 16 : 8;
  // 画像の読み込み。読み込み待ちは s.pending に入れ、全部そろってから本体に ready を返す
  const loadTexture = (path, onLoad) => {
    let done;
    s.pending.push(new Promise(r => { done = r; }));
    const tex = new THREE.TextureLoader().load(ctx.asset(path), t => { if (onLoad) onLoad(t); done(); }, undefined, () => {
      report(new Error(`画像を読み込めません: ${path}`), s);
      done();
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const cachedTexture = path => {
    s.texCache ||= new Map();
    if (!s.texCache.has(path)) s.texCache.set(path, loadTexture(path));
    return s.texCache.get(path);
  };
  const ctx = {
    W, H,
    difficulty: m.difficulty,
    speed: m.speed,
    beats,                                  // このミニゲームの長さ（拍）
    bpm: BASE_BPM * s.speed,                // 実際のテンポ（参考）
    duration: beats * SEC_PER_BEAT,         // ゲーム内時間での長さ（秒）
    get time() { return s.time; },
    /** 開始からの拍数（小数）。0〜beats */
    get beat() { return s.time / SEC_PER_BEAT; },
    get result() { return s.result; },
    /** 拍の頭ごとに fn(拍番号) を呼ぶ。0 拍目（開始直後）も呼ばれる */
    onBeat(fn) { s.beatHandlers.push(fn); },
    /** 勝敗が決まった瞬間に fn(win) を呼ぶ（ctx.win / lose のときも、時間切れのときも）。勝ち負けの演出に使う */
    onResult(fn) { s.resultHandlers.push(fn); },
    /** 喜ばせる：拍に合わせて跳ねて、左右に揺れる。物体（Node）か three の物体、その配列を渡す */
    happy(target, opts = {}) { react(s, target, 'happy', opts); },
    /** 落ち込ませる：しょんぼり沈んで傾き、色がくすむ。物体（Node）か three の物体、その配列を渡す */
    sad(target, opts = {}) { react(s, target, 'sad', opts); },

    random,
    randInt: (a, b) => Math.floor(random(a, b + 1)),
    pick: arr => arr[Math.floor(rand() * arr.length)],
    // 「つくる」画面から渡されたゲームは、ファイルを blob: の URL にして使う（サーバーに置かれていない）
    /** 2D の物理エンジン（games/README.md の「物理」） */
    get physics() { return s.physicsApi || (s.physicsApi = createPhysics(s)); },
    /** 3D の物理エンジン（games/README.md の「3D の物理」） */
    get physics3d() { return s.physics3dApi || (s.physics3dApi = createPhysics3d(s)); },
    asset: path => (s.fileUrls ? s.fileUrls.get(String(path).replace(/^\.\//, '')) || 'blob:missing' : new URL(path, m.base).href),

    background(color) { s.scene.background = new THREE.Color(color); },
    circle({ r = 50, color = '#ffffff', ...p } = {}) {
      const n = new Node(s, new THREE.Mesh(new THREE.CircleGeometry(r, 64), flatMat(color)), { type: 'circle', r });
      n._color = color;
      return place(n, p);
    },
    rect({ w = 100, h = 100, radius = 0, color = '#ffffff', ...p } = {}) {
      const geo = radius > 0 ? roundRectGeo(w, h, radius) : new THREE.PlaneGeometry(w, h);
      const n = new Node(s, new THREE.Mesh(geo, flatMat(color)), { type: 'rect', w, h });
      n._color = color;
      return place(n, p);
    },
    text(str, opts = {}) {
      return place(new TextNode(s, str, opts), opts);
    },
    /**
     * 画像を置く。w か h の片方だけ指定すると縦横比を保つ。
     * color を指定すると画像に色を掛ける（白い画像なら、その色に染まる）。
     * r を指定すると当たり判定が半径 r の円になる（省略時は画像の四角）。
     * fit を指定すると、縦横比を保ったまま fit × fit の枠に収まる大きさになる。
     */
    sprite(path, { w = 0, h = 0, r = 0, fit = 0, color = '#ffffff', ...p } = {}) {
      if (fit) { w = 0; h = 0; }
      const w0 = w || fit || 100, h0 = h || w || fit || 100;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w0, h0), flatMat(color));
      const n = new Node(s, mesh, r ? { type: 'circle', r } : { type: 'rect', w: w0, h: h0 });
      n._color = color;
      // 画像の縦横比に合わせて板の大きさを決める（w と h の両方を指定したときは、そのまま）
      const fitSize = t => {
        if (n.removed || (w && h) || !t.image || !t.image.width) return;
        const iw = t.image.width, ih = t.image.height;
        let nw = w || (h ? h * iw / ih : iw), nh = h || (w ? w * ih / iw : ih);
        if (fit) { const k = fit / Math.max(iw, ih); nw = iw * k; nh = ih * k; }
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(nw, nh);
        if (!r) n.shape = { type: 'rect', w: nw, h: nh };
      };
      const tex = loadTexture(path, fitSize);
      mesh.material.map = tex;
      n._image = path;
      // node.image = 'assets/x.png' で画像を差し替える（縦横比は新しい画像に合わせる。ctx.texture で先に読んでおくと、すぐ切り替わる）
      n._swapImage = path2 => {
        const t2 = cachedTexture(path2);
        mesh.material.map = t2;
        mesh.material.needsUpdate = true;
        if (t2.image && t2.image.width) fitSize(t2);
        else { const prev = t2.onUpdate; t2.onUpdate = () => { if (prev) prev(); fitSize(t2); t2.onUpdate = prev; }; }
      };
      return place(n, p);
    },
    /** 3D 用のテクスチャを読み込む（例: new THREE.MeshStandardMaterial({ map: ctx.texture('assets/crate.png') })）。同じ画像は使い回す */
    texture(path) { return cachedTexture(path); },
    /**
     * 環境マップ：360° の画像（正距円筒。jpg / webp / png）で、3D の物体に周りの景色の映り込みと柔らかい光を付ける。
     * MeshStandardMaterial / MeshPhysicalMaterial に効く。読み込みが終わってからゲームが始まる。
     * opts: intensity（明るさ。既定 1）, background（true で背景にも出す）, blur（背景のぼかし 0〜1）
     */
    environment(path, { intensity = 1, background = false, blur = 0 } = {}) {
      loadTexture(path, tex => {
        if (s.disposed) return;
        pmrem ||= new THREE.PMREMGenerator(renderer);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        if (s.envRT) s.envRT.dispose();
        s.envRT = pmrem.fromEquirectangular(tex);
        s.scene.environment = s.envRT.texture;
        s.scene.environmentIntensity = intensity;
        if (background) { s.scene.background = blur > 0 ? s.envRT.texture : tex; s.scene.backgroundBlurriness = blur; }
      });
    },
    /**
     * トーンマッピング（写真のような色の出方にする）。3D の層だけにかかる。
     * kind: 'aces' | 'agx' | 'neutral' | null（なし）。exposure: 明るさ（既定 1）
     */
    toneMapping(kind = 'aces', exposure = 1) {
      if (kind && !TONE[kind]) throw new Error(`ctx.toneMapping の種類は aces / agx / neutral のどれかです（${kind}）`);
      s.toneMapping = kind ? TONE[kind] : null;
      s.exposure = Number(exposure) || 1;
    },
    /** three の 3D オブジェクトを 3D の層に置く（奥行き z = 0 の面に置かれる）。r は当たり判定の半径 */
    add3D(object, { r = 100, ...p } = {}) {
      return place(new Node(s, object, { type: 'circle', r }, s.scene), p);
    },
    /** 画面の (x, y) にある 3D の物体を返す（いちばん手前のもの。なければ null）。add3D で置いたものは Node を返す */
    pick3D(x, y) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((x / W) * 2 - 1, -((y / H) * 2 - 1)), s.camera3D);
      const hit = ray.intersectObjects(s.scene.children, true)[0];
      if (!hit) return null;
      for (let o = hit.object; o; o = o.parent) if (o.userData.node) return o.userData.node;
      return hit.object;
    },
    /** 3D の物体（Object3D か Node）が画面のどこに映るかを返す { x, y, visible }。visible はカメラの前にあるか */
    toScreen(target) {
      const obj = target && target.obj ? target.obj : target;
      const v = obj.getWorldPosition(new THREE.Vector3()).project(s.camera3D);
      return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, visible: v.z > -1 && v.z < 1 };
    },

    tween(node, to, { duration = 0.3, ease = 'out', delay = 0 } = {}) {
      return new Promise(resolve => s.tweens.push({ node, to, from: null, duration, ease: EASE[ease] || EASE.out, delay, t: 0, resolve }));
    },
    after(sec, fn) { s.timers.push({ t: sec, fn, every: 0 }); },
    every(sec, fn) { s.timers.push({ t: sec, fn, every: sec }); },
    overlap,
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),

    input: {
      get x() { return input.x; },
      get y() { return input.y; },
      get down() { return pointers.size > 0; },
      /** 'down' | 'move' | 'up' | 'tap' | 'swipe' */
      on(type, fn) { (s.handlers[type] ||= []).push(fn); },
    },
    sound: { play: id => send({ type: 'sound', runId: s.runId, id: String(id) }) },

    win() { finish(s, true); },
    lose() { finish(s, false); },

    // ---- ポストエフェクト
    /**
     * ブルーム（明るいところが光ってにじむ）をかける。返り値の strength / radius / threshold は後から変えてよい
     * （ctx.tween(bloom, { strength: 3 }) で光を強めるなど）。
     * 光らせたいものは、色の明るさを 1 より大きくする（例 new THREE.Color(2, 1.6, 0.5)）か threshold を下げる
     */
    bloom({ strength = 1, radius = 0.4, threshold = 0.85, layers = '3d' } = {}) {
      const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
      return insertPass(s, new UnrealBloomPass(size, strength, radius, threshold), layers);
    },
    /** 任意のポストエフェクトのパスを追加する（上級者向け。クラスは ctx.FX にある） */
    addPass(pass, { layers = '3d' } = {}) { return insertPass(s, pass, layers); },
    FX: { ShaderPass, UnrealBloomPass, RenderPass },

    // ---- VRM（人型アバター）
    /**
     * VRM を読み込む（ゲーム開始前に読み込み完了を待つ）。返り値は three-vrm の VRM。
     * vrm.scene を ctx.scene に追加して使う。単位はメートルで、+Z（カメラ側）を向いて立つ。
     * 表情・揺れもの・視線の更新は毎フレーム自動で行う
     */
    loadVRM(path) {
      const p = (async () => {
        const [lib, data] = await Promise.all([loadVrmLib(), fetchAsset(s, path)]);
        vrmUtils = lib.VRMUtils;
        const loader = makeGltfLoader(lib, parser => new lib.VRMLoaderPlugin(parser));
        let t = performance.now();
        const gltf = await loader.parseAsync(data, m.base);
        t = timing(s, `${path} 解析`, t);
        const vrm = gltf.userData.vrm;
        if (!vrm) throw new Error(`VRM ではありません: ${path}`);
        lib.VRMUtils.removeUnnecessaryVertices(gltf.scene);
        lib.VRMUtils.combineSkeletons(gltf.scene);
        timing(s, `${path} 整理`, t);
        lib.VRMUtils.rotateVRM0(vrm);                       // 古い VRM 0.x も +Z 向きにそろえる
        vrm.scene.traverse(o => { o.frustumCulled = false; });
        if (s.disposed) lib.VRMUtils.deepDispose(vrm.scene); else s.vrms.push(vrm);
        return vrm;
      })();
      s.pending.push(p.catch(err => report(err, s)));
      return p;
    },
    /** VRM アニメーション（.vrma）を読み込む */
    loadVRMAnimation(path) {
      const p = (async () => {
        const [lib, data] = await Promise.all([loadVrmLib(), fetchAsset(s, path)]);
        const loader = makeGltfLoader(lib, parser => new lib.VRMAnimationLoaderPlugin(parser));
        const gltf = await loader.parseAsync(data, m.base);
        const anim = gltf.userData.vrmAnimations && gltf.userData.vrmAnimations[0];
        if (!anim) throw new Error(`VRM アニメーションではありません: ${path}`);
        return anim;
      })();
      s.pending.push(p.catch(err => report(err, s)));
      return p;
    },
    /** VRM にアニメーションを再生させる（毎フレーム自動で進む）。返り値は THREE.AnimationAction */
    // ---- glTF（.glb）
    /**
     * glb を読み込む（ゲーム開始前に読み込み完了を待つ）。返り値は { scene, animations }。
     * scene を ctx.scene に追加して使う。画像はファイルに埋め込まれたものだけ読める（別ファイルの画像・Draco 圧縮は不可）
     */
    loadGLB(path) {
      const p = (async () => {
        const [lib, data] = await Promise.all([loadGltfLib(), fetchAsset(s, path)]);
        const t = performance.now();
        const gltf = await makeGltfLoader(lib).parseAsync(data, m.base);
        timing(s, `${path} 解析`, t);
        // 骨で動く部品は、動いた先で画面外と誤判定されて消えないようにする
        gltf.scene.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });
        if (s.disposed) disposeObject(gltf.scene);
        return { scene: gltf.scene, animations: gltf.animations || [] };
      })();
      s.pending.push(p.catch(err => report(err, s)));
      return p;
    },
    /**
     * アニメーションを再生する（毎フレーム自動で進み、テンポが上がると速くなる）。返り値は THREE.AnimationAction。
     * target は loadGLB の返り値か three の物体。clip はアニメーションの名前か THREE.AnimationClip。
     * 同じ物体で別のアニメーションを再生すると、fade 秒かけて切り替わる
     */
    playAnimation(target, clip, { loop = true, fade = 0.2, timeScale = 1 } = {}) {
      const root = target && target.isObject3D ? target : target && target.scene;
      if (!root) throw new Error('playAnimation: 物体か loadGLB の返り値を渡してください');
      if (typeof clip === 'string') {
        const list = (target && target.animations) || [];
        const found = THREE.AnimationClip.findByName(list, clip);
        if (!found) throw new Error(`アニメーション「${clip}」がありません（あるもの: ${list.map(a => a.name).join(', ') || 'なし'}）`);
        clip = found;
      }
      let mixer = s.mixerOf.get(root);
      if (!mixer) { mixer = new THREE.AnimationMixer(root); s.mixerOf.set(root, mixer); s.mixers.push(mixer); }
      const action = mixer.clipAction(clip);
      const prev = s.playing.get(root);
      action.reset();
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.timeScale = timeScale;
      action.play();
      if (prev && prev !== action) { if (fade > 0) action.crossFadeFrom(prev, fade, false); else prev.stop(); }
      s.playing.set(root, action);
      return action;
    },

    async playVRMAnimation(vrm, anim, { loop = true } = {}) {
      const lib = await loadVrmLib();
      const mixer = new THREE.AnimationMixer(vrm.scene);
      const action = mixer.clipAction(lib.createVRMAnimationClip(anim, vrm));
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.play();
      if (!s.disposed) s.mixers.push(mixer);
      return action;
    },

    THREE, scene: s.scene,
    /** 3D の層のカメラ。game.json の "camera" が "perspective" なら遠近感あり */
    camera3D: s.camera3D,
    camera: s.camera3D,
  };
  return ctx;
}

// ---------------------------------------------------------------- 入力
const input = { x: W / 2, y: H / 2 };
const pointers = new Map();

const toLogical = e => {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
};
function emit(s, type, ev) {
  for (const fn of s.handlers[type] || []) safe(() => fn(ev));
}

canvas.addEventListener('pointerdown', e => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const p = toLogical(e);
  input.x = p.x; input.y = p.y;
  const rec = { sx: p.x, sy: p.y, x: p.x, y: p.y, t: performance.now(), drag: null, ox: 0, oy: 0 };
  pointers.set(e.pointerId, rec);
  const s = session;
  if (!s || !s.started) return;
  let top = null;
  for (const n of s.nodes) {
    if (!(n._tap.length || n.draggable) || !n.contains(p.x, p.y)) continue;
    if (!top || n._z > top._z || (n._z === top._z && n._seq > top._seq)) top = n;
  }
  if (top) {
    for (const fn of top._tap) safe(() => fn({ x: p.x, y: p.y }));
    if (top.draggable && !top.removed) { rec.drag = top; rec.ox = top.x - p.x; rec.oy = top.y - p.y; top._dragging = true; }
  }
  emit(s, 'down', { x: p.x, y: p.y, id: e.pointerId });
});

canvas.addEventListener('pointermove', e => {
  const rec = pointers.get(e.pointerId);
  if (!rec) return;
  const p = toLogical(e);
  const dx = p.x - rec.x, dy = p.y - rec.y;
  rec.x = p.x; rec.y = p.y;
  input.x = p.x; input.y = p.y;
  const s = session;
  if (!s || !s.started) return;
  const n = rec.drag;
  if (n && !n.removed && n.draggable) {
    if (n.draggable !== 'y') n.x = p.x + rec.ox;
    if (n.draggable !== 'x') n.y = p.y + rec.oy;
    for (const fn of n._drag) safe(() => fn({ x: p.x, y: p.y, dx, dy }));
  }
  emit(s, 'move', { x: p.x, y: p.y, dx, dy, id: e.pointerId });
});

function pointerEnd(e, cancelled) {
  const rec = pointers.get(e.pointerId);
  if (!rec) return;
  pointers.delete(e.pointerId);
  const s = session;
  if (!s || !s.started) return;
  const p = { x: rec.x, y: rec.y };
  if (rec.drag) rec.drag._dragging = false;
  if (rec.drag && !rec.drag.removed) for (const fn of rec.drag._drop) safe(() => fn(p));
  emit(s, 'up', { ...p, id: e.pointerId });
  if (cancelled) return;
  const dx = rec.x - rec.sx, dy = rec.y - rec.sy, dist = Math.hypot(dx, dy), dt = performance.now() - rec.t;
  if (dist < 20 && dt < 300) emit(s, 'tap', p);
  else if (dist > 60 && dt < 400) {
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    emit(s, 'swipe', { ...p, dx, dy, dir });
  }
}
canvas.addEventListener('pointerup', e => pointerEnd(e, false));
canvas.addEventListener('pointercancel', e => pointerEnd(e, true));
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------------------------------------------------------------- セッション（1本のミニゲーム）
// session     … 画面に出ているゲーム（描画・入力・時間が進むのはこれだけ）
// nextSession … 裏で読み込み中の次のゲーム。本体の 'show' か 'start' で session と入れ替わる
let session = null, nextSession = null;
let runCounter = 0;

function report(err, s = session) {
  const message = err && err.stack ? String(err.stack) : String(err);
  send({ type: 'error', runId: s ? s.runId : 0, message });
  if (s && !s.result) s.result = 'lose';
}
function safe(fn) {
  try { return fn(); } catch (err) { report(err); return undefined; }
}
function finish(s, win, byTimeup = false) {
  if (s !== session || s.result) return;
  s.result = win ? 'win' : 'lose';
  if (!byTimeup) s.hitstop = HITSTOP_SEC;   // 勝敗が決まった瞬間、少しのあいだスローにする
  send({ type: 'result', runId: s.runId, win });
  for (const fn of s.resultHandlers) safe(() => fn(win));
}

// ---------------------------------------------------------------- 喜ぶ・落ち込む（ctx.happy / ctx.sad）
const GLOOM = new THREE.Color('#7d8291');
function react(s, target, kind, { amp, phase } = {}) {
  for (const t of (Array.isArray(target) ? target : [target])) {
    const isNode = t instanceof Node;
    if (!isNode && !(t && t.isObject3D)) continue;
    s.reactions = s.reactions.filter(r => r.t !== t);
    let size = 1;
    if (!isNode) { const b = new THREE.Box3().setFromObject(t); if (!b.isEmpty()) size = b.getSize(new THREE.Vector3()).y || 1; }
    s.reactions.push({
      t, isNode, kind, t0: s.time,
      phase: phase ?? s.reactions.length * 0.29,
      amp: amp ?? (isNode ? 22 : size * 0.25),
      base: isNode
        ? { x: t.x, y: t.y, rot: t.rotation, scale: t.scale, color: t.color !== undefined ? new THREE.Color(t.color) : null }
        : { y: t.position.y, rx: t.rotation.x, rz: t.rotation.z },
    });
  }
}
function updateReactions(s) {
  for (const r of s.reactions) {
    const { t, base } = r;
    if (t.removed) continue;
    const u = s.time - r.t0;
    if (r.kind === 'happy') {
      // 拍（0.5秒）ごとに1回跳ねる。最初は大きく、だんだん落ち着く
      const b = u / SEC_PER_BEAT + r.phase;
      const hop = Math.abs(Math.sin(Math.PI * b)) * (0.6 + 0.4 * Math.exp(-u));
      const sway = Math.sin(Math.PI * b) * 0.2;
      if (r.isNode) { t.y = base.y - hop * r.amp; t.rotation = base.rot + sway; t.scale = base.scale * (1 + 0.1 * hop); }
      else { t.position.y = base.y + hop * r.amp; t.rotation.z = base.rz + sway; }
    } else {
      // ゆっくり沈んで傾き、小さく揺れ続ける。色は灰色に寄せる
      const k = 1 - Math.exp(-u * 5);
      const sway = Math.sin(u * 2.4 + r.phase * 6) * 0.04;
      if (r.isNode) {
        t.y = base.y + r.amp * 0.6 * k;
        t.rotation = base.rot + (0.28 + sway) * k * (r.phase % 0.58 < 0.29 ? 1 : -1);
        t.scale = base.scale * (1 - 0.12 * k);
        // 色をくすませる（文字は色を変えると描き直しになって重いので、文字以外だけ。色が落ち着いたら止める）
        if (base.color && !t._t && !r.colorDone) { t.color = '#' + base.color.clone().lerp(GLOOM, 0.65 * k).getHexString(); r.colorDone = k > 0.995; }
      } else {
        t.position.y = base.y - r.amp * 0.35 * k;
        t.rotation.x = base.rx + 0.4 * k;
        t.rotation.z = base.rz + sway * k;
      }
    }
  }
}

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
function disposeSession(s) {
  if (!s || s.disposed) return;
  s.disposed = true;
  // 展開済みの画像（ImageBitmap）はすぐ解放する（重い VRM だと数百 MB になることがある）
  const bitmaps = collectTextures(s).map(t => t.image).filter(img => typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap);
  disposeComposer(s);
  if (s.envRT) { s.envRT.dispose(); s.envRT = null; }
  if (vrmUtils) for (const vrm of s.vrms) vrmUtils.deepDispose(vrm.scene);
  for (const sc of [s.scene, s.scene2D]) for (const c of [...sc.children]) { sc.remove(c); disposeObject(c); }
  for (const b of bitmaps) b.close();
  if (s.fileUrls) for (const url of s.fileUrls.values()) URL.revokeObjectURL(url);
}
function unload() {
  disposeSession(session);
  disposeSession(nextSession);
  session = nextSession = null;
  pointers.clear();
}
/** 裏で読み込んだ次のゲームを画面に出す（前のゲームは片付ける） */
function show(runId) {
  if (!nextSession || nextSession.runId !== runId) return;
  disposeSession(session);
  session = nextSession;
  nextSession = null;
  pointers.clear();
}

/** シーンで使っているテクスチャをすべて集める */
function collectTextures(s) {
  const set = new Set();
  for (const sc of [s.scene, s.scene2D]) {
    if (sc.background && sc.background.isTexture) set.add(sc.background);
    sc.traverse(o => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v && v.isTexture) set.add(v);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) set.add(u.value);
      }
    });
  }
  return [...set];
}
/** 次のフレームまで待つ（画面が隠れていて止まっているときは 50ms で進む） */
const nextFrame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 50); });

/** 次のゲームを裏で読み込む。いま画面に出ているゲームは、入れ替わるまでそのまま動き続ける */
async function load(m) {
  disposeSession(nextSession);
  const s = {
    runId: m.runId, nodes: new Set(), tweens: [], timers: [], handlers: {}, beatHandlers: [], nextBeat: 0, pending: [],
    resultHandlers: [], reactions: [],
    vrms: [], mixers: [], mixerOf: new Map(), playing: new Map(), disposed: false,
    scene: new THREE.Scene(), scene2D: new THREE.Scene(), composer: null, fxLayers: '3d',
    camera3D: makeCamera3D(m.camera === 'perspective' ? 'perspective' : 'ortho'),
    result: null, started: false, time: 0, speed: Number(m.speed) || 1,
    timeoutResult: m.timeoutResult === 'win' ? 'win' : 'lose', game: null, ctx: null,
  };
  if (m.files && typeof m.files === 'object') {
    s.fileUrls = new Map();
    for (const [path, data] of Object.entries(m.files)) {
      if (!(data instanceof ArrayBuffer)) continue;
      const ext = path.split('.').pop().toLowerCase();
      s.fileUrls.set(path, URL.createObjectURL(new Blob([data], { type: IMAGE_TYPES[ext] || 'application/octet-stream' })));
    }
  }
  s.ctx = makeCtx(s, m);
  nextSession = s;
  if (!session) show(s.runId);      // 画面に何も出ていなければ、すぐ出してよい
  try {
    let t = performance.now();
    let mod;
    if (typeof m.code === 'string') {
      // 「つくる」画面で貼り付けたコード（sandbox/make.html だけが blob: のスクリプトを許可している）
      const url = URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }));
      try { mod = await import(url); } finally { URL.revokeObjectURL(url); }
    } else {
      const url = new URL(m.url);
      url.searchParams.set('run', String(++runCounter)); // 毎回まっさらな状態で読み込む
      mod = await import(url.href);
    }
    t = timing(s, 'main.js 読み込み', t);
    if (s.disposed) return;
    s.game = mod.default;
    // ctx.physics / physics3d をすぐ使えるように（起動時から読み込んでいるので、ふつうは待たない）
    await Promise.all([loadPlanck(), loadCannon()]).catch(() => {});
    if (!s.game || typeof s.game !== 'object') throw new Error('main.js は export default { init, update } の形にしてください');
    if (s.game.init) await s.game.init(s.ctx);
    // 画像の読み込みを待つ（最大5秒）
    await Promise.race([Promise.all(s.pending), new Promise(r => setTimeout(r, 5000))]);
    t = timing(s, 'init()', t);
    // シェーダーを先に作っておく（始まった瞬間に固まらないように。VRM などは時間がかかる）
    if (!s.disposed) {
      // 3D の層は、そのゲームのトーンマッピングで作る（トーンマッピングごとに別のシェーダーになるため）
      useTone(s, true);
      const compile3D = renderer.compileAsync(s.scene, s.camera3D);
      useTone(s, false);
      await Promise.race([
        Promise.all([compile3D, renderer.compileAsync(s.scene2D, camera2D)]).catch(() => {}),
        new Promise(r => setTimeout(r, 3000)),
      ]);
      t = timing(s, 'シェーダー作成', t);
      // テクスチャを GPU に送っておく。最初の描画でまとめて送ると、その間すべてが止まる（大きい VRM で1秒以上）ので、
      // 1フレームに少しずつ（8ms ぶんずつ）送って、止まる時間を細かく分ける
      const textures = collectTextures(s);
      let slice = performance.now();
      for (const tex of textures) {
        if (s.disposed) return;
        try { renderer.initTexture(tex); } catch { /* 描画時にもう一度送られる */ }
        if (performance.now() - slice > 8) { await nextFrame(); slice = performance.now(); }
      }
      timing(s, `テクスチャ転送 ${textures.length}枚`, t);
      s.firstFrame = true;     // 最初に描いたときの時間も測る
    }
    if (!s.disposed) send({ type: 'ready', runId: s.runId });
  } catch (err) {
    if (!s.disposed) report(err, s);
  }
}

window.addEventListener('message', e => {
  if (e.source !== parentWin) return;
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  const s = session;
  switch (m.type) {
    case 'load': load(m); break;
    case 'show': show(m.runId); break;
    case 'start': {
      show(m.runId);                 // 'show' が来ていなくても、始まるときには必ず出す
      if (session && session.runId === m.runId) session.started = true;
      break;
    }
    case 'timeup': if (s && s.runId === m.runId && !s.result) finish(s, s.timeoutResult === 'win', true); break;
    case 'unload': unload(); break;
    case 'asset': {
      const r = assetRequests.get(m.reqId);
      if (!r) break;
      assetRequests.delete(m.reqId);
      if (m.ok && m.data instanceof ArrayBuffer) r.resolve(m.data); else r.reject(new Error(String(m.error || '読み込みに失敗しました')));
      break;
    }
  }
});
window.addEventListener('error', e => report(e.error || e.message));
window.addEventListener('unhandledrejection', e => report(e.reason));

// ---------------------------------------------------------------- メインループ
function step(s, dt) {
  s.time += dt;
  while (s.time >= s.nextBeat * SEC_PER_BEAT) {
    const b = s.nextBeat++;
    for (const fn of s.beatHandlers) safe(() => fn(b));
  }
  for (const tm of [...s.timers]) {
    tm.t -= dt;
    if (tm.t > 0) continue;
    safe(tm.fn);
    if (tm.every > 0) tm.t += tm.every; else s.timers.splice(s.timers.indexOf(tm), 1);
  }
  for (const tw of [...s.tweens]) {
    if (tw.delay > 0) { tw.delay -= dt; continue; }
    if (!tw.from) { tw.from = {}; for (const k in tw.to) tw.from[k] = tw.node[k]; }
    tw.t += dt;
    const k = tw.duration > 0 ? Math.min(1, tw.t / tw.duration) : 1;
    const e = tw.ease(k);
    if (!tw.node.removed) for (const p in tw.to) tw.node[p] = tw.from[p] + (tw.to[p] - tw.from[p]) * e;
    if (k >= 1 || tw.node.removed) { s.tweens.splice(s.tweens.indexOf(tw), 1); tw.resolve(); }
  }
  for (const mixer of s.mixers) mixer.update(dt);
  updateReactions(s);
  for (const vrm of s.vrms) vrm.update(dt);
  for (const n of s.nodes) {
    if (n._body) continue;            // 物理が付いた物体は、物理エンジンが動かす
    if (n.vx) n.x += n.vx * dt;
    if (n.vy) n.y += n.vy * dt;
    if (n.vr) n.rotation += n.vr * dt;
  }
  physicsStep(s, dt, safe);
  physics3dStep(s, dt, safe);
  if (s.game && s.game.update) safe(() => s.game.update(dt, s.ctx));
}

let last = performance.now(), lastBeat = 0;
function frame(now) {
  requestAnimationFrame(frame);
  // 描画が重くても本体の拍とずれすぎないよう、1フレームで最大 0.1 秒まで進める
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const s = session;
  if (s && s.started) {
    let k = s.speed;
    if (s.hitstop > 0) { s.hitstop -= dt; k *= HITSTOP_SCALE; }
    step(s, dt * k);
  }
  const v = session;
  const firstFrame = v && v.firstFrame;
  const tf = performance.now();
  if (!v) {
    renderer.clear();
  } else if (v.composer) {
    useTone(v, true);
    v.composer.render(dt);
    useTone(v, false);
    if (v.fxLayers === '3d') { renderer.clearDepth(); renderer.render(v.scene2D, camera2D); }
  } else {
    renderer.clear();
    useTone(v, true);
    renderer.render(v.scene, v.camera3D);
    useTone(v, false);
    renderer.clearDepth();
    renderer.render(v.scene2D, camera2D);
  }
  if (firstFrame) {
    // 最初の描画と、比べるための2回目の描画の時間を測る
    timing(v, v.firstFrame === true ? '最初の描画' : '2回目の描画', tf);
    v.firstFrame = v.firstFrame === true ? 'second' : false;
  }
  if (now - lastBeat > 500) { lastBeat = now; send({ type: 'heartbeat' }); }
}
resize();
requestAnimationFrame(frame);
send({ type: 'boot' });
loadPlanck().catch(err => console.warn('物理エンジンを読み込めません', err));
loadCannon().catch(err => console.warn('3D の物理エンジンを読み込めません', err));
