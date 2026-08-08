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
 * 回傳 slug（與可選 subSlug）對應的 meta；slug／subSlug 對不到任何已知產業
 * （與 client/src/pages/IndustryPage.tsx 顯示「找不到此產業頁面」的條件
 * 完全一致）時回傳 null，呼叫端應保留原本的預設 index.html 不變。
 */
export function buildIndustryPageMeta(slug: string, subSlug?: string): IndustryPageMeta | null {
  const industryNames = INDUSTRY_SLUG_TO_NAMES[slug] ?? [];
  if (industryNames.length === 0) return null;

  const industryName = INDUSTRY_SLUG_TO_NAME[slug] ?? "";
  const fullKey = subSlug ? `${slug}/${subSlug}` : "";
  const subIndustryName = fullKey ? (SUB_INDUSTRY_SLUG_TO_NAME[fullKey] ?? "") : "";
  if (subSlug && !subIndustryName) return null;

  const subSeoContent = fullKey ? (SUB_INDUSTRY_SEO_CONTENT[fullKey] ?? null) : null;

  const canonical = subSlug
    ? `${BRAND.url}/industry/${slug}/${subSlug}`
    : `${BRAND.url}/industry/${slug}`;
  const title = subSeoContent?.title
    ?? `${industryName}｜台灣傳產供應商與工廠資源｜OXM`;
  const description = subSeoContent?.description
    ?? `在 OXM 尋找台灣${industryName}相關廠商與供應鏈資源，包含工廠、OEM/ODM 代工、材料、設備、加工與產業服務，協助品牌、企業與採購者快速比較並送出詢價。`;

  return { title, description, canonical };
}
