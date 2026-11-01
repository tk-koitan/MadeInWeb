// デバッグ表示：ミニゲームの読み込みの進み具合をバーで表示する（?debug / ?game= のとき）
//
// 1行目：経過時間と、準備の4拍が終わるまでの残り（間に合わないと赤）
// 2行目以降：ファイルごとのバー（サイズが分かるものは割合、分からないものは完了まで点滅）
import { clock } from './sfx.js';

let root = null, rows = null, timeline = null;
let state = null, raf = 0, hideTimer = 0;

function ensureDom() {
  if (root) return;
  const style = document.createElement('style');
  style.textContent = `
    #loadbar { position: absolute; left: 2%; right: 2%; top: 5cqh; z-index: 50; pointer-events: none;
      padding: 0.8cqh 1.6cqw; border-radius: 1cqh; background: rgba(0,0,0,0.8); color: #fff;
      font: 1.5cqh/1.35 ui-monospace, Consolas, monospace; transition: opacity 0.3s; }
    #loadbar.off { opacity: 0; }
    #loadbar .lb-row { display: grid; grid-template-columns: 34% 1fr 26%; gap: 1.5cqw; align-items: center; margin-top: 0.4cqh; }
    #loadbar .lb-name, #loadbar .lb-val { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    #loadbar .lb-val { text-align: right; }
    #loadbar .lb-track { position: relative; height: 1cqh; border-radius: 0.5cqh; background: rgba(255,255,255,0.2); overflow: hidden; }
    #loadbar .lb-fill { position: absolute; inset: 0 auto 0 0; width: 0; background: #4fc3f7; }
    #loadbar .lb-row.busy .lb-fill { width: 100%; animation: lb-blink 0.8s ease-in-out infinite alternate; }
    #loadbar .lb-row.ok .lb-fill { width: 100%; background: #66bb6a; animation: none; }
    #loadbar .lb-row.ng .lb-fill { width: 100%; background: #ef5350; animation: none; }
    #loadbar .lb-row.ng { color: #ff8a80; }
    #loadbar .lb-head .lb-fill { background: #ffca28; }
    #loadbar .lb-head.late .lb-fill { background: #ef5350; }
    #loadbar .lb-head.late { color: #ff8a80; }
    @keyframes lb-blink { from { opacity: 0.25; } to { opacity: 0.8; } }`;
  document.head.appendChild(style);
  root = document.createElement('div');
  root.id = 'loadbar';
  root.className = 'off';
  root.innerHTML = '<div class="lb-row lb-head"><span class="lb-name"></span><span class="lb-track"><span class="lb-fill"></span></span><span class="lb-val"></span></div><div class="lb-rows"></div>';
  timeline = root.firstChild;
  rows = root.lastChild;
  (document.getElementById('screen') || document.body).appendChild(root);
}

const mb = n => `${(n / 1e6).toFixed(1)}MB`;

/** 新しいゲームの読み込みを始める。deadline は準備の4拍が終わる時刻（clock の秒） */
export function beginLoad(title, deadline) {
  ensureDom();
  clearTimeout(hideTimer);
  hideTimer = 0;
  rows.textContent = '';
  state = { title, t0: clock(), deadline, items: [], finishedAt: null };
  root.classList.remove('off');
  if (!raf) raf = requestAnimationFrame(render);
}

/** 読み込み項目を1つ追加する。返り値の progress(done, total) / finish(ok, note) で更新する */
export function addItem(name) {
  if (!state) return { progress() {}, finish() {} };
  const s = state;
  const el = document.createElement('div');
  el.className = 'lb-row busy';
  el.innerHTML = '<span class="lb-name"></span><span class="lb-track"><span class="lb-fill"></span></span><span class="lb-val">…</span>';
  el.children[0].textContent = name;
  rows.appendChild(el);
  const it = { el, done: 0, total: 0, status: 'busy', t0: clock(), dirty: true };
  s.items.push(it);
  s.finishedAt = null;
  root.classList.remove('off');
  if (!raf) raf = requestAnimationFrame(render);
  return {
    progress(done, total) { it.done = done; it.total = total || 0; it.dirty = true; },
    finish(ok, note = '') {
      if (it.status !== 'busy') return;
      it.status = ok ? 'ok' : 'ng';
      it.note = note;
      it.t1 = clock();
      it.dirty = true;
    },
  };
}

/** Promise の完了で項目を終える（サイズの分からない読み込み用） */
export function track(name, promise) {
  const it = addItem(name);
  Promise.resolve(promise).then(v => it.finish(v !== false), err => it.finish(false, String(err && err.message || err)));
  return promise;
}

function render() {
  raf = 0;
  const s = state;
  if (!s) return;
  const now = clock();
  const busy = s.items.some(it => it.status === 'busy');
  const end = busy ? now : (s.finishedAt ??= Math.max(s.t0, ...s.items.map(it => it.t1 ?? now)));
  const elapsed = end - s.t0, budget = Math.max(0.01, s.deadline - s.t0);
  const late = end > s.deadline;

  timeline.classList.toggle('late', late);
  timeline.children[0].textContent = s.title;
  timeline.querySelector('.lb-fill').style.width = `${Math.min(100, (elapsed / budget) * 100)}%`;
  timeline.children[2].textContent = `${elapsed.toFixed(2)}s / ${budget.toFixed(2)}s`;

  for (const it of s.items) {
    if (!it.dirty && it.status !== 'busy') continue;
    it.dirty = false;
    const fill = it.el.querySelector('.lb-fill'), val = it.el.children[2];
    const sized = it.total > 0 && it.done <= it.total;
    it.el.className = `lb-row ${it.status === 'busy' && !sized ? 'busy' : it.status === 'busy' ? '' : it.status}`;
    if (it.status === 'busy') {
      fill.style.width = sized ? `${(it.done / it.total) * 100}%` : '';
      val.textContent = sized ? `${mb(it.done)}/${mb(it.total)}` : it.done ? `${mb(it.done)} 受信` : `${(now - it.t0).toFixed(1)}s`;
    } else {
      fill.style.width = '';
      val.textContent = it.status === 'ng' ? '失敗' : `${(it.t1 - it.t0).toFixed(2)}s${it.total ? ' ' + mb(it.total) : ''}`;
      if (it.note) it.el.title = it.note;
    }
  }

  if (busy) { raf = requestAnimationFrame(render); return; }
  // すべて終わったら少し見せてから消す（失敗があれば次の読み込みまで残す）
  if (!s.items.some(it => it.status === 'ng') && !hideTimer) {
    hideTimer = setTimeout(() => { hideTimer = 0; if (state === s) root.classList.add('off'); }, 1500);
  }
}
