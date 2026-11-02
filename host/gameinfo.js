// game.json の読み取り。サーバーに置かれたゲーム（host.js）と、「つくる」画面で貼り付けたゲーム（make.js）で共通
export const safeAssetPath = p => typeof p === 'string' && p.length < 200 && /^[\w\-./]+\.(vrm|vrma|glb|gltf|bin|png|jpg|jpeg|webp|json)$/i.test(p) && !p.includes('..') && !p.startsWith('/');
export const safeAudioPath = p => typeof p === 'string' && /^[\w\-./]+\.(mp3|ogg|wav|m4a)$/i.test(p) && !p.includes('..') && !p.startsWith('/');

/**
 * game.json の中身を、本体で使う形に直す。
 * audioUrl(パス) は、音声ファイルのパスを実際に読み込む URL にする関数（ファイルがなければ null を返してよい）
 */
export function parseGameInfo(id, g, audioUrl) {
  g = g && typeof g === 'object' ? g : {};
  return {
    id,
    title: String(g.title || id),
    author: String(g.author || ''),
    instruction: String(g.instruction || '？'),
    beats: Number(g.beats) === 16 ? 16 : 8,
    timeoutResult: g.timeoutResult === 'win' ? 'win' : 'lose',
    camera: g.camera === 'perspective' ? 'perspective' : 'ortho',
    // 先読みするファイル（game.json の "preload"）。ゲームフォルダ内の素材ファイルだけ、最大8個
    preload: (Array.isArray(g.preload) ? g.preload : []).filter(safeAssetPath).slice(0, 8),
    // テスト用（"test": true）は「えらんで遊ぶ」にだけ出す
    test: g.test === true,
    // 音（game.json の "bgm" と "sounds"）。ゲームフォルダ内の音声ファイルだけを受け付ける
    bgmUrl: safeAudioPath(g.bgm) ? audioUrl(g.bgm) : null,
    soundUrls: Object.fromEntries(
      Object.entries(g.sounds && typeof g.sounds === 'object' ? g.sounds : {})
        .filter(([k, v]) => /^[a-z0-9_-]{1,32}$/i.test(k) && safeAudioPath(v))
        .slice(0, 16)
        .map(([k, v]) => [k, audioUrl(v)])
        .filter(([, url]) => url),
    ),
  };
}
