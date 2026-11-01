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
