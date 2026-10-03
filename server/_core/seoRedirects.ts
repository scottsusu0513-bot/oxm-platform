/**
 * SEO 正規化轉址（Batch 3.12）。
 *
 * 1. 結尾斜線：`/news/`、`/factory/3/` 等原本都回 200，是內容相同的第二個網址（部分
 *    甚至沒有 title／canonical）。非根目錄、非 /api、非檔案路徑的 GET 一律 301 到不帶
 *    斜線的網址，查詢字串原樣保留。
 * 2. 產業頁超出範圍的頁碼：server 原本不知道總頁數，`?page=999` 會回 200＋自我指向的
 *    canonical／「第 999 頁」title，只有 client hydrate 後才修正。改為以與列表相同的
 *    條件計數，超出時 301 到最後一頁（與 client 的正規化一致）；DB 失敗時不轉址。
 */
import { parseIndustryPath } from "@shared/seo/industryPages";
import { parsePageParam, computeTotalPages } from "@shared/industryPagination";
import { INDUSTRY_SLUG_TO_NAME, SUB_INDUSTRY_SLUG_TO_NAME } from "@shared/constants";

/** client/src/pages/IndustryPage.tsx 的 PAGE_SIZE（每頁 15 間）。 */
export const INDUSTRY_PAGE_SIZE = 15;

export function trailingSlashRedirect(method: string, originalUrl: string): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const q = originalUrl.indexOf("?");
  const path = q === -1 ? originalUrl : originalUrl.slice(0, q);
  const query = q === -1 ? "" : originalUrl.slice(q);
  if (path === "/" || !path.endsWith("/") || path.startsWith("/api/") || path === "/api") return null;
  if (path.startsWith("//")) return null; // 避免 //evil.com 形成 open redirect
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed || /\.[A-Za-z0-9]{1,8}$/.test(trimmed)) return null;
  return `${trimmed}${query}`;
}

export type PublicIndustryCounter = (industry: string, subIndustry?: string) => Promise<number>;

export async function industryPageOverflowRedirect(pathname: string, originalUrl: string, count: PublicIndustryCounter): Promise<string | null> {
  const parsed = parseIndustryPath(pathname);
  if (!parsed) return null;
  const q = originalUrl.indexOf("?");
  const page = parsePageParam(new URLSearchParams(q === -1 ? "" : originalUrl.slice(q + 1)).get("page"));
  if (page <= 1) return null;
  const industry = INDUSTRY_SLUG_TO_NAME[parsed.slug];
  if (!industry) return null;
  const sub = parsed.subSlug ? SUB_INDUSTRY_SLUG_TO_NAME[`${parsed.slug}/${parsed.subSlug}`] : undefined;
  if (parsed.subSlug && !sub) return null;
  let total: number;
  try { total = await count(industry, sub); } catch { return null; }
  const lastPage = Math.max(1, computeTotalPages(total, INDUSTRY_PAGE_SIZE));
  if (page <= lastPage) return null;
  return lastPage > 1 ? `${pathname}?page=${lastPage}` : pathname;
}
