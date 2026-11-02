// ロボジャンプ（glb のサンプル）：長押しすると、ジャンプの着地点（▼）が行ったり来たりする。足場の上で指を離す
// glb は ctx.loadGLB で読み、アニメーションは ctx.playAnimation(モデル, '名前') で再生する。
// モデルはメートル単位で作られていることが多いので、3D の層のカメラをシーンに合わせて向け直して使う。
const START_X = -1.3;            // ロボットが立つ位置（メートル）
const LEDGE_END = -0.95;         // 左の足場の右端
const MIN_D = 0.7, MAX_D = 3.0;  // ジャンプで進む距離の範囲
const JUMP_H = 0.9;              // ジャンプの高さ
const JUMP_TIME = 0.6;           // ジャンプにかかる時間（ゲーム内の秒）
const ROBOT_H = 1.0;             // ロボットの背の高さ

export default {
  async init(ctx) {
    const { THREE } = ctx;
    ctx.background('#bfe6ff');
    ctx.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(2, 4, 5);
    ctx.scene.add(sun);
    ctx.camera3D.position.set(0.05, 1.7, 7);
    ctx.camera3D.lookAt(0.05, 0.5, 0);

    // ロボット（右を向かせて、背の高さを ROBOT_H にそろえる）
    this.robot = await ctx.loadGLB('assets/robot.glb');
    const body = this.robot.scene;
    const box = new THREE.Box3().setFromObject(body);
    body.scale.setScalar(ROBOT_H / (box.max.y - box.min.y));
    body.position.set(START_X, 0, 0);
    body.rotation.y = Math.PI / 2;         // モデルは +Z（手前）を向いているので、右（+X）に向ける
    ctx.scene.add(body);
    ctx.playAnimation(this.robot, 'Idle');
    body.traverse(o => { if (o.morphTargetDictionary && 'Surprised' in o.morphTargetDictionary) this.face = o; });

    // 足場：左の足場と、ゴールの足場（難しいほど細い）
    const block = (x0, x1, color) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 3, 1.2), new THREE.MeshStandardMaterial({ color }));
      m.position.set((x0 + x1) / 2, -1.5, 0);
      ctx.scene.add(m);
      return m;
    };
    block(-4, LEDGE_END, 0x7f8c99);
    this.pw = [0.9, 0.7, 0.5][ctx.difficulty - 1];
    this.px = ctx.random(0.0, 1.25);
    block(this.px - this.pw / 2, this.px + this.pw / 2, 0xffb347);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 3), new THREE.MeshStandardMaterial({ color: 0xff5a5f }));
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(this.px + 0.1, 0.6, -0.4);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7), new THREE.MeshStandardMaterial({ color: 0x555555 }));
    pole.position.set(this.px - 0.05, 0.35, -0.4);
    ctx.scene.add(flag, pole);

    // 着地点の目印（▼）と、ジャンプの軌道（長押しの間だけ出す）
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 4), new THREE.MeshBasicMaterial({ color: 0xff2d55 }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.arcPoints = Array.from({ length: 24 }, () => new THREE.Vector3());
    this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.arcPoints),
      new THREE.LineBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.6 }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    ctx.scene.add(this.marker, this.arc);

    this.period = [1.5, 1.15, 0.85][ctx.difficulty - 1];   // 着地点が1往復する時間（ゲーム内の秒）
    this.state = 'ready';

    // 着地できた：空が明るくなり、サムズアップのあとダンス。
    // 失敗：空がくもる。跳ばなかったときは首を横にふって、悲しい顔
    ctx.onResult(win => {
      this.marker.visible = this.arc.visible = false;
      const setFace = (name, v) => { if (this.face && name in this.face.morphTargetDictionary) this.face.morphTargetInfluences[this.face.morphTargetDictionary[name]] = v; };
      if (win) {
        ctx.background('#ffe48a');
        ctx.happy(flag, { amp: 0.15 });
        ctx.after(0.9, () => ctx.playAnimation(this.robot, 'Dance', { fade: 0.2 }));
      } else {
        ctx.background('#6b7684');
        if (this.state !== 'fall') {
          this.state = 'done';
          ctx.playAnimation(this.robot, 'No', { loop: false, fade: 0.15 });
          setFace('Sad', 1);
        }
      }
    });
    ctx.text('長押しして、足場の上で はなす', { x: 270, y: 880, size: 28, color: '#2d5a80' });

    ctx.input.on('down', () => {
      if (this.state !== 'ready' || ctx.result) return;
      this.state = 'charge';
      this.t0 = ctx.time;
      this.marker.visible = this.arc.visible = true;
      ctx.sound.play('charge');
    });
    ctx.input.on('up', () => {
      if (this.state !== 'charge' || ctx.result) return;
      this.jump(ctx);
    });
  },

  /** 長押しの強さ。0 → 1 → 0 と行ったり来たりする */
  power(ctx) {
    const u = ((ctx.time - this.t0) / this.period) % 1;
    return u < 0.5 ? u * 2 : 2 - u * 2;
  },
  landX(p) { return START_X + MIN_D + (MAX_D - MIN_D) * p; },

  jump(ctx) {
    this.state = 'jump';
    this.jx1 = this.landX(this.power(ctx));
    this.jt = 0;
    this.marker.visible = this.arc.visible = false;
    ctx.sound.play('jump');
    ctx.playAnimation(this.robot, 'Jump', { loop: false, fade: 0.1, timeScale: 1.5 });
  },

  update(dt, ctx) {
    if (!this.robot) return;
    const body = this.robot.scene;

    if (this.state === 'charge') {
      if (ctx.result) { this.state = 'done'; this.marker.visible = this.arc.visible = false; return; }
      const x = this.landX(this.power(ctx));
      this.marker.position.set(x, 0.25 + Math.abs(Math.sin(ctx.time * 8)) * 0.08, 0);
      this.arcPoints.forEach((p, i) => {
        const u = i / (this.arcPoints.length - 1);
        p.set(START_X + (x - START_X) * u, 4 * JUMP_H * u * (1 - u) + 0.5, 0);
      });
      this.arc.geometry.setFromPoints(this.arcPoints);
    }

    if (this.state === 'jump') {
      this.jt += dt / JUMP_TIME;
      const u = Math.min(1, this.jt);
      body.position.x = START_X + (this.jx1 - START_X) * u;
      body.position.y = 4 * JUMP_H * u * (1 - u);
      if (u >= 1) {
        if (Math.abs(this.jx1 - this.px) <= this.pw / 2) {
          this.state = 'done';
          body.position.y = 0;
          ctx.sound.play('land');
          ctx.playAnimation(this.robot, 'ThumbsUp', { loop: false, fade: 0.1 });
          ctx.win();
        } else {
          this.state = 'fall';
          this.vy = 0;
          ctx.sound.play('fall');
          if (this.face) this.face.morphTargetInfluences[this.face.morphTargetDictionary.Surprised] = 1;
          ctx.lose();
        }
      }
    }

    if (this.state === 'fall') {
      this.vy -= 9.8 * dt;
      body.position.y += this.vy * dt;
      body.rotation.z -= 2 * dt;
      if (body.position.y < -4) this.state = 'done';
    }
  },
};
