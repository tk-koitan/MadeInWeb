// つみあげ（物理エンジンのサンプル）：上で左右に動くブロックを、タップで落として台に積む。
// 物理は ctx.physics.add(物体, オプション) を付けるだけ。あとは x / y / rotation が自動で動く。
const COLORS = ['#e4572e', '#f3a712', '#29bf12', '#3d5a80', '#a44a3f', '#7b2cbf'];
const HANG_Y = 190;        // ブロックがぶら下がる高さ
const TABLE_Y = 800;       // 台の上面

export default {
  init(ctx) {
    ctx.background('#e8f4ff');
    this.need = [3, 4, 5][ctx.difficulty - 1];          // 積む数
    this.bw = [150, 130, 115][ctx.difficulty - 1];      // ブロックの幅
    this.swing = [1.6, 2.1, 2.6][ctx.difficulty - 1];   // 揺れる速さ
    this.dropped = [];
    this.calm = 0;

    // 台（動かない）と、クレーンのロープ
    const table = ctx.rect({ x: 270, y: TABLE_Y + 40, w: 210, h: 80, radius: 10, color: '#6b7a8f' });
    ctx.rect({ x: 270, y: TABLE_Y + 300, w: 90, h: 440, color: '#55627a' });
    ctx.physics.add(table, { static: true, friction: 0.8 });
    this.rope = ctx.rect({ x: 270, y: 70, w: 6, h: 240, color: '#555', z: -1 });
    ctx.rect({ x: 270, y: 0, w: 540, h: 24, color: '#333' });

    // 積めた：物理を外して、タワーが拍に合わせて踊る。崩れた：ブロックが灰色になり、「くずれた…」がうなだれる
    ctx.onResult(win => {
      if (this.hanging) { this.hanging.remove(); this.hanging = null; }
      if (win) {
        ctx.background('#fff1b8');
        for (const b of this.dropped) ctx.physics.remove(b);
        ctx.happy(this.dropped, { amp: 12 });
      } else {
        ctx.background('#6f7887');
        for (const b of this.dropped) b.color = '#8a8f99';
        ctx.sad(ctx.text('くずれた…', { x: 270, y: 330, size: 56, weight: 900, color: '#ffffff', stroke: '#6f7887', strokeWidth: 8, z: 5 }), { amp: 40 });
      }
      this.label.visible = false;
    });

    this.label = ctx.text(`あと ${this.need}`, { x: 270, y: 330, size: 40, weight: 900, color: '#3d5a80' });
    this.next(ctx);

    ctx.input.on('down', () => this.drop(ctx));
  },

  /** 次のブロックをクレーンに吊るす */
  next(ctx) {
    const i = this.dropped.length;
    this.hanging = ctx.rect({ x: 270, y: HANG_Y, w: this.bw, h: 64, radius: 8, color: COLORS[i % COLORS.length] });
    this.t0 = ctx.time;
  },

  drop(ctx) {
    const b = this.hanging;
    if (!b || ctx.result) return;
    this.hanging = null;
    // 物理を付ける。揺れていた勢い（vx）もそのまま引き継がれる
    b.vx = Math.cos((ctx.time - this.t0) * this.swing * 2) * 170 * this.swing * 2 * 0.25;
    ctx.physics.add(b, { friction: 0.8, bounce: 0.05 });
    ctx.physics.onHit(b, ({ speed }) => { if (speed > 250) ctx.sound.play('hit'); });
    ctx.sound.play('whoosh');
    this.dropped.push(b);
    const left = this.need - this.dropped.length;
    this.label.text = left > 0 ? `あと ${left}` : '';
    if (left > 0) ctx.after(0.45, () => { if (!ctx.result) this.next(ctx); });
  },

  update(dt, ctx) {
    if (ctx.result) return;
    // 吊るしたブロックは左右に揺れる
    if (this.hanging) {
      this.hanging.x = 270 + Math.sin((ctx.time - this.t0) * this.swing * 2) * 170;
      this.rope.x = this.hanging.x;
      this.rope.y = (HANG_Y - 32) / 2;
    }
    // 台から落ちたら失敗
    if (this.dropped.some(b => b.y > TABLE_Y + 60)) { ctx.sound.play('spin'); ctx.lose(); return; }
    // 全部落として、止まったら成功
    if (this.dropped.length === this.need) {
      const still = this.dropped.every(b => Math.hypot(b.vx, b.vy) < 25 && Math.abs(b.vr) < 0.3);
      this.calm = still ? this.calm + dt : 0;
      if (this.calm > 0.35) { ctx.sound.play('coin'); ctx.win(); }
    }
  },
};
