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
import { unlockAudio, play, clock } from './sfx.js';

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

async function createFrame() {
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.className = 'game';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', 'minigame');
  frame.src = `sandbox/sandbox.html?v=${encodeURIComponent(self.APP_VERSION)}`;
  const booted = waitFor(m => m.type === 'boot' || m.type === 'fatal', 15000);
  $('screen').prepend(frame);
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
function curtain({ title = '', main = '', sub = '', hint = '' } = {}) {
  $('c-title').textContent = title;
  $('c-main').textContent = main;
  $('c-sub').textContent = sub;
  $('c-hint').textContent = hint;
  $('curtain').classList.remove('hidden');
}
const hideCurtain = () => $('curtain').classList.add('hidden');
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
function showMark(win) { const el = $('mark'); el.textContent = win ? '○' : '×'; el.className = win ? 'win' : 'lose'; }
const hideMark = () => { $('mark').className = 'hidden'; };
const setTimer = frac => { $('timer-bar').style.transform = `scaleX(${frac})`; };
const showTimer = v => $('timer').classList.toggle('hidden', !v);

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
  const v = encodeURIComponent(self.APP_VERSION);
  lastHeartbeat = performance.now();
  post({
    type: 'load', runId: id,
    url: new URL(`games/${game.id}/main.js?v=${v}`, location.href).href,
    base: new URL(`games/${game.id}/`, location.href).href,
    speed: st.speed, difficulty: st.difficulty, beats: game.beats,
    timeoutResult: game.timeoutResult, seed: (Math.random() * 0x7fffffff) | 0,
  });
  return waitFor(m => m.runId === id && (m.type === 'ready' || m.type === 'error'), 10000)
    .then(m => m.type === 'ready', () => false);
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
  };
  listeners.add(resultL);

  // 拍の音：ふだんは弱いハイハット、最後の4拍はカウント音
  for (let i = 0; i < beats; i++) {
    play(i >= beats - 4 ? 'count' : 'hatSoft', T + i * spb);
    if (i % 2 === 0) play('kick', T + i * spb);
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
async function runSession(catalog) {
  const st = { lives: DEV_GAME ? Infinity : MAX_LIVES, count: 0, speed: DEV_SPEED || 1, difficulty: DEV_DIFF || 1 };
  const spbOf = () => 60 / (BASE_BPM * st.speed);
  const devHint = game => (DEV_GAME ? `DEV: ${game.id}  難易度 ${st.difficulty}  ${Math.round(BASE_BPM * st.speed)}bpm` : '');

  // スタート（4拍）
  let T = clock() + 0.1;
  let spb = spbOf();
  curtain({ title: lifeText(st.lives), main: '0', sub: 'スタート！' });
  play('start', T);
  T = await beatPhase(T, BEATS.start, spb, {
    sounds: i => ['kick', 'hat'],
    onBeat: () => pulse(spb),
  });

  for (;;) {
    // 準備（4拍）：次のミニゲームを読み込みながら、ライフとクリア数を見せる
    const game = nextGame(catalog);
    let speedUp = false;
    if (!DEV_SPEED) {
      const s = Math.min(SPEED_MAX, 1 + SPEED_STEP * Math.floor(st.count / SPEED_EVERY));
      speedUp = s > st.speed;
      st.speed = s;
    }
    if (!DEV_DIFF) st.difficulty = Math.min(3, 1 + Math.floor(st.count / DIFFICULTY_EVERY));
    spb = spbOf();

    post({ type: 'unload' });
    hideMark();
    showTimer(false);
    curtain({ title: lifeText(st.lives), main: String(st.count), sub: speedUp ? 'スピードアップ！' : '', hint: devHint(game) });
    if (speedUp) play('speedup', T);
    const loaded = loadGame(game, st);
    T = await beatPhase(T, BEATS.prepare, spb, {
      sounds: i => (i % 2 === 1 ? ['kick', 'snare'] : ['kick', 'hat']),
      onBeat: () => pulse(spb),
    });

    let r;
    if (await loaded) {
      if (clock() > T + 0.05) T = clock() + 0.05;   // 読み込みが間に合わなかったら、そこから拍を取り直す
      hideCurtain();
      r = await gamePhase(T, game, spb);
      T = r.end;
    } else {
      r = { win: false, crashed: true, loadFailed: true };
      T = clock() + 0.05;
    }

    // 結果（4拍）
    if (r.win) st.count++; else st.lives--;
    play(r.win ? 'ok' : 'ng', T);
    showMark(r.win);
    showTimer(false);
    if (r.loadFailed) showError(`「${game.title}」を読み込めませんでした`);
    T = await beatPhase(T, BEATS.result, spb, { sounds: i => (i === 0 ? [] : ['kick']) });
    if (r.crashed) { await recoverFrame(); T = Math.max(T, clock() + 0.05); }

    if (st.lives <= 0) break;
  }

  post({ type: 'unload' });
  hideMark();
  curtain({ title: 'GAME OVER', main: String(st.count), sub: 'クリアした数', hint: 'タップでタイトルへ' });
  play('gameover');
  await sleep(1000);
  await waitTap();
}

async function title(catalog) {
  curtain({
    title: 'MadeInWeb',
    main: '',
    sub: DEV_GAME ? `DEV: ${DEV_GAME}` : `${catalog.length}本のミニゲーム`,
    hint: 'タップしてスタート',
  });
  await waitTap();
  unlockAudio();
}

// ---------------------------------------------------------------- 起動
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(err => console.warn('SW registration failed', err));
}

(async () => {
  $('version').textContent = 'v' + self.APP_VERSION;
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
    await title(catalog);
    await runSession(catalog);
  }
})();
