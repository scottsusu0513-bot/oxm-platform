// /industry/:slug 與 /industry/:slug/:sub 的 SEO meta 產生邏輯，供 server
// （server/_core/vite.ts 的初始 HTML head 注入）與 client
// （client/src/pages/IndustryPage.tsx 的 react-helmet-async）共用同一份
// title／description／canonical 公式，避免兩邊各自寫一份、日後描述互相矛盾。
// 純資料查表（不查 DB），13 個主產業 slug 與 Phase 1 子產業 slug 都是固定
// 常數，可以在 server 端同步（非 async）算出，不需要另建一套系統。
import {
  INDUSTRY_SLUG_TO_NAME, INDUSTRY_SLUG_TO_NAMES,
  SUB_INDUSTRY_SLUG_TO_NAME, SUB_INDUSTRY_SEO_CONTENT,
} from "../constants";
import { BRAND } from "./brand";
import { getBreadcrumbSchema, type JsonLdObject } from "./schema";
import { pageToQueryValue } from "../industryPagination";

export interface IndustryPageMeta {
  title: string;
  description: string;
  canonical: string;
}

/** 解析 "/industry/:slug" 或 "/industry/:slug/:sub"（結尾斜線已忽略），其他路徑回傳 null。 */
export function parseIndustryPath(pathname: string): { slug: string; subSlug?: string } | null {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const m = normalized.match(/^\/industry\/([^/]+)(?:\/([^/]+))?$/);
  if (!m) return null;
  return { slug: m[1], subSlug: m[2] || undefined };
}

/**
 * 回傳 slug（與可選 subSlug、page）對應的 meta；slug／subSlug 對不到任何已知
 * 產業（與 client/src/pages/IndustryPage.tsx 顯示「找不到此產業頁面」的條件
 * 完全一致）時回傳 null，呼叫端應保留原本的預設 index.html 不變。
 *
 * page（Pagination，見對話中「Pagination + 產業 slug mapping 稽核」）：
 * 第 1 頁（或未帶 page）canonical／title／description 完全維持修正前的既有
 * 公式；第 2 頁以後 canonical 自我指向帶 `?page=N` 的網址（不會導回第 1
 * 頁），title 在既有公式尾端固定的 "｜OXM" 前插入 "｜第 N 頁"（title 陣列裡
 * 每一筆既有寫死的字串都是這個結尾，見 shared/constants.ts 的
 * SUB_INDUSTRY_SEO_CONTENT），description 則在既有內容後面加註
 * "（第 N 頁）"。這個函式本身純資料查表、不查 DB，不知道、也不需要知道
 * 實際 totalPages 是多少——page 超出真實總頁數時的 normalize／redirect 是
 * client 端才做得到的事（需要先拿到 DB 查詢結果的 total），這裡只負責
 * 「如果呼叫端說是第 N 頁，就老老實實產生第 N 頁該有的 meta」。
 */
export function buildIndustryPageMeta(slug: string, subSlug?: string, page?: number): IndustryPageMeta | null {
  const industryNames = INDUSTRY_SLUG_TO_NAMES[slug] ?? [];
  if (industryNames.length === 0) return null;

  const industryName = INDUSTRY_SLUG_TO_NAME[slug] ?? "";
  const fullKey = subSlug ? `${slug}/${subSlug}` : "";
  const subIndustryName = fullKey ? (SUB_INDUSTRY_SLUG_TO_NAME[fullKey] ?? "") : "";
  if (subSlug && !subIndustryName) return null;

  const subSeoContent = fullKey ? (SUB_INDUSTRY_SEO_CONTENT[fullKey] ?? null) : null;

  const basePath = subSlug ? `/industry/${slug}/${subSlug}` : `/industry/${slug}`;
  const pageQueryValue = pageToQueryValue(page && page > 1 ? page : 1);
  const canonical = pageQueryValue
    ? `${BRAND.url}${basePath}?page=${pageQueryValue}`
    : `${BRAND.url}${basePath}`;

  const baseTitle = subSeoContent?.title
    ?? `${industryName}｜台灣傳產供應商與工廠資源｜OXM`;
  const baseDescription = subSeoContent?.description
    ?? `在 OXM 尋找台灣${industryName}相關廠商與供應鏈資源，包含工廠、OEM/ODM 代工、材料、設備、加工與產業服務，協助品牌、企業與採購者快速比較並送出詢價。`;

  const title = pageQueryValue
    ? (baseTitle.endsWith("｜OXM")
        ? `${baseTitle.slice(0, -"｜OXM".length)}｜第 ${pageQueryValue} 頁｜OXM`
        : `${baseTitle}｜第 ${pageQueryValue} 頁`)
    : baseTitle;
  const description = pageQueryValue
    ? `${baseDescription}（第 ${pageQueryValue} 頁）`
    : baseDescription;

  return { title, description, canonical };
}

/**
 * 舊產業 slug → 正式 slug 的永久轉址表（見對話中「plastic-rubber duplicate
 * content 修正」）。plastic-rubber 曾經是 INDUSTRY_SLUG_TO_NAMES 裡對應
 * ["塑膠", "橡膠 / 矽膠"] 兩個名稱的舊 slug，但實際查詢／render 只會用
 * 第一個名稱（塑膠），導致跟正式的 /industry/plastic 渲染出完全相同的
 * 內容、卻各自 self-canonical，形成 duplicate content。塑膠與橡膠/矽膠
 * 現在都各自有獨立、正式的 slug（plastic、rubber-silicone），plastic-rubber
 * 這個舊 slug 已無存在必要，改成 301 永久轉址到它原本代表的那個正式
 * slug，不再讓舊 slug 自己 render 任何內容。
 *
 * 只收錄「確認過去確實對應到某個正式 slug」的舊別名——不要為了方便把任何
 * 查不到的 slug 都硬導到某個猜測的目的地。
 */
const LEGACY_INDUSTRY_SLUG_REDIRECTS: Record<string, string> = {
  "plastic-rubber": "plastic",
};

/**
 * pathname 若精確命中一個舊產業 slug（不含任何子路徑），回傳應該 301 導向
 * 的新 pathname；否則回傳 null（呼叫端不應該轉址，照原本邏輯處理）。
 *
 * 刻意只比對「精確 /industry/:slug，沒有 /:sub」——plastic-rubber 從未有過
 * 任何合法的子產業頁（shared/constants.ts 的 SUB_INDUSTRY_SLUG_TO_NAME 裡
 * 沒有任何 "plastic-rubber/xxx" 開頭的 key），所以 /industry/plastic-rubber
 * /something 不應該被自動導去 /industry/plastic/something——那個 something
 * 從來就不是塑膠底下經過確認的合法子產業 slug，硬導過去等於把一個原本無效
 * 的網址改導到另一個語意錯誤的網址。這種情況直接回傳 null，交給既有邏輯
 * （parseIndustryPath + buildIndustryPageMeta 對不到子產業會回傳 null）走
 * 原本「找不到此產業頁面」的既有行為，不在這裡臆測。
 */
export function resolveLegacyIndustrySlugRedirect(pathname: string): string | null {
  const parsed = parseIndustryPath(pathname);
  if (!parsed || parsed.subSlug) return null;
  const newSlug = LEGACY_INDUSTRY_SLUG_REDIRECTS[parsed.slug];
  return newSlug ? `/industry/${newSlug}` : null;
}

/**
 * /industry/:slug(/:sub) 的 BreadcrumbList 結構化資料（只注入 <head>，畫面上
 * 不可見）：首頁 → 找工廠（/search）→ 主產業（/industry/:slug）→ 子產業
 * （若存在）。name 一律來自現有的產業名稱 mapping；每一層 item 都指向
 * canonical URL。slug／subSlug 對不到已知產業時回 null（呼叫端不注入）。
 */
export function buildIndustryBreadcrumbJsonLd(slug: string, subSlug?: string): JsonLdObject | null {
  const industryName = INDUSTRY_SLUG_TO_NAME[slug];
  if (!industryName) return null;
  const crumbs: { name: string; path: string }[] = [
    { name: "找工廠", path: "/search" },
    { name: industryName, path: `/industry/${slug}` },
  ];
  if (subSlug) {
    const subIndustryName = SUB_INDUSTRY_SLUG_TO_NAME[`${slug}/${subSlug}`];
    if (!subIndustryName) return null;
    crumbs.push({ name: subIndustryName, path: `/industry/${slug}/${subSlug}` });
  }
  return getBreadcrumbSchema(crumbs);
}
