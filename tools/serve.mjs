// 開発用サーバー: npm run dev
// - サンドボックス iframe（別オリジン扱い）からモジュールを読めるように CORS ヘッダーを付ける
// - キャッシュさせない（保存してすぐ反映）
// - 同じ Wi-Fi のスマホからも開けるように、LAN のアドレスでも待ち受ける
import http from 'node:http';
import os from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('forbidden'); return; }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    let body = await readFile(file);
    // 本番用 CSP の配信元を、いま開いているアドレスに置き換える
    if (file.endsWith(join('sandbox', 'sandbox.html'))) {
      body = Buffer.from(body.toString('utf8').replaceAll('https://tk-koitan.github.io', `http://${req.headers.host}`));
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log('MadeInWeb dev server');
  console.log(`  PC:     http://localhost:${port}/`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  スマホ: http://${a.address}:${port}/   （同じ Wi-Fi から）`);
    }
  }
  console.log(`  1本だけ: http://localhost:${port}/?game=balloon&difficulty=1&speed=1`);
});
