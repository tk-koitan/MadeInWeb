// PNG / JPEG を WebP に変換する（変換は手元の Chrome に任せる。外部ライブラリなし）
//
//   node tools/webp.mjs <入力.png...> [--quality 0.85] [--out <フォルダ>]
//
// - 出力は入力と同じ場所（--out があればそのフォルダ）に、拡張子を .webp にして書く
// - 透明な部分はそのまま残る
// - --quality は 0〜1（既定 0.85）。1 にすると劣化なし（lossless）
// - Chrome の場所は環境変数 CHROME で変えられる
// - ほかのスクリプトからは toWebP([{ data, type }], quality) で使える（tools/vrm-slim.mjs の --webp）
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, basename, dirname, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 画像（PNG / JPEG のバイト列）をまとめて WebP にする。
 * items: [{ data: Buffer, type?: 'image/png' | 'image/jpeg', quality?: 0〜1 }] → Buffer の配列（同じ順）
 */
export async function toWebP(items, quality = 0.85) {
  const chrome = process.env.CHROME || (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), 'webp-'));
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 100 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
    }
    const page = targets && targets.find(t => t.type === 'page');
    if (!page) throw new Error('Chrome を起動できませんでした（環境変数 CHROME で場所を指定できます）');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    const evaluate = expression => new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, m => m.result && m.result.exceptionDetails ? reject(new Error(m.result.exceptionDetails.exception?.description || 'error')) : resolve(m.result.result.value));
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    const out = [];
    for (const { data, type = 'image/png', quality: q = quality } of items) {
      const b64 = await evaluate(`(async () => {
        const bin = Uint8Array.from(atob(${JSON.stringify(Buffer.from(data).toString('base64'))}), c => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bin], { type: ${JSON.stringify(type)} }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        c.getContext('2d').drawImage(bmp, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/webp', quality: ${Number(q)} });
        if (blob.type !== 'image/webp') throw new Error('この Chrome は WebP を書き出せません');
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      })()`);
      out.push(Buffer.from(b64, 'base64'));
    }
    ws.close();
    return out;
  } finally {
    proc.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

// コマンドとして実行されたとき
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let quality = 0.85, outDir = null;
  const inputs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--quality') quality = Number(args[++i]);
    else if (args[i] === '--out') outDir = args[++i];
    else inputs.push(args[i]);
  }
  if (!inputs.length) { console.error('使い方: node tools/webp.mjs <入力.png...> [--quality 0.85] [--out フォルダ]'); process.exit(1); }
  const results = await toWebP(inputs.map(f => ({ data: readFileSync(f), type: /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png' })), quality);
  inputs.forEach((file, i) => {
    const out = join(outDir || dirname(file), basename(file, extname(file)) + '.webp');
    writeFileSync(out, results[i]);
    const a = statSync(file).size, b = results[i].length;
    console.log(`${basename(file)} ${(a / 1024).toFixed(0)}KB -> ${basename(out)} ${(b / 1024).toFixed(0)}KB (${Math.round(b / a * 100)}%)`);
  });
}
