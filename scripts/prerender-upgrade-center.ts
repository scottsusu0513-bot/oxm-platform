/**
 * GEO Final Cleanup — build-time 產生 /upgrade-center（企業升級中心）的
 * 可抓取正文片段。
 *
 * 執行：pnpm build（vite build 之後自動接著跑這支腳本）
 * 也可單獨執行：tsx scripts/prerender-upgrade-center.ts
 *
 * 與 scripts/prerender-resources.ts 相同的設計原則：
 * - 不經過 React／ReactDOMServer render 整個 EnterpriseUpgradeCenter 元件樹
 *   （會 render <Navbar/>，且頁面本身有 trpc.factory.getMine／
 *   upgradeCenter.myApplicationProgress／upgradeCenter.publicStats／
 *   upgradePrograms.listPublic 等多個 useQuery，需要另外 mock 一整套
 *   tRPC/QueryClient，對「只是要抓取固定文字」這個目的不成比例）。
 * - 內容全部來自 shared/content/upgradeCenter.ts 的 UPGRADE_CENTER_CONTENT，
 *   與 client/src/pages/EnterpriseUpgradeCenter.tsx 共用同一份資料，不會有
 *   兩邊文案不一致的問題。
 * - 只收錄畫面上實際存在、對任何訪客都相同的固定文字：Hero H1／intro、
 *   「為什麼需要資源導覽」三項說明、「政府補助方案」區塊標題／說明（不含
 *   實際方案清單本身）、六步申請流程、「OXM 如何協助」三項說明、
 *   Bottom CTA 標題／說明。
 * - 刻意不收錄（見 shared/content/upgradeCenter.ts 開頭說明）：Hero 即時
 *   統計數字（runtime API、且畫面上自己註明「數據正式啟動後持續更新」）、
 *   政府補助方案實際清單（資料庫驅動、會隨管理員異動，不在 build time
 *   連 production DB，也不逐頁 server-render）、「權限不足」與「申請進度
 *   查詢」兩個 Dialog（使用者個人資料／案件進度）。
 * - 純字串樣板，不使用 JSX／React，避免不必要的 render 風險與相依。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UPGRADE_CENTER_CONTENT, type UpgradeCenterListItem } from "../shared/content/upgradeCenter";
import { escapeHtml } from "../server/_core/ogMeta";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "..", "dist", "prerendered");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "upgrade-center.html");

function e(text: string): string {
  return escapeHtml(text);
}

function renderList(items: UpgradeCenterListItem[]): string {
  return items.map(item => `<li><h3>${e(item.title)}</h3><p>${e(item.description)}</p></li>`).join("\n");
}

/** 純函式，不做任何 I/O，方便測試直接呼叫並檢查產生的字串內容。 */
export function renderUpgradeCenterContentHtml(): string {
  const c = UPGRADE_CENTER_CONTENT;

  return `<h1>${e(c.heroH1)}</h1>
<p>${e(c.heroIntro)}</p>
<h2>${e(c.whyMattersTitle)}</h2>
<p>${e(c.whyMattersIntro)}</p>
<ul>
${renderList(c.meaningItems)}
</ul>
<h2>${e(c.programsTitle)}</h2>
<p>${e(c.programsIntro)}</p>
<h2>${e(c.processTitle)}</h2>
<p>${e(c.processIntro)}</p>
<ul>
${renderList(c.processSteps)}
</ul>
<h2>${e(c.supportTitle)}</h2>
<p>${e(c.supportIntro)}</p>
<ul>
${renderList(c.supportItems)}
</ul>
<h2>${e(c.ctaTitle)}</h2>
<p>${e(c.ctaIntro)}</p>`;
}

/** 基本健檢：不得是空字串、不得含 "undefined"／"NaN"。有問題時回傳錯誤訊息
 * 陣列（空陣列代表通過），方便測試直接呼叫檢查，不必真的丟例外。 */
export function validateUpgradeCenterContentHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.trim()) problems.push("generated HTML is empty");
  if (html.includes("undefined")) problems.push("generated HTML contains the literal string 'undefined'");
  if (html.includes("NaN")) problems.push("generated HTML contains the literal string 'NaN'");
  return problems;
}

function main() {
  const html = renderUpgradeCenterContentHtml();

  const problems = validateUpgradeCenterContentHtml(html);
  if (problems.length > 0) {
    throw new Error(`[prerender-upgrade-center] ${problems.join("; ")}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, html, "utf-8");

  console.log(`[prerender-upgrade-center] wrote ${OUTPUT_FILE} (${Buffer.byteLength(html, "utf-8")} bytes)`);
}

// 只有直接執行這支腳本（pnpm build / tsx scripts/prerender-upgrade-center.ts）
// 時才寫檔；被測試檔案 import 使用其中的純函式時不應該有寫檔案的副作用。
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
