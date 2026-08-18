/**
 * Phase 6D：OXM AI 平台操作 / 使用方式能力（見對話中「Platform Help」）。
 *
 * 這是「OXM 怎麼用」這類問題的唯一產品知識來源，取代「把整份使用手冊塞進
 * Layer 1／Layer 2 prompt」的作法——比照 shared/ai/serviceRegistry.ts、
 * shared/ai/navigationRegistry.ts 同一種慣例：未來操作流程改了，只需要更新
 * 這裡的內容，不需要改 routing prompt 本身。
 *
 * 內容來源（見對話中「先 inspect 現有平台操作知識來源」）：client/src/lib/
 * manual.ts 既有使用手冊教學步驟（註冊、找工廠、刊登工廠、工廠後台管理、
 * 訊息與 PDF 型錄）、CLAUDE.md 記載的工廠審核狀態流程（draft → pending →
 * approved / rejected）、client/src/pages/EnterpriseUpgradeCenter.tsx 既有的
 * 政府補助六步申請流程、App.tsx 實際 route 結構。只收錄已經確認存在的真實
 * 操作，不編造不存在的按鈕或流程。
 *
 * relatedRoute 只能是 shared/ai/navigationRegistry.ts 裡登記的 key（不是
 * 原始 URL 字串）——見對話中「十：Navigation route 必須走既有
 * OxmNavigationRegistry，不要讓 Help Registry 自己保存任意 URL」，真正網址
 * 由 Navigation Registry 決定，這裡只負責指出「這個 help 主題對應哪個可導覽
 * 頁面」。
 */
export interface OxmPlatformHelpTopic {
  key: string;
  title: string;
  /** 給 Layer 2 判斷「使用者這句話在問這個主題」用的語意範例，不是關鍵字比對清單。 */
  userIntentExamples: string[];
  /** 一句話總結這個主題在幹嘛，聊天回覆的開場可以參考這句話改寫。 */
  answerSummary: string;
  /** 3～5 個步驟，聊天用語氣（見「十一：操作說明要短」），不是完整使用手冊。 */
  steps: string[];
  /** OXM_NAVIGATION_REGISTRY 裡的 key，沒有對應可導覽頁面時為 null。 */
  relatedRoute: string | null;
  /** 使用這個功能前需要滿足的條件（例如登入、工廠審核通過）。 */
  requirements: string[];
  /** 容易誤解或必須誠實澄清的地方（例如「個案審核原因 AI 不知道」）。 */
  notes: string[];
}

export const OXM_PLATFORM_HELP_REGISTRY: OxmPlatformHelpTopic[] = [
  {
    key: "registration_login",
    title: "註冊 / 登入",
    userIntentExamples: ["怎麼註冊？", "怎麼登入？", "登入後可以做什麼？", "一定要註冊才能用嗎？"],
    answerSummary: "OXM 目前使用 Google 帳號登入，不需要另外註冊帳號密碼。",
    steps: [
      "點右上角「登入」",
      "選擇 Google 帳號完成授權",
      "第一次登入會自動建立會員資料",
      "登入後才能收藏工廠、詢價、刊登工廠、申請補助等",
    ],
    relatedRoute: null,
    requirements: [],
    notes: ["瀏覽搜尋結果、工廠公開頁不需要登入；收藏、詢價、刊登工廠、送出申請才需要登入。"],
  },
  {
    key: "factory_search_usage",
    title: "找工廠怎麼操作",
    userIntentExamples: ["我要怎麼找工廠？", "找工廠怎麼搜尋？", "怎麼篩選工廠？", "怎麼看工廠詳細資料？"],
    answerSummary: "在找工廠頁面用產業／地區／關鍵字篩選，點進工廠公開頁可以看詳情、收藏或聯繫。",
    steps: [
      "進入找工廠頁面",
      "選擇產業別、地區等篩選條件",
      "可輸入關鍵字進一步搜尋",
      "點進工廠卡片查看公開頁詳情",
      "有需要可收藏工廠或直接聯繫詢價",
    ],
    relatedRoute: "factory_search",
    requirements: [],
    notes: [],
  },
  {
    key: "factory_public_page",
    title: "工廠公開頁在看什麼",
    userIntentExamples: ["工廠公開頁有什麼資訊？", "怎麼看工廠的評價？", "工廠頁面在哪裡看產品？"],
    answerSummary: "工廠公開頁會顯示工廠基本資料、產品項目、評價與聯繫入口，需要先在找工廠頁面找到該工廠才能進入。",
    steps: [
      "從找工廠或搜尋結果點進特定工廠",
      "查看工廠基本資料、產業別、地區",
      "瀏覽已上架的產品項目",
      "查看其他買家留下的評價",
      "需要合作可直接點「聯繫工廠」",
    ],
    relatedRoute: null,
    requirements: [],
    notes: ["工廠公開頁沒有獨立導覽入口，需要先透過找工廠搜尋到該工廠。"],
  },
  {
    key: "factory_listing",
    title: "刊登 / 建立工廠",
    userIntentExamples: ["我要怎麼刊登工廠？", "怎麼上架我的工廠？", "怎麼申請成為工廠？", "怎麼註冊工作室？"],
    answerSummary: "刊登工廠需要先登入，填寫基本資料與聯絡資訊送出申請，審核通過後才會正式上線。",
    steps: [
      "登入後進入「註冊工廠」頁面",
      "選擇申請類型並填寫基本資料",
      "填寫聯絡資料並送出申請",
      "進入工廠後台完善其餘資料（大頭貼、產品等）",
      "送出審核，通過後工廠正式上線",
    ],
    relatedRoute: "factory_register",
    requirements: ["需要登入"],
    notes: [],
  },
  {
    key: "factory_edit",
    title: "修改工廠資料",
    userIntentExamples: ["怎麼修改工廠資料？", "我要去哪裡修改資料？", "怎麼更新工廠大頭貼？", "怎麼新增產品？"],
    answerSummary: "已核准的工廠可以在工廠後台修改資料、上傳大頭貼、新增產品、設定接單狀態，重大修改可能需要重新送審。",
    steps: [
      "登入後進入工廠後台",
      "在對應分頁修改基本資料、大頭貼或產品",
      "設定目前的接單狀態",
      "儲存變更",
      "部分重大修改需要重新送審才會生效於公開頁",
    ],
    relatedRoute: "factory_dashboard",
    requirements: ["需要登入", "需要是工廠主或共同管理者"],
    notes: [],
  },
  {
    key: "factory_approval",
    title: "工廠審核是什麼",
    userIntentExamples: ["工廠審核是什麼？", "為什麼我的工廠還沒出現在搜尋？", "審核要多久？", "為什麼我的工廠沒通過？"],
    answerSummary: "工廠上架前需要經過 OXM 審核，狀態依序是草稿、審核中、已通過或未通過，只有已通過的工廠會出現在公開搜尋結果。",
    steps: [
      "填寫完基本資料後送出審核",
      "狀態會顯示為「審核中」",
      "OXM 審核通過後狀態轉為「已通過」，工廠才會出現在搜尋結果",
      "如果未通過，可以在後台查看並修改資料後重新送審",
    ],
    relatedRoute: null,
    requirements: [],
    notes: ["AI 只能說明審核制度本身，不知道個別工廠實際的審核結果或原因，需要確認個案請洽 OXM 客服。"],
  },
  {
    key: "inquiry_contact",
    title: "詢價 / 聯絡工廠",
    userIntentExamples: ["詢價怎麼用？", "怎麼聯絡工廠？", "怎麼傳訊息給工廠？", "可以一次問多間工廠嗎？"],
    answerSummary: "在工廠公開頁點「聯繫工廠」開啟對話，之後就能在訊息頁查看與工廠的往來紀錄，也支援一鍵詢價多間工廠。",
    steps: [
      "進入想聯繫的工廠公開頁",
      "點「聯繫工廠」並輸入需求送出",
      "在對話頁查看歷史訊息並回覆",
      "工廠方可能會傳送架上商品或 PDF 型錄",
      "所有對話紀錄都能在訊息頁統一查看",
    ],
    relatedRoute: "messages",
    requirements: ["需要登入"],
    notes: [],
  },
  {
    key: "news_usage",
    title: "找消息怎麼操作",
    userIntentExamples: ["找消息怎麼用？", "怎麼看展覽資訊？", "消息頁面在哪裡？", "怎麼篩選消息類型？"],
    answerSummary: "找消息頁面可以依類型（重要消息／競賽／展覽／跨產業）與產業別篩選，也可以直接在對話裡問 AI 有沒有相關消息。",
    steps: [
      "進入找消息頁面",
      "選擇消息類型（展覽、競賽、重要消息等）或產業別篩選",
      "點進單則消息查看詳情",
      "也可以直接在這個對話裡問「最近有什麼展覽」，AI 會直接查給你",
    ],
    relatedRoute: "news",
    requirements: [],
    notes: [],
  },
  {
    key: "government_subsidy_center",
    title: "政府補助專區怎麼使用",
    userIntentExamples: ["政府補助專區怎麼用？", "補助專區在哪裡？", "怎麼看有哪些補助方案？"],
    answerSummary: "政府補助專區列出 OXM 目前提供的政府補助方案，可以查看各方案介紹，並從這裡進入申請流程。",
    steps: [
      "進入政府補助專區",
      "瀏覽目前列出的各項補助方案",
      "點進感興趣的方案查看詳情",
      "點「免費評估資格」開始申請流程",
      "也可以直接在對話裡問 AI 特定方案的內容或比較",
    ],
    relatedRoute: "gov_subsidy",
    requirements: [],
    notes: [],
  },
  {
    key: "government_subsidy_application",
    title: "怎麼送政府補助詢問",
    userIntentExamples: ["我要怎麼送政府補助詢問？", "怎麼申請政府補助？", "補助申請流程是什麼？"],
    answerSummary: "在政府補助專區點「免費評估資格」，填寫基本資料送出後，OXM 會先審查資格，再安排顧問進一步協助。",
    steps: [
      "進入政府補助專區，點「免費評估資格」",
      "填寫企業基本資料並送出",
      "OXM 團隊先審查是否符合基本申請資格",
      "資格初審通過後，顧問會安排進一步了解需求",
      "後續依實際方案進入正式申請",
    ],
    relatedRoute: "gov_subsidy",
    requirements: ["需要登入"],
    notes: ["這裡只說明操作流程本身，不代表現在就建立顧問媒合——如果想直接找顧問，可以明確告訴我「幫我找補助顧問」。"],
  },
  {
    key: "erp_center",
    title: "ERP 專區怎麼看",
    userIntentExamples: ["怎麼看 ERP 專區？", "ERP 專區在哪裡？", "ERP 服務怎麼申請？"],
    answerSummary: "ERP 專區介紹 OXM 的生產管理系統化服務，可以了解服務內容並留下需求讓顧問聯繫。",
    steps: [
      "進入 ERP 專區",
      "了解服務內容與適用情境",
      "有需要可留下需求，由 OXM 顧問進一步聯繫",
    ],
    relatedRoute: "erp",
    requirements: [],
    notes: [],
  },
  {
    key: "certification_center",
    title: "ISO / 低碳專區怎麼看",
    userIntentExamples: ["怎麼看 ISO 認證專區？", "低碳專區在哪裡？", "碳盤查服務怎麼申請？"],
    answerSummary: "ISO／低碳認證專區介紹 OXM 的認證輔導服務，可以了解服務內容並留下需求讓顧問聯繫。",
    steps: [
      "進入 ISO／低碳認證專區",
      "了解服務內容與適用情境",
      "有需要可留下需求，由 OXM 顧問進一步聯繫",
    ],
    relatedRoute: "certification",
    requirements: [],
    notes: [],
  },
  {
    key: "short_video_center",
    title: "短影音 / 品牌專區怎麼看",
    userIntentExamples: ["短影音服務怎麼用？", "品牌內容專區在哪裡？"],
    answerSummary: "短影音／品牌內容專區介紹品牌故事、產線實績內容與社群代操服務，可以了解服務內容並留下需求。",
    steps: [
      "進入短影音／品牌專區",
      "了解服務內容與適用情境",
      "有需要可留下需求，由 OXM 顧問進一步聯繫",
    ],
    relatedRoute: "short_video",
    requirements: [],
    notes: [],
  },
  {
    key: "finance_center",
    title: "企業財務優化專區怎麼看",
    userIntentExamples: ["財務優化專區怎麼用？", "融資服務在哪裡？"],
    answerSummary: "企業財務優化專區介紹融資額度、現金流結構調整等服務，可以了解服務內容並留下需求。",
    steps: [
      "進入企業財務優化專區",
      "了解服務內容與適用情境",
      "有需要可留下需求，由 OXM 顧問進一步聯繫",
    ],
    relatedRoute: "finance",
    requirements: [],
    notes: [],
  },
  {
    key: "site_navigation_overview",
    title: "OXM 主要功能導覽",
    userIntentExamples: ["OXM 有哪些功能？", "網站架構是什麼？", "我不知道要去哪裡", "有哪些服務入口？"],
    answerSummary: "OXM 的主要入口都可以在資源總覽頁一次看到，也可以直接跟 AI 說想找哪個功能，我可以直接帶你去。",
    steps: [
      "進入資源總覽頁，可以看到所有服務入口",
      "或直接跟我說想做什麼（例如「帶我去找工廠」），我可以直接幫你導覽",
    ],
    relatedRoute: "resource_center",
    requirements: [],
    notes: [],
  },
];

export function getPlatformHelpTopic(key: string): OxmPlatformHelpTopic | undefined {
  return OXM_PLATFORM_HELP_REGISTRY.find(t => t.key === key);
}
