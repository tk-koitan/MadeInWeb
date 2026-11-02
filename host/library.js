// マイゲーム：「つくる」画面で読み込んだゲームを、このブラウザ（IndexedDB）に保存して一覧で遊ぶ。
// 一覧には軽い情報（meta）だけを読み、コードと素材（data）は遊ぶときに読む。
import { parseGameInfo, safeAudioPath } from './gameinfo.js';

const $ = id => document.getElementById(id);
const DB_NAME = 'madeinweb', META = 'meta', DATA = 'data';

let dbp = null;
function db() {
  return (dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(META, { keyPath: 'key' });
      r.result.createObjectStore(DATA, { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error || new Error('保存場所を開けません')); };
  }));
}
const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
async function store(names, mode) {
  const t = (await db()).transaction(names, mode);
  const done = new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = t.onabort = () => reject(t.error || new Error('保存できませんでした')); });
  return { t, done };
}

/** 保存したゲームの一覧（新しい順） */
export async function listGames() {
  const { t } = await store([META], 'readonly');
  const all = await req(t.objectStore(META).getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * 保存する。同じタイトル・作者のゲームがあれば上書きする（AI に直してもらった zip を読み込み直したとき）。
 * files は Map（パス → ArrayBuffer）。保存したゲームの key を返す
 */
export async function saveGame({ code, json, files }) {
  let g = {};
  try { g = JSON.parse(json || '{}') || {}; } catch { /* 遊ぶ前のチェックで止まるので、ここでは空として扱う */ }
  const info = parseGameInfo('x', g, () => null);
  const same = (await listGames()).find(m => m.title === info.title && m.author === info.author);
  const key = same ? same.key : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let size = new Blob([code, json]).size;
  for (const d of files.values()) size += d.byteLength;
  const { t, done } = await store([META, DATA], 'readwrite');
  t.objectStore(META).put({ key, title: info.title, author: info.author, instruction: info.instruction, beats: info.beats, json, size, savedAt: Date.now() });
  t.objectStore(DATA).put({ key, code, files: Object.fromEntries(files) });
  await done;
  // 保存したものを、ブラウザが勝手に消さないように頼む（PWA としてホーム画面に置くと認められやすい）
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* 頼めなくても保存はできている */ }
  hydrated.delete(key);
  return key;
}

export async function deleteGame(key) {
  const { t, done } = await store([META, DATA], 'readwrite');
  t.objectStore(META).delete(key);
  t.objectStore(DATA).delete(key);
  await done;
  hydrated.delete(key);
}

/** コードと素材を読む（編集用）。{ code, json, files: Map } */
export async function loadGameData(key) {
  const { t } = await store([META, DATA], 'readonly');
  const [meta, data] = await Promise.all([req(t.objectStore(META).get(key)), req(t.objectStore(DATA).get(key))]);
  if (!meta || !data) throw new Error('保存したゲームが見つかりません');
  return { code: data.code, json: meta.json, files: new Map(Object.entries(data.files || {})) };
}

/** 一覧の1件を、本体の進行で使えるゲームにする（中身は遊ぶ直前に hydrate で読む） */
export function toGame(meta) {
  let g = {};
  try { g = JSON.parse(meta.json || '{}') || {}; } catch { /* 既定の値で遊ぶ */ }
  const game = parseGameInfo(`my-${meta.key}`, g, () => null);
  game.preload = [];
  game.saved = meta.key;
  game.json = g;
  return game;
}

// 中身を読んだゲーム（素材が大きいことがあるので、最近の4本だけ手元に置く）。
// 音声の blob: URL は作り直すと本体の音声キャッシュが増えていくので、ゲームごとに1回だけ作って使い回す
const hydrated = new Map();     // key → { custom, bgmUrl, soundUrls }
const audioUrlCache = new Map(); // 'key/パス' → blob: URL
/** 保存したゲームの中身を読んで、game.custom・音の URL を入れる */
export async function hydrate(game) {
  const key = game.saved;
  let h = hydrated.get(key);
  if (!h) {
    const { code, files } = await loadGameData(key);
    const audioUrl = path => {
      const p = String(path).replace(/^\.\//, '');
      const data = files.get(p);
      if (!data || !safeAudioPath(p)) return null;
      const ck = `${key}/${p}`;
      if (!audioUrlCache.has(ck)) audioUrlCache.set(ck, URL.createObjectURL(new Blob([data])));
      return audioUrlCache.get(ck);
    };
    const info = parseGameInfo(game.id, game.json, audioUrl);
    h = {
      custom: { code, files, images: Object.fromEntries([...files].filter(([p]) => /\.(png|jpe?g|webp)$/i.test(p))) },
      bgmUrl: info.bgmUrl, soundUrls: info.soundUrls, games: new Set(),
    };
    hydrated.set(key, h);
    // 古いものは手放す（そのゲームの game.custom も外して、素材のメモリを空ける。次に遊ぶときに読み直す）
    while (hydrated.size > 4) {
      const oldKey = hydrated.keys().next().value;
      for (const g of hydrated.get(oldKey).games) delete g.custom;
      hydrated.delete(oldKey);
    }
  } else {
    hydrated.delete(key); hydrated.set(key, h);   // 最近使った順に並べ直す
  }
  h.games.add(game);
  game.custom = h.custom;
  game.bgmUrl = h.bgmUrl;
  game.soundUrls = h.soundUrls;
}

// ---------------------------------------------------------------- 一覧の画面
const sizeText = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`);
/**
 * マイゲームの画面。
 * 戻り値：null（もどる）/ { play: game, speed, difficulty } / { random: games } / { edit: key }
 */
export async function libraryScreen({ segment, speeds, diffs, prefs, savePrefs }) {
  let metas = [];
  try { metas = await listGames(); } catch (err) { console.error(err); }
  segment($('lib-speed'), speeds, prefs.speed, v => { prefs.speed = v; savePrefs(prefs); });
  segment($('lib-diff'), diffs, prefs.difficulty, v => { prefs.difficulty = v; savePrefs(prefs); });
  $('lib-random').disabled = !metas.length;
  $('lib-empty').classList.toggle('hidden', metas.length > 0);
  return new Promise(resolve => {
    const close = v => { $('library').classList.add('hidden'); resolve(v); };
    const list = $('lib-list');
    list.textContent = '';
    for (const meta of metas) {
      const card = document.createElement('div');
      card.className = 'card lib-card';
      card.setAttribute('role', 'button');
      const ins = document.createElement('div'); ins.className = 'ins'; ins.textContent = meta.instruction;
      const name = document.createElement('div'); name.className = 'name'; name.textContent = meta.title;
      const info = document.createElement('div'); info.className = 'meta';
      info.textContent = `${meta.beats}拍・${sizeText(meta.size)}${meta.author ? '・' + meta.author : ''}`;
      const row = document.createElement('div'); row.className = 'lib-actions';
      const edit = document.createElement('button'); edit.textContent = '編集';
      const del = document.createElement('button'); del.textContent = '削除'; del.className = 'del';
      row.append(edit, del);
      card.append(ins, name, info, row);
      card.onclick = () => close({ play: toGame(meta), speed: prefs.speed, difficulty: prefs.difficulty });
      edit.onclick = e => { e.stopPropagation(); close({ edit: meta.key }); };
      del.onclick = async e => {
        e.stopPropagation();
        if (!del.classList.contains('sure')) { del.classList.add('sure'); del.textContent = '本当に削除'; return; }
        await deleteGame(meta.key).catch(err => console.error(err));
        card.remove();
        metas = metas.filter(m => m.key !== meta.key);
        $('lib-random').disabled = !metas.length;
        $('lib-empty').classList.toggle('hidden', metas.length > 0);
      };
      list.append(card);
    }
    $('lib-back').onclick = () => close(null);
    $('lib-random').onclick = () => { if (metas.length) close({ random: metas.map(toGame) }); };
    $('library').classList.remove('hidden');
    list.scrollTop = 0;
  });
}
