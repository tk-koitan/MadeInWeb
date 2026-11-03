// ランタイムが動き出す前に起きたエラー（読み込み失敗・CSP ブロックなど）を本体に伝える。
// runtime.js が起動したら self.__mwBooted が true になり、以降はランタイム側が報告する。
(() => {
  const fatal = message => { if (!self.__mwBooted) parent.postMessage({ type: 'fatal', message: String(message) }, '*'); };
  window.addEventListener('error', e => {
    const t = e.target;
    if (t && t !== window && (t.src || t.href)) fatal(`読み込みに失敗: ${t.src || t.href}`);
    else fatal(e.error && e.error.stack ? e.error.stack : e.message || 'unknown error');
  }, true);
  window.addEventListener('unhandledrejection', e => fatal(e.reason && e.reason.stack ? e.reason.stack : e.reason));
  window.addEventListener('securitypolicyviolation', e => fatal(`CSP でブロック: ${e.blockedURI} (${e.violatedDirective})`));
})();

// WebRTC を消す。CSP の connect-src 'none' は WebRTC の通信（STUN / TURN サーバーへの問い合わせ）を止めないので、
// 残しておくとゲームのコードが外部へデータを送れてしまう（CSP の webrtc 'block' は Chrome では効かない）。
// ゲームのコードより先に消しておけば取り戻す方法はない：入れ子の iframe は別オリジン扱いで中を触れず、
// 中でスクリプトも動かせない（srcdoc は CSP を受け継ぎ、data: / blob: は frame-src 'none'）。Worker も worker-src 'none'。
for (const k of Object.getOwnPropertyNames(window)) {
  if (/^(webkit|moz)?RTC/.test(k)) {
    try { delete window[k]; } catch { /* 消せないときは下で上書きする */ }
    if (k in window) try { Object.defineProperty(window, k, { value: undefined, writable: false, configurable: false }); } catch {}
  }
}
