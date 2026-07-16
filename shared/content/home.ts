// 首頁（/）正文的單一資料來源：只抽出「需要被 build-time 預渲染腳本共用」的
// 固定文字與固定 URL，避免 client/src/pages/Home.tsx 與
// scripts/prerender-home.ts（或通用版 prerender-public-pages.ts）各自維護一份
// 文案、日後兩邊不一致。
//
// 不放版型／樣式／icon／動畫設定等只有 Home.tsx 自己會用到的東西。產業分類
// 名稱（INDUSTRY_OPTIONS）已經是 shared/constants.ts 的單一來源，這裡不重複
// 定義，直接在使用端 import 那份既有常數。
//
// 注意：首頁目前並沒有「找工廠／找資源／找人才／找形象／找消息／找討論」這組
// 六大服務入口——那是 /about 頁面獨有的區塊。首頁的固定核心結構其實是：
// 搜尋工具列（動態互動，不預渲染）、工廠 vs 工作室比較、十大產業分類、統計
// 數據、特色功能（為什麼選擇 OXM）、最終 CTA。本檔案依照首頁程式現況抽取，
// 不會憑空捏造畫面上不存在的六大服務項目。
//
// 也刻意不放 OXM 正式品牌定義句（shared/seo/brand.ts 的 BRAND.description）：
// 那句話只出現在 meta description／JSON-LD，不是首頁畫面上逐字可見的正文，
// 放進首頁預渲染片段會違反「只能包含實際可見內容」的原則。meta/JSON-LD 本身
// 不受影響，仍照舊使用 BRAND.description。

// 有幾句文案在畫面上是「一整句話中間插入彩色關鍵字」的樣式（例如「設備商」用
// 橘色、「產業服務」用紫色），用一組 segment（純文字或帶 highlight 標記）表示，
// Home.tsx 可以照樣重建帶顏色的 <span>，而 prerender 腳本只需要把每段文字
// 接起來即可、不需要在意顏色——避免同一句話在兩處各自維護一份純文字複本。
export type TextSegment = { text: string; highlight?: "orange" | "purple" };

export function segmentsToPlainText(segments: TextSegment[]): string {
  return segments.map(s => s.text).join("");
}

export const HOME_CONTENT = {
  // 語意化 H1（目前在畫面上是 sr-only，只有螢幕閱讀器/爬蟲會讀到，視覺上由
  // 下面的 heroHeadlineLine1/2 取代顯示，兩者皆為 Home.tsx 目前實際存在的文字）
  heroH1: "台灣傳統產業資源媒合平台",
  heroBadge: "台灣傳產資源媒合平台",
  heroHeadlineLine1: "找到適合你的",
  heroHeadlineLine2: "台灣傳產資源",
  // 最後兩段中間在畫面上有一個「僅桌面版生效」的響應式換行（手機版不斷行），
  // 這是純排版考量、不是語意上的斷句，所以拆成獨立兩段文字，讓 Home.tsx 自己
  // 決定要不要在兩段之間插入 <br className="hidden md:block" />。
  heroDescriptionParts: [
    { text: "整合全台工廠、OEM/ODM 代工、" },
    { text: "設備商", highlight: "orange" },
    { text: "、材料商與" },
    { text: "產業服務", highlight: "purple" },
    { text: "，讓品牌、企業、採購者與一般使用者" },
    { text: "都能更快找到合適的合作對象" },
  ] satisfies TextSegment[],

  compareSection: {
    // 「工廠 & 工作室，一次找齊」——畫面上「工廠」橘色、「&」灰色、「工作室」
    // 紫色三種不同樣式，比 TextSegment（只分 2 色）複雜，Home.tsx 這裡維持原本
    // 3 個 <span> 手刻結構不變，這裡只保留給 prerender 用的純文字版本。
    title: "工廠 & 工作室，一次找齊",
    subtitle: "不同需求，找到最合適的合作夥伴",
    cards: [
      {
        title: "工廠",
        subtitle: "ODM / OEM 製造",
        description: "專業大規模生產，擁有完整設備與生產線。適合需要量產的品牌商，提供 ODM 設計代工與 OEM 純製造服務。",
        bullets: ["大量生產，成本更低", "完整設備與品管流程", "ODM/OEM 彈性選擇"],
      },
      {
        title: "設計工作室",
        subtitle: "少量訂製・創意設計",
        description: "靈活接受少量訂單與特殊訂製需求。適合個人創作者、新創品牌與設計師，提供打樣服務與個性化製作。",
        bullets: ["少量接單，門檻低", "個性化訂製服務", "提供打樣與設計協助"],
      },
    ],
  },

  industriesSection: {
    title: "熱門產業分類",
    subtitle: "涵蓋十大產業，快速找到您需要的合作夥伴",
    // 產業名稱本身沿用 shared/constants.ts 的 INDUSTRY_OPTIONS，不在這裡重複列出。
  },

  statsSection: {
    items: [
      { num: "500+", label: "工廠" },
      { num: "300+", label: "設計工作室" },
      { num: "4.8", label: "平均評分" },
      { num: "10+", label: "產業類別" },
    ],
  },

  featuresSection: {
    title: "為什麼選擇 OXM？",
    subtitle: "最完整的代工媒合服務，工廠與工作室都在這裡",
    items: [
      { title: "精準搜尋", description: "依產業、地區、資本額篩選，快速鎖定夥伴" },
      { title: "即時詢問", description: "直接與業主線上溝通，即時取得報價" },
      { title: "評價系統", description: "真實評分讓你選擇更有信心" },
      { title: "資訊透明", description: "規格、價格區間一目了然" },
    ],
  },

  ctaSection: {
    title: "準備好開始了嗎？",
    descriptionParts: [
      { text: "不論你是尋找合作夥伴的品牌商，還是想要曝光的" },
      { text: "工廠", highlight: "orange" },
      { text: "或" },
      { text: "工作室", highlight: "purple" },
      { text: "業主，OXM 都是你最佳的選擇！" },
    ] satisfies TextSegment[],
    buttons: [
      { label: "開始搜尋", href: "/search" },
      // 首頁這顆按鈕在已登入且有工廠管理權限時會導向 /dashboard，其餘情況
      // （包含匿名訪客／爬蟲，也就是預渲染會看到的狀態）導向 /register-factory，
      // 預渲染固定用未登入時的真實行為，不假設使用者已登入。
      { label: "免費刊登工廠／工作室", href: "/register-factory" },
    ],
  },
};
