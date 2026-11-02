// ボウリング（3D の物理エンジンのサンプル）：触れた位置でボールの左右を決め、上にスワイプして投げる。
// 物理は ctx.physics3d.add(three の物体, オプション) を付けるだけ。位置と回転は自動で動く。
// 単位はメートル。レーンは奥（-z）に向かってのびる。
const LANE_W = 1.1;           // レーンの幅
const LANE_FAR = -6.6;        // レーンの奥の端
const BALL_R = 0.13;
const BALL_Z = 1.2;           // ボールを置く位置
const PIN_Z = -4.8;           // 先頭のピンの位置
const PIN_GAP = 0.3;          // ピンの間隔

/** ピンの形（回転体）。底が y = 0 */
function pinGeometry(THREE) {
  const pts = [[0, 0], [0.032, 0], [0.05, 0.05], [0.06, 0.13], [0.048, 0.2], [0.027, 0.26], [0.03, 0.31], [0.033, 0.35], [0.02, 0.38], [0, 0.385]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 16);
}

export default {
  init(ctx) {
    const { THREE } = ctx;
    ctx.background('#1d2333');
    ctx.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1.5, 4, 3);
    ctx.scene.add(sun);
    const cam = ctx.camera3D;
    cam.near = 0.05;
    cam.updateProjectionMatrix();
    cam.position.set(0, 0.85, 2.7);
    cam.lookAt(0, 0.05, -3.2);

    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, ...extra });
    const box = (w, h, d, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(color));
      m.position.set(x, y, z);
      ctx.scene.add(m);
      return m;
    };

    // レーン（すべりやすい木の床）。外に落ちたボールは溝（ガター）に入る
    const laneLen = 2.4 - LANE_FAR;
    const lane = this.lane = box(LANE_W, 0.2, laneLen, 0xdaa56a, 0, -0.1, (2.4 + LANE_FAR) / 2);
    ctx.physics3d.add(lane, { static: true, friction: 0.08, bounce: 0.1 });
    for (let i = -1; i <= 1; i += 2) {
      box(0.04, 0.005, laneLen, 0xb4844f, i * 0.3, 0.001, (2.4 + LANE_FAR) / 2);         // レーンの目印の線
      box(0.25, 0.1, laneLen, 0x2b3346, i * (LANE_W / 2 + 0.125), -0.32, (2.4 + LANE_FAR) / 2);   // 溝
      // 溝の外側の壁（溝に落ちたボールやピンが、外へ転がっていかないように）
      const side = box(0.1, 0.6, laneLen + 1, 0x161b28, i * (LANE_W / 2 + 0.3), 0, (2.4 + LANE_FAR - 1) / 2);
      ctx.physics3d.add(side, { static: true, bounce: 0.1 });
    }
    ctx.physics3d.ground({ y: -0.27, friction: 0.3 });
    const back = box(LANE_W + 0.8, 1.2, 0.2, 0x111622, 0, 0.3, LANE_FAR - 0.6);    // 奥の壁
    ctx.physics3d.add(back, { static: true, bounce: 0.1 });
    // かんたんのときだけ、溝に落ちないようにガードを付ける
    if (ctx.difficulty === 1) {
      for (let i = -1; i <= 1; i += 2) {
        const guard = box(0.06, 0.16, laneLen - 1.2, 0xff8a5c, i * (LANE_W / 2 + 0.03), 0.08, (2.4 + LANE_FAR) / 2 - 0.6);
        ctx.physics3d.add(guard, { static: true, bounce: 0.4, friction: 0.1 });
      }
    }

    // ピン（三角に並べる）
    const rows = ctx.difficulty === 1 ? 3 : 4;
    this.need = [4, 6, 8][ctx.difficulty - 1];
    const geo = pinGeometry(THREE);
    const white = std(0xfafafa, { roughness: 0.35 }), red = std(0xd7263d);
    this.pins = [];
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i <= r; i++) {
        const pin = new THREE.Mesh(geo, white);
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), red);
        stripe.rotation.x = Math.PI / 2;
        stripe.position.y = 0.285;
        pin.add(stripe);
        pin.position.set((i - r / 2) * PIN_GAP, 0, PIN_Z - r * PIN_GAP * 0.87);
        ctx.scene.add(pin);
        ctx.physics3d.add(pin, { shape: 'cylinder', mass: 1.5, bounce: 0.4, friction: 0.4 });
        this.pins.push(pin);
      }
    }

    // ボール
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 16), std(0x2541b2, { roughness: 0.15, metalness: 0.3 }));
    this.ball.position.set(0, BALL_R, BALL_Z);
    ctx.scene.add(this.ball);
    ctx.physics3d.add(this.ball, { mass: 6, friction: 0.08, bounce: 0.1 });
    // ボールがピンに当たったときと、ピンどうしが当たったとき
    let lastCrash = -1;
    for (const pin of this.pins) {
      ctx.physics3d.onHit(pin, ({ speed }) => {
        if (speed > 1.2 && ctx.time - lastCrash > 0.25) { lastCrash = ctx.time; ctx.sound.play('crash'); }
      });
    }

    // 倒せた：照明がカラフルに変わり、レーンが金色に光って、残ったピンも踊る。
    // 足りなかった：照明が落ちて、ボールがうなだれる
    ctx.onResult(win => {
      this.hint.visible = false;
      if (win) {
        ctx.background('#3b2a7a');
        this.lane.material.emissive.set(0x6a4a10);
        const all = this.pins.every(p => p.userData.fallen);
        ctx.happy(ctx.text(all ? 'ストライク！' : 'ナイス！', { x: 270, y: 220, size: 72, weight: 900, color: '#ffd23f', stroke: '#3b2a7a', strokeWidth: 10, z: 5 }));
        for (const p of this.pins.filter(p => !p.userData.fallen)) { ctx.physics3d.remove(p); ctx.happy(p, { amp: 0.08 }); }
        this.party = true;
      } else {
        ctx.background('#07080c');
        this.lane.material.color.set(0x6b5a48);
        ctx.sad(ctx.text(this.thrown ? 'ざんねん…' : 'なげて！', { x: 270, y: 220, size: 64, weight: 900, color: '#9aa3b5', stroke: '#07080c', strokeWidth: 8, z: 5 }), { amp: 40 });
      }
      this.label.visible = false;
    });

    this.thrown = false;
    this.label = ctx.text(`${this.need}本たおせ！`, { x: 270, y: 120, size: 40, weight: 900, color: '#ffffff', stroke: '#1d2333', strokeWidth: 8 });
    this.hint = ctx.text('さわった所から、上にスワイプ', { x: 270, y: 880, size: 26, color: '#c8d3ea' });

    // 触れた位置で、ボールの左右の位置を決める
    ctx.input.on('down', e => {
      if (this.thrown || ctx.result) return;
      this.ball.position.x = Math.max(-0.4, Math.min(0.4, (e.x - 270) / 540 * 1.1));
    });
    // 上にスワイプで投げる。スワイプの向きで、まっすぐか斜めかが決まる
    ctx.input.on('swipe', e => {
      if (this.thrown || ctx.result || e.dy > -40) return;
      this.thrown = true;
      this.throwTime = ctx.time;
      const speed = Math.max(5, Math.min(8.5, -e.dy / 40));
      const side = Math.max(-0.2, Math.min(0.2, e.dx / -e.dy)) * speed;
      ctx.physics3d.push(this.ball, side, 0, -speed);
      ctx.sound.play('roll');
      this.hint.visible = false;
    });
  },

  update(dt, ctx) {
    if (!this.ball) return;
    // カメラはボールを少し追いかける
    const cam = ctx.camera3D;
    const tz = Math.max(-1.6, Math.min(2.7, this.ball.position.z + 1.5));
    cam.position.z += (tz - cam.position.z) * Math.min(1, dt * 3);
    cam.lookAt(0, 0.05, Math.min(cam.position.z - 5.9, -3.2));

    // 勝ったあとは、レーンの色が虹色にゆっくり変わる
    if (this.party) this.lane.material.color.setHSL((ctx.time * 0.4) % 1, 0.65, 0.62);
    if (ctx.result) return;
    // 倒れたピンを数える（大きく傾いたまま 0.3 秒たったか、レーンから落ちたもの。ぐらついただけでは数えない）
    const up = new ctx.THREE.Vector3();
    for (const p of this.pins) {
      const tilted = up.set(0, 1, 0).applyQuaternion(p.quaternion).y < 0.5 || p.position.y < -0.1;
      p.userData.downFor = tilted ? (p.userData.downFor || 0) + dt : 0;
      if (p.userData.downFor > 0.3) p.userData.fallen = true;
    }
    const down = this.pins.filter(p => p.userData.fallen).length;
    this.label.text = this.thrown ? `${down} / ${this.need}` : `${this.need}本たおせ！`;
    if (down >= this.need) { ctx.sound.play('coin'); ctx.win(); return; }
    // 投げてから 3.5 秒たっても足りなければ失敗
    if (this.thrown && ctx.time - this.throwTime > 3.5) ctx.lose();
  },
};
