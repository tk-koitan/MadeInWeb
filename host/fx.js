// 本体の画面演出（フラッシュ・揺れ・紙吹雪・ひび割れ）
const $ = id => document.getElementById(id);

/** 白いフラッシュ */
export function flash(strength = 0.85, seconds = 0.35) {
  $('flash').animate([{ opacity: strength }, { opacity: 0 }], { duration: seconds * 1000, easing: 'ease-out' });
}

/** ゲーム画面を揺らす（magnitude は画面幅に対する割合） */
export function shake(magnitude = 0.03, seconds = 0.4) {
  const el = $('shaker'), px = el.clientWidth * magnitude, n = 10, frames = [];
  for (let i = 0; i < n; i++) {
    const k = 1 - i / n;
    frames.push({ transform: `translate(${(Math.random() * 2 - 1) * px * k}px, ${(Math.random() * 2 - 1) * px * k}px)` });
  }
  frames.push({ transform: 'translate(0, 0)' });
  el.animate(frames, { duration: seconds * 1000, easing: 'linear' });
}

/** 画面の中央からひび割れを走らせる */
export function crack() {
  const cx = 50 + (Math.random() - 0.5) * 20, cy = 85 + (Math.random() - 0.5) * 30;
  let d = '';
  const branches = 9;
  for (let b = 0; b < branches; b++) {
    let a = (b / branches) * Math.PI * 2 + Math.random() * 0.5, x = cx, y = cy;
    d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
    const len = 30 + Math.random() * 45, steps = 6;
    for (let s = 0; s < steps; s++) {
      a += (Math.random() - 0.5) * 0.9;
      x += Math.cos(a) * len / steps;
      y += Math.sin(a) * len / steps * 1.4;
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  }
  $('crack').innerHTML =
    `<path d="${d}" pathLength="1" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
    `<path d="${d}" pathLength="1" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
}

let confettiRaf = 0;
/** 紙吹雪を打ち上げる */
export function confetti() {
  const cv = $('confetti'), rect = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = rect.width, H = rect.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#e4572e', '#f3a712', '#29bf12', '#4f6bed', '#d65db1', '#2ec4b6', '#ffffff'];
  const ps = Array.from({ length: 110 }, (_, i) => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.4, y: H * 0.55,
    vx: (Math.random() - 0.5) * W * 1.8, vy: -H * (0.7 + Math.random() * 0.9),
    w: W * (0.016 + Math.random() * 0.016), h: W * (0.009 + Math.random() * 0.01),
    a: Math.random() * 6, va: (Math.random() - 0.5) * 16, c: colors[i % colors.length],
  }));
  cancelAnimationFrame(confettiRaf);
  const t0 = performance.now();
  let last = t0;
  const frame = now => {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += H * 2.4 * dt;
      const drag = Math.exp(-2.2 * dt);
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.a);
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.a * 1.3)) + 1);
      g.restore();
    }
    if (now - t0 < 2600) confettiRaf = requestAnimationFrame(frame);
    else g.clearRect(0, 0, W, H);
  };
  confettiRaf = requestAnimationFrame(frame);
}

/** 演出を消す（次のゲームの前に呼ぶ） */
export function clearFx() {
  cancelAnimationFrame(confettiRaf);
  const cv = $('confetti');
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  $('crack').innerHTML = '';
}
