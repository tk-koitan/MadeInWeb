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
