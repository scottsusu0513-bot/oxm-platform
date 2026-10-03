/*
 * 載入畫面 bootstrap（Batch 3.11：由 index.html 的兩段 inline script 搬出，讓 CSP
 * script-src 不需要 'unsafe-inline'）。
 *
 * 正常情況下 main.tsx 的 AppReadySignal 會在 React 完成首次掛載後呼叫
 * window.__showOxmApp()；下面的 5 秒計時器是萬一 JS 發生例外、React 完全沒有
 * 執行到那一步時的最後防線，避免載入畫面永久卡住。函式內建一次性 guard，
 * 不會重複觸發。
 */
window.__showOxmApp = function () {
  if (window.__oxmAppShown) return;
  window.__oxmAppShown = true;

  var rootElement = document.getElementById("root");
  var loadingElement = document.getElementById("app-loading");

  rootElement && rootElement.classList.add("app-ready");

  requestAnimationFrame(function () {
    loadingElement && loadingElement.classList.add("is-hiding");

    window.setTimeout(function () {
      loadingElement && loadingElement.classList.add("is-hidden");
    }, 200);
  });
};

window.setTimeout(function () {
  window.__showOxmApp && window.__showOxmApp();
}, 5000);
