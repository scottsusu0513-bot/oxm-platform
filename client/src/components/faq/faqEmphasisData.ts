import type { FaqEmphasisRange } from "./FaqEmphasis";

/**
 * FAQ 回答內文的人工黃色標記重點範圍，逐一對應 shared/content/faq.ts 的
 * answerParagraphs 原文子字串——只決定「哪一段文字要變成 OXM 橘／紫粗體」，
 * 不改動、不新增、不刪除任何一個字。
 *
 * 用色慣例（非嚴格規則，僅供交錯時保持一致）：
 * - orange：核心問題／風險／警示句
 * - purple：解法／價值主張／結論性洞察
 *
 * key 為 shared/content/faq.ts 的 FaqQuestion.id。
 */
export const FAQ_EMPHASIS: Record<string, FaqEmphasisRange[]> = {
  "market-1": [
    { text: "不是市場上沒有需求，而是過去傳統產業習慣依賴的接單方式，正在逐漸失去效果。", tone: "orange" },
    { text: "長期依靠熟客、同業介紹、業務人脈、工會或展會建立訂單來源。", tone: "orange" },
    { text: "當客戶開始外移、採購方式改變、產業世代交替", tone: "orange" },
    { text: "新的需求不一定會再透過原本的人脈體系出現。", tone: "orange" },
    { text: "市場上不是沒有工廠", tone: "orange" },
    { text: "工廠資訊分散、能力難以快速判斷", tone: "orange" },
    { text: "當市場出現需求時，對方能不能找到你、理解你，並快速判斷你是不是適合的合作對象。", tone: "purple" },
  ],
  "market-2": [
    { text: "台灣製造真正有價值的地方", tone: "purple" },
    { text: "製程穩定度、品質管理、交期彈性、客製能力", tone: "purple" },
    { text: "工程溝通、少量生產", tone: "purple" },
    { text: "出現問題後能否快速處理", tone: "purple" },
    { text: "工廠需要思考的不只是「價格能不能再低」", tone: "orange" },
    { text: "你最擅長解決哪一類製造需求？", tone: "purple" },
    { text: "哪些製程、材料或產品是你的強項？", tone: "purple" },
    { text: "真正需要避免的，是把原本具有差異化的台灣製造能力，最後變成只剩下比價。", tone: "orange" },
  ],
  "market-3": [
    { text: "「有能力」和「市場看得懂你的能力」是兩件不同的事情。", tone: "orange" },
    { text: "對第一次接觸的採購人員而言，仍然很難判斷", tone: "orange" },
    { text: "這間工廠到底擅長什麼？", tone: "orange" },
    { text: "工廠曝光的重點因此不應只是「被看到」，而是要讓需求方能在短時間內理解你的製造能力。", tone: "purple" },
    { text: "真正有效的曝光，是降低採購方判斷你是否適合的成本。", tone: "purple" },
  ],
  "market-4": [
    { text: "熟客與介紹本身不是問題", tone: "orange" },
    { text: "它甚至是最重要、品質最高的訂單來源", tone: "purple" },
    { text: "真正的風險在於：它如果成為唯一的訂單來源。", tone: "orange" },
    { text: "當營收高度集中在少數客戶", tone: "orange" },
    { text: "受到客戶轉單、價格談判、產業景氣、負責人退休甚至供應鏈外移影響。", tone: "orange" },
    { text: "如果工廠過去從來沒有建立新的市場入口", tone: "orange" },
    { text: "等到熟客訂單真的下降時，才會發現不知道應該去哪裡接觸新的客戶。", tone: "orange" },
    { text: "熟客是企業的重要資產，但不能成為企業唯一看得見市場的窗口。", tone: "purple" },
  ],
  "market-5": [
    { text: "當一家合作多年的供應商因為負責人退休、沒有二代接班、產線停產、成本壓力或其他原因退出市場時", tone: "orange" },
    { text: "卻不知道市場上還有誰具有相同或相近的製造能力。", tone: "orange" },
    { text: "這也是傳統供應鏈常見的資訊斷層。", tone: "orange" },
    { text: "供應鏈真正的風險，不只是某一家供應商退出，而是企業直到供應商退出之後，才第一次開始尋找替代方案。", tone: "purple" },
  ],
  "transformation-1": [
    { text: "工廠在訂單開始下降時", tone: "orange" },
    { text: "單純把更多訂單帶進來，不一定能真正改善經營狀況。", tone: "orange" },
    { text: "這不是一個只能二選一的問題。", tone: "purple" },
    { text: "比較合理的做法，是先找出訂單下降的真正原因。", tone: "purple" },
    { text: "企業轉型的第一步，不是先決定要做什麼，而是先確認真正限制企業成長的是市場問題，還是內部能力問題。", tone: "purple" },
  ],
  "transformation-2": [
    { text: "設備升級很重要，但設備本身只是企業能力的一部分。", tone: "orange" },
    { text: "但如果前後製程沒有一起調整、排程方式沒有改變、資料仍然靠人工傳遞、業務接單方式沒有改變，企業整體的經營模式可能還是和以前一樣。", tone: "orange" },
    { text: "有些工廠買了新設備之後，才發現真正的瓶頸根本不在那一道製程。", tone: "orange" },
    { text: "設備投資應該建立在一個更前面的問題上：", tone: "purple" },
    { text: "這筆投資要解決企業現在的哪一個瓶頸？", tone: "purple" },
    { text: "設備升級是工具，真正的轉型是企業整體能力與競爭方式發生改變。", tone: "purple" },
  ],
  "transformation-3": [
    { text: "「知道要轉型」和「知道第一步該做什麼」之間，往往有很大的距離。", tone: "orange" },
    { text: "當所有問題同時出現時，轉型很容易變成一個太大的工程，最後企業就會選擇維持現狀。", tone: "orange" },
    { text: "真正能夠開始的轉型，通常不是一次把所有事情做完，而是先找出最關鍵的一個問題", tone: "purple" },
    { text: "從最小可執行的項目開始。", tone: "purple" },
    { text: "轉型最大的障礙往往不是企業不知道要改變，而是不知道應該從哪一個問題開始。", tone: "purple" },
  ],
  "transformation-4": [
    { text: "沒有一個適合所有工廠的固定順序。", tone: "orange" },
    { text: "因此企業在決定投資順序以前，可以先問三個問題：", tone: "purple" },
    { text: "1. 現在哪一個問題最直接限制營收或獲利？", tone: "purple" },
    { text: "2. 如果這個問題半年都不處理，會造成什麼影響？", tone: "purple" },
    { text: "3. 解決這個問題之後，下一個瓶頸會出現在哪裡？", tone: "purple" },
    { text: "最重要的不是每一件事情都做，而是先把資源放在目前最限制企業成長的那一個瓶頸。", tone: "purple" },
  ],
  "resources-1": [
    { text: "先確認企業真正想改善什麼，再去找適合的補助資源。", tone: "purple" },
    { text: "如果企業連自己要改善的問題、預計投入的項目、預期成果都還不清楚", tone: "orange" },
    { text: "即使最後真的申請成功，也不代表這筆資源一定能替企業創造真正的效益。", tone: "orange" },
    { text: "補助應該是幫助企業完成原本就該做的轉型，而不是因為有補助，才臨時決定要做一個轉型計畫。", tone: "purple" },
  ],
  "resources-2": [
    { text: "企業轉型通常需要一筆不小的資金", tone: "orange" },
    { text: "而且實際支出往往不只是一台設備或一套系統。", tone: "orange" },
    { text: "政府補助的優勢，在於部分符合政策方向的轉型支出有機會獲得政府資源支持，而且補助款本身不需要償還。", tone: "purple" },
    { text: "不一定能涵蓋企業整體轉型所需要的所有資金。", tone: "orange" },
    { text: "銀行融資則不同", tone: "purple" },
    { text: "主要是提供企業更完整的資金彈性，用來支撐設備投資、週轉金或補足補助以外的資金缺口。", tone: "purple" },
    { text: "兩者不一定是二選一。", tone: "purple" },
    { text: "補助解決的是部分轉型成本，融資解決的是資金時間差與資金缺口；真正需要被設計的是企業整體的轉型資金結構。", tone: "purple" },
  ],
  "resources-3": [
    { text: "這些工具處理的是不同問題，所以不應該放在一起比較「哪一個比較重要」。", tone: "orange" },
    { text: "所以企業真正該問的不是：", tone: "purple" },
    { text: "「ERP、ISO、低碳，我現在應該做哪一個？」", tone: "purple" },
    { text: "而是：", tone: "purple" },
    { text: "「目前是哪一個問題，正在限制我的管理效率、客戶信任或市場資格？」", tone: "purple" },
    { text: "工具本身沒有固定的優先順序，真正的優先順序取決於企業現在最需要解決哪一個瓶頸。", tone: "purple" },
  ],
  "about-1": [
    { text: "平台最初從工廠媒合出發，希望讓有製造需求的企業更容易找到適合的台灣工廠", tone: "purple" },
    { text: "但在實際接觸產業之後，OXM 發現企業真正面對的問題，往往不只是一張訂單或一次媒合。", tone: "orange" },
    { text: "OXM 希望做的，不只是幫企業找到一家工廠，而是讓台灣傳統產業在需要合作夥伴、資源或轉型方向時，有一個可以開始尋找答案的入口。", tone: "purple" },
  ],
  "about-2": [
    { text: "OXM 的定位不同。", tone: "purple" },
    { text: "OXM 希望呈現的不只是公司名稱與聯絡方式", tone: "purple" },
    { text: "OXM 更希望解決的是「這家公司能不能成為我適合的合作夥伴，以及企業下一步還需要什麼資源」。", tone: "purple" },
  ],
  "about-3": [
    { text: "因為企業經營遇到的問題很少是單獨存在的。", tone: "orange" },
    { text: "一間工廠訂單減少，背後可能不是單純缺少曝光，也可能與產品競爭力、設備效率、成本結構或市場變化有關。", tone: "orange" },
    { text: "如果每一個問題都必須重新到不同地方尋找資訊與合作對象，企業會花掉大量時間判斷「應該找誰」。", tone: "orange" },
    { text: "並不是希望所有企業都使用所有服務，而是希望企業在遇到不同階段的問題時，可以更快找到對應的資源。", tone: "purple" },
    { text: "OXM 想整合的不是一堆服務，而是企業從找訂單、找供應鏈到真正開始轉型時，沿途會遇到的不同問題。", tone: "purple" },
  ],
  "about-4": [
    { text: "OXM 最想解決的，是台灣傳統產業長期存在的「資訊與資源斷層」。", tone: "orange" },
    { text: "OXM 希望逐步把這些原本分散的資訊與資源連接起來。", tone: "purple" },
    { text: "OXM 想做的，是在原本彼此分散的台灣產業之間，建立一個更容易找到彼此、也更容易找到下一步資源的入口。", tone: "purple" },
  ],
};
