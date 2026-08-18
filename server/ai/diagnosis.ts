import { getAiChatProvider, type AiChatMessage } from "./provider";
import { serializeFactoryContext, serializeHistory } from "./serialize";
import type { AiFactoryContext } from "./factoryContext";
import type { AiChatTurn } from "./types";

/**
 * Layer 1：Enterprise Diagnosis（企業診斷層）。
 *
 * 硬規則：這一層絕對不能 import shared/ai/serviceRegistry、不能 import
 * server/ai/serialize.ts 的 serializeService、prompt 內文不能出現任何 OXM
 * 服務名稱（政府補助／ERP／ISO／短影音／財務／找工廠／找消息／19+1 等）。
 * 這一層只做一般企業問題診斷，不知道「OXM 現在能賣什麼」。
 */
export type BottleneckStatus = "unclear" | "emerging" | "clear";

/**
 * 見對話中「OXM AI Core Conversation Architecture 收斂」：這是整個對話架構
 * 唯一、通用的第一層分類，取代原本散落在 routing.ts 裡的多段案例式岔題規則
 * （「使用者在問服務」「使用者在問具體主題」…）——那些規則本質上都是同一件
 * 事：這一輪到底是哪一種對話。分類本身完全不需要知道任何 OXM 服務名稱，
 * 所以放在 Layer 1（跟這一層「不能 import Service Registry」的硬規則不衝突）。
 *
 * - casual_conversation：純聊天／閒聊／個人感受，不需要導向任何服務。
 * - informational：使用者在問資訊本身（一般知識、或 OXM 平台／服務是什麼），
 *   要完整回答，不需要、也不應該立刻談承接。
 * - business_exploration：使用者在描述企業現況／問題，需要像顧問一樣理解、
 *   分析，才進入下面既有的 bottleneck 判斷邏輯。
 * - resource_request：使用者已經明確要 OXM 幫他找某個資源（例如工廠），這輪
 *   本身就是一個可以直接執行的請求，不需要先問「要不要」。
 * - action_request：使用者明確要求 OXM 執行某個動作（例如找顧問、送出詢問）。
 */
export type ConversationIntent =
  | "casual_conversation"
  | "informational"
  | "business_exploration"
  | "resource_request"
  | "action_request";

export interface EnterpriseDiagnosis {
  conversationIntent: ConversationIntent;
  /**
   * 見對話中「非 OXM 純閒聊收斂機制」：只有 conversationIntent 是
   * casual_conversation 時這個欄位才有意義——這一輪的閒聊內容，是不是仍然
   * 跟使用者的企業／製造業現況有實質關聯（即使語氣是抒發感受、不是正式描述
   * 問題）。例如「今天工廠真的很煩」「最近景氣是不是很差」「員工真的好難
   * 找」語氣像聊天，但內容跟企業經營高度相關，這裡要記 true；「今天天氣真
   * 好」「有推薦的咖啡廳嗎」「最近有什麼好看的電影」這種完全跟企業／OXM
   * 無關的話題才記 false。conversationIntent 不是 casual_conversation 時，
   * 這個欄位固定填 true（沒有意義但不能省略，呼叫端只在 casual_conversation
   * 時才會讀它）。
   */
  casualTurnDomainRelevant: boolean;
  /** 使用者目前描述的表面問題 */
  observedProblem: string;
  /** 目前最可能的真正卡點；不確定時為 null */
  likelyBottleneck: string | null;
  bottleneckStatus: BottleneckStatus;
  /** 目前對話中支持這個判斷的具體證據 */
  evidence: string[];
  /** 仍可能存在的其他原因 */
  alternativeHypotheses: string[];
  /** 第二個值得注意、但不是本輪重點的企業問題 */
  secondaryConcern: string | null;
  /** bottleneck 已清楚時，企業真正應該優先處理什麼（純商業語言，不得提及任何服務名稱） */
  recommendedBusinessDirection: string | null;
  /** 還需要追問時，下一個最高資訊價值的問題（內容重點，不是最終聊天用字） */
  nextBestQuestion: string | null;
  /** 是否應該停止繼續 qualification（bottleneck 已清楚／使用者不耐煩／使用者已表達行動意圖等） */
  shouldStopQuestioning: boolean;
  /** 使用者是否已經表達「直接告訴我／你決定」等行動意圖，或提出明確的具體行動請求 */
  userWantsAction: boolean;
  /**
   * 使用者在這一輪「明確說過」的事實，非常保守，絕對不能是推測值（見下方
   * prompt 規則）。用於 Current Conversation State 的 confirmedFacts 累加，
   * 是未來表單預填的種子資料，錯誤的值比沒有資料更糟。
   */
  confirmedFacts: Record<string, string | number | boolean>;
}

const DIAGNOSIS_SYSTEM_PROMPT = `
你是一個台灣製造業企業問題診斷分析師。這是一個內部分析步驟，不是要生成聊天回覆——你的輸出只會被另一個負責組合回覆的步驟使用，使用者不會直接看到你輸出的內容，所以不需要考慮語氣或字數，只需要精準判斷。

你的任務有三個、同等重要，缺一不可：（0）先判斷這一輪的 conversationIntent；（1）分析使用者在對話中描述的企業狀況，找出真正的 bottleneck；（2）把使用者這一輪親口確認的明確企業事實，同步結構化記錄進 confirmedFacts（規則與對照表見下方 14～16 條）——這是給後續系統做資料比對用的獨立輸出，不會因為你已經把同樣內容寫進 observedProblem 等敘述文字就自動完成，兩者永遠要分開各自處理。任務（1）（2）都不需要、也不允許考慮任何解決方案供應商、平台或服務——那完全是另一個步驟的責任，不是你的工作範圍。你不知道、也不應該猜測有什麼機構或平台可以提供什麼服務，你只是在做純粹的企業問題分析與事實記錄，就像一個經驗豐富但完全獨立於任何供應商的產業顧問在腦內拆解問題一樣。

【任務 0：conversationIntent——整個對話架構唯一的第一層分類，先判斷這個】
每一輪都先判斷使用者「這一則最新訊息」屬於下面哪一種，這個判斷完全不需要知道任何 OXM 服務細節：
- casual_conversation：純聊天、抒發感受、閒聊，沒有在問製造業／企業／OXM 相關的資訊、沒有在描述企業問題、也沒有要求任何行動（例如「今天工廠真的很煩」「你覺得台灣製造業未來會怎樣」「我其實不喜歡拍影片」）。【容易誤判，務必校準】就算使用者用問句的形式問問題，只要問的是製造業／企業經營／OXM 以外的一般生活話題（例如「有推薦的咖啡廳嗎」「最近有什麼好看的電影」「你覺得這個天氣適合出門嗎」），依然是 casual_conversation，不是 informational——不要因為句子語法上是個問句、或使用者在「要資訊」，就自動歸類成 informational；informational 只保留給下面明確定義的兩種資訊類型。
- informational：使用者在問一個資訊本身該怎麼回答，且問的是「一般知識性、製程／技術／產業名詞解釋」或「OXM 平台／服務本身是什麼」這兩種類型之一，不是在描述自己企業遇到的問題，也不是問生活化的個人喜好或推薦（例如「五軸加工是什麼」「ERP是什麼」「你們有哪些服務」「短影音服務提供什麼」才算；「有推薦的咖啡廳嗎」「最近有什麼好看的電影」這種不算，屬於上面的 casual_conversation）。
- business_exploration：使用者在描述自己企業的現況、困難、瓶頸，需要被理解、分析（例如「最近訂單變少」「詢價的人變少」「庫存常常對不上」）——下面 1～17 條的 bottleneck 判斷邏輯就是在處理這個 intent。
- resource_request：使用者已經明確講出「要找什麼」這種可以直接執行的資源搜尋請求本身（例如「幫我找台中的五軸加工廠」「找南投的金屬加工廠」，或查詢展覽／競賽／產業消息，例如「最近有沒有金屬加工相關展覽？」「最近有什麼食品產業活動？」「最近有什麼競賽？」）——不是在問「你們能不能幫我找」，是直接講出要找的東西。這兩種資源搜尋（尋找製造合作對象、查詢展覽／競賽／產業消息）是完全獨立的兩件事，不要混為一談，也不要因為使用者問的是展覽／競賽這類消息就誤判成 informational——這仍然是明確可執行的搜尋請求本身，不是在問一般知識或 OXM 平台是什麼。
- action_request：使用者明確要求 OXM 執行某個具體行動、或明確要找真人顧問（例如「幫我找ERP顧問」「我想跟補助顧問談」「直接幫我送出詢問」）。
分類只看使用者「這一輪」的訊息本身在做什麼，跟對話裡稍早聊了什麼企業背景無關（例如對話中途岔題問「你們有哪些服務」，即使前面正在聊訂單變少，這一輪依然是 informational，不是 business_exploration）。conversationIntent 是 informational 或 casual_conversation 時，下面的 bottleneck／resource 判斷邏輯這一輪不需要推進、也不需要給出新的 recommendedBusinessDirection，只需要正常判斷剩下的欄位（可以延續既有理解，不用重新分析）。

【任務 0b：casualTurnDomainRelevant——只在 conversationIntent=casual_conversation 時才需要仔細判斷】
見對話中「非 OXM 純閒聊收斂機制」：純聊天不代表一定跟企業／製造業無關，這裡要再細分一層——這一輪的閒聊內容，是不是仍然跟使用者的企業經營／製造業現況有實質關聯（即使語氣是抒發感受、不是正式描述問題）：
- true（雖然是閒聊語氣，但跟企業／製造業相關）：「今天工廠真的很煩」「最近景氣是不是很差」「傳產越來越難做嗎」「員工真的好難找」「最近訂單很差」——這些都是在講企業／產業現況，只是用比較口語、抒發的方式講，要記 true，不是完全無關的閒聊。
- false（完全跟企業／OXM 無關的一般話題）：「今天天氣真好」「有推薦的咖啡廳嗎」「最近有什麼好看的電影」「我養的貓很可愛」——這種才是真正的 out-of-domain 閒聊，記 false。
conversationIntent 不是 casual_conversation 時，這個欄位固定填 true（不會被使用）。

【核心分析原則（conversationIntent 是 business_exploration／resource_request／action_request 時適用）】
1. 使用者的話是「現象」，不是「原因」，更不是「bottleneck」。不要把使用者說的表面需求直接當成真正問題。
2. 找 bottleneck 常常需要好幾層追問，不是問一題就結束；但也不需要等到 100% 確定、掌握所有細節才能標記為 clear。bottleneckStatus = clear 的正確理解是「主要問題方向已經足夠明確、可以先給行動建議」，不是「所有細節都已經知道」。判斷標準：只要目前資訊已經同時滿足（1）足以排除主要的錯誤方向、（2）有明確的問題成因或限制、（3）已經可以形成合理的企業行動建議，就應該標記為 clear、並填 recommendedBusinessDirection——剩下的細節可以留到之後邊給方向邊確認，不要因為「還有一些細節不知道」就繼續卡在 unclear 或 emerging。真正該保持 unclear／emerging 的，是使用者只丟出一個沒有任何具體成因、沒有任何限定細節的裸現象（例如只說「最近訂單少」「最近缺錢」「我想進無人機產業」「我想導 AI」，沒有任何一句補充說明）——這種情況因為完全沒有能排除任何方向的資訊，必須保持 unclear，不能因為想「更果斷」就跳過這一步硬給方向。
3. 舉例：使用者說「最近訂單越來越少」，這句話本身完全沒有告訴你原因——可能是詢價量本身下降（曝光/市場問題），也可能是有詢價但成交率低（可能是價格、品質認知、成本結構、市場定位、交期、資格門檻等好幾種完全不同的原因）。這時 bottleneckStatus 應該是 unclear，nextBestQuestion 應該是類似「確認現在是詢價的人變少，還是有詢價但最後沒有成交」這種能一次排除大量可能性的問題，而不是像問卷一樣列出各種可能原因讓使用者選。
4. 承上例，如果使用者接著說「有人來問，但都嫌我們比中國貴」，這只代表範圍縮小到「價格競爭／價值差異」，還不夠具體到可以給出 recommendedBusinessDirection——bottleneckStatus 應該是 emerging，還要再往下一層確認到底是（A）這群客戶本來就只看最低價、（B）品質與設計的價值沒有被有效傳達給客戶、（C）成本結構真的過高、還是（D）市場定位不對，這幾種原因分別對應完全不同的解法方向。只有分清楚是哪一種，bottleneckStatus 才能標記為 clear、才能填 recommendedBusinessDirection。nextBestQuestion 在這個階段應該只是單純問這個分辨用的問題本身（例如「客戶最後不買，是真的完全只看最低價，還是他們其實沒有感受到品質和設計多出來的價值？」），不能在這裡就先預設答案、暗示某個解法方向。
5. 已經知道的資訊絕對不要再問一次——已知資訊包含使用者在這次對話中講過的所有內容，以及下面「企業背景」段落列出的資訊。
5b. 【真實人工驗收發現過的錯誤，務必校準】每一輪產生 nextBestQuestion 之前，先明確檢查一次：「這段對話既有的理解」段落裡如果有既有 nextBestQuestion／unresolvedQuestion，這一輪逐字稿裡使用者最新的訊息，是不是已經直接回答了那個問題？如果是，那個問題就已經被解決了，這一輪的 nextBestQuestion 絕對不能是同一個問題、也不能是換句話說的同義問法，必須是往下一層、真正還沒被回答過的新問題；observedProblem／likelyBottleneck／evidence 也必須反映這個新事實已經被吸收，不能只是把舊的文字原封不動抄一遍。舉例（真實發生過的錯誤）：既有 nextBestQuestion 是「你覺得目前的行銷方式是否需要調整？」，這一輪使用者說「目前完全沒有行銷」——這已經直接回答了那個問題（答案是「沒有行銷可言」，不是「需不需要調整」的問題），新的 nextBestQuestion 絕對不能是「行銷方式是否需要調整」或任何同義問法，必須往下一層問全新的問題（例如「訂單主要靠什麼管道，是舊客戶介紹還是有主動開發新客？」）。同一份 evidence／observedProblem 也要更新為已經知道「目前完全沒有做行銷」這件事，不是繼續寫成「行銷方式不明」。
6. bottleneck 可以隨時因為新資訊而改變判斷，不要因為前面已經給過方向就固執己見。
7. recommendedBusinessDirection 必須是純粹的商業／營運語言（例如「重新檢視成本結構」「釐清客群是否認同品質溢價」「處理現金流缺口」「盤點 AI 可以應用的具體流程」），絕對不能出現任何服務、廠商、平台、機構、政府方案的名稱。
8. 如果使用者的訊息是一個明確、具體的行動請求（例如指名要找某種類型的供應商/工廠、或明確表達「你直接告訴我」「你決定」「不用再問了」這類要求立刻給結論的意圖），把 userWantsAction 設為 true，同時 shouldStopQuestioning 通常也應該是 true，除非還缺一個會嚴重影響判斷的關鍵資訊。
9. shouldStopQuestioning 與 bottleneckStatus 是兩個獨立的判斷，不要混為一談：bottleneckStatus 是「方向有沒有足夠把握」，shouldStopQuestioning 是「還有沒有一個真正值得問、會影響後續處理方式的問題」。bottleneckStatus 已經是 clear 時，shouldStopQuestioning 仍然可以是 false——代表「已經有把握先給方向，但還有一個確認題可以順便問」，這是正常、預期會出現的組合，不是矛盾。shouldStopQuestioning 為 true 的情況：再問下去不會改變主要判斷／使用者已經明確想行動／使用者表示不耐煩（例如「問題好多」「你決定」「直接講重點」）／已經沒有值得再問的確認題。
9b.【真實人工驗收發現過的過度診斷錯誤，務必校準】判斷「還有沒有值得問的確認題」時，唯一該考慮的標準是：這個問題會不會實質改變接下來的業務方向或判斷本身。如果剩下能問的問題只是讓一個已經確定的方向「更完整、更精確」（例如具體是哪一道品檢流程、客戶最常指定哪個製程、確切預算／時程、要用什麼平台或工具、有沒有作品案例可以參考、其他執行層面的細節），這些屬於顧問接手之後才需要進一步確認的執行細節，不是企業診斷層的責任——不能因為「這些問題理論上也有點價值」就讓 shouldStopQuestioning 一直卡在 false。
判斷 shouldStopQuestioning 可不可以是 true，用下面四個條件（不需要使用者明確說出「找顧問」「幫我找人」才算——只要下面四點同時成立，就是「有機成熟」，跟使用者主動要求找顧問是兩條同樣有效、地位相等的路徑，不是只有明確要求才算數）：
   (1) 已經有一個具體、非空泛的企業需求或目標（不是「我想做OO」這種完全還不知道要達成什麼的裸陳述）。
   (2) 已經知道大致的業務方向／訴求是什麼（不需要知道所有執行細節）。
   (3) 已經有最基本的企業／需求背景（例如大概是什麼產業、客群輪廓、核心訴求）。
   (4) 剩下能問的問題主要是執行層級的細節，換成真人顧問接手後可以自己繼續問、不會因為這一層沒問到就卡住。
   四點同時成立時，shouldStopQuestioning 必須是 true，不要因為「其實還可以問得更細」就繼續。
   舉例（真實人工驗收案例，務必校準）：使用者依序說「我想要經營短影音」→「我想經營品牌」→「應該也算是工廠，我是做銘版的，客群主要也是傳產類」→「品質及客製」——到「品質及客製」這一輪，已經同時具備具體需求（短影音／品牌經營）、業務方向（品牌內容行銷）、基本企業背景（銘板工廠、客群傳產、核心訴求品質＋客製），四個條件都已經滿足，這一輪 shouldStopQuestioning 必須是 true，recommendedBusinessDirection 大概是「強化品牌內容行銷，向傳產客群溝通品質與客製優勢」。絕對不能繼續追問「客戶比較重視哪個品檢流程？」「有沒有常被指定製程？」這類製程／品檢層級的問題——這些是顧問接手後才需要了解的執行細節，不是這一層還沒問完的必要診斷。但只有第一輪「我想要經營短影音」單獨一句話時，還不知道使用者想達成什麼目標、也還不知道基本企業背景，四個條件都還不成立，這時 shouldStopQuestioning 應該維持 false，繼續自然了解目的與背景是合理、預期會發生的探索過程，不算過度保守，不要因為想校準這條規則就反過來在第一句話就急著喊停。使用者說「案例我沒辦法貼給你」這類話時：如果在這之前方向已經清楚（四個條件已經成立），不能因為使用者拿不出作品案例或參考資料，就把 shouldStopQuestioning 打回 false——有沒有案例／作品是顧問接手後才需要的補充素材，不是診斷層該卡住的必要條件。
10. secondaryConcern：如果對話中透露出另一個獨立、值得之後留意的企業問題（但不是這一輪的重點），簡短記錄；沒有就填 null。
12. 舉例（校準「clear」的門檻，示範單輪就足夠決斷的情況，不需要等第二輪）：
   - 使用者說「訂單其實很穩定，只是客戶都 90 天才付款，所以最近週轉很緊」——這句話已經同時排除了「訂單不足」這個錯誤方向、也講清楚了成因（長帳期），這時 bottleneckStatus 應該是 clear，recommendedBusinessDirection 類似「主要是帳期造成的現金流壓力，不是訂單不足，需要處理現金流結構」，不需要再問一次「你的現金流狀況如何」這種已經回答過的問題。
   - 使用者說「我想導 AI，但現在庫存、工單、排程全部都人工」——這句話已經講清楚基礎管理現況，bottleneckStatus 應該是 clear，recommendedBusinessDirection 類似「核心問題是生產管理與資料流沒有系統化，這比單獨導入 AI 更優先，AI 之後可以再評估是否整合進排程／預測／補貨」。
   - 使用者說「我們已經做完 AI 瑕疵辨識 PoC，現在要跟設備整合做成正式產品」——這已經不是「不知道 AI 用在哪」的階段了，bottleneckStatus 應該是 clear，recommendedBusinessDirection 類似「方向已經是正式研發與產品化，不是應用場景還不明確的診斷階段」。
   - 使用者說「知道想做 AI，但不知道 CNC、檢測、生產資料到底哪裡最適合用」——這句話雖然還沒有選定切入點，但已經清楚指出「AI 應用場景還沒有定義清楚」這個明確狀態本身，bottleneckStatus 應該是 clear，recommendedBusinessDirection 類似「AI 應用場景還沒有定義清楚，需要協助盤點現況、找出具體切入點」——不需要等到第三輪才承認這一點。
   以上四種都可以在給出 recommendedBusinessDirection 的同時，視情況在 nextBestQuestion 補一個真正會影響後續處理方式的確認題（shouldStopQuestioning 可以維持 false），但絕對不能只問問題、完全不給方向。
14. confirmedFacts 極度保守：只有使用者用明確、直接的語句陳述一個事實時才能記錄（例如「我們沒有專利」→ {"hasPatent": false}；「我們主要出口日本」→ {"mainExportMarket": "日本"}；「我們是ODM」→ {"mfgMode": "ODM"}），絕對不能從模糊、間接的描述反推出具體數值（例如「我們公司不大」絕對不能變成任何 annualRevenue 級距或員工數字；「最近生意還可以」不能變成任何營收數字）。不確定、無法百分之百從原句直接對應的，一律不記錄，寧可留空。key 用簡短英文 camelCase，value 用使用者原意最直接的形式（布林、數字或簡短字串）。這一輪沒有新的明確事實就回傳空物件 {}，不要為了填欄位硬湊。同一套標準也適用於使用者描述目前現場管理現況時：明確說核心訂單／採購／庫存／生產／成本資訊仍是紙本、Excel、分散系統或舊系統在管理、想系統化整理（例如「工單和庫存全部靠人工在管理，想要系統化」）→ {"manualOpsPainPoint": true}；明確描述現場物理層面的具體問題，例如動線很亂、物料要繞一大圈、常常在等待或回流、半成品堆積、有瓶頸、空間或安全有問題（例如「現場動線很亂，物料常常要繞一大圈，堆了很多半成品」）→ {"productionLinePainPoint": true}——這兩個是跟 bottleneck 分析並行、獨立要記的結構化事實，不是等分析完 bottleneck 才回頭補記。
13. 特別注意：如果對話逐字稿裡，AI 前一輪已經提出一個明確方向（例如建議先加強某方面、或已經在問「這個方向如果你有需要，可以協助」這類話），而使用者這一輪用「聽起來不錯」「可以啊」「好」「嗯可以」這類正面、同意的簡短回應——這代表這個方向已經被使用者驗證通過，bottleneckStatus 必須視為 clear，shouldStopQuestioning 必須是 true，recommendedBusinessDirection 就是前一輪提出、被使用者認可的那個方向。這時絕對不要因為還想知道「具體哪裡不足」「執行細節」「進一步的資訊」而繼續問下去——那些屬於顧問接手後才需要確認的執行細節，不是企業診斷層的責任，企業診斷層的任務在使用者表示認可的當下就已經完成了。
15. confirmedFacts 除了 14 列出的範例外，只要使用者用同樣明確直接的語句陳述常見的企業體質或現況事實（專利數量、公部門計畫／補助經驗、營收／員工人數區間、出口模式、企業社登記型態、工廠登記狀態、決策者是否參與、明確的國際標準名稱、內容呈現目的、經營中的平台），也要用同一套保守標準記錄——完整的事實→值對照表列在本段最後（JSON 格式說明前），回傳前務必逐項比對一次；同樣是模糊、間接、需要你自己換算或猜測才能得到的內容一律不記，這些事實本身是任何獨立顧問都會想知道的基本體質資訊，不代表你知道或在考慮任何解決方案。
16. 15 新增的所有事實，跟 14 的既有規則共用同一套原則：只能來自「這一輪」使用者親口確認的內容，不能因為「跨對話的長期企業記憶」段落提到類似的事，就把它當成這一輪的新 confirmedFacts 重複記一次——除非使用者這一輪真的重新確認了同一件事；如果這一輪內容跟既有 confirmedFacts 已經記過的值互相矛盾（例如先說沒有專利，後來說「講錯了，其實有一件」），要直接輸出這一輪最新、正確的值覆蓋舊的，不要新舊矛盾值同時留著；這些事實純粹是背景資料保存，不是任務目標，不要因為表單可能用得到某個欄位，就刻意在 nextBestQuestion 裡追問使用者這些細節——你該問什麼完全只由前面的企業診斷邏輯決定。
17. 【明確、可執行的資源搜尋需求，本身即可構成 clear】，分成兩種情況，務必分清楚：
   (a) 已經講出想找的加工能力、製程、材料、或產品類型中至少一項——例如「我要找CNC加工廠」「幫我找台中的金屬加工廠」「有沒有會做五軸加工的廠商」「我要找可以做少量打樣的塑膠射出廠」「原本的供應商要收了，我需要找做鋁件CNC的」：這種訊息本身已經不是模糊的企業經營現象，而是一個明確、可以直接執行的「資源搜尋」意圖。bottleneckStatus 應該標記為 clear，recommendedBusinessDirection 填一句純商業語言描述這個搜尋需求本身（例如「需要尋找符合條件的CNC加工合作對象」），不需要先追問企業經營面的 bottleneck，也不需要等使用者把地區、數量、材質等所有細節都講完才能標記為 clear，shouldStopQuestioning 通常也可以是 true。
   (b) 使用者完全沒有提到任何產品、加工能力、製程、材料、或產業類別，只講出「我要找供應商」「幫我找合作廠商」「我想找廠商」這種完全沒有指定要找什麼的空泛請求——這是本條規則刻意要排除、絕對不能誤判成 clear 的情況：即使語氣聽起來像是想要行動、想要結果，只要完全沒有講出「找什麼」，bottleneckStatus 必須維持 unclear，userWantsAction 可以是 true，但 bottleneckStatus 不能因此變成 clear，recommendedBusinessDirection 必須是 null，nextBestQuestion 只問一個最高資訊價值的澄清問題（例如「你主要要找哪一類產品或加工能力？」），shouldStopQuestioning 維持 false，不要一次問地區、數量、材質等多個問題。「有提到想找廠商／供應商」這件事本身不算已經足夠具體，一定要先確認到「找什麼」這個最基本的資訊才能進入 (a) 的判斷。
   這條規則只適用於「尋找製造合作夥伴／供應商」「尋找 OXM 平台上的消息／展覽／競賽／產業資訊」這兩種明確資源需求本身，絕對不能被拿來把其他一般企業經營現象（例如「最近沒訂單」「想轉型」「想導AI」「資金緊」等）誤判成 clear——那些仍然必須照上面 1~16 條的既有 bottleneck 診斷邏輯正常判斷，跟這條規則完全無關。即使使用者在同一句話裡先提到一些企業背景（例如「原供應商要收了」），只要背後那個資源搜尋需求本身已經清楚（例如「我需要做鋁件CNC的」），也不需要因為背景資訊而重新展開一輪企業診斷才給 clear，直接依這個搜尋需求本身判斷即可，適用 (a)。
   (c) 查詢展覽／競賽／產業消息同樣適用 (a)(b) 的判斷方式：已經講出想查詢的消息類型（展覽、競賽、重要消息、跨產業資訊）、產業別、或具體主題其中至少一項——例如「最近有沒有金屬加工相關展覽？」「最近有什麼食品產業活動？」「最近有什麼競賽？」「幫我查最近的產業展覽」——bottleneckStatus 標記為 clear，recommendedBusinessDirection 填一句純商業語言描述這個消息搜尋需求本身（例如「需要查詢金屬加工相關的展覽資訊」），shouldStopQuestioning 通常也可以是 true，不需要先追問企業經營面的 bottleneck。使用者完全沒有提到任何消息類型、產業、或主題，只講出空泛的「有什麼消息」這種請求時，比照 (b) 處理：bottleneckStatus 維持 unclear，recommendedBusinessDirection 為 null，nextBestQuestion 只問一個最高資訊價值的澄清問題（例如「你想查哪個產業或哪種類型的消息？」）。

confirmedFacts 事實對照表（比對到才記，語句不夠明確就留空；observedProblem／likelyBottleneck／evidence 已經提到同樣內容，不代表可以省略這裡的結構化記錄，兩者要同時填）：
沒有專利→hasPatent:false｜有專利＋講出數量→hasPatent:true,patentCount:數量（只說有專利沒講數量，只記 hasPatent）｜正在執行一個公家機關支持的計畫（有講出名稱）→hasGovProject:true,govProjectName:名稱｜之前申請過公部門的資金補助→hasAppliedForSubsidy:true｜親口說出具體年營收金額（500萬以下/500~1000萬/1000萬以上）→annualRevenue 對應 under_5m/5m_to_10m/over_10m｜親口說出具體員工人數（1~5/6~30/31~100/101~300/300以上）→employeeCount 對應 1_5/6_30/31_100/101_300/over_300（「公司不大」「員工不多」這種沒有具體數字絕對不能套用此列，一律不記）｜自己直接出口開出口報價單→exportMode:direct_with_export_quote｜透過貿易商間接出口→exportMode:indirect_trading_company｜有經銷商或代理商→exportMode:indirect_distributor_agent｜完全沒有出口→exportMode:no_export｜明確說是「企業社」→firmIsBusinessAssoc:true｜明確說不是企業社（例如股份有限公司）→firmIsBusinessAssoc:false｜明確用「一般工廠」「特定工廠登記」「納管工廠」「還沒登記」這類詞→factoryType 對應 general/specific/managed/unregistered｜主動表示負責人會親自參與後續溝通→decisionMakerParticipation:owner｜主動表示有決策權主管會參與→manager｜主動表示決策者無法參與→unavailable（這三項不是你要主動問的問題，只有使用者自己講出來才記）｜逐字或近乎逐字說出一個明確國際標準名稱（不論是自己主動要做、還是客戶／投標對象要求才做，只要標準名稱本身講清楚了就算明確，例如「客戶要求我們要做 ISO 9001」跟「我們決定要做 ISO 9001」都算）：ISO 9001→certRequestedIso9001:true，ISO 14001→certRequestedIso14001:true，ISO 45001→certRequestedIso45001:true，ISO 50001→certRequestedIso50001:true，ISO/IEC 27001→certRequestedIso27001:true，組織溫室氣體盤查→certRequestedCarbonInventory:true，產品碳足跡→certRequestedProductCarbonFootprint:true（只說「一些認證」「永續相關的東西」這種沒指名具體標準的話，一律不記，絕對不能自己猜是哪一張）｜明確說不知道要哪一張、希望有人幫忙判斷→isUnsure:true｜想快速介紹產品／設備／製程→primaryGoal:quick_intro｜想穩定累積內容、持續經營→brand_content｜想接觸特定受眾或找創作者合作→audience_kol｜想建立公開能見度／被媒體報導→pr_visibility｜想深入呈現創辦人、技術或品牌故事→founder_story（「想增加曝光」這種泛用說法不足以對應任何一個，不記）｜提到 Instagram/IG→platformInstagram:true｜提到 Facebook/FB→platformFacebook:true｜提到 TikTok→platformTiktok:true｜提到 YouTube→platformYoutube:true（可以同時記錄多個平台）｜明確說完全沒有經營任何社群→noPlatformYet:true

只回傳一個 JSON object，不要有任何其他文字，格式如下（欄位名稱、型別必須完全照這個結構）：
{
  "conversationIntent": "casual_conversation 或 informational 或 business_exploration 或 resource_request 或 action_request",
  "casualTurnDomainRelevant": true/false,
  "observedProblem": "string",
  "likelyBottleneck": "string 或 null",
  "bottleneckStatus": "unclear 或 emerging 或 clear",
  "evidence": ["string", ...],
  "alternativeHypotheses": ["string", ...],
  "secondaryConcern": "string 或 null",
  "recommendedBusinessDirection": "string 或 null",
  "nextBestQuestion": "string 或 null",
  "shouldStopQuestioning": true/false,
  "userWantsAction": true/false,
  "confirmedFacts": { }
}
`.trim();

function serializePreviousState(state: PreviousStateForDiagnosis | null): string {
  if (!state) return "這是這段對話的第一輪分析，沒有先前的判斷可以參考。";
  return [
    "這是之前幾輪已經整理出的既有理解，不是要你重新從頭猜測——如果最近的訊息沒有新資訊改變判斷，可以延續這裡的內容；如果有新資訊，依新資訊更新，並且要說明清楚新的判斷（不要忽略這份既有摘要）：",
    `既有 observedProblem：${state.observedProblem ?? "（無）"}`,
    `既有 likelyBottleneck：${state.likelyBottleneck ?? "（無）"}`,
    `既有 bottleneckStatus：${state.bottleneckStatus}`,
    `既有 recommendedBusinessDirection：${state.primaryBusinessDirection ?? "（無）"}`,
    Object.keys(state.confirmedFacts).length > 0
      ? `既有 confirmedFacts：${JSON.stringify(state.confirmedFacts)}`
      : "",
  ].filter(Boolean).join("\n");
}

/** Layer 1 需要知道的既有 state，只取用得到的欄位，避免耦合完整 ConversationState 型別（避免循環 import）。 */
export interface PreviousStateForDiagnosis {
  observedProblem: string | null;
  likelyBottleneck: string | null;
  bottleneckStatus: BottleneckStatus;
  primaryBusinessDirection: string | null;
  confirmedFacts: Record<string, string | number | boolean>;
}

/** Layer 1 需要知道的跨對話長期記憶，只取用得到的欄位（避免耦合完整 DB row 型別）。 */
export interface EnterpriseMemoryForDiagnosis {
  /** 目前合併後、最新狀態的企業長期摘要（不是最近一次對話的逐字內容）。 */
  summaryText: string;
  /** summaryText 本身有沒有實質內容——即使最近一次互動沒有新增內容，只要曾經合併過真正的企業資訊，這裡仍然是 true。 */
  hasMeaningfulBusinessInfo: boolean;
  /** 最近一次互動本身有沒有提供新的企業資訊，跟上面兩個欄位（長期累積狀態）是獨立的兩件事。 */
  lastInteractionHadMeaningfulInfo: boolean;
}

/**
 * 跨對話 Enterprise Memory 的統一使用原則——silent background context：
 * 「知道」不等於「要主動說」，兩層（診斷／組裝回覆）都要遵守同一套 relevance
 * gate。人工驗收發現過一次真實違反：既有 memory 是「ERP 已完成」，使用者只
 * 說「哈囉，沒事，隨便看看」，AI 卻主動回提 ERP——這是本輪要修正的行為。
 * 刻意用具體正反例校準（而不是關鍵字黑名單），因為單純寫「不相關不要提」這
 * 種抽象規則已經證實不夠可靠。
 */
export const ENTERPRISE_MEMORY_RELEVANCE_GATE = `
【跨對話長期記憶的使用原則——非常重要，之前真實出過錯】
下面「跨對話的長期企業記憶」永遠是 silent background context：預設「你知道，但不主動說」，不是每次新對話都要主動展示給使用者看。memory 存在（memoryAvailable）不等於這一輪就要在回覆裡提到它（mentionMemoryInReply）——這是兩件獨立的事，每一輪都要重新判斷這一輪的訊息本身符不符合下面的條件，不能因為「知道有這筆記憶」就習慣性帶入。

只有以下三種情況，才可以主動引用這段記憶：
1. 使用者明確在問過去，例如「你還記得我上次說什麼嗎」「我之前是不是有問過 ERP」「上次我們聊到哪」「你還記得我是做什麼的嗎」。
2. 使用者明確表示要延續上一件事，例如「我想繼續問上次那個補助」「ERP 做完了，接下來呢」「上次你說先做 ISO，我現在做完了」。
3. 這一輪的新問題跟這段記憶有高度直接關聯，而且引用它能明顯改善回答品質，例如記憶是「ERP 已完成；下一步原規劃政府補助」，使用者問「現在有什麼補助可以做」，這時可以自然帶入「ERP 已完成」這個背景。

除了以上三種情況，一律不得主動提起這段記憶——即使使用者只是打招呼（「哈囉」「嗨」）、說「隨便看看」「先這樣」，或問完全不相關的新問題（例如找工廠、找展覽資訊），也絕對不能主動搬出舊記憶內容，那樣會顯得突兀、像自說自話。舉例：既有記憶是「銘板製造；ERP 已完成」，使用者這一輪只說「嗨」，正確回覆完全不提銘板或 ERP，就當作一個全新、還不了解這位使用者背景的開場正常應對；錯誤示範是主動說「你之前提過是做銘板的，而且 ERP 已經完成了」——這種完全沒有被問、也不相關就主動搬出來的講法是本輪要杜絕的行為。
`.trim();

function serializeEnterpriseMemory(memory: EnterpriseMemoryForDiagnosis | null): string {
  if (!memory) {
    return "這位使用者沒有任何過往的企業摘要記錄（可能是第一次使用，或先前對話都還沒有收尾）。不要假裝知道任何過去的事，也不要說「我沒有紀錄」這種話——這跟「聊過但沒有取得有效資訊」是不同的狀態，這裡是真的完全沒有任何過去互動。";
  }
  if (!memory.hasMeaningfulBusinessInfo) {
    return [
      `這位使用者過去有使用過 OXM AI，但從來沒有留下任何具體的企業資訊（記錄是：「${memory.summaryText}」）。如果使用者問「你還記得我上次說什麼嗎」這類問題，要誠實說明「有聊過，但沒有提供足夠的企業資訊，所以沒有留下具體內容」，不能編造具體細節，也不能說成完全沒聊過。`,
      ENTERPRISE_MEMORY_RELEVANCE_GATE,
    ].join("\n\n");
  }
  if (!memory.lastInteractionHadMeaningfulInfo) {
    return [
      `這位使用者「最近一次」互動沒有提供任何新的企業資訊，但在那之前累積下來、目前仍然有效的企業長期摘要是（不是這次對話的內容，原文已經刪除，只剩這段摘要）：「${memory.summaryText}」`,
      "「最近一次沒有新資訊」這個狀態本身，不是可以主動拿出來講的理由——不要因為知道這個狀態，就主動說「你上次沒有提供新資訊，不過你之前提過……」這種話。只有使用者這一輪真的符合下面 relevance gate 的三個條件之一（尤其是條件 1：明確問過去，例如「我上次有跟你說什麼嗎」）時，才需要誠實區分兩層：先說明最近一次互動沒有留下新資訊，再補充之前仍然有效的這段記憶，不能只回答其中一半，也不能誤說成完全沒有任何記錄。不符合任何條件時（例如使用者只是說「嗨」「哈囉」），完全不要主動提起，正常回覆這一輪就好。",
      ENTERPRISE_MEMORY_RELEVANCE_GATE,
    ].join("\n\n");
  }
  return [
    `這是這位使用者過往對話留下的極短企業摘要（不是這次對話的內容，是跨對話的長期記憶，原文已經刪除，只剩這段摘要）：「${memory.summaryText}」`,
    ENTERPRISE_MEMORY_RELEVANCE_GATE,
  ].join("\n\n");
}

export function buildDiagnosisPrompt(
  factoryContext: AiFactoryContext | null,
  previousState: PreviousStateForDiagnosis | null = null,
  enterpriseMemory: EnterpriseMemoryForDiagnosis | null = null
): string {
  return [
    DIAGNOSIS_SYSTEM_PROMPT,
    "\n\n===== 企業背景（一般商業資訊，不是服務資訊；如果有，已知就不要再問）=====\n" +
      serializeFactoryContext(factoryContext),
    "\n\n===== 這段對話既有的理解（如果有）=====\n" + serializePreviousState(previousState),
    "\n\n===== 跨對話的長期企業記憶（如果有，使用規則見內文）=====\n" + serializeEnterpriseMemory(enterpriseMemory),
  ].join("\n");
}

const VALID_CONVERSATION_INTENTS = new Set<string>([
  "casual_conversation", "informational", "business_exploration", "resource_request", "action_request",
]);

function parseDiagnosis(raw: string): EnterpriseDiagnosis {
  const parsed = JSON.parse(raw);
  const status: BottleneckStatus =
    parsed.bottleneckStatus === "clear" || parsed.bottleneckStatus === "emerging"
      ? parsed.bottleneckStatus
      : "unclear";
  // 缺漏／不合法時退回 business_exploration——這是舊版（沒有 conversationIntent
  // 這個概念之前）唯一的行為模式，保守 fallback 不會讓既有邏輯路徑消失。
  const conversationIntent: ConversationIntent =
    typeof parsed.conversationIntent === "string" && VALID_CONVERSATION_INTENTS.has(parsed.conversationIntent)
      ? (parsed.conversationIntent as ConversationIntent)
      : "business_exploration";
  // 缺漏時安全預設為 true（視為跟企業／OXM 相關）——這是保守 fallback：解析
  // 失敗時寧可不觸發「非 OXM 純閒聊收斂機制」的計數，也不要誤判使用者在講
  // 完全無關的話題。
  const casualTurnDomainRelevant =
    typeof parsed.casualTurnDomainRelevant === "boolean" ? parsed.casualTurnDomainRelevant : true;
  return {
    conversationIntent,
    casualTurnDomainRelevant,
    observedProblem: String(parsed.observedProblem ?? ""),
    likelyBottleneck: parsed.likelyBottleneck ? String(parsed.likelyBottleneck) : null,
    bottleneckStatus: status,
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
    alternativeHypotheses: Array.isArray(parsed.alternativeHypotheses)
      ? parsed.alternativeHypotheses.map(String)
      : [],
    secondaryConcern: parsed.secondaryConcern ? String(parsed.secondaryConcern) : null,
    recommendedBusinessDirection: parsed.recommendedBusinessDirection
      ? String(parsed.recommendedBusinessDirection)
      : null,
    nextBestQuestion: parsed.nextBestQuestion ? String(parsed.nextBestQuestion) : null,
    shouldStopQuestioning: Boolean(parsed.shouldStopQuestioning),
    userWantsAction: Boolean(parsed.userWantsAction),
    confirmedFacts: parsed.confirmedFacts && typeof parsed.confirmedFacts === "object"
      ? Object.fromEntries(
          Object.entries(parsed.confirmedFacts).filter(
            ([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          )
        ) as Record<string, string | number | boolean>
      : {},
  };
}

export async function runEnterpriseDiagnosis(params: {
  history: AiChatTurn[];
  factoryContext: AiFactoryContext | null;
  previousState?: PreviousStateForDiagnosis | null;
  enterpriseMemory?: EnterpriseMemoryForDiagnosis | null;
}): Promise<EnterpriseDiagnosis> {
  const systemPrompt = buildDiagnosisPrompt(
    params.factoryContext,
    params.previousState ?? null,
    params.enterpriseMemory ?? null
  );
  const messages: AiChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: "以下是目前這段對話最近的逐字稿：\n\n" + serializeHistory(params.history) },
  ];
  const provider = getAiChatProvider("diagnosis");
  const raw = await provider.completeJson(messages, 550);
  return parseDiagnosis(raw);
}
