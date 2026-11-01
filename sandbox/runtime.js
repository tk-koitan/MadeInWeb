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
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

// 2層で描く：先に 3D の層（scene + camera3D）、その上に 2D の層（scene2D + camera2D）を重ねる。
// three の座標では y が上向きなので、Node が y を反転して置く（画面の (x, y) → three の (x, -y)）。
const scene = new THREE.Scene();      // 3D の層。ミニゲームには ctx.scene として渡す
const scene2D = new THREE.Scene();    // 2D の層。circle / rect / text / sprite はこちら
const camera2D = new THREE.OrthographicCamera(0, W, 0, -H, 0.1, 4000);
camera2D.position.set(0, 0, 2000);
let camera3D = makeCamera3D('ortho');

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

// ---------------------------------------------------------------- ポストエフェクト
// ミニゲームが ctx.bloom() / ctx.addPass() を呼んだときだけ使う（使わないゲームは今までどおり直接描く）。
// layers: '3d' … 3D の層だけにかける（2D の層はあとから、くっきりしたまま重ねる）
//         'all' … 2D の層も含めた画面全体にかける
let composer = null, fxLayers = '3d';
const FX_PIXEL_RATIO = () => Math.min(renderer.getPixelRatio(), 1.5);   // スマホで重くなりすぎないように
function ensureComposer(layers) {
  if (composer) return composer;
  fxLayers = layers === 'all' ? 'all' : '3d';
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(FX_PIXEL_RATIO());
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera3D));
  if (fxLayers === 'all') {
    const p2 = new RenderPass(scene2D, camera2D);
    p2.clear = false;
    p2.clearDepth = true;
    composer.addPass(p2);
  }
  composer.addPass(new OutputPass());   // 色空間の変換。常に最後
  return composer;
}
/** 出力の手前（OutputPass の前）にパスを追加する */
function insertPass(pass, layers) {
  const c = ensureComposer(layers);
  c.insertPass(pass, c.passes.length - 1);
  return pass;
}
function disposeComposer() {
  if (!composer) return;
  for (const pass of composer.passes) if (pass.dispose) pass.dispose();
  composer.dispose();
  composer = null;
}

const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight, true);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', resize);
resize();

function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

// ---------------------------------------------------------------- Node（画面上の物体）
let seq = 0;

class Node {
  constructor(s, obj, shape, layer = scene2D) {
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
  get visible() { return this.obj.visible; }
  set visible(v) { this.obj.visible = v; }

  /** タップ（指が触れた瞬間）で呼ばれる。いちばん手前の物体だけが反応する */
  onTap(fn) { this._tap.push(fn); return this; }
  /** ドラッグ中に呼ばれる（draggable のとき） */
  onDrag(fn) { this._drag.push(fn); return this; }
  /** ドラッグを離したときに呼ばれる */
  onDrop(fn) { this._drop.push(fn); return this; }

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
      report(new Error(`画像を読み込めません: ${path}`));
      done();
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
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

    random,
    randInt: (a, b) => Math.floor(random(a, b + 1)),
    pick: arr => arr[Math.floor(rand() * arr.length)],
    asset: path => new URL(path, m.base).href,

    background(color) { scene.background = new THREE.Color(color); },
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
      const tex = loadTexture(path, t => {
        if (n.removed || (w && h)) return;
        const iw = t.image.width, ih = t.image.height;
        let nw = w || (h ? h * iw / ih : iw), nh = h || (w ? w * ih / iw : ih);
        if (fit) { const k = fit / Math.max(iw, ih); nw = iw * k; nh = ih * k; }
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(nw, nh);
        if (!r) n.shape = { type: 'rect', w: nw, h: nh };
      });
      mesh.material.map = tex;
      return place(n, p);
    },
    /** 3D 用のテクスチャを読み込む（例: new THREE.MeshStandardMaterial({ map: ctx.texture('assets/crate.png') })） */
    texture(path) { return loadTexture(path); },
    /** three の 3D オブジェクトを 3D の層に置く（奥行き z = 0 の面に置かれる）。r は当たり判定の半径 */
    add3D(object, { r = 100, ...p } = {}) {
      return place(new Node(s, object, { type: 'circle', r }, scene), p);
    },
    /** 画面の (x, y) にある 3D の物体を返す（いちばん手前のもの。なければ null）。add3D で置いたものは Node を返す */
    pick3D(x, y) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((x / W) * 2 - 1, -((y / H) * 2 - 1)), camera3D);
      const hit = ray.intersectObjects(scene.children, true)[0];
      if (!hit) return null;
      for (let o = hit.object; o; o = o.parent) if (o.userData.node) return o.userData.node;
      return hit.object;
    },
    /** 3D の物体（Object3D か Node）が画面のどこに映るかを返す { x, y, visible }。visible はカメラの前にあるか */
    toScreen(target) {
      const obj = target && target.obj ? target.obj : target;
      const v = obj.getWorldPosition(new THREE.Vector3()).project(camera3D);
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
      return insertPass(new UnrealBloomPass(size, strength, radius, threshold), layers);
    },
    /** 任意のポストエフェクトのパスを追加する（上級者向け。クラスは ctx.FX にある） */
    addPass(pass, { layers = '3d' } = {}) { return insertPass(pass, layers); },
    FX: { ShaderPass, UnrealBloomPass, RenderPass },

    THREE, scene,
    /** 3D の層のカメラ。game.json の "camera" が "perspective" なら遠近感あり */
    get camera3D() { return camera3D; },
    get camera() { return camera3D; },
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
    if (top.draggable && !top.removed) { rec.drag = top; rec.ox = top.x - p.x; rec.oy = top.y - p.y; }
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
let session = null;
let runCounter = 0;

function report(err) {
  const message = err && err.stack ? String(err.stack) : String(err);
  send({ type: 'error', runId: session ? session.runId : 0, message });
  if (session && !session.result) session.result = 'lose';
}
function safe(fn) {
  try { return fn(); } catch (err) { report(err); return undefined; }
}
function finish(s, win, byTimeup = false) {
  if (s !== session || s.result) return;
  s.result = win ? 'win' : 'lose';
  if (!byTimeup) s.hitstop = HITSTOP_SEC;   // 勝敗が決まった瞬間、少しのあいだスローにする
  send({ type: 'result', runId: s.runId, win });
}

function unload() {
  disposeComposer();
  session = null;
  for (const sc of [scene, scene2D]) for (const c of [...sc.children]) { sc.remove(c); disposeObject(c); }
  scene.background = null;
  pointers.clear();
}

async function load(m) {
  unload();
  const s = {
    runId: m.runId, nodes: new Set(), tweens: [], timers: [], handlers: {}, beatHandlers: [], nextBeat: 0, pending: [],
    result: null, started: false, time: 0, speed: Number(m.speed) || 1,
    timeoutResult: m.timeoutResult === 'win' ? 'win' : 'lose', game: null, ctx: null,
  };
  camera3D = makeCamera3D(m.camera === 'perspective' ? 'perspective' : 'ortho');
  s.ctx = makeCtx(s, m);
  session = s;
  try {
    const url = new URL(m.url);
    url.searchParams.set('run', String(++runCounter)); // 毎回まっさらな状態で読み込む
    const mod = await import(url.href);
    if (session !== s) return;
    s.game = mod.default;
    if (!s.game || typeof s.game !== 'object') throw new Error('main.js は export default { init, update } の形にしてください');
    if (s.game.init) await s.game.init(s.ctx);
    // 画像の読み込みを待つ（最大5秒）
    await Promise.race([Promise.all(s.pending), new Promise(r => setTimeout(r, 5000))]);
    if (session === s) send({ type: 'ready', runId: s.runId });
  } catch (err) {
    if (session === s) report(err);
  }
}

window.addEventListener('message', e => {
  if (e.source !== parentWin) return;
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  const s = session;
  switch (m.type) {
    case 'load': load(m); break;
    case 'start': if (s && s.runId === m.runId) s.started = true; break;
    case 'timeup': if (s && s.runId === m.runId && !s.result) finish(s, s.timeoutResult === 'win', true); break;
    case 'unload': unload(); break;
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
  for (const n of s.nodes) {
    if (n.vx) n.x += n.vx * dt;
    if (n.vy) n.y += n.vy * dt;
    if (n.vr) n.rotation += n.vr * dt;
  }
  if (s.game && s.game.update) safe(() => s.game.update(dt, s.ctx));
}

let last = performance.now(), lastBeat = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const s = session;
  if (s && s.started) {
    let k = s.speed;
    if (s.hitstop > 0) { s.hitstop -= dt; k *= HITSTOP_SCALE; }
    step(s, dt * k);
  }
  if (composer) {
    composer.render(dt);
    if (fxLayers === '3d') { renderer.clearDepth(); renderer.render(scene2D, camera2D); }
  } else {
    renderer.clear();
    renderer.render(scene, camera3D);
    renderer.clearDepth();
    renderer.render(scene2D, camera2D);
  }
  if (now - lastBeat > 500) { lastBeat = now; send({ type: 'heartbeat' }); }
}
requestAnimationFrame(frame);
send({ type: 'boot' });
