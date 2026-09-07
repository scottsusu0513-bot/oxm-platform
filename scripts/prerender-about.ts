/**
 * GEO 第二階段 B — build-time 產生 /about 的可抓取正文片段。
 *
 * 執行：pnpm build（vite build 之後自動接著跑這支腳本）
 * 也可單獨執行：tsx scripts/prerender-about.ts
 *
 * 設計原則：
 * - 不經過 React／ReactDOMServer render 整個 About 元件樹。實際盤查發現
 *   AboutOXM.tsx 會渲染 <Navbar/>，Navbar 內有多個 trpc.*.useQuery(...) 呼叫，
 *   沒有 tRPC/QueryClientProvider 就會直接 throw；要在 Node 安全渲染整個頁面
 *   還需要另外 mock 一套 tRPC/QueryClient（可行，但對「不是必要抓取內容」的
 *   Navbar 徽章／通知這種東西來說，維護成本與風險不成比例）。
 * - Navbar 本身不是「正文」，本階段要求的可抓取文字（H1、OXM 是什麼、正式
 *   定義、為什麼會有 OXM、六大服務名稱、誰適合使用 OXM、最後更新日期）
 *   全部來自 shared/content/about.ts，因此直接從這份共用資料組出語意化的
 *   純文字 HTML 片段即可，不需要真的 render 元件樹。
 * - 資料來源與 client/src/pages/AboutOXM.tsx 完全相同（同一個
 *   shared/content/about.ts），不會有「兩邊文案手動維護、日後不一致」的問題。
 * - 純字串樣板，不使用 JSX／React，避免不必要的 render 風險與相依。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ABOUT_CONTENT } from "../shared/content/about";
import { escapeHtml } from "../server/_core/ogMeta";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "about.html");

function escapeAndBreak(text: string): string {
  return escapeHtml(text);
}

/** 純函式，不做任何 I/O，方便測試直接呼叫並檢查產生的字串內容。 */
export function renderAboutContentHtml(): string {
  const c = ABOUT_CONTENT;

  const whatIsParagraphs = c.whatIsParagraphs.map(p => `<p>${escapeAndBreak(p)}</p>`).join("\n");
  const whyParagraphs = c.whyParagraphs.map(p => `<p>${escapeAndBreak(p)}</p>`).join("\n");
  const brandStatement = c.brandStatementLines.map(line => `<p>${escapeAndBreak(line)}</p>`).join("\n");
  const serviceItems = c.serviceNames.map(name => `<li>${escapeAndBreak(name)}</li>`).join("\n");
  const audienceItems = c.audienceRoles
    .map(role => `<li><h3>${escapeAndBreak(role.title)}</h3><p>${escapeAndBreak(role.content)}</p></li>`)
    .join("\n");

  // 純語意化 HTML（h1/h2/h3/p/ul/li/a），皆為畫面上真實存在、React 掛載後
  // 也會顯示的文字，不是隱藏的 SEO 關鍵字堆疊，也沒有 display:none。
  return `<h1>${escapeAndBreak(c.heroH1)}</h1>
<p>${escapeAndBreak(c.heroLead)}</p>
<p>${escapeAndBreak(c.heroSub)}</p>
<h2>${escapeAndBreak(c.whatIsTitle)}</h2>
${whatIsParagraphs}
<h2>${escapeAndBreak(c.whyTitle)}</h2>
${whyParagraphs}
${brandStatement}
<h2>${escapeAndBreak(c.servicesTitle)}</h2>
<ul>
${serviceItems}
</ul>
<h2>${escapeAndBreak(c.audienceTitle)}</h2>
<ul>
${audienceItems}
</ul>
<p>關於 OXM 內容最後更新：${escapeAndBreak(c.lastUpdated)}</p>`;
}

/** 基本健檢：不得是空字串、不得含 "undefined"／"NaN"（例如共用資料某個欄位
 * 意外是 undefined，字串樣板會把它印成字面上的 "undefined"）。有問題時回傳
 * 錯誤訊息陣列（空陣列代表通過），方便測試直接呼叫檢查，不必真的丟例外。 */
export function validateAboutContentHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.trim()) problems.push("generated HTML is empty");
  if (html.includes("undefined")) problems.push("generated HTML contains the literal string 'undefined'");
  if (html.includes("NaN")) problems.push("generated HTML contains the literal string 'NaN'");
  return problems;
}

function main() {
  const html = renderAboutContentHtml();

  const problems = validateAboutContentHtml(html);
  if (problems.length > 0) {
    throw new Error(`[prerender-about] ${problems.join("; ")}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, "utf-8");

  console.log(`[prerender-about] wrote ${OUTPUT_FILE} (${Buffer.byteLength(html, "utf-8")} bytes)`);
}

// 只有直接執行這支腳本（pnpm build / tsx scripts/prerender-about.ts）時才寫檔；
// 被測試檔案 import 使用其中的純函式時不應該有寫檔案的副作用。用
// pathToFileURL 而不是自己組字串，避免 Windows 路徑（反斜線、drive letter）
// 造成比對誤判。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
