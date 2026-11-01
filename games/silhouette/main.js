// シルエット当て：上のシルエットと同じ動物を、下の候補からタップで選ぶ（チャンスは1回）
const ANIMALS = ['cat', 'dog', 'rabbit', 'bear', 'pig', 'fox'];

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
        const card = ctx.rect({ x, y, w: size, h: size, radius: 24, color: '#ffffff' });
        const pic = ctx.sprite(`assets/${names[k]}.png`, { x, y, fit: size * 0.85 });
        const c = { name: names[k], card, pic, x };
        card.onTap(() => { if (!this.done && !ctx.result) this.select(ctx, c); });
        this.cards.push(c);
      }
    });
    ctx.text('タップで選ぶ', { x: 270, y: 905, size: 30, color: '#a07c3b' });
  },

  select(ctx, c) {
    this.done = true;
    c.card.scale = 1.1;
    c.pic.scale = 1.1;
    ctx.tween(c.card, { scale: 1 }, { duration: 0.15 });
    ctx.tween(c.pic, { scale: 1 }, { duration: 0.15 });
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
};
