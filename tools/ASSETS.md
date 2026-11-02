# 素材の生成手順

サンプルの画像は Codex CLI の imagegen スキル（組み込みの image_gen）で生成し、`tools/sprite.mjs` で整えた。

```
codex exec --skip-git-repo-check -s workspace-write -C <作業フォルダ> "<下のプロンプト>" < /dev/null
node tools/sprite.mjs <生成画像.png> games/<id>/assets/<名前>.png --max 256   # 3D テクスチャは --opaque
```

`< /dev/null` を付けないと、裏で実行したときに入力待ちで止まる。

## 使ったプロンプト（2026-11-01）

```text
Use the imagegen skill with the built-in image_gen tool (not the CLI fallback). Make ONE separate image_gen call per asset below (7 calls total), then copy each final PNG into the current working directory with EXACTLY the given filename. Do not create or modify any other files.

Shared style for ALL assets (keep it consistent so they look like one game):
flat cartoon mobile-game sprite, bold dark brown outline (about 3% of the image width), simple cel shading with one soft highlight, clean vector-like shapes, cheerful, no text, no watermark, no drop shadow on the ground, square canvas, subject centered with a small margin.

Transparent assets: genuinely TRANSPARENT background with a real alpha channel (no checkerboard, no backdrop, no white box).

1. balloon.png - one party balloon with a short curly string, drawn in WHITE / very light gray with neutral gray shading only (no color at all; it will be tinted in-game). Transparent background.
2. cloud.png - one fluffy white cloud, slightly wider than tall, light blue-gray shading. Transparent background.
3. player.png - one cute round blob character, sky-blue body, big eyes looking up, small worried smile, tiny feet, front view. Transparent background.
4. rock.png - one chunky falling boulder, warm red-orange-brown stone with a few cracks, roughly square silhouette. Transparent background.
5. golfball.png - one white golf ball with dimples, front view. Transparent background.
6. flag.png - one golf hole flag: thin white pole with a red triangular pennant waving to the right, pole bottom at the bottom center. Transparent background.
7. crate.png - OPAQUE, NOT transparent: a square wooden crate face texture viewed straight-on, filling the entire canvas edge to edge (plank boards with a darker wooden frame border and a diagonal brace), same cartoon outline style. No background visible.

At the end, print the list of files you created with their pixel sizes.
```

## 音声（ComfyUI + Stable Audio 3）

LAN 上の Ubuntu PC（http://192.168.10.116:8188）の ComfyUI で生成する。

```
node tools/comfy-audio.mjs "<英語のプロンプト>" <秒数> <出力.mp3> [--seed N]
```

- ワークフローは ComfyUI 付属テンプレート「Stable Audio 3.0 Medium」の中核部分（8ステップ、lcm、cfg 1）
- 1本 1〜8 秒程度で生成できる（初回はモデルの読み込みで遅い）
- 効果音は短く鋭い音になりやすい。BGM はテンポ指定（例: 120 BPM）がほぼ守られるが、終わりに無音が入ることがある

### サンプルで使った音（2026-11-01、すべて 120 BPM 指定）

| ファイル | 秒 | プロンプト |
| --- | --- | --- |
| audio/start.mp3 | 4（先頭2秒を使用） | Energetic game show start fanfare groove at a steady 120 BPM, four on the floor kick drum, bright brass stabs and snare fills, exciting, continuous, starts immediately on the downbeat（seed 4） |
| audio/prepare.mp3 | 4 | Upbeat funky drum and bass groove, 120 BPM, punchy kick and snare, slap bass, cheerful game show transition music, starts immediately on the downbeat |
| audio/speedup.mp3 | 3 | Fast rising arcade speed-up jingle, quickly ascending synth arpeggio, 120 BPM, exciting, energetic |
| audio/win.mp3 | 3（2秒で鳴り終わる） | One bar victory fanfare at a steady 120 BPM, four on the floor kick drum, bright brass melody over a funky bassline, game show success music, the phrase resolves with a final chord at the end of the bar, starts immediately on the downbeat（seed 11） |
| audio/lose.mp3 | 4（先頭2秒を使用） | Comedic failure groove at a steady 120 BPM, four on the floor kick drum, sad trombone wah wah melody over a bouncy bassline, cartoon game fail music, continuous, starts immediately on the downbeat（seed 6） |
| audio/gameover.mp3 | 5 | Game over jingle, slow descending melody, retro arcade synth, melancholic but cute, ends with a long final note |
| audio/whoosh.mp3 | 1 | Quick swipe whoosh sound effect, fast air swish, short and clean, no music |
| games/balloon/assets/bgm.mp3 | 6 | Bouncy cheerful circus style chiptune, 120 BPM, playful staccato melody, light percussion, party atmosphere, starts immediately |
| games/balloon/assets/pop.mp3 | 1.5 | Cartoon balloon pop sound effect, single sharp rubber burst, short and punchy, clean, no music |
| games/dodge/assets/bgm.mp3 | 6 | Tense action chiptune at a steady 120 BPM, four on the floor kick drum, pulsing bass, suspenseful arcade danger music, starts immediately |
| games/dodge/assets/hit.mp3 | 1.5 | Heavy boulder impact sound effect, cartoon bonk thud, short and punchy, no music |
| games/goal/assets/bgm.mp3 | 6 | Relaxed jazzy lounge groove, 120 BPM, brushed drums, walking upright bass, light piano chords, starts immediately |
| games/goal/assets/cup.mp3 | 1.5 | Golf ball dropping into the cup sound effect, hollow plastic rattle and clunk, short and clean, no music |
| games/spin3d/assets/bgm.mp3 | 12 | Energetic marching band chiptune, 120 BPM, building momentum, carnival feel, snare drum rolls, starts immediately |
| games/spin3d/assets/spin.mp3 | 1 | Wooden crate spinning whoosh with a light wooden creak, short sound effect, no music |
| games/spin3d/assets/clear.mp3 | 1.5 | Bright magical chime success sound effect, sparkle ding, short, no music |

- 「fast」「urgent」などの速さを表す言葉を入れると、120 BPM を指定してもテンポがずれた（約 107 BPM）。「steady 120 BPM, four on the floor」と書くと合った
- ジングルを「short jingle / sting」として頼むと 1〜1.5 秒で終わり、4拍（2秒）の後半が無音になった。「groove at a steady 120 BPM, four on the floor, continuous」として 4 秒で生成し、候補を数本作って 2 秒まで途切れないものを選ぶとよい
- 区間の終わりで曲を切ると、伸びている和音が途切れて聞こえる。「the phrase resolves with a final chord at the end of the bar」と頼み、2秒ちょうどで鳴り終わる候補を選ぶ。再生側でも 0.25 秒重ねてフェードアウトする

## 追加4本の画像（2026-11-01）

```text
Use the imagegen skill with the built-in image_gen tool (not the CLI fallback). Make ONE separate image_gen call per asset below (9 calls total), then copy each final PNG into the current working directory with EXACTLY the given filename. Do not create or modify any other files.

Shared style for ALL assets (keep it consistent so they look like one game):
flat cartoon mobile-game sprite, bold dark brown outline (about 3% of the image width), simple cel shading with one soft highlight, clean vector-like shapes, cheerful, no text, no watermark, no drop shadow on the ground, square canvas, subject centered with a small margin.

All assets: genuinely TRANSPARENT background with a real alpha channel (no checkerboard, no backdrop, no white box).

1. rocket.png - one cute toy rocket standing upright, pointing straight up, red and white body with a round blue window and three fins, no flame.
2. duck.png - one yellow rubber duck floating, side view facing right, orange beak.
3. watermelon.png - one whole round watermelon, green stripes, front view.
4. cat.png - one cute cartoon cat, full body, side view facing right, standing on four legs, tail curving up. Orange tabby.
5. dog.png - one cute cartoon dog, full body, side view facing right, standing on four legs, floppy ears. Light brown.
6. rabbit.png - one cute cartoon rabbit, full body, side view facing right, sitting upright with long tall ears. White and gray.
7. bear.png - one cute cartoon bear, full body, side view facing right, standing on four legs, round ears, chunky body. Brown.
8. pig.png - one cute cartoon pig, full body, side view facing right, standing on four legs, curly tail, snout. Pink.
9. fox.png - one cute cartoon fox, full body, side view facing right, standing on four legs, big fluffy tail. Orange with white tail tip.

The six animals (4-9) must be drawn at the same scale and in the same pose style so their silhouettes can be compared.

At the end, print the list of files you created with their pixel sizes.
```

### 追加4本の音（すべて 120 BPM）

| ファイル | 秒 | プロンプト |
| --- | --- | --- |
| games/rocket/assets/bgm.mp3 | 6 | Exciting rocket countdown chiptune at a steady 120 BPM, four on the floor kick drum, pulsing synth bass, rising arpeggios, building tension, starts immediately on the downbeat（seed 3） |
| games/rocket/assets/pump.mp3 | 1 | Short cartoon air pump puff sound effect, single quick squeeze, no music |
| games/rocket/assets/launch.mp3 | 2.5 | Cartoon rocket launch blast with a rising whoosh, powerful, no music |
| games/slash/assets/bgm.mp3 | 6 | Japanese taiko drum and shamisen groove at a steady 120 BPM, four on the floor kick drum, energetic samurai festival music, starts immediately on the downbeat（seed 3） |
| games/slash/assets/slash.mp3 | 1 | Quick katana sword slash swoosh sound effect, sharp metallic swish, no music |
| games/slash/assets/splat.mp3 | 1.5 | Juicy watermelon smash splat sound effect, wet and crunchy, no music |
| games/count/assets/bgm.mp3 | 12 | Playful bathtime ukulele and marimba groove at a steady 120 BPM, four on the floor kick drum, bouncy and cute, continuous, starts immediately on the downbeat（seed 2） |
| games/count/assets/click.mp3 | 1 | Single soft mechanical dial click tick sound effect, very short, no music |
| games/silhouette/assets/bgm.mp3 | 6 | Curious quiz show groove at a steady 120 BPM, four on the floor kick drum, playful pizzicato strings and light piano, continuous, starts immediately on the downbeat（seed 7） |
| games/silhouette/assets/correct.mp3 | 1.5 | Bright quiz show correct answer ding ding chime, cheerful, no music |
| games/silhouette/assets/wrong.mp3 | 1.5 | Quiz show wrong answer buzzer, short low buzz, comedic, no music |

- 「ticking clock」を入れたクイズ曲はテンポが 82〜127 BPM とばらついた。外すと 5 本とも 119 BPM になった
- 生成できる長さは 1 秒以上（ComfyUI の EmptyLatentAudio の下限）

### 隕石を撃て（3D）の音

| ファイル | 秒 | プロンプト |
| --- | --- | --- |
| games/meteor/assets/bgm.mp3 | 6 | Space shooter synthwave groove at a steady 120 BPM, four on the floor kick drum, driving arpeggiated bass, heroic retro synth lead, continuous, starts immediately on the downbeat（seed 2） |
| games/meteor/assets/boom.mp3 | 1.5 | Retro arcade explosion boom sound effect, short and punchy, crunchy, no music |
| games/meteor/assets/zap.mp3 | 1 | Short sci-fi laser zap sound effect, quick pew, no music |

### 星座なぞりの音

| ファイル | 秒 | プロンプト |
| --- | --- | --- |
| games/stars/assets/bgm.mp3 | 8 | Energetic neon synthwave groove at a steady 120 BPM, four on the floor kick drum, driving bassline, shimmering arpeggios, continuous loop with no fade out, starts immediately on the downbeat（seed 11） |
| games/stars/assets/chime.mp3 | 1 | Single bright sparkling chime note sound effect, magical twinkle, short, no music |
| games/stars/assets/shine.mp3 | 2 | Magical shimmering sparkle sweep sound effect, rising glitter whoosh, celebratory, no music |
| games/stars/assets/fizzle.mp3 | 1 | Soft glass fizzle sound effect, gentle electric spark fading out, short, no music |

- 「dreamy」「warm pads」など穏やかな言葉の曲は 2.5〜4 秒で弱まった。「energetic」「continuous loop with no fade out」で最後まで鳴り続けた

## VRM

- games/pose/assets/avatar.vrm … pixiv の VRM1_Constraint_Twist_Sample（three-vrm のサンプル）。再配布・改変可、クレジット不要。`tools/vrm-slim.mjs` でテクスチャを縮小（10.8MB → 6.05MB）

### ポーズまねの音

| ファイル | 秒 | プロンプト |
| --- | --- | --- |
| games/pose/assets/bgm.mp3 | 12 | Energetic J-pop dance groove at a steady 120 BPM, four on the floor kick drum, funky slap bass, bright synth brass hits, cheerful idol stage music, continuous loop with no fade out, starts immediately on the downbeat（seed 1） |
| games/pose/assets/cue.mp3 | 1 | Short bright cue whistle blip sound effect, single upward chirp, no music |
| games/pose/assets/good.mp3 | 1 | Cheerful sparkle success ding sound effect, short and bright, no music |

### ロボジャンプの音

| ファイル | 秒 | プロンプト |
| --- | --- | --- |
| games/robojump/assets/bgm.mp3 | 6 | Playful robot factory chiptune groove at a steady 120 BPM, four on the floor kick drum, bouncy synth bass, quirky bleeps and metallic percussion, cheerful, continuous loop with no fade out, starts immediately on the downbeat（seed 1） |
| games/robojump/assets/charge.mp3 | 2 | Rising electronic charging power up whine sound effect, robot energy charging（seed 1） |
| games/robojump/assets/jump.mp3 | 1 | Cartoon spring boing jump sound effect, single bouncy boing（seed 2） |
| games/robojump/assets/land.mp3 | 1 | Metallic clank landing sound effect, robot feet landing on steel platform, single hit（seed 1） |
| games/robojump/assets/fall.mp3 | 1 | Cartoon falling whistle sound effect, descending slide whistle（seed 1） |

### ボウリングの音

| ファイル | 秒 | プロンプト |
| --- | --- | --- |
| games/bowling/assets/bgm.mp3 | 10 | Groovy retro bowling alley funk at a steady 120 BPM, four on the floor kick drum, punchy slap bass, wah guitar, bright organ stabs, cheerful, continuous loop with no fade out, starts immediately on the downbeat（seed 1。推定 119 BPM、8.5 秒まで鳴る） |
| games/bowling/assets/roll.mp3 | 2 | Bowling ball rolling down a wooden lane sound effect, low rumbling roll, no music（seed 1） |
| games/bowling/assets/crash.mp3 | 2 | Bowling pins crash sound effect, ball smashing into wooden pins, loud clatter, no music（seed 1） |

### 勝ち負けの声（本体の組み込み。audio/）

game.json の winSound / loseSound で選ぶ。すべて seed 1。

| ファイル | 秒 | プロンプト |
| --- | --- | --- |
| audio/cheer.mp3 | 2 | Big crowd cheering and applauding excitedly, stadium cheer, yay, whistles, short burst, no music |
| audio/yay.mp3 | 2 | Group of happy children shouting yay together, joyful celebration cheer, short, no music |
| audio/fanfare.mp3 | 2 | Short triumphant brass fanfare sting, victory jingle, bright trumpets, one phrase |
| audio/woohoo.mp3 | 1 | Cute cartoon character happy cheer sound effect, high pitched woohoo, short, no music |
| audio/aww.mp3 | 2 | Disappointed crowd groaning aww together, sympathetic sigh, short, no music |
| audio/wahwah.mp3 | 2 | Sad trombone wah wah wah waaah failure sound effect, comedic |
| audio/buzzer.mp3 | 1 | Game show wrong answer buzzer sound effect, harsh low buzz, short |
| audio/ohno.mp3 | 1 | Cartoon character sad whimper sound effect, descending oh no, short, no music |

