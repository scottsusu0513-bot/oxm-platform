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
// relatedLink 區塊：文章正文裡「自然」出現的 contextual internal link
// （見任務定案「不要一直插 CTA，1-2 個自然 contextual links」），只存
// 目標文章的 slug，實際 href／標題由 LIBRARY_ARTICLE_BY_SLUG 反查組出，
// 不在區塊裡重複硬寫網址——避免文章互相改 slug 時要手動同步兩個地方。
export type LibraryCategory = "代工基礎" | "製程與設備" | "材料知識" | "採購與品質";

export const LIBRARY_CATEGORIES: LibraryCategory[] = ["代工基礎", "製程與設備", "材料知識", "採購與品質"];

export type LibraryBodyBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; headers: [string, string]; rows: { label: string; left: string; right: string }[] }
  | { type: "relatedLink"; text: string; slug: string };

export interface LibraryFaqItem {
  question: string;
  answer: string;
}

/**
 * 文章結尾唯一的主要 CTA（見任務定案「每篇文章正文最多 1 個結尾主要 CTA」）。
 * secondaryLabel／secondaryHref 是選填的第二個並列選項，只用在「OEM vs
 * ODM」這種主題本身就是二選一、不能只給單一方向連結的情境（見任務定案
 * 「不要假設所有工廠都支援 OEM/ODM」），不是普遍每篇都要有兩個按鈕。
 */
export interface LibraryCta {
  label: string;
  href: string;
  description: string;
  secondaryLabel?: string;
  secondaryHref?: string;
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
      { type: "paragraph", text: "所以找代工，其實不是在找「一家萬能工廠」，而是在找適合你產品製造流程的合作夥伴——可能是一家工廠包辦大部分流程，也可能是好幾家工廠分工合作。" },

      { type: "heading", text: "代工廠是什麼？是不是所有工廠都一樣？" },
      { type: "paragraph", text: "代工廠指的是具備特定設備、技術、製程與量產能力，願意接受其他企業委託製造的工廠。但「代工廠」不是單一種工廠，不同產業的代工廠專精完全不同，例如：" },
      { type: "list", items: ["CNC 加工廠", "鈑金廠", "塑膠射出廠", "SMT 電子代工廠", "食品代工廠", "化妝品代工廠", "成衣代工廠", "包裝印刷廠"] },
      { type: "paragraph", text: "而且製造業的合作夥伴，其實不只有「代工廠」這一種角色。依你的需求，你可能還會用到：" },
      { type: "list", items: ["原料供應商", "模具廠", "設備廠商", "設計工作室", "表面處理廠", "包裝廠", "組裝廠"] },
      { type: "paragraph", text: "重點不是找到「最厲害的代工廠」，而是找到真正適合你需求的工廠或供應商——這也是為什麼同一個產業裡，會同時存在很多不同專長的廠商。" },

      { type: "heading", text: "哪些人會需要找代工廠？" },
      { type: "paragraph", text: "找代工廠不是只有「品牌」才需要，實務上常見的需求者包括：" },
      { type: "list", items: [
        "品牌方：已經有產品或設計，需要工廠量產",
        "貿易商／採購：幫客戶尋找合適的製造來源，比較不同工廠的報價與品質",
        "創業者／新產品團隊：第一次做產品，需要找到能配合小量、願意溝通的工廠",
        "工廠找工廠：工廠本身也常需要把部分製程外包給其他工廠，例如 CNC 外包、雷射切割外包、電鍍、熱處理、烤漆",
      ] },
      { type: "paragraph", text: "換句話說，「找代工」不是新創或品牌方的專利，只要你的製造流程有一段需要外部協助，都算在找代工的範圍內。" },

      { type: "heading", text: "找代工廠前，要準備什麼？" },
      { type: "paragraph", text: "開始詢價之前，先把以下資訊準備好，可以讓溝通快很多：" },
      { type: "list", items: ["產品用途", "材質", "尺寸", "預估數量", "圖面或照片", "是否需要打樣", "預計交期", "是否已有模具", "特殊加工需求", "包裝要求"] },
      { type: "paragraph", text: "如果是精密零件，最好能再額外提供：2D 圖、3D 圖、公差要求、材質規格、表面處理需求。" },
      { type: "paragraph", text: "只問工廠「這個做一個多少錢？」，很多時候工廠沒辦法給你準確報價——因為價格會隨材質、數量、加工難度大幅變動，資訊給得越完整，你拿到的報價才會越準。" },

      { type: "heading", text: "為什麼同一個產品，不同工廠報價會差很多？" },
      { type: "paragraph", text: "同一個產品拿去問不同工廠，報價常常差距很大，這是正常現象，因為影響價格的因素非常多，包括：" },
      { type: "list", items: ["生產數量", "材料成本", "機台", "加工時間", "人工", "模具", "治具", "公差", "表面處理", "品質", "包裝", "交期", "良率", "外包製程"] },
      { type: "paragraph", text: "光是「數量」和「公差要求」這兩個變數，就足以讓報價差到好幾倍——量越大通常單價越低，公差要求越嚴格，加工難度與良率風險就越高，價格自然反映上去。" },
      { type: "paragraph", text: "但這裡有一個很重要的觀念：價格不是找工廠唯一該看的重點。除了價格，你還要評估：" },
      { type: "list", items: [
        "工廠是否擅長這個產品",
        "設備是否合適",
        "品質穩定度",
        "交期",
        "數量是否符合工廠的生產模式（工廠不一定適合你的訂單規模，太小或太大都可能有問題）",
        "溝通",
        "售後／問題處理",
      ] },
      { type: "paragraph", text: "所以真正該問的問題，不是「哪一家最便宜？」，而是「哪一家最適合把我的產品穩定做出來？」——便宜但做不出品質、或做出來但工廠不願意配合修改，最後付出的成本往往更高。" },

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
      { type: "relatedLink", text: "延伸閱讀：MOQ 是什麼？最低訂購量怎麼談", slug: "what-is-moq" },

      { type: "heading", text: "OEM、ODM 跟代工有什麼關係？" },
      { type: "paragraph", text: "代工是比較廣義的概念，泛指「委託其他工廠製造」這件事。OEM 和 ODM，則是代工底下兩種不同的合作模式。簡單分辨：OEM 是「照你的規格幫你做」——你提供設計或規格，工廠負責生產；ODM 則是「工廠也一起協助把產品做出來」——工廠除了製造，也會參與部分設計、開發，或提供既有的產品方案讓你調整。" },
      { type: "relatedLink", text: "延伸閱讀：OEM 與 ODM 差在哪？", slug: "oem-vs-odm" },

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
      { type: "paragraph", text: "MOQ 是 Minimum Order Quantity（最低訂購量）的縮寫。" },
      { type: "paragraph", text: "工廠開一條生產線有固定成本：機器設定費、原料採購批量、工人排班等。為了讓這些成本攤平，工廠會設定最小接單量。低於這個數量，工廠的利潤可能是負的。" },
      { type: "heading", text: "台灣工廠常見 MOQ 範圍" },
      { type: "paragraph", text: "依產業不同，MOQ 差距很大：" },
      { type: "list", items: [
        "紡織 / 成衣：通常 300–1,000 件起",
        "塑膠射出：開模費另計，量產 500–2,000 件起",
        "金屬加工：依零件複雜度，100–500 件不等",
        "食品代工：通常以重量或箱數計，100–500 公斤起",
        "印刷包裝：1,000–5,000 份常見",
      ] },
      { type: "heading", text: "工作室 vs 工廠的差異" },
      { type: "paragraph", text: "在 OXM 上，你可以同時找工廠和設計工作室。" },
      { type: "paragraph", text: "工作室通常接受更低的 MOQ，甚至 50 件、30 件都可以。代價是單價較高。如果你要測試市場、打樣確認，工作室往往是更好的起點。" },
      { type: "heading", text: "如何談低一點的 MOQ？" },
      { type: "list", items: [
        "坦誠說明你的情況：「我是新品牌，第一批想先下 300 件測市場，後續有量的話會繼續合作。」大多數工廠都能理解。",
        "接受價格補差：接受較低 MOQ，通常代表單價高一些，這是合理的交換。",
        "選擇現有款式（ODM）：不需開新模，工廠成本低，MOQ 相對彈性。",
        "詢問樣品費：先下打樣單，工廠看到你認真，後續談 MOQ 更順。",
      ] },
      { type: "relatedLink", text: "延伸閱讀：ODM 是什麼？跟 OEM 差在哪？", slug: "oem-vs-odm" },
      { type: "paragraph", text: "MOQ 是可以談的，關鍵是你要讓工廠知道：你是認真的長期合作夥伴，不是一次性的小單。" },
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
      { type: "paragraph", text: "OEM（Original Equipment Manufacturer，原廠委託製造）指的是：你提供設計，工廠負責製造。" },
      { type: "paragraph", text: "你給工廠完整的規格書、模具、甚至原料，工廠只負責按照你的圖紙生產。產品的設計、品牌、包裝全部由你控制。" },
      { type: "paragraph", text: "適合誰用？" },
      { type: "list", items: [
        "已有成熟產品設計、只需要量產的品牌商",
        "有自己研發團隊的企業",
        "想完全掌控產品規格的買家",
      ] },
      { type: "heading", text: "ODM 是什麼？" },
      { type: "paragraph", text: "ODM（Original Design Manufacturer，原廠設計製造）指的是：工廠有現成設計，你可以貼牌或微調。" },
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
      { type: "paragraph", text: "如果你是第一次找代工、預算有限、想快速驗證市場，先從 ODM 開始，找工廠的現有款式微調，降低風險。" },
      { type: "paragraph", text: "當你確定市場需求，想推出真正差異化的產品，再考慮走 OEM 路線，投入設計與模具開發。" },
      { type: "relatedLink", text: "延伸閱讀：MOQ 是什麼？最低訂購量怎麼談", slug: "what-is-moq" },
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
      label: "瀏覽提供 ODM 代工的工廠",
      href: "/search?mfgMode=ODM",
      description: "台灣工廠通常各自專精不同代工模式，可以分別查看目前平台上提供 ODM 或 OEM 服務的工廠。",
      secondaryLabel: "瀏覽提供 OEM 代工的工廠",
      secondaryHref: "/search?mfgMode=OEM",
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
      { type: "paragraph", text: "越清楚，工廠越能給你準確報價，你也越省時間。" },
      { type: "heading", text: "第二步：找合適的工廠" },
      { type: "paragraph", text: "在 OXM 上可以依產業、地區、資本額篩選。建議：" },
      { type: "list", items: [
        "先看評分和評價：真實買家留的回饋，能幫你快速判斷這家廠商的配合態度",
        "注意 OEM / ODM：確認工廠支援你需要的合作模式",
        "看產品頁：工廠有沒有展示過類似的產品？",
      ] },
      { type: "relatedLink", text: "延伸閱讀：OEM 與 ODM 差在哪？", slug: "oem-vs-odm" },
      { type: "heading", text: "第三步：寫一封好的詢價信" },
      { type: "paragraph", text: "第一封詢問訊息決定你被認真對待的程度。建議格式：" },
      { type: "paragraph", text: "「您好，我是 [品牌名/公司名]，想詢問 [產品名稱] 的代工報價。數量：約 ___ 件/批；規格：（附圖或說明）；時程：希望 ___ 前交貨。請問是否可以配合？如可以，方便提供初步報價嗎？」" },
      { type: "paragraph", text: "簡短、具體、有禮貌，工廠回覆率更高。" },
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
      { type: "paragraph", text: "打樣費通常需要另付，但這筆錢很值得。" },
      { type: "relatedLink", text: "延伸閱讀：MOQ 是什麼？最低訂購量怎麼談", slug: "what-is-moq" },
      { type: "heading", text: "常見新手錯誤" },
      { type: "list", items: [
        "一開口就問「最低多少」，讓工廠覺得你只在意價格",
        "需求不清楚就詢價，浪費雙方時間",
        "跳過打樣直接下大訂單，風險極高",
        "只問一家，沒有比較基準",
      ] },
      { type: "paragraph", text: "找代工廠本質上是建立長期合作關係。從第一次接觸開始，就以誠信、清晰的溝通建立信任，後續的合作會順很多。" },
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
