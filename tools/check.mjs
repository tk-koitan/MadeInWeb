// ミニゲームのテストプレイ（画面なし）。AI がゲームを作ったあとに、エラー・読み込みの余裕・勝ち負けを確かめる
//
//   npm run check -- <id> [--rounds 2] [--difficulty 1,2,3] [--speed 1] [--no-gpu] [--headed] [--browser <path>]
//
// - games/<id>/ のゲームを、Chrome 系のブラウザ（Chrome → Edge → Chromium の順に探す）を画面なしで動かして遊ぶ。
//   games/index.json に書いていなくてよい。音は出さない
// - 難易度ごとに rounds 回、ランダムなタップとドラッグで遊ぶ（勝てるかどうかはわからない。動くかどうかを見る）
// - games/<id>/ の中身（game.json の書き方・ファイルの大きさ）も確かめる
// - スクリーンショットを .check/<id>/ に保存する（画像を見られる AI なら見た目も確かめられる）
// - 問題があれば終了コード 1
//
// ブラウザは環境変数 CHROME_PATH か --browser でも指定できる。Firefox・Safari には対応していない
// （Chrome DevTools Protocol で操作するため）
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import { join, resolve } from 'node:path';

if (typeof WebSocket === 'undefined') {
  console.log(`Node.js 22 以上が必要です（いまは ${process.version}）`);
  process.exit(2);
}
const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = name => args.includes(`--${name}`);
const WITH_VALUE = ['--rounds', '--difficulty', '--speed', '--browser'];
const id = args.find((a, i) => !a.startsWith('--') && !WITH_VALUE.includes(args[i - 1]));
if (!id) {
  console.log('使い方: npm run check -- <ゲームのフォルダ名> [--rounds 2] [--difficulty 1,2,3] [--speed 1] [--no-gpu] [--headed]');
  process.exit(2);
}
const ROUNDS = Math.max(1, Number(opt('rounds', 2)) || 2);
const DIFFS = String(opt('difficulty', '1,2,3')).split(',').map(Number).filter(d => d >= 1 && d <= 3);
const SPEED = Number(opt('speed', 1)) || 1;
const outDir = join(root, '.check', id);

const problems = [], notes = [];
const kb = n => (n < 1024 ? `${n}B` : `${(n / 1024).toFixed(0)}KB`);

// ---------------------------------------------------------------- ゲームのフォルダを確かめる
const dir = join(root, 'games', id);
if (!/^[\w-]{1,64}$/.test(id) || !existsSync(dir)) {
  console.log(`games/${id}/ がありません`);
  process.exit(2);
}
let info = null;
try { info = JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8')); } catch (err) { problems.push(`game.json を読めません：${err.message}`); }
if (!existsSync(join(dir, 'main.js'))) problems.push('main.js がありません');
if (info) {
  for (const k of ['title', 'instruction', 'beats']) if (info[k] === undefined) problems.push(`game.json に "${k}" がありません`);
  if (info.beats !== undefined && ![8, 16].includes(info.beats)) notes.push(`game.json の "beats" は 8 か 16 が基本です（いまは ${info.beats}）`);
  const listed = [...(info.preload || []), info.bgm, ...Object.values(info.sounds || {})].filter(Boolean);
  for (const p of listed) if (!existsSync(join(dir, p))) problems.push(`game.json に書いた ${p} がありません`);
}
let total = 0;
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory()) walk(p); else total += st.size; } };
walk(dir);
if (total > 3 * 1024 * 1024) problems.push(`ゲーム全体が ${kb(total)} あります（上限 3MB）`);
else if (total > 1024 * 1024) notes.push(`ゲーム全体が ${kb(total)} あります（目安は 1MB まで。画像は WebP、モデルは tools/model-slim.mjs で軽くできます）`);

// ---------------------------------------------------------------- 開発サーバーとブラウザ
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const c = [opt('browser'), process.env.CHROME_PATH];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      c.push(join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Microsoft/Edge/Application/msedge.exe'), join(base, 'Chromium/Application/chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    for (const d of (process.env.PATH || '').split(':')) for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) c.push(join(d, n));
  }
  return c.find(p => p && existsSync(p));
}
const browserPath = findBrowser();
if (!browserPath) {
  console.log('Chrome 系のブラウザ（Chrome・Edge・Chromium）が見つかりません。');
  console.log('入れるか、環境変数 CHROME_PATH にブラウザの実行ファイルの場所を書いてください。');
  console.log('（Linux なら例えば: npx playwright install chromium して、表示された chrome の場所を CHROME_PATH に）');
  process.exit(2);
}

const port = await freePort();
const server = spawn(process.execPath, [join(root, 'tools/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const profile = mkdtempSync(join(os.tmpdir(), 'mw-check-'));
const gpu = flag('no-gpu') ? ['--disable-gpu', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--enable-unsafe-swiftshader', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
const browser = spawn(browserPath, [
  ...(flag('headed') ? [] : ['--headless=new']), '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--window-size=540,960', '--mute-audio', '--autoplay-policy=no-user-gesture-required', ...gpu,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let exiting = false;
const browserExited = new Promise(r => browser.once('exit', r));
/** ブラウザとサーバーを止めて、一時プロファイルを消す（ブラウザが終わるまで待たないと消せない） */
async function cleanup() {
  if (exiting) return;
  exiting = true;
  try { browser.kill(); } catch {}
  try { server.kill(); } catch {}
  await Promise.race([browserExited, sleep(5000)]);
  for (let i = 0; i < 10; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); }
  }
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

// ブラウザが書き出す DevToolsActivePort からデバッグ用の接続先を読む
let wsUrl = null;
for (let i = 0; i < 150 && !wsUrl; i++) {
  try { const [p, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n'); if (p && path) wsUrl = `ws://127.0.0.1:${p.trim()}${path.trim()}`; } catch {}
  if (!wsUrl) await sleep(200);
}
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/version.js`); break; } catch { await sleep(100); } }
if (!wsUrl) { console.log(`ブラウザを起動できませんでした（${browserPath}）`); await cleanup(); process.exit(2); }

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
let seq = 0;
const pending = new Map(), consoleErrors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Runtime.enable');
await S('Page.enable');
await S('Emulation.setDeviceMetricsOverride', { width: 540, height: 960, deviceScaleFactor: 1, mobile: false });
const evaluate = async expr => (await S('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
const mouse = (type, x, y, buttons = 0) => S('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
const tap = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await mouse('mouseReleased', x, y); };
async function drag(x0, y0, x1, y1) {
  await mouse('mousePressed', x0, y0, 1);
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, 1); await sleep(16); }
  await mouse('mouseReleased', x1, y1);
}
const rnd = (a, b) => a + Math.random() * (b - a);
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith('.png')) rmSync(join(outDir, f));
async function shot(name) {
  if (exiting) return;
  try {
    const r = await S('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  } catch { /* 終わりぎわは撮れなくてよい */ }
}

// ---------------------------------------------------------------- 遊ぶ
const results = [];
for (const d of DIFFS) {
  consoleErrors.length = 0;
  await S('Page.navigate', { url: `http://127.0.0.1:${port}/?game=${id}&difficulty=${d}&speed=${SPEED}` });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { await sleep(100); ready = await evaluate(`!!(self.__mwTest && document.getElementById('curtain'))`); }
  await sleep(500);
  await tap(270, 480);                                // 「タップしてスタート」
  const seen = { load: [], end: [], error: [] };
  let n = 0, round = 0, started = false, t0 = Date.now();
  const limit = 25000 * ROUNDS + 15000;
  while (round < ROUNDS && Date.now() - t0 < limit) {
    const log = (await evaluate('JSON.stringify(self.__mwTest ? self.__mwTest.slice(' + n + ') : [])')) || '[]';
    for (const e of JSON.parse(log)) {
      n++;
      if (e.type === 'load') seen.load.push(e);
      if (e.type === 'error') seen.error.push(e.message);
      if (e.type === 'start') {
        started = true;
        const mid = e.beats * e.spb * 500;          // ゲームの真ん中（ミリ秒）
        setTimeout(() => shot(`d${d}-r${round + 1}-mid`), mid);
        setTimeout(() => shot(`d${d}-r${round + 1}-start`), 300);
      }
      if (e.type === 'end') { seen.end.push(e); round++; started = false; setTimeout(() => shot(`d${d}-r${round}-result`), 400); }
    }
    // 遊んでいる間は、ランダムにタップとドラッグをする（ゲームの入力の処理が動くか見る）
    if (started) {
      if (Math.random() < 0.6) await tap(rnd(60, 480), rnd(200, 860));
      else await drag(rnd(60, 480), rnd(250, 850), rnd(60, 480), rnd(250, 850));
    }
    await sleep(started ? rnd(120, 400) : 100);
  }
  await sleep(600);
  const errors = [...new Set([...seen.error, ...consoleErrors])];
  results.push({ d, ...seen, errors, finished: round });
  if (round < ROUNDS) problems.push(`難易度 ${d}：${ROUNDS} 回遊ぶ前に止まりました（${round} 回で時間切れ）`);
}
await cleanup();

// ---------------------------------------------------------------- 結果
console.log(`\nMadeInWeb テストプレイ：${id}（${info ? info.title : '?'}）  ブラウザ: ${browserPath.split(/[\\/]/).pop()}  スピード ${SPEED}`);
console.log(`ゲームの大きさ：${kb(total)}`);
for (const r of results) {
  const margins = r.load.map(l => l.margin);
  const wins = r.end.filter(e => e.win).length, timeouts = r.end.filter(e => e.timeout).length;
  console.log(`\n難易度 ${r.d}：${r.finished} 回遊んだ  勝ち ${wins} / 負け ${r.end.length - wins}（うち時間切れ ${timeouts}）`);
  if (margins.length) console.log(`  読み込みの余裕：${margins.map(m => `${m.toFixed(2)}秒`).join('、')}（120bpm で約4秒、最速で約2秒の中で読み込む。マイナスなら間に合っていない）`);
  if (r.load.some(l => !l.ok)) problems.push(`難易度 ${r.d}：読み込みに失敗しました`);
  if (margins.some(m => m < 0)) problems.push(`難易度 ${r.d}：読み込みが間に合っていません`);
  if (r.end.some(e => e.crashed)) problems.push(`難易度 ${r.d}：ゲームが固まりました（2.5秒以上応答なし）`);
  for (const e of r.errors) { console.log(`  エラー：${e.split('\n').slice(0, 6).join('\n         ')}`); }
  if (r.errors.length) problems.push(`難易度 ${r.d}：エラーが ${r.errors.length} 件`);
}
console.log(`\nスクリーンショット：${join('.check', id)}${os.platform() === 'win32' ? '\\' : '/'}（d<難易度>-r<回>-start / mid / result.png）`);
for (const nt of notes) console.log(`メモ：${nt}`);
if (problems.length) {
  console.log('\n問題：');
  for (const p of problems) console.log(`  - ${p}`);
  console.log('');
  process.exit(1);
}
console.log('\n問題なし\n');
process.exit(0);
