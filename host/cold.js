// デバッグ用：「キャッシュを消す」と、初めて遊ぶ人と同じようにダウンロードし直す。
// - アプリ（Service Worker）に保存したファイル（VRM などの大きい素材も）を消して、再読み込みする
// - 再読み込みのあとは、ファイルごとに最初の1回だけ、ブラウザのキャッシュも使わずにダウンロードする
//   （ダウンロードにかかる時間を、初めての人と同じ条件で確かめられる）
// - マイゲーム（IndexedDB）とデバッグ表示の設定は消さない
const COLD_KEY = 'madeinweb.cold';
let cold = false;
try { cold = sessionStorage.getItem(COLD_KEY) === '1'; sessionStorage.removeItem(COLD_KEY); } catch {}
const fetched = new Set();

/** fetch と同じ。キャッシュを消した直後は、その URL の最初の1回だけキャッシュを使わない */
export function coldFetch(url, init = {}) {
  if (cold && !String(url).startsWith('blob:') && !fetched.has(String(url))) {
    fetched.add(String(url));
    return fetch(url, { ...init, cache: 'reload' });
  }
  return fetch(url, init);
}

/** アプリに保存したファイルを全部消して、再読み込みする */
export async function clearCachesAndReload() {
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('madeinweb')).map(k => caches.delete(k)));
  }
  try { sessionStorage.setItem(COLD_KEY, '1'); } catch {}
  location.reload();
}
