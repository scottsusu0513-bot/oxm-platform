// Schema.org JSON-LD 產生器：以固定 @id 串聯 Organization / WebSite / AboutPage /
// BreadcrumbList，供各頁面在 <Helmet> 內以 renderJsonLd(...) 呼叫使用
// （見 client/src/components/seo/JsonLd.tsx）。內容以 client/src/lib/brand.ts
// 的品牌常數為單一資料來源，避免各頁各自寫一份、日後描述不一致。
import { BRAND } from "@/lib/brand";
import type { JsonLdObject } from "@/components/seo/JsonLd";

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
