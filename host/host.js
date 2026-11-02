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
//   ?debug               通常モードでもエラーと読み込みバーを表示
//                        （スマホではバージョン表示を5回タップでも切り替えられる）
import { flash, shake, crack, confetti, clearFx } from './fx.js';
import { unlockAudio, play, clock, playMusic, loadSound, registerSounds, setGameSounds } from './sfx.js';
import { beginLoad, addItem, addTiming, track } from './loadbar.js';
import { safeAssetPath, parseGameInfo } from './gameinfo.js';
import { makeScreen, makeLog, openInEditor } from './make.js';
import { libraryScreen, hydrate } from './library.js';

const params = new URLSearchParams(location.search);
const DEV_GAME = params.get('game');
const DEV_DIFF = params.has('difficulty') ? clamp(parseInt(params.get('difficulty'), 10) || 1, 1, 3) : null;
const DEV_SPEED = params.has('speed') ? clamp(Number(params.get('speed')) || 1, 0.5, 3) : null;
const DEBUG_KEY = 'madeinweb.debug';
const storedDebug = () => { try { return localStorage.getItem(DEBUG_KEY) === '1'; } catch { return false; } };
let DEBUG = !!DEV_GAME || params.has('debug') || storedDebug();

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
let frame = null, framePage = 'sandbox.html', lastHeartbeat = 0, runId = 0, activeRunId = 0;   // runId は最後に読み込んだゲーム、activeRunId は遊んでいるゲーム
const listeners = new Set();
let makeMode = false;    // 「つくる」画面から遊んでいる（エラーを必ず出して、画面に戻ったときに一覧を見せる）

window.addEventListener('message', e => {
  if (!frame || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  lastHeartbeat = performance.now();
  // 効果音は画面に出ているゲームのものだけ鳴らす（裏で読み込み中のゲームのものは鳴らさない）
  if (m.type === 'sound') { if (m.runId === activeRunId && typeof m.id === 'string') play(m.id); return; }
  if (m.type === 'fetchAsset') { sendAsset(m); return; }
  if (m.type === 'loadinfo') { if (DEBUG && m.runId === runId) addTiming(String(m.label).slice(0, 60), Number(m.ms) || 0); return; }
  if (m.type === 'error') {
    // 貼り付けたコードは blob: の URL で動いているので、エラーの場所を main.js:行:列 に書き直す
    // （本体側の行 sandbox/… は、ゲームを作る人には関係ないので外す）
    const text = makeMode
      ? String(m.message).replace(/blob:[^\s)]*?:(\d+):(\d+)/g, 'main.js:$1:$2').split('\n').filter(l => !/\/(sandbox|vendor)\//.test(l)).join('\n')
      : String(m.message);
    console.error('[minigame]', text);
    showError(text);
    if (makeMode) makeLog(text);
  }
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
let currentGameId = null;
let currentCustom = null;   // 「つくる」画面のゲームなら、そのファイル一覧（Map パス → ArrayBuffer）
/** レスポンスを読み切る。bar があれば受け取ったバイト数を伝える（上限を超えたら途中でやめる） */
async function readBody(r, bar) {
  const length = Number(r.headers.get('content-length')) || 0;
  if (length > ASSET_MAX_BYTES) throw new Error(`ファイルが大きすぎます（${(length / 1e6).toFixed(1)}MB）`);
  // 圧縮して配信されたとき（GitHub Pages は gzip）は、content-length が圧縮後の大きさなので割合は出せない
  const total = r.headers.get('content-encoding') ? 0 : length;
  if (!bar || !r.body || !r.body.getReader) return r.arrayBuffer();
  const reader = r.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (got > ASSET_MAX_BYTES) { reader.cancel(); throw new Error('ファイルが大きすぎます'); }
    bar.progress(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out.buffer;
}
async function fetchAssetData(gameId, path, bar) {
  const r = await fetch(`games/${gameId}/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const data = await readBody(r, bar);
  if (data.byteLength > ASSET_MAX_BYTES) throw new Error(`${path} が大きすぎます（${(data.byteLength / 1e6).toFixed(1)}MB）`);
  if (r.headers.get('x-madeinweb-cache') === 'hit') fromSavedCache.add(data);   // アプリに保存済みのものだった（sw.js）
  return data;
}
const fromSavedCache = new WeakSet();

// ---- 先読み：いまのゲームを遊んでいる間に、次のゲームのファイルをダウンロードだけしておく。
// 組み立て（main.js の実行や VRM の解析）は重くて遊んでいるゲームがカクつくので、結果の4拍になってから行う。
// 先読みするのは game.json の "preload" と、前回そのゲームが fetchAsset で頼んだファイル
const prefetched = new Map();         // 'ゲームID/パス' → Promise<ArrayBuffer>（使ったら消す）
const requestedAssets = new Map();    // ゲームID → Set(パス)
function prefetchGame(game) {
  // 「つくる」・マイゲーム：中身（保存場所から読む）と音だけ用意する
  const sounds = () => { for (const url of [game.bgmUrl, ...Object.values(game.soundUrls)].filter(Boolean)) loadSound(url).catch(() => {}); };
  if (game.saved) { hydrate(game).then(sounds).catch(() => {}); return; }
  if (game.custom) { sounds(); return; }
  for (const key of [...prefetched.keys()]) if (!key.startsWith(`${game.id}/`)) prefetched.delete(key);
  const paths = new Set([...game.preload, ...(requestedAssets.get(game.id) || [])]);
  for (const path of paths) {
    const key = `${game.id}/${path}`;
    if (prefetched.has(key)) continue;
    const p = fetchAssetData(game.id, path, null);
    p.catch(() => { if (prefetched.get(key) === p) prefetched.delete(key); });   // 失敗したら、頼まれたときに取り直す
    prefetched.set(key, p);
  }
  for (const url of [game.bgmUrl, ...Object.values(game.soundUrls)].filter(Boolean)) loadSound(url).catch(() => {});
}

async function sendAsset(m) {
  let bar = null;
  const reply = (extra, transfer = []) => frame && frame.contentWindow && frame.contentWindow.postMessage({ type: 'asset', reqId: m.reqId, ...extra }, '*', transfer);
  try {
    if (m.runId !== runId || !currentGameId) throw new Error('いまのゲームからの依頼ではありません');
    if (!safeAssetPath(m.path)) throw new Error(`読み込めないファイル名です: ${m.path}`);
    if (!requestedAssets.has(currentGameId)) requestedAssets.set(currentGameId, new Set());
    const asked = requestedAssets.get(currentGameId);
    if (asked.size < 8) asked.add(m.path);
    const key = `${currentGameId}/${m.path}`;
    const early = prefetched.get(key);
    prefetched.delete(key);                      // 渡すとサンドボックスのものになるので、手元からは消す
    bar = DEBUG ? addItem(early ? `${m.path}（先読み）` : m.path) : null;
    let data = early ? await early.catch(() => null) : null;
    if (currentCustom) {
      // 「つくる」画面のゲーム：選んだファイルの中から渡す（渡すと手元から消えるので、写しを渡す）
      const file = currentCustom.get(m.path.replace(/^\.\//, ''));
      if (!file) throw new Error(`${m.path} がありません（素材ファイルとして選んでください）`);
      data = file.slice(0);
    }
    if (!data) data = await fetchAssetData(currentGameId, m.path, bar);
    if (bar) {
      const tags = [early && '先読み', fromSavedCache.has(data) && '保存済み'].filter(Boolean);
      bar.rename(tags.length ? `${m.path}（${tags.join('・')}）` : m.path);
      bar.progress(data.byteLength, data.byteLength);
      bar.finish(true);
    }
    reply({ ok: true, data }, [data]);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    if (bar) bar.finish(false, message);
    reply({ ok: false, error: message });
  }
}

/** サンドボックスを作り直す。page は 'sandbox.html'（ふつう）か 'make.html'（「つくる」画面。貼り付けたコードを動かせる） */
async function createFrame(page = framePage) {
  framePage = page;
  if (frame) frame.remove();
  frame = document.createElement('iframe');
  frame.className = 'game';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', 'minigame');
  frame.src = `sandbox/${page}?v=${encodeURIComponent(self.APP_VERSION)}`;
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
async function recoverFrame(page) {
  try { await createFrame(page); } catch (err) { console.error(err); }
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
      list.push(parseGameInfo(id, g, path => `games/${id}/${path}`));
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
  if (!DEBUG && !makeMode) return;
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
function loadGame(game, st, deadline) {
  const id = ++runId;
  currentGameId = game.id;
  currentCustom = null;
  const v = encodeURIComponent(self.APP_VERSION);
  lastHeartbeat = performance.now();
  // マイゲームは、保存場所からコードと素材を読んでから渡す
  const prep = game.saved ? hydrate(game) : Promise.resolve();
  const ready = prep.then(() => {
    if (id !== runId) return false;               // 読んでいる間に、別のゲームの読み込みが始まった
    currentCustom = game.custom ? game.custom.files : null;
    post({
      type: 'load', runId: id,
      // 「つくる」画面・マイゲームは、コードと画像をそのまま渡す（サンドボックスの中で blob: にして読む）
      ...(game.custom ? { code: game.custom.code, files: game.custom.images }
        : { url: new URL(`games/${game.id}/main.js?v=${v}`, location.href).href }),
      base: new URL(`games/${game.id}/`, location.href).href,
      speed: st.speed, difficulty: st.difficulty, beats: game.beats,
      timeoutResult: game.timeoutResult, camera: game.camera, seed: (Math.random() * 0x7fffffff) | 0,
    });
    return waitFor(m => m.runId === id && (m.type === 'ready' || m.type === 'error'), 20000)
      .then(m => m.type === 'ready', () => false);
  }, err => {
    const text = `「${game.title}」を保存場所から読めません：${err && err.message ? err.message : err}`;
    showError(text);
    if (makeMode) makeLog(text);
    return false;
  });
  if (DEBUG) {
    beginLoad(game.title, deadline);
    track('main.js + init()', ready);
  }
  const audio = prep.then(() => {
    const audioUrls = [game.bgmUrl, ...Object.values(game.soundUrls)].filter(Boolean);
    return Promise.all(audioUrls.map(u => (DEBUG ? track(u.split('/').pop(), loadSound(u)) : loadSound(u))));
  }).catch(() => {});
  return Promise.all([ready, audio]).then(([ok]) => ok);
}

/** ミニゲームの区間。拍数ぶん遊ばせて、結果を返す（途中で決まっても最後まで続ける） */
async function gamePhase(T, game, spb, id) {
  activeRunId = id;
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
      if (activeRunId !== id) return;
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

  // 次のミニゲームを決めて、裏で読み込み始める（スピードと難易度もここで決まる）。
  // サンドボックスは、本体が 'show' を送るまで前のゲームを表示し続けるので、結果の4拍の間から読み込める。
  // deadlineOf(新しい1拍の秒数) は、準備が終わる予定の時刻（読み込みバーの目安）
  let next = null;
  let upcoming = null;    // 遊んでいる間に決めておく次のゲーム（ファイルを先読みする）
  const preload = deadlineOf => {
    const game = upcoming || nextGame(catalog);
    upcoming = null;
    let speedUp = false;
    if (!fixedSpeed) {
      const s = Math.min(SPEED_MAX, 1 + SPEED_STEP * Math.floor(st.count / SPEED_EVERY));
      speedUp = s > st.speed;
      st.speed = s;
    }
    if (!fixedDiff) st.difficulty = Math.min(3, 1 + Math.floor(st.count / DIFFICULTY_EVERY));
    const loaded = loadGame(game, st, deadlineOf(spbOf()));
    next = { game, speedUp, loaded, id: runId };
  };

  // スタート（4拍）。この間に1本目を読み込む
  let T = clock() + 0.1;
  let spb = spbOf();
  curtain({ title: lifeText(st.lives), main: '0', sub: 'スタート！', bpm: `${Math.round(BASE_BPM * st.speed)} BPM` });
  { const t0 = T, spb0 = spb; preload(spbN => t0 + BEATS.start * spb0 + BEATS.prepare * spbN); }
  const startMusic = music('start', T, BEATS.start, spb);
  if (!startMusic) play('start', T);
  T = await beatPhase(T, BEATS.start, spb, {
    sounds: () => (startMusic ? [] : ['kick', 'hat']),
    onBeat: () => pulse(spb),
  });

  let fromGame = false;   // 直前がミニゲーム画面なら、準備画面を下からスワイプで出す
  for (;;) {
    // 準備（4拍）：次のミニゲームの読み込みを待ちながら、ライフとクリア数を見せる
    if (quit) break;
    if (!next) { const t0 = T; preload(spbN => t0 + BEATS.prepare * spbN); }   // 先読みしていない（最初・復旧後）
    const cur = next;
    next = null;
    const { game, speedUp } = cur;
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
    post({ type: 'show', runId: cur.id });         // 幕で隠れたので、裏で読み込んだゲームに入れ替える

    // ミニゲームの1拍目でスワイプを始める（ゲームはスワイプしながら始まる）
    await waitUntil(prepEnd);
    if (quit) break;
    let r;
    if (await cur.loaded) {
      let gameStart = prepEnd;
      if (clock() > prepEnd + 0.03) gameStart = clock();   // 読み込みが間に合わなかったら、そこから拍を取り直す
      play('whoosh');
      swipeToGame(dur);
      // 次のゲームを決めて、遊んでいる間にファイルだけダウンロードしておく
      upcoming = nextGame(catalog);
      prefetchGame(upcoming);
      r = await gamePhase(gameStart, game, spb, cur.id);
      T = r.end;
    } else {
      r = { win: false, crashed: true, loadFailed: true };
      swipeToGame(dur);
      T = Math.max(prepEnd, clock()) + dur;
      await waitUntil(T);
    }

    // 結果（4拍）。この間に次のゲームを裏で読み込み始める（落ちた後は、作り直してから読み込む）
    if (r.win) st.count++; else st.lives--;
    if (!r.crashed && st.lives > 0 && !quit) {
      const t0 = T, spb0 = spb;
      preload(spbN => t0 + BEATS.result * spb0 + BEATS.prepare * spbN);
    }
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
    $('btn-make').onclick = () => resolve('make');
    $('btn-library').onclick = () => resolve('library');
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
      const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${g.beats}拍${g.author ? '・' + g.author : ''}${g.test ? '・テスト' : ''}`;
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

// ---- つくる・マイゲーム
// 貼り付けたゲームや保存したゲームは、blob: のスクリプトを動かせるサンドボックス（make.html）で遊ぶ
async function playCustom(games, opts) {
  unlockAudio();
  makeMode = true;
  try {
    if (framePage !== 'make.html') await createFrame('make.html');
    await runSession(games, opts);
  } catch (err) {
    makeLog(String(err && err.message ? err.message : err));
  } finally {
    makeMode = false;
  }
}
/** つくる画面とマイゲーム画面を行き来する。どちらかで「もどる」とタイトルへ（編集から来たつくる画面はマイゲームへ） */
async function myGames(first) {
  const speeds = SPEED_CHOICES.map(v => [v, String(Math.round(BASE_BPM * v))]);
  const diffs = DIFF_LABELS.map((l, i) => [i + 1, l]);
  let screen = first, cameFromLibrary = false;
  for (;;) {
    $('error').classList.add('hidden');
    if (screen === 'make') {
      const r = await makeScreen({ segment, speeds, diffs });
      if (!r) { if (cameFromLibrary) { screen = 'library'; cameFromLibrary = false; continue; } break; }
      if (r.goto) { screen = r.goto; cameFromLibrary = false; continue; }
      await playCustom([r.game], { practice: true, speed: r.speed, difficulty: r.difficulty });
    } else {
      const prefs = loadPrefs();
      const r = await libraryScreen({ segment, speeds, diffs, prefs, savePrefs });
      if (!r) break;
      if (r.edit) {
        try { await openInEditor(r.edit); } catch (err) { showError(String(err && err.message ? err.message : err)); continue; }
        screen = 'make'; cameFromLibrary = true;
        continue;
      }
      if (r.random) await playCustom(r.random, {});
      else await playCustom([r.play], { practice: true, speed: r.speed, difficulty: r.difficulty });
    }
  }
  if (framePage !== 'sandbox.html') await recoverFrame('sandbox.html');
}

// ---------------------------------------------------------------- 起動
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(err => console.warn('SW registration failed', err));
}

(async () => {
  const showVersion = () => { $('version').textContent = 'v' + self.APP_VERSION + (DEBUG ? ' DEBUG' : ''); };
  showVersion();
  // バージョン表示を素早く5回タップすると、デバッグ表示を切り替える（スマホの PWA 用）
  let taps = [];
  $('version').addEventListener('pointerdown', e => {
    e.stopPropagation();
    const now = performance.now();
    taps = [...taps.filter(t => now - t < 2000), now];
    if (taps.length < 5) return;
    taps = [];
    DEBUG = !DEBUG;
    try { localStorage.setItem(DEBUG_KEY, DEBUG ? '1' : '0'); } catch {}
    showVersion();
  });
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
  const playable = DEV_GAME ? catalog : catalog.filter(g => !g.test);   // 通常モードで遊ぶゲーム
  for (;;) {
    const mode = await title(playable);
    if (mode === 'select') {
      // えらんで遊ぶ：練習 → メニューに戻る、を「もどる」まで繰り返す
      for (;;) {
        const pick = await selectScreen(catalog);
        if (!pick) break;
        await runSession([pick.game], { practice: true, speed: pick.speed, difficulty: pick.difficulty });
      }
    } else if (mode === 'make' || mode === 'library') {
      await myGames(mode);
    } else {
      await runSession(playable);
    }
  }
})();
