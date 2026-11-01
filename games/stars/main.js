// 星座なぞり：夜空の星を番号順に、指を離さず一筆でなぞってつなぐ。途中で離したらやり直し
// ブルーム（ポストエフェクト）のサンプル。光らせたいもの（星・線・指の軌跡）は 3D の層に置き、
// 色の明るさを 1 より大きくしてブルームで光らせる。番号などの文字は 2D の層なので光らない。
const HIT = 55;   // 星に触れたとみなす距離（px）

export default {
  init(ctx) {
    const { THREE } = ctx;
    this.THREE = THREE;
    this.scene = ctx.scene;
    const d = ctx.difficulty;
    ctx.background('#060a1c');
    this.bloom = ctx.bloom({ strength: 1.1, radius: 0.55, threshold: 0.9 });

    // 光る素材（色の値を 1 より大きくすると、ブルームで光る）
    this.glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true });

    // 背景の小さな星（暗いので光らない）
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(ctx.random(1.2, 2.6), 8), this.glow(0.5, 0.55, 0.75));
      ctx.add3D(m, { x: ctx.random(0, 540), y: ctx.random(0, 860) });
    }

    // なぞる星（互いに離れた位置に置く）
    const n = [4, 5, 6][d - 1];
    this.stars = [];
    for (let i = 0; i < n; i++) {
      let x, y;
      for (let t = 0; t < 60; t++) {
        x = ctx.random(80, 460); y = ctx.random(170, 760);
        if (this.stars.every(s => Math.hypot(s.x - x, s.y - y) > 150)) break;
      }
      const halo = ctx.add3D(new THREE.Mesh(new THREE.CircleGeometry(30, 32), this.glow(0.25, 0.3, 0.6)), { x, y });
      const core = ctx.add3D(new THREE.Mesh(new THREE.CircleGeometry(13, 24), this.glow(1.6, 1.5, 1.0)), { x, y });
      const label = ctx.text(String(i + 1), { x: x + 34, y: y - 34, size: 30, color: '#9fb4ff' });
      this.stars.push({ x, y, halo, core, label });
    }
    ctx.text('番号順に、指を離さずなぞる', { x: 270, y: 905, size: 28, color: '#7f8fc0' });

    this.lines = [];
    this.next = 0;          // 次につなぐ星の番号（0 始まり）
    this.tracing = false;
    this.preview = this.bar(0, 0, 0, 0, this.glow(0.6, 1.6, 2.2));   // 最後の星から指までの線
    this.preview.visible = false;
    this.mark(0);

    ctx.input.on('down', e => {
      if (ctx.result) return;
      this.tracing = true;
      this.trail(ctx, e.x, e.y);
      this.touch(ctx, e.x, e.y);
    });
    ctx.input.on('move', e => {
      if (ctx.result || !this.tracing) return;
      this.trail(ctx, e.x, e.y);
      this.touch(ctx, e.x, e.y);
      if (this.next > 0) {
        const last = this.stars[this.next - 1];
        this.setBar(this.preview, last.x, last.y, e.x, e.y);
        this.preview.visible = true;
      }
    });
    ctx.input.on('up', () => {
      if (ctx.result) return;
      this.tracing = false;
      this.preview.visible = false;
      if (this.next > 0) this.reset(ctx);   // 途中で離したらやり直し
    });
  },

  /** 星に触れたかを調べ、次の星ならつなぐ */
  touch(ctx, x, y) {
    const s = this.stars[this.next];
    if (!s || Math.hypot(s.x - x, s.y - y) > HIT) return;
    if (this.next > 0) {
      const prev = this.stars[this.next - 1];
      this.lines.push(this.bar(prev.x, prev.y, s.x, s.y, this.glow(0.5, 1.5, 2.0)));
    }
    s.core.scale = 1.8;
    ctx.tween(s.core, { scale: 1.2 }, { duration: 0.2 });
    s.halo.color = '#88aaff';
    ctx.sound.play('chime');
    this.next++;
    if (this.next >= this.stars.length) { this.complete(ctx); return; }
    this.mark(this.next);
  },

  /** 次になぞる星を目立たせる */
  mark(i) {
    this.stars.forEach((s, k) => { s.label.color = k === i ? '#ffffff' : k < i ? '#5c6a99' : '#9fb4ff'; });
  },

  reset(ctx) {
    ctx.sound.play('fizzle');
    for (const l of this.lines) { ctx.scene.remove(l); l.geometry.dispose(); l.material.dispose(); }
    this.lines = [];
    for (const s of this.stars) { s.core.scale = 1; s.halo.color = '#404d99'; }
    this.next = 0;
    this.mark(0);
  },

  complete(ctx) {
    this.preview.visible = false;
    this.tracing = false;
    ctx.sound.play('shine');
    // 最後の星から最初の星へも線を引いて星座を閉じ、全体をまぶしく光らせる
    const a = this.stars[this.stars.length - 1], b = this.stars[0];
    this.lines.push(this.bar(a.x, a.y, b.x, b.y, this.glow(0.5, 1.5, 2.0)));
    ctx.tween(this.bloom, { strength: 1.8, radius: 0.6 }, { duration: 0.35, ease: 'out' });
    for (const s of this.stars) ctx.tween(s.core, { scale: 1.5 }, { duration: 0.3, ease: 'back' });
    ctx.win();
  },

  /** 2点を結ぶ光る線（3D の層に置く細長い板） */
  bar(x1, y1, x2, y2, material) {
    const mesh = new this.THREE.Mesh(new this.THREE.PlaneGeometry(1, 7), material);
    this.scene.add(mesh);
    this.setBar(mesh, x1, y1, x2, y2);
    return mesh;
  },
  setBar(mesh, x1, y1, x2, y2) {
    // three の座標では y が逆向きなので、画面の (x, y) は (x, -y)
    mesh.position.set((x1 + x2) / 2, -(y1 + y2) / 2, 1);
    mesh.rotation.z = Math.atan2(-(y2 - y1), x2 - x1);
    mesh.scale.x = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  },

  /** 指の軌跡（すぐ消える光の粒） */
  trail(ctx, x, y) {
    const dot = ctx.add3D(new this.THREE.Mesh(new this.THREE.CircleGeometry(9, 16), this.glow(0.8, 1.8, 2.4)), { x, y });
    ctx.tween(dot, { scale: 0.2, alpha: 0 }, { duration: 0.35 }).then(() => dot.remove());
  },

  update(dt, ctx) {
    // まだつないでいない星は、拍に合わせてゆっくり明滅する
    const pulse = 1 + 0.15 * Math.sin(ctx.beat * Math.PI * 2);
    this.stars.forEach((s, k) => { if (k >= this.next) s.core.scale = pulse; });
  },
};
