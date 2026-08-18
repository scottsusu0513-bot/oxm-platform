import { AI_SERVICE_REGISTRY } from "../../shared/ai/serviceRegistry";
import { OXM_NAVIGATION_REGISTRY } from "../../shared/ai/navigationRegistry";
import { OXM_PLATFORM_HELP_REGISTRY } from "../../shared/ai/platformHelpRegistry";
import { getAiChatProvider, type AiChatMessage } from "./provider";
import { serializeFactoryContext, serializeHistory, serializeService } from "./serialize";
import type { AiFactoryContext } from "./factoryContext";
import type { AiChatTurn } from "./types";
import { ENTERPRISE_MEMORY_RELEVANCE_GATE, type EnterpriseDiagnosis, type EnterpriseMemoryForDiagnosis } from "./diagnosis";
import type { FactorySearchStateSnapshot } from "./factorySearchState";
import type { NewsSearchStateSnapshot } from "./newsSearchState";

/**
 * Layer 2：OXM Resource Routing（OXM 資源分流層）＋最終回答組裝。
 *
 * 只有這一層可以 import Service Registry。輸入是 Layer 1 的診斷結果（不重新
 * 診斷、不推翻），輸出除了資源分流判斷之外，也直接產生要顯示給使用者的
 * finalReply——這是刻意把「服務分流」與「回答組裝」合併成同一次模型呼叫，
 * 因為組裝最終回答本來就需要同時知道診斷內容與服務資訊，沒有理由拆成第三次
 * API 呼叫（維持整輪對話只呼叫模型兩次：Layer 1 一次、Layer 2 一次）。
 */
export type ServiceRelationType = "sequential" | "concurrent" | "integrated";

/**
 * 見對話中「Phase 6B + 6C 人工驗收發現一個跨 Resource Routing bug」：這是
 * 這一輪唯一、通用的「Resource Goal」分類，取代原本讓 factorySourcingContextRelevant／
 * newsSearchContextRelevant／govSubsidyLookupRelevant 三個欄位各自獨立判斷、
 * 彼此沒有優先序、導致舊 News Context 可以蓋過這一輪已經明確換成政府補助的
 * 真實 bug。這是「本輪先判斷 Resource Goal，再決定要不要繼承上一輪的
 * Resource State」這個通用原則的落地位置——resourceTarget 必須只看「最新
 * 使用者訊息」本身在要求哪一種資源，previous Resource Context（News／Factory
 * 既有搜尋摘要）只能用來補齊「這一輪沒有重新講、但明顯延續同一個 target」的
 * 省略資訊，不能反過來讓舊 target 蓋過這一輪已經清楚換掉的新 target。
 *
 * - "none"：這一輪不是在要求 factory_search／news／subsidy_programs 這三種
 *   直接執行型資源本身——包含純聊天、一般資訊性問題、企業現況描述
 *   （business_exploration，即使最後方向可能走向政府補助或找工廠）、或明確
 *   要找顧問／執行動作（action_request／Handoff）。這些都走原本既有的
 *   diagnosis／routing／Handoff 流程，不受這個欄位影響。
 * - "factory_search"：這一輪的核心訴求是找製造合作對象本身。
 * - "news"：這一輪的核心訴求是消息／公告／展覽／競賽／活動／最新資訊本身
 *   （即使主題剛好是政府補助，例如「最近政府有沒有公布什麼補助消息？」也是
 *   news，不是 subsidy_programs——差別在使用者要的是「消息」還是「方案本
 *   身」）。
 * - "subsidy_programs"：這一輪的核心訴求是政府補助方案本身（有哪些方案、
 *   某個方案是什麼、方案之間怎麼比較），不是消息、也不是企業自己適不適合。
 * - "platform_help"（Phase 6D，見對話中「OXM AI 平台操作 / 使用方式能力」）：
 *   這一輪的核心訴求是「OXM 這個功能怎麼操作／在哪裡」本身（how_to_use），
 *   不是「幫我直接執行」（do_it_for_me）。例如「我要怎麼找工廠？」「找消息
 *   怎麼用？」「怎麼刊登工廠？」都是 platform_help；「幫我找台中的CNC加工
 *   廠」「最近有什麼展覽？」則分別是 factory_search／news，不是
 *   platform_help——差別在使用者要的是操作說明，還是要 AI 直接動手做。
 */
export type OxmResourceTarget = "none" | "factory_search" | "news" | "subsidy_programs" | "platform_help";

export interface OxmRouting {
  primaryService: string | null;
  secondaryService: string | null;
  relationship: ServiceRelationType | null;
  serviceFitReason: string;
  shouldOfferHandoff: boolean;
  finalReply: string;
  /**
   * 見上面 OxmResourceTarget 的說明：這是模型每一輪都要先判斷的唯一 Resource
   * Goal 分類，下面三個 ContextRelevant／LookupRelevant 欄位都是它的下游、
   * 受它的程式碼防線約束（見 enforceResourceTargetGate），不是各自獨立的
   * 判斷來源。
   */
  resourceTarget: OxmResourceTarget;
  /**
   * Phase 6 Action Architecture（見對話中「Current Factory Search State 沒有
   * 真正被保存」的架構修正）：這一輪的使用者訊息是不是在針對「這段對話既有
   * 的 Factory Search Context」做出反應、評論、補充或延續（例如否定上一輪
   * 結果、要求更多、問還有沒有別的），不論這一輪的 primaryService 是否又是
   * factory_search。這是語意判斷，不是關鍵字比對。程式碼層級防線
   * （enforceResourceTargetGate）保證只有 resourceTarget === "factory_search"
   * 時這個欄位才可能是 true，避免舊 Factory Context 蓋過這一輪明確換掉的新
   * target（同一種 bug class，見「六：同樣原則未來也適用」）。
   */
  factorySourcingContextRelevant: boolean;
  /**
   * Phase 6B（見對話中「找消息」）：同上，News Search 版本——這一輪的使用者
   * 訊息是不是在針對「這段對話既有的 News Search Context」做出反應、評論、
   * 補充或延續，不論這一輪的 primaryService 是否又是 news。程式碼層級防線
   * （enforceResourceTargetGate）保證只有 resourceTarget === "news" 時這個
   * 欄位才可能是 true——這正是修正「有哪些政府補助被誤送到 news」這個 bug
   * 的關鍵：即使模型這裡誤判成 true，只要 resourceTarget 已經正確判斷成
   * subsidy_programs，這裡就會被強制清空，不會蓋過使用者這一輪已經明確換
   * 掉的新 target。
   */
  newsSearchContextRelevant: boolean;
  /**
   * Phase 6C（見對話中「政府補助資訊查詢 ≠ Handoff」）：這一輪使用者是不是
   * 想知道 OXM 目前實際的政府補助方案本身，跟「使用者在描述企業現況、AI
   * 判斷方向走向 gov_subsidy Handoff」是兩件不同的事——後者仍然走原本的
   * primaryService／shouldOfferHandoff 流程，不受這個欄位影響。這個欄位不
   * 再由模型直接輸出（見對話中「跨 Resource Routing bug」根因：原本獨立輸出
   * 容易跟 newsSearchContextRelevant 互相沒有優先序），改成純粹從
   * resourceTarget 衍生（resourceTarget === "subsidy_programs"），見
   * parseRouting。這個欄位獨立於 enforceDiagnosisGate（不會因為
   * conversationIntent 是 informational 就被清空），因為方案事實查詢本身是
   * 唯讀操作，不受「診斷是否收斂」限制。
   */
  govSubsidyLookupRelevant: boolean;
  /**
   * Phase 6C（見對話中「站內 Navigation Action」）：使用者這一輪是不是明確
   * 想「前往」「帶我去」「我要看」某個 OXM_NAVIGATION_REGISTRY 裡登記的頁面
   * ——值只能是 Registry 裡的 key 或 null，真正網址由 server 端 Registry 決定
   * （見「十三：模型不能輸出任意 path」）。同樣獨立於 enforceDiagnosisGate，
   * 也不是這輪 resourceTarget bug 的範圍（導覽沒有持久化的 context 可以被舊
   * 狀態蓋過），不受這個修正影響。
   */
  navigationTarget: string | null;
  /**
   * Phase 6D（見對話中「OXM AI 平台操作 / 使用方式能力」）：resourceTarget 是
   * "platform_help" 時，這一輪具體對應到 OXM_PLATFORM_HELP_REGISTRY 裡的哪個
   * 主題 key——真正的操作內容（steps／relatedRoute／requirements／notes）由
   * server 端 Registry 決定，finalReply 只能依這個主題的真實內容改寫成聊天
   * 語氣，不能自己編造步驟或按鈕。跟 govSubsidyLookupRelevant 是同一種設計：
   * platformHelpRelevant 不再是獨立輸出的欄位，直接用
   * resourceTarget === "platform_help" 判斷（見「七：或更乾淨的等價
   * structured output」），這裡只保留「是哪一個主題」需要模型額外指出。
   */
  platformHelpTarget: string | null;
}

const VALID_SERVICE_KEYS = new Set(AI_SERVICE_REGISTRY.map(s => s.key));
const VALID_RELATIONS = new Set<ServiceRelationType>(["sequential", "concurrent", "integrated"]);
const VALID_NAVIGATION_KEYS = new Set(OXM_NAVIGATION_REGISTRY.map(e => e.key));
const VALID_RESOURCE_TARGETS = new Set<OxmResourceTarget>(["none", "factory_search", "news", "subsidy_programs", "platform_help"]);
const VALID_PLATFORM_HELP_KEYS = new Set(OXM_PLATFORM_HELP_REGISTRY.map(t => t.key));

/**
 * finalReply 是唯一真正顯示給使用者的文字，所以「使用者直接問過去的事
 * （例如『你還記得我上次說什麼嗎』）」必須在這一層被誠實回答——Layer 1
 * 的結構化 diagnosis 欄位裡沒有任何欄位是設計來承載這種 meta 問題的答案，
 * 只把 enterpriseMemory 傳給 Layer 1 不會讓這種問題被真正回答到，所以這裡
 * 也需要拿到同一份 enterpriseMemory。使用規則跟 diagnosis.ts 完全共用同一份
 * ENTERPRISE_MEMORY_RELEVANCE_GATE（silent background context，見那裡的
 * 註解與人工驗收發現的真實違反案例），避免兩層各自維護一份、規則慢慢漂移
 * 出不一致。
 */
function serializeEnterpriseMemoryForRouting(memory: EnterpriseMemoryForDiagnosis | null): string {
  if (!memory) {
    return "這位使用者沒有任何過往的企業摘要記錄。只有使用者這一輪明確問起過去互動（例如「你還記得我上次說什麼嗎」）時，才誠實說明過去沒有留下記錄，不能編造內容，也不能說成「有紀錄但不方便講」；使用者這一輪如果只是在講一個新問題（沒有問過去的事），絕對不要自己主動提「沒有過去記錄」「第一次幫你服務」這類話，正常回覆新問題就好。";
  }
  if (!memory.hasMeaningfulBusinessInfo) {
    return [
      `這位使用者過去有使用過 OXM AI，但從來沒有留下具體的企業資訊。如果使用者問起過去內容，要誠實說「有聊過，但沒有留下具體資訊」，不能編造細節。`,
      ENTERPRISE_MEMORY_RELEVANCE_GATE,
    ].join("\n\n");
  }
  if (!memory.lastInteractionHadMeaningfulInfo) {
    return [
      `這位使用者「最近一次」互動沒有提供任何新的企業資訊，但在那之前累積下來、目前仍然有效的企業長期摘要是：「${memory.summaryText}」`,
      "「最近一次沒有新資訊」這個狀態本身不是可以主動拿出來講的理由，不要因為知道這個狀態就主動說「你最近那次沒有講到新重點，不過你之前提過……」這種話。只有使用者這一輪真的符合下面 relevance gate 的三個條件之一（尤其是條件 1：明確問過去，例如「我上次跟你說了什麼」）時，才需要誠實區分兩層：先講最近一次沒有新資訊，再自然帶出之前仍然有效的這段記憶，不能只講其中一半、也不能講成完全沒有任何記錄。不符合任何條件時（例如使用者只是說「嗨」「哈囉」），完全不要主動提起，正常回覆這一輪就好。",
      ENTERPRISE_MEMORY_RELEVANCE_GATE,
    ].join("\n\n");
  }
  return [
    `這位使用者過往對話留下的極短企業摘要（跨對話長期記憶，原文已刪除）：「${memory.summaryText}」`,
    ENTERPRISE_MEMORY_RELEVANCE_GATE,
    "符合 relevance gate 條件、確實要引用時：要誠實、具體地講出摘要內容（可以改寫成自然口吻，但不能省略成「我記得一些」這種空話），同時仍然遵守下面的語氣與長度硬規則。",
  ].join("\n\n");
}

/**
 * 見 OxmRouting.factorySourcingContextRelevant 的說明：只有真的存在既有
 * Factory Search Context 時，這個判斷才有意義；完全沒有的話直接告知模型固定
 * 回 false，不要讓它自己瞎猜。
 */
function serializeFactorySearchContext(state: FactorySearchStateSnapshot | null): string {
  if (!state) {
    return "目前這段對話沒有任何既有的 Factory Search Context（從來沒有搜尋過工廠，或搜尋狀態已經不存在）——factorySourcingContextRelevant 固定回傳 false。";
  }
  return [
    `這段對話稍早已經執行過工廠搜尋，目前最新的搜尋狀態是：「${state.searchSummary}」（Hard Filter 候選 ${state.candidateCount} 家，明確符合核心能力 ${state.directCapabilityMatchCount} 家）。`,
    "只有使用者這一輪的最新訊息，明顯是在針對這個既有搜尋結果做出反應、評論、補充、或延續同一個尋源目標時（例如：「這些都沒有五軸啊」「這不是我要的」「還有沒有別的」「再多找兩家」「我要三家比較」「不用了，先這樣就好」），才把 factorySourcingContextRelevant 設為 true。如果使用者這一輪明顯在講別的事情，一律設為 false——不要因為這段對話「曾經」搜過工廠，就把後面每一輪都當成相關。",
    "factorySourcingContextRelevant 跟「這一輪 conversationIntent 要不要判斷成 resource_request（要不要真的重新執行一次搜尋）」是兩個獨立的判斷：使用者這一輪如果講出一個新的、可獨立成立的搜尋條件（不論地區／產業／能力是不是跟上一次一樣），conversationIntent 本身就會是 resource_request，這一輪就必須真的重新查詢，不能只因為「已經有既有 Factory Search Context」就只用文字承諾「需要的話我可以幫你搜尋」卻不執行。只有使用者純粹在評論／否定／要求更多同一組結果、沒有講出任何新的可查詢條件時，才不需要重新查詢，改交給後續的 Action Planner 判斷是否需要人工協尋。",
  ].join("\n");
}

/**
 * 見 OxmRouting.newsSearchContextRelevant 的說明：同上，News Search 版本。
 * 找消息目前沒有 Action Planner／人工協尋這個後續步驟（見對話中「十三：
 * 不要人工協尋」），這個欄位純粹用來讓 chatService.ts 判斷要不要在沒有重新
 * 搜尋的情況下，仍然呼叫 Final Response Composer 針對既有消息搜尋狀態回話
 * （例如使用者評論「這些我都看過了」但沒有講出新的搜尋條件）。
 */
function serializeNewsSearchContext(state: NewsSearchStateSnapshot | null): string {
  if (!state) {
    return "目前這段對話沒有任何既有的 News Search Context（從來沒有搜尋過消息，或搜尋狀態已經不存在）——newsSearchContextRelevant 固定回傳 false。";
  }
  return [
    `這段對話稍早已經執行過消息搜尋，目前最新的搜尋狀態是：「${state.searchSummary}」（找到 ${state.resultCount} 則）。`,
    "只有使用者這一輪的最新訊息，明顯是在針對這個既有消息搜尋結果做出反應、評論、補充、或延續同一個找消息目標時（例如：「這些我都看過了」「還有沒有別的」「有沒有更新的」），才把 newsSearchContextRelevant 設為 true。如果使用者這一輪明顯在講別的事情，一律設為 false——不要因為這段對話「曾經」搜過消息，就把後面每一輪都當成相關。",
    "newsSearchContextRelevant 跟「這一輪 conversationIntent 要不要判斷成 resource_request（要不要真的重新執行一次搜尋）」是兩個獨立的判斷：使用者這一輪如果講出一個新的、可獨立成立的搜尋條件（例如換了產業或消息類型，像「食品的呢」），conversationIntent 本身就會是 resource_request，這一輪就必須真的重新查詢。只有使用者純粹在評論／否定既有結果、沒有講出任何新的可查詢條件時，才不需要重新查詢。",
  ].join("\n");
}

/**
 * Phase 6C（見「十二、十三」）：Navigation Registry 序列化——AI 只能從這份
 * 清單裡選一個 key 當 navigationTarget，不能自己編 URL。
 */
function serializeNavigationRegistry(): string {
  return OXM_NAVIGATION_REGISTRY.map(e => `- key: ${e.key}｜${e.title}：${e.description}（route: ${e.route}，僅供你判斷用，finalReply 不需要提到實際網址字串）`).join("\n");
}

/**
 * Phase 6D（見對話中「三：不要再維護一大份手寫 Help Prompt」）：把
 * OXM_PLATFORM_HELP_REGISTRY 的真實內容序列化進 prompt，AI 只能依照這裡列出
 * 的 steps／relatedRoute／requirements／notes 回答「怎麼操作」類問題，不能
 * 自己編造步驟、按鈕或頁面（見「九：回答內容要來自真實平台」）。
 */
function serializePlatformHelpRegistry(): string {
  return OXM_PLATFORM_HELP_REGISTRY.map(t => [
    `【${t.title}】(key: ${t.key})`,
    `使用者可能的問法：${t.userIntentExamples.join("；")}`,
    `一句話總結：${t.answerSummary}`,
    `真實步驟（finalReply 只能從這裡精簡改寫，不能新增這裡沒有的步驟）：${t.steps.map((s, i) => `${i + 1}. ${s}`).join(" ")}`,
    t.requirements.length ? `使用條件：${t.requirements.join("；")}` : "",
    t.notes.length ? `必須誠實澄清的地方：${t.notes.join("；")}` : "",
    t.relatedRoute ? `對應的可導覽頁面 key（見上面 Navigation Registry）：${t.relatedRoute}` : "沒有對應的可導覽頁面",
  ].filter(Boolean).join("\n")).join("\n\n");
}

function serializeDiagnosis(d: EnterpriseDiagnosis): string {
  return [
    `conversationIntent（這一輪的第一層分類，見下面「conversationIntent 決定這一輪的處理方式」規則）：${d.conversationIntent}`,
    `表面現象：${d.observedProblem || "（尚不明確）"}`,
    `目前判斷的 bottleneck：${d.likelyBottleneck ?? "（尚未定案）"}`,
    `bottleneck 狀態：${d.bottleneckStatus}（unclear=還不清楚／emerging=範圍縮小但未定案／clear=已經清楚到可以給方向）`,
    d.evidence.length ? `支持這個判斷的證據：${d.evidence.join("；")}` : "",
    d.alternativeHypotheses.length ? `仍可能的其他原因：${d.alternativeHypotheses.join("；")}` : "",
    d.secondaryConcern ? `另外值得留意的次要問題：${d.secondaryConcern}` : "",
    d.recommendedBusinessDirection ? `企業真正該優先處理的方向：${d.recommendedBusinessDirection}` : "",
    d.nextBestQuestion ? `如果還要追問，下一個最高資訊價值的問題（內容重點，你要把它改寫成自然口吻）：${d.nextBestQuestion}` : "",
    `是否應該停止繼續診斷式追問：${d.shouldStopQuestioning ? "是" : "否，應該繼續問上面那個問題"}`,
    `使用者是否已表達行動意圖／明確行動請求：${d.userWantsAction ? "是" : "否"}`,
  ].filter(Boolean).join("\n");
}

const ROUTING_SYSTEM_PROMPT = `
你是 OXM AI 對話的第二個步驟。OXM 是台灣的 B2B 製造業媒合平台。上一個步驟（企業診斷層）已經分析出一份診斷結果，你完全不需要、也不允許重新診斷或推翻它——你只根據這份診斷結果，做兩件事：
(a) 判斷 OXM 現有服務裡，有沒有能承接這個診斷結果的資源；
(b) 把診斷結果與資源判斷，組成一段直接回給使用者的自然聊天回覆（finalReply）。

【最優先檢查：使用者這一輪是不是在問過去的事】
先看對話逐字稿的「最新一則使用者訊息」，只有它是在問過去的互動本身（例如「你還記得我上次說什麼嗎」「延續上次的」「我之前是不是講過」，不是在問一個新的企業問題）時，才套用這整條規則；不是的話完全跳過這條規則，正常回覆新問題，不要主動提記憶。

這條規則有兩個「不要」很容易答錯，用下面兩個具體例子校準：
- 例子 A（答錯示範：把當前對話當成「上次」）：對話逐字稿裡使用者剛剛才在這次對話問過「幫我找台中的CNC加工廠」，這一輪使用者又問「你還記得我上次說什麼嗎」——正確答案必須引用「跨對話的長期企業記憶」區塊裡的摘要文字（例如摘要寫的是 ERP 相關內容，就回答 ERP 相關內容），絕對不能回答「你剛剛提到要找CNC加工廠」——那是這次對話本身講的話，不是「上次」，「上次」只能指跨對話長期記憶區塊裡的摘要（那是原文已刪除、完全不同的更早一次對話）。
- 例子 B（答錯示範：模型的制式免責聲明）：不要回答「身為 AI，我沒辦法記得先前對話」這種話——這題問的不是你有沒有記憶能力，是要你依照「跨對話的長期企業記憶」區塊裡實際提供給你的資料回答：那個區塊有摘要文字就照著誠實講出來，那個區塊明確說「沒有任何過往記錄」時才回答沒有記錄。

確認清楚以上兩點後：這一輪的 finalReply 第一句先誠實回答這個記憶問題，不能忽略、不能顧左右而言他；回答完之後，才視情況接一句原本該問的診斷問題，如果使用者明顯只是在問記憶本身，不用硬塞診斷問題。這條規則優先於下面所有資源分流規則。

【resourceTarget——本輪的 Resource Goal，必須先判斷這個，再決定要不要繼承上一輪的 Resource Context】
這是比 conversationIntent 更上游、專門處理「這一輪到底是四種直接執行型資源（找工廠／找消息／政府補助方案／平台操作說明）裡的哪一種、還是都不是」的判斷，見對話中「跨 Resource Routing bug」的修正：核心原則是「latest user message 已經明確表達的新 Resource Goal，優先於 previous Resource Context」——previous News／Factory Search Context 只能幫助解析「這一輪明顯延續同一個 target、但省略了條件」的語句，絕對不能讓舊 target 蓋過這一輪已經清楚換掉的新 target。

判斷順序：先只看「最新一則使用者訊息」本身在要求哪一種資源（忽略上一輪聊了什麼），這是 semantic resource-goal distinction，不是關鍵字比對：
- "factory_search"：核心訴求是「幫我直接找到」製造合作對象本身（do_it_for_me，例如「幫我找台中的CNC加工廠」）。
- "news"：核心訴求是消息／公告／展覽／競賽／活動／最近發生什麼／最新資訊本身。即使主題剛好是政府補助，只要使用者要的是「消息」而不是「方案本身」，仍然是 news——例如「最近政府有沒有公布什麼補助消息？」「這些補助有沒有什麼新消息？」都是 news，不是 subsidy_programs。
- "subsidy_programs"：核心訴求是政府補助方案本身——有哪些方案、某個具體方案是什麼、方案之間怎麼比較，例如「OXM現在有哪些政府補助？」「CITD是什麼？」「CITD跟SBIR差在哪？」。
- "platform_help"（見對話中「OXM AI 平台操作 / 使用方式能力」）：核心訴求是「OXM 這個功能怎麼操作、在哪裡」本身（how_to_use，不是 do_it_for_me），例如「我要怎麼找工廠？」「怎麼刊登工廠？」「詢價怎麼用？」「找消息怎麼用？」「政府補助專區怎麼使用？」「我要怎麼送政府補助詢問？」「怎麼修改工廠資料？」「工廠審核是什麼？」「怎麼看ERP專區？」「登入後可以做什麼？」。判斷成 platform_help 時必須同時指出 platformHelpTarget（見下面「OXM 平台操作說明」段落，只能選裡面實際列出的 key 或 null）。
- "none"：以上四種都不是——包含純聊天、一般資訊性問題（不涉及操作步驟的知識性問題，例如「CITD是什麼」屬於 subsidy_programs 不是 none，但「ERP是什麼」這種純概念解釋、不是在問怎麼操作，屬於 none／informational）、企業現況描述（例如「我們最近有新製程，也要買設備，有什麼補助適合？」——這是在問「自己公司適合哪個」，屬於 business_exploration，要走既有診斷流程判斷方向，不是直接列清單或操作說明）、或明確要找顧問／執行動作（例如「直接幫我找補助顧問」，屬於 action_request／Handoff，同樣不是列清單或操作說明）。

【resourceTarget 容易混淆的邊界，務必校準】
1. how_to_use（platform_help）vs do_it_for_me（factory_search／news／subsidy_programs）：「怎麼找台中的金屬加工廠？」「找工廠怎麼搜尋？」是在問操作方式本身 → platform_help；「幫我找台中的金屬加工廠」是要求現在就執行 → factory_search。同樣地「找消息怎麼用？」是 platform_help，「最近有什麼展覽？」是 news；「政府補助專區怎麼使用？」是 platform_help，「OXM現在有哪些政府補助？」是 subsidy_programs。
2. platform_help vs navigationTarget：「我要怎麼找工廠？」是在問操作方式，屬於 platform_help（可以順便附上 navigationTarget 帶去該頁面，兩者可以同時成立）；「帶我去找工廠」「我要看ERP」是單純的移動意圖，不需要操作說明，這種情況 resourceTarget 應該是 "none"、只靠 navigationTarget 處理，不要因為使用者提到某個頁面就也把 resourceTarget 判斷成 platform_help。
3. platform_help vs Handoff：「我要怎麼送政府補助詢問？」是在問流程本身 → platform_help，回答完流程不代表已經送出任何詢問或建立顧問媒合；「直接幫我找補助顧問」「幫我找CITD顧問」是明確要找真人 → action_request／Handoff，不是 platform_help。

只有這一輪本身沒有講出新的、可獨立成立的資源條件，但明顯是在延續上一輪同一個 target 時（例如上一輪在問展覽，這一輪只說「食品的呢？」），才可以把 resourceTarget 判斷成跟上一輪相同的 target，用既有 Context 補齊省略的條件；只要這一輪已經換了一個明確可辨識的新 target（例如上一輪在幫使用者找工廠，這一輪改問「那我自己平常要怎麼搜尋？」——這已經是在問操作方式，resourceTarget 必須立刻變成 platform_help，不能因為 currentFactorySearchState 還存在就繼續當 factory_search），resourceTarget 就必須立刻反映新 target，不能因為「上一輪剛聊過某個 target」就繼續當同一種處理——這不是選字面關鍵字，是每次都要重新判斷這一句話真正要的是哪一種資源。

【platformHelpTarget 與回覆內容】
resourceTarget 是 "platform_help" 時，finalReply 必須完全依照「OXM 平台操作說明」段落裡對應主題的真實 steps 精簡改寫成 3～5 個步驟的聊天語氣，不能自己發明這裡沒有的按鈕、頁面或流程；如果該主題有 notes（例如「工廠審核個案原因 AI 不知道」），要誠實反映，不能假裝知道使用者的個案細節。如果使用者的問題不在任何已知主題範圍內，platformHelpTarget 給 null，finalReply 誠實說明目前沒有這方面的操作說明，不要用一般知識自己編一套流程。

【conversationIntent 決定這一輪的處理方式——這是唯一該看的第一層分類，不要另外列岔題案例清單】
企業診斷層已經幫這一輪標記了 conversationIntent（見「企業診斷層的結果」段落），這是整個對話架構的第一層分流：
- casual_conversation／informational：使用者在聊天，或在問一個資訊本身（一般知識，或 OXM 平台／服務有什麼）——finalReply 第一句直接、完整回答這個問題／自然聊天即可，不需要、也不應該進入下面的資源比對邏輯，primaryService／secondaryService／shouldOfferHandoff 這一輪固定是 null／null／false（下面也有程式碼層級的防線保證這件事，不完全依賴這裡）。回答 OXM 平台服務時，依下面「OXM 服務清單」的實際資料自然口語化列出幾個代表性項目＋一句總括即可，不用逐條照唸。回答完之後，如果這段對話原本已經有進行中的企業診斷，可以視情況自然接一句銜接，但不用強迫接——如果使用者接下來的訊息又明確表示要「回到剛才」，必須延續原本企業診斷的既有理解（見「企業診斷層的結果」段落），不能假裝是全新對話重問一次。
- business_exploration：使用者在描述企業問題——套用下面完整的資源分流規則（1～6）。
- resource_request／action_request：使用者已經明確講出可執行的資源需求或行動請求——不需要等 bottleneckStatus 收斂，直接依診斷結果對應到能承接的服務（含找工廠、找消息等直接執行型能力），見下面規則 2 的判斷方式。找消息（news）跟找工廠（factory_search）是同一種角色：只要 recommendedBusinessDirection 明確對應到消息／展覽／競賽／產業資訊搜尋需求本身，primaryService 直接判斷為 news，不需要先追問「要不要找」，也不需要問完地區、數量等細節才能給出判斷——直接回一句自然回覆＋讓 chatService.ts 執行搜尋。

不要把這條規則理解成「針對每一種案例各寫一條特規」——conversationIntent 本身就是唯一的分流依據，finalReply 每一輪都要讓使用者感覺得到對話真的在往前推進，不是原地重複上一輪已經問過、已經被使用者回答過的問題（這是 Layer 1 的責任，見 diagnosis.ts 規則 5b，這裡不重複維護一份）。

【政府補助方案事實查詢的回覆語氣】
resourceTarget 判斷成 "subsidy_programs" 時：真正的方案細節查詢由後端直接查真實資料庫回答，你不需要（也不應該）自己在 finalReply 裡背誦方案內容，這一輪的 finalReply 可以留空泛一點的過渡語氣，實際內容會由另一個步驟依照真實資料重組。

【navigationTarget——站內導覽，獨立於 conversationIntent 分流，不受 enforceDiagnosisGate 影響】
只有使用者這一輪明確表達「想現在去看／前往」某個 OXM 頁面本身時（例如「帶我去找工廠」「我要看ERP」「帶我去找消息」），才從上面「OXM 站內可導覽頁面」清單裡選一個對應的 key 填入 navigationTarget；純粹問「XX是什麼」這種資訊性問題（例如「ERP是什麼？」）不算，navigationTarget 維持 null，不要強迫每次提到某個服務都附帶導覽。使用者提到的頁面如果不在清單裡，navigationTarget 也是 null。同一輪最多只選一個最符合的 key，不要因為使用者一次問了「OXM有哪些服務」就想列出好幾個導覽目標。

【非 OXM 純閒聊收斂——只在 consecutiveOutOfDomainCasualTurns >= 4 時才適用】
下面會告訴你這一輪是「連續第幾輪」跟企業／OXM 完全無關的純閒聊（例如聊天氣、咖啡、電影這種話題；跟企業／製造業相關的閒聊如「今天工廠很煩」不算，見 diagnosis.ts 的判斷，不會累加這個數字）。核心目的不是禁止聊天，是避免對話被長時間拿來當一般聊天機器人用、持續消耗資源，同時要保留自然、不生硬的體驗：
- 少於 4（1～3）：正常陪聊，完全不用提起 OXM 或工作，這是允許、預期會發生的正常聊天。
- 達到 4 或以上：finalReply 先簡短回應使用者剛剛講的內容（一兩句就好，不用敷衍或忽略），接著自然帶出一句簡短的 scope reminder，語意大致是「可以陪你聊一下，不過我主要是 OXM 的企業助手，比較能幫上忙的是找工廠、經營、補助、ERP、ISO、品牌行銷這類企業問題，如果你有相關需求我可以直接接著幫你」——用你自己的話自然表達，不要逐字照抄這個範例，也不要用「token不足」「額度」「資源有限」這種技術／內部語言，不要變成生硬的客服式拒絕（不是「不能聊」，是簡短提醒＋友善引導）。如果這已經不是第一次達到這個門檻（例如使用者聽完提醒後又聊了好幾輪無關話題），可以更簡短一點，不用每次都重複完整的提醒句子，避免重複感。

【使用者從閒聊重新回到 OXM／企業話題】
只要這一輪 conversationIntent 不是 casual_conversation，或雖然是 casual_conversation 但跟企業相關，就代表使用者已經回到主題——這種情況下 consecutiveOutOfDomainCasualTurns 這一輪一定已經是 0（見下面的 Current Conversation State 段落），finalReply 完全正常處理這一輪的內容就好，絕對不要因為「稍早」聊過幾輪無關話題就還提起 scope reminder 或表現出遲疑。

【資源分流規則（conversationIntent 是 business_exploration／resource_request／action_request 時才適用）】
1. Service Registry 是「診斷完成後才查閱的資源庫」，不是候選答案清單。如果診斷結果的 bottleneckStatus 是 unclear 或 emerging，代表企業診斷還沒收斂到一個方向，這時 primaryService 必須是 null、secondaryService 必須是 null、shouldOfferHandoff 必須是 false，finalReply 只能延續診斷追問（把診斷結果裡的「下一個最高資訊價值的問題」改寫成自然口吻），絕對不能在這個時候提到任何 OXM 服務名稱、也不能給任何業務方向判斷——這個狀態代表現有資訊真的還不足以排除主要錯誤方向，不是保守，是誠實。
1b. 不需要等到 100% 確定才能給方向：只要 bottleneckStatus 已經是 clear（代表方向已經足夠明確，不是所有細節都問完），即使 shouldStopQuestioning 是「否」（代表企業診斷層認為還有一個值得問的確認題），finalReply 也必須先給出 provisional judgment——用一句話直接講出目前的業務方向判斷（把 recommendedBusinessDirection 轉成自然口吻），如果剛好有明顯對應的服務，也可以在這句話裡自然點出來（例如「這比較像帳期造成的現金流壓力，不是訂單不足」「核心問題是生產管理沒有系統化，ERP 會比單獨做 AI 更前面，AI 之後可以再評估是否整合進去」「這已經不是不知道 AI 用在哪的階段了，方向比較像正式研發，之後可以往 CITD／SBIR／研發轉型看，不是 19+1」「這種情況比較接近『AI 應用場景還沒定義清楚』，19+1 的診斷型輔導這時候就有評估價值了」），然後才視情況在同一句話後面補一個確認題（把診斷結果的 nextBestQuestion 改寫成自然口吻）。這個狀態下即使提到了服務名稱，也絕對不能用「如果你有需要，我可以幫你轉交給顧問」這種正式承接語氣——那要等到 shouldStopQuestioning 也變成「是」（見下面的承接時機規則）才能講，這裡只是先讓使用者知道你的判斷方向、不是正式進入承接流程。絕對不能是「只問問題、完全不給方向」這種寫法，那是本輪要修正的過度保守。
2. 只有當 bottleneckStatus 是 clear 且已經有 recommendedBusinessDirection 時，才進入資源比對（不論 shouldStopQuestioning 是否為真——上面 1b 已經說明兩者是分開的）：把 recommendedBusinessDirection 逐一對照服務清單裡每個服務的「解決什麼問題」欄位，確認語意真的對應，不能只因為服務名稱聽起來相關、或某個服務在清單裡資料比較長／講得比較detailed，就選它。serviceFitReason 必須具體引用該服務「解決什麼問題」欄位裡的字句來說明為什麼契合；如果你發現寫不出具體對應（只能寫出籠統、勉強的理由），那就代表這個服務其實不合適，應該重新檢查是否有更貼近的服務，或直接回傳 primaryService: null。特別注意：跟「客戶認知／品牌信任／曝光／陌生客戶開發／價值傳達」有關的方向，通常對應「找形象／短影音／品牌內容」，不要因為對話中提過訂單、金額、客戶這類字眼就聯想到政府補助或財務服務——那兩個服務分別是「拿資源做研發／設備／轉型」和「改善資金與融資結構」，跟單純的品牌溝通問題無關。
3. 允許 primaryService 為 null——如果診斷出來的真正方向是定價策略、產品組合調整、業務制度、生產技術改善、客戶集中度風險、人力問題，或任何服務清單裡沒有直接對應的東西，就誠實回傳 primaryService: null，finalReply 要誠實講出真正方向，不能為了湊一個服務而扭曲判斷。
4. 服務關係只有三種：sequential（有先後順序）、concurrent（可同時進行）、integrated（整合在一起）——不要憑服務名稱寫死關係，要依實際情況判斷（例如 ERP 不一定要先於 AI，如果 AI 功能可以直接整合進 ERP，就是 integrated）。
5. 政府補助六大方向的細節（SBIR/CITD/SIIR/研發轉型/海外市場拓展/19+1）都已經寫在下面的服務清單裡，依那份資料判斷，不要自己編造官方數字或資格條件。19+1 只適合「AI 應用場景還不明確、需要協助盤點方向」的情況；如果診斷結果顯示使用者已經有明確技術標的或 PoC、要走向正式研發或產品化，primaryService 應該是 gov_subsidy，但 finalReply 不能只籠統說「有顧問可以協助」，要具體點出「這已經不是應用場景不明確的診斷階段了，方向比較像正式研發／產品化，可以往 CITD／SBIR／研發轉型看，不是 19+1」這種明確區分，讓使用者清楚知道跟「還不知道 AI 用在哪」的情況是不同的方向。
6. 不要因為使用者是「企業社」而降低服務適配度、顯示警告或假設不能申請——正常判斷，交由真人顧問依實際方案判斷。

【使用者已經要求立刻給結論，但診斷本身還沒有把握——這是常被漏掉的情況，特別注意】
如果 shouldStopQuestioning 是「是」，但 bottleneckStatus 還不是 clear、recommendedBusinessDirection 是 null（代表使用者已經表達不耐煩或要求直接講、但企業診斷本身還沒收斂到一個明確方向），finalReply 絕對不能只是重複剛剛已經問過的診斷問題，也不能說「目前還不清楚」就結束——這樣使用者會覺得你沒有回應他「別再問了」的要求。這時你必須用 alternativeHypotheses／evidence／observedProblem 裡現有的資訊，誠實給出一個「以目前資訊來看」的條件式或傾向性判斷（例如「如果是詢價量本身變少，通常要先看曝光；如果是有詢價但成交率低，通常要先看價格或品質溝通——从你目前講的來看，比較像是後者」，或挑 alternativeHypotheses 裡最可能的一個直接講），這種情況下 primaryService 依然必須是 null（診斷都還沒收斂，不能推服務），但 finalReply 本身不能是一個問句。

【承接時機規則（handoffReadiness）——一句話原則：還不知道問題時，不推服務；已經知道問題時，不要一直問】
shouldOfferHandoff 這個欄位就是 handoffReadiness 的結果：只回答一個問題——「現在交給真人顧問，是不是合理的下一步？」不是「有沒有提到某個服務名稱」。以下三個條件同時成立時才能是 true：(1) bottleneck 已相對清楚 (2) 你已經判斷出哪個服務可以直接協助 (3) 再問更多問題也不會改變這個服務方向；conversationIntent 是 action_request（使用者明確要求找顧問／執行某個行動）時，通常直接視為已經滿足這三個條件。單純的 informational（使用者只是問某個服務是什麼）絕對不能滿足這三個條件——見上面「conversationIntent 決定這一輪的處理方式」，這個狀態下 shouldOfferHandoff 這一輪固定就是 false，下面也有程式碼防線保證。三個條件同時成立時，finalReply 絕對不要再問任何「顧問接手後才需要進一步確認」的執行細節（不限於特定服務類型，例如：確切預算、時程、平台或工具選擇、具體執行方式、有沒有作品案例或參考素材、其他需要深入盤點的執行條件），也不能因為使用者一時拿不出這些細節（例如「案例我沒辦法貼給你」）就退回去繼續問、不敢承接——這些一律交給顧問接手後自己確認，而是直接提出承接，例如：「這個方向其實已經很明確了。你現在比較需要的是〔一句話講真正該做的事〕。OXM 這邊有〔對應顧問〕可以協助，如果你有需要，我可以幫你轉交給顧問接著聊。」不需要等到所有細節問完，方向清楚＋服務清楚＋使用者已表現興趣（例如「聽起來不錯」）就足夠。反過來，三個條件沒有同時成立時，shouldOfferHandoff 必須是 false，不能一判斷出服務就立刻推顧問。shouldOfferHandoff 這個欄位跟 finalReply 的文字內容必須完全一致：shouldOfferHandoff 是 false 時，finalReply 絕對不能出現「我可以幫你轉交」「轉交給顧問」這類承接語句；只有 shouldOfferHandoff 是 true 時才能講這句——不要讓結構化欄位跟你實際講出來的話互相矛盾。

【Phase 1 目前不能做的事】
這是本地端 MVP，只能做初步判斷與「詢問使用者要不要轉交顧問」的意圖探詢，絕對不能宣稱已經「送出」或「建立」了任何案件、詢問、申請。finalReply 裡如果要提承接，只能用「如果你有需要，我可以幫你轉交給顧問接著聊」這種探詢語氣，不能說「我已經幫你送出」「顧問會盡快聯絡你」「已經幫你轉交」這種暗示動作已完成的話。

【極輕微的善意提醒，不是推銷】
只有在你非常確定某件事對企業有實際幫助、而使用者正準備放棄一個明顯有價值的方向時，才可以在 finalReply 友善地多提醒一次。判斷原則：「如果 OXM 完全不會從這件事賺錢，我還會不會建議他做？」只有答案是「會」，才能提醒，且要講產業趨勢／客戶要求／供應鏈門檻／企業自身利益，不要講成銷售話術。同一件事在同一次對話裡只能提醒一次：只要對話逐字稿裡使用者已經對這件事表達過一次不想做／不需要，之後絕對不能再用任何方式重新提起。

【finalReply 的語氣與長度——硬規則，違反視為錯誤輸出】
使用者主要用手機閱讀，這是在聊天，不是寫報告。除非使用者明確要求「詳細說明」，否則：
1. 整段 finalReply 最多 90 個中文字，目標 40～90 字，這是強制上限不是參考值。
2. 每段最多 1～2 句話，一句話只講一個概念。
3. 如果已經能給判斷，第一句直接講判斷本身，不要先複述使用者剛剛講的話（禁止「了解了，你的主要問題是……」這種寫法）。
4. 不要一次條列三四種可能方向——只講最可能的那一個。
5. 一輪最多問一個問題，不能同一輪問兩題。
6. 不要補充使用者沒問、用不到的背景知識，那是湊字數。
7. 不要重複講同一件事兩次。
8. 每輪只推進一件事：要嘛給判斷／承接詢問，要嘛問一題。
9. 使用者說「你直接告訴我」「你幫我決定」時，回覆要更短（40～60 字）：只講你會怎麼排優先順序、一句為什麼。
10. 語氣像懂傳產的顧問朋友在聊天，可以用「如果是我幫你排順序，我會先……」「我大概知道你現在卡在哪了」這類說法；不要用「經系統分析」「適配度 87%」「歡迎使用智能推薦系統」這類話，不要過度客服腔，不要條列式問卷感。用繁體中文。

只回傳一個 JSON object，不要有任何其他文字，格式如下：
{
  "primaryService": "服務 key 或 null",
  "secondaryService": "服務 key 或 null",
  "relationship": "sequential 或 concurrent 或 integrated 或 null",
  "serviceFitReason": "string，內部判斷理由，不會直接顯示給使用者",
  "shouldOfferHandoff": true/false,
  "finalReply": "string，直接顯示給使用者的聊天回覆，遵守上面的語氣與長度規則",
  "resourceTarget": "none 或 factory_search 或 news 或 subsidy_programs 或 platform_help（見「resourceTarget」規則，必須先判斷這個）",
  "factorySourcingContextRelevant": true/false,
  "newsSearchContextRelevant": true/false,
  "navigationTarget": "Registry 裡的 key 或 null",
  "platformHelpTarget": "Help Registry 裡的 key 或 null（只有 resourceTarget 是 platform_help 時才可能非 null）"
}
`.trim();

function buildRoutingPrompt(params: {
  diagnosis: EnterpriseDiagnosis;
  history: AiChatTurn[];
  factoryContext: AiFactoryContext | null;
  enterpriseMemory: EnterpriseMemoryForDiagnosis | null;
  currentFactorySearchState: FactorySearchStateSnapshot | null;
  currentNewsSearchState: NewsSearchStateSnapshot | null;
  consecutiveOutOfDomainCasualTurns: number;
}): string {
  const servicesBlock = AI_SERVICE_REGISTRY.map(serializeService).join("\n\n");
  return [
    ROUTING_SYSTEM_PROMPT,
    "\n\n===== 企業診斷層的結果（Layer 1，不要重新診斷或推翻）=====\n" + serializeDiagnosis(params.diagnosis),
    "\n\n===== 對話逐字稿（供組裝回覆時參考語氣與已知資訊，不要重複使用者剛講過的話）=====\n" +
      serializeHistory(params.history),
    "\n\n===== 企業背景（如果有）=====\n" + serializeFactoryContext(params.factoryContext),
    "\n\n===== 跨對話的長期企業記憶（如果有，使用規則見內文）=====\n" +
      serializeEnterpriseMemoryForRouting(params.enterpriseMemory),
    "\n\n===== OXM 服務清單（診斷完成後才查閱的資源庫，只依下面實際列出的服務判斷，不要編造不存在的服務）=====\n" +
      servicesBlock,
    "\n\n===== 既有 Factory Search Context（判斷 factorySourcingContextRelevant 用，見下方 JSON 格式）=====\n" +
      serializeFactorySearchContext(params.currentFactorySearchState),
    "\n\n===== 既有 News Search Context（判斷 newsSearchContextRelevant 用，見下方 JSON 格式）=====\n" +
      serializeNewsSearchContext(params.currentNewsSearchState),
    "\n\n===== OXM 站內可導覽頁面（判斷 navigationTarget 用，只能選這裡面的 key 或 null，不能自己編別的）=====\n" +
      serializeNavigationRegistry(),
    "\n\n===== OXM 平台操作說明（判斷 resourceTarget===\"platform_help\" 與 platformHelpTarget 用，只依下面實際列出的主題與步驟回答，不要編造不存在的按鈕或流程）=====\n" +
      serializePlatformHelpRegistry(),
    "\n\n===== 非 OXM 純閒聊收斂（見上面規則）=====\n" +
      `這一輪 consecutiveOutOfDomainCasualTurns（已經包含這一輪本身，server-authoritative 算好的）＝${params.consecutiveOutOfDomainCasualTurns}。`,
  ].join("\n");
}

function parseRouting(raw: string): OxmRouting {
  const parsed = JSON.parse(raw);
  const primaryService =
    typeof parsed.primaryService === "string" && VALID_SERVICE_KEYS.has(parsed.primaryService)
      ? parsed.primaryService
      : null;
  const secondaryService =
    typeof parsed.secondaryService === "string" && VALID_SERVICE_KEYS.has(parsed.secondaryService)
      ? parsed.secondaryService
      : null;
  const relationship =
    typeof parsed.relationship === "string" && VALID_RELATIONS.has(parsed.relationship as ServiceRelationType)
      ? (parsed.relationship as ServiceRelationType)
      : null;
  const finalReply = String(parsed.finalReply ?? "").trim();
  if (!finalReply) {
    throw new Error("Layer 2 routing 回傳空的 finalReply");
  }
  const navigationTarget =
    typeof parsed.navigationTarget === "string" && VALID_NAVIGATION_KEYS.has(parsed.navigationTarget)
      ? parsed.navigationTarget
      : null;
  const resourceTarget: OxmResourceTarget =
    typeof parsed.resourceTarget === "string" && VALID_RESOURCE_TARGETS.has(parsed.resourceTarget as OxmResourceTarget)
      ? (parsed.resourceTarget as OxmResourceTarget)
      : "none";
  return {
    primaryService,
    secondaryService,
    relationship,
    serviceFitReason: String(parsed.serviceFitReason ?? ""),
    shouldOfferHandoff: Boolean(parsed.shouldOfferHandoff),
    finalReply,
    resourceTarget,
    factorySourcingContextRelevant: Boolean(parsed.factorySourcingContextRelevant),
    newsSearchContextRelevant: Boolean(parsed.newsSearchContextRelevant),
    // 見對話中「跨 Resource Routing bug」的根因修正：不再讓模型獨立輸出這個
    // 欄位（原本的獨立輸出容易跟 newsSearchContextRelevant 沒有優先序、互相
    // 打架），改成純粹從 resourceTarget 衍生——resourceTarget 本身已經是
    // 「先判斷 Resource Goal」的唯一權威來源。
    govSubsidyLookupRelevant: resourceTarget === "subsidy_programs",
    navigationTarget,
    // Phase 6D：只有 resourceTarget 真的是 "platform_help" 時，platformHelpTarget
    // 才可能非 null——即使模型不遵守規則、在別的 resourceTarget 底下也塞了一個
    // key，這裡直接忽略，避免 platform_help 的判斷來源分裂成兩個互相沒有優先
    // 序的欄位（跟 govSubsidyLookupRelevant 同一種根因修正）。
    platformHelpTarget:
      resourceTarget === "platform_help" &&
      typeof parsed.platformHelpTarget === "string" &&
      VALID_PLATFORM_HELP_KEYS.has(parsed.platformHelpTarget)
        ? parsed.platformHelpTarget
        : null,
  };
}

/**
 * 程式碼層級的硬性防線，不完全依賴模型自己遵守 prompt 指示：診斷還沒做完
 * （bottleneck 不是 clear，或 shouldStopQuestioning 是 false）時，不管模型
 * 回傳什麼，一律強制把服務分流欄位清空——這是「診斷永遠先於資源」這條規則
 * 唯一真正保證不會被模型機率性忽略的地方，其餘（例如 finalReply 文字本身
 * 措辭是否得體）仍然依賴 prompt 品質。
 */
function enforceDiagnosisGate(diagnosis: EnterpriseDiagnosis, routing: OxmRouting): OxmRouting {
  // 見對話中「OXM AI Core Conversation Architecture 收斂」：conversationIntent
  // 是 casual_conversation 或 informational 時，這一輪連進入資源比對都不該
  // 發生——這是「詢問服務 ≠ 需要顧問」這條規則唯一真正保證不會被模型機率性
  // 忽略的地方，不完全依賴 prompt 指示（跟下面 directionReady 的防線是同一種
  // 設計哲學：結構化欄位的正確性用程式碼保證，finalReply 文字措辭才依賴
  // prompt 品質）。
  if (diagnosis.conversationIntent === "casual_conversation" || diagnosis.conversationIntent === "informational") {
    return {
      ...routing,
      primaryService: null,
      secondaryService: null,
      relationship: null,
      shouldOfferHandoff: false,
    };
  }
  // bottleneckStatus 與 shouldStopQuestioning 是兩道獨立的門檻（見
  // diagnosis.ts 規則 9 與 routing.ts 規則 1b）：
  // - 「方向是否足夠明確、可以點出可能對應的服務」只需要 bottleneckStatus
  //   是 clear，或使用者直接表達了明確的行動請求（userWantsAction）——不需
  //   要等到 shouldStopQuestioning 也是真，這是本輪要修正的「過度保守」。
  // - 「是否可以正式提出轉交顧問（shouldOfferHandoff／handoffReadiness）」
  //   門檻比較高，除了方向明確，還要求 shouldStopQuestioning 為真（代表已經
  //   沒有值得再問的確認題）——這道門檻沒有放寬，避免一有方向就急著問「要不
  //   要轉交」。
  const directionReady =
    diagnosis.bottleneckStatus === "clear" || diagnosis.userWantsAction;
  if (!directionReady) {
    return {
      ...routing,
      primaryService: null,
      secondaryService: null,
      relationship: null,
      shouldOfferHandoff: false,
    };
  }
  if (!diagnosis.shouldStopQuestioning) {
    return { ...routing, shouldOfferHandoff: false };
  }
  return routing;
}

/**
 * 程式碼層級的硬性防線，修正「Phase 6B + 6C 人工驗收發現一個跨 Resource
 * Routing bug」：resourceTarget 是這一輪唯一的 Resource Goal 權威來源，
 * factorySourcingContextRelevant／newsSearchContextRelevant 只是「要不要繼承
 * 對應的 Resource State」的訊號，不能在 resourceTarget 已經判斷成別的
 * target（或完全不是資源請求）時還維持 true——不然舊的 News／Factory
 * Context 就會蓋過這一輪已經明確換掉的新 target（例如上一輪在聊消息，這一
 * 輪已經問「你們現在有哪些政府補助？」，newsSearchContextRelevant 卻還是
 * true）。不完全依賴模型自己遵守 prompt 指示，跟 enforceDiagnosisGate 是同一
 * 種設計哲學：結構化欄位的正確性用程式碼保證。
 */
function enforceResourceTargetGate(routing: OxmRouting): OxmRouting {
  return {
    ...routing,
    factorySourcingContextRelevant: routing.resourceTarget === "factory_search" ? routing.factorySourcingContextRelevant : false,
    newsSearchContextRelevant: routing.resourceTarget === "news" ? routing.newsSearchContextRelevant : false,
  };
}

export async function runOxmRouting(params: {
  diagnosis: EnterpriseDiagnosis;
  history: AiChatTurn[];
  factoryContext: AiFactoryContext | null;
  enterpriseMemory?: EnterpriseMemoryForDiagnosis | null;
  currentFactorySearchState?: FactorySearchStateSnapshot | null;
  currentNewsSearchState?: NewsSearchStateSnapshot | null;
  /** 見「非 OXM 純閒聊收斂機制」：chatService.ts 用 resolveConsecutiveOutOfDomainCasualTurns() 算好再傳進來，這裡不重算。訪客／無狀態路徑不傳，預設為 0（沒有 session state 可以累計，不觸發收斂）。 */
  consecutiveOutOfDomainCasualTurns?: number;
}): Promise<OxmRouting> {
  const systemPrompt = buildRoutingPrompt({
    ...params,
    enterpriseMemory: params.enterpriseMemory ?? null,
    currentFactorySearchState: params.currentFactorySearchState ?? null,
    currentNewsSearchState: params.currentNewsSearchState ?? null,
    consecutiveOutOfDomainCasualTurns: params.consecutiveOutOfDomainCasualTurns ?? 0,
  });
  const messages: AiChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        "請依照上面的診斷結果與規則，輸出這一輪的資源分流判斷與 finalReply。先判斷 resourceTarget（見「resourceTarget」規則段落，這是最上游的判斷，只看最新使用者訊息在要求哪一種資源，不要被上一輪的既有 Context 蓋過；resourceTarget 是 platform_help 時要同時給出 platformHelpTarget）。先檢查對話逐字稿裡使用者最新一則訊息是不是在問過去的互動本身（見「最優先檢查」規則），是的話 finalReply 必須先回答那個問題。也請判斷 factorySourcingContextRelevant（見「既有 Factory Search Context」段落的規則）、newsSearchContextRelevant（見「既有 News Search Context」段落的規則）與 navigationTarget（見同名規則段落）。",
    },
  ];
  const provider = getAiChatProvider("routing");
  const raw = await provider.completeJson(messages, 600);
  const routing = parseRouting(raw);
  return enforceDiagnosisGate(params.diagnosis, enforceResourceTargetGate(routing));
}
