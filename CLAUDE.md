# MadeInWeb

数秒のミニゲームを連続で遊ぶ Web ゲーム。ミニゲームはユーザーが投稿できる。
GitHub Pages: https://tk-koitan.github.io/MadeInWeb/ （`main` ブランチのルートをそのまま配信。ビルド工程なし）

## 構成

| パス | 役割 |
| --- | --- |
| `index.html`, `host/` | 本体。タイトル・進行・タイマー・効果音。ミニゲームとは postMessage だけで通信 |
| `sandbox/` | 常駐サンドボックス iframe（`sandbox="allow-scripts"`、CSP で通信禁止）と SDK ランタイム |
| `host/library.js` | マイゲーム（つくる画面で読み込んだゲームを IndexedDB に保存・一覧・ランダムで遊ぶ） |
| `host/make.js`, `sandbox/make.html` | 「つくる」画面。貼り付けたコードを遊ぶ。make.html は sandbox.html と同じ CSP に `script-src blob:` を足したもの（通信禁止はそのまま） |
| `games/<id>/` | ミニゲーム。作り方は **`games/README.md`** |
| `vendor/` | three.js r170（`three.module.min.js`）、three-vrm、planck.js 1.5.1（2D 物理。`sandbox/physics.js` が `ctx.physics` にする） |
| `version.js` | バージョン番号。配信するたびに上げる（PWA キャッシュも更新される） |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |
| `tools/serve.mjs` | 開発サーバー（`npm run dev`） |
| `tools/sprite.mjs`, `tools/vrm-slim.mjs`, `tools/comfy-audio.mjs` | 素材づくり（`tools/ASSETS.md`） |

## ミニゲームを作る・直すとき

1. `games/README.md` の API だけを使う。禁止事項を守る
2. `games/index.json` に id を追加する
3. `npm run dev` → `http://localhost:5173/?game=<id>` で確認する

## 注意

- サンドボックスはオリジンを持たない（opaque origin）ので、サンドボックス内のファイルは CORS 付きで配信する必要がある。`python -m http.server` などでは動かない。`npm run dev` を使う
- `sandbox/sandbox.html` の CSP にある `https://tk-koitan.github.io` は、開発サーバーが配信時に置き換える
- 本番の更新を配信するときは `version.js` の番号を上げる
- `sandbox/sandbox.html` の CSP を変えたら `sandbox/make.html` も合わせる
- サンドボックスの CSP（通信禁止）は緩めない。ゲームが大きなファイルを読むときは、本体の `fetchAsset`（自分のゲームフォルダ内だけ）を経由する
- git の作者・push は `tk-koitan` アカウント（このリポジトリのローカル設定済み）。グローバル設定は変えない
