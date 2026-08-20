/**
 * OXM AI（企業需求診斷與資源分流 AI）的可擴充服務定義清單。
 *
 * 這裡是「未來新增一項 OXM 服務時，只需要新增一筆定義，不需要改 AI 核心邏輯」
 * 的落地位置——比照 shared/constants.ts 的 INDUSTRIES 陣列同一種慣例。
 * server/ai/systemPrompt.ts 會把這個陣列序列化進 system prompt，所以在這裡
 * 新增/調整一筆服務定義，AI 對話馬上就會反映，不需要動 provider、router 或
 * 對話邏輯本身。
 *
 * 本輪（Phase 1）只有 7 筆服務定義；未來新增服務時，直接在
 * AI_SERVICE_REGISTRY 陣列後面新增一個物件即可。
 */

export type ServiceRelationType = "sequential" | "concurrent" | "integrated";

/**
 * 服務關係只保留三種（V1）：
 * - sequential：通常有先後順序（但不是絕對規則，顧問可依個案調整）
 * - concurrent：可以同時進行，互不阻擋
 * - integrated：可能整合成同一件事去做（例如 AI 功能直接內建在某套 ERP 裡）
 *
 * 刻意不用「A 一定先於 B」這種寫死的圖，而是每一組關係都帶一句 note 說明
 * 「什麼情況下」比較像哪一種，把最終判斷留給 AI 依對話內容與顧問來決定。
 */
export interface ServiceRelation {
  withServiceKey: string;
  type: ServiceRelationType;
  note: string;
}

export interface GovSubsidyProgram {
  key: string;
  name: string;
  /** AI 用來理解「這個方案本質上在幹嘛、適合什麼樣的企業」的簡短側寫 */
  profile: string;
  /**
   * Phase 6G.1（見對話中「政府補助 Program Decision Layer」）：這個方向的
   * 正面適合情境——AI 判斷 primaryProgramKey／secondaryProgramKey 時的具體
   * 依據，不是關鍵字比對，是語意情境描述。
   */
  fitSignals?: string[];
  /**
   * Phase 6G.1：容易誤判成這個方向、或不應該被當成負面資格判斷的情況，同時
   * 承載 caseAssessment.ts／routing.ts 原本各自手寫的「判斷細節」，避免兩處
   * 各自維護一份容易漂移的知識（見對話中「二十：Case Assessment 去重」）。
   */
  cautionSignals?: string[];
  /** Phase 6G.1：這個方向跟其他方向的差異在哪，用於 AI 做跨方向比較判斷。 */
  comparisonNotes?: string;
  /** Phase 6G.1：判斷這個方向是否適合時，值得追問的高價值問題（供 Layer 1／Layer 2 參考，不是固定問卷）。 */
  usefulQuestions?: string[];
}

export interface ServiceDefinition {
  key: string;
  displayName: string;
  /** 1. 服務是做什麼 */
  whatItIs: string;
  /** 2. 解決什麼企業問題 */
  problemsSolved: string;
  /** 3. 哪些語意／情境可能代表需要它（語意原型，不是關鍵字） */
  triggerScenarios: string;
  /** 4. AI 可以繼續了解哪些資訊（只在真的會改變判斷時才問） */
  followUpQuestions: string;
  /** 5. 什麼情況不應太早推這個服務 */
  whenNotToPushEarly: string;
  /** 6. 這項服務和其他服務可能的關係 */
  relations: ServiceRelation[];
  /** 7. 最終顧問通常需要理解什麼（AI 初判要幫顧問先看懂什麼） */
  advisorNeedsToUnderstand: string;
  /** 僅政府補助使用：六大方向的個別側寫 */
  govSubsidyPrograms?: GovSubsidyProgram[];
  /**
   * Phase 6E（見對話中「OXM 顧問服務知識中心化 + 精準服務查詢」）：這個服務
   * 實際包含哪些具體項目，內容來自真實 inspect 公開頁／表單／案件追蹤流程
   * （不是憑印象寫的），用於回答「XX服務是做什麼／包含什麼」這類 service_info
   * 查詢——finalReply 只能依這裡列出的項目回答，不能自己多加項目。
   */
  serviceScope?: string[];
  /**
   * Phase 6E：常見誤解或這個服務明確不包含的邊界，同樣來自真實頁面的「重要
   * 聲明」／FAQ／比較表，避免 AI 順口承諾服務範圍以外的東西（見「十三：不要
   * 編造服務範圍」）。
   */
  notIncluded?: string;
}

export const AI_SERVICE_REGISTRY: ServiceDefinition[] = [
  {
    key: "gov_subsidy",
    displayName: "政府補助",
    whatItIs:
      "協助企業媒合、理解並準備申請適合的政府補助或輔導資源，本輪先理解六大方向：SBIR、CITD、SIIR、研發轉型、海外市場拓展與通路布局、製造業 19+1 AI 診斷輔導。",
    problemsSolved:
      "企業想做研發／技術升級／數位轉型／拓展海外市場，但缺資金、不確定要走哪個政府管道，或不知道自己夠不夠格申請。",
    triggerScenarios:
      "使用者提到想拿補助、缺資金但同時有明確投資計畫（設備、研發、新市場）、被問「能不能省一點錢做這件事」、想導入 AI 但不知道從哪開始、想做以前做不到的新產品/新製程、想去海外設點或找代理經銷。",
    followUpQuestions:
      "研發／設備投資的具體標的是什麼、是否已有明確技術方向或只是概念、是否已經有 PoC 或雛型、資本額與自籌能力量級、是否申請過政府補助、決策者是否會實際參與、是否已有海外市場基礎。只問會改變主推薦方向的題目。",
    whenNotToPushEarly:
      "使用者的核心問題其實是基礎管理混亂（庫存、工單、排程都沒系統化）時，不要急著推研發型補助——那種情況通常 ERP 更優先，AI 診斷輔導（19+1）可能才是補助面的合理切入點，而不是 SBIR/CITD 這種研發補助。純粹想擴產、沒有新產品/新製程/新市場元素時，研發型補助的適配度通常偏低，要誠實但不要說死。",
    relations: [
      {
        withServiceKey: "erp",
        type: "concurrent",
        note:
          "若企業核心問題是庫存/工單/排程沒有系統化，ERP 可能是主要承載系統；若使用者想要的 AI 功能（智慧排程、預測、補貨等）本身可以是某套 ERP 內建的一部分，也可能是「整合在一起」而非兩件事——不要預設 ERP 一定要先於補助或先於 AI。",
      },
      {
        withServiceKey: "finance",
        type: "sequential",
        note:
          "如果企業真正卡住的是現金流/週轉，而不是缺研發資金，通常財務優化（融資、帳期改善）才是優先方向，補助只是錦上添花，不該本末倒置去硬找補助。",
      },
    ],
    advisorNeedsToUnderstand:
      "企業目前主要問題、研發或投資標的的成熟度（概念/PoC/正式量產）、資本額與自籌能力區間、是否申請過補助、決策者參與程度、AI 建議的主推薦與次推薦方向及理由。",
    // 見對話中「十一：Service Info 與 Subsidy Programs 分開」：這裡回答的是
    // 「政府補助這個服務本身怎麼協助企業」（陪同盤點、媒合適合方向、準備申請
    // 資料），不是列出目前有哪些方案（那是 upgradePrograms DB，見
    // server/ai/subsidyProgramsAction.ts）。
    serviceScope: [
      "盤點企業現況、研發或投資標的，判斷適合哪個政府補助或輔導方向",
      "說明各方案的定位差異（研發創新／傳產技術升級／服務創新／轉型／海外拓展／AI診斷輔導）",
      "協助準備申請資料、對接顧問完成後續申請流程",
    ],
    notIncluded:
      "OXM 顧問服務本身不保證核准補助或撥款金額，實際資格與金額以官方最新公告與審查結果為準；OXM 也不是政府機關，不能代替官方做最終審核決定。",
    govSubsidyPrograms: [
      {
        key: "sbir",
        name: "SBIR",
        profile:
          "偏創新研發：新產品、新技術、新服務，創新性與研發標的本身是否夠新穎、夠有技術含量是重點。",
        fitSignals: [
          "技術本身還有明確的不確定性、需要驗證",
          "目標是全新的產品、技術或服務，不是既有能力的延伸",
          "已有初步技術方向或早期驗證，但還沒定案",
        ],
        cautionSignals: [
          "純粹只是想採購或更換設備，沒有提到新技術或新產品目標時不應該直接判為 SBIR",
          "沒有專利、沒有申請過補助本身都不是排除理由，不能作為「不適合」的判斷依據",
        ],
        comparisonNotes:
          "跟 CITD 的核心差異在於創新程度與風險：SBIR 偏向技術本身仍有不確定性、需要驗證的前沿創新；CITD 偏向既有製造能力的延伸與升級，風險與創新程度通常較低。",
        usefulQuestions: ["技術本身的新穎程度與風險有多高？", "目前是概念、已驗證方向，還是已經有雛型？"],
      },
      {
        key: "citd",
        name: "CITD",
        profile:
          "偏傳統／製造業導向的新產品、新技術、新製程、技術升級，比 SBIR 更貼近既有製造業能力的延伸提升，不強求前沿創新性。",
        fitSignals: [
          "既有製造業能力的延伸提升：新產品、新技術、新製程",
          "設備採購有明確服務於製程升級或研發目標，不是單純汰換或擴產",
        ],
        cautionSignals: [
          "使用者只講出「想買設備」「想換設備」，沒有講清楚設備跟研發或製程升級的關係前，不應該直接判斷為 CITD——必須先確認這是單純汰換／擴產，還是服務於新製程／技術目標",
        ],
        comparisonNotes:
          "跟 SBIR 的差異在於創新程度：CITD 不強求前沿創新性，重點是既有能力的延伸與升級；跟 19+1 的差異在於成熟度：CITD 適合已經有明確技術或製程目標的企業，19+1 適合 AI 應用場景還不清楚、需要先診斷的企業。",
        usefulQuestions: ["這次設備投資是要支援哪個新製程或技術目標？", "是單純汰換／擴產，還是有製程升級的目的？"],
      },
      {
        key: "siir",
        name: "SIIR",
        profile:
          "偏新服務、新商業模式、服務流程或平台／服務創新，重點不是製造技術本身，而是服務或商業模式的創新。",
        fitSignals: [
          "核心是服務、商業模式、服務流程或平台的創新，不是製造技術本身",
          "即使企業本身是製造業，只要訴求是把產品銷售模式轉變成服務模式（例如訂閱、維護服務、平台化），也可能適用",
        ],
        cautionSignals: [
          "不要因為使用者是製造業就自動排除 SIIR，也不要因為使用者是製造業就自動判斷為 CITD——要看訴求本身是製程／技術升級，還是服務／商業模式創新",
        ],
        comparisonNotes:
          "跟 CITD／SBIR 的核心差異不是產業別，而是創新的標的：CITD／SBIR 是製造技術或產品本身的創新，SIIR 是服務或商業模式本身的創新，即使申請企業是製造業也一樣適用。",
        usefulQuestions: ["這個新方向的核心是產品／技術本身的改變，還是銷售或服務模式的改變？"],
      },
      {
        key: "transformation",
        name: "研發轉型",
        profile:
          "偏製造業因政策或市場衝擊（例如關稅、客戶流失、供應鏈重組）後需要進行技術、設備、數位化、綠色轉型等整體轉型。當年度實際硬性資格條件必須以官方最新公告為準，AI 不可捏造細節門檻。",
        fitSignals: [
          "有明確的政策或市場衝擊背景（例如關稅、主要客戶轉單、供應鏈重組）",
          "轉型範圍是整體性的（技術＋設備＋數位化＋綠色轉型的組合），不是單一設備投資",
        ],
        cautionSignals: [
          "不能只因為投資金額大就判斷為研發轉型——金額大小不是判斷依據，必須有明確的政策／市場衝擊與整體轉型脈絡",
          "當年度實際硬性資格條件必須以官方最新公告與真人顧問確認為準，不可捏造細節門檻",
        ],
        comparisonNotes:
          "跟單純的 SBIR／CITD 研發案差異在於：研發轉型通常源自外部政策或市場衝擊、且是技術／設備／數位／綠色轉型的整體組合，而不是單一、獨立的研發或技術升級計畫。",
        usefulQuestions: ["這個轉型計畫的背景是什麼（例如關稅、客戶轉單、供應鏈變化）？", "轉型範圍是單一設備投資，還是包含數位化、綠色轉型等整體規劃？"],
      },
      {
        key: "overseas_expansion",
        name: "海外市場拓展與通路布局",
        profile:
          "適合產品已有一定成熟度、準備真正建立海外代理、經銷、展示、倉儲或維修／服務據點的企業，而不是單純想去參展或探路的階段。",
        fitSignals: [
          "產品已有一定成熟度，不是還在研發階段",
          "已經在真正準備建立海外代理、經銷、展示、倉儲或維修服務據點",
        ],
        cautionSignals: [
          "單純講「想出口」「想試試海外市場」「想去參展」，還沒有具體通路布局準備時，不應該直接列為高優先方向，應先釐清準備程度",
        ],
        comparisonNotes:
          "跟研發型補助（SBIR／CITD／研發轉型）的差異在於：海外市場拓展處理的是通路布局，不是產品或技術本身的研發，前提通常是產品本身已經成熟、不需要再研發。",
        usefulQuestions: ["目前是還在評估要不要做，還是已經有具體海外客戶、代理或通路在談？"],
      },
      {
        key: "manufacturing_19plus1",
        name: "製造業 19+1 AI 診斷輔導",
        profile:
          "官方正式名稱為「產業競爭力輔導團」（俗稱「19+1」，措施一），主辦經濟部產業發展署，委辦執行單位為工業技術研究院（ITRI），適用依法登記之製造業（也延伸部分服務業）。" +
          "這不是 SBIR／CITD 那種「企業提出計畫、直接拿一筆研發補助款」的機制，而是製造業 AI／數位轉型的前段診斷入口：由輔導團隊盤點企業現況、流程、資料基礎與 AI 成熟度，產出「AI 導入與轉型建議報告」，官方建議 4 個月內完成診斷。" +
          "經費結構：每案由政府支付 19 萬元輔導診斷費＋3.15 萬元行政作業費（皆政府負擔，非企業支出），企業僅自籌 1 萬元——這是專業診斷／輔導資源，不是撥給企業的現金，不可說成「企業付 1 萬就拿到 19 萬現金」。" +
          "後續為接續階段（非與診斷同時發放）：AI 工具導入最高約 10 萬元、AI 人才培訓最高約 12 萬元；再往後走研發轉型，個案最高約 500 萬元、產業聯盟最高約 4,000 萬元（企業自籌需超過 50%）。三階段分開接續，不可簡化成「企業一次拿到 42 萬現金」。" +
          "限制：曾於 114 年度接受「16+4」（智慧化＋低碳化）輔導者，不得再申請 115－116 年度 19+1；此外申請本案不影響其他政府補助申請，可併行、非互斥。" +
          "適用時機：企業對 AI 場景仍模糊、講得出想做 AI／自動化但不知從何切入時，19+1 優先度高；已有清楚研發標的、完成 PoC、要把技術整合成正式產品時，應轉向 CITD／SBIR／研發轉型評估，不宜停留在 19+1 診斷；若真正問題是庫存、工單、排程等基礎管理，不能只因提到「AI」就直接推 19+1，應先評估是否為 ERP 範疇、AI 功能能否整合進 ERP。" +
          "資料年度與來源：115 年度（2026 年），來源為經濟部產業競爭力輔導團官方網站（eii.nat.gov.tw/moeai-plus）。此為逐年變動的政府計畫，AI 給出方向後仍須交由真人顧問依當下最新公告確認實際資格與金額，不可視為當年度以後永遠有效。",
        fitSignals: [
          "企業對 AI／自動化應用場景還模糊，講得出想做但不知道從哪切入",
          "還沒有具體的技術標的、PoC 或研發計畫",
        ],
        cautionSignals: [
          "已經有清楚的研發標的、已完成 PoC、準備把技術整合成正式產品時，不應該再把 19+1 當首選，應該評估 CITD／SBIR／研發轉型",
          "不能把經費結構描述成「企業付 1 萬拿 19 萬現金」，政府支付的 19 萬元＋3.15 萬元是給輔導／診斷資源，不是撥給企業的現金",
        ],
        comparisonNotes:
          "19+1 是 AI／數位轉型的前段診斷入口，不是研發補助本身；一旦企業已經有明確技術方向或 PoC，方向應該轉向 CITD／SBIR／研發轉型評估，不是繼續停留在 19+1 診斷。",
        usefulQuestions: ["目前對 AI 或自動化的應用場景，是已經有明確方向，還是還不確定可以用在哪裡？"],
      },
    ],
  },
  {
    key: "erp",
    displayName: "ERP／生產管理",
    // 見對話中「二：先 inspect 真實服務資料」實際 inspect client/src/pages/
    // ErpOptimization.tsx 的結果：這個服務其實有三種對等的切入路徑（ERP
    // 導入／產線與動線優化／整合改善），不是只有「導入 ERP 系統」，原本的
    // whatItIs 低估了「產線動線優化」這一半，這裡一併修正。
    whatItIs:
      "協助企業盤點並優化生產管理，涵蓋三種切入路徑：ERP 系統導入評估、產線與動線優化、或兩者整合改善；也會視需要一併評估 MES／現場報工這類執行面工具，但這是跟 ERP 不同層面的東西（ERP 管跨部門資料，MES 管現場執行資訊，產線優化管實體流程與動線）。",
    problemsSolved:
      "訂單、庫存、工單、排程仍靠人工或 Excel 管理，容易對不起來、容易漏單，管理者（常常是老闆或老闆娘）每天花大量時間手動排產；或系統雖然有但現場動線、物料流不順，光换系統解決不了問題。",
    triggerScenarios:
      "使用者提到庫存對不起來、工單還是紙本、排程靠人工／老闆娘排、想「智慧化」但問題根源其實是管理系統沒建立、想導 AI 但講的其實是排程或補貨這類 ERP 範疇內的事、提到現場動線或物料流不順、提到報工或現場執行資訊跟後台對不起來。",
    followUpQuestions:
      "目前訂單/庫存/工單是用什麼方式管理（紙本、Excel、舊系統）、最痛的環節是庫存還是排程還是現場動線、規模大概多大（會影響導入複雜度）、是否已經有想清楚要不要順便做智慧排程/預測這類 AI 功能。",
    whenNotToPushEarly:
      "如果使用者講的其實是想單純曝光或找新客戶，不要因為對方提到「系統化」或「效率」就跳去講 ERP。如果使用者已經有成熟系統只是想加 AI 功能，不必重新推整套 ERP 導入。",
    relations: [
      {
        withServiceKey: "gov_subsidy",
        type: "concurrent",
        note:
          "ERP 顧問評估後，可能會判斷企業適合搭配 19+1 AI 診斷輔導或其他政府資源一起做，不是先做完 ERP 才能碰補助——兩者常常可以同時評估、同時進行。",
      },
    ],
    advisorNeedsToUnderstand:
      "企業目前管理方式的痛點在哪個環節、規模與導入急迫性、是否有意願／預算讓 AI 功能整合進 ERP 而不是另外拆一套。",
    serviceScope: [
      "ERP 系統導入評估（訂單、採購、庫存、生產排程、品質紀錄、成本管理報表）",
      "產線與動線優化（物料流、設備佈置、現場動線）",
      "MES／現場報工等執行面工具的評估建議",
      "整合改善：跨部門資料與現場執行資訊的串接",
    ],
    notIncluded:
      "OXM 不是 ERP 或 MES 產品品牌本身（不銷售特定系統），不預設工廠一定要更換現有系統，也不保證固定的改善幅度、導入時程，或保證完全不影響生產——實際做法由顧問依個案盤點後決定。",
  },
  {
    key: "certification",
    displayName: "ISO／低碳認證",
    // 見「二：先 inspect 真實服務資料」實際 inspect client/src/pages/
    // CertificationCenter.tsx＋shared/certificationServices.ts 的服務項目
    // 種子資料，確認目前真實只有 9 個項目、3 個分類，原本的 whatItIs 只提到
    // 「如 ISO 9001」太籠統，這裡列出完整、真實的分類與項目。
    whatItIs:
      "協助企業導入 ISO 管理系統（品質／環境／職安／能源／資安）、組織溫室氣體盤查、產品碳足跡與政府碳標籤，理解流程、時程與準備事項；OXM 本身不核發證書或標籤，實際驗證／核發由第三方或政府單位進行。",
    problemsSolved:
      "企業因為客戶要求、想進入正式供應鏈、或預期未來會被要求而需要相關認證，但不熟悉流程與準備工作。",
    triggerScenarios:
      "客戶明確要求特定認證才能合作、企業提到「沒有證書不能進供應鏈」、想拓展出口客戶或大型企業客戶、對永續／碳盤查有壓力或興趣。",
    followUpQuestions:
      "是哪個客戶／哪個市場要求、目前完全沒有還是已經有部分基礎、急迫程度（有明確截止時間點嗎）、是否只是聽說「以後可能會需要」還是已經被卡單。",
    whenNotToPushEarly:
      "只是使用者自己隨口提到「以後可能要弄」但完全沒有客戶壓力或明確計畫時，不用當成優先項目主動推；除非符合善意提醒規則（見下方），否則不要反覆強調。",
    relations: [],
    advisorNeedsToUnderstand:
      "是哪個客戶／市場的具體要求、企業目前準備度、時間壓力、是否曾經因為缺乏認證而真的流失過訂單或機會。",
    serviceScope: [
      "ISO 管理系統：ISO 9001（品質）、ISO 14001（環境）、ISO 45001（職安）、ISO 50001（能源）、ISO/IEC 27001（資安）",
      "組織溫室氣體盤查（ISO 14064-1，整個組織範圍）",
      "產品碳足跡（ISO 14067，單一產品範圍）",
      "政府碳標籤：產品碳足跡標籤、產品碳足跡減量標籤（通常需先有產品碳足跡）",
    ],
    notIncluded:
      "OXM 不自行核發 ISO 證書、查驗聲明或政府碳標籤（由第三方驗證機構或政府單位核發），也不保證一定取得認證或標籤；目前服務項目不包含 HACCP／FSSC 22000／CE／UL／RoHS／Halal／OEKO-TEX／GOTS／GRS／FSC 等其他驗證，不能說有。",
  },
  {
    key: "short_video",
    displayName: "找形象／短影音／品牌內容",
    // 見「二：先 inspect 真實服務資料」實際 inspect client/src/pages/
    // ShortVideoMarketing.tsx＋shared/shortVideoMarketing.ts：這裡原本的
    // whatItIs 大致準確，補上完整的 5 個可個別選擇的服務項目名稱（KOL合作、
    // 新聞媒體露出、訪談製作原本沒有點名）。
    whatItIs:
      "提供 5 種可單獨選擇或組合的服務：短影音企劃與拍攝、KOL 合作方案、社群內容代操（帳號排程與發布，非廣告投放）、新聞媒體露出、訪談製作，協助企業製作品牌故事、產線／製程實績內容，提升陌生客戶的信任與曝光。",
    problemsSolved:
      "企業技術/實績不錯但網路上幾乎查不到資訊，陌生客戶或採購上網做功課時找不到、不信任；或詢問量夠但成交率低、品牌形象跟不上實際實力。",
    triggerScenarios:
      "使用者說沒有新客戶、想要曝光、想被更多人看到、提到都是靠老客戶介紹、提到網路上沒有公司資訊、提到想讓陌生客戶更信任。",
    followUpQuestions:
      "曝光不足的真正原因是什麼（完全沒人知道、還是有人問但不成交、還是有資格門檻卡住如認證）、目前有沒有任何線上內容、是想要一次性內容還是長期社群經營。",
    whenNotToPushEarly:
      "使用者說「沒有新客戶」時不能直接假設是曝光問題——要先確認是完全沒人知道，還是詢問量夠但因為認證/價格/產能等其他原因不成交，那些情況短影音幫不上真正的忙，不該一開口就推這個方向。",
    relations: [],
    advisorNeedsToUnderstand:
      "企業希望呈現的主軸（創辦人故事／老師傅製程／MIT 理念等）、目前線上資訊現況、是否有社群代操需求、想吸引的客戶輪廓。",
    serviceScope: [
      "短影音企劃與拍攝",
      "KOL 合作方案",
      "社群內容代操（帳號內容排程、文案發布與成效回顧，涵蓋 IG／FB／TikTok／YouTube Shorts）",
      "新聞媒體露出",
      "訪談製作",
    ],
    notIncluded:
      "社群內容代操不等於廣告投放，發布頻率與留言回覆需個別確認；短影音拍攝本身不等於長期社群代操經營（是否包含要另外確認）；KOL 合作不保證訂單或成交；新聞媒體露出不是第三方獨立新聞背書；不包含廣告投放費用；觀看數不代表詢問或成交，無法保證內容爆紅。",
  },
  {
    key: "finance",
    displayName: "企業財務優化",
    // 見「二：先 inspect 真實服務資料」實際 inspect client/src/pages/
    // FinanceOptimization.tsx：原本的 whatItIs 完全漏掉「合法節稅」——這其實
    // 是頁面第一個列出、也出現在頁面標語裡的服務，這裡補齊三項服務。
    whatItIs:
      "提供三項服務：合法節稅（檢視稅務與帳務結構，降低不必要的稅務成本及風險）、融資優化（規劃貸款額度、期限與還款結構，協助銀行對接）、財務結構優化（改善負債與現金流配置），處理因帳期、設備投資等造成的週轉壓力。",
    problemsSolved:
      "訂單穩定但客戶帳期長、或剛做了設備投資導致週轉吃緊，需要更好的融資條件或財務結構調整；或稅務與帳務結構沒有妥善規劃，而不是單純缺訂單。",
    triggerScenarios:
      "使用者提到資金緊、想找補助但背後其實是現金流問題、提到客戶帳期很長、提到供應商要收掉需要資金因應、提到週轉困難、提到稅務負擔重或帳務結構想優化。",
    followUpQuestions:
      "資金壓力的來源是帳期、設備投資、還是訂單本身不穩定、目前有沒有穩定訂單、是否已經有研發或設備升級計畫（會影響應該找補助還是找財務優化）。",
    whenNotToPushEarly:
      "如果對方明明是想拿補助去做具體的研發/設備投資，不要把方向硬拉到財務優化；財務優化適合「訂單穩定、只是資金結構或稅務卡住」這種情況，不是萬用答案。",
    relations: [
      {
        withServiceKey: "gov_subsidy",
        type: "sequential",
        note: "如果企業其實是想找補助但真正卡點是現金流而非研發資金，通常應該先看財務優化，而不是硬找補助方案。",
      },
    ],
    advisorNeedsToUnderstand:
      "資金壓力的具體來源、訂單穩定度、客戶帳期狀況、是否有既有融資、明確的資金需求金額感受。",
    serviceScope: [
      "合法節稅（檢視稅務與帳務結構）",
      "融資優化（貸款額度、期限、還款結構規劃，協助銀行對接）",
      "財務結構優化（負債與現金流配置改善）",
    ],
    notIncluded:
      "OXM 不代辦記帳或稅務申報本身，也不保證融資核准或特定利率／額度，實際條件由銀行與個案財務狀況決定；諮詢初期只收基本聯絡資訊，詳細財務狀況會由顧問後續了解，不是先在表單裡填。",
  },
  {
    key: "factory_search",
    displayName: "找工廠",
    whatItIs: "協助企業在 OXM 平台上尋找符合條件的製造工廠合作夥伴（例如原供應商流失後找替代或備援）。",
    problemsSolved: "企業需要新的代工/製造合作對象，例如原供應商要收掉、想找特殊製程或材料的工廠、想建立備援供應鏈。",
    triggerScenarios:
      "使用者提到原供應商要收了、想找新的代工廠、需要特定製程或材料的工廠、想建立第二供應商備援。",
    followUpQuestions:
      "需要什麼製程/材料、地區偏好、大概數量或規模、是想找單一替代還是要建立長期備援、有沒有特殊資格要求（如認證）。",
    whenNotToPushEarly: "使用者只是好奇問問、沒有實際尋源需求時，不用直接進入搜尋動作，先自然確認需求是否明確。",
    relations: [],
    advisorNeedsToUnderstand: "需要的製程/材料、地區、數量規模、特殊要求、尋源急迫程度。",
  },
  {
    key: "news",
    displayName: "找消息",
    whatItIs: "OXM 的產業新聞／資訊看板，提供產業趨勢、法規、展會、補助公告等最新資訊。",
    problemsSolved: "企業想掌握產業動態、政策異動、展會或補助公告，但沒有時間自己四處查。",
    triggerScenarios: "使用者提到想了解產業趨勢、想知道最新法規或補助公告、想知道同業在做什麼。",
    followUpQuestions: "想關注哪個產業別或主題、是想要一次性資訊還是long-term持續追蹤。",
    whenNotToPushEarly: "不是主要診斷方向，通常是輔助性質，不需要主動深入追問，提到即可。",
    relations: [],
    advisorNeedsToUnderstand: "使用者關注的產業/主題範圍。",
  },
];

export function getServiceDefinition(key: string): ServiceDefinition | undefined {
  return AI_SERVICE_REGISTRY.find(s => s.key === key);
}

/**
 * Phase 7.1（見對話中「Program display name 必須 server-authoritative」）：
 * govSubsidyRecommendation.primaryProgramKey／secondaryProgramKey 轉成使用者
 * 看得懂的方案名稱時，唯一來源是這裡的 gov_subsidy.govSubsidyPrograms，前端
 * 不得自己硬寫 key → 名稱的對照表，避免名稱漂移。
 */
export function getGovSubsidyProgramDisplayName(programKey: string): string | null {
  const govSubsidy = getServiceDefinition("gov_subsidy");
  return govSubsidy?.govSubsidyPrograms?.find(p => p.key === programKey)?.name ?? null;
}
