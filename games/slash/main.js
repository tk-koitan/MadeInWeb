// スイカ斬り：投げ上げたスイカが「斬るライン」を通る瞬間にタップ。チャンスは1回だけ
export default {
  init(ctx) {
    const d = ctx.difficulty;
    ctx.background('#f6e7c1');
    for (let i = 0; i < 6; i++) ctx.rect({ x: 270, y: 80 + i * 170, w: 540, h: 4, color: '#e3cf9c' });   // 畳の目

    // 斬るライン（この帯の中にスイカの中心があるときにタップすれば成功）
    this.zoneY = 430;
    this.zoneH = [150, 115, 85][d - 1];
    ctx.rect({ x: 270, y: this.zoneY, w: 540, h: this.zoneH, color: '#e4572e', alpha: 0.13 });
    ctx.rect({ x: 270, y: this.zoneY - this.zoneH / 2, w: 540, h: 4, color: '#e4572e', alpha: 0.7 });
    ctx.rect({ x: 270, y: this.zoneY + this.zoneH / 2, w: 540, h: 4, color: '#e4572e', alpha: 0.7 });
    ctx.text('斬', { x: 48, y: this.zoneY, size: 52, color: '#e4572e' });
    ctx.text('ラインを通る瞬間にタップ', { x: 270, y: 905, size: 28, color: '#a07c3b' });

    // スイカ。1拍目で下から投げ上げる（頂点は y=200 あたり）
    this.g = [1700, 2100, 2500][d - 1];
    this.melon = ctx.sprite('assets/watermelon.png', { x: 270, y: 1060, w: 150, r: 70 });
    ctx.onBeat(b => {
      if (b !== 1 || this.tossed) return;
      this.tossed = true;
      ctx.sound.play('whoosh');
      this.melon.vy = -Math.sqrt(2 * this.g * (1060 - 200));
      this.melon.vx = ctx.random(-50, 50);
      this.melon.vr = ctx.random(-3, 3);
    });

    // 斬れた：部屋がぱっと明るくなり、「スパッ！」が跳ねる。外した：薄暗くなり、「スカッ…」がうなだれる
    ctx.onResult(win => {
      if (win) {
        ctx.background('#ffe08a');
        if (this.splashText) ctx.happy(this.splashText);
      } else {
        ctx.background('#8f8672');
        const t = ctx.text('スカッ…', { x: 270, y: 300, size: 64, weight: 900, color: '#6b6b6b', stroke: '#ffffff', strokeWidth: 6, z: 6 });
        ctx.sad(t, { amp: 40 });
      }
    });

    ctx.input.on('down', () => {
      if (ctx.result || this.used || !this.tossed) return;
      this.used = true;
      ctx.sound.play('slash');
      const hit = Math.abs(this.melon.y - this.zoneY) <= this.zoneH / 2;
      this.slashLine(ctx, hit ? this.melon.y : this.zoneY, hit);
      if (hit) {
        ctx.sound.play('splat');
        this.splash(ctx);
        this.melon.remove();
        ctx.win();
      } else {
        ctx.lose();
      }
    });
  },

  /** 斬撃の光 */
  slashLine(ctx, y, hit) {
    const line = ctx.rect({ x: 270, y, w: 700, h: 12, rotation: -0.18, color: hit ? '#ffffff' : '#7a7a7a', z: 10 });
    ctx.tween(line, { alpha: 0, scale: 1.1 }, { duration: 0.3 }).then(() => line.remove());
  },

  /** スイカが割れて果汁が飛び散る */
  splash(ctx) {
    const { x, y } = this.melon;
    const colors = ['#e8384f', '#e8384f', '#ff6b81', '#2f9e44', '#1b1b1b'];
    for (let i = 0; i < 18; i++) {
      const a = ctx.random(0, Math.PI * 2), dist = ctx.random(80, 220);
      const p = ctx.circle({ x, y, r: ctx.random(8, 20), color: colors[i % colors.length], z: 5 });
      ctx.tween(p, { x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist + 60, alpha: 0, scale: 0.4 }, { duration: 0.5 })
        .then(() => p.remove());
    }
    this.splashText = ctx.text('スパッ！', { x, y: y - 120, size: 64, color: '#e4572e', stroke: '#ffffff', strokeWidth: 6, z: 6 });
  },

  update(dt) {
    if (this.tossed && !this.melon.removed) this.melon.vy += this.g * dt;   // 重力
  },
};
