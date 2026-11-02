// Service Worker: オフラインでも起動できるようにする。
// 方針はネットワーク優先。オンラインなら常に最新を取得し、オフラインのときだけキャッシュを使う。
// ただし VRM などの大きい素材だけはキャッシュ優先（下の bigAsset）。
importScripts('./version.js');

const CACHE = `madeinweb-${self.APP_VERSION}`;
const CORE = [
  './',
  './index.html',
  './host/host.js',
  './host/sfx.js',
  './host/fx.js',
  './host/loadbar.js',
  './host/gameinfo.js',
  './host/make.js',
  './host/library.js',
  './version.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('madeinweb-') && k !== CACHE && k !== ASSET_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 大きい素材（VRM など）は別のキャッシュに入れて、2回目からはすぐ返す（バージョンを上げても消さない）。
// 返したあとで、ファイルが更新されていないかをヘッダーだけで確かめ、変わっていれば取り直す（次に遊ぶときに反映）。
// 開発サーバー（localhost）では、差し替えたファイルがすぐ反映されるようにキャッシュしない
const ASSET_CACHE = 'madeinweb-assets';
const BIG_ASSET = /\/games\/[\w-]+\/.+\.(vrm|vrma|glb|bin)$/i;
const IS_DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);
const stamp = res => res.headers.get('etag') || res.headers.get('last-modified') || '';
async function bigAsset(event, req) {
  const cache = await caches.open(ASSET_CACHE);
  const download = async () => {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok && stamp(res)) await cache.put(req, res.clone());
    return res;
  };
  const hit = await cache.match(req);
  if (!hit) return download();
  event.waitUntil((async () => {
    const head = await fetch(req, { method: 'HEAD', cache: 'no-cache' });
    if (head.ok && stamp(head) !== stamp(hit)) await download();
  })().catch(() => {}));
  // 保存済みから返したことを本体に知らせる（デバッグ表示で「保存済み」と出る）
  const headers = new Headers(hit.headers);
  headers.set('x-madeinweb-cache', 'hit');
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!IS_DEV && BIG_ASSET.test(url.pathname)) { event.respondWith(bigAsset(event, req)); return; }
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
