// 効果音。音声ファイルを使わず Web Audio で合成する。
// ミニゲームは ctx.sound.play('pop') のように id で鳴らす（本体が再生する）。
// 時刻は performance.now() 基準の秒（clock()）で指定でき、拍に正確に合わせて鳴らせる。
let ac = null;

/** 進行の基準となる時計（秒） */
export const clock = () => performance.now() / 1000;

/** 最初のタップで呼ぶ（スマホでは、タップしないと音が鳴らない） */
export function unlockAudio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
  }
  if (ac.state === 'suspended') ac.resume();
  const b = ac.createBuffer(1, 1, 22050), src = ac.createBufferSource();
  src.buffer = b; src.connect(ac.destination); src.start(0);
}

function tone(t, freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0 } = {}) {
  t += delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

const noiseBuffers = new Map();
function noise(t, dur, { vol = 0.3, freq = 1000, q = 1, type = 'bandpass', delay = 0 } = {}) {
  t += delay;
  const len = Math.ceil(ac.sampleRate * dur);
  let buf = noiseBuffers.get(len);
  if (!buf) {
    buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(len, buf);
  }
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t);
}

const SFX = {
  // ミニゲームから使える音
  pop: t => { noise(t, 0.12, { freq: 2000, vol: 0.6 }); tone(t, 700, 0.08, { type: 'square', vol: 0.08, slide: 0.5 }); },
  hit: t => { noise(t, 0.25, { freq: 400, vol: 0.7 }); tone(t, 180, 0.25, { type: 'sawtooth', vol: 0.15, slide: 0.4 }); },
  coin: t => { tone(t, 988, 0.08, { type: 'square', vol: 0.1 }); tone(t, 1319, 0.25, { type: 'square', vol: 0.1, delay: 0.08 }); },
  jump: t => tone(t, 300, 0.18, { type: 'square', vol: 0.1, slide: 2.5 }),
  tick: t => tone(t, 1400, 0.04, { type: 'square', vol: 0.06 }),
  whoosh: t => noise(t, 0.22, { freq: 900, vol: 0.35, q: 0.7 }),
  spin: t => tone(t, 500, 0.12, { type: 'triangle', vol: 0.12, slide: 1.6 }),
  // 本体が使う音（リズム）
  kick: t => tone(t, 150, 0.16, { vol: 0.7, slide: 0.3 }),
  snare: t => { noise(t, 0.14, { freq: 1800, vol: 0.35, q: 0.6 }); tone(t, 220, 0.08, { type: 'triangle', vol: 0.12, slide: 0.6 }); },
  hat: t => noise(t, 0.04, { freq: 9000, vol: 0.12, type: 'highpass' }),
  hatSoft: t => noise(t, 0.03, { freq: 9000, vol: 0.05, type: 'highpass' }),
  count: t => tone(t, 1760, 0.06, { type: 'square', vol: 0.08 }),
  // 本体が使う音（ジングル）
  start: t => [523, 659, 784, 1047].forEach((f, i) => tone(t, f, 0.12, { type: 'square', vol: 0.09, delay: i * 0.06 })),
  ok: t => [523, 659, 784, 1047].forEach((f, i) => tone(t, f, 0.16, { type: 'triangle', vol: 0.25, delay: i * 0.07 })),
  ng: t => [392, 330, 262].forEach((f, i) => tone(t, f, 0.22, { type: 'sawtooth', vol: 0.1, delay: i * 0.11 })),
  speedup: t => [523, 587, 659, 698, 784, 880, 988, 1047].forEach((f, i) => tone(t, f, 0.08, { type: 'square', vol: 0.08, delay: i * 0.05 })),
  gameover: t => [392, 370, 349, 330].forEach((f, i) => tone(t, f, 0.35, { type: 'triangle', vol: 0.2, delay: i * 0.25 })),
};

export const SOUND_IDS = Object.keys(SFX);

/** id の音を鳴らす。at は clock() 基準の秒（省略で今すぐ） */
export function play(id, at) {
  if (!ac || !Object.hasOwn(SFX, id)) return;
  const delay = at === undefined ? 0 : Math.max(0, at - clock());
  SFX[id](ac.currentTime + delay);
}
