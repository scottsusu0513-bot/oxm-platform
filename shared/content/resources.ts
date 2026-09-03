// /resources（找資源總覽）正文的單一資料來源：只抽出需要被 build-time
// 預渲染腳本（scripts/prerender-resources.ts）共用的固定文字——H1（純文字
// 版）、intro、與五項服務的可見文字（title/subtitle/description/tags/
// href/available）。避免 client/src/pages/ResourceCenter.tsx 與 prerender
// 腳本各自維護一份文案、日後兩邊不一致。
//
// 不放版型／樣式／icon／分類篩選 key（category）／配色（tone）這些只有
// ResourceCenter.tsx 自己會用到的東西。
//
// H1 在畫面上是 "先找到問題，<br className="hidden sm:block" />再選擇適合
// 的資源"——中間那個只在桌面生效的響應式換行是純排版考量，ResourceCenter.tsx
// 維持原本的 JSX 手刻結構不變，這裡只保留給 prerender 用的純文字版本（與
// shared/content/home.ts 的 compareSection.title 是同一種處理方式）。

export interface ResourceServiceContent {
  title: string;
  subtitle: string;
  description: string;
  href: string;
  /** 目前是否已正式開放並可點擊進入；false 時畫面顯示「敬請期待」，不可互動。 */
  available: boolean;
  tags: string[];
}

export const RESOURCES_CONTENT = {
  heroH1: "先找到問題，再選擇適合的資源",
  heroIntro: "找資源不是單一服務，而是 OXM 為企業整理的專業資源入口。依照目前最需要解決的問題，選擇適合的服務方向。",
  services: [
    {
      title: "政府補助與企業升級",
      subtitle: "從適用計畫到申請準備",
      description: "協助企業了解 SBIR、CITD、SIIR 等補助方向，先釐清需求與資格，再媒合適合的顧問資源。",
      href: "/upgrade-center",
      available: true,
      tags: ["政府補助", "資格初判", "顧問媒合"],
    },
    {
      title: "企業財務優化",
      subtitle: "看懂資金、成本與營運體質",
      description: "從財務現況盤點、融資準備到管理資訊整理，協助企業辨識問題並建立可執行的改善方向。",
      href: "/finance-optimization",
      // Final Public Index Release：Landing Page 已正式開放（見
      // server/_core/security.ts 移出 NOINDEX_EXACT_PATHS），此處同步改為
      // available:true，讓 /resources 提供真正 crawlable 的 <Link>，不再是
      // 「敬請期待」的不可互動狀態。
      available: true,
      tags: ["財務健檢", "融資準備", "管理改善"],
    },
    {
      title: "ISO 與低碳認證",
      subtitle: "從需求判斷到制度與查驗準備",
      description: "依企業需求協助判斷 ISO 管理系統、溫室氣體盤查、產品碳足跡與政府碳標籤等服務方向。",
      href: "/certification-center",
      available: true,
      tags: ["ISO", "碳盤查", "查驗協調"],
    },
    {
      title: "ERP、MES 與產線優化",
      subtitle: "先理順流程，再選擇系統與改善方式",
      description: "盤點訂單、採購、庫存、生產資訊與現場動線，協助判斷 ERP、MES、產線改善或整合導入方向。",
      href: "/erp-optimization",
      available: true,
      tags: ["ERP／MES", "流程盤點", "產線動線"],
    },
    // 「短影音與品牌內容行銷」正式改分類至「找形象」（見 client/src/pages/
    // Brand.tsx），不再屬於找資源。服務本身（/short-video-marketing route／
    // 申請流程／後台）完整保留，只是上層分類與導覽入口改變，不在這裡列出。
  ] satisfies ResourceServiceContent[],
};
