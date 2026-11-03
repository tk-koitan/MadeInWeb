// 「つくる」画面：AI に作ってもらった main.js と game.json を貼り付けて（素材は選んで）、その場で遊ぶ。
// ファイルはサーバーに置かず、本体がサンドボックス（sandbox/make.html）にそのまま渡す。
// 貼り付けた文字は localStorage に残す（素材ファイルはページを開いている間だけ）。
import { parseGameInfo, safeAssetPath, safeAudioPath } from './gameinfo.js';
import { saveGame, loadGameData } from './library.js';

const $ = id => document.getElementById(id);
const STORE_KEY = 'madeinweb.make';
const FILE_MAX = 30 * 1024 * 1024;     // 1ファイルの上限（本体の fetchAsset と同じ）
const TOTAL_MAX = 80 * 1024 * 1024;    // 全部の合計
const TEMPLATE_JSON = `{
  "sdk": "0.1",
  "title": "つくったゲーム",
  "author": "",
  "instruction": "タップ！",
  "beats": 8,
  "timeoutResult": "lose"
}`;
const PROMPT_HEAD = `MadeInWeb（数秒のミニゲームを連続で遊ぶ Web ゲーム）のミニゲームを1本作ってください。
仕様は下の「games/README.md」のとおりです。

- 完成したら main.js・game.json・assets/（素材があるときだけ）を1つの zip ファイルにまとめて、ダウンロードできるようにしてください
  （zip の中身の例：main.js / game.json / assets/player.png）
- zip を作れない場合は、main.js と game.json をそれぞれ1つのコードブロックにまとめて、全文を書いてください
- 直すときも、毎回 zip をまとめて作り直してください
- main.js は import を使わず、README の ctx API だけで作ってください（three.js は ctx.THREE）
- 勝ち負けが決まった瞬間の演出（README の「勝ち負けの演出」）を必ず入れてください。勝ったら明るく楽しく、負けたら一目で失敗とわかるように
- 素材ファイル（画像・音）は、できるだけ使わずに図形・文字・3D で作ってください。使うときは assets/ 以下のファイル名にして、どんな素材が必要か最後に書いてください
- 画像は WebP（.webp）にしてください（PNG より軽い）。zip 全体は 1MB 程度までが目安です
- 作りたいゲーム：（ここに書く）

---- games/README.md ----
`;

let files = new Map();       // 'assets/foo.png' → ArrayBuffer
let audioUrls = new Map();   // 音声ファイルのパス → blob: の URL（ファイルを選び直したら作り直す）
let log = [];                // 遊んでいる間に出たエラーと、遊ぶ前の注意
let readme = null;

/** 遊んでいる間に出たエラーを記録する（host.js から呼ぶ）。画面に戻ったときに一覧で見せる */
export function makeLog(msg) {
  // 書き方の間違いは、ブラウザが行番号を教えてくれないので、ヒントを足す
  if (/^SyntaxError/.test(msg)) msg += '\n（書き方の間違いです。コードが最後まで貼り付けられているか確かめるか、このエラーを AI に見せて直してもらってください）';
  if (log.length < 30 && !log.includes(msg)) log.push(msg);
}

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}
function saveStore(patch) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadStore(), ...patch })); } catch { /* 保存できなくても遊べる */ }
}

/** クリップボードにコピーする。できなかったら、画面の下に文字を出して選んだ状態にする（長押しでコピーしてもらう） */
async function copyText(text) {
  const out = $('mk-out');
  out.classList.add('hidden');
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 下の方法を試す */ }
  out.value = text;
  out.classList.remove('hidden');
  out.focus();
  out.select();
  try { if (document.execCommand('copy')) { out.classList.add('hidden'); return true; } } catch { /* 手でコピーしてもらう */ }
  return false;
}
const COPY_FAILED = '自動でコピーできませんでした。上の枠の文字を全部選んでコピーしてください';

// ---------------------------------------------------------------- zip の展開（無圧縮と deflate だけ）
async function unzip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  let end = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('zip ファイルとして読めません');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip ファイルが壊れています');
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');   // Windows で作った zip は区切りが \ のことがある
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
    const raw = u8.slice(start, start + size);
    let data;
    if (method === 0) data = raw.buffer;
    else if (method === 8) data = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    else throw new Error(`${name}: この zip の圧縮形式には対応していません`);
    out.push([name, data]);
  }
  return out;
}

/** zip の中身を、ゲームフォルダからのパスにそろえる（全部が同じフォルダに入っていたら、そのフォルダを外す） */
function tidyZipPaths(entries) {
  entries = entries.filter(([n]) => !n.startsWith('__MACOSX/') && !n.split('/').some(part => part.startsWith('.')));
  // main.js があるフォルダを、ゲームフォルダとみなす（一番浅いもの）。そのフォルダの外のファイルは使わない
  const mains = entries.map(([n]) => n).filter(n => n === 'main.js' || n.endsWith('/main.js')).sort((a, b) => a.split('/').length - b.split('/').length);
  if (mains.length) {
    const root = mains[0].slice(0, -'main.js'.length);
    return entries.filter(([n]) => n.startsWith(root)).map(([n, d]) => [n.slice(root.length), d]);
  }
  // main.js がない（素材だけの zip）：全部が同じフォルダに入っていたら、そのフォルダを外す
  for (;;) {
    const first = entries.length && entries[0][0].split('/')[0];
    if (!first || !entries.every(([n]) => n.includes('/') && n.split('/')[0] === first)) break;
    entries = entries.map(([n, d]) => [n.slice(first.length + 1), d]);
  }
  return entries;
}

// ---------------------------------------------------------------- ファイルを選んだとき
async function addFiles(list, say) {
  const added = [], skipped = [];
  const put = (path, data) => {
    if (path === 'main.js') { $('mk-code').value = new TextDecoder().decode(data); saveStore({ code: $('mk-code').value }); added.push(path); return; }
    if (path === 'game.json') { $('mk-json').value = new TextDecoder().decode(data); saveStore({ json: $('mk-json').value }); added.push(path); return; }
    if (!safeAssetPath(path) && !safeAudioPath(path)) { skipped.push(path); return; }
    if (data.byteLength > FILE_MAX) { skipped.push(`${path}（大きすぎます）`); return; }
    files.set(path, data);
    added.push(path);
  };
  for (const file of list) {
    const data = await file.arrayBuffer();
    if (/\.zip$/i.test(file.name)) {
      try {
        const entries = tidyZipPaths(await unzip(data));
        // ゲーム一式の zip なら、前に選んだ素材は外して入れ替える（古い素材が残らないように）
        if (entries.some(([p]) => p === 'main.js')) files = new Map();
        for (const [path, d] of entries) {
          if (/^(README|CREDIT|LICENSE)/i.test(path.split('/').pop()) || /\.(md|txt)$/i.test(path)) continue;
          put(path, d);
        }
      } catch (err) { skipped.push(`${file.name}（${err.message}）`); }
    } else if (file.name === 'main.js' || file.name === 'game.json') {
      put(file.name, data);
    } else {
      put(`assets/${file.name}`, data);   // 1つずつ選んだ素材は assets/ に入れる
    }
  }
  let total = 0;
  for (const d of files.values()) total += d.byteLength;
  refreshAudio();
  showFiles();
  if (total > TOTAL_MAX) { say(`素材の合計が大きすぎます（${(total / 1e6).toFixed(0)}MB）。${TOTAL_MAX / 1e6}MB までにしてください`); return false; }
  if (skipped.length) say(`使えないファイルを外しました：\n${skipped.join('\n')}`);
  else if (added.length) say(`${added.length}個のファイルを読み込みました`, true);
  return added.includes('main.js');
}

/** いまの main.js・game.json・素材を、マイゲームに保存する */
async function saveCurrent(say, prefix = '') {
  const r = build($('mk-code').value, $('mk-json').value);
  if (r.error) { say(prefix + r.error); return false; }
  try {
    await saveGame({ code: $('mk-code').value, json: $('mk-json').value, files });
    say(`${prefix}マイゲームに保存しました：${r.game.title}\n（同じタイトルのゲームは上書きされます）`, true);
    return true;
  } catch (err) {
    say(`${prefix}保存できませんでした：${err && err.message ? err.message : err}`);
    return false;
  }
}

/** 保存したゲームを、つくる画面に読み込む（マイゲームの「編集」） */
export async function openInEditor(key) {
  const data = await loadGameData(key);
  $('mk-code').value = data.code;
  $('mk-json').value = data.json;
  saveStore({ code: data.code, json: data.json });
  files = data.files;
  log = [];
  refreshAudio();
}
function refreshAudio() {
  for (const url of audioUrls.values()) URL.revokeObjectURL(url);
  audioUrls = new Map();
  for (const [path, data] of files) if (safeAudioPath(path)) audioUrls.set(path, URL.createObjectURL(new Blob([data])));
}
function showFiles() {
  const size = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`);
  $('mk-files').textContent = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([p, d]) => `${p}  ${size(d.byteLength)}`).join('\n');
}

// ---------------------------------------------------------------- 遊ぶ前のチェック
const norm = p => String(p).replace(/^\.\//, '');
/** 遊べないときは { error }、遊べるときは { game, notes }（notes は注意。遊んだあとで見せる） */
function build(code, jsonText) {
  if (!code.trim()) return { error: 'main.js を貼り付けてください' };
  if (!/export\s+default\b/.test(code)) return { error: 'main.js に export default { init, update } がありません。\nコードの一部だけを貼り付けていないか確かめてください' };
  let g = {};
  if (jsonText.trim()) {
    try { g = JSON.parse(jsonText); } catch (err) { return { error: `game.json の書き方が正しくありません。\n${err.message}` }; }
    if (!g || typeof g !== 'object' || Array.isArray(g)) return { error: 'game.json は { … } の形にしてください' };
  }
  const notes = [];
  const lint = [
    [/\bMath\.random\s*\(/, 'Math.random() は使えません。ctx.random() を使ってください'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket/, '通信（fetch など）はできません'],
    [/\blocalStorage\b|\bsessionStorage\b|indexedDB/, 'localStorage などの保存はできません'],
    [/^\s*import\s[^(]/m, 'import は使えません。three.js は ctx.THREE を使ってください'],
    [/addEventListener\s*\(\s*['"]key/, 'キーボードは使えません。タッチ（ctx.input）で操作してください'],
  ];
  for (const [re, msg] of lint) if (re.test(code)) notes.push(`注意: ${msg}`);
  // コードや game.json に書かれているのに、選ばれていない素材ファイル
  const refs = new Set();
  for (const m of code.matchAll(/['"`]((?:\.\/)?[\w\-./]+\.(?:png|jpe?g|webp|vrma?|glb|mp3|ogg|wav|m4a))['"`]/gi)) refs.add(norm(m[1]));
  for (const p of [g.bgm, ...Object.values(g.sounds && typeof g.sounds === 'object' ? g.sounds : {}), ...(Array.isArray(g.preload) ? g.preload : [])]) {
    if (typeof p === 'string') refs.add(norm(p));
  }
  const missing = [...refs].filter(p => !files.has(p));
  if (missing.length) notes.push(`注意: 素材ファイルが選ばれていません：\n  ${missing.join('\n  ')}`);

  const game = parseGameInfo('__make', g, path => audioUrls.get(norm(path)) || null);
  game.preload = [];
  game.custom = {
    code,
    files,
    images: Object.fromEntries([...files].filter(([p]) => /\.(png|jpe?g|webp)$/i.test(p))),
  };
  return { game, notes };
}

// ---------------------------------------------------------------- 画面
/** つくる画面を出す。「あそぶ」なら { game, speed, difficulty }、「もどる」なら null */
export function makeScreen({ segment, speeds, diffs }) {
  const store = loadStore();
  const code = $('mk-code'), json = $('mk-json'), msg = $('mk-msg');
  if (!code.dataset.ready) {
    code.dataset.ready = '1';
    code.value = typeof store.code === 'string' ? store.code : '';
    json.value = typeof store.json === 'string' ? store.json : TEMPLATE_JSON;
    code.addEventListener('input', () => saveStore({ code: code.value }));
    json.addEventListener('input', () => saveStore({ json: json.value }));
  }
  const say = (text, ok = false) => { msg.textContent = text; msg.classList.toggle('ok', ok); };
  say('');
  $('mk-out').classList.add('hidden');
  const prefs = {
    speed: speeds.some(([v]) => v === store.speed) ? store.speed : 1,
    difficulty: diffs.some(([v]) => v === store.difficulty) ? store.difficulty : 1,
  };
  segment($('mk-speed'), speeds, prefs.speed, v => { prefs.speed = v; saveStore({ speed: v }); });
  segment($('mk-diff'), diffs, prefs.difficulty, v => { prefs.difficulty = v; saveStore({ difficulty: v }); });
  showFiles();

  // 前回のエラー
  $('mk-log-box').classList.toggle('hidden', !log.length);
  $('mk-log').textContent = log.join('\n\n');
  const errors = log.filter(l => !l.startsWith('注意: '));
  $('mk-copylog').classList.toggle('hidden', !errors.length);
  $('mk-copylog').onclick = async () => {
    const text = `MadeInWeb のミニゲームを動かしたら、次のエラーが出ました。直して、もう一度 zip（main.js・game.json・assets/）にまとめてください。zip を作れない場合は、直した main.js の全文をください。\n\n${errors.join('\n\n')}`;
    say((await copyText(text)) ? 'コピーしました。AI に貼り付けてください' : COPY_FAILED, true);
  };

  // AI への説明（README をあらかじめ読んでおく。押したときに読むと、コピーが許可されないブラウザがある）
  if (!readme) {
    fetch('games/README.md', { cache: 'no-cache' }).then(r => (r.ok ? r.text() : null)).then(t => { readme = t; }).catch(() => {});
  }
  $('mk-prompt').onclick = async () => {
    if (!readme) { say('説明を読み込み中です。少し待ってもう一度押してください'); return; }
    say((await copyText(PROMPT_HEAD + readme)) ? 'コピーしました。AI に貼り付けて、作りたいゲームを書き足してください' : COPY_FAILED, true);
  };

  $('mk-file').onchange = async e => {
    const list = [...e.target.files];
    e.target.value = '';
    // ゲーム一式の zip なら、そのままマイゲームに保存する
    if (list.length && await addFiles(list, say)) await saveCurrent(say, '読み込みました。');
  };
  $('mk-save').onclick = () => saveCurrent(say);
  $('mk-clear').onclick = () => { files = new Map(); refreshAudio(); showFiles(); say('素材ファイルを外しました', true); };

  $('make').classList.remove('hidden');
  $('mk-body').scrollTop = 0;
  return new Promise(resolve => {
    const close = value => { $('make').classList.add('hidden'); resolve(value); };
    $('mk-back').onclick = () => close(null);
    $('mk-library').onclick = () => close({ goto: 'library' });
    $('mk-play').onclick = () => {
      const r = build(code.value, json.value);
      if (r.error) { say(r.error); return; }
      log = [...r.notes];
      close({ game: r.game, speed: prefs.speed, difficulty: prefs.difficulty });
    };
  });
}
