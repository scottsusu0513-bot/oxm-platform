// 針對固定公開頁（目前為 "/"、"/about" 與 "/faq"）在回傳 index.html 前，把 title／
// description／canonical／OG／JSON-LD 直接寫進初始 HTML，讓「檢視網頁原始碼」
// 與搜尋引擎爬蟲不需要等待 React 執行、由 react-helmet-async 寫入才看得到正確
// 的 SEO 資料。
//
// 設計刻意與 server/_core/ogMeta.ts（工廠頁 OG 注入）保持一致的模式：
// - 用註解 marker 包住整段注入內容，重新處理同一份字串時用同一個 regex 先
//   移除舊的 marker 區塊，確保重複呼叫不會疊加出重複內容（idempotent）。
// - title／meta description 用「先嘗試取代既有標籤，找不到才在 </head> 前插入」
//   的方式處理，避免脆弱的字串定位。
// - 所有動態值一律做 HTML escaping；JSON-LD 一律做 "<" -> "<" 轉義。
// - 不查資料庫（固定頁面，內容完全來自 shared/seo 常數）。
//
// JSON-LD 與其他節點的清理策略不同（重要，見下方 SERVER_TRANSIENT_ATTR 註解）：
// 直接讀 react-helmet-async@3.0.0 原始碼（node_modules/react-helmet-async/lib/
// index.esm.js 的 React19Dispatcher）確認：本專案是 React 19，Helmet 走的是
// React19Dispatcher，其 render() 直接回傳 React.createElement("title"/"meta"/
// "link"/"script", ...) 這些「一般 React 元素」，讓 React 19 原生的 head
// 節點提升（hoisting）機制去處理——但這個原生機制只對 <title>/<meta>/<link>
// 保證一定會被搬到 <head>；<script> 只有在有 src（外部、可被去重的資源腳本）
// 時才會被視為可提升的資源，我們這種沒有 src、用 dangerouslySetInnerHTML
// 塞 JSON 字串的「行內」script 不會被搬到 <head>，只會停留在 <Helmet> 元件
// 在畫面樹中原本的位置（也就是 <body> 內某處）。這正是實測「React 掛載後
// document.head 找不到任何 JSON-LD script」的根本原因：不是被清掉了，而是
// Helmet／React 19 從來沒有把它放進 <head> 過。
//
// 因此改採更可靠的作法：JSON-LD 完全交給 server 注入、React 掛載後永遠保留
// 不移除；Home.tsx／AboutOXM.tsx 不再呼叫 renderJsonLd()。title／description／
// canonical／OG 則仍交給 Helmet（這些都會被 React 19 正確 hoist 到 head），
// 所以這些節點才需要在 React 掛載後被移除，避免與 Helmet 版重複。
import { escapeHtml } from "./ogMeta";
import { BRAND } from "@shared/seo/brand";
import { getPublicPageSeoByPath, type PublicPageSeo } from "@shared/seo/publicPages";
import {
  getOrganizationSchema,
  getWebsiteSchema,
  getAboutPageSchema,
  getAboutBreadcrumbSchema,
  getFaqPageSchema,
  getFaqBreadcrumbSchema,
  getBreadcrumbSchema,
  toSafeJsonLdString,
  type JsonLdObject,
} from "@shared/seo/schema";

const SEO_MARKER_START = "<!-- oxm-public-seo:start -->";
const SEO_MARKER_END = "<!-- oxm-public-seo:end -->";

// title／description／canonical／OG：React 掛載後會被 Helmet 重新宣告同一組
// 節點，所以這些節點要能被前端安全移除，一律標記 data-oxm-seo-transient="true"。
// 見 client/src/hooks/useRemoveServerSeoHead.ts。
const TRANSIENT_ATTR = 'data-oxm-seo-transient="true"';

// JSON-LD：完全交給 server、React 掛載後永遠保留，不套用 TRANSIENT_ATTR，
// 前端清理 hook 不會移除它。data-oxm-seo-source="server" 只作為標示/除錯用途
// （表明這是伺服器輸出的節點），不驅動任何清理邏輯。
const SERVER_SOURCE_ATTR = 'data-oxm-seo-source="server"';

function jsonLdScriptTag(data: JsonLdObject): string {
  return `<script type="application/ld+json" ${SERVER_SOURCE_ATTR}>${toSafeJsonLdString(data)}</script>`;
}

function getJsonLdForPath(pathname: string): JsonLdObject[] {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (normalized === "" || normalized === "/") {
    return [getOrganizationSchema(), getWebsiteSchema()];
  }
  if (normalized === "/about") {
    return [getAboutPageSchema(), getAboutBreadcrumbSchema()];
  }
  if (normalized === "/faq") {
    return [getFaqPageSchema(), getFaqBreadcrumbSchema()];
  }
  // Final Public Index Release：找資源／找形象 Hub 與正式開放的子服務
  // Landing Page，補上 BreadcrumbList structured data，讓 Google 能從
  // schema 理解真實的 hub-and-spoke 階層（不虛構 URL、不建立不存在的
  // parent，皆為網站上實際可直接輸入網址開啟的頁面）。
  if (normalized === "/resources") {
    return [getBreadcrumbSchema([{ name: "找資源", path: "/resources" }])];
  }
  if (normalized === "/finance-optimization") {
    return [getBreadcrumbSchema([
      { name: "找資源", path: "/resources" },
      { name: "企業財務優化", path: "/finance-optimization" },
    ])];
  }
  if (normalized === "/certification-center") {
    return [getBreadcrumbSchema([
      { name: "找資源", path: "/resources" },
      { name: "ISO 與低碳認證", path: "/certification-center" },
    ])];
  }
  if (normalized === "/erp-optimization") {
    return [getBreadcrumbSchema([
      { name: "找資源", path: "/resources" },
      { name: "ERP、MES 與產線優化", path: "/erp-optimization" },
    ])];
  }
  if (normalized === "/brand") {
    return [getBreadcrumbSchema([{ name: "找形象", path: "/brand" }])];
  }
  if (normalized === "/short-video-marketing") {
    return [getBreadcrumbSchema([
      { name: "找形象", path: "/brand" },
      { name: "短影音與品牌內容行銷", path: "/short-video-marketing" },
    ])];
  }
  return [];
}

/**
 * 若 pathname 對應到有固定 SEO 設定的公開頁（目前為 "/" 與 "/about"），回傳
 * 注入後的 HTML；否則回傳 null（呼叫端應保留原本的預設 index.html 不變，不
 * 得回傳空 title）。
 */
export function injectPublicPageSeo(html: string, pathname: string): string | null {
  const seo = getPublicPageSeoByPath(pathname);
  if (!seo) return null;

  let out = html;

  const markerRe = new RegExp(`${SEO_MARKER_START}[\\s\\S]*?${SEO_MARKER_END}\\s*`, "g");
  out = out.replace(markerRe, "");

  const title = escapeHtml(seo.title);
  const description = escapeHtml(seo.description);

  // <title>／<meta name="description"> 標記 data-oxm-seo-transient="true"，
  // 取代掉 client/index.html 原本無標記的安全預設值，這樣就不會留下一個
  // 「沒有標記的舊 title/description」——取代後這兩個節點本身就是可辨識、
  // 可被前端清理 hook 安全移除的節點。
  const titleTag = `<title ${TRANSIENT_ATTR}>${title}</title>`;
  out = /<title[^>]*>[\s\S]*?<\/title>/i.test(out)
    ? out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, titleTag)
    : out.replace(/<\/head>/i, `  ${titleTag}\n  </head>`);

  // 用 [^>]* 而不是要求 name= 緊接在 <meta 後面：重新處理已經注入過、屬性
  // 順序是 data-oxm-seo-transient 在前、name="description" 在後的標籤時，才能
  // 正確比對到既有標籤並取代，而不是因為比對不到而額外插入一個重複標籤。
  const descRe = /<meta\s+[^>]*name=["']description["'][^>]*>/i;
  const descTag = `<meta ${TRANSIENT_ATTR} name="description" content="${description}">`;
  out = descRe.test(out)
    ? out.replace(descRe, descTag)
    : out.replace(/<\/head>/i, `  ${descTag}\n  </head>`);

  const block = renderPublicPageSeoBlock(seo, pathname);
  out = out.replace(/<\/head>/i, `  ${block}\n  </head>`);

  return out;
}

function renderPublicPageSeoBlock(seo: PublicPageSeo, pathname: string): string {
  const title = escapeHtml(seo.title);
  const description = escapeHtml(seo.description);
  const canonical = escapeHtml(seo.canonical);
  const ogImage = escapeHtml(seo.ogImage);
  const ogType = escapeHtml(seo.ogType);
  const siteName = escapeHtml(BRAND.name);
  const locale = seo.language === "zh-TW" ? "zh_TW" : escapeHtml(seo.language);

  const jsonLdTags = getJsonLdForPath(pathname).map(jsonLdScriptTag);

  return [
    SEO_MARKER_START,
    `<link ${TRANSIENT_ATTR} rel="canonical" href="${canonical}">`,
    `<meta ${TRANSIENT_ATTR} property="og:type" content="${ogType}">`,
    `<meta ${TRANSIENT_ATTR} property="og:site_name" content="${siteName}">`,
    `<meta ${TRANSIENT_ATTR} property="og:title" content="${title}">`,
    `<meta ${TRANSIENT_ATTR} property="og:description" content="${description}">`,
    `<meta ${TRANSIENT_ATTR} property="og:image" content="${ogImage}">`,
    `<meta ${TRANSIENT_ATTR} property="og:url" content="${canonical}">`,
    `<meta ${TRANSIENT_ATTR} property="og:locale" content="${locale}">`,
    ...jsonLdTags,
    SEO_MARKER_END,
  ].join("\n    ");
}
