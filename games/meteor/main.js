// 隕石を撃て（3D）：宇宙の奥から迫ってくる隕石を、手前に来る前にタップして壊す
// game.json の "camera": "perspective" で、奥のものほど小さく見える遠近感のあるカメラになる。
// three の座標では、画面の (x, y) は (x, -y) に対応し、z がプラスほど手前（カメラは z ≒ 1030）。
const FAR_Z = -5000;   // 隕石が現れる奥行き
const HIT_Z = 650;     // ここまで来たら地球に当たる（失敗）

export default {
  init(ctx) {
    const { THREE } = ctx;
    const d = ctx.difficulty;
    ctx.background('#05060f');
    ctx.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(600, 400, 800);
    ctx.scene.add(sun);

    // 星空：奥から手前へ流れてくる点の集まり
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = 270 + ctx.random(-1600, 1600);
      pos[i * 3 + 1] = -480 + ctx.random(-2200, 2200);
      pos[i * 3 + 2] = ctx.random(-6000, 900);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 4 }));
    ctx.scene.add(this.stars);

    // 隕石の出現予定。全部で count 個、ゲームの前半に順に現れる
    this.count = [3, 4, 6][d - 1];
    this.travel = [1.6, 1.35, 1.15][d - 1];          // 奥から手前まで来るのにかかる時間（秒）
    this.meteors = [];
    this.spawnAt = Array.from({ length: this.count }, (_, i) => (i / this.count) * 2.0);
    this.spawned = 0;
    this.destroyed = 0;

    ctx.text('迫る隕石をタップ！', { x: 270, y: 905, size: 28, color: '#8fa3c8' });

    ctx.input.on('down', e => {
      if (ctx.result) return;
      ctx.sound.play('zap');
      this.marker(ctx, e.x, e.y);
      const m = this.findMeteor(ctx, e.x, e.y);
      if (m) this.explode(ctx, m);
    });
  },

  /** タップした位置の隕石を探す。ぴったり当たらなくても、見た目の大きさ＋少しの余裕で判定する */
  findMeteor(ctx, x, y) {
    const picked = ctx.pick3D(x, y);
    const exact = this.meteors.find(m => m.alive && (picked === m.mesh || (picked && picked.parent === m.mesh)));
    if (exact) return exact;
    let best = null, bestD = Infinity;
    for (const m of this.meteors) {
      if (!m.alive) continue;
      const p = ctx.toScreen(m.mesh);
      const scale = 1030 / Math.max(50, 1030 - m.mesh.position.z);   // 遠近感による大きさの倍率
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < m.radius * scale + 45 && dist < bestD) { best = m; bestD = dist; }
    }
    return best;
  },

  spawn(ctx) {
    const { THREE } = ctx;
    const radius = ctx.random(60, 85);
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius, 1),
      new THREE.MeshStandardMaterial({ color: ctx.pick([0x9c6b4a, 0x8a5a3c, 0xb07a52]), roughness: 0.9, flatShading: true }),
    );
    mesh.position.set(ctx.random(110, 430), -ctx.random(220, 760), FAR_Z);
    ctx.scene.add(mesh);
    this.meteors.push({
      mesh, radius, alive: true,
      spin: new THREE.Vector3(ctx.random(-3, 3), ctx.random(-3, 3), ctx.random(-3, 3)),
      vz: (HIT_Z - FAR_Z) / this.travel,
    });
  },

  explode(ctx, m) {
    const { THREE } = ctx;
    m.alive = false;
    ctx.sound.play('boom');
    const at = m.mesh.position.clone();
    ctx.scene.remove(m.mesh);
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
    // 破片
    for (let i = 0; i < 12; i++) {
      const piece = new THREE.Mesh(
        new THREE.TetrahedronGeometry(m.radius * 0.25),
        new THREE.MeshStandardMaterial({ color: i % 3 ? 0x9c6b4a : 0xffa040, flatShading: true }),
      );
      piece.position.copy(at);
      piece.userData.v = new THREE.Vector3(ctx.random(-1, 1), ctx.random(-1, 1), ctx.random(-0.5, 1)).normalize().multiplyScalar(ctx.random(300, 700));
      piece.userData.life = 0.6;
      ctx.scene.add(piece);
      (this.pieces ||= []).push(piece);
    }
    this.destroyed++;
    if (this.destroyed >= this.count) ctx.win();
  },

  /** タップした場所に照準の輪を出す（2D の層） */
  marker(ctx, x, y) {
    const ring = ctx.circle({ x, y, r: 36, color: '#7df9ff', alpha: 0.6, z: 5 });
    ctx.tween(ring, { scale: 1.8, alpha: 0 }, { duration: 0.25 }).then(() => ring.remove());
  },

  update(dt, ctx) {
    // 星を手前へ流す
    const p = this.stars.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let z = p.getZ(i) + 2400 * dt;
      if (z > 900) z -= 6900;
      p.setZ(i, z);
    }
    p.needsUpdate = true;

    // 予定の時刻になったら隕石を出す
    while (this.spawned < this.count && ctx.time >= this.spawnAt[this.spawned]) { this.spawn(ctx); this.spawned++; }

    for (const m of this.meteors) {
      if (!m.alive) continue;
      m.mesh.position.z += m.vz * dt;
      m.mesh.rotation.x += m.spin.x * dt;
      m.mesh.rotation.y += m.spin.y * dt;
      m.mesh.rotation.z += m.spin.z * dt;
      if (m.mesh.position.z >= HIT_Z && !ctx.result) {
        // 手前まで来てしまった
        const flash = ctx.rect({ x: 270, y: 480, w: 540, h: 960, color: '#ff3b30', alpha: 0.5, z: 10 });
        ctx.tween(flash, { alpha: 0 }, { duration: 0.4 }).then(() => flash.remove());
        ctx.lose();
      }
    }

    for (const piece of this.pieces || []) {
      if (!piece.parent) continue;
      piece.position.addScaledVector(piece.userData.v, dt);
      piece.rotation.x += 6 * dt; piece.rotation.y += 5 * dt;
      piece.userData.life -= dt;
      piece.scale.setScalar(Math.max(0.01, piece.userData.life / 0.6));
      if (piece.userData.life <= 0) {
        ctx.scene.remove(piece);
        piece.geometry.dispose();
        piece.material.dispose();
      }
    }
  },
};
