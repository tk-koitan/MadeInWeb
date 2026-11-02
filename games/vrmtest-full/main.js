// VRM の重さテスト：2体の VRM を並べる。手をあげた方をタッチする（8拍）
// vrmtest-full（元の大きさ）と vrmtest-slim（tools/vrm-slim.mjs で縮めたもの）は同じコードで、モデルファイルだけが違う。
// 読み込みにかかる時間は、デバッグ表示（バージョン表示を5回タップ）の読み込みバーで比べる。
const MODELS = ['assets/a.vrm', 'assets/b.vrm'];
const X = [-0.45, 0.45];                 // 左・右に立たせる（メートル）

// 正規化ボーンの回転（ラジアン）。腕は T ポーズ（真横）が基準
const ARMS_DOWN = { leftUpperArm: [0, 0, -1.25], rightUpperArm: [0, 0, 1.25] };
const LEFT_UP = { leftUpperArm: [0, 0, 1.15], rightUpperArm: [0, 0, 1.25] };    // キャラクターの左腕をあげる
const BOTH_UP = { leftUpperArm: [0, 0, 1.15], rightUpperArm: [0, 0, -1.15] };

export default {
  async init(ctx) {
    const { THREE } = ctx;
    ctx.background('#e8f4ff');
    ctx.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 2, 3);
    ctx.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), new THREE.MeshStandardMaterial({ color: 0xb8d8f0 }));
    floor.rotation.x = -Math.PI / 2;
    ctx.scene.add(floor);
    ctx.camera3D.position.set(0, 1.0, 3.4);
    ctx.camera3D.lookAt(0, 0.9, 0);

    // 2体を同時に読み込む
    const vrms = await Promise.all(MODELS.map(p => ctx.loadVRM(p)));
    this.chars = vrms.map((vrm, i) => {
      vrm.scene.position.x = X[i];
      ctx.scene.add(vrm.scene);
      const hips = vrm.humanoid.getNormalizedBoneNode('hips');
      return { vrm, hips, hipsY: hips.position.y, pose: ARMS_DOWN };
    });

    this.answer = ctx.randInt(0, 1);
    this.asked = false;
    ctx.text('手をあげた方をタッチ', { x: 270, y: 815, size: 30, color: '#3a6a9a' });
    // クレジット表記（Seed-san のライセンスで必要）
    ctx.text('Seed-san © VirtualCast, Inc.', { x: 270, y: 855, size: 18, color: '#5a7a9a', weight: 'normal' });
    ctx.onBeat(b => {
      if (b !== 2 || ctx.result) return;
      this.asked = true;
      const c = this.chars[this.answer];
      c.pose = LEFT_UP;
      this.expression(c, 'surprised', 0.6);
      ctx.sound.play('cue');
    });
    // 画面の左半分なら左のキャラクター、右半分なら右のキャラクター
    ctx.input.on('tap', e => {
      if (!this.asked || ctx.result) return;
      const pick = e.x < ctx.W / 2 ? 0 : 1;
      const c = this.chars[pick];
      if (pick === this.answer) {
        c.pose = BOTH_UP;
        this.expression(c, 'surprised', 0);
        this.expression(c, 'happy', 1);
        ctx.sound.play('good');
        ctx.win();
      } else {
        this.expression(c, 'sad', 1);
        ctx.lose();
      }
    });
  },

  expression(c, name, value) {
    if (c.vrm.expressionManager) c.vrm.expressionManager.setValue(name, value);
  },

  update(dt, ctx) {
    if (!this.chars) return;
    const k = Math.min(1, dt * 14);
    const bounce = Math.abs(Math.sin(ctx.beat * Math.PI));
    const blink = (ctx.time % 2.7) < 0.12 ? 1 : 0;
    this.chars.forEach((c, i) => {
      for (const [bone, [x, y, z]] of Object.entries(c.pose)) {
        const node = c.vrm.humanoid.getNormalizedBoneNode(bone);
        if (!node) continue;
        node.rotation.x += (x - node.rotation.x) * k;
        node.rotation.y += (y - node.rotation.y) * k;
        node.rotation.z += (z - node.rotation.z) * k;
      }
      c.hips.position.y = c.hipsY - 0.03 + bounce * 0.03;
      c.vrm.scene.rotation.y = Math.sin(ctx.beat * Math.PI * 0.5 + i) * 0.1;
      this.expression(c, 'blink', blink);
    });
  },
};
