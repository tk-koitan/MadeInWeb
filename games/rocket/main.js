// ロケット発射：画面のどこでも連打してエネルギーを溜める。満タンで発射
export default {
  init(ctx) {
    ctx.background('#1b2a4a');
    for (let i = 0; i < 40; i++) {
      ctx.circle({ x: ctx.random(0, 540), y: ctx.random(0, 720), r: ctx.random(1.5, 3.5), color: '#ffffff', alpha: ctx.random(0.3, 1) });
    }
    ctx.rect({ x: 270, y: 900, w: 540, h: 160, color: '#3b4a63' });                 // 地面
    ctx.rect({ x: 250, y: 818, w: 240, h: 26, radius: 10, color: '#6b7a93' });      // 発射台
    ctx.text('画面のどこでも連打！', { x: 270, y: 905, size: 30, color: '#c8d3e6' });

    this.flame = ctx.circle({ x: 250, y: 830, r: 46, color: '#ffb347', visible: false });
    this.flameCore = ctx.circle({ x: 250, y: 820, r: 26, color: '#fff2b0', visible: false });
    this.flame.visible = false; this.flameCore.visible = false;
    this.rocket = ctx.sprite('assets/rocket.png', { x: 250, y: 640, h: 340 });
    this.baseX = 250;

    // エネルギーのメーター。1回タップするごとに1目盛り光る
    // テンポが上がると実時間が短くなるので、必要な回数を少し減らす
    this.need = Math.max(8, Math.round([14, 18, 22][ctx.difficulty - 1] / Math.sqrt(ctx.speed)));
    ctx.rect({ x: 470, y: 470, w: 56, h: 540, radius: 28, color: '#0d1626' });
    const segH = 500 / this.need;
    this.segs = [];
    for (let i = 0; i < this.need; i++) {
      const k = i / Math.max(1, this.need - 1);
      const color = k < 0.5 ? '#29bf12' : k < 0.8 ? '#f3a712' : '#e4572e';
      this.segs.push(ctx.rect({ x: 470, y: 720 - segH * (i + 0.5), w: 36, h: Math.max(4, segH - 5), radius: 4, color, alpha: 0.15 }));
    }
    this.power = 0;

    // 発射できた：空が明るくなって、花火が上がる。できなかった：プスンと煙を出して、ロケットがうなだれる
    ctx.onResult(win => {
      if (win) {
        ctx.background('#3a64b8');
        for (let k = 0; k < 4; k++) ctx.after(0.25 + k * 0.35, () => this.firework(ctx, ctx.random(90, 450), ctx.random(140, 420)));
      } else {
        ctx.background('#0b111d');
        for (const seg of this.segs) seg.alpha = Math.min(seg.alpha, 0.3);
        ctx.sad(this.rocket, { amp: 30 });
        for (let k = 0; k < 6; k++) ctx.after(k * 0.12, () => this.puff(ctx, 0.8));
        const t = ctx.text('プスン…', { x: 360, y: 520, size: 44, weight: 900, color: '#9aa6bd', z: 8, alpha: 0 });
        ctx.tween(t, { alpha: 1, y: 480 }, { duration: 0.4 });
      }
    });

    ctx.input.on('down', () => {
      if (ctx.result) return;
      this.power++;
      ctx.sound.play('pump');
      const seg = this.segs[this.power - 1];
      if (seg) { seg.alpha = 1; seg.scale = 1.3; ctx.tween(seg, { scale: 1 }, { duration: 0.12 }); }
      this.rocket.x = this.baseX + ctx.random(-10, 10);                                 // ぶるっと震える
      this.puff(ctx, 0.5);
      if (this.power >= this.need) {
        ctx.sound.play('launch');
        this.launching = true;
        this.vy = 0;
        this.flame.visible = this.flameCore.visible = true;
        ctx.win();
      }
    });
  },

  /** 花火（光の粒が丸く広がる） */
  firework(ctx, x, y) {
    const color = ctx.pick(['#ffd166', '#ef476f', '#06d6a0', '#8ecae6', '#ffffff']);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = ctx.circle({ x, y, r: 7, color, z: 4 });
      ctx.tween(p, { x: x + Math.cos(a) * 120, y: y + Math.sin(a) * 120 + 30, alpha: 0, scale: 0.4 }, { duration: 0.8, ease: 'out' })
        .then(() => p.remove());
    }
    ctx.sound.play('pop');
  },

  /** 発射台の煙 */
  puff(ctx, strength) {
    const x = this.rocket.x + ctx.random(-60, 60);
    const p = ctx.circle({ x, y: 830, r: ctx.random(18, 30), color: '#e8edf5', alpha: 0.85 });
    ctx.tween(p, { x: x + ctx.random(-80, 80), y: 830 - ctx.random(20, 80) * strength, scale: 2, alpha: 0 }, { duration: 0.6 })
      .then(() => p.remove());
  },

  update(dt, ctx) {
    if (this.launching) {
      this.vy -= 2600 * dt;
      this.rocket.y += this.vy * dt;
      this.rocket.x = this.baseX + ctx.random(-3, 3);
      const bottom = this.rocket.y + 170;
      this.flame.x = this.flameCore.x = this.rocket.x;
      this.flame.y = bottom + 30; this.flameCore.y = bottom + 15;
      this.flame.scale = ctx.random(0.85, 1.25);
      if (ctx.random() < 0.6) this.puff(ctx, 1.5);
      return;
    }
    this.rocket.x += (this.baseX - this.rocket.x) * Math.min(1, dt * 20);
  },
};
