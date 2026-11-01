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
  "duration": 5,
  "timeoutResult": "lose"
}
```

| 項目 | 内容 |
| --- | --- |
| `instruction` | 開始時に大きく出る指示。短い命令形（「割れ！」「よけろ！」） |
| `duration` | 制限時間（秒、2〜10）。スピードが上がると実時間は短くなる |
| `timeoutResult` | 時間切れのときの結果。達成型は `"lose"`、生き残り型は `"win"` |

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
| `ctx.time` | 開始からの経過秒 |
| `ctx.result` | `null` / `'win'` / `'lose'` |

### 物体を作る（戻り値は Node）

| API | 内容 |
| --- | --- |
| `ctx.background(color)` | 背景色 |
| `ctx.circle({ x, y, r, color })` | 円 |
| `ctx.rect({ x, y, w, h, radius, color })` | 四角（`radius` で角丸） |
| `ctx.text(str, { x, y, size, color, weight, stroke, strokeWidth })` | 文字。`\n` で改行 |
| `ctx.sprite(path, { x, y, w, h })` | 画像。`path` は `assets/foo.png` のようにゲームフォルダからの相対パス |
| `ctx.add3D(object3d, { x, y, r })` | three の 3D オブジェクトを置く。`r` は当たり判定の半径 |

共通オプション：`z`（重なり順、大きいほど手前）、`rotation`、`scale`、`alpha`

### Node のプロパティとメソッド

| API | 内容 |
| --- | --- |
| `x`, `y`, `rotation`（ラジアン、時計回り）, `scale`, `alpha`, `z`, `visible`, `color` | 変更すると即反映 |
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

`ctx.sound.play(id)`：`pop` `hit` `coin` `jump` `tick` `whoosh` `spin`

### 乱数

`ctx.random(a, b)`、`ctx.randInt(a, b)`（両端を含む）、`ctx.pick(array)`。
**`Math.random()` は使わず、こちらを使ってください**（同じシードなら同じ結果になり、テストしやすくなります）。

### 3D（上級者向け）

`ctx.THREE`（three.js r170）、`ctx.scene`、`ctx.camera`（正投影）。サンプル `games/spin3d` を参照。
シーンに直接追加したライトなども、ゲーム終了時に自動で片付けられます。
2D の図形は常に 3D の上に描かれます。

## 禁止事項

- `fetch`、外部 URL、`localStorage`、キーボード入力（サンドボックスで遮断されています）
- `Math.random()`（`ctx.random` を使う）
- 独自の外部ライブラリの読み込み

## テストプレイ

```
npm run dev
```

`http://localhost:5173/?game=<id>` を開くと、そのゲームだけを繰り返し遊べます（ライフ無限、エラーが画面に出ます）。
`&difficulty=3&speed=2` で難易度とスピードを固定できます。
