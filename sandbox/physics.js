// ctx.physics：2D の物理エンジン（planck.js = Box2D）を、画面の px 単位・Node のままで使えるようにする。
// - 座標は画面と同じ（px、y は下向き、回転は時計回りが正）。内部では PPM px = 1m に直して計算する
// - ゲーム内の時間（スピード倍率込みの dt）を 1/60 秒ずつ刻んで進める。同じ入力なら毎回同じ動きになる
// - Node の x / y / rotation / vx / vy / vr を書き換えると、物理の側にも反映される（瞬間移動・速度の変更）
// - ドラッグ中の物体は指に付いてくる。離すとその勢いで飛んでいく
const PPM = 100;               // 100px = 1m（Box2D は 0.1〜10m の物体がいちばん安定する）
const STEP = 1 / 60;
const MAX_STEPS = 8;
const THROW_WINDOW = 0.1;      // 投げる速さは、離す直前のこの秒数の指の動きから決める
const THROW_MAX = 4000;        // 投げる速さの上限（px/秒）

let planck = null;
let planckLoading = null;
/** planck.js を読み込む（サンドボックスの起動時に裏で始めて、最初のゲームの init の前に待つ） */
export function loadPlanck() {
  return (planckLoading ||= import('../vendor/planck/planck.module.min.js').then(m => { planck = m; return m; }));
}

/** ctx.physics を作る。world はゲームが初めて使ったときに作る */
export function createPhysics(s) {
  const P = {
    world: null, acc: 0, bodies: new Set(), hits: [], events: [],
    gravity: { x: 0, y: 1800 },
  };
  s.physics = P;
  const world = () => {
    if (P.world) return P.world;
    if (!planck) throw new Error('物理エンジンの読み込みが終わっていません');
    P.world = new planck.World({ gravity: planck.Vec2(P.gravity.x / PPM, P.gravity.y / PPM) });
    P.world.on('begin-contact', contact => {
      const fa = contact.getFixtureA(), fb = contact.getFixtureB();
      const a = fa.getBody().getUserData(), b = fb.getBody().getUserData();
      if (!a || !b) return;
      const va = fa.getBody().getLinearVelocity(), vb = fb.getBody().getLinearVelocity();
      P.events.push({ a, b, speed: Math.hypot(va.x - vb.x, va.y - vb.y) * PPM });
    });
    return P.world;
  };
  const vec = (x, y) => planck.Vec2(x / PPM, y / PPM);
  const shapeOf = (node, inset = 0) => {
    const sc = node.scale;
    if (node.shape.type === 'circle') return new planck.Circle(Math.max(1, node.shape.r * sc - inset) / PPM);
    return new planck.Box(Math.max(1, node.shape.w * sc / 2 - inset) / PPM, Math.max(1, node.shape.h * sc / 2 - inset) / PPM);
  };

  const api = {
    /** 重力（px/秒²）。既定は (0, 1800)。0, 0 で無重力 */
    gravity(x, y) {
      P.gravity = { x: Number(x) || 0, y: Number(y) || 0 };
      if (P.world) P.world.setGravity(vec(P.gravity.x, P.gravity.y));
    },
    /**
     * Node に物理を付ける。形は Node の当たり判定（円・四角）と同じ。
     * opts: static（動かない）, bounce（跳ね返り 0〜1）, friction（摩擦 0〜1）, density（重さ）,
     *       fixedRotation（回転しない）, sensor（ぶつからずに、重なったことだけ onHit で知る）, bullet（速い物体のすり抜け防止）
     */
    add(node, { static: isStatic = false, bounce = 0.2, friction = 0.4, density = 1, fixedRotation = false, sensor = false, bullet = false } = {}) {
      if (!node || !node.shape) throw new Error('ctx.physics.add には ctx.circle などで作った物体を渡してください');
      if (node._body) api.remove(node);
      const w = world();
      const body = w.createBody({
        type: isStatic ? 'static' : 'dynamic',
        position: vec(node.x, node.y), angle: node.rotation,
        fixedRotation, bullet,
      });
      body.createFixture({ shape: shapeOf(node), density, friction, restitution: bounce, isSensor: sensor });
      if (!isStatic) {
        body.setLinearVelocity(vec(node.vx, node.vy));
        body.setAngularVelocity(node.vr);
      }
      body.setUserData(node);
      node._body = body;
      node._static = isStatic;
      P.bodies.add(node);
      sync(node);
      return node;
    },
    /** 物理を外す（Node は残る）。Node を remove() したときは自動で外れる */
    remove(node) {
      if (!node || !node._body) return;
      if (P.world) P.world.destroyBody(node._body);
      node._body = null;
      P.bodies.delete(node);
    },
    /**
     * ぶつかったときに fn({ a, b, speed }) を呼ぶ。speed はぶつかった速さ（px/秒）。
     * onHit(a, b, fn)：a と b がぶつかったとき / onHit(a, fn)：a が何かにぶつかったとき
     */
    onHit(a, b, fn) {
      if (typeof b === 'function') { fn = b; b = null; }
      if (typeof fn !== 'function') throw new Error('ctx.physics.onHit(a, b, fn) の fn に関数を渡してください');
      P.hits.push({ a, b, fn });
    },
    /**
     * 画面の端に見えない壁を作る（既定は左・右・下。top: true で上も）。
     * 戻り値は壁を表す物で、onHit(ball, walls, fn) のように使える
     */
    walls({ top = false, bottom = true, left = true, right = true, bounce = 0.2, friction = 0.4 } = {}) {
      const w = world(), T = 200;
      const wall = { wall: true, x: 270, y: 480 };
      const body = w.createBody({ type: 'static' });
      body.setUserData(wall);
      const box = (cx, cy, hw, hh) => body.createFixture({ shape: new planck.Box(hw / PPM, hh / PPM, vec(cx, cy), 0), friction, restitution: bounce });
      if (bottom) box(270, 960 + T / 2, 540, T / 2);
      if (top) box(270, -T / 2, 540, T / 2);
      if (left) box(-T / 2, 480, T / 2, 960);
      if (right) box(540 + T / 2, 480, T / 2, 960);
      return wall;
    },
  };
  return api;
}

/** 最後に物理と合わせたときの値を覚えておく（ゲームが書き換えたかどうかを見分けるため） */
function sync(n) {
  n._px = n.x; n._py = n.y; n._pr = n.rotation;
  n._pvx = n.vx; n._pvy = n.vy; n._pvr = n.vr;
}

/** 1フレーム進める（runtime の step から呼ぶ） */
export function physicsStep(s, dt, safe) {
  const P = s.physics;
  if (!P || !P.world) return;
  const { Vec2 } = planck;
  P.time = (P.time || 0) + dt;
  // ゲームが書き換えた位置・速度を物理に反映する
  for (const n of P.bodies) {
    const b = n._body;
    if (n.removed) { P.world.destroyBody(b); n._body = null; P.bodies.delete(n); continue; }
    if (n._dragging) {
      // ドラッグ中：指の位置へ速度で向かわせる。指の動きを覚えておき、離したときにその勢いで投げる
      if (b.getType() !== 'kinematic') { b.setType('kinematic'); n._dragHist = []; }
      n._dragHist.push({ t: P.time, x: n.x, y: n.y });
      while (n._dragHist.length > 2 && P.time - n._dragHist[0].t > THROW_WINDOW) n._dragHist.shift();
      const p = b.getPosition();
      const k = 1 / Math.max(dt, STEP);
      b.setLinearVelocity(Vec2((n.x / PPM - p.x) * k, (n.y / PPM - p.y) * k));
      b.setAngularVelocity(0);
      continue;
    }
    if (b.getType() === 'kinematic' && !n._static) {
      b.setType('dynamic');
      // 離した：直前 0.1 秒の指の動きの速さで投げる
      const h = n._dragHist || [];
      const first = h[0], lastS = h[h.length - 1];
      let vx = 0, vy = 0;
      if (first && lastS && lastS.t > first.t) {
        vx = (lastS.x - first.x) / (lastS.t - first.t);
        vy = (lastS.y - first.y) / (lastS.t - first.t);
        const sp = Math.hypot(vx, vy);
        if (sp > THROW_MAX) { vx *= THROW_MAX / sp; vy *= THROW_MAX / sp; }
      }
      n._dragHist = null;
      n.vx = vx; n.vy = vy; n.vr = 0;
      b.setTransform(Vec2(n.x / PPM, n.y / PPM), n.rotation);
      b.setLinearVelocity(Vec2(vx / PPM, vy / PPM));
      b.setAngularVelocity(0);
      b.setAwake(true);
      sync(n);
      continue;
    }
    if (n.x !== n._px || n.y !== n._py || n.rotation !== n._pr) { b.setTransform(Vec2(n.x / PPM, n.y / PPM), n.rotation); b.setAwake(true); }
    if (n.vx !== n._pvx || n.vy !== n._pvy) { b.setLinearVelocity(Vec2(n.vx / PPM, n.vy / PPM)); b.setAwake(true); }
    if (n.vr !== n._pvr) { b.setAngularVelocity(n.vr); b.setAwake(true); }
  }
  P.acc = Math.min(P.acc + dt, STEP * MAX_STEPS);
  while (P.acc >= STEP) {
    P.world.step(STEP, 8, 3);
    P.acc -= STEP;
  }
  // 物理の結果を Node に戻す
  for (const n of P.bodies) {
    const b = n._body, p = b.getPosition(), v = b.getLinearVelocity();
    n.x = p.x * PPM; n.y = p.y * PPM; n.rotation = b.getAngle();
    n.vx = v.x * PPM; n.vy = v.y * PPM; n.vr = b.getAngularVelocity();
    sync(n);
  }
  // ぶつかったときの呼び出し（物理の計算中は物体を消せないので、計算が終わってから呼ぶ）
  const events = P.events.splice(0);
  for (const e of events) {
    for (const h of P.hits) {
      const match = (x, y) => h.a === x && (!h.b || h.b === y);
      if (match(e.a, e.b)) safe(() => h.fn({ a: e.a, b: e.b, speed: e.speed }));
      else if (match(e.b, e.a)) safe(() => h.fn({ a: e.b, b: e.a, speed: e.speed }));
    }
  }
}

/** 物体に勢いをつける（Node.push から呼ぶ）。物理が付いていない物体は vx / vy に足す */
export function push(n, dx, dy) {
  n.vx += Number(dx) || 0;
  n.vy += Number(dy) || 0;
}
