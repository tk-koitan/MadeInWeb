// 紙コップ：最初に当たりの玉が入っているコップが持ち上がって見せる → シャッフル → 当たりのコップをタップ。
// リアル調のサンプル。モデルは Blender で作ったもの（tools/blender/cups.py）、机の木目と部屋の映り込みは Poly Haven（CC0）。
// 環境マップ（ctx.environment）・トーンマッピング（ctx.toneMapping）・影（castShadow / receiveShadow）を使う。
// 単位はメートル。机の上面が y = 0。コップは x 方向に 3 つ並ぶ。
//
// 時間（拍。テンポ 120 なら 1 拍 0.5 秒）
//   0〜4   当たりを見せる（コップが持ち上がって戻る）
//   4〜12  シャッフル（どの入れ替えも拍の頭で動き始める。難易度で回数が変わる）
//   12〜16 答える
const SLOT_X = [-0.115, 0, 0.115];
const LIFT = 0.075;                       // 持ち上げる高さ
const BALL_R = 0.0165;                    // 玉の半径
const R_RIM = 0.0385;                     // コップの口の半径（tools/blender/cups.py の R_TOP）
const TILT = 0.95;                        // 持ち上げたときに手前へ倒す角度（ラジアン、約 54°）
const SHUFFLE = {                         // 1 回の入れ替えにかける拍（合計 8 拍）
  1: [2, 2, 2, 2],
  2: [2, 1, 1, 2, 1, 1],
  3: [1, 1, 1, 1, 1, 1, 1, 1],
};

export default {
  async init(ctx) {
    const { THREE } = ctx;
    ctx.environment('assets/room.webp', { intensity: 0.85, background: true, blur: 0.35 });
    ctx.toneMapping('aces', 1.05);

    // 光：窓の方向から柔らかい影を落とす
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
    sun.position.set(-0.35, 0.9, 0.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3, near: 0.1, far: 2 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.002;
    sun.shadow.radius = 4;
    ctx.scene.add(sun);

    const cam = ctx.camera3D;
    // 縦長の画面に 3 つのコップが収まるように、斜め上から見下ろす
    cam.near = 0.02; cam.far = 20; cam.fov = 44;
    cam.updateProjectionMatrix();
    cam.position.set(0, 0.46, 0.60);
    cam.lookAt(0, 0.0, -0.11);

    const model = await ctx.loadGLB('assets/cups.glb');
    const get = name => model.scene.getObjectByName(name);
    const table = get('Table'), cupSrc = get('Cup'), ball = this.ball = get('Ball');
    table.traverse(o => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      for (const k of ['map', 'normalMap', 'roughnessMap']) if (o.material[k]) o.material[k].anisotropy = 8;
    });
    ctx.scene.add(table);
    ball.traverse(o => { if (o.isMesh) o.castShadow = true; });
    ctx.scene.add(ball);
    this.cups = SLOT_X.map((x, i) => {
      const c = i === 0 ? cupSrc : cupSrc.clone();
      c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      c.position.set(x, 0, 0);
      ctx.scene.add(c);
      return { obj: c, slot: i, lift: 0, tilt: 0, baseZ: 0 };
    });

    // 当たり（玉が入っているコップ）
    this.win = ctx.randInt(0, 2);
    this.placeBall();

    // シャッフルの予定：拍の頭ごとに、入れ替える 2 つの位置を決める
    let beat = 4;
    this.swaps = SHUFFLE[ctx.difficulty].map(len => {
      const a = ctx.randInt(0, 2);
      const b = (a + ctx.randInt(1, 2)) % 3;
      const s = { start: beat, len, a, b, done: false, begun: false };
      beat += len;
      return s;
    });

    this.label = ctx.text('', { x: 270, y: 120, size: 46, weight: 900, color: '#ffffff', stroke: '#3a2a1a', strokeWidth: 10 });
    this.picked = null;

    // 当たり：選んだコップが持ち上がって玉が跳ねる。はずれ：選んだコップは空で、当たりのコップも持ち上がって見せる
    ctx.onResult(win => {
      this.label.text = win ? 'あたり！' : 'はずれ…';
      if (win) {
        this.label.color = '#ffd84d';
        ctx.happy(this.label);
        ctx.scene.environmentIntensity = 1.15;
        this.sun.intensity = 2.1;
      } else {
        this.label.color = '#c9ced6';
        ctx.sad(this.label, { amp: 24 });
      }
    });

    // タップ：画面上でいちばん近いコップを選ぶ
    ctx.input.on('down', e => {
      if (ctx.result || this.picked || ctx.beat < 12) return;
      let best = null, bestD = 1e9;
      for (const c of this.cups) {
        const p = ctx.toScreen(c.obj);        // コップの口（机の上）が映る位置。縦方向のずれは甘めに見る
        const d = Math.hypot(p.x - e.x, (p.y - e.y) * 0.5);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best || bestD > 160) return;
      this.picked = best;
      const hit = this.cups.indexOf(best) === this.win;
      ctx.sound.play(hit ? 'coin' : 'ng');
      if (hit) ctx.win(); else ctx.lose();
    });
  },

  /** 玉を当たりのコップの下に置く */
  placeBall() {
    const c = this.cups[this.win];
    this.ball.position.set(c.obj.position.x, BALL_R, c.baseZ);
  },

  update(dt, ctx) {
    if (!this.cups) return;
    const b = ctx.beat;
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    // ① 当たりを見せる：0.5〜1.3 拍で上がり、2.6〜3.4 拍で戻る
    const reveal = this.cups[this.win];
    const up = b < 0.5 ? 0 : b < 1.3 ? ease((b - 0.5) / 0.8) : b < 2.6 ? 1 : b < 3.4 ? 1 - ease((b - 2.6) / 0.8) : 0;
    reveal.lift = up;
    // コップを置いた音（戻ったとき）
    if (!this.tapped && b >= 3.35) { this.tapped = true; ctx.sound.play('tap'); }

    // ② シャッフル
    for (const s of this.swaps) {
      if (b < s.start || s.done) continue;
      const ca = this.cups.find(c => c.slot === s.a), cb = this.cups.find(c => c.slot === s.b);
      if (!s.begun) { s.begun = true; s.ca = ca; s.cb = cb; ctx.sound.play('slide'); }
      const t = Math.min(1, (b - s.start) / (s.len * 0.92));
      const e = ease(t);
      const xa = SLOT_X[s.a], xb = SLOT_X[s.b];
      const depth = Math.abs(xb - xa) * 0.42;
      // 片方は手前、もう片方は奥を通って入れ替わる
      s.ca.obj.position.x = xa + (xb - xa) * e; s.ca.baseZ = Math.sin(Math.PI * e) * depth;
      s.cb.obj.position.x = xb + (xa - xb) * e; s.cb.baseZ = -Math.sin(Math.PI * e) * depth;
      // 動きに合わせて少し傾く（すべっている感じ）
      const lean = Math.sin(Math.PI * t) * 0.06;
      s.ca.tilt = Math.sign(xb - xa) * lean;
      s.cb.tilt = Math.sign(xa - xb) * lean;
      if (t >= 1) { s.done = true; s.ca.slot = s.b; s.cb.slot = s.a; s.ca.tilt = s.cb.tilt = 0; }
    }

    // ③ 答え合わせ：選んだコップ、はずれなら当たりのコップも持ち上げる
    if (ctx.result) {
      this.resultAt ??= b;
      const k = ease(Math.min(1, (b - this.resultAt) / 0.7));
      if (this.picked) this.picked.lift = Math.max(this.picked.lift, k);
      if (ctx.result === 'lose') {
        const k2 = ease(Math.min(1, Math.max(0, (b - this.resultAt - 0.8) / 0.7)));
        reveal.lift = Math.max(reveal.lift, k2);
      }
    }

    // 表示を反映：持ち上げながら、奥のふちを支点にして手前を起こし、口（中）をこちらへ向ける。
    // カメラは約 33° 上から見ているので、それより大きく倒すと中が見える
    for (const c of this.cups) {
      const a = c.lift * TILT;
      c.obj.rotation.x = -a;
      c.obj.rotation.z = -c.tilt;
      // 奥のふち（z = -R_RIM）が動かないように位置をずらす
      c.obj.position.y = c.lift * LIFT + R_RIM * Math.sin(a);
      c.obj.position.z = c.baseZ - R_RIM * (1 - Math.cos(a));
    }
    this.placeBall();
    if (ctx.result === 'win') this.ball.position.y = BALL_R + Math.abs(Math.sin(b * Math.PI)) * 0.03;

    if (!ctx.result) this.label.text = b < 4 ? 'ここ！' : b < 12 ? 'よく見て…' : 'どれ？';
  },
};
