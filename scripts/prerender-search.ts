/**
 * GEO Phase 3A — build-time 產生 /search 的可抓取語意殼（不含搜尋結果）。
 *
 * 執行：pnpm build（vite build 之後自動接著跑這支腳本）
 * 也可單獨執行：tsx scripts/prerender-search.ts
 *
 * 刻意只有 H1，明確不做：
 * - 不 prerender 工廠搜尋結果（動態、依 query string／登入狀態變化，寫進
 *   build 產物沒有意義也會很快過期）。
 * - 不 prerender 篩選控制項本身（那是互動元件，不是需要被爬蟲讀到的正文）。
 * - 不把 Search.tsx 畫面上的 sr-only H1 改成可見大標題——這支腳本產生的
 *   片段只會出現在原始 HTML 的 <div id="root">，React 掛載後會被
 *   createRoot 整個換掉（跟 /about、/faq 同樣的既有機制），不影響使用者
 *   實際看到的畫面／版面。
 * - 不加入 intro 段落：原本這裡有一句 intro，但 Search.tsx 的真實 DOM 裡
 *   沒有對應的可見／可讀文字，等於只給爬蟲看的額外文案（正常使用者頁面
 *   載入完成後根本看不到）——GEO Phase 3A 安全校準已移除，只保留與真正
 *   Search 頁一致的內容（sr-only H1，見 shared/content/search.ts 開頭
 *   說明）。真人可見的 intro 需要調整既有版面/樣式，交給後續 Codex 評估。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SEARCH_CONTENT } from "../shared/content/search";
import { escapeHtml } from "../server/_core/ogMeta";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "search.html");

function e(text: string): string {
  return escapeHtml(text);
}

/** 純函式，不做任何 I/O，方便測試直接呼叫並檢查產生的字串內容。 */
export function renderSearchContentHtml(): string {
  return `<h1>${e(SEARCH_CONTENT.heroH1)}</h1>`;
}

/** 基本健檢：不得是空字串、不得含 "undefined"／"NaN"。有問題時回傳錯誤訊息
 * 陣列（空陣列代表通過），方便測試直接呼叫檢查，不必真的丟例外。 */
export function validateSearchContentHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.trim()) problems.push("generated HTML is empty");
  if (html.includes("undefined")) problems.push("generated HTML contains the literal string 'undefined'");
  if (html.includes("NaN")) problems.push("generated HTML contains the literal string 'NaN'");
  return problems;
}

function main() {
  const html = renderSearchContentHtml();

  const problems = validateSearchContentHtml(html);
  if (problems.length > 0) {
    throw new Error(`[prerender-search] ${problems.join("; ")}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, "utf-8");

  console.log(`[prerender-search] wrote ${OUTPUT_FILE} (${Buffer.byteLength(html, "utf-8")} bytes)`);
}

// 只有直接執行這支腳本（pnpm build / tsx scripts/prerender-search.ts）時
// 才寫檔；被測試檔案 import 使用其中的純函式時不應該有寫檔案的副作用。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
