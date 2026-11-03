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
| `winSound` / `loseSound` | 任意。勝ち / 負けが決まった瞬間に本体が鳴らす音。組み込みの `cheer`（歓声）`yay`（子どもの「やったー」）`fanfare` `woohoo`（キャラの喜ぶ声）/ `aww`（残念がる声）`wahwah`（残念なラッパ）`buzzer` `ohno`（キャラの悲しむ声）か、`sounds` に書いた名前。省略すると `cheer` / `aww` |
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

### 勝ち負けの演出（かならず入れる）

勝敗が決まった瞬間、本体は音（`winSound` / `loseSound`）を鳴らし、画面の色調を変えます（勝ちは明るく鮮やかに＋光の筋、負けは灰色で暗く）。
ゲーム側でも `ctx.onResult` で、勝ったか負けたかが一目でわかる演出を入れてください。

```js
ctx.onResult(win => {                       // ctx.win / lose のときも、時間切れのときも呼ばれる
  if (win) {
    ctx.background('#fff2b8');              // 背景を明るい色に
    player.image = 'assets/player_happy.png';  // 生き物はうれしい表情に（init で ctx.texture('assets/player_happy.png') しておく）
    ctx.happy([player, label]);             // 拍に合わせて跳ねて喜ぶ
  } else {
    ctx.background('#6f7887');              // 背景を暗い・くすんだ色に
    player.image = 'assets/player_sad.png';
    ctx.sad(player);                        // しょんぼり沈んで、色がくすむ
  }
});
```

- 生き物は表情を変える（喜ぶ / 悲しむ）。物（箱・星など）は `ctx.happy` で踊らせる / `ctx.sad` でうなだれさせる
- 「やった！」「ざんねん…」などの文字を出して `happy` / `sad` を付けるのもよい
- 勝ったら花火・紙吹雪・キラキラなど、負けたら煙・ひび・暗転などを足すと、もっと伝わる
- 勝敗が決まったあとも `update` は呼ばれます。`if (ctx.result) return;` で止めた物は、`happy` / `sad` の動きだけになります

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
| `image` | `sprite` の画像。代入すると差し替わる（例 `player.image = 'assets/player_happy.png'`）。`init` で `ctx.texture(パス)` を呼んでおくと、すぐ切り替わる |
| `draggable = true / 'x' / 'y'` | ドラッグで動かせる（`'x'` は横だけ） |
| `onDrag(fn)`, `onDrop(fn)` | ドラッグ中 / 離したとき |
| `push(dx, dy)` | 勢いをつける（速度 px/秒 を足す）。物理を付けた物体にも使える |
| `remove()` | 消す。`removed` が `true` になる（物理も外れる） |
| `contains(x, y)` | 点が中に入っているか |

### 動き・判定

| API | 内容 |
| --- | --- |
| `ctx.tween(node, { x, y, scale, alpha, rotation }, { duration, ease, delay })` | なめらかに変化。Promise を返す。`ease`: `linear` `in` `out` `inOut` `back` |
| `ctx.after(sec, fn)`, `ctx.every(sec, fn)` | 一定時間後 / 一定間隔で実行（ゲーム内時間） |
| `ctx.onBeat(fn)` | 拍の頭ごとに `fn(拍番号)` を呼ぶ（0拍目から） |
| `ctx.onResult(fn)` | 勝敗が決まった瞬間に `fn(win)` を呼ぶ（時間切れのときも）。勝ち負けの演出に使う |
| `ctx.happy(物, { amp })` | 喜ばせる：拍に合わせて跳ねて揺れる。物は Node か three の物体、その配列。`amp` は跳ねる高さ（Node は px、3D は m） |
| `ctx.sad(物, { amp })` | 落ち込ませる：沈んで傾き、色がくすむ（文字以外） |
| `ctx.overlap(a, b)` | 2つの Node が重なっているか（円・四角） |
| `ctx.distance(a, b)` | 中心間の距離 |

### 物理（ctx.physics）

物体に `ctx.physics.add` を付けると、重力で落ち、ぶつかり、積み重なり、転がるようになります（2D の物理エンジン Box2D）。座標は画面と同じ px のままです。

```js
ctx.physics.walls();                                   // 画面の左・右・下に見えない壁（top: true で上も）
const floor = ctx.rect({ x: 270, y: 900, w: 400, h: 40 });
ctx.physics.add(floor, { static: true });              // 動かない床
const ball = ctx.circle({ x: 270, y: 200, r: 30 });
ctx.physics.add(ball, { bounce: 0.6 });                // 落ちてくるボール
ctx.physics.onHit(ball, floor, ({ speed }) => {        // ぶつかったとき。speed はぶつかった速さ（px/秒）
  if (speed > 300) ctx.sound.play('hit');
});
ball.push(400, -900);                                  // 勢いをつける
ball.draggable = true;                                 // 指でつかんで投げられる（離した瞬間の指の速さで飛ぶ）
```

| API | 内容 |
| --- | --- |
| `ctx.physics.add(node, opts)` | 物理を付ける。形は物体の当たり判定と同じ（円 / 四角。`sprite` は `r` を付けると円）。`opts`：`static`（動かない）, `bounce`（跳ね返り 0〜1、既定 0.2）, `friction`（摩擦 0〜1、既定 0.4）, `density`（重さ、既定 1）, `fixedRotation`（回転しない）, `sensor`（ぶつからず、重なったことだけ `onHit` で知る。ゴールの判定などに）, `bullet`（とても速い物体のすり抜け防止） |
| `ctx.physics.onHit(a, b, fn)` | `a` と `b` がぶつかった瞬間に `fn({ a, b, speed })`。`onHit(a, fn)` なら、`a` が何かにぶつかったとき |
| `ctx.physics.walls(opts)` | 画面の端に見えない壁。`{ top, bottom, left, right, bounce, friction }`。戻り値を `onHit(ball, walls, fn)` に使える |
| `ctx.physics.gravity(x, y)` | 重力（px/秒²）。既定は `(0, 1800)`。`(0, 0)` で無重力 |
| `ctx.physics.remove(node)` | 物理を外す（物体は残る） |

- 物理を付けた物体も、`x` `y` `rotation` `vx` `vy` `vr` を書き換えられます（瞬間移動・速度の変更になります）
- 大きさは `add` したときのものです。あとで `scale` を変えても当たり判定は変わりません
- ゲーム内の時間で動くので、スピードアップすると速くなり、同じ操作なら毎回同じ動きになります
- 物体の数は数十個までを目安にしてください

### 3D の物理（ctx.physics3d）

3D の層（`ctx.scene`）の物体に物理を付けます（cannon-es）。単位はメートル、重力は下向き 9.8m/秒² です。サンプルは `games/bowling`。

```js
const { THREE } = ctx;
ctx.physics3d.ground();                                 // 見えない地面（y = 0）
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({ color: 0x2541b2 }));
ball.position.set(0, 1, 0);
ctx.scene.add(ball);                                    // 物体は ctx.scene の直下に置く
ctx.physics3d.add(ball, { bounce: 0.5 });               // 形は見た目から自動で決まる
ctx.physics3d.add(pin, { shape: 'cylinder', mass: 1.5 });
ctx.physics3d.onHit(ball, pin, ({ speed }) => { … });   // speed はぶつかった速さ（m/秒）
ctx.physics3d.push(ball, 0, 0, -6);                     // 勢いをつける（m/秒）
```

| API | 内容 |
| --- | --- |
| `ctx.physics3d.add(obj, opts)` | 物理を付ける。`shape`：`'auto'`（既定。球・円柱のジオメトリはそのまま、それ以外は見た目を包む箱）/ `'box'` / `'sphere'` / `'cylinder'`。`opts`：`static`, `bounce`（既定 0.3）, `friction`（既定 0.5）, `mass`（kg。既定は大きさから）, `fixedRotation`, `sensor`, `damping`（空気抵抗、既定 0.01） |
| `ctx.physics3d.onHit(a, b, fn)` / `onHit(a, fn)` | ぶつかった瞬間に `fn({ a, b, speed })` |
| `ctx.physics3d.ground({ y, bounce, friction })` | 見えない地面（水平で、下は全部うまっている）。戻り値を `onHit` に使える |
| `ctx.physics3d.push(obj, x, y, z)` / `spin(obj, x, y, z)` | 速度 / 回転の勢いを足す |
| `ctx.physics3d.velocity(obj)` / `stop(obj)` | いまの速度（`THREE.Vector3`）/ 止める |
| `ctx.physics3d.gravity(x, y, z)` / `remove(obj)` | 重力の変更 / 物理を外す（シーンから外した物体は自動で外れる） |

- 物理を付けた物体も、`position` や `rotation` を書き換えると瞬間移動します
- 重心は形の中心です。速い物体（数 m/秒以上）が薄い物をすり抜けるときは、物体を大きくするか遅くしてください
- 3D の物理はドラッグに対応していません。スワイプ（`ctx.input.on('swipe')`）で `push` するなどしてください

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

`ctx.sound.play(id)`：`game.json` の `sounds` に書いた名前、または組み込みの `pop` `hit` `coin` `jump` `tick` `whoosh` `spin`、勝ち負けの声 `cheer` `yay` `fanfare` `woohoo` `aww` `wahwah` `buzzer` `ohno`

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
| `ctx.environment(path, { intensity, background, blur })` | 環境マップ。360° の画像（正距円筒の jpg / webp）で、物体に周りの景色の映り込みと柔らかい光を付ける。`background: true` で背景にも出す（`blur` 0〜1 でぼかす）。`MeshStandardMaterial` / glb の物体に効く |
| `ctx.toneMapping(kind, exposure)` | 写真のような色の出方にする。`kind` は `'aces'` / `'agx'` / `'neutral'`。3D の層だけにかかる |

座標の決まり：three の座標で `(x, -y, z)` が画面の `(x, y)` に対応します（y の符号が逆）。
カメラはどちらの種類でも、**z = 0 の面がちょうど 540×960 の画面に一致**するように置かれています。

- `"camera": "ortho"`（既定）… 遠近感なし。z を変えても大きさは変わらない（サンプル `games/spin3d`）
- `"camera": "perspective"` … 遠近感あり。z がプラス（手前）ほど大きく、マイナス（奥）ほど小さく映る。カメラは z ≒ 1030 の位置から画面中央を見ている（サンプル `games/meteor`）

**リアルな見た目にするには**（サンプル `games/cups`）
- `ctx.environment('assets/room.webp', { background: true, blur: 0.35 })` と `ctx.toneMapping('aces')` を使う。360° の画像は Poly Haven（CC0）の HDRI を 1024×512 に縮めて WebP にしたもの（`tools/ASSETS.md`）
- 影：ライトに `light.castShadow = true`、影を落とす物体に `castShadow = true`、受ける物体（机など）に `receiveShadow = true`。ライトの `shadow.camera` の範囲を、映る範囲に合わせて狭くするときれいになる
- モデルは Blender のスクリプトで作れる（`tools/blender/cups.py`。画面なしで `blender --background --python ...`）
- 影と環境マップはスマホで少し重くなる。影を落とすライトは 1 つ、`shadow.mapSize` は 1024 までを目安にする

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
| `ctx.playVRMAnimation(vrm, anim, { loop })` | アニメーションを再生する（自動で進む）。返り値は `THREE.AnimationAction`。別のアニメーションに切り替えるときは、前の返り値の `stop()` を呼ぶ |

- `game.json` に `"camera": "perspective"` を指定すると立体的に見える（サンプル `games/pose`）
- キャラクターの左腕は画面の右側に見える（カメラと向かい合っているため）
- VRM は大きい（数 MB〜数十 MB）。`node tools/model-slim.mjs <入力.vrm> <出力.vrm> --webp 0.85 --meshopt 14` で軽くしてから使う（テクスチャの縮小・WebP 化と、メッシュの meshopt 圧縮。10MB 前後のモデルが 1〜2MB になる）
- 軽くした VRM は MadeInWeb（three.js）では読めるが、ほかの VRM アプリでは読めないことがある。元のファイルは別に残しておく
- `game.json` に `"preload": ["assets/avatar.vrm"]` と書くと、前のゲームを遊んでいる間にダウンロードしておく（`loadVRM` / `loadVRMAnimation` で読むファイルは必ず書く。最大8個）
- VRM などの大きい素材は、一度読み込むとアプリ（Service Worker）に保存され、2回目からはダウンロードしない。ファイルを差し替えると、次の次に遊ぶときから新しいものになる
- **VRM アニメーション（.vrma）は、人型の glb のアニメーションから作れる**：`node tools/glb-to-vrma.mjs <入力.glb> <出力フォルダ> --tpose <T ポーズのアニメーション名> --clips 名前,名前`。骨の名前が Unreal Engine 形式（`pelvis`, `upperarm_l` …）のもの（例：Quaternius の Universal Animation Library、CC0）に対応。できた .vrma は `node tools/model-slim.mjs <入力.vrma> <出力.vrma> --meshopt 14` で半分〜1/3 ほどに軽くできる（回転の誤差は 0.02° 以下）。サンプルは `games/motion`
- 重さの比較用に `games/vrmtest-full`（元の大きさ）と `games/vrmtest-slim`（`--webp --meshopt` で軽くしたもの）がある。`game.json` に `"test": true` があるゲームは「えらんで遊ぶ」にだけ出る
- **ライセンスを必ず確認する**。VRM の中に利用条件が入っている（`model-slim` が表示する）。再配布が許可されていないモデルは使えない。出典は `assets/CREDIT.txt` に書く。改変した（`model-slim` で軽くした）ときは、改変したことと内容も書く。クレジット表記が必要なモデルは、ゲーム画面にも作者・著作権表示・ライセンス名・無保証であることを出す（例 `games/vrmtest-full`）
- サンドボックスは通信できないので、モデルは本体が代わりに読み込んで渡す（自分のゲームフォルダ内のファイルだけ）

### glTF（.glb の 3D モデル）

```js
async init(ctx) {
  this.robot = await ctx.loadGLB('assets/robot.glb');   // { scene, animations }。ゲーム開始前に読み込みが終わる
  ctx.scene.add(this.robot.scene);
  ctx.playAnimation(this.robot, 'Idle');                 // 入っているアニメーションを名前で再生（ずっと繰り返す）
}
// あとで別のアニメーションに切り替える（0.2 秒かけてなめらかに切り替わる）
ctx.playAnimation(this.robot, 'Jump', { loop: false });
```

| API | 内容 |
| --- | --- |
| `ctx.loadGLB(path)` | glb を読み込む。返り値は `{ scene, animations }` |
| `ctx.playAnimation(target, clip, { loop, fade, timeScale })` | アニメーションを再生する。`target` は `loadGLB` の返り値か three の物体、`clip` は名前か `THREE.AnimationClip`。毎フレーム自動で進み、テンポが上がると速くなる。名前を間違えると、入っているアニメーションの一覧がエラーに出る |

- 読めるのは画像が埋め込まれた `.glb` だけ。`.gltf` + 別ファイルの画像、Draco / KTX2 で圧縮されたものは読めない
- **glb も `node tools/model-slim.mjs <入力.glb> <出力.glb> --webp 0.85 --meshopt 14` で軽くできる**（VRM と同じツール）。テクスチャを縮小・WebP にし、メッシュを meshopt で圧縮する。見た目とアニメーションは変わらない
  - 例：`games/robojump` のロボット 453KB → 271KB。効果が大きいのは、数 MB 以上のモデルやテクスチャの多いモデル
  - meshopt の圧縮は、このツール（`model-slim`）で作ったものだけ読める。ほかのツール（gltfpack など）で圧縮したものは、使っている圧縮の種類によって読めないことがある
  - アニメーションのデータも圧縮する（時刻はそのまま、回転・位置は `--meshopt` の精度で）
- モデルの大きさや向きはモデルごとに違う。`new THREE.Box3().setFromObject(model.scene)` で大きさを測って `scale` をそろえ、`rotation.y` で向きを直す
- 骨で動くモデルは自動で `frustumCulled = false` になる（動いた先で消えないように）
- 表情などの形の変化（モーフ）は `mesh.morphTargetInfluences[mesh.morphTargetDictionary['名前']] = 1` で変える
- `"preload"`、ライセンスの確認、`CREDIT.txt` は VRM と同じ。サンプルは `games/robojump`（CC0 のロボット）

## 禁止事項

- `fetch`、外部 URL、`localStorage`、キーボード入力（サンドボックスで遮断されています）
- `Math.random()`（`ctx.random` を使う）
- 独自の外部ライブラリの読み込み

## 画像素材

- `assets/` に画像を置く（WebP・PNG・JPEG）。画像の読み込みが終わってからゲームが始まる
- **WebP がおすすめ**。透明な部分も使えて、PNG の 2 割ほどの大きさになる（`node tools/webp.mjs <入力.png...>` で変換できる）
- 生成した画像は `node tools/sprite.mjs <入力.png> games/<id>/assets/<名前>.png --max 256` で整える（透過のゴミ取り・余白の切り取り・縮小）。3D のテクスチャは `--opaque` を付ける。そのあと `node tools/webp.mjs games/<id>/assets/<名前>.png` で WebP にする
- 音声は mp3 を推奨。生成した場合は `node tools/comfy-audio.mjs` を使う（`tools/ASSETS.md`）
- 1本あたりの素材は、画像と音声の合計で 1MB 程度までを目安にする

## テストプレイ

### ブラウザだけで試す（「つくる」画面）

タイトルの「つくる」を押すと、`main.js` と `game.json` を貼り付けて、その場で遊べます。開発サーバーはいりません（スマホでも使えます）。

- 「AI への説明をコピー」で、この README と頼み方の文をまとめてコピーできます。AI に貼り付けて、作りたいゲームを書き足してください。AI には、`main.js`・`game.json`・`assets/` を1つの zip にまとめるように頼んでいます
- 「zip を読み込む」で、AI が作った zip をまとめて読み込めます（`main.js` があるフォルダをゲームのフォルダとみなします）。ゲーム一式の zip を読み込むと、前に選んだ素材は入れ替わります
- zip がないときは、`main.js` と `game.json` を貼り付けても遊べます。素材は「ファイルを追加」で選びます（1つずつ選んだファイルは `assets/` に入ります）
- 遊んでいる間に出たエラーは、「◀ メニュー」で戻ったときに一覧で出ます。「エラーを AI 用にコピー」で AI に見せて直してもらえます
- ゲーム一式の zip を読み込むと、自動で「マイゲーム」に保存されます。貼り付けたゲームは「保存」で保存できます。同じタイトル・作者のゲームは上書きされます
- タイトルの「マイゲーム」で、保存したゲームを1本ずつ遊んだり、「ランダムで遊ぶ」で通常モードと同じようにランダムに続けて遊んだりできます。「編集」でつくる画面に読み込めます
- 保存先はこのブラウザの中（IndexedDB）です。別の端末やブラウザとは共有されません。iPhone の Safari では、しばらく開かないと消されることがあるので、ホーム画面に追加して使うのがおすすめです
- 貼り付けた文字はこのブラウザに残ります（保存していない素材ファイルは、ページを開き直したら選び直してください）
- `import` は使えません（1つの `main.js` にまとめる）

### 開発サーバーで試す

```
npm run dev
```

`http://localhost:5173/?game=<id>` を開くと、そのゲームだけを繰り返し遊べます（ライフ無限、エラーが画面に出ます）。
画面上部に読み込みバーも出ます。ミニゲームは、前のゲームの結果（4拍）の間に裏で読み込みが始まり、準備（4拍）が終わるまでに読み終わる必要があります（120bpm で約4秒、最速の 240bpm で約2秒）。1行目はその時間に対する読み込み時間で、間に合わないと赤くなります。大きいファイル（VRM など）は軽くして、`game.json` の `"preload"` に書いてください（前のゲームを遊んでいる間にダウンロードされ、読み込みバーに「（先読み）」と出ます）。
`init` は前のゲームがまだ画面に出ている間に呼ばれることがあります。`init` では準備だけをして、時間で進む処理は `update` / `onBeat` で行ってください。
通常モードでも `?debug` を付けるか、バージョン表示を素早く5回タップすると、エラーと読み込みバーが出ます。
読み込みバーの灰色の行は内訳です（VRM の解析、シェーダー作成、テクスチャ転送、最初の描画など）。どこに時間がかかっているかを見るのに使えます。
`&difficulty=3&speed=2` で難易度とスピードを固定できます。
