// 穴に入れろ：ボールをドラッグして穴の上で離す。難易度が上がると穴が小さくなり、動く
export default {
  init(ctx) {
    ctx.background('#2d6a4f');
    this.lawn = ctx.rect({ x: 270, y: 480, w: 500, h: 920, radius: 30, color: '#40916c' });   // 芝生

    this.goalR = [85, 68, 55][ctx.difficulty - 1];
    this.rim = ctx.circle({ x: ctx.random(130, 410), y: 260, r: this.goalR + 10, color: '#1b4332' });
    this.hole = ctx.circle({ x: this.rim.x, y: this.rim.y, r: this.goalR, color: '#081c15' });
    // 旗の画像は左端にポールがあるので、少し右にずらしてポールを穴の中心に立てる
    this.flag = ctx.sprite('assets/flag.png', { x: this.hole.x + 20, y: this.hole.y - 60, h: 130 });
    this.speed = [0, 130, 220][ctx.difficulty - 1] * ctx.pick([-1, 1]);

    ctx.text('↑ ドラッグ', { x: 270, y: 900, size: 28, color: '#d8f3dc' });

    const ball = ctx.sprite('assets/golfball.png', { x: 270, y: 780, w: 84, r: 42 });
    ball.draggable = true;
    this.ball = ball;
    // 入った：芝生が明るくなって、旗とボールが喜ぶ。外れた：芝生がしおれて、ボールが落ち込む
    ctx.onResult(win => {
      ball.draggable = false;
      if (win) {
        ctx.background('#b7e4c7');
        this.lawn.color = '#74c69d';
        this.speed = 0;
        ctx.happy(this.flag, { amp: 30 });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const star = ctx.text('★', { x: this.hole.x, y: this.hole.y, size: 34, color: ctx.pick(['#ffd166', '#ffffff', '#f4a261']), z: 6 });
          ctx.tween(star, { x: this.hole.x + Math.cos(a) * 170, y: this.hole.y + Math.sin(a) * 170, alpha: 0, rotation: 3 }, { duration: 0.9, ease: 'out' });
        }
      } else {
        ctx.background('#3f4a42');
        this.lawn.color = '#5f6e63';
        this.speed = 0;
        ctx.sad([ball, this.flag]);
      }
    });

    ball.onDrop(() => {
      if (ctx.result) return;
      if (ctx.distance(ball, this.hole) < this.goalR) {
        ball.draggable = false;
        this.inHole = true;
        ctx.sound.play('cup');
        ctx.tween(ball, { x: this.hole.x, y: this.hole.y, scale: 0.6 }, { duration: 0.15 });
        ctx.win();
      }
    });
  },

  update(dt, ctx) {
    if (!this.speed) return;
    let x = this.hole.x + this.speed * dt;
    if (x < 110 || x > 430) { this.speed = -this.speed; x = Math.max(110, Math.min(430, x)); }
    this.hole.x = this.rim.x = x;
    this.flag.x = x + 20;
    if (this.inHole) this.ball.x = x;
  },
};
