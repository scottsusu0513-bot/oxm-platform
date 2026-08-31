/**
 * GEO Phase 3A — build-time 產生 /news（找消息列表）的可抓取正文語意殼。
 *
 * 執行：pnpm build（vite build 之後自動接著跑這支腳本）
 * 也可單獨執行：tsx scripts/prerender-news.ts
 *
 * 與其他 prerender 腳本不同的地方：找消息本身是資料庫驅動的動態列表，這支
 * 腳本刻意只產生「沒有任何消息資料時仍然成立」的固定語意殼——H1、intro、
 * 固定分類標籤（全部最新／重要消息／競賽消息／展覽消息／跨產業資訊）與
 * 產業分類（沿用 shared/constants.ts 的 INDUSTRY_OPTIONS，與 News.tsx 的
 * 產業篩選同一份來源）。
 *
 * 不做的事（刻意）：
 * - 不在 build time 連線 production DB、不把任何一篇消息寫死進 build 產物。
 * - 不複製 News.tsx 整套分類切換 UI——分類在畫面上是 client state 切換的
 *   按鈕，不是各自可導覽的 <a href>，這裡只列出分類名稱本身，不假造網址。
 * - 不 render 整個 News 元件樹（會 render <Navbar/>，需要 tRPC/QueryClient）。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NEWS_CONTENT } from "../shared/content/news";
import { PUBLIC_PAGE_SEO } from "../shared/seo/publicPages";
import { INDUSTRY_OPTIONS } from "../shared/constants";
import { escapeHtml } from "../server/_core/ogMeta";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "news.html");

function e(text: string): string {
  return escapeHtml(text);
}

/** 純函式，不做任何 I/O，方便測試直接呼叫並檢查產生的字串內容。 */
export function renderNewsContentHtml(): string {
  const fixedCategories = NEWS_CONTENT.fixedCategories.map(c => `<li>${e(c)}</li>`).join("\n");
  const industries = INDUSTRY_OPTIONS.map(name => `<li>${e(name)}</li>`).join("\n");

  return `<h1>${e(NEWS_CONTENT.heroH1)}</h1>
<p>${e(PUBLIC_PAGE_SEO.news.description)}</p>
<ul>
${fixedCategories}
</ul>
<ul>
${industries}
</ul>`;
}

/** 基本健檢：不得是空字串、不得含 "undefined"／"NaN"。有問題時回傳錯誤訊息
 * 陣列（空陣列代表通過），方便測試直接呼叫檢查，不必真的丟例外。 */
export function validateNewsContentHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.trim()) problems.push("generated HTML is empty");
  if (html.includes("undefined")) problems.push("generated HTML contains the literal string 'undefined'");
  if (html.includes("NaN")) problems.push("generated HTML contains the literal string 'NaN'");
  return problems;
}

function main() {
  const html = renderNewsContentHtml();

  const problems = validateNewsContentHtml(html);
  if (problems.length > 0) {
    throw new Error(`[prerender-news] ${problems.join("; ")}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, "utf-8");

  console.log(`[prerender-news] wrote ${OUTPUT_FILE} (${Buffer.byteLength(html, "utf-8")} bytes)`);
}

// 只有直接執行這支腳本（pnpm build / tsx scripts/prerender-news.ts）時才寫檔；
// 被測試檔案 import 使用其中的純函式時不應該有寫檔案的副作用。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
