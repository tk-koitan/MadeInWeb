// 効果音。音声ファイルを使わず Web Audio で合成する。
// ミニゲームは ctx.sound.play('pop') のように id で鳴らす（本体が再生する）。
let ac = null;

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

function tone(freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0 } = {}) {
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, freq = 1000, q = 1, delay = 0 } = {}) {
  const t = ac.currentTime + delay;
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t);
}

const SFX = {
  // ミニゲームから使える音
  pop: () => { noise(0.12, { freq: 2000, vol: 0.6 }); tone(700, 0.08, { type: 'square', vol: 0.08, slide: 0.5 }); },
  hit: () => { noise(0.25, { freq: 400, vol: 0.7 }); tone(180, 0.25, { type: 'sawtooth', vol: 0.15, slide: 0.4 }); },
  coin: () => { tone(988, 0.08, { type: 'square', vol: 0.1 }); tone(1319, 0.25, { type: 'square', vol: 0.1, delay: 0.08 }); },
  jump: () => tone(300, 0.18, { type: 'square', vol: 0.1, slide: 2.5 }),
  tick: () => tone(1400, 0.04, { type: 'square', vol: 0.06 }),
  whoosh: () => noise(0.22, { freq: 900, vol: 0.35, q: 0.7 }),
  spin: () => tone(500, 0.12, { type: 'triangle', vol: 0.12, slide: 1.6 }),
  // 本体が使う音
  start: () => [523, 784].forEach((f, i) => tone(f, 0.12, { type: 'square', vol: 0.1, delay: i * 0.1 })),
  ok: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.25, delay: i * 0.07 })),
  ng: () => [392, 330, 262].forEach((f, i) => tone(f, 0.22, { type: 'sawtooth', vol: 0.1, delay: i * 0.11 })),
  speedup: () => [523, 587, 659, 698, 784, 880, 988, 1047].forEach((f, i) => tone(f, 0.08, { type: 'square', vol: 0.08, delay: i * 0.05 })),
  gameover: () => [392, 370, 349, 330].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.2, delay: i * 0.25 })),
};

export const SOUND_IDS = Object.keys(SFX);

export function play(id) {
  if (!ac || !Object.hasOwn(SFX, id)) return;
  SFX[id]();
}
