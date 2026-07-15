// Schema.org JSON-LD 產生器：以固定 @id 串聯 Organization / WebSite / AboutPage /
// BreadcrumbList，供 client（react-helmet-async，見
// client/src/components/seo/JsonLd.tsx 的 renderJsonLd）與 server（初始 HTML
// head 注入，見 server/_core/publicPageMeta.ts）共用同一份定義，避免兩邊產生
// 互相矛盾的 Schema。內容以 shared/seo/brand.ts 的品牌常數為單一資料來源。
import { BRAND } from "./brand";

export type JsonLdObject = Record<string, unknown>;

export const ORGANIZATION_ID = `${BRAND.url}/#organization`;
export const WEBSITE_ID = `${BRAND.url}/#website`;
export const ABOUT_PAGE_ID = `${BRAND.url}/about#webpage`;

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

// 避免 JSON 字串中出現原始 "<" 字元（例如資料剛好包含 "</script>" 這類子字串時，
// 會提前結束 <script> 標籤），統一轉義為 "<"，其餘 JSON 內容不受影響。
// client（JsonLd.tsx）與 server（publicPageMeta.ts）皆呼叫這個同一份函式，
// 確保序列化規則一致。
export function toSafeJsonLdString(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
