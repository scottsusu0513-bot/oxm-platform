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
    govSubsidyPrograms: [
      {
        key: "sbir",
        name: "SBIR",
        profile:
          "偏創新研發：新產品、新技術、新服務，創新性與研發標的本身是否夠新穎、夠有技術含量是重點。",
      },
      {
        key: "citd",
        name: "CITD",
        profile:
          "偏傳統／製造業導向的新產品、新技術、新製程、技術升級，比 SBIR 更貼近既有製造業能力的延伸提升，不強求前沿創新性。",
      },
      {
        key: "siir",
        name: "SIIR",
        profile:
          "偏新服務、新商業模式、服務流程或平台／服務創新，重點不是製造技術本身，而是服務或商業模式的創新。",
      },
      {
        key: "transformation",
        name: "研發轉型",
        profile:
          "偏製造業因政策或市場衝擊（例如關稅、客戶流失、供應鏈重組）後需要進行技術、設備、數位化、綠色轉型等整體轉型。當年度實際硬性資格條件必須以官方最新公告為準，AI 不可捏造細節門檻。",
      },
      {
        key: "overseas_expansion",
        name: "海外市場拓展與通路布局",
        profile:
          "適合產品已有一定成熟度、準備真正建立海外代理、經銷、展示、倉儲或維修／服務據點的企業，而不是單純想去參展或探路的階段。",
      },
      {
        key: "manufacturing_19plus1",
        name: "製造業 19+1 AI 診斷輔導",
        profile:
          "官方正式名稱為「產業競爭力輔導團」（俗稱／措施一即為「19+1」），主辦為經濟部（產業發展署），主要委辦執行單位為工業技術研究院（ITRI），適用對象以依法登記之製造業為核心（也延伸至部分服務業）。" +
          "這不是 SBIR／CITD 那種「企業提出計畫、直接拿一筆研發補助款」的機制，而是製造業 AI／數位轉型的前段診斷入口：由專業輔導團隊進駐盤點企業現況、流程、資料基礎、AI 成熟度與痛點，產出一份「AI 導入與轉型建議報告」，官方建議診斷完成時間不超過 4 個月。" +
          "經費結構：每案由政府支付 19 萬元輔導診斷費＋3.15 萬元行政作業費（皆為政府負擔，非企業支出），企業自籌 1 萬元——不可以說成「企業付 1 萬就拿到 19 萬現金」，因為主要是專業診斷／輔導資源，不是撥款給企業的現金。" +
          "後續（屬於接續階段、不是與診斷同時發放）：AI 工具導入資源最高約 10 萬元、AI 人才培訓資源最高約 12 萬元；再往後若要走研發轉型，個案最高約 500 萬元、產業聯盟最高約 4,000 萬元（企業自籌需超過 50%）。三個階段是分開的接續資源，不可以簡化成「企業一次拿到 42 萬現金」這種講法。" +
          "重要限制：曾於 114 年度接受「16+4」（智慧化＋低碳化）輔導的廠商，不得再申請 115－116 年度「19+1」（措施一）輔導；除此排除規則外，官方明確表示申請本案診斷輔導不影響其他政府補助計畫申請，兩者可併行，不是互斥關係。" +
          "適用時機判斷：若企業對 AI 場景仍模糊、講得出想做 AI／自動化但不知道真正該從哪裡切入，19+1 的優先度可以很高；若企業已經有清楚的研發標的、已完成 PoC、要把演算法或技術整合成正式產品，應該進一步往 CITD／SBIR／研發轉型方向思考，而不是停留在 19+1 診斷階段；若企業真正問題是庫存、工單、排程等基礎管理，不能只因為使用者說「想做 AI」就直接推 19+1，要先評估 ERP 是否才是主要承載系統，AI 功能是否可能直接整合在 ERP 中。" +
          "資料年度與來源：115 年度（2026 年），資料來源為經濟部產業競爭力輔導團官方網站（eii.nat.gov.tw/moeai-plus）。這是會逐年變動的政府計畫，AI 給出方向後仍必須交由真人顧問依當下最新公告確認實際資格與金額，不可把本段內容當成當年度以後永遠有效的保證。",
      },
    ],
  },
  {
    key: "erp",
    displayName: "ERP／生產管理",
    whatItIs:
      "協助企業導入或優化 ERP（訂單、工單、庫存、生產排程等系統化管理），評估是否需要智慧排程、預測、自動化等進階功能。",
    problemsSolved:
      "訂單、庫存、工單、排程仍靠人工或 Excel 管理，容易對不起來、容易漏單，管理者（常常是老闆或老闆娘）每天花大量時間手動排產。",
    triggerScenarios:
      "使用者提到庫存對不起來、工單還是紙本、排程靠人工／老闆娘排、想「智慧化」但問題根源其實是管理系統沒建立、想導 AI 但講的其實是排程或補貨這類 ERP 範疇內的事。",
    followUpQuestions:
      "目前訂單/庫存/工單是用什麼方式管理（紙本、Excel、舊系統）、最痛的環節是庫存還是排程還是兩者都是、規模大概多大（會影響導入複雜度）、是否已經有想清楚要不要順便做智慧排程/預測這類 AI 功能。",
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
  },
  {
    key: "certification",
    displayName: "ISO／低碳認證",
    whatItIs: "協助企業導入 ISO（如 ISO 9001）、碳盤查等認證，理解流程、時程與準備事項。",
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
  },
  {
    key: "short_video",
    displayName: "找形象／短影音／品牌內容",
    whatItIs: "協助企業製作品牌故事、產線／製程實績內容、短影音，或提供社群代操，提升陌生客戶的信任與曝光。",
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
  },
  {
    key: "finance",
    displayName: "企業財務優化",
    whatItIs: "協助企業改善融資額度、銀行條件、現金流結構，處理因帳期、設備投資等造成的週轉壓力。",
    problemsSolved:
      "訂單穩定但客戶帳期長、或剛做了設備投資導致週轉吃緊，需要更好的融資條件或財務結構調整，而不是單純缺訂單。",
    triggerScenarios:
      "使用者提到資金緊、想找補助但背後其實是現金流問題、提到客戶帳期很長、提到供應商要收掉需要資金因應、提到週轉困難。",
    followUpQuestions:
      "資金壓力的來源是帳期、設備投資、還是訂單本身不穩定、目前有沒有穩定訂單、是否已經有研發或設備升級計畫（會影響應該找補助還是找財務優化）。",
    whenNotToPushEarly:
      "如果對方明明是想拿補助去做具體的研發/設備投資，不要把方向硬拉到財務優化；財務優化適合「訂單穩定、只是資金結構卡住」這種情況，不是萬用答案。",
    relations: [
      {
        withServiceKey: "gov_subsidy",
        type: "sequential",
        note: "如果企業其實是想找補助但真正卡點是現金流而非研發資金，通常應該先看財務優化，而不是硬找補助方案。",
      },
    ],
    advisorNeedsToUnderstand:
      "資金壓力的具體來源、訂單穩定度、客戶帳期狀況、是否有既有融資、明確的資金需求金額感受。",
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
