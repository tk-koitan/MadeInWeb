// 本体：タイトル → ミニゲームを連続で遊ぶ → ゲームオーバー
// ミニゲームは常駐サンドボックス iframe の中で動き、ここからは postMessage でだけ操作する。
//
// URL パラメータ（開発用）
//   ?game=balloon        そのミニゲームだけを繰り返す（ライフ無限、エラー表示あり）
//   &difficulty=1..3     難易度を固定
//   &speed=0.5..3        スピードを固定
//   ?debug               通常モードでもエラーを表示
import { unlockAudio, play } from './sfx.js';

const params = new URLSearchParams(location.search);
const DEV_GAME = params.get('game');
const DEV_DIFF = params.has('difficulty') ? clamp(parseInt(params.get('difficulty'), 10) || 1, 1, 3) : null;
const DEV_SPEED = params.has('speed') ? clamp(Number(params.get('speed')) || 1, 0.5, 3) : null;
const SHOW_ERRORS = !!DEV_GAME || params.has('debug');
const MAX_LIVES = 4;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- サンドボックス iframe
let frame = null, lastBeat = 0, runId = 0;
const listeners = new Set();

window.addEventListener('message', e => {
  if (!frame || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  lastBeat = performance.now();
  if (m.type === 'sound') { if (m.runId === runId && typeof m.id === 'string') play(m.id); return; }
  if (m.type === 'error') { console.error('[minigame]', m.message); showError(String(m.message)); }
  for (const l of [...listeners]) l(m);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastBeat = performance.now(); });

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
  lastBeat = performance.now();
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
        duration: clamp(Number(g.duration) || 5, 2, 10),
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
const lifeText = l => (l === Infinity ? '∞' : '●'.repeat(l) + '○'.repeat(MAX_LIVES - l));

function showInstruction(text, speed) {
  const el = $('instruction');
  el.textContent = text;
  el.style.animationDuration = `${1.3 / speed}s`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
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

// ---------------------------------------------------------------- 1本を遊ぶ
async function loadGame(game, st) {
  const id = ++runId;
  const v = encodeURIComponent(self.APP_VERSION);
  lastBeat = performance.now();
  post({
    type: 'load', runId: id,
    url: new URL(`games/${game.id}/main.js?v=${v}`, location.href).href,
    base: new URL(`games/${game.id}/`, location.href).href,
    speed: st.speed, difficulty: st.difficulty, duration: game.duration,
    timeoutResult: game.timeoutResult, seed: (Math.random() * 0x7fffffff) | 0,
  });
  try {
    const m = await waitFor(m => m.runId === id && (m.type === 'ready' || m.type === 'error'), 8000);
    return m.type === 'ready';
  } catch {
    return false;
  }
}

async function playGame(game, st) {
  const id = runId;
  const realDur = game.duration / st.speed;
  showInstruction(game.instruction, st.speed);
  setTimer(1);
  showTimer(true);
  lastBeat = performance.now();
  post({ type: 'start', runId: id });
  const resultP = waitFor(m => m.runId === id && (m.type === 'result' || m.type === 'error'), realDur * 1000 + 5000).catch(() => null);
  const t0 = performance.now();
  let timeupSent = false;
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    resultP.then(m => { if (m) finish({ win: m.type === 'result' && m.win === true, early: !timeupSent }); });
    (function tick() {
      if (done) return;
      const now = performance.now(), el = (now - t0) / 1000;
      setTimer(Math.max(0, 1 - el / realDur));
      if (now - lastBeat > 3000 && !document.hidden) { finish({ win: false, crashed: true }); return; }
      if (el >= realDur && !timeupSent) {
        timeupSent = true;
        post({ type: 'timeup', runId: id });
        setTimeout(() => finish({ win: game.timeoutResult === 'win' }), 1500);
      }
      requestAnimationFrame(tick);
    })();
  });
}

// ---------------------------------------------------------------- 通しで遊ぶ
async function runSession(catalog) {
  const st = { lives: DEV_GAME ? Infinity : MAX_LIVES, count: 0, speed: DEV_SPEED || 1, difficulty: DEV_DIFF || 1 };
  let prev = '';
  while (st.lives > 0) {
    const game = nextGame(catalog);
    let speedUp = false;
    if (!DEV_SPEED) {
      const s = Math.min(2.2, 1 + 0.15 * Math.floor(st.count / 4));
      speedUp = s > st.speed;
      st.speed = s;
    }
    if (!DEV_DIFF) st.difficulty = Math.min(3, 1 + Math.floor(st.count / 8));

    post({ type: 'unload' });
    curtain({
      title: lifeText(st.lives),
      main: String(st.count),
      sub: speedUp ? 'スピードアップ！' : prev,
      hint: DEV_GAME ? `DEV: ${game.id}  難易度 ${st.difficulty}  速度 ×${st.speed.toFixed(2)}` : '',
    });
    if (speedUp) play('speedup');
    const loadP = loadGame(game, st);
    await sleep((speedUp ? 1800 : 1100) / Math.sqrt(st.speed));
    if (!(await loadP)) {
      st.lives--;
      prev = `× 読み込みに失敗（${game.title}）`;
      play('ng');
      await recoverFrame();
      continue;
    }

    hideCurtain();
    const r = await playGame(game, st);
    play(r.win ? 'ok' : 'ng');
    showMark(r.win);
    await sleep(800 / Math.sqrt(st.speed));
    hideMark();
    showTimer(false);
    if (r.crashed) await recoverFrame();
    if (r.win) { st.count++; prev = '○ クリア！'; }
    else { st.lives--; prev = r.crashed ? '× 応答なし' : '× ミス…'; }
  }
  post({ type: 'unload' });
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
  play('start');
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
