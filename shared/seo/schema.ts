// Schema.org JSON-LD 產生器：以固定 @id 串聯 Organization / WebSite / AboutPage /
// BreadcrumbList，供 client（react-helmet-async，見
// client/src/components/seo/JsonLd.tsx 的 renderJsonLd）與 server（初始 HTML
// head 注入，見 server/_core/publicPageMeta.ts）共用同一份定義，避免兩邊產生
// 互相矛盾的 Schema。內容以 shared/seo/brand.ts 的品牌常數為單一資料來源。
import { BRAND } from "./brand";
import { getFaqQuestionsFlat } from "../content/faq";

export type JsonLdObject = Record<string, unknown>;

export const ORGANIZATION_ID = `${BRAND.url}/#organization`;
export const WEBSITE_ID = `${BRAND.url}/#website`;
export const ABOUT_PAGE_ID = `${BRAND.url}/about#webpage`;
export const FAQ_PAGE_ID = `${BRAND.url}/faq#faqpage`;

export function getOrganizationSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: BRAND.name,
    url: BRAND.url,
    logo: BRAND.logo,
    description: BRAND.description,
    areaServed: BRAND.serviceArea,
    sameAs: BRAND.sameAs,
  };
}

export function getWebsiteSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: BRAND.url,
    name: BRAND.name,
    alternateName: BRAND.shortDescription,
    publisher: { "@id": ORGANIZATION_ID },
    inLanguage: BRAND.language,
  };
}

export function getAboutPageSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": ABOUT_PAGE_ID,
    url: `${BRAND.url}/about`,
    name: "關於 OXM｜台灣傳統產業數位資源平台",
    description:
      "了解 OXM 如何整合台灣工廠媒合、企業升級、產業人才、品牌形象與產業資訊，成為台灣傳統產業的數位資源入口。",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORGANIZATION_ID },
    inLanguage: BRAND.language,
  };
}

export function getAboutBreadcrumbSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: BRAND.url },
      { "@type": "ListItem", position: 2, name: "關於 OXM", item: `${BRAND.url}/about` },
    ],
  };
}

export function getFaqPageSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": FAQ_PAGE_ID,
    url: `${BRAND.url}/faq`,
    name: "OXM 常見問答 FAQ",
    isPartOf: { "@id": WEBSITE_ID },
    inLanguage: BRAND.language,
    mainEntity: getFaqQuestionsFlat().map((q) => ({
      "@type": "Question",
      name: q.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: q.answerParagraphs.join("\n\n"),
      },
    })),
  };
}

export function getFaqBreadcrumbSchema(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: BRAND.url },
      { "@type": "ListItem", position: 2, name: "常見問答 FAQ", item: `${BRAND.url}/faq` },
    ],
  };
}

/**
 * 通用 BreadcrumbList 產生器：給任何真實存在的正式公開頁面階層使用（首頁
 * 一律是第一層，不需要重複傳入）。避免每個新頁面都各自手刻一份幾乎相同的
 * BreadcrumbList，同時仍保留每個呼叫端自己決定真實階層——items 只能填入
 * 網站上實際存在、可直接輸入網址開啟的頁面，不得虛構 URL 或建立不存在的
 * parent。見 server/_core/publicPageMeta.ts 的 getJsonLdForPath 呼叫方式：
 * /resources → 找資源（1 層）；/finance-optimization 等子服務 → 找資源 →
 * 該服務（2 層）；/brand → 找形象（1 層）；/short-video-marketing → 找形象 →
 * 短影音與品牌內容行銷（2 層）。
 */
export function getBreadcrumbSchema(items: { name: string; path: string }[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "首頁", item: BRAND.url },
      ...items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 2,
        name: item.name,
        item: `${BRAND.url}${item.path}`,
      })),
    ],
  };
}

// 避免 JSON 字串中出現原始 "<" 字元（例如資料剛好包含 "</script>" 這類子字串時，
// 會提前結束 <script> 標籤），統一轉義為 "<"，其餘 JSON 內容不受影響。
// client（JsonLd.tsx）與 server（publicPageMeta.ts）皆呼叫這個同一份函式，
// 確保序列化規則一致。
export function toSafeJsonLdString(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
