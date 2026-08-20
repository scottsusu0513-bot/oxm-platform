/**
 * GEO 第二階段 D — build-time 產生 /faq 的可抓取正文片段。
 *
 * 執行：pnpm build（vite build 之後自動接著跑這支腳本）
 * 也可單獨執行：tsx scripts/prerender-faq.ts
 *
 * 與 scripts/prerender-about.ts／prerender-home.ts 相同的設計原則：
 * - 不經過 React／ReactDOMServer render 整個 FAQ 元件樹。client/src/pages/FAQ.tsx
 *   會渲染 <Navbar/>，Navbar 內有多個 trpc.*.useQuery(...)，沒有
 *   tRPC/QueryClientProvider 就會直接 throw；要在 Node 安全渲染整個頁面還需要
 *   另外 mock 一套 tRPC/QueryClient（可行，但對「不是必要抓取內容」的 Navbar
 *   徽章／通知這種東西來說，維護成本與風險不成比例）。
 * - 16 題正式 FAQ 問答全部來自 shared/content/faq.ts 的 FAQ_CONTENT，這裡
 *   直接引用同一份常數組出語意化的純文字 HTML，不在這支腳本內另外複製、改寫
 *   或維護第二份題目/答案文字——與 client/src/pages/FAQ.tsx（畫面顯示）、
 *   shared/seo/schema.ts 的 getFaqPageSchema()（FAQPage JSON-LD）三者共用同一個
 *   資料來源，三邊文字永遠一致。
 * - 純字串樣板，不使用 JSX／React，避免不必要的 render 風險與相依。
 * - H1 文字 "OXM 常見問答 FAQ" 是 client/src/pages/FAQ.tsx 畫面上的 H1、也是
 *   shared/seo/schema.ts getFaqPageSchema() 的 FAQPage.name，三處為同一句固定
 *   頁面標題（不是題目/答案內容），直接字面量對齊，不额外抽成共用常數。
 * - 只收錄畫面上實際會顯示的 16 題問答正文（H1 + 四大分類 + 題目 + 答案），
 *   不含 Hero 副標、Navbar、麵包屑等非本階段要求範圍的內容。
 * - 新增「AI 問答入口預留區」（client/src/components/faq/FaqAiEntry.tsx）之後，
 *   額外收錄該區塊的靜態標題／說明文字（來自 shared/content/faqAiEntry.ts，
 *   與 FaqAiEntry.tsx 共用同一份資料），讓爬蟲能理解這是 OXM FAQ 頁的 AI
 *   問答入口。刻意只收錄標題／說明這兩句固定文字，不收錄輸入框、送出按鈕等
 *   互動元素（那些沒有意義被寫進靜態 HTML），也完全不影響下方 16 題 FAQ
 *   正文與題數。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FAQ_CONTENT, type FaqCategory, type FaqQuestion } from "../shared/content/faq";
import { FAQ_AI_ENTRY_CONTENT } from "../shared/content/faqAiEntry";
import { escapeHtml } from "../server/_core/ogMeta";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "faq.html");

function e(text: string): string {
  return escapeHtml(text);
}

/**
 * 單一段落若含有換行（原文中的條列式子句，例如「你最擅長解決哪一類製造需求？
 * \n哪些製程...」），輸出成 <ul><li>；一般段落輸出成 <p>。不改動段落文字本身，
 * 只是依原文既有的換行結構選擇語意化標籤。
 */
function renderAnswerParagraph(paragraph: string): string {
  if (paragraph.includes("\n")) {
    const lines = paragraph.split("\n").filter(line => line.length > 0);
    const items = lines.map(line => `<li>${e(line)}</li>`).join("\n");
    return `<ul>\n${items}\n</ul>`;
  }
  return `<p>${e(paragraph)}</p>`;
}

function renderQuestion(q: FaqQuestion): string {
  const answer = q.answerParagraphs.map(renderAnswerParagraph).join("\n");
  return `<h3>${e(q.question)}</h3>\n${answer}`;
}

function renderCategory(category: FaqCategory): string {
  const questions = category.questions.map(renderQuestion).join("\n");
  return `<h2>${e(category.number)}｜${e(category.title)}</h2>\n${questions}`;
}

/** 純函式，不做任何 I/O，方便測試直接呼叫並檢查產生的字串內容。 */
export function renderFaqContentHtml(): string {
  const categories = FAQ_CONTENT.categories.map(renderCategory).join("\n");
  const aiEntry = `<h2>${e(FAQ_AI_ENTRY_CONTENT.title)}</h2>\n<p>${e(FAQ_AI_ENTRY_CONTENT.description)}</p>`;
  return `<h1>OXM 常見問答 FAQ</h1>\n${aiEntry}\n${categories}`;
}

/** 基本健檢：不得是空字串、不得含 "undefined"／"NaN"。有問題時回傳錯誤訊息
 * 陣列（空陣列代表通過），方便測試直接呼叫檢查，不必真的丟例外。 */
export function validateFaqContentHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.trim()) problems.push("generated HTML is empty");
  if (html.includes("undefined")) problems.push("generated HTML contains the literal string 'undefined'");
  if (html.includes("NaN")) problems.push("generated HTML contains the literal string 'NaN'");
  return problems;
}

function main() {
  const html = renderFaqContentHtml();

  const problems = validateFaqContentHtml(html);
  if (problems.length > 0) {
    throw new Error(`[prerender-faq] ${problems.join("; ")}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, "utf-8");

  console.log(`[prerender-faq] wrote ${OUTPUT_FILE} (${Buffer.byteLength(html, "utf-8")} bytes)`);
}

// 只有直接執行這支腳本（pnpm build / tsx scripts/prerender-faq.ts）時才寫檔；
// 被測試檔案 import 使用其中的純函式時不應該有寫檔案的副作用。用
// pathToFileURL 而不是自己組字串，避免 Windows 路徑（反斜線、drive letter）
// 造成比對誤判。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
