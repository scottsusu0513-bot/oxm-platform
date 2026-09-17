// /library（索引）與 /library/:slug（文章）的 route parsing + SEO 文案／
// structured data 產生邏輯，供 server（server/_core/vite.ts 的初始 HTML
// head 注入）與 client（LibraryIndex.tsx／LibraryArticle.tsx 的
// react-helmet-async）共用同一份規則——跟 shared/seo/subIndustryPages.ts
// 是同一種角色分工。這裡純資料查表（不查 DB，文章來源是
// shared/content/library.ts 的靜態常數），不需要 existence-gated
// noindex 判斷（跟子產業頁不同，圖書館文章不是「可能 0 筆工廠」的動態
// 結果頁，slug 合法就是 200 可索引，不合法就是真 404）。
import { LIBRARY_ARTICLES, LIBRARY_ARTICLE_BY_SLUG, type LibraryArticle } from "../content/library";
import { BRAND } from "./brand";
import { getBreadcrumbSchema, type JsonLdObject } from "./schema";

// ===== /library：全部館藏索引 =====

export function parseLibraryIndexPath(pathname: string): boolean {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return normalized === "/library";
}

export interface LibraryPageContent {
  title: string;
  description: string;
  canonical: string;
  h1: string;
}

const LIBRARY_INDEX_TITLE = "OXM 傳產圖書館｜台灣製造業代工知識索引";
const LIBRARY_INDEX_DESCRIPTION = "OXM 傳產圖書館整理代工基礎、製程與設備、材料知識與採購指南，讓製造業採購、品牌與工廠快速查找代工相關知識。";
const LIBRARY_INDEX_H1 = "OXM 傳產圖書館";

export function buildLibraryIndexContent(): LibraryPageContent {
  return {
    title: LIBRARY_INDEX_TITLE,
    description: LIBRARY_INDEX_DESCRIPTION,
    canonical: `${BRAND.url}/library`,
    h1: LIBRARY_INDEX_H1,
  };
}

export function buildLibraryIndexBreadcrumbJsonLd(): JsonLdObject {
  return getBreadcrumbSchema([{ name: "傳產圖書館", path: "/library" }]);
}

// ===== /library/:slug：單篇文章 =====

export interface ResolvedLibraryArticle {
  slug: string;
  article: LibraryArticle;
}

/** 解析 "/library/:slug"（單一段，結尾斜線已忽略），其他路徑（含 /library 本身、兩段以上）回傳 null。 */
export function parseLibraryArticlePath(pathname: string): { slug: string } | null {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const m = normalized.match(/^\/library\/([^/]+)$/);
  if (!m) return null;
  return { slug: m[1] };
}

/** slug 對不到任何已知文章時回傳 null（呼叫端應視為非法 slug，回真 404）。 */
export function resolveLibraryArticle(slug: string): ResolvedLibraryArticle | null {
  const article = LIBRARY_ARTICLE_BY_SLUG[slug];
  if (!article) return null;
  return { slug, article };
}

export function buildLibraryArticleContent(resolved: ResolvedLibraryArticle): LibraryPageContent {
  const { slug, article } = resolved;
  return {
    title: `${article.title}｜OXM 傳產圖書館`,
    description: article.metaDescription,
    canonical: `${BRAND.url}/library/${slug}`,
    h1: article.h1,
  };
}

/**
 * BreadcrumbList：首頁 → 傳產圖書館（/library）→ 文章（自己，不可點擊）。
 * 不加入 category 這一層——分類目前只是 index 頁上的篩選狀態，不是獨立
 * route（沒有 /library/:category 這種可直接輸入網址開啟的頁面），加進
 * breadcrumb 會虛構一個不存在的 URL 層級。
 */
export function buildLibraryArticleBreadcrumbJsonLd(resolved: ResolvedLibraryArticle): JsonLdObject {
  const { slug, article } = resolved;
  return getBreadcrumbSchema([
    { name: "傳產圖書館", path: "/library" },
    { name: article.h1, path: `/library/${slug}` },
  ]);
}

/**
 * Article JSON-LD（見任務定案「Article 至少：headline／description／
 * datePublished／dateModified／author／publisher／mainEntityOfPage／url」）。
 * author／publisher 一律用全站共用的 BRAND 常數，不逐篇填——這 3 篇文章
 * 都是 OXM 編輯整理的內容，沒有個別具名作者。
 */
export function buildLibraryArticleJsonLd(resolved: ResolvedLibraryArticle): JsonLdObject {
  const { slug, article } = resolved;
  const url = `${BRAND.url}/library/${slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.metaDescription,
    datePublished: new Date(article.publishedAt).toISOString(),
    dateModified: new Date(article.updatedAt).toISOString(),
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: { "@type": "Organization", name: BRAND.name, url: BRAND.url },
    publisher: {
      "@type": "Organization",
      name: BRAND.name,
      url: BRAND.url,
      logo: { "@type": "ImageObject", url: BRAND.logo },
    },
  };
}

/**
 * FAQPage JSON-LD：只在文章真的有 faq 欄位時回傳（否則 null，呼叫端不
 * 注入）——不是每篇文章都硬加。文字直接取自 article.faq，跟畫面上渲染的
 * 「常見問題」區塊讀同一份資料，保證 rendered 內容與 schema 逐字一致。
 */
export function buildLibraryArticleFaqJsonLd(resolved: ResolvedLibraryArticle): JsonLdObject | null {
  const { article } = resolved;
  if (!article.faq || article.faq.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: article.faq.map(qa => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
  };
}

/** 文章頁完整 JSON-LD 陣列（Article + Breadcrumb + FAQPage?），供 server 端注入與 client 端 <script> 共用同一份組合順序。 */
export function buildLibraryArticleAllJsonLd(resolved: ResolvedLibraryArticle): JsonLdObject[] {
  const faq = buildLibraryArticleFaqJsonLd(resolved);
  return [
    buildLibraryArticleJsonLd(resolved),
    buildLibraryArticleBreadcrumbJsonLd(resolved),
    ...(faq ? [faq] : []),
  ];
}

// ===== 舊 /blog/:slug → 新 /library/:slug 301 永久轉址 =====
//
// 只有這 3 筆 hardcode mapping（見任務定案「這是有限的歷史 URL
// migration，不是 taxonomy，允許 hardcode」）：這 3 個舊 slug 剛好跟新
// slug 完全相同（沿用原名，盡量原地保留殘留的 SEO 訊號，見任務定案），
// 對映表本身仍然明確寫出「舊 → 新」兩個值，不是靠「反正 slug 一樣」偷懶
// 省略，未來若某篇文章改名，只需要改這裡的右值，不影響 LIBRARY_ARTICLES
// 的 slug。沒有列在這裡的其他 /blog/* 路徑（含任何已不存在的舊 slug）
// 一律回傳 null，交給 server/_core/goneRoutes.ts 繼續回 410——不是「全部
// /blog 都轉到 /library」。
const LEGACY_BLOG_TO_LIBRARY_SLUG: Record<string, string> = {
  "what-is-moq": "what-is-moq",
  "oem-vs-odm": "oem-vs-odm",
  "first-time-factory-guide": "first-time-factory-guide",
};

/**
 * pathname 是 "/blog/:slug" 且該 slug 有對應新文章時，回傳
 * "/library/:newSlug"；否則回傳 null（呼叫端應維持既有 410 行為，不猜測、
 * 不轉去 /search 或首頁）。只吃乾淨的 pathname，不帶 query string——這 3
 * 篇舊文章網址沒有任何功能性 query，依任務定案直接捨棄，不無條件
 * preserve（呼叫端另外用 extractQueryString 判斷要不要保留，這裡不處理）。
 */
export function resolveLegacyBlogRedirect(pathname: string): string | null {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const m = normalized.match(/^\/blog\/([^/]+)$/);
  if (!m) return null;
  const newSlug = LEGACY_BLOG_TO_LIBRARY_SLUG[m[1]];
  return newSlug ? `/library/${newSlug}` : null;
}

export { LIBRARY_ARTICLES };
