/**
 * Analytics 2.0 — 從 pathname 判斷 pageType，並在是工廠頁時解析出
 * factoryId（見對話中「SPA Route Tracking」：pageType 要在寫入時就標準化，
 * 不要留到 Admin 顯示時才臨時解析字串）。純函式，client／server 皆可用。
 */
export const ALLOWED_PAGE_TYPES = [
  "home", "search", "factory", "industry", "city_industry", "library", "news", "resource", "talent", "about", "other",
] as const;
export type PageType = typeof ALLOWED_PAGE_TYPES[number];

export interface ClassifiedPage {
  pageType: PageType;
  factoryId: number | null;
}

export function classifyPathname(pathname: string): ClassifiedPage {
  const p = pathname || "/";

  if (p === "/") return { pageType: "home", factoryId: null };
  if (p === "/search") return { pageType: "search", factoryId: null };

  const factoryMatch = p.match(/^\/factory\/(\d+)(?:\/|$)/);
  if (factoryMatch) return { pageType: "factory", factoryId: Number(factoryMatch[1]) };

  // /factories/:region/:industry（真實路由，見 client/src/App.tsx
  // RegionIndustryPage）是「地區 × 產業」組合頁——兩個 path segment，跟
  // /factories/:slug（單一 subIndustry SEO slug，見 SubIndustryPage）不是
  // 同一種頁面，前者歸 city_industry，後者歸 industry。
  const factoriesSegments = p.match(/^\/factories\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (factoriesSegments) {
    return { pageType: factoriesSegments[2] ? "city_industry" : "industry", factoryId: null };
  }
  if (/^\/industry(\/|$)/.test(p)) return { pageType: "industry", factoryId: null };
  if (/^\/library(\/|$)/.test(p)) return { pageType: "library", factoryId: null };
  if (/^\/news(\/|$)/.test(p)) return { pageType: "news", factoryId: null };
  if (/^\/resources?(\/|$)/.test(p)) return { pageType: "resource", factoryId: null };
  if (/^\/talent(\/|$)/.test(p)) return { pageType: "talent", factoryId: null };
  if (p === "/about") return { pageType: "about", factoryId: null };

  return { pageType: "other", factoryId: null };
}
