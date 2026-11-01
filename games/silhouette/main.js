// シルエット当て：上のシルエットと同じ動物を、下の候補から「長押し」で選ぶ（短いタップでは選ばれない）
const ANIMALS = ['cat', 'dog', 'rabbit', 'bear', 'pig', 'fox'];
const HOLD = 0.45;   // 長押しに必要な時間（ゲーム内の秒、約1拍）

export default {
  init(ctx) {
    const d = ctx.difficulty;
    ctx.background('#fff3d6');

    // 候補を選ぶ（重複なし）
    const pool = [...ANIMALS];
    const names = [];
    const n = [3, 4, 5][d - 1];
    while (names.length < n) names.push(pool.splice(ctx.randInt(0, pool.length - 1), 1)[0]);
    this.answer = ctx.pick(names);

    // シルエット（画像に黒を掛けると、形だけが黒く残る）
    ctx.rect({ x: 270, y: 280, w: 420, h: 330, radius: 30, color: '#ffffff' });
    ctx.text('だれかな？', { x: 270, y: 150, size: 30, color: '#a07c3b' });
    this.sil = ctx.sprite(`assets/${this.answer}.png`, { x: 270, y: 300, fit: 270, color: '#000000' });

    // 候補のカード（3つなら1列、4つ以上なら2段）
    const rows = n <= 3 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
    const size = n <= 3 ? 160 : 150;
    this.cards = [];
    let k = 0;
    rows.forEach((count, r) => {
      const y = n <= 3 ? 700 : 590 + r * 180;
      for (let i = 0; i < count; i++, k++) {
        const x = 270 + (i - (count - 1) / 2) * (size + 20);
        const ring = ctx.circle({ x, y, r: size * 0.62, color: '#f3a712', alpha: 0.7, scale: 0 });
        const card = ctx.rect({ x, y, w: size, h: size, radius: 24, color: '#ffffff' });
        const pic = ctx.sprite(`assets/${names[k]}.png`, { x, y, fit: size * 0.85 });
        this.cards.push({ name: names[k], ring, card, pic, x });
      }
    });
    ctx.text('長押しで選ぶ', { x: 270, y: 905, size: 30, color: '#a07c3b' });

    this.hold = null;
    ctx.input.on('down', e => {
      if (ctx.result) return;
      this.hold = this.cards.find(c => c.card.contains(e.x, e.y)) || null;
      this.holdT = 0;
    });
    ctx.input.on('up', () => this.release());
  },

  release() {
    if (this.hold && !this.done) this.hold.ring.scale = 0;
    this.hold = null;
  },

  select(ctx, c) {
    this.done = true;
    this.sil.color = '#ffffff';                        // シルエットの正体を見せる
    ctx.tween(this.sil, { scale: 1.12 }, { duration: 0.15, ease: 'back' });
    if (c.name === this.answer) {
      ctx.sound.play('correct');
      c.card.color = '#c8f7c5';
      ctx.win();
    } else {
      ctx.sound.play('wrong');
      c.card.color = '#ffc9c9';
      for (const n of [c.card, c.pic]) {
        ctx.tween(n, { x: c.x - 16 }, { duration: 0.05 })
          .then(() => ctx.tween(n, { x: c.x + 16 }, { duration: 0.08 }))
          .then(() => ctx.tween(n, { x: c.x }, { duration: 0.05 }));
      }
      ctx.lose();
    }
  },

  update(dt, ctx) {
    const c = this.hold;
    if (!c || this.done || ctx.result) return;
    if (!ctx.input.down || !c.card.contains(ctx.input.x, ctx.input.y)) { this.release(); return; }
    this.holdT += dt;
    c.ring.scale = Math.min(1, this.holdT / HOLD);
    if (this.holdT >= HOLD) this.select(ctx, c);
  },
};
