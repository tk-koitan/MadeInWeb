# ミニゲームの作り方（SDK 0.1）

1本のミニゲームは `games/<id>/` フォルダ1つで完結します。

```
games/<id>/
├─ game.json   メタ情報
├─ main.js     ゲーム本体（export default { init, update }）
└─ assets/     画像など（任意）
```

作ったら `games/index.json` の配列に `<id>` を追加します。

## game.json

```json
{
  "sdk": "0.1",
  "title": "風船わり",
  "author": "koitan",
  "instruction": "割れ！",
  "beats": 8,
  "timeoutResult": "lose"
}
```

| 項目 | 内容 |
| --- | --- |
| `instruction` | 開始時に大きく出る指示。短い命令形（「割れ！」「よけろ！」） |
| `beats` | 長さ（拍）。`8` か `16`。テンポは最初 120bpm（1拍0.5秒）で、スピードアップすると速くなる |
| `timeoutResult` | 時間切れのときの結果。達成型は `"lose"`、生き残り型は `"win"` |
| `camera` | 任意。`"perspective"` にすると 3D の層が遠近感のあるカメラになる（省略時は `"ortho"`＝遠近感なし） |
| `bgm` | 任意。ミニゲーム中に流す曲（例 `"assets/bgm.mp3"`）。**120 BPM** で作り、拍数ぶんの長さ以上にする。テンポが上がると速く再生される |
| `sounds` | 任意。効果音の一覧（例 `{ "pop": "assets/pop.mp3" }`）。`ctx.sound.play("pop")` で鳴る。組み込みの音と同じ名前なら上書きする |

## main.js

```js
export default {
  init(ctx) {
    // 物体を作る。this に状態を置いてよい（毎回まっさらな状態で読み込まれる）
  },
  update(dt, ctx) {
    // 毎フレーム呼ばれる。dt は秒（スピード倍率込み）
  },
};
```

- 勝ったら `ctx.win()`、負けたら `ctx.lose()`。最初の1回だけが有効です
- 結果が出たあとも、本体が次へ進むまで少しの間 `update` は呼ばれ続けます。`if (ctx.result) return;` で止めます
- 制限時間の管理は本体が行います。ゲーム側でタイマーを持つ必要はありません
- 途中で勝敗が決まっても、ミニゲームは決められた拍数の最後まで表示されます。その後、本体が ○／× を出します

## 進行（本体が管理）

```
スタート(4拍) → 準備(4拍) → ミニゲーム(8 or 16拍) → 結果(4拍) → 準備(4拍) → …
```

ゲーム内の時間は常に 120bpm 基準です（1拍 = 0.5秒、8拍 = 4秒）。スピードアップすると `dt` に倍率が掛かるので、ゲーム側は気にせず作れます。

## 画面

- 縦 9:16、論理解像度 **540×960**。左上が (0, 0)、y は下向き
- 物体の位置 `x, y` はその物体の中心
- 操作はタッチ（PC ではマウス）だけ。キーボードは使えません

## ctx API

### 情報

| API | 内容 |
| --- | --- |
| `ctx.W`, `ctx.H` | 540, 960 |
| `ctx.difficulty` | 難易度 1〜3。数や速さを変えるのに使う |
| `ctx.speed` | スピード倍率（参考。dt に掛け済み） |
| `ctx.beats` | このミニゲームの長さ（8 か 16） |
| `ctx.duration` | 長さ（ゲーム内の秒）。`beats × 0.5` |
| `ctx.time` | 開始からの経過秒（ゲーム内時間） |
| `ctx.beat` | 開始からの拍数（小数）。リズムに合わせた動きに使う |
| `ctx.bpm` | 実際のテンポ（参考） |
| `ctx.result` | `null` / `'win'` / `'lose'` |

### 物体を作る（戻り値は Node）

| API | 内容 |
| --- | --- |
| `ctx.background(color)` | 背景色 |
| `ctx.circle({ x, y, r, color })` | 円 |
| `ctx.rect({ x, y, w, h, radius, color })` | 四角（`radius` で角丸） |
| `ctx.text(str, { x, y, size, color, weight, stroke, strokeWidth })` | 文字。`\n` で改行 |
| `ctx.sprite(path, { x, y, w, h, fit, color, r })` | 画像。`fit` を付けると縦横比を保ったまま `fit`×`fit` の枠に収まる。`path` は `assets/foo.png` のようにゲームフォルダからの相対パス。`w` か `h` の片方だけなら縦横比を保つ。`color` で色を掛ける（白い画像を好きな色に染められる）。`r` を付けると当たり判定が半径 `r` の円になる |
| `ctx.texture(path)` | 3D 用のテクスチャ（`THREE.Texture`）を読み込む |
| `ctx.add3D(object3d, { x, y, r })` | three の 3D オブジェクトを置く。`r` は当たり判定の半径 |

共通オプション：`z`（重なり順、大きいほど手前）、`rotation`、`scale`、`alpha`

### Node のプロパティとメソッド

| API | 内容 |
| --- | --- |
| `x`, `y`, `rotation`（ラジアン、時計回り）, `scale`, `alpha`, `z`, `visible`, `color`, `flipX`（左右反転） | 変更すると即反映 |
| `vx`, `vy`, `vr` | 速度（px/秒、ラジアン/秒）。毎フレーム自動で移動する |
| `text` | 文字の Node だけ。代入で書き換え |
| `onTap(fn)` | 指が触れた瞬間に呼ばれる。重なっていたら一番手前だけ |
| `draggable = true / 'x' / 'y'` | ドラッグで動かせる（`'x'` は横だけ） |
| `onDrag(fn)`, `onDrop(fn)` | ドラッグ中 / 離したとき |
| `remove()` | 消す。`removed` が `true` になる |
| `contains(x, y)` | 点が中に入っているか |

### 動き・判定

| API | 内容 |
| --- | --- |
| `ctx.tween(node, { x, y, scale, alpha, rotation }, { duration, ease, delay })` | なめらかに変化。Promise を返す。`ease`: `linear` `in` `out` `inOut` `back` |
| `ctx.after(sec, fn)`, `ctx.every(sec, fn)` | 一定時間後 / 一定間隔で実行（ゲーム内時間） |
| `ctx.onBeat(fn)` | 拍の頭ごとに `fn(拍番号)` を呼ぶ（0拍目から） |
| `ctx.overlap(a, b)` | 2つの Node が重なっているか（円・四角） |
| `ctx.distance(a, b)` | 中心間の距離 |

### 入力（画面全体）

```js
ctx.input.on('tap', e => {});    // 短く触れて離した { x, y }
ctx.input.on('down', e => {});   // 触れた { x, y }
ctx.input.on('move', e => {});   // 触れたまま動かした { x, y, dx, dy }
ctx.input.on('up', e => {});     // 離した { x, y }
ctx.input.on('swipe', e => {});  // 素早くはらった { dx, dy, dir: 'left'|'right'|'up'|'down' }
ctx.input.x; ctx.input.y; ctx.input.down;
```

### 音

`ctx.sound.play(id)`：`game.json` の `sounds` に書いた名前、または組み込みの `pop` `hit` `coin` `jump` `tick` `whoosh` `spin`

### 乱数

`ctx.random(a, b)`、`ctx.randInt(a, b)`（両端を含む）、`ctx.pick(array)`。
**`Math.random()` は使わず、こちらを使ってください**（同じシードなら同じ結果になり、テストしやすくなります）。

### 3D（上級者向け）

画面は **3D の層** と、その上に重なる **2D の層** の2枚でできています。
`circle` `rect` `text` `sprite` は 2D の層、`add3D` と `ctx.scene` に追加したものは 3D の層に描かれます（2D は常に 3D の上）。

| API | 内容 |
| --- | --- |
| `ctx.THREE` | three.js r170 |
| `ctx.scene` | 3D の層のシーン。ライトや自作のメッシュを直接追加してよい（終了時に自動で片付く） |
| `ctx.camera3D` | 3D の層のカメラ。位置・向き・画角を変えてよい（ゲームごとに作り直される） |
| `ctx.add3D(obj, { x, y, r })` | 3D の物体を、画面座標で奥行き z = 0 の面に置く。返り値は Node |
| `ctx.pick3D(x, y)` | 画面の (x, y) にある、いちばん手前の 3D の物体を返す（`add3D` したものなら Node） |
| `ctx.toScreen(obj)` | 3D の物体が画面のどこに映るか `{ x, y, visible }` |

座標の決まり：three の座標で `(x, -y, z)` が画面の `(x, y)` に対応します（y の符号が逆）。
カメラはどちらの種類でも、**z = 0 の面がちょうど 540×960 の画面に一致**するように置かれています。

- `"camera": "ortho"`（既定）… 遠近感なし。z を変えても大きさは変わらない（サンプル `games/spin3d`）
- `"camera": "perspective"` … 遠近感あり。z がプラス（手前）ほど大きく、マイナス（奥）ほど小さく映る。カメラは z ≒ 1030 の位置から画面中央を見ている（サンプル `games/meteor`）

### ポストエフェクト（ブルームなど）

```js
const bloom = ctx.bloom({ strength: 1.1, radius: 0.55, threshold: 0.9 });   // 3D の層にブルームをかける
const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.6, 0.6) }); // 1 より明るい色が光る
ctx.tween(bloom, { strength: 2 }, { duration: 0.3 });                          // 光を強める演出
```

| API | 内容 |
| --- | --- |
| `ctx.bloom({ strength, radius, threshold, layers })` | ブルームをかける。返り値（UnrealBloomPass）の値は後から変えてよい |
| `ctx.addPass(pass, { layers })` | 任意のパスを追加する（`ctx.FX.ShaderPass` など） |
| `layers` | `'3d'`（既定）＝ 3D の層だけ。文字や UI はくっきり残る。`'all'` ＝ 2D の層も含めて画面全体 |

- 光らせたいものは 3D の層に置く（`ctx.add3D` か `ctx.scene.add`）。色の値を 1 より大きくするか、`threshold` を下げる
- 使わないゲームには影響しない。使うゲームはスマホで少し重くなるので、1つのゲームでパスは 1〜2 個までを目安にする
- サンプル：`games/stars`

### VRM（人型アバター）

```js
async init(ctx) {
  this.vrm = await ctx.loadVRM('assets/avatar.vrm');    // ゲーム開始前に読み込みが終わる
  ctx.scene.add(this.vrm.scene);                         // 単位はメートル。+Z（カメラ側）を向いて立つ
  ctx.camera3D.position.set(0, 1.0, 2.8);                // カメラをキャラクターに向け直す
  ctx.camera3D.lookAt(0, 0.92, 0);
  this.vrm.humanoid.getNormalizedBoneNode('leftUpperArm').rotation.z = -1.2;   // 腕を下ろす（T ポーズが基準）
  this.vrm.expressionManager.setValue('happy', 1);                            // 表情
}
```

| API | 内容 |
| --- | --- |
| `ctx.loadVRM(path)` | VRM（0.x / 1.0）を読み込む。揺れもの・表情・視線は毎フレーム自動で更新される |
| `ctx.loadVRMAnimation(path)` | VRM アニメーション（.vrma）を読み込む |
| `ctx.playVRMAnimation(vrm, anim, { loop })` | アニメーションを再生する（自動で進む） |

- `game.json` に `"camera": "perspective"` を指定すると立体的に見える（サンプル `games/pose`）
- キャラクターの左腕は画面の右側に見える（カメラと向かい合っているため）
- VRM は大きい（数 MB〜数十 MB）。`node tools/vrm-slim.mjs <入力.vrm> <出力.vrm>` でテクスチャを縮めてから使う
- `game.json` に `"preload": ["assets/avatar.vrm"]` と書くと、前のゲームを遊んでいる間にダウンロードしておく（`loadVRM` / `loadVRMAnimation` で読むファイルは必ず書く。最大8個）
- VRM などの大きい素材は、一度読み込むとアプリ（Service Worker）に保存され、2回目からはダウンロードしない。ファイルを差し替えると、次の次に遊ぶときから新しいものになる
- `vrm-slim` で小さくなるのはテクスチャだけ。ポリゴンや表情の形のデータが大きいモデル（例: Seed-san）はあまり小さくならない
- 重さの比較用に `games/vrmtest-full`（元の大きさ）と `games/vrmtest-slim`（縮小）がある。`game.json` に `"test": true` があるゲームは「えらんで遊ぶ」にだけ出る
- **ライセンスを必ず確認する**。VRM の中に利用条件が入っている（`vrm-slim` が表示する）。再配布が許可されていないモデルは使えない。出典は `assets/CREDIT.txt` に書く
- サンドボックスは通信できないので、モデルは本体が代わりに読み込んで渡す（自分のゲームフォルダ内のファイルだけ）

## 禁止事項

- `fetch`、外部 URL、`localStorage`、キーボード入力（サンドボックスで遮断されています）
- `Math.random()`（`ctx.random` を使う）
- 独自の外部ライブラリの読み込み

## 画像素材

- `assets/` に PNG を置く。画像の読み込みが終わってからゲームが始まる
- 生成した画像は `node tools/sprite.mjs <入力.png> games/<id>/assets/<名前>.png --max 256` で整える（透過のゴミ取り・余白の切り取り・縮小）。3D のテクスチャは `--opaque` を付ける
- 音声は mp3 を推奨。生成した場合は `node tools/comfy-audio.mjs` を使う（`tools/ASSETS.md`）
- 1本あたりの素材は、画像と音声の合計で 1MB 程度までを目安にする

## テストプレイ

```
npm run dev
```

`http://localhost:5173/?game=<id>` を開くと、そのゲームだけを繰り返し遊べます（ライフ無限、エラーが画面に出ます）。
画面上部に読み込みバーも出ます。ミニゲームは、前のゲームの結果（4拍）の間に裏で読み込みが始まり、準備（4拍）が終わるまでに読み終わる必要があります（120bpm で約4秒、最速の 240bpm で約2秒）。1行目はその時間に対する読み込み時間で、間に合わないと赤くなります。大きいファイル（VRM など）は軽くして、`game.json` の `"preload"` に書いてください（前のゲームを遊んでいる間にダウンロードされ、読み込みバーに「（先読み）」と出ます）。
`init` は前のゲームがまだ画面に出ている間に呼ばれることがあります。`init` では準備だけをして、時間で進む処理は `update` / `onBeat` で行ってください。
通常モードでも `?debug` を付けるか、バージョン表示を素早く5回タップすると、エラーと読み込みバーが出ます。
`&difficulty=3&speed=2` で難易度とスピードを固定できます。
