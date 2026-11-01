// ポーズまね（VRM）：キャラクターが指した向きと同じ方向にスワイプする。16拍の間に何回か出題される
// VRM のサンプル。モデルはメートル単位なので、3D の層のカメラをキャラクターに向け直して使う。
// キャラクターは +Z（カメラ側）を向いて立つ。キャラクターの左腕は画面の右側に見える。
const ARROWS = { up: '▲', down: '▼', left: '◀', right: '▶' };

// ポーズ（正規化ボーンの回転、ラジアン）。腕は T ポーズ（真横）が基準
const POSES = {
  idle:  { lUA: [0, 0, -1.25], rUA: [0, 0, 1.25], lLA: [0, 0, -0.15], rLA: [0, 0, 0.15], spine: [0, 0, 0], head: [0, 0, 0] },
  up:    { lUA: [0, 0, 1.15], rUA: [0, 0, -1.15], lLA: [0, 0, 0.1], rLA: [0, 0, -0.1], spine: [-0.05, 0, 0], head: [-0.25, 0, 0] },
  down:  { lUA: [0, -0.5, -1.35], rUA: [0, 0.5, 1.35], lLA: [0, -0.3, 0], rLA: [0, 0.3, 0], spine: [0.45, 0, 0], head: [0.35, 0, 0] },
  // 画面の右 ＝ キャラクターの左腕を真横に
  right: { lUA: [0, 0, 0.05], rUA: [0, 0, 1.25], lLA: [0, 0, 0], rLA: [0, 0, 0.15], spine: [0, 0, -0.12], head: [0, 0.5, 0] },
  left:  { lUA: [0, 0, -1.25], rUA: [0, 0, -0.05], lLA: [0, 0, -0.15], rLA: [0, 0, 0], spine: [0, 0, 0.12], head: [0, -0.5, 0] },
};
const BONES = { lUA: 'leftUpperArm', rUA: 'rightUpperArm', lLA: 'leftLowerArm', rLA: 'rightLowerArm', spine: 'spine', head: 'head' };

export default {
  async init(ctx) {
    const { THREE } = ctx;
    ctx.background('#ffe9f2');
    ctx.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 2, 3);
    ctx.scene.add(sun);

    // ステージの床（3D）
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshStandardMaterial({ color: 0xffb6d0 }));
    floor.rotation.x = -Math.PI / 2;
    ctx.scene.add(floor);

    // カメラをキャラクターに向ける（メートル単位）
    ctx.camera3D.position.set(0, 1.0, 2.8);
    ctx.camera3D.lookAt(0, 0.92, 0);

    this.vrm = await ctx.loadVRM('assets/avatar.vrm');
    ctx.scene.add(this.vrm.scene);
    this.hips = this.vrm.humanoid.getNormalizedBoneNode('hips');
    this.hipsY = this.hips.position.y;
    this.bones = Object.fromEntries(Object.entries(BONES).map(([k, name]) => [k, this.vrm.humanoid.getNormalizedBoneNode(name)]));
    this.pose = 'idle';
    this.applyPose(1);

    // 出題（難易度で回数が変わる）。各問、次の問題までにスワイプする
    const rounds = [3, 4, 5][ctx.difficulty - 1];
    const span = 12 / rounds;
    this.schedule = Array.from({ length: rounds }, (_, i) => 2 + i * span);
    this.limit = Math.min(span, 2.5);          // 答えられる時間（拍）
    this.round = -1;
    this.waiting = null;

    this.arrow = ctx.text('', { x: 270, y: 150, size: 120, color: '#ff4f8b', stroke: '#ffffff', strokeWidth: 10 });
    this.count = ctx.text(`0 / ${rounds}`, { x: 270, y: 840, size: 40, color: '#b0567c' });
    ctx.text('同じ向きにスワイプ', { x: 270, y: 905, size: 28, color: '#b0567c' });
    this.rounds = rounds;
    this.cleared = 0;

    // 指を置いてから離すまでの移動の向きで判定する（速さは問わない。50px 以上動かせばよい）
    ctx.input.on('down', e => { this.start = { x: e.x, y: e.y }; });
    ctx.input.on('up', e => {
      if (ctx.result || !this.waiting || !this.start) return;
      const dx = e.x - this.start.x, dy = e.y - this.start.y;
      this.start = null;
      if (Math.hypot(dx, dy) < 50) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (dir === this.waiting.dir) {
        this.cleared++;
        this.count.text = `${this.cleared} / ${this.rounds}`;
        this.arrow.color = '#29bf12';
        this.expression('happy', 1);
        ctx.sound.play('good');
        this.waiting = null;
        if (this.cleared >= this.rounds) ctx.win();
      } else {
        this.fail(ctx);
      }
    });
  },

  ask(ctx) {
    const dirs = Object.keys(ARROWS).filter(d => d !== this.pose);
    const dir = ctx.pick(dirs);
    this.pose = dir;
    this.waiting = { dir, until: ctx.beat + this.limit };
    this.arrow.text = ARROWS[dir];
    this.arrow.color = '#ff4f8b';
    this.arrow.scale = 1.4;
    ctx.tween(this.arrow, { scale: 1 }, { duration: 0.15, ease: 'back' });
    this.expression('happy', 0);
    this.expression('surprised', 0.6);
    ctx.sound.play('cue');
  },

  fail(ctx) {
    this.waiting = null;
    this.arrow.color = '#888888';
    this.expression('surprised', 0);
    this.expression('sad', 1);
    ctx.lose();
  },

  expression(name, value) {
    if (this.vrm.expressionManager) this.vrm.expressionManager.setValue(name, value);
  },

  /** 目標のポーズへ少しずつ近づける（k = 1 なら一気に） */
  applyPose(k) {
    const target = POSES[this.pose];
    for (const [key, bone] of Object.entries(this.bones)) {
      if (!bone) continue;
      const [x, y, z] = target[key];
      bone.rotation.x += (x - bone.rotation.x) * k;
      bone.rotation.y += (y - bone.rotation.y) * k;
      bone.rotation.z += (z - bone.rotation.z) * k;
    }
  },

  update(dt, ctx) {
    if (!this.vrm) return;
    // 出題のタイミング
    while (this.round + 1 < this.schedule.length && ctx.beat >= this.schedule[this.round + 1] && !ctx.result) {
      this.round++;
      this.ask(ctx);
    }
    if (this.waiting && ctx.beat > this.waiting.until && !ctx.result) this.fail(ctx);

    // ポーズへ近づける・拍に合わせて弾む・まばたき
    this.applyPose(Math.min(1, dt * 14));
    const bounce = Math.abs(Math.sin(ctx.beat * Math.PI));
    this.hips.position.y = this.hipsY - 0.03 + bounce * 0.03 - (this.pose === 'down' ? 0.12 : 0);
    this.vrm.scene.rotation.y = Math.sin(ctx.beat * Math.PI * 0.5) * 0.08;
    const blink = (ctx.time % 2.7) < 0.12 ? 1 : 0;
    this.expression('blink', ctx.result === 'lose' ? 0 : blink);
  },
};
