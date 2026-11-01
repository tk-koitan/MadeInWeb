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
| audio/start.mp3 | 3 | Short energetic game show start fanfare jingle, 120 BPM, bright brass stabs and snare drum roll, cheerful, ends cleanly on the downbeat |
| audio/prepare.mp3 | 4 | Upbeat funky drum and bass groove, 120 BPM, punchy kick and snare, slap bass, cheerful game show transition music, starts immediately on the downbeat |
| audio/speedup.mp3 | 3 | Fast rising arcade speed-up jingle, quickly ascending synth arpeggio, 120 BPM, exciting, energetic |
| audio/win.mp3 | 2.5 | Short happy success jingle, cheerful ascending xylophone and brass fanfare, cartoon game victory sting |
| audio/lose.mp3 | 2.5 | Short comedic failure jingle, descending sad trombone wah wah wah, cartoon game fail sting |
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
