// 固定公開頁面的 SEO 設定（title／description／canonical／OG），供 client
// （Helmet head）與 server（初始 HTML head 注入，見
// server/_core/publicPageMeta.ts）共用同一份資料，避免兩邊描述互相矛盾。
//
// og:image 使用 og-image.png——這是目前全站唯一已確認、實際在多個頁面
// （IndustryPage／FactoryDetail 的預設值）及
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
  // 找資源六大主入口代表頁：/resources 本身內容完整（四項服務分類介紹），
  // 不是 thin page，維持可索引。title/description 與
  // client/src/pages/ResourceCenter.tsx 既有的 Helmet 內容保持一致。
  // 「短影音與品牌內容行銷」正式改分類至找形象（/brand）。Final Public Index
  // Release：企業財務優化／ISO 與低碳認證／ERP 與產線優化三項服務已正式
  // 開放（見 shared/content/resources.ts 的 available 欄位），description
  // 同步移除「準備中」字樣。
  resources: {
    path: "/resources",
    title: "找資源｜企業升級與傳統產業專業資源｜OXM",
    description: "OXM 為企業整理的專業資源入口，提供政府補助與企業升級、企業財務優化、ISO 與低碳認證、ERP 與產線優化等服務媒合。",
    canonical: `${BRAND.url}/resources`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // 企業財務優化：/resources 下正式開放的服務 Landing Page（Final Public
  // Index Release 移出 server/_core/security.ts 的 NOINDEX_EXACT_PATHS）。
  // title/description 與 client/src/pages/FinanceOptimization.tsx 既有的
  // Helmet 內容保持一致，只是額外用於伺服器端初始 HTML head 注入。
  // /finance-optimization/apply 是申請表單，維持 noindex，不受影響。
  financeOptimization: {
    path: "/finance-optimization",
    title: "企業財務優化｜OXM",
    description: "合法節稅、融資優化、資金更靈活。專業顧問從稅務、融資、負債與現金流全面檢視企業體質，初次諮詢與企業財務體檢免費。",
    canonical: `${BRAND.url}/finance-optimization`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // ISO 與低碳認證：/resources 下正式開放的服務 Landing Page（Final Public
  // Index Release 移出 NOINDEX_EXACT_PATHS）。title 移除先前「（專區預覽）」
  // 字樣（頁面已不是預覽狀態）；description 取自頁面既有 H1 副文案（原本
  // Helmet 完全沒有 description）。/certification-center/apply 維持 noindex。
  certificationCenter: {
    path: "/certification-center",
    title: "ISO 與低碳認證專區｜OXM",
    description: "OXM 協助工廠釐清客戶、投標、品質、環境與碳管理需求，媒合適合的輔導與查驗資源。",
    canonical: `${BRAND.url}/certification-center`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // ERP、MES 與產線優化：/resources 下正式開放的服務 Landing Page（Final
  // Public Index Release 移出 NOINDEX_EXACT_PATHS）。title/description 與
  // client/src/pages/ErpOptimization.tsx 既有的 Helmet 內容保持一致。
  // /erp-optimization/apply 維持 noindex。
  erpOptimization: {
    path: "/erp-optimization",
    title: "製造業ERP導入與產線動線規劃｜OXM",
    description: "OXM 協助工廠釐清 ERP、MES、管理流程與產線動線需求，媒合適合的顧問及系統整合資源。初步諮詢免費。",
    canonical: `${BRAND.url}/erp-optimization`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // 找人才：六大主入口的「準備開放中」Landing Page，見
  // client/src/components/SectionComingSoon.tsx。title/description 與頁面
  // 自己的 Helmet 保持一致。目前設 noindex,follow（見
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
  // 找形象：正式從 Coming Soon 頁改為真正的服務 Hub（見
  // client/src/pages/Brand.tsx），整合短影音與品牌內容行銷（/short-video-marketing，
  // 已正式提供）與工廠形象攝影（/factory-photography，Coming Soon）兩項服務。
  // Final Public Index Release：/brand 本身正式開放索引（移出
  // server/_core/security.ts 的 NOINDEX_FOLLOW_EXACT_PATHS，加入 sitemap）。
  // description 做最小必要修正：工廠形象攝影目前仍是 Coming Soon、尚未正式
  // 提供，原文案「整合工廠形象攝影與短影音品牌內容服務」會讓人誤以為兩項
  // 服務都已正式開放，改為「目前提供短影音與品牌內容服務，並規劃工廠形象
  // 攝影」，如實反映兩項服務的真實狀態，不影響其餘文字。title 沿用不變。
  brand: {
    path: "/brand",
    title: "找形象｜工廠攝影與企業影音內容服務｜OXM",
    description: "OXM 找形象目前提供短影音與品牌內容服務，並規劃工廠形象攝影，協助傳統產業呈現設備、製程、產品與企業專業。",
    canonical: `${BRAND.url}/brand`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // 短影音與品牌內容行銷：找形象 Hub 下正式開放的服務 Landing Page（Final
  // Public Index Release 移出 server/_core/security.ts 的
  // NOINDEX_EXACT_PATHS）。title/description 與
  // client/src/pages/ShortVideoMarketing.tsx 既有的 Helmet 內容保持一致。
  // /short-video-marketing/apply 是申請表單，維持 noindex，不受影響。
  shortVideoMarketing: {
    path: "/short-video-marketing",
    title: "短影音與品牌內容行銷｜OXM",
    description: "把工廠裡的專業，拍成市場看得懂的內容。短影音企劃與拍攝、KOL 合作、社群內容代操、新聞媒體露出、訪談製作，可單獨選擇也可依目標組合。初步諮詢免費。",
    canonical: `${BRAND.url}/short-video-marketing`,
    ogType: "website",
    ogImage: OG_IMAGE,
    language: BRAND.language,
  },
  // 工廠形象攝影：找形象 Hub 底下正式子頁，本輪新建的服務介紹頁（非顧問案件
  // 系統，見 client/src/pages/FactoryPhotography.tsx）。title/description 與
  // 頁面自己的 Helmet 保持一致。同樣維持 noindex,follow（見
  // server/_core/security.ts 的 NOINDEX_FOLLOW_EXACT_PATHS），不加入
  // sitemap，等下一輪人工確認 UI 後再正式開放索引。
  factoryPhotography: {
    path: "/factory-photography",
    title: "工廠形象攝影｜企業商業攝影與品牌視覺｜OXM",
    description: "OXM 工廠形象攝影服務協助傳統產業拍攝廠房、設備、製程、產品與企業團隊，建立可應用於官網、型錄、社群與品牌宣傳的專業視覺素材。",
    canonical: `${BRAND.url}/factory-photography`,
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
  if (normalized === "/finance-optimization") return PUBLIC_PAGE_SEO.financeOptimization;
  if (normalized === "/certification-center") return PUBLIC_PAGE_SEO.certificationCenter;
  if (normalized === "/erp-optimization") return PUBLIC_PAGE_SEO.erpOptimization;
  if (normalized === "/talent") return PUBLIC_PAGE_SEO.talent;
  if (normalized === "/brand") return PUBLIC_PAGE_SEO.brand;
  if (normalized === "/short-video-marketing") return PUBLIC_PAGE_SEO.shortVideoMarketing;
  if (normalized === "/factory-photography") return PUBLIC_PAGE_SEO.factoryPhotography;
  if (normalized === "/community") return PUBLIC_PAGE_SEO.discussion;
  if (normalized === "/faq") return PUBLIC_PAGE_SEO.faq;
  return null;
}
