// ctx.physics3d：3D の物理エンジン（cannon-es）を、three の物体のままで使えるようにする。
// - 単位はメートル。重力は既定で下向き 9.8m/秒²
// - 物体は ctx.scene の直下に置く（位置と回転をそのまま物理と合わせる）
// - ゲーム内の時間（スピード倍率込みの dt）を 1/120 秒ずつ刻んで進める。同じ入力なら毎回同じ動きになる
// - object.position / quaternion（rotation）を書き換えると、物理の側にも反映される（瞬間移動）
import * as THREE from '../vendor/three.module.min.js';

const STEP = 1 / 120;         // 3D は速い物体がめり込みやすいので、2D より細かく刻む
const MAX_STEPS = 16;

let CANNON = null;
let loading = null;
/** cannon-es を読み込む（サンドボックスの起動時に裏で始めて、最初のゲームの init の前に待つ） */
export function loadCannon() {
  return (loading ||= import('../vendor/cannon-es/cannon-es.module.min.js').then(m => { CANNON = m; return m; }));
}

const box3 = new THREE.Box3(), v3 = new THREE.Vector3(), q3 = new THREE.Quaternion();

/** 見た目から形を決める。{ shape, offset（物体の位置から形の中心までのずれ）, volume } */
function shapeFor(obj, kind) {
  obj.updateWorldMatrix(true, true);
  const sc = obj.getWorldScale(new THREE.Vector3());
  const g = obj.isMesh && obj.geometry ? obj.geometry : null;
  const p = g && g.parameters ? g.parameters : null;
  const s = Math.max(sc.x, sc.y, sc.z);
  if ((kind === 'auto' || kind === 'sphere') && g && g.type === 'SphereGeometry' && p) {
    const r = p.radius * s;
    return { shape: new CANNON.Sphere(r), offset: new CANNON.Vec3(), volume: 4 / 3 * Math.PI * r ** 3 };
  }
  if ((kind === 'auto' || kind === 'cylinder') && g && g.type === 'CylinderGeometry' && p) {
    const rt = p.radiusTop * sc.x, rb = p.radiusBottom * sc.x, h = p.height * sc.y;
    return { shape: new CANNON.Cylinder(rt, rb, h, 12), offset: new CANNON.Vec3(), volume: Math.PI * ((rt + rb) / 2) ** 2 * h };
  }
  // それ以外は、見た目を包む箱（回転していない状態で測る）。sphere / cylinder の指定なら、その箱に合わせた形にする
  const saved = obj.quaternion.clone();
  obj.quaternion.identity();
  obj.updateWorldMatrix(true, true);
  box3.setFromObject(obj, true);
  obj.quaternion.copy(saved);
  obj.updateWorldMatrix(true, true);
  if (box3.isEmpty()) throw new Error('ctx.physics3d.add：形のない物体です（Mesh かそれを含む物体を渡してください）');
  const size = box3.getSize(new THREE.Vector3()), center = box3.getCenter(new THREE.Vector3());
  const pos = obj.getWorldPosition(new THREE.Vector3());
  const off = new CANNON.Vec3(center.x - pos.x, center.y - pos.y, center.z - pos.z);
  if (kind === 'sphere') {
    const r = Math.max(size.x, size.y, size.z) / 2;
    return { shape: new CANNON.Sphere(r), offset: off, volume: 4 / 3 * Math.PI * r ** 3 };
  }
  if (kind === 'cylinder') {
    const r = Math.max(size.x, size.z) / 2;
    return { shape: new CANNON.Cylinder(r, r, size.y, 12), offset: off, volume: Math.PI * r * r * size.y };
  }
  const half = new CANNON.Vec3(Math.max(size.x, 0.001) / 2, Math.max(size.y, 0.001) / 2, Math.max(size.z, 0.001) / 2);
  return { shape: new CANNON.Box(half), offset: off, volume: size.x * size.y * size.z };
}

/** ctx.physics3d を作る。world はゲームが初めて使ったときに作る */
export function createPhysics3d(s) {
  const P = { world: null, acc: 0, items: new Set(), hits: [], events: [], gravity: [0, -9.8, 0] };
  s.physics3d = P;
  const world = () => {
    if (P.world) return P.world;
    if (!CANNON) throw new Error('3D の物理エンジンの読み込みが終わっていません');
    const w = new CANNON.World({ gravity: new CANNON.Vec3(...P.gravity) });
    w.allowSleep = true;
    w.addEventListener('beginContact', e => {
      const a = e.bodyA && e.bodyA.userData, b = e.bodyB && e.bodyB.userData;
      if (!a || !b) return;
      const va = e.bodyA.velocity, vb = e.bodyB.velocity;
      P.events.push({ a, b, speed: Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z) });
    });
    P.world = w;
    return w;
  };
  // 2つの物体の摩擦・跳ね返りは掛け算で決まるので、平方根を持たせる（同じ値どうしなら、その値になる）
  const material = (friction, bounce) => new CANNON.Material({ friction: Math.sqrt(Math.max(0, friction)), restitution: Math.sqrt(Math.max(0, bounce)) });
  const bodyOf = obj => {
    const b = obj && obj.userData && obj.userData._body;
    if (!b) throw new Error('ctx.physics3d.add を付けていない物体です');
    return b;
  };

  const api = {
    /** 重力（m/秒²）。既定は (0, -9.8, 0) */
    gravity(x, y, z) {
      P.gravity = [Number(x) || 0, Number(y) || 0, Number(z) || 0];
      if (P.world) P.world.gravity.set(...P.gravity);
    },
    /**
     * three の物体に物理を付ける。形は shape: 'auto'（既定。球・円柱はそのまま、それ以外は包む箱）/ 'box' / 'sphere' / 'cylinder'。
     * opts: static, bounce（0〜1、既定 0.3）, friction（0〜1、既定 0.5）, mass（重さ kg。既定は大きさから）,
     *       fixedRotation, sensor（ぶつからず、重なったことだけ onHit で知る）, damping（空気抵抗 0〜1、既定 0.01）
     */
    add(obj, { shape = 'auto', static: isStatic = false, bounce = 0.3, friction = 0.5, mass, fixedRotation = false, sensor = false, damping = 0.01 } = {}) {
      if (!obj || !obj.isObject3D) throw new Error('ctx.physics3d.add には three の物体（Mesh など）を渡してください');
      if (obj.userData._body) api.remove(obj);
      const w = world();
      const sh = shapeFor(obj, shape);
      obj.updateWorldMatrix(true, false);
      const pos = obj.getWorldPosition(v3), quat = obj.getWorldQuaternion(q3);
      // 重心は形の中心に置く（物体の原点が底にあると、起き上がりこぼしのようになる）。
      // 物体の原点から形の中心までのずれ（off）を覚えておき、位置を合わせるときに使う
      const cq = new CANNON.Quaternion(quat.x, quat.y, quat.z, quat.w);
      const wo = cq.vmult(sh.offset);
      const body = new CANNON.Body({
        mass: isStatic ? 0 : (mass ?? Math.max(0.05, sh.volume * 1000)),
        type: isStatic ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
        position: new CANNON.Vec3(pos.x + wo.x, pos.y + wo.y, pos.z + wo.z),
        quaternion: cq,
        material: material(friction, bounce),
        fixedRotation, isTrigger: sensor,
        linearDamping: damping, angularDamping: Math.max(damping, 0.05),
      });
      body.addShape(sh.shape);
      body.userData = obj;
      w.addBody(body);
      obj.userData._body = body;
      obj.userData._off = sh.offset;
      P.items.add(obj);
      sync(obj);
      return obj;
    },
    /** 物理を外す（物体は残る）。シーンから外した物体は自動で外れる */
    remove(obj) {
      const b = obj && obj.userData && obj.userData._body;
      if (!b) return;
      if (P.world) P.world.removeBody(b);
      obj.userData._body = null;
      P.items.delete(obj);
    },
    /** 勢いをつける（速度 m/秒 を足す） */
    push(obj, x = 0, y = 0, z = 0) {
      const b = bodyOf(obj);
      b.velocity.x += x; b.velocity.y += y; b.velocity.z += z;
      b.wakeUp();
    },
    /** 回転の勢いをつける（角速度 ラジアン/秒 を足す） */
    spin(obj, x = 0, y = 0, z = 0) {
      const b = bodyOf(obj);
      b.angularVelocity.x += x; b.angularVelocity.y += y; b.angularVelocity.z += z;
      b.wakeUp();
    },
    /** いまの速度（THREE.Vector3、m/秒） */
    velocity(obj) {
      const v = bodyOf(obj).velocity;
      return new THREE.Vector3(v.x, v.y, v.z);
    },
    /** 止める（速度と回転の勢いを 0 に） */
    stop(obj) {
      const b = bodyOf(obj);
      b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
    },
    /**
     * ぶつかったときに fn({ a, b, speed }) を呼ぶ。speed はぶつかった速さ（m/秒）。
     * onHit(a, b, fn)：a と b がぶつかったとき / onHit(a, fn)：a が何かにぶつかったとき
     */
    onHit(a, b, fn) {
      if (typeof b === 'function') { fn = b; b = null; }
      if (typeof fn !== 'function') throw new Error('ctx.physics3d.onHit(a, b, fn) の fn に関数を渡してください');
      P.hits.push({ a, b, fn });
    },
    /** 見えない地面（高さ y の水平な面、下は全部うまっている）。戻り値を onHit に使える */
    ground({ y = 0, bounce = 0.3, friction = 0.5 } = {}) {
      const w = world();
      const ground = { ground: true };
      const body = new CANNON.Body({ type: CANNON.Body.STATIC, mass: 0, material: material(friction, bounce) });
      body.addShape(new CANNON.Plane());
      body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      body.position.set(0, y, 0);
      body.userData = ground;
      w.addBody(body);
      return ground;
    },
  };
  return api;
}

function sync(obj) {
  obj.userData._pp = obj.position.clone();
  obj.userData._pq = obj.quaternion.clone();
}

/** 1フレーム進める（runtime の step から呼ぶ） */
export function physics3dStep(s, dt, safe) {
  const P = s.physics3d;
  if (!P || !P.world) return;
  // ゲームが書き換えた位置・回転を物理に反映する（シーンから外れた物体は物理も外す）
  for (const obj of P.items) {
    const b = obj.userData._body;
    if (!obj.parent) { P.world.removeBody(b); obj.userData._body = null; P.items.delete(obj); continue; }
    const u = obj.userData;
    if (!obj.position.equals(u._pp) || !obj.quaternion.equals(u._pq)) {
      b.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
      const wo = b.quaternion.vmult(u._off);
      b.position.set(obj.position.x + wo.x, obj.position.y + wo.y, obj.position.z + wo.z);
      b.wakeUp();
    }
  }
  P.acc = Math.min(P.acc + dt, STEP * MAX_STEPS);
  while (P.acc >= STEP) {
    P.world.step(STEP);
    P.acc -= STEP;
  }
  // 物理の結果を物体に戻す
  for (const obj of P.items) {
    const b = obj.userData._body;
    const wo = b.quaternion.vmult(obj.userData._off);
    obj.position.set(b.position.x - wo.x, b.position.y - wo.y, b.position.z - wo.z);
    obj.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    sync(obj);
  }
  // ぶつかったときの呼び出し（計算が終わってから呼ぶ）
  for (const e of P.events.splice(0)) {
    for (const h of P.hits) {
      const match = (x, y) => h.a === x && (!h.b || h.b === y);
      if (match(e.a, e.b)) safe(() => h.fn({ a: e.a, b: e.b, speed: e.speed }));
      else if (match(e.b, e.a)) safe(() => h.fn({ a: e.b, b: e.a, speed: e.speed }));
    }
  }
}
