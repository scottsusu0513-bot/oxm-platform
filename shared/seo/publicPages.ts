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
  // title/description 與 client/src/pages/News.tsx 既有的 Helmet 內容保持
  // 一致，這裡只是把同一份文案也用於伺服器端初始 HTML head 注入（該頁原本
  // 完全沒有伺服器端注入，raw HTML 顯示的是全站通用預設 title）。
  //
  // 正式開站前命名統一：導覽列短名稱維持「找消息」，但頁面正式品牌名稱
  // 統一為「產業情報中心」（title／description／OG／個別文章 title 皆同步，
  // 見 server/_core/ogMeta.ts buildNewsTitle／NEWS_GENERIC_FALLBACK、
  // client/src/pages/NewsDetail.tsx headTitle）。H1 本身（NEWS_CONTENT.heroH1）
  // 維持既有的自然語句，不強改成純品牌名稱——「產業情報中心」已經透過
  // eyebrow 小標籤（News.tsx Hero 區塊）、title、Navbar 下拉主名稱等多處
  // 清楚出現，不需要犧牲 H1 的可讀性。
  news: {
    path: "/news",
    title: "產業情報中心｜台灣傳統產業消息、展覽與產業資訊｜OXM",
    description: "OXM 產業情報中心整理台灣傳統產業的重要消息、競賽、展覽與產業資訊，協助企業掌握產業動態。",
    canonical: `${BRAND.url}/news`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // 找資源六大主入口代表頁：/resources 本身內容完整（五項服務分類介紹），
  // 不是 thin page，維持可索引。title/description 與
  // client/src/pages/ResourceCenter.tsx 既有的 Helmet 內容保持一致。
  resources: {
    path: "/resources",
    title: "找資源｜企業升級與傳統產業專業資源｜OXM",
    description: "OXM 為企業整理的專業資源入口，目前提供政府補助與企業升級服務媒合；財務優化、ISO 與低碳認證、ERP 與產線優化、短影音與品牌行銷等服務準備中。",
    canonical: `${BRAND.url}/resources`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // 找人才／找形象：六大主入口的「準備開放中」Landing Page，見
  // client/src/components/SectionComingSoon.tsx。title/description 與頁面
  // 自己的 Helmet 保持一致。這兩頁目前設 noindex,follow（見
  // server/_core/security.ts 的 NOINDEX_FOLLOW_EXACT_PATHS）——內容篇幅較短，
  // 先不索引，日後正式開放、內容補齊後再移除該清單即可恢復索引。
  talent: {
    path: "/talent",
    title: "找人才｜傳統產業人才媒合｜OXM",
    description: "OXM 找人才正在準備中，未來將整合技能訓練、人才媒合與傳統產業就業資源，敬請期待。",
    canonical: `${BRAND.url}/talent`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  brand: {
    path: "/brand",
    title: "找形象｜企業品牌與數位形象資源｜OXM",
    description: "OXM 找形象正在準備中，未來將整合品牌設計、企業形象、商業攝影與相關專業資源，敬請期待。",
    canonical: `${BRAND.url}/brand`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // 找討論：七大主入口第三個「準備開放中」Landing Page，沿用既有 /community
  // route（見 client/src/pages/Community.tsx 的 canAccessCommunity 權限判斷
  // 與 client/src/components/community/CommunityComingSoon.tsx），不是新建
  // 的獨立路由。title/description 與該元件自己的 Helmet 保持一致。
  //
  // 正式開站前命名統一：導覽列短名稱維持「找討論」，頁面正式品牌名稱統一為
  // 「臺灣傳產論壇」。**索引狀態刻意維持 noindex,follow**——shared/const.ts
  // 的 COMMUNITY_FEATURE_STATUS 目前是 "beta"，client/src/pages/Community.tsx
  // 的 canAccessCommunity() 對非管理員一律回傳 false，任何匿名訪客／
  // Googlebot 實際看到的都還是 CommunityComingSoon 的「準備中」畫面，不是
  // 真正的討論版內容。這是產品明確決策（見任務回報）：先把命名／SEO 文案
  // 準備好，索引狀態留待 COMMUNITY_FEATURE_STATUS 正式切換為 "live" 後再
  // 一併處理，這輪不切換、不解除 noindex、不加入 sitemap。
  //
  // description 使用的是「臺灣傳產論壇」的正式概念描述（未提及準備中），
  // 這是刻意的產品決策——因為目前 noindex，這段文字不會出現在 Google
  // 搜尋結果，只有 og:description（社群分享預覽卡片）可能用到；頁面上
  // 實際顯示給訪客的內容仍然透過 SectionComingSoon 元件本身的「準備開放
  // 中・敬請期待」狀態徽章清楚傳達尚未開放，不會誤導真正造訪頁面的使用者。
  discussion: {
    path: "/community",
    title: "臺灣傳產論壇｜產業交流、技術討論與合作需求｜OXM",
    description: "臺灣傳產論壇是 OXM 提供給台灣傳統產業交流實務經驗、技術問題與合作需求的產業討論空間。",
    canonical: `${BRAND.url}/community`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // title/description 與 client/src/pages/FAQ.tsx 既有的 Helmet 內容保持
  // 一致，這裡只是把同一份文案也用於伺服器端初始 HTML head 注入。
  faq: {
    path: "/faq",
    title: "OXM 常見問答 FAQ｜台灣製造業與傳統產業媒合平台",
    description: "整理台灣製造業與傳統產業最常見的市場、經營轉型、資源工具與 OXM 平台相關問題，找不到答案也能直接問 OXM AI。",
    canonical: `${BRAND.url}/faq`,
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
  if (normalized === "/news") return PUBLIC_PAGE_SEO.news;
  if (normalized === "/resources") return PUBLIC_PAGE_SEO.resources;
  if (normalized === "/talent") return PUBLIC_PAGE_SEO.talent;
  if (normalized === "/brand") return PUBLIC_PAGE_SEO.brand;
  if (normalized === "/community") return PUBLIC_PAGE_SEO.discussion;
  if (normalized === "/faq") return PUBLIC_PAGE_SEO.faq;
  return null;
}
