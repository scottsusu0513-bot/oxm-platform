// OXM「傳產圖書館」文章內容（見任務定案「傳產圖書館 Phase 1 實作」）。
//
// 採 typed TS constants，不是 DB table、不是 Markdown/MDX 檔案、不 reuse
// /news 的 DB-backed 架構——文章量小、低頻更新（寫完
// 長期有效，不需要後台審核/發布流程），跟 shared/constants.ts 的
// SUB_INDUSTRY_SEARCH_ENTRIES、shared/content/resources.ts 是同一種角色
// 分工：單一 source of truth，client／server／sitemap／測試共用同一份資料。
//
// body 刻意設計成「型別化區塊陣列」而不是一段 Markdown 字串，避免需要在
// runtime 引入 Markdown/MDX parser（例如 react-markdown）——這是從舊
// Blog 架構（client/src/lib/blog.ts，已於 commit e53b825 移除）學到的
// 教訓：舊架構需要一個簡陋的 frontmatter regex parser + react-markdown
// 才能把檔案內容變成畫面，換成型別化區塊後，內容本身在編譯期就有型別
// 檢查，且 render 邏輯是單純的 switch-case，不需要额外依賴。
//
// relatedLink（文章正文裡連到「另一篇館藏文章」的 contextual link，即
// 「延伸閱讀：...」）與 oxmLink（文章正文裡連到 OXM 服務入口的 contextual
// link）都已移除（見任務定案「Library UX 修正」／「移除正文 OXM 導流」）：
// 使用者希望正文閱讀不被打斷，所有 OXM 導流集中到文末既有的 NEXT STEP
// CTA 區塊（見 LibraryCta），文章間的關聯只在文末「相關館藏」區塊呈現一次
// （見 LibraryArticle.relatedArticleSlugs）。兩次全 codebase audit 都確認
// 這兩種 block 除了這裡沒有其他用途，因此都連同型別／render case／測試
// 一併移除，不是只清資料留著沒用的型別分支。正文現在只剩 paragraph／
// heading／list／table 四種區塊。
export type LibraryCategory = "代工基礎" | "製程與設備" | "材料知識" | "採購與品質";

export const LIBRARY_CATEGORIES: LibraryCategory[] = ["代工基礎", "製程與設備", "材料知識", "採購與品質"];

/**
 * OXM 站內真實存在、已驗證有效的文末 CTA 目標（見任務定案「傳產圖書館
 * 內容完成階段」—NEXT STEP CTA 優先導向對應 canonical factory landing
 * page）：cta.href 只能使用這裡列出的組合，不得自行
 * 發明新的 query param 或 /factories/:slug，見
 * server/libraryContent.test.ts 的 allowlist 驗證。
 * - /search 系列：已在 Search.tsx 驗證支援的 query param 組合。
 * - /factories/:slug 系列：每一個 slug 都已對照
 *   shared/constants.ts 的 SUB_INDUSTRY_SEARCH_ENTRIES 確認真實存在
 *   （/factories/:slug 是 SubIndustryPage 的路由，只認得這份清單裡的
 *   slug），沒有安全對應的 landing 一律 fallback /search，不臆測 slug。
 * - /search?mfgMode=OEM／ODM 目前沒有任何文章在用（「OEM vs ODM」改成中立
 *   的單一 /search CTA 後就空出來了），但這兩個 query param 在 Search.tsx
 *   確實存在，保留在 allowlist 供日後單一 intent 的文章使用；這份清單是
 *   「允許的目標」，不是「使用中的目標」。 */
export const LIBRARY_OXM_LINK_HREF_ALLOWLIST: string[] = [
  "/search",
  "/search?smallBatch=true&sample=true",
  "/search?sample=true",
  "/search?mfgMode=OEM",
  "/search?mfgMode=ODM",
  "/factories/cnc-machining",
  "/factories/sheet-metal",
  "/factories/mold-making",
  "/factories/plastic-injection",
  "/factories/smt-assembly",
  "/factories/pcb",
  "/factories/wire-harness-assembly",
  "/factories/cosmetic-odm",
  "/factories/food-medical-silicone",
  "/factories/metal-materials",
  "/factories/bioplastics",
  "/factories/recycled-materials",
  "/factories/paper-boxes-bags",
  "/factories/packaging-print",
  "/factories/general-printing",
  "/factories/sticker-label",
  "/factories/automation-production-line-equipment",
  "/factories/inspection-measurement-equipment",
];

/**
 * 段落內文字重點標示（見任務定案「Library 重點文字標示」）：
 * - "bold"：一般重點，純粗體，不套色。
 * - "primary"：核心結論，OXM 橘色 + 粗體（沿用 Navbar／Footer 等處已有的
 *   橘色 token，不是另外發明新色）。
 * - "secondary"：概念對比／補充理解，OXM 紫色 + 粗體（沿用 library.css
 *   書櫃配色裡已有的紫色，不是另外發明新色）。
 * render 一律用 <strong>（semantic emphasis），顏色只是掛在 <strong> 上的
 * class，不是「只有顏色沒有語意標籤」的裝飾用法。 */
export type LibraryEmphasis = "bold" | "primary" | "secondary";

/**
 * 段落內文字片段：純字串（不需要標示）或帶 emphasis 的片段。刻意不用
 * raw HTML／dangerouslySetInnerHTML／Markdown parser——維持這個檔案一貫
 * 的「型別化區塊」設計，segments 只是 paragraph 內部更細的型別化切分，
 * 不是另一套內容格式。 */
export type LibraryTextSegment = string | { text: string; emphasis: LibraryEmphasis };

/**
 * paragraph 的 text 永遠是完整純文字（SEO／estimateReadingMinutes／既有
 * 無標示段落都讀這個欄位，行為不變）；segments 是選填的「渲染增強」——有
 * 提供時畫面改用 segments 逐片段渲染（部分片段帶顏色/粗體），但所有
 * segments 文字接起來必須等於 text 逐字（見
 * server/libraryContent.test.ts 的一致性驗證），確保兩者不會日後改一邊
 * 忘了改另一邊而悄悄失準。 */
export type LibraryBodyBlock =
  | { type: "paragraph"; text: string; segments?: LibraryTextSegment[] }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: [string, string]; rows: { label: string; left: string; right: string }[] };

export interface LibraryFaqItem {
  question: string;
  answer: string;
}

/**
 * 文章結尾唯一的 CTA（見任務定案「Library CTA consistency audit」：每篇
 * 文末 NEXT STEP 最多只能有一個主要 CTA，不再有 secondary CTA）。
 * 原本的 secondaryLabel／secondaryHref 只被「OEM vs ODM」一篇使用，該篇
 * 已改成中立的單一 /search CTA——文章本身是 OEM／ODM 比較，不應由 OXM 在
 * 文末替使用者預選其中一種模式；讀者看完後進 Search，再依自己的需求選
 * OEM／ODM。全 codebase audit 確認沒有其他 production usage 後，型別欄位／
 * render 分支／驗證／測試一併移除，不留沒有人用的架構。
 */
export interface LibraryCta {
  label: string;
  href: string;
  description: string;
}

export interface LibraryArticle {
  /** 全站唯一，供 /library/:slug 使用。 */
  slug: string;
  /** 館藏編號，格式固定 LIB-XXX（三位數，依上架順序遞增，不重複使用已下架文章的編號）。 */
  libraryId: string;
  title: string;
  metaDescription: string;
  h1: string;
  /** Library index 卡片用的簡短摘要，刻意跟 metaDescription 分開維護——
   *  metaDescription 是給搜尋引擎看的完整描述，excerpt 是給人看的卡片摘要，
   *  兩者長度/語氣需求不同，硬共用一個欄位會讓其中一邊打折扣。 */
  excerpt: string;
  category: LibraryCategory;
  /** ISO 日期字串（YYYY-MM-DD）。publishedAt 保留原始發布日期（沿用舊
   *  Blog 文章原本的日期，不假造成今天），updatedAt 是這次 migration 實際
   *  發生的日期。 */
  publishedAt: string;
  updatedAt: string;
  /**
   * 入門閱讀順序（見任務定案「傳產圖書館新增文章 + 入門閱讀順序重整」）：
   * 數字越小越建議越先讀，跟 libraryId（上架順序）、publishedAt（發布時間）、
   * 陣列宣告順序三者都無關——libraryId 反映「什麼時候上架」，這個欄位才是
   * 反映「應該先讀哪一篇」，兩者刻意分開，Library index／任何排序邏輯一律
   * 讀這個欄位，不得用 libraryId 或陣列順序猜測。刻意留 10 的間距
   * （10/20/30...），之後要在既有文章中間插入新文章時，只需要給一個介於
   * 前後兩篇之間的數字即可，不必整批重新編號、也不影響 slug／URL。
   */
  learningOrder: number;
  body: LibraryBodyBlock[];
  /** 這篇文章概念上相關的主產業／子產業 slug（供未來文章使用；目前「代工基礎」
   *  分類下的文章都是跨產業的通用代工概念，不特別綁定單一產業，因此刻意
   *  留空，不虛構關聯）。 */
  relatedIndustrySlugs: string[];
  relatedSubIndustrySlugs: string[];
  /** 對應 SUB_INDUSTRY_SEARCH_ENTRIES 的 slug，用於「相關工廠」CTA 連結
   *  （/factories/:slug）；同樣因為目前都是通用概念文章，刻意留空。 */
  relatedFactoryLandingSlugs: string[];
  /** 圖書館內互相關聯的文章 slug，用於文章結尾「相關館藏」區塊。 */
  relatedArticleSlugs: string[];
  /** 只有文章本身真的有清楚的 QA 結構時才填，用於同時驅動畫面上可見的
   *  「常見問題」區塊與 FAQPage JSON-LD——兩者必須逐字一致（見任務定案
   *  「先確認 rendered FAQ 與 schema 內容完全一致」），因此兩邊都直接讀
   *  這個陣列，不另外維護一份 schema 專用文字。 */
  faq?: LibraryFaqItem[];
  cta: LibraryCta;
}

export const LIBRARY_ARTICLES: LibraryArticle[] = [
  {
    slug: "what-is-contract-manufacturing",
    // libraryId 是「第 4 篇上架」（沿用既有「依上架順序遞增」規則，不倒填
    // 成 LIB-000 去搶最前面的編號），但 learningOrder=10 讓這篇在「入門
    // 閱讀順序」排最前——這正是這兩個欄位刻意分開的實際案例。
    libraryId: "LIB-004",
    title: "代工是什麼？代工廠是什麼？一次搞懂品牌與工廠怎麼合作",
    metaDescription: "代工到底是什麼？代工廠又是什麼？這篇文章用淺顯的方式說明代工的實際運作方式、代工廠的類型，以及品牌與工廠之間怎麼展開合作。",
    h1: "代工是什麼？代工廠是什麼？一次搞懂品牌與工廠怎麼合作",
    excerpt: "用淺顯的方式說明代工的實際運作方式、代工廠的類型，以及品牌與工廠怎麼展開合作。",
    category: "代工基礎",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 10,
    body: [
      { type: "paragraph", text: "「代工」「代工廠」這兩個詞，幾乎每次接觸製造業都會聽到，但很多人其實不確定它們具體是什麼意思，也不確定品牌跟工廠之間到底是怎麼合作的。這篇文章從最基本的定義開始，帶你搞懂代工實際上是怎麼運作的。" },

      { type: "heading", text: "代工是什麼？" },
      { type: "paragraph", text: "代工，簡單說就是把產品或零件的製造需求，委託給其他工廠來執行。你不需要自己買設備、自己開產線，而是把「怎麼做出來」這件事交給有能力的工廠負責。" },
      { type: "paragraph", text: "很多人以為代工是「一家工廠從頭做到尾」，但實際上，一個產品常常會拆成好幾道製程，分別委託不同工廠、或是同一家工廠內不同流程來完成，例如：" },
      { type: "list", items: ["CNC 加工：把材料切削、鑽孔、車銑成需要的形狀", "表面處理：電鍍、陽極、烤漆、噴砂等，讓外觀符合需求", "印刷：把 Logo、圖案、說明文字印在產品或包裝上", "組裝：把不同零件或半成品組合成最終產品"] },
      { type: "paragraph", text: "所以找代工，其實不是在找「一家萬能工廠」，而是在找適合你產品製造流程的合作夥伴——可能是一家工廠包辦大部分流程，也可能是好幾家工廠分工合作。", segments: [
        "所以找代工，其實不是在找「一家萬能工廠」，而是在找",
        { text: "適合你產品製造流程的合作夥伴", emphasis: "primary" },
        "——可能是一家工廠包辦大部分流程，也可能是好幾家工廠分工合作。",
      ] },

      { type: "heading", text: "代工廠是什麼？是不是所有工廠都一樣？" },
      { type: "paragraph", text: "代工廠指的是具備特定設備、技術、製程與量產能力，願意接受其他企業委託製造的工廠。但「代工廠」不是單一種工廠，不同產業的代工廠專精完全不同，例如：" },
      { type: "list", items: ["CNC 加工廠", "鈑金廠", "塑膠射出廠", "SMT 電子代工廠", "食品代工廠", "化妝品代工廠", "成衣代工廠", "包裝印刷廠"] },
      { type: "paragraph", text: "而且製造業的合作夥伴，其實不只有「代工廠」這一種角色。依你的需求，你可能還會用到：" },
      { type: "list", items: ["原料供應商", "模具廠", "設備廠商", "設計工作室", "表面處理廠", "包裝廠", "組裝廠"] },
      { type: "paragraph", text: "重點不是找到「最厲害的代工廠」，而是找到真正適合你需求的工廠或供應商——這也是為什麼同一個產業裡，會同時存在很多不同專長的廠商。", segments: [
        "重點不是找到「最厲害的代工廠」，而是",
        { text: "找到真正適合你需求的工廠或供應商", emphasis: "primary" },
        "——這也是為什麼同一個產業裡，會同時存在很多不同專長的廠商。",
      ] },

      { type: "heading", text: "哪些人會需要找代工廠？" },
      { type: "paragraph", text: "找代工廠不是只有「品牌」才需要，實務上常見的需求者包括：" },
      { type: "list", items: [
        "品牌方：已經有產品或設計，需要工廠量產",
        "貿易商／採購：幫客戶尋找合適的製造來源，比較不同工廠的報價與品質",
        "創業者／新產品團隊：第一次做產品，需要找到能配合小量、願意溝通的工廠",
        "工廠找工廠：工廠本身也常需要把部分製程外包給其他工廠，例如 CNC 外包、雷射切割外包、電鍍、熱處理、烤漆",
      ] },
      { type: "paragraph", text: "換句話說，「找代工」不是新創或品牌方的專利，只要你的製造流程有一段需要外部協助，都算在找代工的範圍內。", segments: [
        "換句話說，「找代工」不是新創或品牌方的專利，",
        { text: "只要你的製造流程有一段需要外部協助，都算在找代工的範圍內", emphasis: "bold" },
        "。",
      ] },

      { type: "heading", text: "找代工廠前，要準備什麼？" },
      { type: "paragraph", text: "開始詢價之前，先把以下資訊準備好，可以讓溝通快很多：" },
      { type: "list", items: ["產品用途", "材質", "尺寸", "預估數量", "圖面或照片", "是否需要打樣", "預計交期", "是否已有模具", "特殊加工需求", "包裝要求"] },
      { type: "paragraph", text: "如果是精密零件，最好能再額外提供：2D 圖、3D 圖、公差要求、材質規格、表面處理需求。" },
      { type: "paragraph", text: "只問工廠「這個做一個多少錢？」，很多時候工廠沒辦法給你準確報價——因為價格會隨材質、數量、加工難度大幅變動，資訊給得越完整，你拿到的報價才會越準。", segments: [
        "只問工廠「這個做一個多少錢？」，很多時候工廠沒辦法給你準確報價——因為價格會隨材質、數量、加工難度大幅變動，",
        { text: "資訊給得越完整，你拿到的報價才會越準", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "為什麼同一個產品，不同工廠報價會差很多？" },
      { type: "paragraph", text: "同一個產品拿去問不同工廠，報價常常差距很大，這是正常現象，因為影響價格的因素非常多，包括：" },
      { type: "list", items: ["生產數量", "材料成本", "機台", "加工時間", "人工", "模具", "治具", "公差", "表面處理", "品質", "包裝", "交期", "良率", "外包製程"] },
      { type: "paragraph", text: "光是「數量」和「公差要求」這兩個變數，就足以讓報價差到好幾倍——量越大通常單價越低，公差要求越嚴格，加工難度與良率風險就越高，價格自然反映上去。" },
      { type: "paragraph", text: "但這裡有一個很重要的觀念：價格不是找工廠唯一該看的重點。除了價格，你還要評估：", segments: [
        "但這裡有一個很重要的觀念：",
        { text: "價格不是找工廠唯一該看的重點", emphasis: "primary" },
        "。除了價格，你還要評估：",
      ] },
      { type: "list", items: [
        "工廠是否擅長這個產品",
        "設備是否合適",
        "品質穩定度",
        "交期",
        "數量是否符合工廠的生產模式（工廠不一定適合你的訂單規模，太小或太大都可能有問題）",
        "溝通",
        "售後／問題處理",
      ] },
      { type: "paragraph", text: "所以真正該問的問題，不是「哪一家最便宜？」，而是「哪一家最適合把我的產品穩定做出來？」——便宜但做不出品質、或做出來但工廠不願意配合修改，最後付出的成本往往更高。", segments: [
        "所以真正該問的問題，不是「哪一家最便宜？」，而是",
        { text: "「哪一家最適合把我的產品穩定做出來？」", emphasis: "primary" },
        "——便宜但做不出品質、或做出來但工廠不願意配合修改，最後付出的成本往往更高。",
      ] },

      { type: "heading", text: "我要怎麼知道自己該找哪一種工廠？" },
      { type: "paragraph", text: "可以先從自己目前所在的製造階段判斷：" },
      { type: "list", items: [
        "有設計但沒有樣品：需要能打樣、開模或加工的工廠",
        "已經有樣品，準備量產：需要能穩定量產的製造商",
        "只有產品概念，還沒有具體設計：適合找 ODM 或設計開發型工廠",
        "整個流程都清楚，只是缺某一道製程：直接找對應的製程廠就好",
      ] },
      { type: "paragraph", text: "再依產品類型，大致可以對到這些工廠類型：" },
      { type: "list", items: [
        "精密零件 → CNC 加工廠",
        "金屬板件 → 鈑金廠／雷射切割廠",
        "塑膠產品 → 射出、押出或吹塑工廠",
        "電子產品 → SMT、線束或組裝廠",
        "外觀處理 → 電鍍、陽極、烤漆廠",
      ] },
      { type: "paragraph", text: "如果你的訂單數量還不大，建議優先找可接小量、可打樣的工廠，降低第一次合作的門檻與風險。" },

      { type: "heading", text: "OEM、ODM 跟代工有什麼關係？" },
      { type: "paragraph", text: "代工是比較廣義的概念，泛指「委託其他工廠製造」這件事。OEM 和 ODM，則是代工底下兩種不同的合作模式。簡單分辨：OEM 是「照你的規格幫你做」——你提供設計或規格，工廠負責生產；ODM 則是「工廠也一起協助把產品做出來」——工廠除了製造，也會參與部分設計、開發，或提供既有的產品方案讓你調整。", segments: [
        "代工是比較廣義的概念，泛指「委託其他工廠製造」這件事。OEM 和 ODM，則是代工底下兩種不同的合作模式。簡單分辨：",
        { text: "OEM 是「照你的規格幫你做」", emphasis: "secondary" },
        "——你提供設計或規格，工廠負責生產；",
        { text: "ODM 則是「工廠也一起協助把產品做出來」", emphasis: "secondary" },
        "——工廠除了製造，也會參與部分設計、開發，或提供既有的產品方案讓你調整。",
      ] },

      { type: "heading", text: "OXM 小整理" },
      { type: "list", items: ["先確認需求", "找對工廠類型", "數量會影響工廠選擇", "價格不是唯一條件", "找適合的製造合作夥伴"] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["oem-vs-odm", "first-time-factory-guide"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "搞懂代工的基本概念後，下一步就是實際到 OXM 依產業、地區與合作模式，找找看有哪些工廠或合作夥伴適合你的產品。",
    },
  },
  {
    slug: "what-is-moq",
    libraryId: "LIB-001",
    title: "MOQ 是什麼？代工廠最低訂購量怎麼談",
    metaDescription: "第一次找代工，最常卡在 MOQ（最低訂購量）。本文解釋 MOQ 的意義、台灣工廠常見範圍，以及如何談到更低的門檻。",
    h1: "MOQ 是什麼？代工廠最低訂購量怎麼談",
    excerpt: "解釋 MOQ 的意義、台灣工廠常見範圍，以及如何談到更低的門檻。",
    category: "代工基礎",
    publishedAt: "2026-05-08",
    updatedAt: "2026-09-16",
    learningOrder: 30,
    body: [
      { type: "paragraph", text: "找代工廠，最常聽到工廠說「我們 MOQ 是 1000 件」。很多新手聽到就退縮了。但其實 MOQ 沒那麼可怕，關鍵在於你怎麼理解它、怎麼跟工廠談。" },
      { type: "heading", text: "MOQ 是什麼？" },
      { type: "paragraph", text: "MOQ 是 Minimum Order Quantity（最低訂購量）的縮寫。", segments: [
        "MOQ 是 ",
        { text: "Minimum Order Quantity（最低訂購量）", emphasis: "bold" },
        "的縮寫。",
      ] },
      { type: "paragraph", text: "工廠開一條生產線有固定成本：機器設定費、原料採購批量、工人排班等。為了讓這些成本攤平，工廠會設定最小接單量。低於這個數量，工廠的利潤可能是負的。", segments: [
        "工廠開一條生產線有固定成本：機器設定費、原料採購批量、工人排班等。為了讓這些成本攤平，工廠會設定最小接單量。",
        { text: "低於這個數量，工廠的利潤可能是負的", emphasis: "primary" },
        "。",
      ] },
      { type: "heading", text: "MOQ 為什麼每個產業、每家工廠都不一樣？" },
      { type: "paragraph", text: "MOQ 沒有一個放諸四海皆準的標準數字，因為每個產業、甚至同產業裡不同工廠，成本結構都不一樣。實際會影響 MOQ 高低的常見因素包括：" },
      { type: "list", items: [
        "原料最小採購單位：部分原料本身就有最低採購批量，數量不夠，材料成本就划不來",
        "設備最小有效批次：機台開機、架設一次都有基本的時間與人力成本，批量太小不划算",
        "是否需要開模：開模是一次性投入，沒有足夠數量分攤，單價會被拉得很高",
        "換線成本：切換不同產品或規格，需要重新設定機台、調整參數，換線越頻繁，效率越低",
        "包裝最低印量：客製化包裝（例如印刷、貼標）通常也各自有最低印製量",
        "製程效率與損耗：部分製程在小批量時損耗比例偏高，也會反映在 MOQ 與單價上",
        "排程與產能：工廠會優先安排符合自己產能規劃、效益較高的訂單",
      ] },
      { type: "paragraph", text: "這也是為什麼同樣是「代工」，紡織成衣、塑膠射出、金屬加工、食品代工、印刷包裝的 MOQ 高低可以差很多——不是工廠隨意訂的門檻，而是反映各自的成本結構與製程特性。實際數字沒有統一標準，建議直接跟目標工廠詢問，並說明自己的產品與預期數量，取得最準確的答案。" },
      { type: "heading", text: "工作室 vs 工廠的差異" },
      { type: "paragraph", text: "在 OXM 上，你可以同時找工廠和設計工作室。" },
      { type: "paragraph", text: "工作室通常接受更低的 MOQ，甚至 50 件、30 件都可以。代價是單價較高。如果你要測試市場、打樣確認，工作室往往是更好的起點。", segments: [
        "工作室通常接受更低的 MOQ，甚至 50 件、30 件都可以。",
        { text: "代價是單價較高", emphasis: "secondary" },
        "。如果你要測試市場、打樣確認，工作室往往是更好的起點。",
      ] },
      { type: "heading", text: "如何談低一點的 MOQ？" },
      { type: "list", items: [
        "坦誠說明你的情況：「我是新品牌，第一批想先下 300 件測市場，後續有量的話會繼續合作。」大多數工廠都能理解。",
        "接受價格補差：接受較低 MOQ，通常代表單價高一些，這是合理的交換。",
        "選擇現有款式（ODM）：不需開新模，工廠成本低，MOQ 相對彈性。",
        "詢問樣品費：先下打樣單，工廠看到你認真，後續談 MOQ 更順。",
      ] },
      { type: "paragraph", text: "MOQ 是可以談的，關鍵是你要讓工廠知道：你是認真的長期合作夥伴，不是一次性的小單。", segments: [
        { text: "MOQ 是可以談的", emphasis: "primary" },
        "，關鍵是你要讓工廠知道：你是認真的長期合作夥伴，不是一次性的小單。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["oem-vs-odm", "first-time-factory-guide"],
    cta: {
      label: "查看可接小量／可打樣的工廠",
      href: "/search?smallBatch=true&sample=true",
      description: "在 OXM 依「可接小量」「可打樣」篩選，找到適合你目前訂單規模的合作對象。",
    },
  },
  {
    slug: "oem-vs-odm",
    libraryId: "LIB-002",
    title: "OEM vs ODM 差在哪？台灣代工新手必讀",
    metaDescription: "搞清楚 OEM 和 ODM 的差異，是找代工廠的第一步。本文用最直白的方式解釋兩者定義、適用情境與選擇建議。",
    h1: "OEM vs ODM 差在哪？台灣代工新手必讀",
    excerpt: "用最直白的方式解釋 OEM 與 ODM 的定義、適用情境與選擇建議。",
    category: "代工基礎",
    publishedAt: "2026-05-08",
    updatedAt: "2026-09-16",
    learningOrder: 20,
    body: [
      { type: "paragraph", text: "很多人第一次接觸代工時，都會被 OEM 和 ODM 這兩個詞搞混。它們看起來相似，但實際上差異很大，選錯方向可能浪費大量時間和金錢。" },
      { type: "heading", text: "OEM 是什麼？" },
      { type: "paragraph", text: "OEM（Original Equipment Manufacturer，原廠委託製造）指的是：你提供設計，工廠負責製造。", segments: [
        "OEM（Original Equipment Manufacturer，原廠委託製造）指的是：",
        { text: "你提供設計，工廠負責製造", emphasis: "bold" },
        "。",
      ] },
      { type: "paragraph", text: "你給工廠完整的規格書、模具、甚至原料，工廠只負責按照你的圖紙生產。產品的設計、品牌、包裝全部由你控制。" },
      { type: "paragraph", text: "適合誰用？" },
      { type: "list", items: [
        "已有成熟產品設計、只需要量產的品牌商",
        "有自己研發團隊的企業",
        "想完全掌控產品規格的買家",
      ] },
      { type: "heading", text: "ODM 是什麼？" },
      { type: "paragraph", text: "ODM（Original Design Manufacturer，原廠設計製造）指的是：工廠有現成設計，你可以貼牌或微調。", segments: [
        "ODM（Original Design Manufacturer，原廠設計製造）指的是：",
        { text: "工廠有現成設計，你可以貼牌或微調", emphasis: "bold" },
        "。",
      ] },
      { type: "paragraph", text: "工廠本身開發了產品，你選一款，稍微調整顏色、Logo、包裝，就可以以自己的品牌販售。" },
      { type: "paragraph", text: "適合誰用？" },
      { type: "list", items: [
        "剛起步、沒有設計能力的新創品牌",
        "想快速推出產品、降低開發成本的賣家",
        "電商、代理商",
      ] },
      { type: "heading", text: "關鍵差異比較" },
      { type: "table", headers: ["OEM", "ODM"], rows: [
        { label: "誰提供設計", left: "買家", right: "工廠" },
        { label: "開模成本", left: "買家負擔", right: "通常較低或共用" },
        { label: "產品獨特性", left: "高", right: "較低（共用模具）" },
        { label: "上市速度", left: "較慢", right: "較快" },
        { label: "適合階段", left: "成熟品牌", right: "新創 / 小量測試" },
      ] },
      { type: "heading", text: "怎麼選？" },
      { type: "paragraph", text: "如果你是第一次找代工、預算有限、想快速驗證市場，先從 ODM 開始，找工廠的現有款式微調，降低風險。", segments: [
        "如果你是第一次找代工、預算有限、想快速驗證市場，",
        { text: "先從 ODM 開始，找工廠的現有款式微調，降低風險", emphasis: "primary" },
        "。",
      ] },
      { type: "paragraph", text: "當你確定市場需求，想推出真正差異化的產品，再考慮走 OEM 路線，投入設計與模具開發。" },
      { type: "paragraph", text: "很多台灣工廠兩種都做，談的時候可以直接問。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-contract-manufacturing", "what-is-moq", "first-time-factory-guide"],
    faq: [
      { question: "OEM 是什麼？", answer: "OEM 是 Original Equipment Manufacturer（原廠委託製造）。你提供完整設計，工廠負責製造；產品的設計、品牌、包裝全部由你控制。" },
      { question: "ODM 是什麼？", answer: "ODM 是 Original Design Manufacturer（原廠設計製造）。工廠已有現成設計，你可以貼牌或微調，用自己的品牌販售。" },
      { question: "OEM 和 ODM 最大的差異是什麼？", answer: "主要差在誰提供設計、誰負擔開模成本：OEM 由買家提供設計、負擔開模成本，產品獨特性高但上市較慢；ODM 由工廠提供現成設計，開模成本較低、上市較快，但產品較難做出差異化。" },
      { question: "新手應該先選 OEM 還是 ODM？", answer: "如果是第一次找代工、預算有限、想快速驗證市場，建議先從 ODM 開始，選工廠現有款式微調，降低風險；確定市場需求後再考慮走 OEM，投入設計與模具開發。" },
      { question: "同一家工廠可以同時做 OEM 和 ODM 嗎？", answer: "可以，許多台灣工廠兩種代工模式都提供，實際是否支援仍需在詢價時向個別工廠確認。" },
    ],
    cta: {
      label: "前往 OXM 找代工廠",
      href: "/search",
      description: "這篇只負責把 OEM 與 ODM 的差異講清楚，該走哪一種由你自己決定——直接到 OXM 依產業與地區篩選工廠，再依需求確認對方支援的代工模式。",
    },
  },
  {
    slug: "first-time-factory-guide",
    libraryId: "LIB-003",
    title: "第一次找代工廠要注意什麼？從詢價到下單完整流程",
    metaDescription: "第一次找台灣代工廠，不知道從哪裡開始？本文整理從需求確認、搜尋、詢價到打樣下單的完整流程，避開常見新手錯誤。",
    h1: "第一次找代工廠要注意什麼？從詢價到下單完整流程",
    excerpt: "整理從需求確認、搜尋、詢價到打樣下單的完整流程，避開常見新手錯誤。",
    category: "代工基礎",
    publishedAt: "2026-05-08",
    updatedAt: "2026-09-16",
    learningOrder: 40,
    body: [
      { type: "paragraph", text: "第一次找代工廠，很多人不知道該問什麼、怎麼比較，最後要麼選錯廠商，要麼浪費大量來回溝通的時間。這篇文章整理了完整流程，幫你少走彎路。" },
      { type: "heading", text: "第一步：先釐清自己的需求" },
      { type: "paragraph", text: "在搜尋工廠之前，先把以下資訊整理清楚：" },
      { type: "list", items: [
        "產品類型：你要做什麼？（T恤、塑膠零件、保健食品...）",
        "數量：第一批大概要多少？",
        "預算：單件或總預算是多少？",
        "時程：什麼時候要？",
        "規格：有沒有設計稿、材質要求、尺寸圖？",
      ] },
      { type: "paragraph", text: "越清楚，工廠越能給你準確報價，你也越省時間。", segments: [
        { text: "越清楚，工廠越能給你準確報價", emphasis: "bold" },
        "，你也越省時間。",
      ] },
      { type: "heading", text: "第二步：找合適的工廠" },
      { type: "paragraph", text: "在 OXM 上可以依產業、地區、資本額篩選。建議：" },
      { type: "list", items: [
        "先看評分和評價：真實買家留的回饋，能幫你快速判斷這家廠商的配合態度",
        "注意 OEM / ODM：確認工廠支援你需要的合作模式",
        "看產品頁：工廠有沒有展示過類似的產品？",
      ] },
      { type: "heading", text: "第三步：寫一封好的詢價信" },
      { type: "paragraph", text: "第一封詢問訊息決定你被認真對待的程度。建議格式：" },
      { type: "paragraph", text: "「您好，我是 [品牌名/公司名]，想詢問 [產品名稱] 的代工報價。數量：約 ___ 件/批；規格：（附圖或說明）；時程：希望 ___ 前交貨。請問是否可以配合？如可以，方便提供初步報價嗎？」" },
      { type: "paragraph", text: "簡短、具體、有禮貌，工廠回覆率更高。", segments: [
        "簡短、具體、有禮貌，",
        { text: "工廠回覆率更高", emphasis: "bold" },
        "。",
      ] },
      { type: "heading", text: "第四步：比較至少 3 家" },
      { type: "paragraph", text: "不要只問一家就決定。比較時注意：" },
      { type: "list", items: [
        "價格是否合理（太低可能是品質問題）",
        "溝通速度（反映未來合作的效率）",
        "有沒有打樣服務",
        "付款條件（訂金比例、交貨後尾款）",
      ] },
      { type: "heading", text: "第五步：先打樣，再下訂" },
      { type: "paragraph", text: "在下正式訂單前，一定要先確認打樣。打樣可以幫你：" },
      { type: "list", items: [
        "確認實際成品是否符合預期",
        "測試材質、做工品質",
        "作為後續量產的標準樣",
      ] },
      { type: "paragraph", text: "打樣費通常需要另付，但這筆錢很值得。", segments: [
        "打樣費通常需要另付，但",
        { text: "這筆錢很值得", emphasis: "primary" },
        "。",
      ] },
      { type: "heading", text: "常見新手錯誤" },
      { type: "list", items: [
        "一開口就問「最低多少」，讓工廠覺得你只在意價格",
        "需求不清楚就詢價，浪費雙方時間",
        "跳過打樣直接下大訂單，風險極高",
        "只問一家，沒有比較基準",
      ] },
      { type: "paragraph", text: "找代工廠本質上是建立長期合作關係。從第一次接觸開始，就以誠信、清晰的溝通建立信任，後續的合作會順很多。", segments: [
        { text: "找代工廠本質上是建立長期合作關係", emphasis: "primary" },
        "。從第一次接觸開始，就以誠信、清晰的溝通建立信任，後續的合作會順很多。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-moq", "oem-vs-odm"],
    cta: {
      label: "開始找工廠",
      href: "/search",
      description: "整理好你的需求後，直接到 OXM 搜尋台灣工廠與工作室，依產業、地區與合作模式篩選。",
    },
  },
  // ===== Level 2：第一批 5 篇（見任務定案「傳產圖書館 Level 2 第一批 5
  // 篇文章實作」）。libraryId（LIB-005～009）沿用本輪撰寫／上架順序，跟
  // learningOrder（50/60/70/80/90，反映「知道數量限制 → 準備 RFQ → 看報價
  // → 選工廠 → 打樣到量產」這個真實採購旅程）刻意不同——RFQ（LIB-008）在
  // learningOrder 上排在報價（LIB-006）之前，就是這兩個欄位分開的實例。 =====
  {
    slug: "small-batch-manufacturing",
    libraryId: "LIB-005",
    title: "小量代工怎麼找？MOQ 太高怎麼辦？",
    metaDescription: "訂單數量不多，工廠不太願意接單、MOQ 又談不下來嗎？這篇文章說明工廠不愛接小量訂單的原因、MOQ 可以怎麼談，以及第一次做小量代工該怎麼開始。",
    h1: "小量代工怎麼找？MOQ 太高怎麼辦？",
    excerpt: "說明工廠不愛接小量訂單的原因、MOQ 可以怎麼談，以及第一次做小量代工該怎麼開始。",
    category: "代工基礎",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 50,
    body: [
      { type: "paragraph", text: "「數量太少，工廠不太願意接」，是很多第一次找代工的人都會遇到的狀況。這篇文章說明工廠為什麼會這樣、MOQ 是不是真的沒有討論空間，以及數量不多時，實際上可以怎麼開始。" },

      { type: "heading", text: "為什麼很多工廠不太願意接小量？" },
      { type: "paragraph", text: "工廠不是不願意做小量，而是小量訂單常常「不划算」——不管訂單大小，很多成本都是固定的，包括：", segments: [
        "工廠不是不願意做小量，而是",
        { text: "小量訂單常常「不划算」", emphasis: "bold" },
        "——不管訂單大小，很多成本都是固定的，包括：",
      ] },
      { type: "list", items: ["備料", "換線", "換模", "架機", "程式設定", "刀具／治具", "清線／清機", "品質檢查", "人員安排"] },
      { type: "paragraph", text: "這些固定成本不會因為訂單變小就變少，攤到少量產品上，單價自然拉高，工廠的利潤空間也會被壓縮，這也是為什麼很多工廠會設 MOQ 門檻。" },

      { type: "heading", text: "所以數量少，就一定找不到工廠嗎？" },
      { type: "paragraph", text: "不一定。重點是不要只找「大工廠」，而是要找本來就適合小量、多樣少量的工廠類型，例如專門做：", segments: [
        "不一定。",
        { text: "重點是不要只找「大工廠」，而是要找本來就適合小量、多樣少量的工廠類型", emphasis: "primary" },
        "，例如專門做：",
      ] },
      { type: "list", items: ["打樣", "少量生產", "多樣少量訂單", "客製化產品", "新產品開發"] },
      { type: "paragraph", text: "這類工廠本來的營運模式就是配合彈性訂單，比起大量生產型工廠，會更願意、也更習慣處理小量需求。" },

      { type: "heading", text: "MOQ 太高，可以跟工廠談嗎？" },
      { type: "paragraph", text: "可以談，但先搞清楚 MOQ 高的原因，才知道有沒有空間、要從哪裡談起。常見原因包括：", segments: [
        { text: "可以談", emphasis: "bold" },
        "，但先搞清楚 MOQ 高的原因，才知道有沒有空間、要從哪裡談起。常見原因包括：",
      ] },
      { type: "list", items: ["原料最低採購量", "開機成本", "模具", "包材", "保存期限", "換線成本"] },
      { type: "paragraph", text: "針對這些原因，實務上有幾種可行做法：" },
      { type: "list", items: ["減少顏色／款式數量", "用工廠現有的公版設計", "用現成材料，不特別訂製", "簡化包裝", "降低客製化程度"] },

      { type: "heading", text: "我是不是應該先打樣，不要一開始就量產？" },
      { type: "paragraph", text: "是的，尤其是第一次合作或第一次做這個產品，先打樣可以確認設計、材質、尺寸是否真的符合需求，避免直接下量產訂單後才發現問題，成本反而更高。" },

      { type: "heading", text: "小量生產為什麼單價常常比較高？" },
      { type: "paragraph", text: "延續前面的固定成本觀念，用一個簡單的數字例子來看：假設架機成本是 5,000 元。" },
      { type: "list", items: ["生產 100 件：攤到每件的架機成本是 50 元", "生產 10,000 件：攤到每件的架機成本只剩 0.5 元"] },
      { type: "paragraph", text: "同樣的固定成本，量越大，攤到每件的成本就越低，這就是為什麼小量訂單的單價通常比較高——不是工廠故意抬價，而是成本結構本來就是這樣。", segments: [
        "同樣的固定成本，量越大，攤到每件的成本就越低，這就是為什麼小量訂單的單價通常比較高——",
        { text: "不是工廠故意抬價，而是成本結構本來就是這樣", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "第一次做產品，小量代工比較適合怎麼開始？" },
      { type: "paragraph", text: "建議照這個順序進行：" },
      { type: "list", items: ["規格確認", "找可打樣的工廠", "第一版樣品", "修正調整", "小量試產", "驗證品質", "確認沒問題後再放大量"] },
      { type: "paragraph", text: "把產品做對，比一開始把價格壓到最低更重要——數量小的時候，多花一點單價成本先把產品驗證清楚，遠比省了小錢卻做出有問題的產品划算。", segments: [
        { text: "把產品做對，比一開始把價格壓到最低更重要", emphasis: "primary" },
        "——數量小的時候，多花一點單價成本先把產品驗證清楚，遠比省了小錢卻做出有問題的產品划算。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-moq", "what-is-prototyping"],
    cta: {
      label: "查看可接小量／可打樣的工廠",
      href: "/search?smallBatch=true&sample=true",
      description: "從 MOQ 卡關到真的下單，可以先到 OXM 依「可接小量」「可打樣」篩選，看看有哪些工廠實際上就是為小量訂單設計的。",
    },
  },
  {
    slug: "how-to-read-factory-quotes",
    libraryId: "LIB-006",
    title: "工廠報價怎麼看？為什麼同一個產品價格差這麼多？",
    metaDescription: "同一個產品，不同工廠報價卻差很多？這篇文章說明報價背後的成本因素、報價單該看哪些項目，以及怎麼比較多家報價，找到真正適合的合作對象。",
    h1: "工廠報價怎麼看？為什麼同一個產品價格差這麼多？",
    excerpt: "說明報價背後的成本因素、報價單該看哪些項目，以及怎麼比較多家報價。",
    category: "採購與品質",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 70,
    body: [
      { type: "paragraph", text: "同一張圖面或同一個產品需求，拿去問不同工廠，報價經常差到好幾成，甚至好幾倍。這不代表哪一家在亂報，而是報價背後牽涉的因素本來就很多。這篇文章帶你看懂報價單，也看懂怎麼比較。" },

      { type: "heading", text: "同一張圖給三家工廠，為什麼報價可以差很多？" },
      { type: "paragraph", text: "同一個產品，不同工廠的報價會受到很多因素影響，包括：" },
      { type: "list", items: ["原料", "加工時間", "機台", "人工", "模具", "治具", "刀具", "表面處理", "外包", "品檢", "包裝", "運輸", "良率", "數量", "交期"] },
      { type: "paragraph", text: "每家工廠的設備、產能、良率、甚至排單狀況都不一樣，反映在報價上自然會有落差，這是正常現象。", segments: [
        "每家工廠的設備、產能、良率、甚至排單狀況都不一樣，反映在報價上自然會有落差，",
        { text: "這是正常現象", emphasis: "bold" },
        "。",
      ] },

      { type: "heading", text: "是不是報價最低的工廠最好？" },
      { type: "paragraph", text: "不一定，最低價不代表最適合。低價背後可能藏著一些不會寫在報價單上的隱藏成本，例如：" },
      { type: "list", items: ["交期不穩", "良率偏低", "公差抓不準", "溝通不順暢", "重工", "報廢", "客訴", "物流延誤", "溝通成本"] },
      { type: "paragraph", text: "真正該比較的，是整體合作成本，不只是單價這一個數字。", segments: [
        { text: "真正該比較的，是整體合作成本，不只是單價這一個數字", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "看報價單時最重要的是哪些項目？" },
      { type: "paragraph", text: "一份完整的報價單，至少應該包含：" },
      { type: "list", items: ["單價", "MOQ", "模具／治具費", "打樣費", "稅", "包裝", "表面處理", "運費", "交期", "報價有效期限", "付款條件"] },

      { type: "heading", text: "為什麼有些工廠模具費很高，但產品單價比較低？" },
      { type: "paragraph", text: "這是常見的成本結構：前期投入越高，量產單價就可能越低。典型例子是塑膠射出——模具是一次性投入，做得越精密、越耐用，模具費就越高，但模具做好之後，每一件產品的加工成本反而會壓得更低。", segments: [
        "這是常見的成本結構：",
        { text: "前期投入越高，量產單價就可能越低", emphasis: "secondary" },
        "。典型例子是塑膠射出——模具是一次性投入，做得越精密、越耐用，模具費就越高，但模具做好之後，每一件產品的加工成本反而會壓得更低。",
      ] },
      { type: "paragraph", text: "所以看報價時，不能只看單價，也要把模具／治具這類一次性費用一起算進總成本。" },

      { type: "heading", text: "拿到幾家報價後，我應該怎麼比較？" },
      { type: "paragraph", text: "建議用同一套項目，把每家工廠的報價並排比較，包括：" },
      { type: "list", items: ["單價", "MOQ", "打樣費", "模具費", "交期", "品質／良率", "是否支援小量", "溝通配合度"] },

      { type: "heading", text: "什麼才算是一個好的報價？" },
      { type: "paragraph", text: "好的報價不是數字最低，而是資訊夠完整、夠清楚，讓你可以放心做決定。至少要做到：", segments: [
        { text: "好的報價不是數字最低，而是資訊夠完整、夠清楚，讓你可以放心做決定", emphasis: "primary" },
        "。至少要做到：",
      ] },
      { type: "list", items: ["成本項目清楚，沒有模糊的「其他費用」", "確認規格真的做得到，不是先報再說", "交期明確", "報價範圍清楚（含哪些、不含哪些）", "遇到問題時，處理方式明確"] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-rfq", "how-to-choose-a-factory"],
    cta: {
      label: "前往 OXM 找工廠、比較報價",
      href: "/search",
      description: "整理好報價比較的重點後，直接到 OXM 依產業、地區與合作模式搜尋，一次詢問多家工廠、實際比較看看。",
    },
  },
  {
    slug: "how-to-choose-a-factory",
    libraryId: "LIB-007",
    title: "怎麼判斷一間工廠適不適合你的案子？",
    metaDescription: "找到很多工廠候選名單後，接下來該怎麼篩選？這篇文章說明評估工廠時該看哪些重點，從製程設備、過往產品到溝通配合度，幫你判斷哪一家真正適合你的案子。",
    h1: "怎麼判斷一間工廠適不適合你的案子？",
    excerpt: "說明評估工廠時該看哪些重點，幫你判斷哪一家真正適合你的案子。",
    category: "採購與品質",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 80,
    body: [
      { type: "paragraph", text: "透過 OXM 或其他管道找到好幾家工廠候選名單後，很多人不知道接下來該怎麼篩選。這篇文章整理評估工廠時真正該看的重點。" },

      { type: "heading", text: "找到很多工廠之後，我要怎麼選？" },
      { type: "paragraph", text: "很多人第一個念頭是「哪一家最大」或「哪一家最便宜」，但這兩個都不是最好的起點。真正該先問的是「哪一家最符合我的需求」——規模最大、價格最低的工廠，不一定做得出你要的產品。", segments: [
        "很多人第一個念頭是「哪一家最大」或「哪一家最便宜」，但這兩個都不是最好的起點。",
        { text: "真正該先問的是「哪一家最符合我的需求」", emphasis: "primary" },
        "——規模最大、價格最低的工廠，不一定做得出你要的產品。",
      ] },

      { type: "heading", text: "第一個要看什麼？" },
      { type: "paragraph", text: "先看工廠的製程與設備，是不是真的能做你的產品。例如同樣是 CNC 加工廠，設備配置差異就很大：" },
      { type: "list", items: ["適合做鋁件，還是不鏽鋼件", "適合小型精密件，還是大型零件", "有沒有五軸設備", "有沒有車銑複合機台"] },
      { type: "paragraph", text: "設備對不上，其他條件再好都沒有用。", segments: [
        { text: "設備對不上，其他條件再好都沒有用", emphasis: "bold" },
        "。",
      ] },

      { type: "heading", text: "看工廠以前做過什麼產品有用嗎？" },
      { type: "paragraph", text: "很有用。可以從過往產品看出這家工廠實際擅長什麼，重點看：" },
      { type: "list", items: ["材料是否相符", "尺寸規模是否相符", "服務過的產業", "產品品質", "製程是否類似"] },
      { type: "paragraph", text: "在 OXM 上，工廠頁通常會展示工廠介紹、產業、過往產品與代工模式等資訊，可以直接拿來比對。" },

      { type: "heading", text: "工廠規模越大越好嗎？" },
      { type: "paragraph", text: "不一定。大工廠設備完整、產能穩定，適合量大、規格明確的訂單；小工廠或工作室彈性較高，通常更願意配合小量、客製或還在調整中的產品。兩種各有適合的場景，不是規模越大就越好。", segments: [
        "不一定。大工廠設備完整、產能穩定，適合量大、規格明確的訂單；小工廠或工作室彈性較高，通常更願意配合小量、客製或還在調整中的產品。",
        { text: "兩種各有適合的場景，不是規模越大就越好", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "除了設備，還要看什麼？" },
      { type: "paragraph", text: "除了設備和過往產品，還要評估：" },
      { type: "list", items: ["品質穩定度", "交期", "MOQ", "是否可打樣", "是否可接小量", "支援 OEM 或 ODM", "溝通順不順暢", "異常狀況怎麼處理", "有沒有相關認證", "適不適合長期合作"] },

      { type: "heading", text: "第一次合作，需要直接下大量訂單嗎？" },
      { type: "paragraph", text: "不建議。第一次合作，建議先打樣，確認沒問題後再進行小量試產，驗證整個生產流程與品質穩定度，最後才放大到正式量產。跳過這幾步直接下大單，風險相對高。", segments: [
        "不建議。第一次合作，建議先打樣，確認沒問題後再進行小量試產，驗證整個生產流程與品質穩定度，最後才放大到正式量產。",
        { text: "跳過這幾步直接下大單，風險相對高", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "最後應該怎麼判斷？" },
      { type: "paragraph", text: "可以從三個層次來判斷一家工廠適不適合你的案子：" },
      { type: "list", items: ["做不做得到：設備、技術、製程是否真的符合你的產品需求", "適不適合你的訂單：規模、MOQ、交期是否符合你目前的訂單狀況", "能不能長期合作：溝通、品質穩定度、異常處理是否讓你放心"] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["how-to-read-factory-quotes", "what-is-prototyping"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "整理好評估重點後，直接到 OXM 依產業、地區與合作模式篩選，找到真正符合你案子需求的工廠。",
    },
  },
  {
    slug: "what-is-rfq",
    libraryId: "LIB-008",
    title: "詢價要提供哪些資料？RFQ 怎麼準備？",
    metaDescription: "詢價時該提供哪些資料，工廠才能給出準確報價？這篇文章說明 RFQ 是什麼、基本該準備的資料，以及零件加工、只有照片沒有圖面等常見情境該怎麼處理。",
    h1: "詢價要提供哪些資料？RFQ 怎麼準備？",
    excerpt: "說明 RFQ 是什麼、詢價時該準備哪些資料，以及常見的準備情境。",
    category: "採購與品質",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 60,
    body: [
      { type: "paragraph", text: "詢價時提供的資料越清楚，工廠給出的報價就越準確，來回確認的時間也越少。這篇文章說明 RFQ 是什麼，以及不同情況下該準備哪些資料。" },

      { type: "heading", text: "RFQ 是什麼？" },
      { type: "paragraph", text: "RFQ 是 Request for Quotation（詢價單）的縮寫，簡單說就是把產品需求整理成一份清楚的資料，交給工廠，讓工廠可以據此判斷：能不能做、多少錢、多久可以交貨，以及其他合作條件。", segments: [
        "RFQ 是 ",
        { text: "Request for Quotation（詢價單）", emphasis: "bold" },
        "的縮寫，簡單說就是把產品需求整理成一份清楚的資料，交給工廠，讓工廠可以據此判斷：能不能做、多少錢、多久可以交貨，以及其他合作條件。",
      ] },

      { type: "heading", text: "最基本要提供哪些資料？" },
      { type: "paragraph", text: "不管做什麼產品，詢價時至少要提供：" },
      { type: "list", items: ["產品名稱", "用途", "數量", "材質", "尺寸", "圖面或照片", "交期", "特殊需求", "顏色", "表面處理", "印刷需求", "包裝需求", "檢驗需求", "認證需求"] },

      { type: "heading", text: "如果是零件加工，要準備更多資料嗎？" },
      { type: "paragraph", text: "會，零件加工對規格精準度要求較高，建議額外準備：" },
      { type: "list", items: ["2D 圖", "3D 圖", "材質", "尺寸", "公差", "表面粗糙度", "表面處理需求", "數量"] },

      { type: "heading", text: "只有照片，沒有圖面怎麼辦？" },
      { type: "paragraph", text: "可以先用照片詢問，工廠通常能給出初步評估，但精密零件、模具或機構件，最後仍然需要圖面或尺寸資訊才能報出準確價格。", segments: [
        "可以先用照片詢問，工廠通常能給出初步評估，但",
        { text: "精密零件、模具或機構件，最後仍然需要圖面或尺寸資訊才能報出準確價格", emphasis: "secondary" },
        "。",
      ] },
      { type: "paragraph", text: "如果你只有產品概念，還沒有具體設計，也可以考慮找同時提供設計協助的 ODM 合作夥伴，讓工廠一起參與開發。" },

      { type: "heading", text: "數量為什麼一定要先講？" },
      { type: "paragraph", text: "數量會直接影響 MOQ、單價、是否需要開模具或治具、適合的製程與設備，以及交期。例如首批只需要 500 件，跟年需求量 5,000 件，工廠可能會建議完全不同的製程與報價方式——數量沒講清楚，工廠很難給出真正適合的方案。", segments: [
        "數量會直接影響 MOQ、單價、是否需要開模具或治具、適合的製程與設備，以及交期。例如首批只需要 500 件，跟年需求量 5,000 件，工廠可能會建議完全不同的製程與報價方式——",
        { text: "數量沒講清楚，工廠很難給出真正適合的方案", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "詢價時，有哪些資訊很容易漏掉？" },
      { type: "paragraph", text: "以下這些資訊很常被忽略，但其實會直接影響報價與合作方式：" },
      { type: "list", items: ["是否需要打樣", "交貨地點", "包裝方式", "稅務相關", "檢驗標準", "預計量產時間", "模具歸屬權", "保密需求", "是否有來料", "後加工需求"] },

      { type: "heading", text: "詢價是不是資料越多越好？" },
      { type: "paragraph", text: "不是資料越多越好，而是要讓工廠看完之後，可以清楚判斷三件事：能不能做、怎麼做、多少錢。把真正影響報價與可行性的資訊準備清楚，比堆一堆用不到的資料更有效率。", segments: [
        { text: "不是資料越多越好，而是要讓工廠看完之後，可以清楚判斷三件事：能不能做、怎麼做、多少錢", emphasis: "primary" },
        "。把真正影響報價與可行性的資訊準備清楚，比堆一堆用不到的資料更有效率。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["first-time-factory-guide", "how-to-read-factory-quotes"],
    cta: {
      label: "前往 OXM 開始詢價",
      href: "/search",
      description: "把上面的資料準備好後，直接到 OXM 搜尋適合的工廠，開始正式詢價。",
    },
  },
  {
    slug: "what-is-prototyping",
    libraryId: "LIB-009",
    title: "打樣是什麼？從樣品到量產通常要經過哪些階段？",
    metaDescription: "打樣是什麼？為什麼有圖面了還需要打樣？這篇文章說明打樣的目的、從樣品到量產的完整流程，以及小量試產跟打樣的差別。",
    h1: "打樣是什麼？從樣品到量產通常要經過哪些階段？",
    excerpt: "說明打樣的目的、從樣品到量產的完整流程，以及小量試產跟打樣的差別。",
    category: "採購與品質",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 90,
    body: [
      { type: "paragraph", text: "打樣，是很多人第一次找代工時聽到、但不一定完全理解的步驟。這篇文章說明打樣的目的，以及從樣品到量產通常會經過哪些階段。" },

      { type: "heading", text: "打樣是什麼？" },
      { type: "paragraph", text: "打樣就是在正式量產之前，先做出少量、甚至一件實際樣品，用來確認：" },
      { type: "list", items: ["外觀", "尺寸", "功能", "材質", "裝配", "顏色", "使用方式"] },
      { type: "paragraph", text: "核心目的是提前發現問題——在量產之前先確認過一次，遠比量產後才發現問題要便宜、也容易處理得多。", segments: [
        { text: "核心目的是提前發現問題", emphasis: "primary" },
        "——在量產之前先確認過一次，遠比量產後才發現問題要便宜、也容易處理得多。",
      ] },

      { type: "heading", text: "有圖面了，為什麼還需要打樣？" },
      { type: "paragraph", text: "圖面正確，不代表實物一定完全符合需求。實際做出來後，常常會發現圖面沒抓到的問題，例如：" },
      { type: "list", items: ["零件裝配是否順暢", "是否有結構干涉", "材料實際手感與預期不同", "強度不如預期", "外觀效果跟想像有落差", "製程限制導致部分設計做不出來"] },
      { type: "paragraph", text: "這些問題通常只有做出實物才會發現，這也是打樣存在的意義。" },

      { type: "heading", text: "一般會從打樣直接進量產嗎？" },
      { type: "paragraph", text: "通常不會直接跳過去，完整流程大致是：" },
      { type: "list", items: ["需求確認", "設計／圖面", "第一次打樣", "測試與修改", "第二版樣品", "小量試產", "量產"] },

      { type: "heading", text: "小量試產跟打樣有什麼差別？" },
      { type: "paragraph", text: "打樣要確認的是「產品做不做得對」；小量試產則是進一步驗證量產前的生產狀況，包括：" },
      { type: "list", items: ["生產流程是否順暢", "品質是否穩定", "良率", "工時", "包裝流程", "生產節拍", "供應鏈是否穩定"] },
      { type: "paragraph", text: "簡單說，打樣看的是「產品」，小量試產看的是「量產這件事本身」。", segments: [
        "簡單說，",
        { text: "打樣看的是「產品」，小量試產看的是「量產這件事本身」", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "是不是每一個產品都一定要打樣？" },
      { type: "paragraph", text: "不是。標準品或已經很成熟的產品，有時候可以省略完整打樣流程。但以下情況通常建議先打樣：新產品、新模具、新材料、新供應商，或是採用新製程時——任何一個環節是「第一次」，都值得先花時間打樣確認。", segments: [
        "不是。標準品或已經很成熟的產品，有時候可以省略完整打樣流程。但以下情況通常建議先打樣：新產品、新模具、新材料、新供應商，或是採用新製程時——",
        { text: "任何一個環節是「第一次」，都值得先花時間打樣確認", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "找打樣工廠時要注意什麼？" },
      { type: "paragraph", text: "選擇打樣合作對象時，建議先確認：" },
      { type: "list", items: ["是否接受打樣訂單", "打樣製程是否接近實際量產製程", "打樣費用", "修改費用", "打樣所需時間", "後續是否有量產能力"] },

      { type: "heading", text: "樣品確認後，就可以放心量產了嗎？" },
      { type: "paragraph", text: "樣品沒問題，不代表可以直接大量下單。放量產前，還要再確認：", segments: [
        { text: "樣品沒問題，不代表可以直接大量下單", emphasis: "primary" },
        "。放量產前，還要再確認：",
      ] },
      { type: "list", items: ["最終規格是否鎖定", "驗收標準", "包裝方式", "正式訂單數量", "交期", "品質標準", "異常狀況的處理方式"] },
      { type: "paragraph", text: "如果是大訂單，建議先進行小量試產，驗證整個生產流程穩定後，再正式放大到全部數量。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["small-batch-manufacturing", "how-to-choose-a-factory"],
    cta: {
      label: "查看可打樣的工廠",
      href: "/search?sample=true",
      description: "確認打樣的重點後，直接到 OXM 篩選可打樣的工廠，開始第一輪樣品確認。",
    },
  },
  // ===== Level 3：製程與製造知識（見任務定案「傳產圖書館內容完成階段」，
  // Batch A：10～18）。libraryId 沿用 Master Plan 給定編號（LIB-010～045
  // 直接對應題號 10～45），learningOrder 依實際閱讀順序另外安排，兩者刻意
  //不同——例如材料知識 Level 4 內部的題號順序（26～35）跟 learningOrder
  // 順序不完全一致（27/28 在 learningOrder 上排在 26 之前），因為
  // Master Plan 題號只是「上架順序」，不是「該怎麼讀」。 =====
  {
    slug: "new-product-development-partners",
    libraryId: "LIB-010",
    title: "開發新產品時，該先找設計公司、模具廠還是製造商？",
    metaDescription: "第一次開發新產品，不確定該先找設計公司、模具廠還是製造商？這篇文章依你目前手上有什麼（概念、圖面或樣品），說明該先找哪一種合作夥伴。",
    h1: "開發新產品時，該先找設計公司、模具廠還是製造商？",
    excerpt: "依你目前手上有什麼（概念、圖面或樣品），說明第一步該先找哪一種合作夥伴。",
    category: "採購與品質",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 100,
    body: [
      { type: "paragraph", text: "第一次開發新產品，最常卡住的不是找不到工廠，而是不知道自己現在該找「哪一種」合作夥伴。這篇文章依你目前手上有什麼，說明第一步該往哪裡走。" },

      { type: "heading", text: "剛有產品想法，應該先找誰？" },
      { type: "paragraph", text: "依你目前手上有什麼來判斷：只有概念，適合先找設計公司或提供設計協助的 ODM 工廠；已有設計圖但還沒開模，適合找模具廠；已經有樣品準備量產，才輪到找製造商／代工廠。" },

      { type: "heading", text: "設計公司、模具廠、製造商，各自負責什麼？" },
      { type: "list", items: [
        "設計公司：負責產品外觀、結構、功能設計，產出可製造的圖面",
        "模具廠：依圖面開模，是量產前的關鍵一步，但不是所有產品都需要模具",
        "製造商／代工廠：依模具或既定製程量產，部分工廠也同時提供設計協助（ODM）",
      ] },

      { type: "heading", text: "我已經有設計圖了，是不是可以直接找工廠開模？" },
      { type: "paragraph", text: "可以，但建議先確認圖面是否包含公差、材質規格、表面處理需求，很多工廠會建議先打樣確認可行性再開模，直接開模的風險較高。", segments: [
        "可以，但建議先確認圖面是否包含公差、材質規格、表面處理需求，",
        { text: "很多工廠會建議先打樣確認可行性再開模，直接開模的風險較高", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "如果我什麼都沒有，只有一個概念，該怎麼辦？" },
      { type: "paragraph", text: "建議找同時提供設計協助的 ODM 工廠或設計公司，先把概念變成具體圖面或原型，確認可行後，再往下一步找模具廠或量產工廠。" },

      { type: "heading", text: "找錯順序會有什麼問題？" },
      { type: "paragraph", text: "常見狀況包括：設計沒有考慮到可製造性（DFM 問題）、模具開好才發現設計有問題（重新開模成本很高）、找到的量產商不擅長你需要的製程。" },
      { type: "paragraph", text: "順序錯了，最貴的錯誤通常出現在開模之後才發現，這也是為什麼「先確認現在該找誰」比急著開模更重要。", segments: [
        { text: "順序錯了，最貴的錯誤通常出現在開模之後才發現", emphasis: "primary" },
        "，這也是為什麼「先確認現在該找誰」比急著開模更重要。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-contract-manufacturing", "what-is-mold-making"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認自己現在該找哪一種合作夥伴後，直接到 OXM 依產業與合作模式篩選，找到對的起點。",
    },
  },
  {
    slug: "what-is-cnc-machining",
    libraryId: "LIB-011",
    title: "CNC 加工是什麼？什麼產品適合 CNC？",
    metaDescription: "CNC 加工是什麼？這篇文章說明 CNC 加工的原理、適合做出什麼樣的產品、跟射出鈑金比起來的優勢，以及第一次找 CNC 加工廠該準備什麼。",
    h1: "CNC 加工是什麼？什麼產品適合 CNC？",
    excerpt: "說明 CNC 加工的原理、適合的產品類型，以及跟射出鈑金比起來的優勢與限制。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 110,
    body: [
      { type: "paragraph", text: "CNC 加工是製造業裡最常被提到的關鍵字之一，但很多人不確定它實際上是怎麼運作的。這篇文章從基本原理開始，說明 CNC 適合做什麼、不適合做什麼。" },

      { type: "heading", text: "CNC 加工是什麼？" },
      { type: "paragraph", text: "CNC（Computer Numerical Control，電腦數控）加工，是用電腦程式控制機台，把一塊材料（金屬、塑膠等）切削、鑽孔、車銑成想要的形狀。核心概念是：CNC 是「減法製造」——從一塊材料裡把多餘的部分去除，做出成品。", segments: [
        "CNC（Computer Numerical Control，電腦數控）加工，是用電腦程式控制機台，把一塊材料（金屬、塑膠等）切削、鑽孔、車銑成想要的形狀。核心概念是：",
        { text: "CNC 是「減法製造」", emphasis: "primary" },
        "——從一塊材料裡把多餘的部分去除，做出成品。",
      ] },

      { type: "heading", text: "CNC 加工可以做出什麼樣的產品？" },
      { type: "paragraph", text: "常見應用包括：" },
      { type: "list", items: ["精密零件", "治具與夾具", "小量原型／樣品", "客製化五金零件", "醫療、航太等高精度需求產品"] },
      { type: "paragraph", text: "搭配五軸或車銑複合機台，CNC 也能加工形狀更複雜的零件。" },

      { type: "heading", text: "CNC 跟射出、鈑金比起來，優勢是什麼？" },
      { type: "paragraph", text: "CNC 不需要開模具，適合小量、客製化、快速打樣；射出跟鈑金通常需要模具或治具，量大時單價較低但前期投入較高。", segments: [
        { text: "CNC 不需要開模具，適合小量、客製化、快速打樣", emphasis: "secondary" },
        "；射出跟鈑金通常需要模具或治具，量大時單價較低但前期投入較高。",
      ] },

      { type: "heading", text: "什麼情況下不適合用 CNC？" },
      { type: "paragraph", text: "當數量很大、形狀相對單純時，CNC 的單價通常會高於射出或沖壓——材料被切削掉的部分也是成本浪費。數量很大時，開模具量產通常比 CNC 更划算。", segments: [
        "當數量很大、形狀相對單純時，CNC 的單價通常會高於射出或沖壓——材料被切削掉的部分也是成本浪費。",
        { text: "數量很大時，開模具量產通常比 CNC 更划算", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "第一次找 CNC 加工廠，要準備什麼？" },
      { type: "paragraph", text: "基本會需要：2D／3D 圖、材質、尺寸、公差、表面處理需求、數量，這幾項資訊越完整，工廠越能給出準確報價。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-rfq", "how-to-choose-a-factory"],
    cta: {
      label: "前往 OXM 找 CNC 加工廠",
      href: "/factories/cnc-machining",
      description: "直接到 OXM 查看可承接 CNC 代工與精密零件加工需求的工廠，依地區與生產條件篩選詢價。",
    },
  },
  {
    slug: "what-is-sheet-metal-fabrication",
    libraryId: "LIB-012",
    title: "鈑金加工是什麼？雷射切割、折床、焊接怎麼配合？",
    metaDescription: "鈑金加工是什麼？這篇文章說明雷射切割、折床、焊接在鈑金加工流程裡分別扮演什麼角色，鈑金適合做什麼產品，以及跟 CNC 有什麼不同。",
    h1: "鈑金加工是什麼？雷射切割、折床、焊接怎麼配合？",
    excerpt: "說明雷射切割、折床、焊接在鈑金加工流程裡的角色，以及鈑金適合做什麼產品。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 120,
    body: [
      { type: "paragraph", text: "鈑金加工常常跟雷射切割、折床、焊接這幾個詞一起出現，很多人不確定它們是不同的技術，還是同一件事的不同稱呼。這篇文章說明它們實際上是怎麼配合的。" },

      { type: "heading", text: "鈑金加工是什麼？" },
      { type: "paragraph", text: "鈑金加工是把金屬薄板（鋼板、鋁板、不鏽鋼板等）透過切割、折彎、沖孔、焊接等工序，加工成需要的形狀與結構。" },

      { type: "heading", text: "雷射切割、折床、焊接分別做什麼？" },
      { type: "list", items: [
        "雷射切割：依圖面切出外型輪廓與孔位，精度高",
        "折床：把切好的板材折彎成立體形狀",
        "焊接：把多個鈑金件接合成一個完整結構",
      ] },
      { type: "paragraph", text: "三者通常是同一個鈑金加工流程裡的不同步驟，不是互相替代的技術。", segments: [
        { text: "三者通常是同一個鈑金加工流程裡的不同步驟，不是互相替代的技術", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "鈑金加工可以做出什麼樣的產品？" },
      { type: "list", items: ["機殼／機箱", "控制箱", "招牌與展示架", "工業設備外殼", "家具／建材配件"] },

      { type: "heading", text: "鈑金跟 CNC 有什麼不同？" },
      { type: "paragraph", text: "鈑金加工的材料是「板材」，主要靠切割加折彎成形；CNC 是從一塊實心材料切削出形狀。鈑金適合做薄板結構件，CNC 適合做精密實心零件。", segments: [
        "鈑金加工的材料是「板材」，主要靠切割加折彎成形；CNC 是從一塊實心材料切削出形狀。",
        { text: "鈑金適合做薄板結構件，CNC 適合做精密實心零件", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "找鈑金加工廠，要準備什麼資料？" },
      { type: "paragraph", text: "圖面或照片、材質與厚度、尺寸、表面處理需求（例如烤漆或電鍍）、數量，以及是否需要後續焊接組裝。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-cnc-machining", "casting-forging-cnc-comparison"],
    cta: {
      label: "前往 OXM 找鈑金加工廠",
      href: "/factories/sheet-metal",
      description: "直接到 OXM 查看可承接鈑金代工與金屬製造需求的工廠，依地區與生產條件篩選詢價。",
    },
  },
  {
    slug: "what-is-metal-stamping",
    libraryId: "LIB-013",
    title: "金屬沖壓是什麼？什麼情況適合開沖壓模具？",
    metaDescription: "金屬沖壓是什麼？這篇文章說明沖壓跟鈑金加工的差別、什麼情況適合開沖壓模具，以及沖壓模具費用高不高、值不值得開。",
    h1: "金屬沖壓是什麼？什麼情況適合開沖壓模具？",
    excerpt: "說明沖壓跟鈑金加工的差別，以及什麼情況適合開沖壓模具。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 130,
    body: [
      { type: "paragraph", text: "金屬沖壓常常跟鈑金加工放在一起討論，但兩者其實是不同的生產邏輯。這篇文章說明沖壓的原理，以及什麼情況才真的值得開沖壓模具。" },

      { type: "heading", text: "金屬沖壓是什麼？" },
      { type: "paragraph", text: "金屬沖壓是用沖壓模具，透過機台的沖壓力，把金屬板材一次成型成需要的形狀（例如沖孔、彎曲、拉伸）。" },

      { type: "heading", text: "沖壓跟鈑金加工有什麼不同？" },
      { type: "paragraph", text: "鈑金加工不需要模具，彈性高、適合小量與多樣化設計；沖壓需要先開模具，適合大量、形狀固定的零件，一旦開模，量產速度快、單價低。", segments: [
        "鈑金加工不需要模具，彈性高、適合小量與多樣化設計；",
        { text: "沖壓需要先開模具，適合大量、形狀固定的零件", emphasis: "primary" },
        "，一旦開模，量產速度快、單價低。",
      ] },

      { type: "heading", text: "什麼情況適合開沖壓模具？" },
      { type: "paragraph", text: "當你的產品數量夠大（通常上萬件以上）、設計已經定案不太會再改，沖壓模具的高前期投入才划算得起來。" },

      { type: "heading", text: "沖壓模具費用高不高？值得開嗎？" },
      { type: "paragraph", text: "沖壓模具費用會因為零件複雜度、材料厚度與精度要求而不同，是一次性投入；量產後單價會壓得很低。" },
      { type: "paragraph", text: "第一次合作建議先用小量的鈑金或 CNC 打樣驗證設計，確定沒問題再考慮開沖壓模具。", segments: [
        { text: "第一次合作建議先用小量的鈑金或 CNC 打樣驗證設計，確定沒問題再考慮開沖壓模具", emphasis: "secondary" },
        "。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-sheet-metal-fabrication", "what-is-mold-making"],
    cta: {
      label: "前往 OXM 找金屬加工廠",
      href: "/search",
      description: "整理好沖壓需求後，直接到 OXM 依產業與地區篩選金屬加工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "casting-forging-cnc-comparison",
    libraryId: "LIB-014",
    title: "鑄造、鍛造、CNC 有什麼差別？怎麼選？",
    metaDescription: "鑄造、鍛造、CNC 有什麼差別？這篇文章比較三種金屬成型方式的原理、強度、成本與適合的產品類型，幫你判斷自己的產品該選哪一種。",
    h1: "鑄造、鍛造、CNC 有什麼差別？怎麼選？",
    excerpt: "比較鑄造、鍛造、CNC 三種金屬成型方式的原理、強度、成本與適合的產品類型。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 140,
    body: [
      { type: "paragraph", text: "鑄造、鍛造、CNC 都是常見的金屬零件成型方式，但原理跟適合的應用完全不同。這篇文章用比較的方式，幫你快速判斷自己的產品該選哪一種。" },

      { type: "heading", text: "鑄造是什麼？" },
      { type: "paragraph", text: "鑄造是把金屬加熱融化成液態，倒入模具中冷卻成型，適合做形狀複雜、需要量產的零件。" },

      { type: "heading", text: "鍛造是什麼？" },
      { type: "paragraph", text: "鍛造是把金屬加熱到一定溫度後，用外力（敲打、擠壓）改變形狀，過程中金屬內部組織會變得更緊密，強度通常比鑄造件更高。", segments: [
        "鍛造是把金屬加熱到一定溫度後，用外力（敲打、擠壓）改變形狀，過程中金屬內部組織會變得更緊密，",
        { text: "強度通常比鑄造件更高", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "鑄造、鍛造、CNC 主要差在哪？" },
      { type: "list", items: [
        "鑄造：適合複雜形狀、量產，強度中等，成本較低",
        "鍛造：強度最高，適合承受高應力的零件，形狀較單純，成本較高",
        "CNC：精度最高、彈性最大，適合小量或客製，材料浪費相對較多",
      ] },

      { type: "heading", text: "這三種製程分別適合什麼產品？" },
      { type: "list", items: [
        "鑄造 → 引擎零件、五金配件、複雜外殼",
        "鍛造 → 承受高負荷的結構件、工具、汽車零件",
        "CNC → 精密零件、小量客製、原型打樣",
      ] },

      { type: "heading", text: "怎麼判斷自己的產品該選哪一種？" },
      { type: "paragraph", text: "先看數量與應力需求：小量或客製選 CNC；大量且形狀複雜選鑄造；需要承受高外力、要求高強度選鍛造。不確定時，可以先跟工廠討論產品用途，讓工廠依經驗建議合適製程。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-cnc-machining", "what-is-sheet-metal-fabrication"],
    cta: {
      label: "前往 OXM 找金屬加工廠",
      href: "/search",
      description: "確認合適的成型方式後，直接到 OXM 依產業與地區篩選金屬加工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "surface-finishing-comparison",
    libraryId: "LIB-015",
    title: "表面處理怎麼選？電鍍、陽極、烤漆差在哪？",
    metaDescription: "表面處理怎麼選？這篇文章說明電鍍、陽極、烤漆的原理與差異，幫你判斷自己的產品適合哪一種表面處理，以及表面處理會不會影響成本與交期。",
    h1: "表面處理怎麼選？電鍍、陽極、烤漆差在哪？",
    excerpt: "說明電鍍、陽極、烤漆的原理與差異，幫你判斷自己的產品適合哪一種表面處理。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 150,
    body: [
      { type: "paragraph", text: "零件加工完成後，很多產品還需要一道表面處理才算真正完工。這篇文章說明電鍍、陽極、烤漆分別是什麼，以及該怎麼選。" },

      { type: "heading", text: "為什麼零件做完還需要表面處理？" },
      { type: "paragraph", text: "表面處理不只是為了好看，還可以增加耐蝕性、耐磨性、導電性，或改變手感。核心概念是保護與強化零件表面，不是純裝飾。", segments: [
        "表面處理不只是為了好看，還可以增加耐蝕性、耐磨性、導電性，或改變手感。核心概念是",
        { text: "保護與強化零件表面，不是純裝飾", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "電鍍是什麼？" },
      { type: "paragraph", text: "電鍍是透過電解方式，在零件表面鍍上一層金屬（例如鍍鎳、鍍鉻），可以增加耐蝕性與外觀質感，適合金屬件。" },

      { type: "heading", text: "陽極處理是什麼？" },
      { type: "paragraph", text: "陽極處理最常見用於鋁材，透過電解在表面形成一層氧化膜，可以染色、增加耐磨與耐蝕性，是鋁製品常見的表面處理方式。" },

      { type: "heading", text: "烤漆是什麼？" },
      { type: "paragraph", text: "烤漆是把漆料噴塗在零件表面後高溫烘烤固化，可以做出多種顏色與質感，金屬與部分塑膠件都可以使用。" },

      { type: "heading", text: "電鍍、陽極、烤漆怎麼選？" },
      { type: "paragraph", text: "需要金屬光澤或導電性，選電鍍；鋁件、想要染色或霧面質感，選陽極；需要特定顏色、多種材質都適用，選烤漆。陽極處理最常見用於鋁材，電鍍與烤漆適用範圍較廣。", segments: [
        "需要金屬光澤或導電性，選電鍍；鋁件、想要染色或霧面質感，選陽極；需要特定顏色、多種材質都適用，選烤漆。",
        { text: "陽極處理最常見用於鋁材，電鍍與烤漆適用範圍較廣", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "表面處理會影響成本跟交期嗎？" },
      { type: "paragraph", text: "會。表面處理通常是製程的最後一道工序，常見會外包給專門廠商處理，會增加交期，也是報價項目之一，詢價時記得一併確認。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-cnc-machining", "what-is-sheet-metal-fabrication"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認合適的表面處理方式後，直接到 OXM 依產業與地區篩選工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "what-is-mold-making",
    libraryId: "LIB-016",
    title: "開模是什麼？開模流程、費用與注意事項",
    metaDescription: "開模是什麼？這篇文章說明開模的基本流程、費用怎麼算、開模前該注意什麼，以及開模後能不能隨便修改設計。",
    h1: "開模是什麼？開模流程、費用與注意事項",
    excerpt: "說明開模的基本流程、費用怎麼算，以及開模前後需要注意的事項。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 160,
    body: [
      { type: "paragraph", text: "很多需要量產的產品，最終都會走到「開模」這一步，但第一次接觸的人常常不確定流程跟費用是怎麼一回事。這篇文章整理開模的基本知識。" },

      { type: "heading", text: "開模是什麼？" },
      { type: "paragraph", text: "開模，是依照產品設計圖，製作一套專屬模具，之後就能用這套模具大量複製出一樣的零件（常見於塑膠射出、金屬沖壓）。" },

      { type: "heading", text: "為什麼要開模？不能直接用 CNC 做量產嗎？" },
      { type: "paragraph", text: "可以，但 CNC 是一件一件切削，量大時速度慢、單價高；開模之後量產速度快、單件成本低，適合大量生產。", segments: [
        "可以，但 CNC 是一件一件切削，量大時速度慢、單價高；",
        { text: "開模之後量產速度快、單件成本低，適合大量生產", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "開模流程大概是怎麼樣？" },
      { type: "list", items: ["設計確認", "模具設計（可製造性 DFM 評估）", "模具製造", "試模（T0／T1 樣品）", "修模", "正式量產"] },

      { type: "heading", text: "開模費用怎麼算？" },
      { type: "paragraph", text: "開模費用是一次性投入，會因為模具複雜度、穴數（一次能生產幾件）、材質、精度要求而不同，越複雜的模具費用越高。" },

      { type: "heading", text: "開模前要注意什麼？" },
      { type: "list", items: ["設計是否已經定案（改模成本很高）", "材質選定", "公差要求", "後續量產數量（影響模具材質選擇）", "模具歸屬權是否寫清楚"] },
      { type: "paragraph", text: "設計是否已經定案，是開模前最需要先確認清楚的一件事——改模成本很高。", segments: [
        "設計是否已經定案，是開模前最需要先確認清楚的一件事——",
        { text: "改模成本很高", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "開模後可以隨便修改設計嗎？" },
      { type: "paragraph", text: "開模後修改設計通常需要改模，會產生額外費用與時間，修改幅度大時甚至可能要重新開模，所以設計定案再開模非常重要。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-plastic-injection-molding", "what-is-metal-stamping"],
    cta: {
      label: "前往 OXM 找模具廠",
      href: "/factories/mold-making",
      description: "直接到 OXM 查看可承接模具製造、加工與開模需求的廠商，依地區與生產條件篩選詢價。",
    },
  },
  {
    slug: "what-is-plastic-injection-molding",
    libraryId: "LIB-017",
    title: "塑膠射出是什麼？什麼產品適合射出成型？",
    metaDescription: "塑膠射出是什麼？這篇文章說明射出成型的基本流程、適合什麼產品、數量小是否還能做，以及找射出代工廠要準備什麼資料。",
    h1: "塑膠射出是什麼？什麼產品適合射出成型？",
    excerpt: "說明射出成型的基本流程、適合的產品類型，以及找射出代工廠要準備什麼資料。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 170,
    body: [
      { type: "paragraph", text: "塑膠射出是最常見的塑膠量產方式，幾乎所有的塑膠外殼、容器、零件背後都有射出成型的影子。這篇文章說明它的基本原理與適用情境。" },

      { type: "heading", text: "塑膠射出是什麼？" },
      { type: "paragraph", text: "塑膠射出（Injection Molding）是把塑膠原料加熱融化後，用高壓射入模具內冷卻成型的製程，是最常見的塑膠量產方式。" },

      { type: "heading", text: "射出成型的基本流程是什麼？" },
      { type: "list", items: ["塑膠原料加熱融化", "高壓射入模具", "冷卻定型", "開模取出成品", "去除澆口毛邊"] },

      { type: "heading", text: "什麼產品適合用射出成型？" },
      { type: "paragraph", text: "適合外殼、容器、零件等需要大量、形狀一致的塑膠製品——只要開好模具，就能快速複製出大量一樣的成品。", segments: [
        "適合外殼、容器、零件等需要大量、形狀一致的塑膠製品——",
        { text: "只要開好模具，就能快速複製出大量一樣的成品", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "射出成型量小可以做嗎？" },
      { type: "paragraph", text: "可以，但射出需要先開模具，數量太小時分攤到每件的模具成本會很高，通常建議數量夠大（或先用小量模／3D 列印打樣）再考慮開正式模具。" },

      { type: "heading", text: "找射出代工廠要準備什麼？" },
      { type: "paragraph", text: "圖面或 3D 檔、材質需求、顏色、表面需求（光面／霧面／紋路）、預估數量、是否已有模具。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-mold-making", "plastic-molding-process-comparison"],
    cta: {
      label: "前往 OXM 找塑膠射出代工廠",
      href: "/factories/plastic-injection",
      description: "直接到 OXM 查看可承接射出成型與塑膠製品代工需求的工廠，依地區與生產條件篩選詢價。",
    },
  },
  {
    slug: "plastic-molding-process-comparison",
    libraryId: "LIB-018",
    title: "射出、押出、吹塑、真空成型有什麼差別？",
    metaDescription: "射出、押出、吹塑、真空成型有什麼差別？這篇文章比較四種塑膠成型方式的基本邏輯與適合的產品類型，幫你判斷自己的產品該用哪一種。",
    h1: "射出、押出、吹塑、真空成型有什麼差別？",
    excerpt: "比較射出、押出、吹塑、真空成型四種塑膠成型方式的基本邏輯與適合的產品類型。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 180,
    body: [
      { type: "paragraph", text: "塑膠成型方式不只有射出一種，押出、吹塑、真空成型也是常見的製程，但很多人不確定它們的差別在哪裡。這篇文章用比較的方式整理清楚。" },

      { type: "heading", text: "這幾種塑膠成型方式基本邏輯有什麼不同？" },
      { type: "paragraph", text: "這幾種製程的差別主要在「塑膠怎麼被塑形」：射出是把熔融塑膠射進模具裡；押出是把塑膠連續擠出成固定截面形狀；吹塑是把塑膠吹脹撐開模具內壁；真空成型是把塑膠片材加熱軟化後用真空吸附成型。", segments: [
        "這幾種製程的差別主要在",
        { text: "「塑膠怎麼被塑形」", emphasis: "primary" },
        "：射出是把熔融塑膠射進模具裡；押出是把塑膠連續擠出成固定截面形狀；吹塑是把塑膠吹脹撐開模具內壁；真空成型是把塑膠片材加熱軟化後用真空吸附成型。",
      ] },

      { type: "heading", text: "押出是什麼？" },
      { type: "paragraph", text: "押出（Extrusion）是把塑膠原料連續擠壓通過模口，做出截面固定、長度連續的產品，例如管材、板材、型材。" },

      { type: "heading", text: "吹塑是什麼？" },
      { type: "paragraph", text: "吹塑（Blow Molding）是把一段熔融塑膠管放入模具，用氣體吹脹使其貼合模壁成型，適合做中空容器，例如瓶罐。" },

      { type: "heading", text: "真空成型是什麼？" },
      { type: "paragraph", text: "真空成型（Vacuum Forming）是把塑膠片材加熱軟化後，用真空吸力貼合模具成型，適合做淺盤、包裝托盤、大尺寸薄殼產品，模具成本通常比射出低。", segments: [
        "真空成型（Vacuum Forming）是把塑膠片材加熱軟化後，用真空吸力貼合模具成型，適合做淺盤、包裝托盤、大尺寸薄殼產品，",
        { text: "模具成本通常比射出低", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "怎麼判斷自己的產品該用哪一種？" },
      { type: "list", items: [
        "實心／複雜零件 → 射出",
        "長條／固定截面產品（管、條、板）→ 押出",
        "中空容器（瓶罐）→ 吹塑",
        "淺盤、托盤、大尺寸薄殼 → 真空成型",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-plastic-injection-molding", "how-to-choose-plastic-materials"],
    cta: {
      label: "前往 OXM 找塑膠加工廠",
      href: "/search",
      description: "確認合適的成型方式後，直接到 OXM 查看塑膠相關代工廠，依地區與生產條件篩選詢價。",
    },
  },
  // ===== Level 3 續（Batch B：19～25，電子組裝 + 食品／化妝品代工）=====
  {
    slug: "what-is-smt",
    libraryId: "LIB-019",
    title: "SMT 是什麼？PCB 貼片與電子組裝流程一次看懂",
    metaDescription: "SMT 是什麼？這篇文章說明 SMT 貼片的基本流程、跟傳統插件（THT）有什麼不同、組裝完成後還需要做什麼，以及找 SMT 代工廠要準備什麼資料。",
    h1: "SMT 是什麼？PCB 貼片與電子組裝流程一次看懂",
    excerpt: "說明 SMT 貼片的基本流程、跟傳統插件的差異，以及找 SMT 代工廠要準備什麼資料。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 190,
    body: [
      { type: "paragraph", text: "只要產品裡有電路板，幾乎都會碰到 SMT 這個詞。這篇文章說明 SMT 是什麼、基本流程，以及第一次找 SMT 代工廠要準備什麼。" },

      { type: "heading", text: "SMT 是什麼？" },
      { type: "paragraph", text: "SMT（Surface Mount Technology，表面黏著技術）是把電子元件直接黏貼固定在電路板表面，取代早期用引腳穿孔焊接的方式，是目前電子組裝最主流的技術。" },

      { type: "heading", text: "SMT 的基本流程是什麼？" },
      { type: "list", items: ["印刷錫膏", "貼片（機器自動放置元件）", "迴焊（高溫讓錫膏融化固定元件）", "檢測（AOI 外觀檢查）"] },

      { type: "heading", text: "SMT 跟傳統插件（THT）有什麼不同？" },
      { type: "paragraph", text: "SMT 元件直接貼在板子表面，體積小、適合自動化大量生產；傳統插件（THT）元件有引腳需要穿孔焊接，適合承受較大應力的零件（例如接頭、變壓器）。實務上很多板子是兩種技術混合使用。", segments: [
        "SMT 元件直接貼在板子表面，體積小、適合自動化大量生產；傳統插件（THT）元件有引腳需要穿孔焊接，適合承受較大應力的零件（例如接頭、變壓器）。",
        { text: "實務上很多板子是兩種技術混合使用", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "SMT 組裝完成後，還需要做什麼？" },
      { type: "paragraph", text: "視產品需要，可能還要做測試（功能測試／ICT）、後焊（插件元件）、組裝外殼、老化測試等，不是貼完片就等於成品完成。" },

      { type: "heading", text: "找 SMT 代工廠要準備什麼資料？" },
      { type: "paragraph", text: "PCB 設計檔（Gerber）、料件清單（BOM）、數量、是否需要測試治具、交期需求。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["pcb-prototyping-process", "pcb-pcba-smt-comparison"],
    cta: {
      label: "前往 OXM 找 SMT 代工廠",
      href: "/factories/smt-assembly",
      description: "直接到 OXM 查看可承接 SMT 貼片與電子組裝需求的工廠，依地區與生產條件篩選詢價。",
    },
  },
  {
    slug: "pcb-prototyping-process",
    libraryId: "LIB-020",
    title: "PCB 打樣流程怎麼走？第一次做電路板要準備什麼？",
    metaDescription: "PCB 打樣流程怎麼走？這篇文章說明 PCB 打樣跟量產的差異、基本流程、第一次做電路板要準備哪些檔案，以及打樣沒問題後能不能直接量產。",
    h1: "PCB 打樣流程怎麼走？第一次做電路板要準備什麼？",
    excerpt: "說明 PCB 打樣跟量產的差異、基本流程，以及第一次做電路板要準備哪些檔案。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 200,
    body: [
      { type: "paragraph", text: "第一次做電路板，最常見的困惑是不知道打樣跟量產差在哪、該準備什麼檔案。這篇文章整理 PCB 打樣的基本流程。" },

      { type: "heading", text: "PCB 打樣是什麼？跟量產有什麼不同？" },
      { type: "paragraph", text: "PCB 打樣是先做少量電路板出來驗證設計是否正確，跟量產最大差別在數量與價格結構——打樣通常是小批量、單價較高，目的是先確認電路設計沒問題。" },

      { type: "heading", text: "PCB 打樣的基本流程是什麼？" },
      { type: "list", items: ["送出設計檔", "開版／製板", "電路板打樣完成", "組裝元件（如需要）", "測試驗證"] },

      { type: "heading", text: "第一次做 PCB，要準備哪些檔案？" },
      { type: "paragraph", text: "通常需要 Gerber 檔（電路板製造檔案）、料件清單（BOM），有時需要位置圖（貼片座標檔），第一次合作建議先跟工廠確認檔案格式需求。" },

      { type: "heading", text: "PCB 打樣通常要多久？" },
      { type: "paragraph", text: "依板子層數與複雜度不同，打樣時間差異大，簡單雙層板可能只需要幾天，複雜多層板需要較長時間，建議詢價時一併確認交期。" },

      { type: "heading", text: "打樣沒問題後，可以直接量產嗎？" },
      { type: "paragraph", text: "不建議。打樣主要驗證電路功能，量產前還需要驗證良率與供應鏈穩定度，建議先小量試產再放大到正式量產。", segments: [
        "不建議。",
        { text: "打樣主要驗證電路功能，量產前還需要驗證良率與供應鏈穩定度", emphasis: "primary" },
        "，建議先小量試產再放大到正式量產。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-smt", "pcb-pcba-smt-comparison"],
    cta: {
      label: "前往 OXM 找 PCB 廠商",
      href: "/factories/pcb",
      description: "直接到 OXM 查看可承接 PCB 打樣與製造需求的廠商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "pcb-pcba-smt-comparison",
    libraryId: "LIB-021",
    title: "PCB、PCBA、SMT 有什麼差別？",
    metaDescription: "PCB、PCBA、SMT 有什麼差別？這篇文章說明三者的定義與關係，以及詢價時該問 PCB 還是 PCBA，避免找錯服務範圍的廠商。",
    h1: "PCB、PCBA、SMT 有什麼差別？",
    excerpt: "說明 PCB、PCBA、SMT 三者的定義與關係，以及詢價時該問哪一種服務。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 210,
    body: [
      { type: "paragraph", text: "PCB、PCBA、SMT 這三個詞經常一起出現，很多人詢價時會搞混，導致找錯服務範圍的廠商。這篇文章把三者的關係說清楚。" },

      { type: "heading", text: "PCB 是什麼？" },
      { type: "paragraph", text: "PCB（Printed Circuit Board，印刷電路板）是一片還沒有裝上任何電子元件的「空板」，上面只有導電線路。" },

      { type: "heading", text: "PCBA 是什麼？" },
      { type: "paragraph", text: "PCBA（PCB Assembly）是已經把電子元件組裝焊接上去的「完成品電路板」，也就是 PCB + 元件 = PCBA。", segments: [
        "PCBA（PCB Assembly）是已經把電子元件組裝焊接上去的「完成品電路板」，也就是 ",
        { text: "PCB + 元件 = PCBA", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "SMT 跟 PCB、PCBA 是什麼關係？" },
      { type: "paragraph", text: "SMT 是把元件貼裝到 PCB 上、做成 PCBA 的其中一種組裝技術——PCB 是材料、PCBA 是成品、SMT 是把兩者連接起來的製程。", segments: [
        "SMT 是把元件貼裝到 PCB 上、做成 PCBA 的其中一種組裝技術——",
        { text: "PCB 是材料、PCBA 是成品、SMT 是把兩者連接起來的製程", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "詢價時該問 PCB 還是 PCBA？" },
      { type: "paragraph", text: "如果你只需要空板，詢問 PCB 製造廠；如果你需要完成組裝的電路板成品，要詢問可以做 PCBA（含 SMT 組裝）的工廠，兩者是不同的服務範圍，先確認清楚可以避免找錯廠商。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-smt", "pcb-prototyping-process"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認自己需要的是 PCB、PCBA 還是 SMT 服務後，直接到 OXM 依產業與地區篩選合適的廠商並詢價。",
    },
  },
  {
    slug: "what-is-wire-harness-assembly",
    libraryId: "LIB-022",
    title: "線束加工是什麼？線材、端子、連接器怎麼組成？",
    metaDescription: "線束加工是什麼？這篇文章說明線束由哪些部分組成、基本加工流程、什麼產品會用到線束，以及找線束加工廠要準備什麼資料。",
    h1: "線束加工是什麼？線材、端子、連接器怎麼組成？",
    excerpt: "說明線束由哪些部分組成、基本加工流程，以及找線束加工廠要準備什麼資料。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 220,
    body: [
      { type: "paragraph", text: "電子產品內部的配線，通常不是單純一條線，而是經過加工組裝的「線束」。這篇文章說明線束加工的基本知識。" },

      { type: "heading", text: "線束加工是什麼？" },
      { type: "paragraph", text: "線束加工是把線材依照設計裁切、剝皮、壓接端子，再組裝成一整組配線，讓產品內部的電子訊號與電源可以正確傳輸連接。" },

      { type: "heading", text: "線束通常由哪些部分組成？" },
      { type: "list", items: ["電線（依規格／線徑選擇）", "端子（壓接在線材末端，方便插接）", "連接器（把多條線材整合成一個插頭）", "保護材料（如熱縮套管、包覆膠帶）"] },

      { type: "heading", text: "線束加工的基本流程是什麼？" },
      { type: "list", items: ["裁線", "剝皮", "壓接端子", "組裝連接器", "測試（導通／耐壓測試）"] },

      { type: "heading", text: "什麼產品會用到線束？" },
      { type: "paragraph", text: "幾乎所有需要內部配線的電子產品都會用到，例如家電、汽車零件、工業設備、消費性電子產品。" },

      { type: "heading", text: "找線束加工廠要準備什麼資料？" },
      { type: "paragraph", text: "線束圖（接線圖）、線材規格、端子與連接器型號、數量、是否需要客製長度或顏色。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-smt", "what-is-rfq"],
    cta: {
      label: "前往 OXM 找線束加工廠",
      href: "/factories/wire-harness-assembly",
      description: "直接到 OXM 查看可承接線束加工、客製線組組裝需求的廠商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "how-to-start-food-oem",
    libraryId: "LIB-023",
    title: "食品代工怎麼開始？從配方、打樣到量產的基本流程",
    metaDescription: "食品代工怎麼開始？這篇文章說明從配方確認、打樣試吃到量產的基本流程，沒有配方能不能找代工廠，以及第一次找食品代工廠要準備什麼。",
    h1: "食品代工怎麼開始？從配方、打樣到量產的基本流程",
    excerpt: "說明從配方確認、打樣試吃到量產的基本流程，以及第一次找食品代工廠要準備什麼。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 230,
    body: [
      { type: "paragraph", text: "想推出自己的食品品牌，但不知道從哪裡開始找代工廠？這篇文章整理食品代工從配方到量產的基本流程。" },

      { type: "heading", text: "食品代工的基本流程是什麼？" },
      { type: "list", items: ["配方／產品概念確認", "找代工廠（依食品類型）", "打樣試吃調整", "法規／標示確認", "小量試產", "正式量產"] },

      { type: "heading", text: "我只有想法，沒有配方，可以找代工廠嗎？" },
      { type: "paragraph", text: "可以，很多食品代工廠同時提供 ODM 服務，會協助配方開發，你只需要提出想要的口味、定位或參考產品，工廠會協助調整出可量產的配方。", segments: [
        "可以，",
        { text: "很多食品代工廠同時提供 ODM 服務，會協助配方開發", emphasis: "primary" },
        "，你只需要提出想要的口味、定位或參考產品，工廠會協助調整出可量產的配方。",
      ] },

      { type: "heading", text: "食品打樣跟一般產品打樣有什麼不同？" },
      { type: "paragraph", text: "食品打樣除了確認外觀，更重要的是確認口味、口感、保存期限是否符合預期，通常需要多次試吃調整，跟一般工業產品「一次打樣定案」的模式不太一樣。" },

      { type: "heading", text: "食品代工需要哪些額外的合規文件？" },
      { type: "paragraph", text: "食品代工涉及成分標示、營養標示、保存期限測試等文件，跟一般製造業代工不同，詢價時建議一併確認。", segments: [
        { text: "食品代工涉及成分標示、營養標示、保存期限測試等文件，跟一般製造業代工不同", emphasis: "secondary" },
        "，詢價時建議一併確認。",
      ] },

      { type: "heading", text: "食品代工的 MOQ 通常怎麼算？" },
      { type: "paragraph", text: "食品 MOQ 通常以重量或箱數計算，會受原料最低採購量、產線批次大小影響，不同食品類型（烘焙／飲料／冷凍食品／調味料等）差異很大，建議直接跟工廠確認。" },

      { type: "heading", text: "第一次找食品代工廠，要準備什麼？" },
      { type: "paragraph", text: "產品概念或配方方向、目標定位（價位／通路）、預估數量、保存期限需求、包裝形式、預算。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["food-oem-odm-selection", "small-batch-manufacturing"],
    cta: {
      label: "前往 OXM 找食品代工廠",
      href: "/search",
      description: "整理好配方方向與需求後，直接到 OXM 依產業與地區篩選食品代工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "food-oem-odm-selection",
    libraryId: "LIB-024",
    title: "食品 OEM、ODM 怎麼選？品牌第一次找食品代工廠要注意什麼？",
    metaDescription: "食品 OEM、ODM 怎麼選？這篇文章說明食品代工的 OEM、ODM 差異、選工廠時除了價格還要看什麼，以及第一次合作需要簽署哪些文件。",
    h1: "食品 OEM、ODM 怎麼選？品牌第一次找食品代工廠要注意什麼？",
    excerpt: "說明食品代工的 OEM、ODM 差異，以及選食品代工廠時需要注意的重點。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 240,
    body: [
      { type: "paragraph", text: "確定要開始找食品代工廠後，接下來常見的問題是該選 OEM 還是 ODM，以及除了價格還該看什麼。這篇文章整理選廠時的重點。" },

      { type: "heading", text: "食品的 OEM 跟 ODM 差在哪？" },
      { type: "paragraph", text: "食品 OEM 是你已經有明確配方，工廠依配方代工生產；食品 ODM 是工廠已有配方或提供配方開發協助，你可以調整後用自己品牌販售——這跟一般製造業的 OEM／ODM 定義一致，只是套用在食品產業上。" },

      { type: "heading", text: "我該選 OEM 還是 ODM？" },
      { type: "paragraph", text: "如果你已經有明確的配方跟口味定案，選 OEM；如果只有產品概念、還沒有具體配方，選 ODM 會更有效率。", segments: [
        "如果你已經有明確的配方跟口味定案，選 OEM；如果",
        { text: "只有產品概念、還沒有具體配方，選 ODM 會更有效率", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "選食品代工廠時，除了價格還要看什麼？" },
      { type: "list", items: [
        "是否有相關食品安全認證（如 ISO22000／HACCP）",
        "是否擅長你的產品類型（每家工廠專精的品項不同）",
        "打樣與試吃配合度",
        "保存期限與品管穩定度",
        "產能是否符合你的訂單規模",
      ] },

      { type: "heading", text: "食品代工廠的品管跟一般工廠有什麼不同？" },
      { type: "paragraph", text: "食品代工廠有額外的衛生管理規範與批次品管檢驗，跟一般工業品不完全一樣。", segments: [
        { text: "食品代工廠有額外的衛生管理規範與批次品管檢驗，跟一般工業品不完全一樣", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "第一次合作，需要簽署哪些文件？" },
      { type: "paragraph", text: "通常會需要簽署保密協議（NDA，尤其涉及配方時）、代工合約（載明品質標準與責任），部分工廠也會要求確認標示內容與法規遵循責任歸屬。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["how-to-start-food-oem", "oem-vs-odm"],
    cta: {
      label: "前往 OXM 找食品代工廠",
      href: "/search",
      description: "確認合作模式與需求後，直接到 OXM 依產業與地區篩選食品代工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "cosmetic-oem-odm-collaboration",
    libraryId: "LIB-025",
    title: "化妝品／保養品代工通常怎麼合作？",
    metaDescription: "化妝品、保養品代工通常怎麼合作？這篇文章說明合作模式、需要的檢驗文件、MOQ 怎麼算，以及第一次找化妝品代工廠要準備什麼。",
    h1: "化妝品／保養品代工通常怎麼合作？",
    excerpt: "說明化妝品、保養品代工的合作模式、需要的檢驗文件，以及第一次合作要準備什麼。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 250,
    body: [
      { type: "paragraph", text: "化妝品、保養品代工涉及的法規跟一般工業產品不太一樣，第一次接觸常常不知道該準備什麼。這篇文章整理基本合作模式與注意事項。" },

      { type: "heading", text: "化妝品代工的基本合作模式是什麼？" },
      { type: "paragraph", text: "化妝品／保養品代工同樣分 OEM（你提供配方或指定成分方向，工廠代工生產）與 ODM（工廠提供現成配方或協助開發配方），你可以依自己有沒有配方來選擇。" },

      { type: "heading", text: "化妝品代工跟一般產品代工有什麼不同？" },
      { type: "paragraph", text: "化妝品／保養品涉及法規與安全性審查，流程比一般工業產品多一道合規確認。", segments: [
        { text: "化妝品／保養品涉及法規與安全性審查，流程比一般工業產品多一道合規確認", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "保養品代工需要哪些額外的檢驗或文件？" },
      { type: "paragraph", text: "常見會需要：產品成分表（INCI）、安全性評估報告、必要時的功效測試報告，依銷售市場不同（例如是否外銷），法規要求也會不同，建議先跟工廠確認你的目標市場需要哪些文件。" },

      { type: "heading", text: "化妝品代工的 MOQ 通常怎麼算？" },
      { type: "paragraph", text: "化妝品 MOQ 通常跟包材規格、配方調製批量有關，不同品項（保養品／彩妝／清潔用品）差異大，也可能受限於最小生產批次，建議直接向工廠確認。" },

      { type: "heading", text: "打樣階段通常會確認什麼？" },
      { type: "paragraph", text: "打樣階段通常確認：質地、氣味、顏色、包材相容性——配方是否會腐蝕或影響包材、初步安定性測試，正式量產前建議再做完整的安定性測試。", segments: [
        "打樣階段通常確認：質地、氣味、顏色、",
        { text: "包材相容性——配方是否會腐蝕或影響包材", emphasis: "secondary" },
        "、初步安定性測試，正式量產前建議再做完整的安定性測試。",
      ] },

      { type: "heading", text: "第一次找化妝品代工廠，要準備什麼？" },
      { type: "paragraph", text: "產品定位與訴求、目標成分方向或參考配方、預估數量、包材需求、目標市場（影響法規要求）、預算與時程。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["food-oem-odm-selection", "oem-vs-odm"],
    cta: {
      label: "前往 OXM 找化妝品代工廠",
      href: "/factories/cosmetic-odm",
      description: "直接到 OXM 查看可承接保養品、化妝品代工需求的廠商，依地區篩選並直接詢價。",
    },
  },
  // ===== Level 4：材料知識（Batch C：26～35）。learningOrder 內部順序跟
  // 題號不完全一致（28/27 排在 26 之前）：先講廣義材料選擇（塑膠、橡膠矽膠
  // PU），再收斂到specific規格比較（食品醫療級矽膠、304/316），符合
  // 「基礎 → 比較 → 進階」，不是機械照題號排序。 =====
  {
    slug: "how-to-choose-plastic-materials",
    libraryId: "LIB-028",
    title: "塑膠材料怎麼選？常見塑膠材質與用途入門",
    metaDescription: "塑膠材料怎麼選？這篇文章介紹 PP、PE、ABS、PC 等常見塑膠材質代號的意思、怎麼依產品用途判斷該用哪種材質，以及材質會不會影響加工方式。",
    h1: "塑膠材料怎麼選？常見塑膠材質與用途入門",
    excerpt: "介紹常見塑膠材質代號的意思，以及怎麼依產品用途判斷該用哪種材質。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 260,
    body: [
      { type: "paragraph", text: "PP、PE、ABS、PC……塑膠材質的代號常常讓人一頭霧水。這篇文章從常見材質開始，說明怎麼依用途判斷該選哪一種。" },

      { type: "heading", text: "為什麼塑膠材質這麼多種，差異在哪？" },
      { type: "paragraph", text: "不同塑膠材質在硬度、耐熱性、透明度、耐衝擊性、成本上表現都不同，選錯材質可能導致產品容易破裂、變形，或成本過高。" },

      { type: "heading", text: "常見的塑膠材質有哪些？" },
      { type: "list", items: [
        "PP（聚丙烯）：耐化學性佳，常用於容器",
        "PE（聚乙烯）：柔軟耐衝擊，常用於袋子、瓶罐",
        "ABS：硬度與外觀質感佳，常用於外殼",
        "PC（聚碳酸酯）：透明度高、耐衝擊強，常用於燈罩與防護鏡片",
      ] },

      { type: "heading", text: "PP、PE、ABS、PC 這些代號是什麼意思？" },
      { type: "paragraph", text: "這些是塑膠材質的通用縮寫代號，來自材料的化學名稱，工廠與供應商之間會直接用這些代號溝通材質需求，是製造業的通用語言。" },

      { type: "heading", text: "怎麼判斷自己的產品該用哪種塑膠？" },
      { type: "list", items: [
        "需要透明 → PC 或 PET",
        "需要耐化學、會接觸食物 → PP",
        "需要柔軟有彈性 → PE",
        "需要外觀質感好、適合噴漆或電鍍 → ABS",
        "需要高強度結構件 → 可能需要工程塑膠或搭配玻纖強化",
      ] },

      { type: "heading", text: "塑膠材質會影響加工方式嗎？" },
      { type: "paragraph", text: "會。不同材質的熔點、流動性不同，會影響射出成型的參數設定，甚至決定能不能用同一套模具生產，選材質時建議跟工廠一起確認是否符合現有製程。", segments: [
        "會。不同材質的熔點、流動性不同，會影響射出成型的參數設定，甚至",
        { text: "決定能不能用同一套模具生產", emphasis: "secondary" },
        "，選材質時建議跟工廠一起確認是否符合現有製程。",
      ] },

      { type: "heading", text: "不確定該選哪種材質，該怎麼辦？" },
      { type: "paragraph", text: "可以直接告訴工廠產品用途、使用環境（例如是否接觸食物、戶外使用、需要耐衝擊），有經驗的工廠通常可以依需求建議合適的材質，不需要自己先精通所有材料知識。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["rubber-silicone-pu-comparison", "what-is-plastic-injection-molding"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認合適的材質後，直接到 OXM 依產業與地區篩選工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "rubber-silicone-pu-comparison",
    libraryId: "LIB-027",
    title: "橡膠、矽膠、PU 有什麼差別？",
    metaDescription: "橡膠、矽膠、PU 有什麼差別？這篇文章比較三種彈性材料的特性、常見應用產品，以及耐熱、耐候、耐磨表現的差異，幫你判斷該怎麼選。",
    h1: "橡膠、矽膠、PU 有什麼差別？",
    excerpt: "比較橡膠、矽膠、PU 三種彈性材料的特性、常見應用產品，幫你判斷該怎麼選。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 270,
    body: [
      { type: "paragraph", text: "橡膠、矽膠、PU 都是常見的彈性材料，經常被拿來比較，但特性跟適合的應用其實差很多。這篇文章用比較的方式整理清楚。" },

      { type: "heading", text: "橡膠、矽膠、PU 基本上是什麼材料？" },
      { type: "paragraph", text: "橡膠（Rubber）、矽膠（Silicone）、PU（聚氨酯）都是常見的彈性材料，但分子結構與特性不同，適合的應用情境也不一樣。" },

      { type: "heading", text: "這三種材料的特性主要差在哪？" },
      { type: "list", items: [
        "橡膠：彈性佳、成本較低，但耐候與耐高溫表現一般",
        "矽膠：耐高低溫、耐候性佳，食品與醫療應用多",
        "PU：耐磨耐衝擊性強，也可做成發泡材質，應用彈性大",
      ] },

      { type: "heading", text: "橡膠、矽膠、PU 分別常用在什麼產品？" },
      { type: "list", items: [
        "橡膠 → 密封圈、輪胎、一般工業零件",
        "矽膠 → 廚具、嬰兒用品、醫療配件、食品接觸產品",
        "PU → 鞋底、滾輪、緩衝泡棉、彈性零件",
      ] },

      { type: "heading", text: "耐熱性跟耐候性，哪一種比較好？" },
      { type: "paragraph", text: "矽膠耐熱耐候佳，但耐磨耐衝擊不如 PU，這也是矽膠常被用在食品與戶外產品的原因。", segments: [
        { text: "矽膠耐熱耐候佳，但耐磨耐衝擊不如 PU", emphasis: "primary" },
        "，這也是矽膠常被用在食品與戶外產品的原因。",
      ] },

      { type: "heading", text: "我該怎麼選？" },
      { type: "paragraph", text: "先確認使用情境：接觸高溫、食品或需要長期戶外使用選矽膠；需要耐磨、耐衝擊或彈性緩衝選 PU；一般工業密封或成本考量優先選橡膠，不確定時可以直接告訴工廠使用情境，讓工廠協助建議材料。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["food-grade-vs-medical-grade-silicone", "how-to-choose-plastic-materials"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認合適的彈性材料後，直接到 OXM 依產業與地區篩選工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "food-grade-vs-medical-grade-silicone",
    libraryId: "LIB-026",
    title: "食品級矽膠與醫療級矽膠差在哪？",
    metaDescription: "食品級矽膠與醫療級矽膠差在哪？這篇文章說明兩者的認證標準與應用差異，醫療級是不是一定比較安全，以及該怎麼選擇合適的矽膠等級。",
    h1: "食品級矽膠與醫療級矽膠差在哪？",
    excerpt: "說明食品級與醫療級矽膠的認證標準與應用差異，以及該怎麼選擇合適的等級。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 280,
    body: [
      { type: "paragraph", text: "「食品級」「醫療級」矽膠常被拿來當作品質保證的標語，但兩者其實是針對不同應用情境設計的認證標準。這篇文章說明差異在哪。" },

      { type: "heading", text: "食品級矽膠是什麼？" },
      { type: "paragraph", text: "食品級矽膠是通過食品接觸安全認證的矽膠材質，確保材料在接觸食物時不會釋出有害物質，常用於廚具、模具、餐具等產品。" },

      { type: "heading", text: "醫療級矽膠是什麼？" },
      { type: "paragraph", text: "醫療級矽膠是通過更嚴格生物相容性認證的矽膠材質，確保材料接觸人體（皮膚甚至體內）時的安全性，常用於醫療器材、植入物相關產品。" },

      { type: "heading", text: "食品級跟醫療級矽膠主要差在哪？" },
      { type: "paragraph", text: "主要差在認證標準與應用情境：醫療級矽膠需要通過生物相容性測試（例如接觸皮膚、黏膜甚至長期植入），檢驗項目比食品級更嚴格；食品級矽膠則聚焦在食品接觸安全，兩者的檢驗重點不同，不是單純的「等級高低」。", segments: [
        "主要差在認證標準與應用情境：醫療級矽膠需要通過生物相容性測試（例如接觸皮膚、黏膜甚至長期植入），檢驗項目比食品級更嚴格；食品級矽膠則聚焦在食品接觸安全，",
        { text: "兩者的檢驗重點不同，不是單純的「等級高低」", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "是不是醫療級一定比食品級更安全？" },
      { type: "paragraph", text: "不完全是。醫療級認證涵蓋的情境更嚴格，但不代表食品級「比較差」——醫療級不代表比較好，用不到的認證等級只是增加成本。", segments: [
        "不完全是。醫療級認證涵蓋的情境更嚴格，但不代表食品級「比較差」——",
        { text: "醫療級不代表比較好，用不到的認證等級只是增加成本", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "我該選哪一種？" },
      { type: "paragraph", text: "依產品實際用途決定：接觸食物、餐具、烘焙模具選食品級；接觸皮膚傷口、醫療器材、需要長期人體接觸選醫療級，選錯等級可能不符合法規要求，也可能白花錢買用不到的認證。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["rubber-silicone-pu-comparison", "what-is-sustainable-materials"],
    cta: {
      label: "前往 OXM 找矽膠製品廠",
      href: "/factories/food-medical-silicone",
      description: "直接到 OXM 查看可承接食品、醫療級矽膠製品需求的廠商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "stainless-steel-aluminum-iron-comparison",
    libraryId: "LIB-029",
    title: "不鏽鋼、鋁、鐵怎麼選？製造產品常見金屬材料比較",
    metaDescription: "不鏽鋼、鋁、鐵怎麼選？這篇文章比較三種常見金屬材料的特性、適合的產品類型，以及重量與成本考量，幫你判斷自己的產品該選哪一種金屬。",
    h1: "不鏽鋼、鋁、鐵怎麼選？製造產品常見金屬材料比較",
    excerpt: "比較不鏽鋼、鋁、鐵三種常見金屬材料的特性與適合的產品類型。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 290,
    body: [
      { type: "paragraph", text: "不鏽鋼、鋁、鐵是製造業最常見的三種金屬材料，各自的特性差異很大。這篇文章幫你快速判斷自己的產品該選哪一種。" },

      { type: "heading", text: "不鏽鋼、鋁、鐵基本特性差在哪？" },
      { type: "paragraph", text: "不鏽鋼耐蝕性最好但較重、成本較高；鋁材質輕、加工容易，耐蝕性也不錯，但強度通常低於鋼鐵；鐵（碳鋼）強度高、成本低，但容易生鏽，通常需要額外表面處理。" },

      { type: "heading", text: "這三種金屬材料分別適合什麼產品？" },
      { type: "list", items: [
        "不鏽鋼 → 廚具、醫療器材、需要防鏽防蝕的產品",
        "鋁 → 需要輕量化的產品（3C 外殼、運動器材、車架）",
        "鐵／碳鋼 → 需要高強度結構、成本考量優先的產品（通常搭配烤漆或電鍍防鏽）",
      ] },

      { type: "heading", text: "重量是選材料時要考慮的重點嗎？" },
      { type: "paragraph", text: "如果產品需要輕量化，鋁通常是優先考慮的材料；如果重量不是重點、更看重強度或成本，鋼鐵材料會更合適。", segments: [
        { text: "如果產品需要輕量化，鋁通常是優先考慮的材料", emphasis: "primary" },
        "；如果重量不是重點、更看重強度或成本，鋼鐵材料會更合適。",
      ] },

      { type: "heading", text: "成本差異大嗎？" },
      { type: "paragraph", text: "一般來說鐵（碳鋼）成本最低，鋁材居中，不鏽鋼因為耐蝕性佳、加工難度較高，成本通常最高；實際價差也會受市場行情與加工方式影響。" },

      { type: "heading", text: "怎麼判斷自己的產品該選哪一種金屬？" },
      { type: "paragraph", text: "先問自己：需不需要防鏽防蝕？重量重不重要？預算上限是多少？依這三個問題大致就能篩出合適的金屬類型，細節可以再跟工廠確認。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["stainless-steel-304-vs-316", "what-is-cnc-machining"],
    cta: {
      label: "前往 OXM 找金屬材料供應商",
      href: "/factories/metal-materials",
      description: "直接到 OXM 查看不鏽鋼、鋁材與其他金屬原料供應商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "stainless-steel-304-vs-316",
    libraryId: "LIB-030",
    title: "304 與 316 不鏽鋼差在哪？",
    metaDescription: "304 與 316 不鏽鋼差在哪？這篇文章說明兩者的耐蝕能力與成本差異，以及該選 304 還是 316，避免選超過需求的材質等級。",
    h1: "304 與 316 不鏽鋼差在哪？",
    excerpt: "說明 304 與 316 不鏽鋼的耐蝕能力與成本差異，以及該怎麼選擇。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 300,
    body: [
      { type: "paragraph", text: "304 跟 316 是最常被拿來比較的兩種不鏽鋼材質，很多人不確定該選哪一種。這篇文章說明兩者的差異與選擇原則。" },

      { type: "heading", text: "304 不鏽鋼是什麼？" },
      { type: "paragraph", text: "304 是最常見的不鏽鋼材質，具備良好的耐蝕性與加工性，廣泛用於一般家電、廚具、五金製品。" },

      { type: "heading", text: "316 不鏽鋼是什麼？" },
      { type: "paragraph", text: "316 不鏽鋼額外添加了鉬（Molybdenum），耐蝕性比 304 更好，特別是抗氯離子腐蝕的能力更強，常用於海邊環境、醫療器材、化學相關設備。" },

      { type: "heading", text: "304 跟 316 主要差在哪？" },
      { type: "paragraph", text: "316 因為添加鉬，耐蝕性優於 304，但價格也更高。", segments: [
        { text: "316 因為添加鉬，耐蝕性優於 304，但價格也更高", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "我該選 304 還是 316？" },
      { type: "paragraph", text: "一般室內使用、日常五金產品，304 通常已經足夠；如果產品會長期接觸海水、鹽份環境，或用於醫療、化學相關設備，才需要考慮成本較高的 316，選超過需求的不鏽鋼等級，只是增加不必要的成本。", segments: [
        "一般室內使用、日常五金產品，304 通常已經足夠；如果產品會長期接觸海水、鹽份環境，或用於醫療、化學相關設備，才需要考慮成本較高的 316，",
        { text: "選超過需求的不鏽鋼等級，只是增加不必要的成本", emphasis: "secondary" },
        "。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["stainless-steel-aluminum-iron-comparison", "what-is-cnc-machining"],
    cta: {
      label: "前往 OXM 找金屬材料供應商",
      href: "/factories/metal-materials",
      description: "直接到 OXM 查看不鏽鋼與其他金屬原料供應商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "what-is-sustainable-materials",
    libraryId: "LIB-031",
    title: "永續材料是什麼？製造業常見永續材料一次認識",
    metaDescription: "永續材料是什麼？這篇文章介紹製造業常見的永續材料類型、是不是一定比較貴，以及用了永續材料能不能直接宣稱「環保」。",
    h1: "永續材料是什麼？製造業常見永續材料一次認識",
    excerpt: "介紹製造業常見的永續材料類型，以及使用永續材料時該注意的事項。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 310,
    body: [
      { type: "paragraph", text: "永續材料是近年製造業越來越常被提到的關鍵字，但實際涵蓋的材料類型很多，容易讓人搞不清楚。這篇文章先建立整體概念。" },

      { type: "heading", text: "永續材料是什麼？" },
      { type: "paragraph", text: "永續材料泛指在生產、使用或廢棄階段，對環境衝擊相對較小的材料，可能來自可再生資源、回收料源，或具備可分解／可堆肥特性。" },

      { type: "heading", text: "為什麼越來越多品牌開始使用永續材料？" },
      { type: "paragraph", text: "除了環保理念，也跟法規趨勢、消費者偏好、部分市場的進口／銷售要求有關，選用永續材料逐漸從「加分項」變成部分產業的「基本要求」。" },

      { type: "heading", text: "製造業常見的永續材料有哪些類型？" },
      { type: "list", items: [
        "生質塑膠（以植物等可再生原料製成）",
        "再生材料（PCR／PIR，回收料製成）",
        "生物可分解／可堆肥材料（在特定條件下可分解）",
        "天然纖維與生質複合材料（植物纖維為基礎的材料）",
      ] },

      { type: "heading", text: "永續材料一定比較貴嗎？" },
      { type: "paragraph", text: "不一定，但目前多數永續材料因為原料來源、加工技術或產量規模的限制，成本通常會比傳統材料高一些，實際差異依材料類型與供應商而不同。" },

      { type: "heading", text: "用了永續材料，產品就可以宣稱「環保」嗎？" },
      { type: "paragraph", text: "不一定。永續材料的定義與驗證方式很多，宣稱環保前建議先確認材料是否有實際的認證，避免「漂綠」爭議。", segments: [
        "不一定。永續材料的定義與驗證方式很多，",
        { text: "宣稱環保前建議先確認材料是否有實際的認證，避免「漂綠」爭議", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "想開始導入永續材料，該怎麼開始？" },
      { type: "paragraph", text: "建議先確認自己的核心訴求（例如減塑、可分解、使用回收料），再依訴求去找對應材料類型的供應商，不需要一次把所有永續材料類型都用上。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-bioplastics", "what-is-recycled-materials"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認核心訴求後，直接到 OXM 依產業與地區篩選供應商，比較合適的合作對象。",
    },
  },
  {
    slug: "what-is-bioplastics",
    libraryId: "LIB-032",
    title: "生質塑膠是什麼？跟一般塑膠有什麼不同？",
    metaDescription: "生質塑膠是什麼？這篇文章說明生質塑膠的原料來源、是不是一定會分解、跟一般石化塑膠的差異，以及使用生質塑膠時要注意什麼。",
    h1: "生質塑膠是什麼？跟一般塑膠有什麼不同？",
    excerpt: "說明生質塑膠的原料來源、跟一般石化塑膠的差異，以及使用時要注意的事項。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 320,
    body: [
      { type: "paragraph", text: "生質塑膠常被誤認為「一定會分解的環保塑膠」，但實際定義沒有那麼單純。這篇文章說明生質塑膠真正的意思。" },

      { type: "heading", text: "生質塑膠是什麼？" },
      { type: "paragraph", text: "生質塑膠（Bioplastics）是原料來自可再生植物資源（例如玉米澱粉、甘蔗）製成的塑膠，取代部分或全部傳統石化原料。" },

      { type: "heading", text: "生質塑膠一定會分解嗎？" },
      { type: "paragraph", text: "不一定。「生質」是原料來源，「可分解」是材料特性，兩者不是同一件事——有些生質塑膠可以分解，也有些生質塑膠的化學結構跟一般塑膠一樣穩定、不會分解。", segments: [
        "不一定。",
        { text: "「生質」是原料來源，「可分解」是材料特性，兩者不是同一件事", emphasis: "primary" },
        "——有些生質塑膠可以分解，也有些生質塑膠的化學結構跟一般塑膠一樣穩定、不會分解。",
      ] },

      { type: "heading", text: "生質塑膠跟一般石化塑膠主要差在哪？" },
      { type: "paragraph", text: "生質塑膠的原料是可再生植物資源，一般石化塑膠的原料是石油；在加工特性上，兩者不一定完全相同，實際的耐熱性、強度、可加工性依材料種類而異，需要跟供應商確認規格。" },

      { type: "heading", text: "生質塑膠可以取代所有塑膠應用嗎？" },
      { type: "paragraph", text: "不行，目前生質塑膠在成本、加工特性、供應穩定度上跟主流石化塑膠仍有差距，多數應用在特定產品類型（例如一次性餐具、包裝），不是所有塑膠應用都能直接替換。" },

      { type: "heading", text: "使用生質塑膠時要注意什麼？" },
      { type: "paragraph", text: "使用前建議先確認材料的加工參數是否適用於既有模具與設備、是否有相關的環保認證或標章，以及成本是否在可接受範圍內。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-sustainable-materials", "biodegradable-vs-compostable"],
    cta: {
      label: "前往 OXM 找生質塑膠供應商",
      href: "/factories/bioplastics",
      description: "直接到 OXM 查看可供應生質塑膠材料的廠商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "what-is-recycled-materials",
    libraryId: "LIB-033",
    title: "再生材料是什麼？PCR、PIR 差在哪？",
    metaDescription: "再生材料是什麼？這篇文章說明 PCR、PIR 的定義與差異，以及使用再生材料時需要注意的重點，幫你判斷該怎麼跟供應商溝通需求。",
    h1: "再生材料是什麼？PCR、PIR 差在哪？",
    excerpt: "說明 PCR、PIR 的定義與差異，以及使用再生材料時需要注意的重點。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 330,
    body: [
      { type: "paragraph", text: "PCR、PIR 是討論再生材料時很常出現的縮寫，但兩者的來源其實不一樣。這篇文章說明再生材料與這兩個名詞的意思。" },

      { type: "heading", text: "再生材料是什麼？" },
      { type: "paragraph", text: "再生材料是把回收的廢棄材料，經過處理後重新製成可用原料，用於生產新產品，減少對新原生材料的需求。" },

      { type: "heading", text: "PCR 是什麼？" },
      { type: "paragraph", text: "PCR（Post-Consumer Recycled，消費後回收料）是來自已經被消費者使用過、回收再處理的材料，例如回收寶特瓶做成的再生塑膠。" },

      { type: "heading", text: "PIR 是什麼？" },
      { type: "paragraph", text: "PIR（Post-Industrial Recycled，工業回收料）通常是指製造過程中產生、原本會進入廢棄物流的邊角料、不良品或剩餘材料，經過回收再處理後重新利用，還沒有被最終消費者使用過。", segments: [
        "PIR（Post-Industrial Recycled，工業回收料）通常是指製造過程中產生、原本會進入廢棄物流的邊角料、不良品或剩餘材料，經過回收再處理後重新利用，",
        { text: "還沒有被最終消費者使用過", emphasis: "primary" },
        "。",
      ] },
      { type: "paragraph", text: "但如果只是同一製程內直接回收、再投入使用的邊料（例如射出成型的水口料重新加入同一台機器），通常不算國際標準 ISO 14021 所定義的 pre-consumer recycled material——差別在於，這類邊料可以在產生它的同一製程中直接回用，因此不屬於 ISO 14021 所定義的 pre-consumer recycled material 範圍。", segments: [
        "但如果只是同一製程內直接回收、再投入使用的邊料（例如射出成型的水口料重新加入同一台機器），通常不算國際標準 ISO 14021 所定義的 pre-consumer recycled material——",
        { text: "差別在於，這類邊料可以在產生它的同一製程中直接回用，因此不屬於 ISO 14021 所定義的 pre-consumer recycled material 範圍", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "PCR 跟 PIR 主要差在哪？" },
      { type: "paragraph", text: "主要差在來源階段：PCR 來自消費端回收，通常更能對應「減少消費廢棄物」的訴求；PIR 來自生產端回收，來源相對穩定、品質波動較小，但對外宣稱環保效益時，市場認知上 PCR 通常更受重視。", segments: [
        "主要差在來源階段：PCR 來自消費端回收，通常更能對應「減少消費廢棄物」的訴求；PIR 來自生產端回收，來源相對穩定、品質波動較小，但對外宣稱環保效益時，",
        { text: "市場認知上 PCR 通常更受重視", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "使用再生材料需要注意什麼？" },
      { type: "paragraph", text: "再生材料的品質穩定度可能受回收料源影響，建議先跟供應商確認再生料的比例（例如 30% PCR、100% PCR）、加工特性是否符合你的產品需求，並確認是否有第三方驗證。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-sustainable-materials", "what-is-bioplastics"],
    cta: {
      label: "前往 OXM 找再生材料供應商",
      href: "/factories/recycled-materials",
      description: "直接到 OXM 查看可供應再生材料的廠商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "biodegradable-vs-compostable",
    libraryId: "LIB-034",
    title: "可分解、可生物分解、可堆肥材料差在哪？",
    metaDescription: "可分解、可生物分解、可堆肥材料差在哪？這篇文章釐清幾個容易混用的環保材料名詞，以及選材料時該怎麼判斷自己真正需要的是哪一種。",
    h1: "可分解、可生物分解、可堆肥材料差在哪？",
    excerpt: "釐清可分解、可生物分解、可堆肥幾個容易混用的環保材料名詞。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 340,
    body: [
      { type: "paragraph", text: "「可分解」「可生物分解」「可堆肥」這幾個詞經常被交替使用，但實際的認證標準差很多。這篇文章把它們釐清楚。" },

      { type: "heading", text: "這幾個名詞是不是都在講同一件事？" },
      { type: "paragraph", text: "不是，這些名詞聽起來相似，但代表的條件跟時間標準不一樣，常常被廠商或消費者混用，容易造成誤解。", segments: [
        "不是，",
        { text: "這些名詞聽起來相似，但代表的條件跟時間標準不一樣", emphasis: "primary" },
        "，常常被廠商或消費者混用，容易造成誤解。",
      ] },

      { type: "heading", text: "可生物分解（Biodegradable）是什麼意思？" },
      { type: "paragraph", text: "可生物分解是指材料可以被微生物分解成自然物質，但沒有規定分解的時間長短與所需環境條件——理論上很多材料「最終」都會分解，只是時間可能非常長。" },

      { type: "heading", text: "可堆肥（Compostable）是什麼意思？" },
      { type: "paragraph", text: "可堆肥是更明確的標準，通常需要通過特定認證（例如在工業堆肥環境下，一定時間內分解到一定比例），比「可生物分解」的定義更嚴格、更具體。", segments: [
        "可堆肥是更明確的標準，通常需要通過特定認證（例如在工業堆肥環境下，一定時間內分解到一定比例），",
        { text: "比「可生物分解」的定義更嚴格、更具體", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "兩者最大的差別是什麼？" },
      { type: "paragraph", text: "「可堆肥」通常有明確的認證與時間標準，「可生物分解」則相對模糊，沒有標準時間，這也是為什麼可堆肥材料的環保宣稱通常更有公信力。" },

      { type: "heading", text: "選材料時該怎麼判斷自己真正需要的是哪一種？" },
      { type: "paragraph", text: "如果要對外做明確的環保宣稱，建議選擇有實際認證的可堆肥材料；如果只是希望材料「終究會分解」、沒有特定認證需求，可生物分解材料可能就足夠，重點是先確認自己要宣稱的內容跟材料實際特性是否相符。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-sustainable-materials", "what-is-bioplastics"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認材料標準與宣稱需求後，直接到 OXM 依產業與地區篩選供應商，比較合適的合作對象。",
    },
  },
  {
    slug: "natural-fiber-and-biocomposite-materials",
    libraryId: "LIB-035",
    title: "天然纖維與生質複合材料是什麼？",
    metaDescription: "天然纖維與生質複合材料是什麼？這篇文章說明兩者的定義與關係、常見應用產品，以及選用這類材料時需要注意的事項。",
    h1: "天然纖維與生質複合材料是什麼？",
    excerpt: "說明天然纖維與生質複合材料的定義與關係，以及常見應用產品。",
    category: "材料知識",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 350,
    body: [
      { type: "paragraph", text: "天然纖維與生質複合材料是永續材料裡比較新的類型，這篇文章說明兩者是什麼、彼此的關係，以及使用時要注意的事項。" },

      { type: "heading", text: "天然纖維材料是什麼？" },
      { type: "paragraph", text: "天然纖維材料是以植物纖維（例如麻、竹纖維、甘蔗渣）為主要原料製成的材料，通常用於取代部分塑膠或合成纖維。" },

      { type: "heading", text: "生質複合材料是什麼？" },
      { type: "paragraph", text: "生質複合材料是把天然纖維或其他生質原料，與樹脂等材料結合製成的複合材料，兼具植物原料的永續特性與複合材料的結構強度。" },

      { type: "heading", text: "天然纖維跟生質複合材料是同一種東西嗎？" },
      { type: "paragraph", text: "不完全是。天然纖維是原料本身，生質複合材料是結合後製成的成品材料，生質複合材料通常會用到天然纖維，但天然纖維不一定要做成複合材料才能使用。", segments: [
        "不完全是。",
        { text: "天然纖維是原料本身，生質複合材料是結合後製成的成品材料", emphasis: "primary" },
        "，生質複合材料通常會用到天然纖維，但天然纖維不一定要做成複合材料才能使用。",
      ] },

      { type: "heading", text: "這類材料通常應用在什麼產品？" },
      { type: "paragraph", text: "常見應用包括包裝材料、一次性餐具、部分家具與建材、需要輕量兼具環保訴求的零件與外殼。" },

      { type: "heading", text: "選用這類材料時要注意什麼？" },
      { type: "paragraph", text: "這類材料的機械強度、耐濕性通常不如傳統塑膠或複合材料，需要確認是否符合產品的使用環境與耐用需求，建議先跟供應商確認材料規格與實際測試數據。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-sustainable-materials", "what-is-bioplastics"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認材料需求後，直接到 OXM 依產業與地區篩選供應商，比較合適的合作對象。",
    },
  },
  // ===== Level 5：包裝／印刷與品牌製造（Batch D 之一：36～40）=====
  {
    slug: "how-to-find-packaging-manufacturer",
    libraryId: "LIB-036",
    title: "包裝代工怎麼找？從包材、印刷到成品包裝",
    metaDescription: "包裝代工怎麼找？這篇文章說明包裝代工的範圍、包材跟印刷是不是同一家工廠處理、找包裝代工廠該先確認什麼，以及第一次找包裝代工廠要準備什麼。",
    h1: "包裝代工怎麼找？從包材、印刷到成品包裝",
    excerpt: "說明包裝代工的範圍，以及找包裝代工廠時該確認的重點與準備的資料。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 360,
    body: [
      { type: "paragraph", text: "產品做好了，接下來常常卡在包裝——不確定該找誰、範圍包含什麼。這篇文章整理包裝代工的基本知識。" },

      { type: "heading", text: "包裝代工大概包含哪些範圍？" },
      { type: "paragraph", text: "包裝代工涵蓋範圍很廣，可能包括包材本身（紙盒、塑膠容器、軟包裝）、包裝印刷（外觀設計印刷），以及最終的包裝組裝或填充。" },

      { type: "heading", text: "包材跟包裝印刷是同一家工廠處理嗎？" },
      { type: "paragraph", text: "不一定，有些工廠專精包材製造，有些專精印刷，也有工廠可以一站式處理包材加印刷，實務上可能需要跟不同專長的廠商合作。", segments: [
        "不一定，有些工廠專精包材製造，有些專精印刷，也有工廠可以一站式處理包材加印刷，",
        { text: "實務上可能需要跟不同專長的廠商合作", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "找包裝代工廠時該先確認什麼？" },
      { type: "list", items: [
        "包材材質是否符合產品需求（防潮／緩衝／環保）",
        "印刷方式是否能達到你要的外觀效果",
        "數量是否符合工廠的生產模式",
        "交期（包裝常是產品上市前最後一關，容易卡關）",
      ] },

      { type: "heading", text: "包裝的 MOQ 通常怎麼算？" },
      { type: "paragraph", text: "包裝 MOQ 受印刷方式（例如版費）、包材種類、客製化程度影響，客製化程度越高、印刷方式越特殊，MOQ 通常越高。" },

      { type: "heading", text: "第一次找包裝代工廠要準備什麼？" },
      { type: "paragraph", text: "產品尺寸與重量、包裝形式（紙盒／袋子／瓶罐等）、印刷需求（顏色數／是否需要特殊工藝）、預估數量、預算與時程。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["paper-box-bag-soft-packaging-comparison", "packaging-printing-methods"],
    cta: {
      label: "前往 OXM 找包裝代工廠",
      href: "/search",
      description: "整理好包裝需求後，直接到 OXM 依產業與地區篩選包裝代工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "paper-box-bag-soft-packaging-comparison",
    libraryId: "LIB-037",
    title: "紙盒、紙袋、軟包裝怎麼選？",
    metaDescription: "紙盒、紙袋、軟包裝怎麼選？這篇文章比較三種常見包裝形式的結構與防護性差異、分別適合什麼產品，幫你判斷自己的產品該用哪一種包裝。",
    h1: "紙盒、紙袋、軟包裝怎麼選？",
    excerpt: "比較紙盒、紙袋、軟包裝三種常見包裝形式的差異，以及分別適合的產品類型。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 370,
    body: [
      { type: "paragraph", text: "紙盒、紙袋、軟包裝是最常見的三種包裝形式，選錯形式可能影響產品的保護效果與展示效果。這篇文章說明怎麼選。" },

      { type: "heading", text: "紙盒、紙袋、軟包裝基本上有什麼不同？" },
      { type: "paragraph", text: "三者主要差在材質結構與保護性：紙盒是硬挺的紙板結構，紙袋是可攜帶的軟性紙容器，軟包裝則是塑膠或複合材質的軟性密封包裝，各自的防護力與外觀效果不同。" },

      { type: "heading", text: "紙盒適合什麼產品？" },
      { type: "paragraph", text: "紙盒適合需要挺立展示效果、有一定防護需求的產品，例如禮盒、3C 產品外盒、化妝品外包裝。" },

      { type: "heading", text: "紙袋適合什麼產品？" },
      { type: "paragraph", text: "紙袋適合輕量、需要方便攜帶的產品，例如手提袋、精品袋，防護力通常較弱，較少用於需要防潮密封的產品。" },

      { type: "heading", text: "軟包裝適合什麼產品？" },
      { type: "paragraph", text: "軟包裝適合需要密封防潮、延長保存期限的產品，例如食品、日用品填充包，也常見於需要輕量化運輸的產品。", segments: [
        { text: "軟包裝適合需要密封防潮、延長保存期限的產品", emphasis: "primary" },
        "，例如食品、日用品填充包，也常見於需要輕量化運輸的產品。",
      ] },

      { type: "heading", text: "怎麼決定自己的產品該用哪一種包裝？" },
      { type: "paragraph", text: "先問自己：需不需要密封防潮？需不需要挺立展示效果？運輸與攜帶需求是什麼？依這幾個問題大致能篩出方向，細節可以再跟包裝廠討論。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["how-to-find-packaging-manufacturer", "packaging-printing-methods"],
    cta: {
      label: "前往 OXM 找包裝廠商",
      href: "/search",
      description: "確認合適的包裝形式後，直接到 OXM 依產業與地區篩選包裝廠商，比較合適的合作對象。",
    },
  },
  {
    slug: "packaging-printing-methods",
    libraryId: "LIB-038",
    title: "包裝印刷有哪些方式？適合不同產品的印刷怎麼選？",
    metaDescription: "包裝印刷有哪些方式？這篇文章說明平版、數位、網版三種印刷方式的差異與適合情境，以及印刷方式會不會影響成本，幫你選擇合適的印刷方式。",
    h1: "包裝印刷有哪些方式？適合不同產品的印刷怎麼選？",
    excerpt: "說明平版、數位、網版三種印刷方式的差異與適合情境，幫你選擇合適的印刷方式。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 380,
    body: [
      { type: "paragraph", text: "包裝印刷不只一種做法，選錯印刷方式可能讓小量訂單成本過高，或讓大量訂單划不來。這篇文章整理常見的印刷方式與選擇原則。" },

      { type: "heading", text: "包裝印刷主要有哪些方式？" },
      { type: "paragraph", text: "常見的包裝印刷方式包括平版印刷、數位印刷、網版印刷，各自在成本結構、印刷品質、適合數量上不同。" },

      { type: "heading", text: "平版印刷適合什麼情境？" },
      { type: "paragraph", text: "平版印刷適合大量印製、色彩要求精準的包裝，因為需要製版，前期成本較高，但大量印製時單價會壓得很低。" },

      { type: "heading", text: "數位印刷適合什麼情境？" },
      { type: "paragraph", text: "數位印刷不需要製版，適合小量、多款式、需要快速打樣或版本較常更換的包裝，前期成本低，但單價通常高於平版印刷。", segments: [
        "數位印刷不需要製版，",
        { text: "適合小量、多款式、需要快速打樣或版本較常更換的包裝", emphasis: "primary" },
        "，前期成本低，但單價通常高於平版印刷。",
      ] },

      { type: "heading", text: "網版印刷適合什麼情境？" },
      { type: "paragraph", text: "網版印刷適合特殊材質（例如塑膠、金屬、不規則表面）或需要較厚油墨的印刷需求；燙金、UV 局部上光等特殊效果則多半是另外搭配的加工製程，不少印刷廠會一併提供。" },

      { type: "heading", text: "印刷方式會影響成本嗎？" },
      { type: "paragraph", text: "會。平版印刷因為要製版，數量越大單價越划算；數位印刷沒有版費，適合小量但單價較高；選錯印刷方式可能讓小量訂單成本過高，或讓大量訂單版費分攤不划算。", segments: [
        "會。平版印刷因為要製版，數量越大單價越划算；數位印刷沒有版費，適合小量但單價較高；",
        { text: "選錯印刷方式可能讓小量訂單成本過高，或讓大量訂單版費分攤不划算", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "我該怎麼選擇印刷方式？" },
      { type: "paragraph", text: "先確認你的數量規模跟是否需要頻繁換版：大量固定設計選平版；小量多樣或版本常變動選數位；特殊材質或效果選網版，不確定時可以直接詢問印刷廠的建議。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["how-to-find-packaging-manufacturer", "sticker-label-printing-guide"],
    cta: {
      label: "前往 OXM 找包裝印刷廠",
      href: "/factories/packaging-print",
      description: "直接到 OXM 查看可承接彩盒印刷與包裝印刷代工需求的工廠，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "business-card-dm-catalog-printing",
    libraryId: "LIB-039",
    title: "名片、DM、型錄印刷怎麼選？",
    metaDescription: "名片、DM、型錄印刷怎麼選？這篇文章說明這類商業印刷需要注意的重點，以及印刷估價通常怎麼算，幫你準備清楚的規格拿到準確報價。",
    h1: "名片、DM、型錄印刷怎麼選？",
    excerpt: "說明名片、DM、型錄印刷需要注意的重點，以及印刷估價通常怎麼算。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 390,
    body: [
      { type: "paragraph", text: "名片、DM、型錄是最常見的商業印刷品，這篇文章整理這幾種印刷品各自要注意的重點。" },

      { type: "heading", text: "名片、DM、型錄印刷屬於同一類印刷需求嗎？" },
      { type: "paragraph", text: "是的，名片、DM、型錄都屬於一般平面商業印刷，通常由同一類印刷廠承接，跟包裝印刷、大圖輸出是不同的印刷服務範疇。" },

      { type: "heading", text: "名片印刷要注意什麼？" },
      { type: "paragraph", text: "名片印刷除了紙張材質與磅數，也要考慮是否需要特殊加工（例如燙金、局部上光），數量通常較小，適合用數位印刷快速印製。" },

      { type: "heading", text: "DM 印刷要注意什麼？" },
      { type: "paragraph", text: "DM（宣傳單）通常印量較大、用於單次活動或推廣，重點在成本控制與印刷效率，紙張選擇也會影響郵寄或發放時的耐用度。" },

      { type: "heading", text: "型錄印刷要注意什麼？" },
      { type: "paragraph", text: "型錄頁數較多，需要考慮裝訂方式（騎馬釘、膠裝等）、頁數是否為印刷倍數（通常需要 4 的倍數），印前製作與校對流程也比單張印刷品複雜。", segments: [
        "型錄頁數較多，需要考慮裝訂方式（騎馬釘、膠裝等）、",
        { text: "頁數是否為印刷倍數（通常需要 4 的倍數）", emphasis: "primary" },
        "，印前製作與校對流程也比單張印刷品複雜。",
      ] },

      { type: "heading", text: "這類印刷通常怎麼估價？" },
      { type: "paragraph", text: "主要依印刷方式（平版／數位）、紙張材質、數量、頁數（型錄）、後加工需求（燙金、裝訂等）估價，數量越大通常單價越低，建議提供清楚規格才能拿到準確報價。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["packaging-printing-methods", "sticker-label-printing-guide"],
    cta: {
      label: "前往 OXM 找印刷廠",
      href: "/factories/general-printing",
      description: "直接到 OXM 查看可承接名片、DM、型錄印刷需求的廠商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "sticker-label-printing-guide",
    libraryId: "LIB-040",
    title: "貼紙與標籤印刷怎麼選？材質、印刷方式與使用環境",
    metaDescription: "貼紙與標籤印刷怎麼選？這篇文章說明常見貼紙材質、材質怎麼依使用環境挑選、印刷方式怎麼選，以及第一次做貼紙標籤要準備什麼。",
    h1: "貼紙與標籤印刷怎麼選？材質、印刷方式與使用環境",
    excerpt: "說明常見貼紙材質、材質怎麼依使用環境挑選，以及第一次做貼紙標籤要準備什麼。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 400,
    body: [
      { type: "paragraph", text: "貼紙跟標籤幾乎是每個產品都會用到的印刷品，但材質跟印刷方式選錯，可能影響耐用度或增加不必要的成本。這篇文章整理選擇重點。" },

      { type: "heading", text: "貼紙跟標籤是同一種東西嗎？" },
      { type: "paragraph", text: "廣義上兩者常被交替使用，但標籤通常特指需要黏貼在產品上提供資訊（例如成分、條碼）的貼紙，貼紙的用途更廣，也包括裝飾、品牌識別用途。" },

      { type: "heading", text: "常見的貼紙／標籤材質有哪些？" },
      { type: "list", items: ["銅版紙（成本低、適合一般室內用途）", "合成紙／PP 貼（防水耐用）", "霧面／亮面材質（影響外觀質感）", "特殊材質（如透明貼、金屬感貼紙）"] },

      { type: "heading", text: "材質怎麼選跟使用環境有關嗎？" },
      { type: "paragraph", text: "有關。會接觸水分、戶外環境或需要耐刮的產品，建議選防水耐用的合成材質；室內短期使用的產品，銅版紙材質通常已經足夠，選超過需求的貼紙材質，只是增加不必要的成本。", segments: [
        "有關。會接觸水分、戶外環境或需要耐刮的產品，建議選防水耐用的合成材質；室內短期使用的產品，銅版紙材質通常已經足夠，",
        { text: "選超過需求的貼紙材質，只是增加不必要的成本", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "貼紙印刷方式怎麼選？" },
      { type: "paragraph", text: "大量、色彩要求精準選平版印刷；小量、多款式或需要快速打樣選數位印刷，這跟其他包裝印刷的選擇邏輯一致。" },

      { type: "heading", text: "貼紙的 MOQ 通常怎麼算？" },
      { type: "paragraph", text: "貼紙 MOQ 通常跟印刷方式（是否需要製版）、材質、尺寸有關，數位印刷通常可以接受較小的量，平版印刷因為有版費，MOQ 通常較高。" },

      { type: "heading", text: "第一次做貼紙標籤要準備什麼？" },
      { type: "paragraph", text: "貼紙尺寸、材質需求、使用環境（是否需要防水耐刮）、印刷內容（設計檔或需要代為設計）、數量、是否需要特殊形狀（需要另外開刀模）。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["packaging-printing-methods", "business-card-dm-catalog-printing"],
    cta: {
      label: "前往 OXM 找貼紙標籤印刷廠",
      href: "/factories/sticker-label",
      description: "直接到 OXM 查看可承接貼紙、標籤印刷需求的廠商，依地區篩選並直接詢價。",
    },
  },
  // ===== Level 6：設備與工廠營運知識（Batch D 之二：41～45）=====
  {
    slug: "what-is-production-line-automation",
    libraryId: "LIB-041",
    title: "自動化產線是什麼？什麼時候值得導入？",
    metaDescription: "自動化產線是什麼？這篇文章說明自動化是不是等於全自動、什麼情況下工廠會考慮導入自動化，以及自動化產線是不是一定比人工便宜。",
    h1: "自動化產線是什麼？什麼時候值得導入？",
    excerpt: "說明自動化產線的基本概念、什麼情況下工廠會考慮導入，以及成本考量。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 410,
    body: [
      { type: "paragraph", text: "「自動化」常被想像成完全沒有人力參與的產線，但實際情況通常更彈性。這篇文章說明自動化產線的基本概念。" },

      { type: "heading", text: "自動化產線是什麼？" },
      { type: "paragraph", text: "自動化產線是用機械設備、感測器與控制系統，取代部分或全部原本由人工執行的生產流程，目的是提升效率、穩定品質、降低重複性人力需求。" },

      { type: "heading", text: "自動化一定代表全自動、不需要人力嗎？" },
      { type: "paragraph", text: "不一定。實務上很多產線是「半自動化」，部分工序自動化、部分仍需要人工操作或檢查，全自動產線通常需要產品設計高度標準化、產量夠大才划算。", segments: [
        "不一定。實務上很多產線是「半自動化」，部分工序自動化、部分仍需要人工操作或檢查，",
        { text: "全自動產線通常需要產品設計高度標準化、產量夠大才划算", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "什麼情況下工廠會考慮導入自動化？" },
      { type: "paragraph", text: "常見情況包括：產量大到人工成本壓力明顯、重複性高且容易出錯的工序、需要提升品質穩定度、或人力招募困難的產業。" },

      { type: "heading", text: "自動化產線一定比人工便宜嗎？" },
      { type: "paragraph", text: "不一定。自動化設備前期投入高，只有在產量夠大、能分攤設備成本時才會比人工便宜；小量、多樣化的生產，人工反而更有彈性、成本更低。", segments: [
        "不一定。自動化設備前期投入高，",
        { text: "只有在產量夠大、能分攤設備成本時才會比人工便宜；小量、多樣化的生產，人工反而更有彈性、成本更低", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "買方需要自己懂自動化設備嗎？" },
      { type: "paragraph", text: "不需要。你只需要清楚描述你的產品與訂單規模，工廠會依自身設備狀況告訴你能不能配合，以及自動化程度會不會影響交期或報價，不需要自己精通設備技術。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["factory-inspection-equipment-and-quality-control", "jig-fixture-mold-comparison"],
    cta: {
      label: "前往 OXM 找自動化設備廠商",
      href: "/factories/automation-production-line-equipment",
      description: "直接到 OXM 查看可供應產線設備與自動化整合方案的廠商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "factory-inspection-equipment-and-quality-control",
    libraryId: "LIB-042",
    title: "工廠常見檢測設備有哪些？品管為什麼需要量測？",
    metaDescription: "工廠常見檢測設備有哪些？這篇文章說明為什麼品管需要量測設備、常見檢測設備分別檢查什麼，以及品管檢測會不會影響交期或成本。",
    h1: "工廠常見檢測設備有哪些？品管為什麼需要量測？",
    excerpt: "說明工廠常見的檢測設備、各自檢查什麼，以及品管檢測對交期與成本的影響。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 420,
    body: [
      { type: "paragraph", text: "工廠品管不是只靠肉眼檢查，還需要各種量測設備輔助。這篇文章說明常見的檢測設備，以及為什麼量測對品管這麼重要。" },

      { type: "heading", text: "為什麼工廠需要檢測設備，光靠肉眼判斷不行嗎？" },
      { type: "paragraph", text: "肉眼可以看出明顯的外觀瑕疵，但尺寸公差、內部結構、材質成分這類問題，肉眼無法準確判斷，需要靠量測設備才能確認產品是否真的符合規格。", segments: [
        "肉眼可以看出明顯的外觀瑕疵，但尺寸公差、內部結構、材質成分這類問題，",
        { text: "肉眼無法準確判斷，需要靠量測設備才能確認產品是否真的符合規格", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "工廠常見的檢測設備有哪些？" },
      { type: "list", items: ["三次元量測儀（CMM，精密測量尺寸與公差）", "游標卡尺／量規（基本尺寸檢測）", "AOI 自動光學檢測（電子產品外觀與焊點檢查）", "硬度計／拉力機（材料強度測試）"] },

      { type: "heading", text: "這些檢測設備分別檢查什麼？" },
      { type: "paragraph", text: "三次元量測儀用於確認精密零件的尺寸公差是否符合圖面要求；AOI 主要用在電子產品，快速檢查焊點與元件擺放是否正確；硬度計、拉力機則用於驗證材料或成品的機械性質是否達標。" },

      { type: "heading", text: "買方需要自己準備檢測標準嗎？" },
      { type: "paragraph", text: "建議需要。如果你的產品有明確的尺寸公差或品質要求，最好在詢價或下單前就跟工廠說清楚檢驗標準，讓工廠知道要用什麼設備、什麼標準來驗收，避免雙方認知落差。", segments: [
        "建議需要。如果你的產品有明確的尺寸公差或品質要求，最好在詢價或下單前就跟工廠說清楚檢驗標準，",
        { text: "讓工廠知道要用什麼設備、什麼標準來驗收，避免雙方認知落差", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "品管檢測會影響交期或成本嗎？" },
      { type: "paragraph", text: "會。品管檢測需要額外的時間與人力，複雜的檢測項目也可能增加成本，這些通常會反映在報價與交期裡，詢價時可以一併確認品管流程與費用是否已包含在報價中。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["how-to-read-factory-quotes", "what-is-tolerance"],
    cta: {
      label: "前往 OXM 找檢測設備廠商",
      href: "/factories/inspection-measurement-equipment",
      description: "直接到 OXM 查看可供應檢測與量測設備的廠商，依地區篩選並直接詢價。",
    },
  },
  {
    slug: "jig-fixture-mold-comparison",
    libraryId: "LIB-043",
    title: "治具是什麼？治具、夾具與模具有什麼差別？",
    metaDescription: "治具是什麼？這篇文章說明治具、夾具、模具三者的角色差異，是不是都需要另外花錢做，以及什麼情況下才需要客製治具或夾具。",
    h1: "治具是什麼？治具、夾具與模具有什麼差別？",
    excerpt: "說明治具、夾具、模具三者的角色差異，以及什麼情況下才需要客製治具或夾具。",
    category: "製程與設備",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 430,
    body: [
      { type: "paragraph", text: "治具、夾具、模具這三個詞經常一起出現，容易讓人搞混。這篇文章說明三者的角色差異，以及什麼時候真的需要客製。" },

      { type: "heading", text: "治具是什麼？" },
      { type: "paragraph", text: "治具是輔助生產或組裝過程的工具，用來確保零件位置正確、加工或組裝時更精準、更有效率，本身不會改變材料的形狀。" },

      { type: "heading", text: "夾具是什麼？" },
      { type: "paragraph", text: "夾具通常被視為治具底下的一種，主要功能是「固定」工件，讓加工或組裝時工件不會移動、確保精度一致；不過實務上不同工廠、不同地區對這兩個詞的用法也常有重疊，不是絕對嚴格的分類。" },

      { type: "heading", text: "治具、夾具、模具主要差在哪？" },
      { type: "paragraph", text: "治具／夾具是「輔助」加工或組裝過程的工具，本身不直接改變材料形狀；模具則是直接「塑形」材料，讓材料變成產品的形狀（例如射出模、沖壓模）——三者角色不同，不能互相取代。", segments: [
        "治具／夾具是「輔助」加工或組裝過程的工具，本身不直接改變材料形狀；模具則是直接「塑形」材料，讓材料變成產品的形狀（例如射出模、沖壓模）——",
        { text: "三者角色不同，不能互相取代", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "這三種東西都需要另外花錢做嗎？" },
      { type: "paragraph", text: "不一定，簡單的治具夾具有時可以用通用工具替代，但如果產品形狀特殊、需要精準定位或大量重複生產，客製治具／夾具能大幅提升效率與良率，通常是額外報價項目。" },

      { type: "heading", text: "什麼情況下才需要客製治具或夾具？" },
      { type: "paragraph", text: "當你的產品組裝步驟複雜、容易因人工操作誤差影響品質，或需要大量重複生產以確保一致性時，客製治具／夾具通常能提升效率並降低不良率。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["what-is-mold-making", "factory-inspection-equipment-and-quality-control"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "確認自己需要的是治具、夾具還是模具製造後，直接到 OXM 依產業與地區篩選合適的廠商並詢價。",
    },
  },
  {
    slug: "what-is-tolerance",
    libraryId: "LIB-044",
    title: "公差是什麼？為什麼公差越小，成本通常越高？",
    metaDescription: "公差是什麼？這篇文章說明公差的意義、為什麼公差越小成本通常越高、是不是所有零件都需要很小的公差，以及詢價時該怎麼溝通公差需求。",
    h1: "公差是什麼？為什麼公差越小，成本通常越高？",
    excerpt: "說明公差的意義、為什麼公差越小成本通常越高，以及詢價時該怎麼溝通公差需求。",
    category: "採購與品質",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 440,
    body: [
      { type: "paragraph", text: "公差是報價單上常見、卻不一定每個人都懂的名詞。這篇文章說明公差是什麼，以及為什麼它會直接影響報價。" },

      { type: "heading", text: "公差是什麼？" },
      { type: "paragraph", text: "公差是產品尺寸允許的誤差範圍，例如圖面標示 10±0.1mm，代表實際成品尺寸在 9.9mm 到 10.1mm 之間都算合格。" },

      { type: "heading", text: "為什麼零件需要有公差，不能做到「剛剛好」嗎？" },
      { type: "paragraph", text: "不行。任何加工設備、材料都存在物理上的變異，不可能做到絕對精準，公差就是用來明確定義「多少誤差範圍內都算合格」，讓生產與驗收都有清楚標準。", segments: [
        "不行。任何加工設備、材料都存在物理上的變異，不可能做到絕對精準，",
        { text: "公差就是用來明確定義「多少誤差範圍內都算合格」", emphasis: "primary" },
        "，讓生產與驗收都有清楚標準。",
      ] },

      { type: "heading", text: "為什麼公差越小，成本通常越高？" },
      { type: "paragraph", text: "公差越小，代表對設備精度、加工技術、檢驗流程的要求越高，往往需要更精密的機台、更多道加工工序、更嚴格的品管檢驗，這些都會反映在成本上。" },

      { type: "heading", text: "所有零件都需要很小的公差嗎？" },
      { type: "paragraph", text: "不需要。只有真正需要精密配合的部位（例如需要精準組裝的零件）才需要抓很小的公差，其餘部位可以放寬公差，這樣可以有效控制成本，不是公差越小越好。", segments: [
        "不需要。只有真正需要精密配合的部位（例如需要精準組裝的零件）才需要抓很小的公差，其餘部位可以放寬公差，這樣可以有效控制成本，",
        { text: "不是公差越小越好", emphasis: "secondary" },
        "。",
      ] },

      { type: "heading", text: "詢價時該怎麼跟工廠溝通公差需求？" },
      { type: "paragraph", text: "建議在圖面上明確標示公差要求，並且只在真正需要的地方要求嚴格公差，其餘部位標示一般公差即可，這樣工廠才能給出最合理、最符合你實際需求的報價。" },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["how-to-read-factory-quotes", "what-is-yield-rate"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "整理好公差需求後，直接到 OXM 依產業與地區篩選工廠，比較合適的合作對象。",
    },
  },
  {
    slug: "what-is-yield-rate",
    libraryId: "LIB-045",
    title: "良率是什麼？為什麼它會影響製造成本？",
    metaDescription: "良率是什麼？這篇文章說明良率的定義、為什麼良率會影響製造成本、良率低是不是代表工廠技術不好，以及買方詢價時該怎麼看待良率。",
    h1: "良率是什麼？為什麼它會影響製造成本？",
    excerpt: "說明良率的定義、為什麼良率會影響製造成本，以及詢價時該怎麼看待良率。",
    category: "採購與品質",
    publishedAt: "2026-09-17",
    updatedAt: "2026-09-17",
    learningOrder: 450,
    body: [
      { type: "paragraph", text: "良率是報價背後常被忽略、卻很關鍵的因素。這篇文章說明良率是什麼，以及它如何影響最終的製造成本。" },

      { type: "heading", text: "良率是什麼？" },
      { type: "paragraph", text: "良率是指一批生產出來的產品中，符合品質標準的比例，例如生產 1000 件、有 950 件合格，良率就是 95%。" },

      { type: "heading", text: "良率不是應該都要 100% 嗎？" },
      { type: "paragraph", text: "理論上大家都希望良率越高越好，但實務上任何製程都存在一定的不良率，尤其是新產品、新模具、複雜製程剛開始量產時，良率通常需要時間慢慢提升到穩定。" },

      { type: "heading", text: "為什麼良率會影響製造成本？" },
      { type: "paragraph", text: "良率低代表要投入更多原料與工時，才能生產出足夠數量的合格品，這些額外成本通常會反映在報價裡——良率是報價背後隱藏的重要成本因素之一。", segments: [
        "良率低代表要投入更多原料與工時，才能生產出足夠數量的合格品，這些額外成本通常會反映在報價裡——",
        { text: "良率是報價背後隱藏的重要成本因素之一", emphasis: "primary" },
        "。",
      ] },

      { type: "heading", text: "良率低是工廠技術不好嗎？" },
      { type: "paragraph", text: "不一定。良率會受產品設計複雜度、材料特性、公差要求、製程穩定度等多個因素影響，不完全代表工廠技術問題，新產品或高難度製程初期良率偏低是常見現象。" },

      { type: "heading", text: "買方在詢價時該怎麼看待良率這件事？" },
      { type: "paragraph", text: "可以直接詢問工廠這個產品的預期良率、是否會隨數量增加而改善，這能幫助你更準確評估成本，也能看出工廠對這個產品的熟悉程度與誠實度。", segments: [
        "可以直接詢問工廠這個產品的預期良率、是否會隨數量增加而改善，這能幫助你更準確評估成本，也能",
        { text: "看出工廠對這個產品的熟悉程度與誠實度", emphasis: "secondary" },
        "。",
      ] },
    ],
    relatedIndustrySlugs: [],
    relatedSubIndustrySlugs: [],
    relatedFactoryLandingSlugs: [],
    relatedArticleSlugs: ["how-to-read-factory-quotes", "what-is-tolerance"],
    cta: {
      label: "前往 OXM 找工廠",
      href: "/search",
      description: "整理好品質需求後，直接到 OXM 依產業與地區篩選工廠，比較合適的合作對象。",
    },
  },
];

export const LIBRARY_ARTICLE_BY_SLUG: Record<string, LibraryArticle> = Object.fromEntries(
  LIBRARY_ARTICLES.map(a => [a.slug, a]),
);

export function getLibraryArticle(slug: string): LibraryArticle | undefined {
  return LIBRARY_ARTICLE_BY_SLUG[slug];
}

export function getLibraryArticlesByCategory(category: LibraryCategory): LibraryArticle[] {
  return LIBRARY_ARTICLES.filter(a => a.category === category);
}

/** 粗估閱讀時間（分鐘）：純文字總字數 / 每分鐘 400 字（中文閱讀速度常見估算值），最少 1 分鐘。 */
export function estimateReadingMinutes(article: LibraryArticle): number {
  const charCount = article.body.reduce((sum, block) => {
    if (block.type === "paragraph" || block.type === "heading") return sum + block.text.length;
    if (block.type === "list") return sum + block.items.join("").length;
    if (block.type === "table") return sum + block.rows.reduce((s, r) => s + r.label.length + r.left.length + r.right.length, 0);
    return sum;
  }, 0);
  return Math.max(1, Math.round(charCount / 400));
}
