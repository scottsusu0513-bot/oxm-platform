// /factories/:region/:second 的第二段 slug 消歧義：既有的
// /factories/:region/:industry（地區 × 主產業）跟新增的
// /factories/:region/:subIndustry（地區 × 子產業）網址結構完全相同
// （"/factories/<regionSlug>/<某個 slug>"），不能靠 path shape 判斷，必須在
// 這裡明確、決定性地判斷第二段究竟是主產業 slug 還是子產業 slug（見任務定案
// 「路由衝突問題」）。
//
// server/_core/vite.ts（SSR meta／body 注入）與 client/src/pages/
// RegionIndustryPage.tsx（實際渲染）都必須呼叫同一份 resolveFactoriesTwoSegment，
// 不得各自重新判斷一次，避免兩邊判斷結果不一致（例如 server 端判斷成主產業、
// client 端判斷成子產業）。
import { resolveRegionIndustry, type ResolvedRegionIndustry } from "./regionIndustryPages";
import { resolveRegionSubIndustry, type ResolvedRegionSubIndustry } from "./subIndustryPages";

export type ResolvedFactoriesTwoSegment =
  | { kind: "industry"; resolved: ResolvedRegionIndustry }
  | { kind: "subIndustry"; resolved: ResolvedRegionSubIndustry };

/**
 * 判斷順序：先試主產業（resolveRegionIndustry，13 個既有 slug），對不到再試
 * 子產業（resolveRegionSubIndustry，72 個新 slug）。
 *
 * 這個順序在目前資料下沒有實際影響——server/subIndustrySearchSlugs.test.ts
 * 已經證明 72 個子產業 slug 跟 13 個主產業 slug 之間是 0 collision——先後
 * 順序純粹是防呆：保證既有 22×13＝286 種主產業 URL 的解讀結果／SEO 內容
 * 永遠不變，即使未來不小心新增一個剛好跟某個主產業 slug 撞名的子產業 slug，
 * 也會是主產業解讀優先生效並保留既有頁面語意，而不是被新的子產業定義悄悄
 * 覆蓋掉（見任務定案「resolver 行為必須 deterministic」「不可偷偷選其中一
 * 個」）。
 */
export function resolveFactoriesTwoSegment(regionSlug: string, secondSlug: string): ResolvedFactoriesTwoSegment | null {
  const industry = resolveRegionIndustry(regionSlug, secondSlug);
  if (industry) return { kind: "industry", resolved: industry };

  const subIndustry = resolveRegionSubIndustry(regionSlug, secondSlug);
  if (subIndustry) return { kind: "subIndustry", resolved: subIndustry };

  return null;
}
