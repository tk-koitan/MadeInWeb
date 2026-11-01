// アヒル数え：池を泳ぐアヒルを数えて、上下ドラッグでダイヤルの数字を合わせる。最後の拍で判定（16拍）
const STEP = 45;   // この距離（px）ドラッグするごとに数字が1つ変わる

export default {
  init(ctx) {
    const d = ctx.difficulty;
    ctx.background('#d7f0d0');
    this.pond = { x0: 40, x1: 500, y0: 110, y1: 560 };
    ctx.rect({ x: 270, y: 335, w: 500, h: 490, radius: 60, color: '#6cc4e8' });
    ctx.rect({ x: 270, y: 335, w: 470, h: 460, radius: 50, color: '#8fd3ef' });

    // アヒル（数は難易度で変わる。難しいほど速く泳ぐ）
    this.answer = ctx.randInt(...[[3, 6], [5, 9], [7, 12]][d - 1]);
    this.ducks = [];
    for (let i = 0; i < this.answer; i++) {
      // 最初は重ならないように、ほかのアヒルから離れた場所を探す
      let x, y;
      for (let tries = 0; tries < 30; tries++) {
        x = ctx.random(this.pond.x0 + 50, this.pond.x1 - 50);
        y = ctx.random(this.pond.y0 + 50, this.pond.y1 - 50);
        if (this.ducks.every(o => Math.hypot(o.x - x, o.y - y) > 95)) break;
      }
      const duck = ctx.sprite('assets/duck.png', { x, y, w: 84 });
      duck.vx = ctx.random(25, 55) * d * ctx.pick([-1, 1]);
      duck.vy = ctx.random(-15, 15) * d;
      duck.flipX = duck.vx < 0;
      duck.phase = ctx.random(0, 6);
      this.ducks.push(duck);
    }

    // ダイヤル
    ctx.rect({ x: 270, y: 790, w: 230, h: 200, radius: 30, color: '#ffffff' });
    ctx.text('▲', { x: 270, y: 660, size: 44, color: '#4f6bed' });
    ctx.text('▼', { x: 270, y: 920, size: 44, color: '#4f6bed' });
    ctx.text('上下にドラッグ', { x: 100, y: 790, size: 26, color: '#3a7a3a' });
    this.value = 0;
    this.num = ctx.text('0', { x: 270, y: 790, size: 140, color: '#333333' });
    this.acc = 0;
    ctx.input.on('move', e => {
      if (ctx.result) return;
      this.acc -= e.dy;                     // 上に動かすと増える
      while (this.acc >= STEP) { this.acc -= STEP; this.set(ctx, this.value + 1); }
      while (this.acc <= -STEP) { this.acc += STEP; this.set(ctx, this.value - 1); }
    });

    // 最後の拍で判定する
    ctx.onBeat(b => {
      if (b !== ctx.beats - 1 || ctx.result) return;
      if (this.value === this.answer) {
        this.num.color = '#29bf12';
        ctx.win();
      } else {
        this.num.color = '#e4572e';
        ctx.text(`正解は ${this.answer}`, { x: 270, y: 610, size: 40, color: '#ffffff', stroke: '#e4572e', strokeWidth: 6, z: 5 });
        ctx.lose();
      }
    });
  },

  set(ctx, v) {
    v = Math.max(0, Math.min(20, v));
    if (v === this.value) return;
    this.value = v;
    this.num.text = String(v);
    this.num.scale = 1.2;
    ctx.tween(this.num, { scale: 1 }, { duration: 0.1 });
    ctx.sound.play('click');
  },

  update(dt, ctx) {
    const p = this.pond;
    for (const duck of this.ducks) {
      if (duck.x < p.x0 + 45 || duck.x > p.x1 - 45) { duck.vx = -duck.vx; duck.x = Math.max(p.x0 + 45, Math.min(p.x1 - 45, duck.x)); }
      if (duck.y < p.y0 + 45 || duck.y > p.y1 - 45) { duck.vy = -duck.vy; duck.y = Math.max(p.y0 + 45, Math.min(p.y1 - 45, duck.y)); }
      duck.flipX = duck.vx < 0;
      duck.rotation = Math.sin(ctx.time * 6 + duck.phase) * 0.08;   // ぷかぷか
    }
  },
};
