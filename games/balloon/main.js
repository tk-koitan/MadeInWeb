// 風船わり：浮かんでいく風船をタップして全部割る
// 白い風船の画像に色を掛けて、いろいろな色の風船にしている
const COLORS = ['#ff6b6b', '#ffb347', '#7bd66b', '#6b8bff', '#e07be0'];

function burst(ctx, x, y, color) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const p = ctx.circle({ x, y, r: 10, color, z: 5 });
    ctx.tween(p, { x: x + Math.cos(a) * 100, y: y + Math.sin(a) * 100, alpha: 0, scale: 0.3 }, { duration: 0.35 })
      .then(() => p.remove());
  }
}

export default {
  init(ctx) {
    ctx.background('#bfe6ff');
    const c1 = ctx.sprite('assets/cloud.png', { x: 120, y: 150, w: 220 });
    const c2 = ctx.sprite('assets/cloud.png', { x: 430, y: 270, w: 160, alpha: 0.85 });
    c1.vx = 8; c2.vx = -6;

    const count = 2 + ctx.difficulty;       // 3〜5個
    let left = count;
    const balloons = [];
    for (let i = 0; i < count; i++) {
      const x = 80 + (380 / Math.max(1, count - 1)) * i + ctx.random(-20, 20);
      const y = ctx.random(560, 820);
      const color = ctx.pick(COLORS);

      const balloon = ctx.sprite('assets/balloon.png', { x, y, w: 120, color });
      balloon.vy = -ctx.random(30, 60) * ctx.difficulty;
      balloons.push(balloon);
      balloon.onTap(() => {
        ctx.sound.play('pop');
        burst(ctx, balloon.x, balloon.y - 30, color);
        balloon.remove();
        left--;
        if (left === 0) ctx.win();
      });
    }

    // 勝ったら：空が明るくなり、お祝いの風船がたくさん上がって、雲が喜ぶ
    // 負けたら：空がくもり、残った風船はしぼんで止まり、雲も落ち込む
    ctx.onResult(win => {
      if (win) {
        ctx.background('#fff2b8');
        ctx.happy([c1, c2]);
        for (let i = 0; i < 14; i++) {
          const b = ctx.sprite('assets/balloon.png', { x: ctx.random(30, 510), y: ctx.random(980, 1250), w: ctx.random(50, 80), color: ctx.pick(COLORS), z: 3 });
          b.vy = -ctx.random(380, 560);
          b.vr = ctx.random(-0.6, 0.6);
        }
      } else {
        ctx.background('#8d9bab');
        const left = balloons.filter(b => !b.removed);
        ctx.sad([c1, c2, ...left]);
      }
    });
  },
};
