// 音の再生（本体が担当。ミニゲームは ctx.sound.play(id) で依頼するだけ）
//
// - 音声ファイル（mp3 など）を読み込んで鳴らす。ミニゲームの game.json の "sounds" / "bgm" もここで扱う
// - ファイルがない・読み込めない音は、Web Audio の合成音で代わりに鳴らす
// - 時刻は performance.now() 基準の秒（clock()）で指定でき、拍に正確に合わせて鳴らせる
import { coldFetch } from './cold.js';

let ac = null, out = null;

/** 進行の基準となる時計（秒） */
export const clock = () => performance.now() / 1000;

function ensureContext() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    out = ac.createGain();
    out.connect(ac.destination);
  }
  return ac;
}
/** clock() 基準の時刻を AudioContext の時刻に変換する */
const audioTime = at => ac.currentTime + (at === undefined ? 0 : Math.max(0, at - clock()));

/** 最初のタップで呼ぶ（スマホでは、タップしないと音が鳴らない） */
export function unlockAudio() {
  if (!ensureContext()) return;
  if (ac.state === 'suspended') ac.resume();
  const b = ac.createBuffer(1, 1, 22050), src = ac.createBufferSource();
  src.buffer = b; src.connect(out); src.start(0);
}

// ---------------------------------------------------------------- 音声ファイル
const loading = new Map();   // url → Promise<AudioBuffer | null>
const loaded = new Map();    // url → AudioBuffer | null（読み込み済みのもの）

/** 音の大きさをそろえる（ピークを 0.9 に） */
function normalize(buf) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  if (peak <= 0) return;
  const g = 0.9 / peak;
  if (Math.abs(g - 1) < 0.05) return;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
}

/** 音声ファイルを読み込む（同じ URL は1回だけ）。失敗したら null */
export function loadSound(url) {
  if (!loading.has(url)) {
    loading.set(url, (async () => {
      if (!ensureContext()) return null;
      const r = await coldFetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.arrayBuffer();
      // 古い Safari は decodeAudioData が Promise を返さないので、コールバック形式で呼ぶ
      const buf = await new Promise((resolve, reject) => {
        const p = ac.decodeAudioData(data, resolve, reject);
        if (p && p.catch) p.catch(reject);
      });
      normalize(buf);
      return buf;
    })().catch(err => { console.warn('音声を読み込めません', url, err); return null; })
      .then(b => { loaded.set(url, b); return b; }));
  }
  return loading.get(url);
}

function startBuffer(buf, t, { rate = 1, gain = 1, duration = 0, tail = 0 } = {}) {
  self.__mwPlayed = (self.__mwPlayed || 0) + 1;   // 動作確認用：ファイルの音を鳴らした回数
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = buf;
  src.playbackRate.value = rate;
  g.gain.value = gain;
  src.connect(g).connect(out);
  src.start(t, 0);
  if (duration > 0) {
    // tail 秒ぶん次の区間に重ねてフェードアウトする（0 なら区間の終わりで短く切る）
    const end = t + duration, fadeFrom = tail > 0 ? end : Math.max(t, end - 0.05), fadeTo = end + tail;
    g.gain.setValueAtTime(gain, fadeFrom);
    g.gain.linearRampToValueAtTime(0, fadeTo);
    src.stop(fadeTo + 0.01);
  }
  return src;
}

// ---------------------------------------------------------------- 名前付きの音
const hostSounds = new Map();   // id → url（本体の音）
let gameSounds = new Map();     // id → url（いま遊んでいるミニゲームの音）

/** 本体の音を登録して読み込み始める */
export function registerSounds(map) {
  for (const [id, url] of Object.entries(map)) { hostSounds.set(id, url); loadSound(url); }
}
/** いま遊んでいるミニゲームの音（game.json の "sounds"）を設定する */
export function setGameSounds(map) { gameSounds = new Map(Object.entries(map || {})); }

/** 音声ファイルが読み込み済みで使えるか */
export const isLoaded = url => !!(url && loaded.get(url));

/**
 * 曲やジングルを鳴らす。at から duration 秒で止める（最後は短くフェードアウト）。
 * rate はテンポの倍率（120bpm の曲を速く鳴らす）。読み込めていなければ false を返す
 */
export function playMusic(url, at, duration, { rate = 1, gain = 0.7, tail = 0 } = {}) {
  if (!ac) return false;
  const buf = loaded.get(url);
  if (!buf) return false;
  startBuffer(buf, audioTime(at), { rate, gain, duration, tail });
  return true;
}

// ---------------------------------------------------------------- 合成音（ファイルがないときの代わり）
function tone(t, freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0 } = {}) {
  t += delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out);
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
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

const SYNTH = {
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

export const SOUND_IDS = Object.keys(SYNTH);

/**
 * id の音を鳴らす。at は clock() 基準の秒（省略で今すぐ）。
 * ミニゲームの音 → 本体の音 → 合成音 の順に探す
 */
export function play(id, at) {
  if (!ac) return;
  const url = gameSounds.get(id) || hostSounds.get(id);
  const buf = url && loaded.get(url);
  if (buf) { startBuffer(buf, audioTime(at), { gain: 0.9 }); return; }
  if (Object.hasOwn(SYNTH, id)) SYNTH[id](audioTime(at));
}
