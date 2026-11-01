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

    // 面ごとに色を変えた立方体
    const colors = [0xe4572e, 0xf3a712, 0x29bf12, 0x4f6bed, 0xd65db1, 0x2ec4b6];
    const mats = colors.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(220, 220, 220), mats);
    mesh.rotation.x = 0.45;
    mesh.rotation.y = 0.6;
    this.mesh = mesh;
    this.cube = ctx.add3D(mesh, { x: 270, y: 460, r: 160 });

    this.goal = 3 + ctx.difficulty;   // 4〜6回転（16拍 = 8秒）
    this.turns = 0;
    this.omega = 0;                   // 回転の速さ（ラジアン/秒）
    this.label = ctx.text(`0 / ${this.goal}`, { x: 270, y: 760, size: 72, color: '#333333' });
    ctx.text('← 横にスワイプ →', { x: 270, y: 880, size: 28, color: '#a07c3b' });

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
      ctx.sound.play('coin');
      this.label.color = '#e4572e';
      ctx.tween(this.cube, { scale: 1.25 }, { duration: 0.2, ease: 'back' });
      ctx.win();
    }
  },
};
