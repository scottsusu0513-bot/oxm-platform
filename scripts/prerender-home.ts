/**
 * GEO 第二階段 C — build-time 產生首頁（/）的可抓取正文片段。
 *
 * 執行：pnpm build（vite build 之後自動接著跑這支腳本）
 * 也可單獨執行：tsx scripts/prerender-home.ts
 *
 * 與 scripts/prerender-about.ts 相同的設計原則：
 * - 不經過 React／ReactDOMServer render 整個 Home 元件樹（Home.tsx 內的
 *   <Navbar/>、<AnnouncementsSection/> 都有 trpc.*.useQuery(...)，在 Node
 *   安全渲染需要另外 mock 一整套 tRPC/QueryClient，對「只是要抓取固定文字」
 *   這個目的而言不成比例）。
 * - 本階段要求可抓取的內容（H1、主標題、說明文字、品牌定位、工廠/工作室比較、
 *   熱門產業分類、特色、CTA）全部來自 shared/content/home.ts（+
 *   shared/constants.ts 的 INDUSTRY_OPTIONS），因此直接組出語意化的純文字
 *   HTML 片段即可，不需要真的 render 元件樹。
 * - 資料來源與 client/src/pages/Home.tsx 完全相同，不會有兩邊文案不一致的問題。
 * - 只放首頁「固定」內容：不含公告（AnnouncementsSection，動態/tRPC）、
 *   不含搜尋表單的即時互動、不含登入才看得到的內容、不含 hero 輪播圖片
 *   （避免放大預渲染版與 React 掛載後版本的視覺落差）、不含頁尾（品牌名稱以外
 *   的社群連結、著作權年份是 new Date().getFullYear() 這種會隨時間變動的值，
 *   不適合寫進 build-time 快取的靜態產物）。也不含 OXM 正式品牌定義句——那句
 *   話只存在於 meta description／JSON-LD，不是首頁畫面上逐字可見的正文，放進
 *   預渲染片段等同「只給爬蟲看的補充內容」，不符合本階段只收錄實際可見內容
 *   的要求。
 * - 純字串樣板，不使用 JSX／React，避免不必要的 render 風險與相依。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HOME_CONTENT, segmentsToPlainText } from "../shared/content/home";
import { INDUSTRY_OPTIONS } from "../shared/constants";
import { escapeHtml } from "../server/_core/ogMeta";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "home.html");

function e(text: string): string {
  return escapeHtml(text);
}

/** 純函式，不做任何 I/O，方便測試直接呼叫並檢查產生的字串內容。 */
export function renderHomeContentHtml(): string {
  const c = HOME_CONTENT;

  const heroDescription = e(segmentsToPlainText(c.heroDescriptionParts));
  const ctaDescription = e(segmentsToPlainText(c.ctaSection.descriptionParts));

  const compareCards = c.compareSection.cards
    .map(
      card => `<li>
<h3>${e(card.title)}（${e(card.subtitle)}）</h3>
<p>${e(card.description)}</p>
<ul>
${card.bullets.map(b => `<li>${e(b)}</li>`).join("\n")}
</ul>
</li>`
    )
    .join("\n");

  const industryItems = INDUSTRY_OPTIONS
    .map(name => `<li><a href="/search?industry=${encodeURIComponent(name)}">${e(name)}</a></li>`)
    .join("\n");

  const statItems = c.statsSection.items.map(s => `<li>${e(s.num)} ${e(s.label)}</li>`).join("\n");

  const featureItems = c.featuresSection.items
    .map(f => `<li><h3>${e(f.title)}</h3><p>${e(f.description)}</p></li>`)
    .join("\n");

  const ctaButtons = c.ctaSection.buttons
    .map(btn => `<a href="${e(btn.href)}">${e(btn.label)}</a>`)
    .join("\n");

  // 純語意化 HTML（h1/h2/h3/p/ul/li/a），皆為畫面上真實存在、React 掛載後
  // 也會顯示的文字與連結，不是隱藏的 SEO 關鍵字堆疊，也沒有 display:none，
  // 也不包含公告／搜尋結果等動態內容。
  return `<h1>${e(c.heroH1)}</h1>
<p>${e(c.heroHeadlineLine1)}${e(c.heroHeadlineLine2)}</p>
<p>${heroDescription}</p>
<h2>${e(c.compareSection.title)}</h2>
<p>${e(c.compareSection.subtitle)}</p>
<ul>
${compareCards}
</ul>
<h2>${e(c.industriesSection.title)}</h2>
<p>${e(c.industriesSection.subtitle)}</p>
<ul>
${industryItems}
</ul>
<ul>
${statItems}
</ul>
<h2>${e(c.featuresSection.title)}</h2>
<p>${e(c.featuresSection.subtitle)}</p>
<ul>
${featureItems}
</ul>
<h2>${e(c.ctaSection.title)}</h2>
<p>${ctaDescription}</p>
${ctaButtons}`;
}

/** 基本健檢：不得是空字串、不得含 "undefined"／"NaN"，不得含空 href／javascript: 連結。
 * 有問題時回傳錯誤訊息陣列（空陣列代表通過），方便測試直接呼叫檢查，不必真的丟例外。 */
export function validateHomeContentHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.trim()) problems.push("generated HTML is empty");
  if (html.includes("undefined")) problems.push("generated HTML contains the literal string 'undefined'");
  if (html.includes("NaN")) problems.push("generated HTML contains the literal string 'NaN'");
  if (/href="\s*"/.test(html)) problems.push("generated HTML contains an empty href");
  if (/href="\s*javascript:/i.test(html)) problems.push("generated HTML contains a javascript: URL");
  return problems;
}

function main() {
  const html = renderHomeContentHtml();

  const problems = validateHomeContentHtml(html);
  if (problems.length > 0) {
    throw new Error(`[prerender-home] ${problems.join("; ")}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, "utf-8");

  console.log(`[prerender-home] wrote ${OUTPUT_FILE} (${Buffer.byteLength(html, "utf-8")} bytes)`);
}

// 只有直接執行這支腳本（pnpm build / tsx scripts/prerender-home.ts）時才寫檔；
// 被測試檔案 import 使用其中的純函式時不應該有寫檔案的副作用。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
