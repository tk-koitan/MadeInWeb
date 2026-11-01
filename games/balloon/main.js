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
    for (let i = 0; i < count; i++) {
      const x = 80 + (380 / Math.max(1, count - 1)) * i + ctx.random(-20, 20);
      const y = ctx.random(560, 820);
      const color = ctx.pick(COLORS);

      const balloon = ctx.sprite('assets/balloon.png', { x, y, w: 120, color });
      balloon.vy = -ctx.random(30, 60) * ctx.difficulty;
      balloon.onTap(() => {
        ctx.sound.play('pop');
        burst(ctx, balloon.x, balloon.y - 30, color);
        balloon.remove();
        left--;
        if (left === 0) ctx.win();
      });
    }
  },
};
