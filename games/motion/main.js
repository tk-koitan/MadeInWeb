// なにしてる？：キャラクターの動き（VRM アニメーション .vrma）を見て、何をしているかを下のボタンから選ぶ。
// VRM アニメーションのサンプル。アニメーションは Quaternius の Universal Animation Library（CC0）を
// tools/glb-to-vrma.mjs で .vrma に変換し、tools/model-slim.mjs --meshopt で軽くしたもの。
const QUIZ = [
  { file: 'punch', label: 'パンチ' },
  { file: 'sword', label: 'けん' },
  { file: 'spell', label: 'まほう' },
  { file: 'pistol', label: 'てっぽう' },
];

export default {
  async init(ctx) {
    const { THREE } = ctx;
    ctx.background('#e6f3ff');
    ctx.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 2, 3);
    ctx.scene.add(sun);
    const floor = this.floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshStandardMaterial({ color: 0xa9cff5 }));
    floor.rotation.x = -Math.PI / 2;
    ctx.scene.add(floor);
    ctx.camera3D.position.set(0, 1.05, 3.1);
    ctx.camera3D.lookAt(0, 0.62, 0);

    // モデルとアニメーションを読み込む（全部そろってからゲームが始まる）
    const files = ['idle', 'dance', 'hit', ...QUIZ.map(q => q.file)];
    const [vrm, ...anims] = await Promise.all([
      ctx.loadVRM('assets/avatar.vrm'),
      ...files.map(f => ctx.loadVRMAnimation(`assets/${f}.vrma`)),
    ]);
    this.vrm = vrm;
    this.anims = Object.fromEntries(files.map((f, i) => [f, anims[i]]));
    ctx.scene.add(vrm.scene);
    await this.play(ctx, 'idle');

    // 出題：4つの動きから1つ。選択肢は難易度で 2〜4 個
    const n = [2, 3, 4][ctx.difficulty - 1];
    this.answer = ctx.pick(QUIZ);
    const others = QUIZ.filter(q => q !== this.answer);
    const choices = [this.answer];
    while (choices.length < n) choices.push(others.splice(ctx.randInt(0, others.length - 1), 1)[0]);
    for (let i = choices.length - 1; i > 0; i--) { const j = ctx.randInt(0, i); [choices[i], choices[j]] = [choices[j], choices[i]]; }

    this.title = ctx.text('なにしてる？', { x: 270, y: 110, size: 44, weight: 900, color: '#2d5f8f' });
    const w = n <= 2 ? 220 : n === 3 ? 160 : 118, gap = 12;
    this.buttons = choices.map((q, i) => {
      const x = 270 + (i - (n - 1) / 2) * (w + gap);
      const card = ctx.rect({ x, y: 830, w, h: 92, radius: 22, color: '#ffffff' });
      const label = ctx.text(q.label, { x, y: 830, size: n === 4 ? 30 : 36, weight: 900, color: '#2d5f8f' });
      card.onTap(() => this.choose(ctx, q, card));
      return { q, card, label };
    });
    ctx.text('Quaternius (CC0) / model: koitan', { x: 270, y: 925, size: 14, color: '#7ea3c7', weight: 'normal' });
    this.started = false;

    // 正解：ダンスして、ボタンが跳ねる。不正解・時間切れ：頭を打ってよろけ、しょんぼりする
    ctx.onResult(win => {
      this.expression(win ? 'happy' : 'sad', 1);
      if (win) {
        ctx.background('#fff3a0');
        this.floor.material.color.set(0xffd34d);
        this.title.text = `${this.answer.label}！`;
        ctx.happy(this.title);
        this.play(ctx, 'dance');
      } else {
        ctx.background('#9aa3ad');
        this.floor.material.color.set(0x7d8691);
        this.title.text = `せいかいは ${this.answer.label}`;
        ctx.sad(this.title, { amp: 20 });
        this.play(ctx, 'hit', false);
      }
    });
  },

  choose(ctx, q, card) {
    if (ctx.result || !this.started) return;
    card.scale = 1.08;
    if (q === this.answer) { card.color = '#bff0b0'; ctx.sound.play('coin'); ctx.win(); }
    else { card.color = '#f5c0c0'; ctx.sound.play('wrong'); ctx.lose(); }
  },

  /** アニメーションを切り替える（前のものは止める） */
  async play(ctx, name, loop = true) {
    if (this.action) this.action.stop();
    this.action = await ctx.playVRMAnimation(this.vrm, this.anims[name], { loop });
  },

  expression(name, value) {
    if (this.vrm && this.vrm.expressionManager) this.vrm.expressionManager.setValue(name, value);
  },

  update(dt, ctx) {
    if (!this.vrm) return;
    // 2拍目から動き始める（くり返す）
    if (!this.started && ctx.beat >= 2 && !ctx.result) {
      this.started = true;
      this.play(ctx, this.answer.file);
      ctx.sound.play('pop');
    }
    const blink = (ctx.time % 2.7) < 0.12 ? 1 : 0;
    this.expression('blink', ctx.result === 'lose' ? 0 : blink);
  },
};
