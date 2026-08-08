// 固定公開頁面的 SEO 設定（title／description／canonical／OG），供 client
// （Helmet head）與 server（初始 HTML head 注入，見
// server/_core/publicPageMeta.ts）共用同一份資料，避免兩邊描述互相矛盾。
//
// og:image 使用 og-image.png——這是目前全站唯一已確認、實際在多個頁面
// （IndustryPage／BlogPost／BlogList／FactoryDetail 的預設值）及
// server/_core/ogMeta.ts 的 DEFAULT_OG_IMAGE 中使用中的社群預覽圖；首頁與
// About 目前都沒有各自專屬的 OG 圖，因此兩者皆採用這張已確認存在的預設圖。
import { BRAND } from "./brand";

export interface PublicPageSeo {
  path: string;
  title: string;
  description: string;
  canonical: string;
  ogType: string;
  ogImage: string;
  language: string;
}

const OG_IMAGE = `${BRAND.url}/og-image.png`;

export const PUBLIC_PAGE_SEO = {
  home: {
    path: "/",
    title: "OXM｜台灣工廠媒合與傳統產業數位資源平台",
    description: BRAND.description,
    canonical: `${BRAND.url}/`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  about: {
    path: "/about",
    title: "關於 OXM｜台灣傳統產業數位資源平台",
    description:
      "了解 OXM 如何整合台灣工廠媒合、企業升級、產業人才、品牌形象與產業資訊，成為台灣傳統產業的數位資源入口。",
    canonical: `${BRAND.url}/about`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // title/description 與 client/src/pages/EnterpriseUpgradeCenter.tsx 既有
  // 的 Helmet 內容保持一致，這裡只是把同一份文案也用於伺服器端初始 HTML
  // head 注入（該頁原本完全沒有 canonical，也沒有任何伺服器端注入）。
  upgradeCenter: {
    path: "/upgrade-center",
    title: "企業升級中心｜OXM",
    description: "OXM 企業升級中心，協助台灣企業取得政府補助與轉型資源，包含 SBIR、CITD、SIIR 等計畫媒合服務。",
    canonical: `${BRAND.url}/upgrade-center`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
} as const satisfies Record<string, PublicPageSeo>;

export type PublicPageKey = keyof typeof PUBLIC_PAGE_SEO;

/** 依 request pathname（已去除 query string，結尾斜線已忽略）比對固定公開頁設定。 */
export function getPublicPageSeoByPath(pathname: string): PublicPageSeo | null {
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (normalized === "" || normalized === "/") return PUBLIC_PAGE_SEO.home;
  if (normalized === "/about") return PUBLIC_PAGE_SEO.about;
  if (normalized === "/upgrade-center") return PUBLIC_PAGE_SEO.upgradeCenter;
  return null;
}
