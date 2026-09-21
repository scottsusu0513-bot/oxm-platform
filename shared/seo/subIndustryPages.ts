// /factories/:subIndustrySlug（全台子產業）與
// /factories/:regionSlug/:subIndustrySlug（地區 × 子產業）的 route parsing +
// SEO 文案產生邏輯，供 server（server/_core/vite.ts 的初始 HTML head／body
// 注入）與 client（client/src/pages/SubIndustryPage.tsx、
// RegionIndustryPage.tsx 的 react-helmet-async）共用同一份規則，跟
// shared/seo/regionIndustryPages.ts 是同一種角色分工：這裡純資料查表（不查
// DB），DB existence／noindex 判斷邏輯在 server 端
// （server/_core/ogMeta.ts 的 buildSubIndustryMeta／buildRegionSubIndustryMeta），
// 因為需要非同步查詢 factories 表。
//
// 這裡刻意跟 shared/seo/industryPages.ts（/industry/:slug/:sub，傳產圖書館
// 長文頁）完全分開——那是另一個頁面家族，本輪不延伸、不共用內容函式，見
// shared/constants.ts 的 SubIndustrySearchEntry 說明。
import {
  SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY, SUB_INDUSTRY_SEARCH_ENTRIES, type SubIndustrySearchEntry,
  REGION_SLUG_TO_NAME, REGION_DISPLAY_NAMES, SPLIT_SUB_INDUSTRY_NOTICES,
} from "../constants";
import { BRAND } from "./brand";
import { getBreadcrumbSchema, type JsonLdObject } from "./schema";

/**
 * 「塑膠包裝」目前是全部子產業裡唯一 label 重複的 entry（parent-aware
 * collision，見 shared/constants.ts 的說明）——H1 允許兩筆 entry 都顯示同樣
 * 的 displayName（使用者定案「title / H1 可以都顯示『塑膠包裝』」），但
 * title／description 如果完全不帶任何區分文字，會變成兩個不同 canonical
 * URL 卻輸出逐字相同的 <title>，這是應該避免的 duplicate content 訊號。
 * 這裡用「這個 label 是否對應到一筆以上 entry」通用判斷要不要在 title／
 * description 額外帶 parentIndustry 當區分詞，不是針對「塑膠包裝」寫死的
 * 特例，未來如果 SUB_INDUSTRY_SEARCH_ENTRIES 又出現其他 label collision
 * 也會自動套用同一套規則。
 */
function isAmbiguousSubIndustryLabel(label: string): boolean {
  return SUB_INDUSTRY_SEARCH_ENTRIES.filter(e => e.label === label).length > 1;
}

// ===== 全台子產業：/factories/:subIndustrySlug =====

export interface ResolvedSubIndustry {
  subIndustrySlug: string;
  entry: SubIndustrySearchEntry;
}

/** 解析 "/factories/:slug"（單一段，結尾斜線已忽略），其他路徑（含兩段以上）回傳 null。 */
export function parseSubIndustryPath(pathname: string): { subIndustrySlug: string } | null {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const m = normalized.match(/^\/factories\/([^/]+)$/);
  if (!m) return null;
  return { subIndustrySlug: m[1] };
}

/** slug 對不到任何已知子產業時回傳 null（呼叫端應視為非法 slug，回真 404）。 */
export function resolveSubIndustry(subIndustrySlug: string): ResolvedSubIndustry | null {
  const entry = SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[subIndustrySlug];
  if (!entry) return null;
  return { subIndustrySlug, entry };
}

export interface SubIndustryPageContent {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  intro: string;
}

/**
 * 固定 template，只代入子產業 displayName／parentIndustry，不生成長篇文案、
 * 不虛構工廠數／產業歷史／產值、不使用「最推薦／最完整」等不可驗證敘述
 * （見任務定案「SEO intro 文案」）。displayName 只用於顯示（title／H1／
 * intro），DB 篩選／連到 /search 一律用 entry.label（完整原始值）。
 *
 * SEO keyword mapping override（見任務定案「子產業 SEO Keyword Mapping
 * 基礎架構」）：entry 上的 seoTitleOverride／metaDescriptionOverride／
 * seoIntroOverride／primarySeoKeyword 有值時優先採用，取代這裡的固定
 * template；沒有設定 override 的子產業（目前 66 個）完全不受影響，
 * 一律 fallback 沿用下面原本的公式。H1 只有在 primarySeoKeyword 有值時
 * 才會改用它（本輪定案「H1 允許使用 primarySeoKeyword」），title／
 * description／intro 則各自對應獨立的 override 欄位，四者互不牽動——
 * 例如只設定 primarySeoKeyword 沒設定 seoTitleOverride，title 仍然照舊公式
 * 生成（只是公式裡的 h1 部分會用新的 primarySeoKeyword）。
 */
export function buildSubIndustryPageContent(resolved: ResolvedSubIndustry): SubIndustryPageContent {
  const { subIndustrySlug, entry } = resolved;
  const ambiguous = isAmbiguousSubIndustryLabel(entry.label);
  const h1 = entry.primarySeoKeyword ?? `${entry.displayName}廠`;
  // label 有 collision 時（例如「塑膠包裝」同時屬於塑膠／包裝），title／
  // description 額外帶上（parentIndustry）區分，避免兩個不同 canonical URL
  // 輸出逐字相同的 <title>；H1 維持不變，兩筆 entry 都正常顯示同樣的
  // displayName（見上方 isAmbiguousSubIndustryLabel 說明）。
  const defaultTitle = ambiguous
    ? `${h1}｜台灣${entry.displayName}廠（${entry.parentIndustry}）搜尋與詢價｜OXM`
    : `${h1}｜台灣${entry.displayName}廠搜尋與詢價｜OXM`;
  const defaultDescription = ambiguous
    ? `尋找台灣${entry.displayName}廠？OXM 整理${entry.parentIndustry}底下可承接${entry.displayName}需求的製造業者，可依地區、代工模式、可接小量與可打樣等條件進一步篩選與詢價。`
    : `尋找台灣${entry.displayName}廠？OXM 整理可承接${entry.displayName}需求的製造業者，可依地區、代工模式、可接小量與可打樣等條件進一步篩選與詢價。`;
  const defaultIntro = `${entry.displayName}是${entry.parentIndustry}底下的子產業。OXM 整理台灣可承接${entry.displayName}需求的工廠與工作室資訊，可使用 OXM 的搜尋功能依地區、類型、ODM／OEM／OBM 代工模式，以及可接小量、可打樣等生產條件進一步篩選，並直接送出詢價。`;

  const title = entry.seoTitleOverride ?? defaultTitle;
  const description = entry.metaDescriptionOverride ?? defaultDescription;
  const intro = entry.seoIntroOverride ?? defaultIntro;
  const canonical = `${BRAND.url}/factories/${subIndustrySlug}`;
  return { title, description, canonical, h1, intro };
}

/**
 * BreadcrumbList 結構化資料：首頁 → 找工廠（/search）→ 所屬主產業
 * （/industry/:parentIndustrySlug，既有合法頁面）→ 子產業（自己，不可點擊）。
 * 沒有「全台主產業」的 /factories/ 頁面，所屬主產業唯一合法可連結的頁面是
 * 既有的 /industry/:slug（見任務定案「breadcrumb 不要創造不存在的假 URL」）。
 */
export function buildSubIndustryBreadcrumbJsonLd(resolved: ResolvedSubIndustry): JsonLdObject {
  const { subIndustrySlug, entry } = resolved;
  return getBreadcrumbSchema([
    { name: "找工廠", path: "/search" },
    { name: entry.parentIndustry, path: `/industry/${entry.parentIndustrySlug}` },
    { name: entry.displayName, path: `/factories/${subIndustrySlug}` },
  ]);
}

// ===== 舊子產業 slug 拆分過渡頁：/factories/:subIndustrySlug（slug 在
// SPLIT_SUB_INDUSTRY_NOTICES 裡）=====
//
// 這組跟上面的 resolveSubIndustry／buildSubIndustryPageContent 是平行的兩條
// 路徑，呼叫端（SubIndustryPage.tsx、server/_core/ogMeta.ts）必須先試這裡、
// 沒有才 fallback 試 resolveSubIndustry——SPLIT_SUB_INDUSTRY_NOTICES 的 key
// 已經從 SUB_INDUSTRY_SEARCH_ENTRIES 移除，resolveSubIndustry 對它們一律
// 回 null。

export interface ResolvedSplitSubIndustryNotice {
  subIndustrySlug: string;
  label: string;
  parentIndustry: string;
  parentIndustrySlug: string;
  /** 拆分後的新分類 entry（已從 SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY 反查出完整資料）。 */
  successors: SubIndustrySearchEntry[];
}

/** slug 不是已知的「拆分過渡」slug 時回傳 null。 */
export function resolveSplitSubIndustryNotice(subIndustrySlug: string): ResolvedSplitSubIndustryNotice | null {
  const notice = SPLIT_SUB_INDUSTRY_NOTICES[subIndustrySlug];
  if (!notice) return null;
  const successors = notice.successorSlugs
    .map(slug => SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[slug])
    .filter((e): e is SubIndustrySearchEntry => Boolean(e));
  return {
    subIndustrySlug,
    label: notice.label,
    parentIndustry: notice.parentIndustry,
    parentIndustrySlug: notice.parentIndustrySlug,
    successors,
  };
}

export interface SplitSubIndustryNoticeContent {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  intro: string;
}

/**
 * 固定 template：明確告知舊分類已拆分成哪些新分類，不 301（舊分類同時涵蓋
 * 多個新分類的語意，沒有單一等價頁面可以轉址），canonical 自我指向（不指向
 * 任一個新分類頁，避免暗示其中一個是「正確」的那個）。呼叫端另外要自行加
 * noindex（見 server/_core/ogMeta.ts buildSubIndustryMeta 的說明）避免跟新
 * 分類頁產生重複內容。
 */
export function buildSplitSubIndustryNoticeContent(resolved: ResolvedSplitSubIndustryNotice): SplitSubIndustryNoticeContent {
  const { subIndustrySlug, label, parentIndustry, successors } = resolved;
  const successorNames = successors.map(s => s.displayName).join("、");
  const h1 = `「${label}」分類已重新整理`;
  const title = `${h1}｜${parentIndustry}｜OXM`;
  const description = `「${label}」子分類已拆分為${successorNames}，請至新的分類頁面查看廠商並直接詢價。`;
  const intro = `「${label}」原本同時涵蓋不同的能力範圍，OXM 已將它拆分為${successorNames}，方便更精準地依需求篩選與詢價。`;
  const canonical = `${BRAND.url}/factories/${subIndustrySlug}`;
  return { title, description, canonical, h1, intro };
}

/**
 * BreadcrumbList：跟 buildSubIndustryBreadcrumbJsonLd 同一種角色分工，最後一
 * 段用過渡頁自己的 h1（而不是任一個新分類的 displayName），因為這頁本身不
 * 代表任何單一子產業。
 */
export function buildSplitSubIndustryNoticeBreadcrumbJsonLd(resolved: ResolvedSplitSubIndustryNotice): JsonLdObject {
  const { subIndustrySlug, label, parentIndustry, parentIndustrySlug } = resolved;
  return getBreadcrumbSchema([
    { name: "找工廠", path: "/search" },
    { name: parentIndustry, path: `/industry/${parentIndustrySlug}` },
    { name: `「${label}」分類已重新整理`, path: `/factories/${subIndustrySlug}` },
  ]);
}

// ===== 地區 × 子產業：/factories/:regionSlug/:subIndustrySlug =====

export interface ResolvedRegionSubIndustry {
  regionSlug: string;
  subIndustrySlug: string;
  /** TAIWAN_REGIONS 的完整 canonical 值，底層 filter 必須用這個。 */
  regionName: string;
  /** 只供顯示用，絕不可用於 filter／DB 查詢。 */
  displayRegionName: string;
  entry: SubIndustrySearchEntry;
}

/**
 * 把 regionSlug／subIndustrySlug 解析成 canonical 值；任一個 slug 對不到
 * 已知值時回傳 null。呼叫端在判斷 "/factories/:region/:second" 的第二段
 * 究竟是主產業還是子產業時，必須跟 resolveRegionIndustry
 * （shared/seo/regionIndustryPages.ts）一起用，見
 * shared/seo/factoriesPathResolver.ts 的 resolveFactoriesTwoSegment。
 */
export function resolveRegionSubIndustry(regionSlug: string, subIndustrySlug: string): ResolvedRegionSubIndustry | null {
  const regionName = REGION_SLUG_TO_NAME[regionSlug];
  const entry = SUB_INDUSTRY_SEARCH_SLUG_TO_ENTRY[subIndustrySlug];
  if (!regionName || !entry) return null;

  return {
    regionSlug,
    subIndustrySlug,
    regionName,
    displayRegionName: REGION_DISPLAY_NAMES[regionName] ?? regionName,
    entry,
  };
}

export interface RegionSubIndustryPageContent {
  title: string;
  description: string;
  canonical: string;
  h1: string;
  intro: string;
}

export function buildRegionSubIndustryPageContent(resolved: ResolvedRegionSubIndustry): RegionSubIndustryPageContent {
  const { regionSlug, subIndustrySlug, regionName, displayRegionName, entry } = resolved;
  const ambiguous = isAmbiguousSubIndustryLabel(entry.label);

  const h1 = `${displayRegionName}${entry.displayName}廠`;
  // 理由同 buildSubIndustryPageContent：label 有 collision 時 title／
  // description 額外帶 parentIndustry 區分，H1 維持不變。
  const title = ambiguous
    ? `${h1}｜${entry.displayName}（${entry.parentIndustry}）搜尋與詢價｜OXM`
    : `${h1}｜${entry.displayName}搜尋與詢價｜OXM`;
  const description = ambiguous
    ? `尋找${displayRegionName}${entry.displayName}廠？查看${regionName}地區${entry.parentIndustry}底下可承接${entry.displayName}需求的製造業者，並可依代工模式、生產條件等進一步篩選與詢價。`
    : `尋找${displayRegionName}${entry.displayName}廠？查看${regionName}地區可承接${entry.displayName}需求的製造業者，並可依代工模式、生產條件等進一步篩選與詢價。`;
  const intro = `正在尋找${regionName}${entry.displayName}廠？OXM 整理${displayRegionName}地區可承接${entry.displayName}需求的工廠與工作室資訊（${entry.displayName}為${entry.parentIndustry}底下的子產業），可使用 OXM 的搜尋功能依代工模式、可接小量、可打樣等生產條件進一步篩選，並直接送出詢價。`;
  const canonical = `${BRAND.url}/factories/${regionSlug}/${subIndustrySlug}`;

  return { title, description, canonical, h1, intro };
}

/**
 * BreadcrumbList：首頁 → 找工廠 → 該地區×該子產業所屬主產業的既有 SEO 頁
 * （/factories/:region/:parentIndustrySlug，跟這個子產業頁同一個地區、真實
 * 存在的合法頁面）→ 子產業（自己）。優先連到「同地區的主產業頁」而不是
 * /industry/:slug（全台，不含地區），因為前者跟目前這頁的地區語境更一致，
 * 也是任務定案「若 parent industry 頁可連結，優先連至既有合法 SEO landing
 * page」下最貼近的既有頁面。
 */
export function buildRegionSubIndustryBreadcrumbJsonLd(resolved: ResolvedRegionSubIndustry): JsonLdObject {
  const { regionSlug, subIndustrySlug, displayRegionName, entry } = resolved;
  return getBreadcrumbSchema([
    { name: "找工廠", path: "/search" },
    { name: `${displayRegionName}${entry.parentIndustry}廠`, path: `/factories/${regionSlug}/${entry.parentIndustrySlug}` },
    { name: `${displayRegionName}${entry.displayName}廠`, path: `/factories/${regionSlug}/${subIndustrySlug}` },
  ]);
}
