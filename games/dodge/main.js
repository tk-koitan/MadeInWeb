// 落石よけ：自機を左右にドラッグして、落ちてくる岩をよける。時間切れまで生き残れば勝ち
export default {
  init(ctx) {
    ctx.background('#20232a');
    ctx.rect({ x: 270, y: 905, w: 540, h: 110, color: '#3a3f4b' });           // 地面
    ctx.text('ドラッグでよける', { x: 270, y: 905, size: 26, color: '#8a93a6' });

    this.player = ctx.circle({ x: 270, y: 800, r: 38, color: '#61dafb' });
    this.player.draggable = 'x';                                              // 横だけ動かせる
    this.rocks = [];
    this.interval = [0.5, 0.36, 0.26][ctx.difficulty - 1];
    this.cooldown = 0.2;
  },

  update(dt, ctx) {
    const p = this.player;
    p.x = Math.max(40, Math.min(500, p.x));

    if (ctx.result) return;                                                   // 勝敗が決まったら止める

    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown = this.interval;
      const size = ctx.random(50, 90);
      const rock = ctx.rect({ x: ctx.random(40, 500), y: -60, w: size, h: size, radius: 12, color: '#e4572e' });
      rock.vy = ctx.random(450, 600) + ctx.difficulty * 60;
      rock.vr = ctx.random(-4, 4);
      this.rocks.push(rock);
    }

    for (const rock of this.rocks) {
      if (rock.y > 1100) rock.remove();
      if (ctx.overlap(p, rock)) {
        ctx.sound.play('hit');
        p.color = '#e4572e';
        ctx.tween(p, { scale: 1.5, alpha: 0.3 }, { duration: 0.3 });
        ctx.lose();
        break;
      }
    }
    this.rocks = this.rocks.filter(r => !r.removed);
  },
};
