// GEO 第二階段 B：把 build-time 產生的靜態正文片段（scripts/prerender-about.ts
// 產出，見 dist/prerendered/about.html）注入 index.html 的 <div id="root">，
// 讓搜尋引擎不執行 JavaScript 也能直接讀到 /about 的主要正文。
//
// 只做輕量字串處理，不在 request time 執行 renderToString／renderToStaticMarkup。
// 檔案內容在啟動後第一次用到時讀一次、快取在記憶體，之後每個 request 只重複
// 使用同一份字串（呼應第二階段 A 的 index.html 模板快取原則）。
//
// client 端不會對這份內容做 hydrateRoot——main.tsx 一律用 createRoot，等同於
// React 掛載時完全清空並重新渲染 <div id="root">，因此這裡的靜態內容只在
// JS 執行前的極短暫時間可見，不會有 hydration mismatch 風險。data-oxm-prerendered
// 屬性單純作為標記／除錯用途保留。
import fs from "fs";
import path from "path";

const ROOT_DIV_RE = /<div\s+id="root"\s*>\s*<\/div>/i;

// production 的 server 是 esbuild 把 server/_core/index.ts 打包成單一
// dist/index.js，此時 import.meta.dirname 就是 dist/ 本身，dist/prerendered/
// 就在同一層；development（tsx 直接執行原始檔）與跑測試（vitest 直接 import
// 這支模組）時 import.meta.dirname 都是未打包的 server/_core/，得往上兩層
// 到專案根目錄才找得到 dist/prerendered/。
//
// 這裡刻意不靠 process.env.NODE_ENV 判斷（試過，不可靠：vitest 底下
// NODE_ENV 不一定是 "development"，也不會是實際 production 的值，用它當
// 判斷依據在測試環境會选到錯的分支，已實際重現過這個 bug）。改成直接依序
// 嘗試兩個候選路徑，用 fs.existsSync 選出真正存在的那一個，不論實際用什麼
// 方式啟動都能正確解析。
function resolvePrerenderedFile(filename: string): string {
  const candidates = [
    path.resolve(import.meta.dirname, "prerendered", filename), // bundled: dist/prerendered/*
    path.resolve(import.meta.dirname, "..", "..", "dist", "prerendered", filename), // unbundled: server/_core -> project root -> dist/prerendered/*
  ];
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
}

const PRERENDERED_PAGES: Record<string, string> = {
  "/about": resolvePrerenderedFile("about.html"),
};

const cache = new Map<string, string | null>();

function normalizePathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function readPrerenderedFragment(pathname: string): string | null {
  const normalized = normalizePathname(pathname) || "/";
  const filePath = PRERENDERED_PAGES[normalized];
  if (!filePath) return null;

  if (cache.has(normalized)) return cache.get(normalized) ?? null;

  let content: string | null = null;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(
      `[prerenderedBody] failed to read prerendered fragment for ${normalized} at ${filePath}:`,
      err instanceof Error ? err.message : String(err)
    );
    content = null;
  }
  cache.set(normalized, content);
  return content;
}

/**
 * 若 pathname 有對應的 build-time 預渲染片段，回傳把該片段注入
 * `<div id="root"></div>` 後的 HTML；否則回傳 null（呼叫端應保留原本
 * 的空 root，不受影響）。找不到片段檔案（例如尚未執行過
 * `pnpm build`／`pnpm prerender:about`）一律安全地回傳 null，不拋錯。
 */
export function injectPrerenderedBody(html: string, pathname: string): string | null {
  const fragment = readPrerenderedFragment(pathname);
  if (!fragment) return null;
  if (!ROOT_DIV_RE.test(html)) return null;

  return html.replace(ROOT_DIV_RE, `<div id="root" data-oxm-prerendered="about">${fragment}</div>`);
}
