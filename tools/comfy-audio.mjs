// LAN 上の ComfyUI（Stable Audio 3）で効果音・BGM を生成してダウンロードする
//
//   node tools/comfy-audio.mjs "<英語のプロンプト>" <秒数> <出力.mp3> [--seed 123] [--host http://192.168.10.116:8188]
//
// ワークフローは ComfyUI 付属テンプレート「Stable Audio 3.0 Medium」の中核部分
// （Qwen によるプロンプト拡張は使わず、プロンプトをそのまま渡す）。
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i];
  else pos.push(args[i]);
}
const [text, secondsArg, outFile] = pos;
if (!text || !secondsArg || !outFile) {
  console.error('usage: node tools/comfy-audio.mjs "<prompt>" <seconds> <out.mp3> [--seed N] [--host URL]');
  process.exit(1);
}
const HOST = flags.host || process.env.COMFY_HOST || 'http://192.168.10.116:8188';
const seconds = Number(secondsArg);
const seed = flags.seed ? Number(flags.seed) : Math.floor(Math.random() * 2 ** 48);

const workflow = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'stable_audio_3_medium.safetensors' } },
  2: { class_type: 'CLIPLoader', inputs: { clip_name: 't5gemma_b_b_ul2.safetensors', type: 'stable_audio', device: 'default' } },
  3: { class_type: 'CLIPTextEncode', inputs: { text, clip: ['2', 0] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  5: { class_type: 'EmptyLatentAudio', inputs: { seconds, batch_size: 1 } },
  6: {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0],
      seed, steps: 8, cfg: 1, sampler_name: 'lcm', scheduler: 'simple', denoise: 1,
    },
  },
  7: { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
  8: { class_type: 'SaveAudioMP3', inputs: { audio: ['7', 0], filename_prefix: 'madeinweb/audio', quality: '128k' } },
};

const t0 = Date.now();
const res = await fetch(`${HOST}/prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: workflow, client_id: 'madeinweb' }),
});
const queued = await res.json();
if (!res.ok || !queued.prompt_id) {
  console.error('ComfyUI がワークフローを受け付けませんでした:', JSON.stringify(queued, null, 2));
  process.exit(1);
}

let entry;
for (;;) {
  await new Promise(r => setTimeout(r, 1000));
  const h = await (await fetch(`${HOST}/history/${queued.prompt_id}`)).json();
  entry = h[queued.prompt_id];
  if (!entry) continue;
  if (entry.status && entry.status.status_str === 'error') {
    console.error('生成に失敗しました:', JSON.stringify(entry.status.messages, null, 2).slice(0, 3000));
    process.exit(1);
  }
  if (entry.outputs && entry.outputs[8]) break;
}
const file = entry.outputs[8].audio[0];
const url = `${HOST}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder)}&type=${file.type}`;
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
writeFileSync(outFile, buf);
console.log(`${outFile}  ${seconds}s  seed=${seed}  ${(buf.length / 1024).toFixed(1)} KB  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
