/**
 * GEO Phase 3A — build-time 產生 /resources（找資源總覽）的可抓取正文片段。
 *
 * 執行：pnpm build（vite build 之後自動接著跑這支腳本）
 * 也可單獨執行：tsx scripts/prerender-resources.ts
 *
 * 與 scripts/prerender-about.ts／prerender-home.ts／prerender-faq.ts 相同的
 * 設計原則：
 * - 不經過 React／ReactDOMServer render 整個 ResourceCenter 元件樹
 *   （會 render <Navbar/>，裡面有多個 trpc.*.useQuery(...)，需要另外 mock
 *   一整套 tRPC/QueryClient，對「只是要抓取固定文字」這個目的不成比例）。
 * - 內容全部來自 shared/content/resources.ts 的 RESOURCES_CONTENT，與
 *   client/src/pages/ResourceCenter.tsx 共用同一份資料，不會有兩邊文案
 *   不一致的問題。
 * - 只收錄畫面上實際存在、React 掛載後也會顯示的文字：H1、intro、五項服務
 *   的標題／副標／說明／標籤／目前狀態（已開放／敬請期待）。已開放的服務
 *   附上真實 <a href>；敬請期待的服務刻意不輸出連結（畫面上本來就是不可
 *   點擊的 <span>，不能因為 prerender 讓它變成可爬取的連結）。
 * - 純字串樣板，不使用 JSX／React，避免不必要的 render 風險與相依。
 * - 不查詢任何資料庫（RESOURCES_CONTENT 全部是固定內容）。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RESOURCES_CONTENT, type ResourceServiceContent } from "../shared/content/resources";
import { escapeHtml } from "../server/_core/ogMeta";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "resources.html");

function e(text: string): string {
  return escapeHtml(text);
}

function renderService(service: ResourceServiceContent): string {
  const tags = service.tags.map(t => `<li>${e(t)}</li>`).join("\n");
  const status = service.available
    ? `<a href="${e(service.href)}">查看服務內容</a>`
    : `<p>敬請期待</p>`;
  return `<li>
<h3>${e(service.title)}（${e(service.subtitle)}）</h3>
<p>${e(service.description)}</p>
<ul>
${tags}
</ul>
${status}
</li>`;
}

/** 純函式，不做任何 I/O，方便測試直接呼叫並檢查產生的字串內容。 */
export function renderResourcesContentHtml(): string {
  const c = RESOURCES_CONTENT;
  const services = c.services.map(renderService).join("\n");

  return `<h1>${e(c.heroH1)}</h1>
<p>${e(c.heroIntro)}</p>
<ul>
${services}
</ul>`;
}

/** 基本健檢：不得是空字串、不得含 "undefined"／"NaN"，不得含空 href／javascript: 連結。
 * 有問題時回傳錯誤訊息陣列（空陣列代表通過），方便測試直接呼叫檢查，不必真的丟例外。 */
export function validateResourcesContentHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.trim()) problems.push("generated HTML is empty");
  if (html.includes("undefined")) problems.push("generated HTML contains the literal string 'undefined'");
  if (html.includes("NaN")) problems.push("generated HTML contains the literal string 'NaN'");
  if (/href="\s*"/.test(html)) problems.push("generated HTML contains an empty href");
  if (/href="\s*javascript:/i.test(html)) problems.push("generated HTML contains a javascript: URL");
  return problems;
}

function main() {
  const html = renderResourcesContentHtml();

  const problems = validateResourcesContentHtml(html);
  if (problems.length > 0) {
    throw new Error(`[prerender-resources] ${problems.join("; ")}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, "utf-8");

  console.log(`[prerender-resources] wrote ${OUTPUT_FILE} (${Buffer.byteLength(html, "utf-8")} bytes)`);
}

// 只有直接執行這支腳本（pnpm build / tsx scripts/prerender-resources.ts）時
// 才寫檔；被測試檔案 import 使用其中的純函式時不應該有寫檔案的副作用。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
