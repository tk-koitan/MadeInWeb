// 本体：タイトル → ミニゲームを連続で遊ぶ → ゲームオーバー
// ミニゲームは常駐サンドボックス iframe の中で動き、ここからは postMessage でだけ操作する。
//
// 進行はすべて拍（ビート）で管理する。最初は 120bpm、スピードアップでテンポが上がる。
//   スタート(4拍) → 準備(4拍) → ミニゲーム(8 or 16拍) → 結果(4拍) → 準備(4拍) → …
//
// URL パラメータ（開発用）
//   ?game=balloon        そのミニゲームだけを繰り返す（ライフ無限、エラー表示あり）
//   &difficulty=1..3     難易度を固定
//   &speed=0.5..3        スピード（テンポの倍率）を固定
//   ?debug               通常モードでもエラーを表示
import { flash, shake, crack, confetti, clearFx } from './fx.js';
import { unlockAudio, play, clock, playMusic, loadSound, registerSounds, setGameSounds } from './sfx.js';

const params = new URLSearchParams(location.search);
const DEV_GAME = params.get('game');
const DEV_DIFF = params.has('difficulty') ? clamp(parseInt(params.get('difficulty'), 10) || 1, 1, 3) : null;
const DEV_SPEED = params.has('speed') ? clamp(Number(params.get('speed')) || 1, 0.5, 3) : null;
const SHOW_ERRORS = !!DEV_GAME || params.has('debug');

const BASE_BPM = 120;
const MAX_LIVES = 4;
const BEATS = { start: 4, prepare: 4, result: 4 };
const SPEED_STEP = 0.15;        // 4本クリアごとにテンポ +15%
const SPEED_MAX = 2.0;          // 最大 240bpm
const SPEED_EVERY = 4;
const DIFFICULTY_EVERY = 8;     // 8本クリアごとに難易度 +1

// 本体の音楽（120bpm で生成。テンポが上がったら速く再生する）
const HOST_MUSIC = {
  start: 'audio/start.mp3',
  prepare: 'audio/prepare.mp3',
  speedup: 'audio/speedup.mp3',
  win: 'audio/win.mp3',
  lose: 'audio/lose.mp3',
  gameover: 'audio/gameover.mp3',
};
/** 本体の音楽を beats 拍ぶん鳴らす。ファイルがなければ false（合成音で代わりに鳴らす） */
// スタート・結果の曲は、区間の終わりで切らずに少し次の区間へ重ねてフェードアウトする
const MUSIC_TAIL = { start: 0.25, win: 0.25, lose: 0.25 };
const music = (key, at, beats, spb) => playMusic(HOST_MUSIC[key], at, beats * spb, { rate: 60 / spb / BASE_BPM, tail: MUSIC_TAIL[key] || 0 });

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** clock() が t 秒になるまで待つ */
function waitUntil(t) {
  return new Promise(resolve => {
    const check = () => {
      const d = t - clock();
      if (d <= 0.002) resolve();
      else setTimeout(check, Math.max(0, Math.min(d * 1000 - 1, 40)));
    };
    check();
  });
}

// ---------------------------------------------------------------- サンドボックス iframe
let frame = null, lastHeartbeat = 0, runId = 0;
const listeners = new Set();

window.addEventListener('message', e => {
  if (!frame || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  lastHeartbeat = performance.now();
  if (m.type === 'sound') { if (m.runId === runId && typeof m.id === 'string') play(m.id); return; }
  if (m.type === 'fetchAsset') { sendAsset(m); return; }
  if (m.type === 'error') { console.error('[minigame]', m.message); showError(String(m.message)); }
  for (const l of [...listeners]) l(m);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastHeartbeat = performance.now(); });

function waitFor(pred, timeout) {
  return new Promise((resolve, reject) => {
    const l = m => { if (pred(m)) { listeners.delete(l); clearTimeout(t); resolve(m); } };
    const t = setTimeout(() => { listeners.delete(l); reject(new Error('timeout')); }, timeout);
    listeners.add(l);
  });
}
const post = m => frame && frame.contentWindow && frame.contentWindow.postMessage(m, '*');

// ---- サンドボックスからの素材ファイルの依頼（VRM など）
// サンドボックスは通信できないので、本体が「いま遊んでいるゲームのフォルダ内のファイル」だけを取得して渡す
const ASSET_MAX_BYTES = 30 * 1024 * 1024;
const safeAssetPath = p => typeof p === 'string' && p.length < 200 && /^[\w\-./]+\.(vrm|vrma|glb|gltf|bin|png|jpg|jpeg|webp|json)$/i.test(p) && !p.includes('..') && !p.startsWith('/');
let currentGameId = null;
async function sendAsset(m) {
  const reply = (extra, transfer = []) => frame && frame.contentWindow && frame.contentWindow.postMessage({ type: 'asset', reqId: m.reqId, ...extra }, '*', transfer);
  try {
    if (m.runId !== runId || !currentGameId) throw new Error('いまのゲームからの依頼ではありません');
    if (!safeAssetPath(m.path)) throw new Error(`読み込めないファイル名です: ${m.path}`);
    const r = await fetch(`games/${currentGameId}/${m.path}`);
    if (!r.ok) throw new Error(`${m.path}: ${r.status}`);
    const data = await r.arrayBuffer();
    if (data.byteLength > ASSET_MAX_BYTES) throw new Error(`${m.path} が大きすぎます（${(data.byteLength / 1e6).toFixed(1)}MB）`);
    reply({ ok: true, data }, [data]);
  } catch (err) {
    reply({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

async function createFrame() {
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.className = 'game';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', 'minigame');
  frame.src = `sandbox/sandbox.html?v=${encodeURIComponent(self.APP_VERSION)}`;
  const booted = waitFor(m => m.type === 'boot' || m.type === 'fatal', 15000);
  $('shaker').prepend(frame);
  let m;
  try {
    m = await booted;
  } catch {
    throw new Error('ミニゲームの実行環境が起動しませんでした（15秒でタイムアウト）。\nブラウザの拡張機能やセキュリティ設定が iframe をブロックしていないか確認してください。');
  }
  if (m.type === 'fatal') throw new Error(`ミニゲームの実行環境を起動できません。\n${m.message}`);
  lastHeartbeat = performance.now();
}
async function recoverFrame() {
  try { await createFrame(); } catch (err) { console.error(err); }
}

// ---------------------------------------------------------------- ミニゲーム一覧
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
const safeAudioPath = p => typeof p === 'string' && /^[\w\-./]+\.(mp3|ogg|wav|m4a)$/i.test(p) && !p.includes('..') && !p.startsWith('/');

async function loadCatalog() {
  const ids = await fetchJSON('games/index.json');
  const list = [];
  for (const id of ids) {
    try {
      const g = await fetchJSON(`games/${id}/game.json`);
      list.push({
        id,
        title: String(g.title || id),
        author: String(g.author || ''),
        instruction: String(g.instruction || '？'),
        beats: Number(g.beats) === 16 ? 16 : 8,
        timeoutResult: g.timeoutResult === 'win' ? 'win' : 'lose',
        camera: g.camera === 'perspective' ? 'perspective' : 'ortho',
        // 音（game.json の "bgm" と "sounds"）。ゲームフォルダ内の音声ファイルだけを受け付ける
        bgmUrl: safeAudioPath(g.bgm) ? `games/${id}/${g.bgm}` : null,
        soundUrls: Object.fromEntries(
          Object.entries(g.sounds && typeof g.sounds === 'object' ? g.sounds : {})
            .filter(([k, v]) => /^[a-z0-9_-]{1,32}$/i.test(k) && safeAudioPath(v))
            .slice(0, 16)
            .map(([k, v]) => [k, `games/${id}/${v}`]),
        ),
      });
    } catch (err) {
      console.error(`games/${id}/game.json を読み込めません`, err);
    }
  }
  return list;
}

let bag = [], lastId = null;
function nextGame(catalog) {
  if (!bag.length) {
    bag = [...catalog];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    if (bag.length > 1 && bag.at(-1).id === lastId) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  const g = bag.pop();
  lastId = g.id;
  return g;
}

// ---------------------------------------------------------------- 画面表示
// スピードの段階ごとに変わる準備画面の背景色
const LEVEL_COLORS = ['#fdf6e3', '#fff1d0', '#ffe4dc', '#e9efff', '#e3f8e6', '#f3e8ff', '#fff6b8', '#ffe1ef'];
function curtain({ title = '', main = '', sub = '', hint = '', bpm = '', speedup = false, level = 0 } = {}) {
  $('c-title').textContent = title;
  $('c-main').textContent = main;
  $('c-sub').textContent = sub;
  $('c-bpm').textContent = bpm;
  $('c-hint').textContent = hint;
  $('curtain').classList.toggle('speedup', speedup);
  $('curtain').style.setProperty('--curtain-bg', LEVEL_COLORS[level % LEVEL_COLORS.length]);
  for (const a of $('curtain').getAnimations()) a.cancel();
  $('curtain').classList.remove('hidden');
}
const hideCurtain = () => $('curtain').classList.add('hidden');

// ---- ショート動画のような上スワイプ遷移
/** スワイプの長さ（秒）。テンポが上がると短くなる */
const swipeDur = spb => Math.min(0.4, spb * 0.8);
function slide(el, from, to, dur) {
  return el.animate(
    [{ transform: `translateY(${from}%)` }, { transform: `translateY(${to}%)` }],
    { duration: dur * 1000, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' },
  ).finished.catch(() => {});
}
/** 準備画面が上に流れ、下からゲーム画面が上がってくる */
async function swipeToGame(dur) {
  await Promise.all([slide($('curtain'), 0, -100, dur), slide($('stage'), 100, 0, dur)]);
  hideCurtain();
}
/** ゲーム画面が上に流れ、下から準備画面（content の内容）が上がってくる */
async function swipeToCurtain(content, dur) {
  curtain(content);
  await Promise.all([slide($('curtain'), 100, 0, dur), slide($('stage'), 0, -100, dur)]);
}
const waitTap = () => new Promise(r => $('curtain').addEventListener('pointerdown', r, { once: true }));
const lifeText = l => (l === Infinity ? '∞' : '●'.repeat(Math.max(0, l)) + '○'.repeat(MAX_LIVES - Math.max(0, l)));

function restartAnimation(el, cls, seconds) {
  el.style.animationDuration = `${seconds}s`;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
const pulse = spb => restartAnimation($('c-main'), 'pulse', Math.min(0.3, spb * 0.6));
function showInstruction(text, spb) {
  $('instruction').textContent = text;
  restartAnimation($('instruction'), 'show', spb * 3);
}
function showMark(win) {
  const el = $('mark'), span = el.firstElementChild;
  span.textContent = win ? '○' : '×';
  span.className = '';
  el.className = win ? 'win' : 'lose';
}
/** 結果の ○× を拍に合わせて弾ませる */
const markBeat = spb => restartAnimation($('mark').firstElementChild, 'beat', Math.min(0.3, spb * 0.6));
const hideMark = () => { $('mark').className = 'hidden'; };
const setTimer = frac => {
  $('timer-bar').style.transform = `scaleX(${frac})`;
  $('spark').style.left = `${5 + 90 * frac}%`;   // 導火線の火花はタイマーの先端
};
const showTimer = v => {
  $('timer').classList.toggle('hidden', !v);
  $('spark').classList.toggle('hidden', !v);
  if (!v) $('timer').classList.remove('urgent', 'beat');
};
/** 残り拍数の表示（3・2・1） */
function showCountdown(n, spb) {
  $('countdown').textContent = String(n);
  restartAnimation($('countdown'), 'tick', spb * 0.95);
}

let errorTimer = 0;
function showError(msg) {
  if (!SHOW_ERRORS) return;
  const el = $('error');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => el.classList.add('hidden'), 8000);
}

// ---------------------------------------------------------------- 拍のタイムライン
/**
 * 拍を刻む。T（この区間の開始時刻）から beats 拍分、各拍で sounds(i) の音を予約し、
 * onBeat(i) を呼ぶ。区間の終わり（次の区間の開始時刻）を返す。
 */
async function beatPhase(T, beats, spb, { sounds, onBeat } = {}) {
  for (let i = 0; i < beats; i++) {
    for (const id of (sounds && sounds(i)) || []) play(id, T + i * spb);
  }
  for (let i = 0; i < beats; i++) {
    await waitUntil(T + i * spb);
    if (onBeat) onBeat(i);
  }
  const end = T + beats * spb;
  await waitUntil(end);
  return end;
}

// ---------------------------------------------------------------- ミニゲーム
function loadGame(game, st) {
  const id = ++runId;
  currentGameId = game.id;
  const v = encodeURIComponent(self.APP_VERSION);
  lastHeartbeat = performance.now();
  post({
    type: 'load', runId: id,
    url: new URL(`games/${game.id}/main.js?v=${v}`, location.href).href,
    base: new URL(`games/${game.id}/`, location.href).href,
    speed: st.speed, difficulty: st.difficulty, beats: game.beats,
    timeoutResult: game.timeoutResult, camera: game.camera, seed: (Math.random() * 0x7fffffff) | 0,
  });
  const ready = waitFor(m => m.runId === id && (m.type === 'ready' || m.type === 'error'), 20000)
    .then(m => m.type === 'ready', () => false);
  const audio = Promise.all([game.bgmUrl, ...Object.values(game.soundUrls)].filter(Boolean).map(loadSound));
  return Promise.all([ready, audio]).then(([ok]) => ok);
}

/** ミニゲームの区間。拍数ぶん遊ばせて、結果を返す（途中で決まっても最後まで続ける） */
async function gamePhase(T, game, spb) {
  const id = runId;
  const beats = game.beats;
  const end = T + beats * spb;
  let outcome = null, crashed = false;
  const resultL = m => {
    if (m.runId !== id || outcome) return;
    if (m.type === 'result') outcome = m.win === true ? 'win' : 'lose';
    if (m.type === 'error') outcome = 'lose';
    // 勝敗が決まった瞬間の手応え（ゲーム側はヒットストップでスローになる）
    if (outcome === 'win') flash(0.45, 0.2);
    else if (outcome === 'lose') shake(0.02, 0.25);
  };
  listeners.add(resultL);

  // ミニゲームの BGM と効果音。BGM がなければ合成音で拍を刻む。最後の4拍はカウント音
  setGameSounds(game.soundUrls);
  const hasBgm = game.bgmUrl && playMusic(game.bgmUrl, T, beats * spb, { rate: 60 / spb / BASE_BPM, gain: 0.6 });
  for (let i = 0; i < beats; i++) {
    if (i >= beats - 4) play('count', T + i * spb);
    else if (!hasBgm) play('hatSoft', T + i * spb);
    if (!hasBgm && i % 2 === 0) play('kick', T + i * spb);
  }

  // 残り4拍：タイマーが赤く脈打つ。最後の3拍は 3・2・1 を出す
  for (let i = beats - 4; i < beats; i++) {
    waitUntil(T + i * spb).then(() => {
      if (runId !== id) return;
      $('timer').classList.add('urgent');
      restartAnimation($('timer'), 'beat', Math.min(0.3, spb * 0.6));
      if (i >= beats - 3) showCountdown(beats - i, spb);
    });
  }

  await waitUntil(T);
  post({ type: 'start', runId: id });
  showInstruction(game.instruction, spb);
  setTimer(1);
  showTimer(true);
  lastHeartbeat = performance.now();

  await new Promise(resolve => {
    (function tick() {
      const now = clock();
      setTimer(clamp((end - now) / (end - T), 0, 1));
      if (!crashed && performance.now() - lastHeartbeat > 2500 && !document.hidden) { crashed = true; outcome = outcome || 'lose'; }
      if (now >= end - 0.002) { resolve(); return; }
      requestAnimationFrame(tick);
    })();
  });

  if (!outcome) outcome = game.timeoutResult;  // 時間切れ
  post({ type: 'timeup', runId: id });
  listeners.delete(resultL);
  return { win: outcome === 'win', crashed, end };
}

// ---------------------------------------------------------------- 通しで遊ぶ
/**
 * 通しで遊ぶ。practice: true なら「えらんで遊ぶ」（ライフ無限、◀ メニューで終了）。
 * speed / difficulty を指定すると固定される
 */
async function runSession(catalog, { practice = false, speed = null, difficulty = null } = {}) {
  const fixedSpeed = speed ?? DEV_SPEED, fixedDiff = difficulty ?? DEV_DIFF;
  const st = { lives: practice || DEV_GAME ? Infinity : MAX_LIVES, count: 0, speed: fixedSpeed || 1, difficulty: fixedDiff || 1 };
  const spbOf = () => 60 / (BASE_BPM * st.speed);
  const devHint = game => (DEV_GAME ? `DEV: ${game.id}  難易度 ${st.difficulty}  ${Math.round(BASE_BPM * st.speed)}bpm`
    : practice ? `${game.title}　${DIFF_LABELS[st.difficulty - 1]}　${Math.round(BASE_BPM * st.speed)} BPM` : '');
  bag = []; lastId = null;
  // 「◀ メニュー」で練習を終える
  let quit = false;
  const quitBtn = $('btn-quit');
  quitBtn.classList.toggle('hidden', !practice);
  quitBtn.onclick = () => { quit = true; quitBtn.classList.add('hidden'); };

  // スタート（4拍）
  let T = clock() + 0.1;
  let spb = spbOf();
  curtain({ title: lifeText(st.lives), main: '0', sub: 'スタート！', bpm: `${Math.round(BASE_BPM * st.speed)} BPM` });
  const startMusic = music('start', T, BEATS.start, spb);
  if (!startMusic) play('start', T);
  T = await beatPhase(T, BEATS.start, spb, {
    sounds: () => (startMusic ? [] : ['kick', 'hat']),
    onBeat: () => pulse(spb),
  });

  let fromGame = false;   // 直前がミニゲーム画面なら、準備画面を下からスワイプで出す
  for (;;) {
    // 準備（4拍）：次のミニゲームを読み込みながら、ライフとクリア数を見せる
    const game = nextGame(catalog);
    let speedUp = false;
    if (quit) break;
    if (!fixedSpeed) {
      const s = Math.min(SPEED_MAX, 1 + SPEED_STEP * Math.floor(st.count / SPEED_EVERY));
      speedUp = s > st.speed;
      st.speed = s;
    }
    if (!fixedDiff) st.difficulty = Math.min(3, 1 + Math.floor(st.count / DIFFICULTY_EVERY));
    spb = spbOf();
    const dur = swipeDur(spb);
    const prepEnd = T + BEATS.prepare * spb;
    const level = Math.round((st.speed - 1) / SPEED_STEP);
    const prep = {
      title: lifeText(st.lives), main: String(st.count), hint: devHint(game),
      sub: speedUp ? 'SPEED UP!' : '', bpm: `${Math.round(BASE_BPM * st.speed)} BPM`, speedup: speedUp, level,
    };

    const prepMusic = music(speedUp ? 'speedup' : 'prepare', T, BEATS.prepare, spb);
    if (speedUp && !prepMusic) play('speedup', T);
    beatPhase(T, BEATS.prepare, spb, {           // 拍は裏で刻み続ける
      sounds: i => (prepMusic ? [] : i % 2 === 1 ? ['kick', 'snare'] : ['kick', 'hat']),
      onBeat: () => pulse(spb),
    });
    if (fromGame) {
      await waitUntil(T);
      play('whoosh');
      await swipeToCurtain(prep, dur);
    } else {
      curtain(prep);
    }
    hideMark();
    showTimer(false);
    clearFx();
    const loaded = loadGame(game, st);             // 前のゲームは読み込み時に片付けられる

    // ミニゲームの1拍目でスワイプを始める（ゲームはスワイプしながら始まる）
    await waitUntil(prepEnd);
    if (quit) break;
    let r;
    if (await loaded) {
      let gameStart = prepEnd;
      if (clock() > prepEnd + 0.03) gameStart = clock();   // 読み込みが間に合わなかったら、そこから拍を取り直す
      play('whoosh');
      swipeToGame(dur);
      r = await gamePhase(gameStart, game, spb);
      T = r.end;
    } else {
      r = { win: false, crashed: true, loadFailed: true };
      swipeToGame(dur);
      T = Math.max(prepEnd, clock()) + dur;
      await waitUntil(T);
    }

    // 結果（4拍）
    if (r.win) st.count++; else st.lives--;
    const resultMusic = music(r.win ? 'win' : 'lose', T, BEATS.result, spb);
    if (!resultMusic) play(r.win ? 'ok' : 'ng', T);
    showMark(r.win);
    showTimer(false);
    if (r.win) { flash(0.85, 0.35); confetti(); }
    else { shake(0.045, 0.45); crack(); }
    if (r.loadFailed) showError(`「${game.title}」を読み込めませんでした`);
    T = await beatPhase(T, BEATS.result, spb, {
      sounds: i => (resultMusic || i === 0 ? [] : ['kick']),
      onBeat: i => { if (i > 0) markBeat(spb); },
    });
    if (r.crashed) { await recoverFrame(); T = Math.max(T, clock() + 0.05); }
    fromGame = true;

    if (st.lives <= 0) break;
  }

  quitBtn.classList.add('hidden');
  if (quit) {                                   // 練習をやめた：ゲームオーバー画面は出さない
    post({ type: 'unload' });
    hideMark();
    clearFx();
    return;
  }
  play('whoosh');
  await swipeToCurtain({ title: 'GAME OVER', main: String(st.count), sub: 'クリアした数', hint: 'タップでタイトルへ' }, swipeDur(spb));
  post({ type: 'unload' });
  hideMark();
  if (!playMusic(HOST_MUSIC.gameover, undefined, 6)) play('gameover');
  await sleep(1000);
  await waitTap();
}

/** タイトル。'normal'（スタート）か 'select'（えらんで遊ぶ）を返す */
async function title(catalog) {
  if (DEV_GAME) {
    curtain({ title: 'MadeInWeb', sub: `DEV: ${DEV_GAME}`, hint: 'タップしてスタート' });
    await waitTap();
    unlockAudio();
    return 'normal';
  }
  curtain({ title: 'MadeInWeb', main: '', sub: `${catalog.length}本のミニゲーム` });
  $('title-menu').classList.remove('hidden');
  const mode = await new Promise(resolve => {
    $('btn-start').onclick = () => resolve('normal');
    $('btn-select').onclick = () => resolve('select');
  });
  $('title-menu').classList.add('hidden');
  unlockAudio();
  return mode;
}

// ---- えらんで遊ぶ
const SPEED_CHOICES = [1, 1.25, 1.5, 1.75, 2];
const DIFF_LABELS = ['かんたん', 'ふつう', 'むずかしい'];
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('madeinweb.select') || '{}');
    return { speed: SPEED_CHOICES.includes(p.speed) ? p.speed : 1, difficulty: [1, 2, 3].includes(p.difficulty) ? p.difficulty : 1 };
  } catch { return { speed: 1, difficulty: 1 }; }
}
function savePrefs(p) {
  try { localStorage.setItem('madeinweb.select', JSON.stringify(p)); } catch { /* 保存できなくても遊べる */ }
}
/** 選択ボタンの列を作る */
function segment(el, items, current, onPick) {
  el.textContent = '';
  for (const [value, label] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    b.classList.toggle('on', value === current);
    b.onclick = () => {
      for (const x of el.children) x.classList.remove('on');
      b.classList.add('on');
      onPick(value);
    };
    el.append(b);
  }
}
/** ミニゲーム・スピード・難易度を選ぶ。もどる なら null */
async function selectScreen(catalog) {
  const prefs = loadPrefs();
  segment($('sel-speed'), SPEED_CHOICES.map(v => [v, String(Math.round(BASE_BPM * v))]), prefs.speed, v => { prefs.speed = v; savePrefs(prefs); });
  segment($('sel-diff'), DIFF_LABELS.map((l, i) => [i + 1, l]), prefs.difficulty, v => { prefs.difficulty = v; savePrefs(prefs); });
  const result = await new Promise(resolve => {
    const list = $('sel-list');
    list.textContent = '';
    for (const g of catalog) {
      const card = document.createElement('button');
      card.className = 'card';
      const ins = document.createElement('div'); ins.className = 'ins'; ins.textContent = g.instruction;
      const name = document.createElement('div'); name.className = 'name'; name.textContent = g.title;
      const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${g.beats}拍${g.author ? '・' + g.author : ''}`;
      card.append(ins, name, meta);
      card.onclick = () => resolve({ game: g, speed: prefs.speed, difficulty: prefs.difficulty });
      list.append(card);
    }
    $('sel-back').onclick = () => resolve(null);
    $('select').classList.remove('hidden');
  });
  $('select').classList.add('hidden');
  if (result) unlockAudio();
  return result;
}

// ---------------------------------------------------------------- 起動
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(err => console.warn('SW registration failed', err));
}

(async () => {
  $('version').textContent = 'v' + self.APP_VERSION;
  registerSounds({ whoosh: 'audio/whoosh.mp3' });
  for (const url of Object.values(HOST_MUSIC)) loadSound(url);
  curtain({ title: 'MadeInWeb', hint: '読み込み中…' });
  let catalog;
  try {
    catalog = await loadCatalog();
    if (DEV_GAME) catalog = catalog.filter(g => g.id === DEV_GAME);
    if (!catalog.length) throw new Error(DEV_GAME ? `ミニゲーム「${DEV_GAME}」が見つかりません` : 'ミニゲームがありません');
    await createFrame();
  } catch (err) {
    curtain({ title: 'エラー', sub: String(err && err.message ? err.message : err), hint: '再読み込みしてください' });
    return;
  }
  for (;;) {
    const mode = await title(catalog);
    if (mode === 'select') {
      // えらんで遊ぶ：練習 → メニューに戻る、を「もどる」まで繰り返す
      for (;;) {
        const pick = await selectScreen(catalog);
        if (!pick) break;
        await runSession([pick.game], { practice: true, speed: pick.speed, difficulty: pick.difficulty });
      }
    } else {
      await runSession(catalog);
    }
  }
})();
