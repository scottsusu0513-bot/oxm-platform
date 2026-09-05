// /factories/:region/:industry 的 route parsing + SEO 文案產生邏輯，供
// server（server/_core/vite.ts 的初始 HTML head／body 注入）與 client
// （client/src/pages/RegionIndustryPage.tsx 的 react-helmet-async）共用同一份
// 規則，避免兩邊各自 parse／各自算 title 而日後跑掉。
//
// 只做兩個維度：縣市（TAIWAN_REGIONS／REGION_SLUGS）× 主產業（INDUSTRY_OPTIONS／
// INDUSTRY_SLUGS）。純資料查表（不查 DB），DB existence／noindex 判斷邏輯在
// server 端（server/_core/ogMeta.ts 的 buildRegionIndustryMeta），因為需要
// 非同步查詢 factories 表，這裡刻意保持同步、無副作用。
import { REGION_SLUG_TO_NAME, REGION_DISPLAY_NAMES, INDUSTRY_SLUG_TO_NAME } from "../constants";
import { BRAND } from "./brand";

export interface RegionIndustryPathParams {
  regionSlug: string;
  industrySlug: string;
}

export interface ResolvedRegionIndustry {
  regionSlug: string;
  industrySlug: string;
  /** TAIWAN_REGIONS 的完整 canonical 值（例如「台中市」），底層 filter 必須用這個。 */
  regionName: string;
  /** INDUSTRY_OPTIONS 的 canonical 值（例如「金屬加工」），底層 filter 必須用這個。 */
  industryName: string;
  /** 只供顯示用（例如「台中」），絕不可用於 filter／DB 查詢。 */
  displayRegionName: string;
}

/** 解析 "/factories/:region/:industry"（結尾斜線已忽略），其他路徑回傳 null。 */
export function parseRegionIndustryPath(pathname: string): RegionIndustryPathParams | null {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const m = normalized.match(/^\/factories\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { regionSlug: m[1], industrySlug: m[2] };
}

/**
 * 把 regionSlug／industrySlug 解析成 canonical 名稱；任一個 slug 對不到已知
 * 值時回傳 null（呼叫端應視為非法 slug，回真 404，不 fallback 到搜尋或首頁）。
 */
export function resolveRegionIndustry(regionSlug: string, industrySlug: string): ResolvedRegionIndustry | null {
  const regionName = REGION_SLUG_TO_NAME[regionSlug];
  const industryName = INDUSTRY_SLUG_TO_NAME[industrySlug];
  if (!regionName || !industryName) return null;

  return {
    regionSlug,
    industrySlug,
    regionName,
    industryName,
    displayRegionName: REGION_DISPLAY_NAMES[regionName] ?? regionName,
  };
}

export interface RegionIndustryPageContent {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  intro: string;
}

/**
 * 固定 template，只代入 region／industry 兩個變數，不生成長篇文案、不虛構
 * 工廠數／產業歷史／產值（見任務定案「SEO 價值來自真實 factory database」）。
 */
export function buildRegionIndustryPageContent(resolved: ResolvedRegionIndustry): RegionIndustryPageContent {
  const { regionSlug, industrySlug, regionName, industryName, displayRegionName } = resolved;

  const h1 = `${displayRegionName}${industryName}廠`;
  const title = `${h1}｜工廠搜尋與合作媒合｜OXM`;
  const description = `尋找${displayRegionName}${industryName}廠？透過 OXM 查看${regionName}${industryName}相關工廠與製造商資訊，快速尋找適合的合作夥伴。`;
  const intro = `正在尋找${regionName}${industryName}工廠？OXM 整理${displayRegionName}地區相關製造商與工廠資訊，可查看工廠服務與基本資料，尋找適合的合作夥伴。`;
  const canonical = `${BRAND.url}/factories/${regionSlug}/${industrySlug}`;

  return { title, description, canonical, h1, intro };
}
