// 風船わり：浮かんでいく風船をタップして全部割る
const COLORS = ['#e4572e', '#f3a712', '#29bf12', '#4f6bed', '#d65db1'];

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
    ctx.circle({ x: 90, y: 160, r: 70, color: '#ffffff' });   // 雲
    ctx.circle({ x: 160, y: 150, r: 55, color: '#ffffff' });

    const count = 2 + ctx.difficulty;       // 3〜5個
    let left = count;
    for (let i = 0; i < count; i++) {
      const x = 80 + (380 / Math.max(1, count - 1)) * i + ctx.random(-20, 20);
      const y = ctx.random(520, 860);
      const color = ctx.pick(COLORS);
      const rise = -ctx.random(30, 60) * ctx.difficulty;

      const string = ctx.rect({ x, y: y + 105, w: 3, h: 90, color: '#777777' });
      const balloon = ctx.circle({ x, y, r: 62, color });
      const shine = ctx.circle({ x: x - 22, y: y - 24, r: 12, color: '#ffffff', alpha: 0.7 });
      for (const n of [string, balloon, shine]) n.vy = rise;

      balloon.onTap(() => {
        ctx.sound.play('pop');
        burst(ctx, balloon.x, balloon.y, color);
        balloon.remove(); shine.remove(); string.remove();
        left--;
        if (left === 0) ctx.win();
      });
    }
  },
};
