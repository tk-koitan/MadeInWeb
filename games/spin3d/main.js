// 箱まわし（3D）：横にスワイプして立方体を回し、決められた回数まわす
// ctx.THREE を直接使う 3D のサンプル
export default {
  init(ctx) {
    const { THREE } = ctx;
    ctx.background('#fff3d6');

    // ライト（シーンに直接追加したものも、終了時に自動で片付けられる）
    ctx.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(300, 500, 800);
    ctx.scene.add(sun);

    // 木箱の画像を全面に貼った立方体
    const mat = new THREE.MeshStandardMaterial({ map: ctx.texture('assets/crate.png'), roughness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(220, 220, 220), mat);
    mesh.rotation.x = 0.45;
    mesh.rotation.y = 0.6;
    this.mesh = mesh;
    this.cube = ctx.add3D(mesh, { x: 270, y: 460, r: 160 });

    this.goal = 3 + ctx.difficulty;   // 4〜6回転（16拍 = 8秒）
    this.turns = 0;
    this.omega = 0;                   // 回転の速さ（ラジアン/秒）
    this.label = ctx.text(`0 / ${this.goal}`, { x: 270, y: 760, size: 72, color: '#333333' });
    ctx.text('← 横にスワイプ →', { x: 270, y: 880, size: 28, color: '#a07c3b' });

    // まわしきった：明るくなって、箱と数字が跳ねて喜ぶ。足りなかった：くすんで、箱がうなだれる
    ctx.onResult(win => {
      if (win) {
        ctx.background('#ffe7a3');
        ctx.happy([this.cube, this.label]);
        this.omega += 12;                       // 喜びの高速回転
      } else {
        ctx.background('#a8a196');
        this.label.color = '#555555';
        ctx.sad([this.cube, this.label]);
      }
    });

    ctx.input.on('move', e => {
      if (ctx.result) return;
      this.omega += e.dx * 0.03;
    });
  },

  update(dt, ctx) {
    this.omega *= Math.exp(-1.5 * dt);          // 摩擦
    this.mesh.rotation.y += this.omega * dt;
    if (ctx.result) return;

    const before = Math.floor(this.turns);
    this.turns += Math.abs(this.omega * dt) / (Math.PI * 2);
    const now = Math.min(this.goal, Math.floor(this.turns));
    if (now > before) {
      this.label.text = `${now} / ${this.goal}`;
      ctx.sound.play('spin');
    }
    if (this.turns >= this.goal) {
      ctx.sound.play('clear');
      this.label.color = '#e4572e';
      ctx.win();
    }
  },
};
