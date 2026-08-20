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
 * - "service_info"（Phase 6E，見對話中「OXM 顧問服務知識中心化 + 精準服務
 *   查詢」）：這一輪的核心訴求是「OXM 某個顧問型服務本身在做什麼／包含什麼
 *   ／跟另一個服務差在哪」本身，是單純資訊詢問，不是在描述自己企業的問題
 *   （那是 business_exploration，走既有診斷流程，可能才逐漸走向 Handoff）。
 *   例如「ERP服務是做什麼？」「你們ISO服務有哪些？」「短影音會幫忙企劃
 *   嗎？」「ERP跟財務優化差在哪？」都是 service_info；「我們庫存跟工單一直
 *   對不上」是 business_exploration；「政府補助服務怎麼協助企業？」是
 *   service_info，但「OXM現在有哪些政府補助？」是 subsidy_programs（服務
 *   本身 vs 實際方案清單，見「十一」）。
 */
export type OxmResourceTarget = "none" | "factory_search" | "news" | "subsidy_programs" | "platform_help" | "service_info";

/**
 * Phase 6G.1（見對話中「政府補助 Program Decision Layer / 方案級主次推薦與
 * 追問強化」）：政府補助「方案層級」的主推薦／次推薦，跟 primaryService（服務
 * 層級，例如 gov_subsidy／erp）是完全不同層次的判斷——這個欄位只在
 * primaryService 是 gov_subsidy 時才可能非 null（見 enforceGovSubsidyRecommendationGate），
 * 是同一次 Layer 2 呼叫額外多輸出的 structured output，不是新的 LLM call，也
 * 不是資格審查（不可以有 score／eligibility／pass-fail 的語意，只能是「目前
 * 情境下比較值得優先談哪個方向」的判斷）。
 */
export interface GovSubsidyRecommendation {
  /** shared/ai/serviceRegistry.ts gov_subsidy.govSubsidyPrograms 裡的 key，或 null（資訊不足時，null 是合法狀態，見「十四：允許 null」）。 */
  primaryProgramKey: string | null;
  /** 同上，第二合理的方向；資訊不足、或沒有明顯的第二方向時為 null。一定跟 primaryProgramKey 不同（見 parseRouting）。 */
  secondaryProgramKey: string | null;
  /** 內部判斷理由，必須具體引用這一輪對話裡的事實，不會直接顯示給使用者（finalReply 自己組自然語言）。 */
  reasoning: string;
  /** 如果要更有把握判斷方向，還缺哪些資訊；資訊已經足夠時可以是空陣列。 */
  missingInformation: string[];
}

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
   * Phase 6F（見對話中「Factory Search Result Boundary」）：這一輪的使用者
   * 訊息是不是在要求 AI 對「這段對話既有 Factory Search Context 裡已經出現
   * 的搜尋結果」做逐家解釋／比較／排名／推薦（例如「第一家主要做什麼？」
   * 「哪一家比較適合我？」「幫我比較這幾家」），不是在講出一個新的、可獨立
   * 成立的搜尋條件。這是語意判斷，不是關鍵字比對。程式碼層級防線
   * （enforceResourceTargetGate）保證只有 resourceTarget === "factory_search"
   * 時這個欄位才可能是 true，跟 factorySourcingContextRelevant 同一種閘門，
   * 避免這一輪已經明確換成別的 target（例如 service_info／news）時還誤觸發
   * boundary 回覆。true 時 chatService.ts 不會呼叫 Action Planner，也不會把
   * topResults 重新送進任何模型（見「七」），finalReply 直接沿用這次 Layer 2
   * 呼叫自己產生的內容（見「boundary reply 的生成方式」規則段落），不是另一
   * 個 Composer call。
   */
  factoryResultAnalysisRequest: boolean;
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
  /**
   * Phase 6E：resourceTarget 是 "service_info" 時，這一輪具體在問（或比較）
   * 哪些顧問型服務——1 個是單一介紹，2 個（或以上）代表使用者要求比較（見
   * 「八：允許跨服務比較」），finalReply 必須針對每一個列出的服務分別講清楚
   * 差異，不能只講一個或籠統帶過。值只能是 shared/ai/serviceRegistry.ts 裡
   * 「顧問型服務」子集的 key（找工廠／找消息已經各自有自己的 resourceTarget，
   * 不屬於這裡），見 VALID_SERVICE_INFO_TARGETS。跟
   * govSubsidyLookupRelevant／platformHelpTarget 同一種設計：不受
   * enforceDiagnosisGate 影響，因為服務資訊查詢本身是唯讀操作。
   */
  serviceTargets: string[];
  /** 見 GovSubsidyRecommendation 的說明。primaryService 不是 gov_subsidy 時固定為 null。 */
  govSubsidyRecommendation: GovSubsidyRecommendation | null;
}

const VALID_SERVICE_KEYS = new Set(AI_SERVICE_REGISTRY.map(s => s.key));
const VALID_RELATIONS = new Set<ServiceRelationType>(["sequential", "concurrent", "integrated"]);
const VALID_NAVIGATION_KEYS = new Set(OXM_NAVIGATION_REGISTRY.map(e => e.key));
const VALID_RESOURCE_TARGETS = new Set<OxmResourceTarget>(["none", "factory_search", "news", "subsidy_programs", "platform_help", "service_info"]);
const VALID_PLATFORM_HELP_KEYS = new Set(OXM_PLATFORM_HELP_REGISTRY.map(t => t.key));
/**
 * 見對話中「十七：不要新增 erpRelevant／isoRelevant／shortVideoRelevant／
 * financeRelevant 四組 boolean，改用一個通用 resourceTarget=service_info
 * 搭配 serviceTargets」：找工廠／找消息已經各自是獨立的 resourceTarget
 * （factory_search／news），不屬於「顧問型服務資訊查詢」這個子集，這裡排除
 * 掉避免跟既有機制重疊、產生第二條判斷路徑。
 */
const SERVICE_INFO_EXCLUDED_KEYS = new Set(["factory_search", "news"]);
const VALID_SERVICE_INFO_TARGETS = new Set(
  AI_SERVICE_REGISTRY.map(s => s.key).filter(k => !SERVICE_INFO_EXCLUDED_KEYS.has(k))
);
/** Phase 6G.1：govSubsidyRecommendation.primaryProgramKey／secondaryProgramKey 只能是這裡面的 key，模型輸出任何其他字串一律視為 null（見 parseRouting）。 */
const VALID_GOV_SUBSIDY_PROGRAM_KEYS = new Set(
  (AI_SERVICE_REGISTRY.find(s => s.key === "gov_subsidy")?.govSubsidyPrograms ?? []).map(p => p.key)
);

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
    return "目前這段對話沒有任何既有的 Factory Search Context（從來沒有搜尋過工廠，或搜尋狀態已經不存在）——factorySourcingContextRelevant 與 factoryResultAnalysisRequest 都固定回傳 false。如果使用者這一輪還是在問「第一家」「第二家」之類指涉既有結果的問題，finalReply 必須誠實說明目前這段對話沒有可對應的工廠搜尋結果，不能假裝知道使用者指的是哪一家，可以邀請使用者先講出想找什麼類型的工廠。";
  }
  return [
    `這段對話稍早已經執行過工廠搜尋，目前最新的搜尋狀態是：「${state.searchSummary}」（Hard Filter 候選 ${state.candidateCount} 家，明確符合核心能力 ${state.directCapabilityMatchCount} 家）。注意：這裡刻意不列出候選工廠的名稱或細節（見對話中「Factory Search Result Boundary」：不要為了判斷這個欄位又把 topResults 完整內容送進來），你不需要、也不應該知道「第一家」「第三家」實際是誰才能做以下判斷。`,
    `factorySourcingContextRelevant：套用「既有 Resource Context 的通用判斷原則」（見上方），這裡的 worked examples 是：「這些都沒有五軸啊」「這不是我要的」「還有沒有別的」「再多找兩家」「我要三家比較」「不用了，先這樣就好」；沒有講出任何新可查詢條件時才不需要重新查詢，改交給後續的 Action Planner 判斷是否需要人工協尋（其餘見通用原則）。`,
    "【factoryResultAnalysisRequest——見對話中「Factory Search Result Boundary / 工廠搜尋結果分析限制」，這是本輪最重要的產品邊界】OXM AI 在 Factory Search 的責任只到「幫使用者把可能符合需求的工廠搜尋出來」，搜尋完成之後，工廠實際產品、加工能力、合作條件與是否適合，一律交由使用者自己進入工廠頁查看並直接與工廠確認——AI 不逐家解說、不比較、不排名、不推薦、不代替使用者判斷哪一家更適合。只有使用者這一輪明確是在要求 AI 對「已經出現的搜尋結果」做逐家解釋／比較／排名／推薦時，才把 factoryResultAnalysisRequest 設為 true，例如（語意類型，不是窮舉關鍵字）：「第一家主要做什麼？」「第一家跟第三家差在哪？」「哪一家比較適合我？」「哪一家比較好？」「哪一家可以打樣？」「哪一家可以少量？」「哪一家比較符合CNC？」「幫我分析這幾家」「幫我比較這幾家」「第二家適合我嗎？」「你推薦哪一家？」「幫我看第二家產品」「幫我整理這些工廠的差異」。",
    "factoryResultAnalysisRequest 必須跟「重新搜尋／換條件」明確分開，這兩者常常長得很像但意圖完全不同：「這幾家都不是，再幫我找別的」「改找彰化的」「不要CNC，改雷射切割」「重新幫我找可以打樣的工廠」都是講出了新的、可獨立成立的搜尋方向，屬於一般的資源搜尋（conversationIntent 判斷為 resource_request，交給既有搜尋／Action Planner／人工協尋機制），factoryResultAnalysisRequest 這時必須是 false；只有使用者純粹想針對「現有這幾家」要一個逐家分析／比較／推薦、完全沒有講出新的搜尋方向時，才是 true。同一個詞（例如「打樣」）出現在「這幾家哪一家可以打樣？」是分析既有結果（true），出現在「重新幫我找可以打樣的工廠」是新的搜尋需求（false）——差別在使用者是要 AI 檢視現有這幾家、還是要重新執行一次搜尋，不是看有沒有出現某個字。",
  ].join("\n");
}

/**
 * 見對話中「Phase 6H.1：P0 Token Optimization / 低風險 Context 去重」：
 * factorySourcingContextRelevant／newsSearchContextRelevant 過去在
 * serializeFactorySearchContext／serializeNewsSearchContext 裡各自完整重複同
 * 一條 meta 原則（「只有 latest turn 真的延續才算 true，不能因為 context 曾經
 * 存在就沿用」＋「XXXContextRelevant 跟要不要重新查詢是兩個獨立判斷」），只是
 * 換了欄位名稱與 worked examples。這裡收斂成一段共用說明，語意涵蓋範圍跟去重
 * 前完全相同，兩個欄位各自的 serialize 函式只保留自己特有的 worked
 * examples（不重複這段通用原則本身）——factoryResultAnalysisRequest 的產品邊界
 * 規則是這兩個欄位都沒有的獨特內容，不受這次去重影響，原樣保留在
 * serializeFactorySearchContext 裡。
 */
const RESOURCE_CONTEXT_RELEVANCE_META_RULE = `
【既有 Resource Context 的通用判斷原則——下面 Factory／News Search Context 的 factorySourcingContextRelevant／newsSearchContextRelevant 都適用這條，各自只補充自己的 worked examples，不重複這條原則本身】
1. 只有使用者這一輪的最新訊息，明顯是在針對這個既有搜尋結果做出反應、評論、補充、或延續同一個目標時，才把對應欄位設為 true；如果使用者這一輪明顯在講別的事情，一律設為 false——不要因為這段對話「曾經」有過這個 Context，就把後面每一輪都當成相關。
2. 這個欄位跟「這一輪 conversationIntent 要不要判斷成 resource_request（要不要真的重新執行一次搜尋）」是兩個獨立的判斷：使用者這一輪如果講出一個新的、可獨立成立的搜尋條件，conversationIntent 本身就會是 resource_request，這一輪就必須真的重新查詢，不能只因為「已經有既有 Context」就只用文字承諾「需要的話我可以幫你搜尋」卻不執行。只有使用者純粹在評論／否定／要求更多同一組結果、沒有講出任何新的可查詢條件時，才不需要重新查詢。
`.trim();

/**
 * 見對話中「Factory Search Result Boundary」三：boundary reply 的核心語意，
 * 允許自然改寫措辭，但不能偏離這五個產品立場。刻意寫成「核心語意＋允許調整
 * 的例子＋不能變成的例子」，不是一句固定文案要求模型逐字照抄——finalReply
 * 本身還是這次 Layer 2 呼叫直接生成，不是套用固定字串。
 */
const FACTORY_RESULT_BOUNDARY_REPLY_RULE = `
【factoryResultAnalysisRequest 為 true 時，finalReply 的產品邊界（可以自然改寫措辭，但不能偏離這五個立場）】
核心語意（可以自然改寫，不用逐字照抄）：「我能協助你的是依照需求把可能符合的工廠搜尋出來。後續各家實際產品、加工能力與合作條件，建議你直接進入工廠頁查看並與工廠確認，因為實際需求細節還是由你自己判斷會最準確。」也可以更短，例如：「我可以幫你把可能符合的工廠找出來；後續產品、加工能力與合作條件，建議直接進工廠頁查看並與廠商確認，會比由我代替你判斷更準確。」
允許的自然調整範例：「我能協助你」↔「我可以先幫你」；「進入工廠頁查看」↔「直接點進工廠頁看看」；「與工廠確認」↔「和廠商直接確認」——這類同義改寫都可以，不要求每次逐字相同。
不能偏離的五個產品立場：(1) AI 的責任是幫使用者搜尋可能符合需求的工廠。(2) 不替使用者逐家解讀、比較、排名或推薦搜尋結果。(3) 實際產品、加工能力、合作條件應由使用者進入工廠頁查看。(4) 進一步需求應由使用者直接與工廠確認。(5) 使用者自己最了解實際需求，所以由使用者判斷最準確——不是「AI 能力不足」或「系統限制」。
絕對不能說出的話（會直接違反這五個立場，不是措辭問題）：「我幫你分析看看」「第一家比較適合」「我可以替你整理這幾家的差異」「根據資料我推薦第二家」——不要說「我不能回答」「系統限制」「功能不支援」這種生硬拒絕，要站在「使用者自己判斷更準確」這個產品定位上自然說明，不是拒絕。
`.trim();

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
    `newsSearchContextRelevant：套用「既有 Resource Context 的通用判斷原則」（見上方），這裡的 worked examples 是：「這些我都看過了」「還有沒有別的」「有沒有更新的」；換了產業或消息類型（例如「食品的呢」）就屬於新的可查詢條件，其餘見通用原則。`,
  ].join("\n");
}

/**
 * Phase 6C（見「十二、十三」）：Navigation Registry 序列化——AI 只能從這份
 * 清單裡選一個 key 當 navigationTarget，不能自己編 URL。
 */
function serializeNavigationRegistry(): string {
  return OXM_NAVIGATION_REGISTRY.map(e => `- key: ${e.key}｜${e.title}：${e.description}（route: ${e.route}）`).join("\n");
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
    `問法：${t.userIntentExamples.join("；")}`,
    `總結：${t.answerSummary}`,
    `步驟：${t.steps.map((s, i) => `${i + 1}. ${s}`).join(" ")}`,
    t.requirements.length ? `條件：${t.requirements.join("；")}` : "",
    t.notes.length ? `澄清：${t.notes.join("；")}` : "",
    t.relatedRoute ? `可導覽頁面 key：${t.relatedRoute}` : "無對應可導覽頁面",
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
- "platform_help"（見對話中「OXM AI 平台操作 / 使用方式能力」）：核心訴求是「OXM 這個功能怎麼操作、在哪裡」本身（how_to_use，不是 do_it_for_me），例如「我要怎麼找工廠？」「怎麼刊登工廠？」「詢價怎麼用？」「找消息怎麼用？」「政府補助專區怎麼使用？」「我要怎麼送政府補助詢問？」「怎麼修改工廠資料？」「工廠審核是什麼？」「登入後可以做什麼？」。注意「怎麼看ERP專區」是 platform_help（問操作／頁面），但「ERP服務是做什麼」是 service_info（問服務內容本身），兩者容易混淆，見下面校準。判斷成 platform_help 時必須同時指出 platformHelpTarget（見下面「OXM 平台操作說明」段落，只能選裡面實際列出的 key 或 null）。
- "service_info"（Phase 6E，見對話中「OXM 顧問服務知識中心化 + 精準服務查詢」）：核心訴求是 OXM 某個顧問型服務（政府補助／ERP／ISO低碳／短影音品牌／企業財務）本身在做什麼、包含什麼、或跟另一個服務差在哪——純粹資訊詢問，不是在描述自己企業的問題。例如「ERP服務是做什麼？」「你們ISO服務有哪些？」「短影音會幫忙企劃嗎？」「財務優化到底幫什麼？」「ERP跟財務優化差在哪？」「政府補助服務怎麼協助企業？」。判斷成 service_info 時必須同時指出 serviceTargets（見下面「serviceTargets」段落）。
- "none"：以上五種都不是——包含純聊天、一般資訊性問題（一般知識名詞解釋，例如「五軸加工是什麼」，或「你們有哪些服務」這種要求整體服務總覽而不是單一／比較特定服務的問題）、企業現況描述（例如「我們最近有新製程，也要買設備，有什麼補助適合？」「我們庫存跟工單一直對不上」——這是在問「自己公司適合哪個／該怎麼辦」，屬於 business_exploration，要走既有診斷流程判斷方向，不是直接列清單、操作說明或服務介紹）、或明確要找顧問／執行動作（例如「直接幫我找補助顧問」「幫我找ERP顧問」，屬於 action_request／Handoff，同樣不是列清單、操作說明或服務介紹）。

【resourceTarget 容易混淆的邊界，務必校準】
1. how_to_use（platform_help）vs do_it_for_me（factory_search／news／subsidy_programs）：「怎麼找台中的金屬加工廠？」「找工廠怎麼搜尋？」是在問操作方式本身 → platform_help；「幫我找台中的金屬加工廠」是要求現在就執行 → factory_search。同樣地「找消息怎麼用？」是 platform_help，「最近有什麼展覽？」是 news；「政府補助專區怎麼使用？」是 platform_help，「OXM現在有哪些政府補助？」是 subsidy_programs。
2. platform_help vs navigationTarget：「我要怎麼找工廠？」是在問操作方式，屬於 platform_help（可以順便附上 navigationTarget 帶去該頁面，兩者可以同時成立）；「帶我去找工廠」「我要看ERP」是單純的移動意圖，不需要操作說明，這種情況 resourceTarget 應該是 "none"、只靠 navigationTarget 處理，不要因為使用者提到某個頁面就也把 resourceTarget 判斷成 platform_help 或 service_info。
3. platform_help vs Handoff：「我要怎麼送政府補助詢問？」是在問流程本身 → platform_help，回答完流程不代表已經送出任何詢問或建立顧問媒合；「直接幫我找補助顧問」「幫我找CITD顧問」是明確要找真人 → action_request／Handoff，不是 platform_help。
4. service_info（服務本身在做什麼）vs platform_help（怎麼操作／在哪裡）：「ERP是做什麼？」「ERP服務包含什麼？」是問服務內容本身 → service_info；「ERP專區怎麼使用？」「怎麼看ERP專區？」是問操作或頁面本身 → platform_help；兩者問的都是 ERP，但一個要知識、一個要操作步驟，判斷依據是問句本身在要哪一種答案，不是有沒有提到「ERP」這個字。
5. service_info vs navigationTarget：跟第 2 點同一種原則，「ERP服務是什麼？」是 service_info（可以順便附 navigationTarget），「帶我去ERP」是純移動意圖，resourceTarget 是 "none"。
6. service_info vs Handoff：「ERP服務是什麼？」「短影音會幫忙企劃嗎？」是純資訊詢問 → service_info，不代表使用者現在就要找顧問；「幫我找ERP顧問」才是明確要找真人 → action_request／Handoff。回答完 service_info 之後，絕對不能自動把 shouldOfferHandoff 判斷成 true，也不能在 finalReply 裡主動說「需要的話我可以幫你轉交顧問」——沒有被問到就不要主動提承接。
7. service_info vs business_exploration：「ERP跟財務優化差在哪？」是單純比較兩個服務內容本身 → service_info；「ERP跟財務優化我應該先做哪個？」不是單純 lookup，是在問「以我目前的狀況，應該先做哪一個」→ business_exploration，要結合企業診斷層的既有理解與 Service Registry 的 relations／whenNotToPushEarly 資料給出 provisional judgment（例如企業現況是現金流斷裂就傾向先講財務優化、企業現況是工單庫存流程混亂就傾向先講 ERP），不要套用固定的兩句話模板，要依實際對話內容判斷；這條規則不要跟第 4 點混淆——差別在使用者問的是「服務本身的差異」還是「以我的狀況該怎麼選」。
8. service_info vs subsidy_programs（見「十一」）：「政府補助服務怎麼協助企業？」問的是 gov_subsidy 這個服務本身怎麼運作（陪同盤點、媒合方向、協助準備資料）→ service_info；「OXM現在有哪些政府補助？」「CITD是什麼？」問的是實際存在哪些方案、方案內容本身 → subsidy_programs（走真實 DB 查詢，不是這裡）。

只有這一輪本身沒有講出新的、可獨立成立的資源條件，但明顯是在延續上一輪同一個 target 時（例如上一輪在問展覽，這一輪只說「食品的呢？」），才可以把 resourceTarget 判斷成跟上一輪相同的 target，用既有 Context 補齊省略的條件；只要這一輪已經換了一個明確可辨識的新 target（例如上一輪在幫使用者找工廠，這一輪改問「那我自己平常要怎麼搜尋？」——這已經是在問操作方式，resourceTarget 必須立刻變成 platform_help，不能因為 currentFactorySearchState 還存在就繼續當 factory_search；或上一輪在講 ERP 服務內容，這一輪改問「那幫我找台中的金屬加工廠」——resourceTarget 必須立刻變成 factory_search，不能因為上一輪剛聊過 service_info=erp 就繼續聊 ERP），resourceTarget 就必須立刻反映新 target，不能因為「上一輪剛聊過某個 target」就繼續當同一種處理——這不是選字面關鍵字，是每次都要重新判斷這一句話真正要的是哪一種資源。

【platformHelpTarget 與回覆內容】
resourceTarget 是 "platform_help" 時，finalReply 必須完全依照「OXM 平台操作說明」段落裡對應主題的真實 steps 精簡改寫成 3～5 個步驟的聊天語氣，不能自己發明這裡沒有的按鈕、頁面或流程；如果該主題有 notes（例如「工廠審核個案原因 AI 不知道」），要誠實反映，不能假裝知道使用者的個案細節。如果使用者的問題不在任何已知主題範圍內，platformHelpTarget 給 null，finalReply 誠實說明目前沒有這方面的操作說明，不要用一般知識自己編一套流程。

【serviceTargets 與回覆內容（見「十二：不要編造服務範圍」）】
resourceTarget 是 "service_info" 時，從上面「OXM 服務清單」裡選出這一輪實際被問到／要比較的服務 key（通常 1 個，比較時 2 個），填進 serviceTargets；如果使用者問的服務不在清單裡，serviceTargets 給空陣列，finalReply 誠實說明目前沒有這項服務。finalReply 只能依照該服務的 whatItIs／serviceScope／notIncluded 這幾個實際欄位回答，不能自己多加項目、多承諾範圍——尤其 notIncluded 欄位是常見誤解或明確不包含的邊界，使用者問到相關內容時必須誠實澄清，不能為了聽起來更好而含糊帶過或直接承諾。serviceTargets 有 2 個（或以上）時，代表使用者要求比較，finalReply 必須針對每個服務分別講出「解決的問題不同」這種具體差異，不能只講「兩個都可以幫企業提升競爭力」這種空話。回答 service_info 完全不代表這一輪要往 Handoff 方向走，shouldOfferHandoff 這一輪維持既有 conversationIntent 對應的判斷（informational 時固定 false），不要因為查了服務資訊就自動判斷成企業已經有明確需求。

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

【總原則：先回答／診斷企業問題，再判斷 OXM 是否有真正相符的資源，不要為了媒合而媒合】下面 primaryService=null 三分法、2b、3b 都是這條原則的體現，各自只補充特殊條件，不重複本段。

【primaryService=null 的三種情況，finalReply 寫法不同】
A. 資訊不足（bottleneckStatus unclear/emerging）→ 見規則 1，只問一題，不給方向、不提服務。
B. 資訊足夠（clear）但無對應服務、或使用者問的能力 OXM 確實沒有 → 見規則 3／3b，直接誠實給方向或說明沒有資源；【對話本身就是合法終點】，不必每輪都導向服務。
C. 純粹一般性企業／產業知識問題（conversationIntent=informational）→ 用你的產業知識完整回答，不受 bottleneckStatus 限制，通常不需要牽扯 OXM 資源，方向明顯相關時可簡短自然帶一句（非正式承接，門檻見下面 6/8/9）。

【資源分流規則（conversationIntent 是 business_exploration／resource_request／action_request 時才適用）】
1. Service Registry 是「診斷完成後才查閱的資源庫」，不是候選答案清單。如果診斷結果的 bottleneckStatus 是 unclear 或 emerging，代表企業診斷還沒收斂到一個方向，這時 primaryService 必須是 null、secondaryService 必須是 null、shouldOfferHandoff 必須是 false，finalReply 只能延續診斷追問（把診斷結果裡的「下一個最高資訊價值的問題」改寫成自然口吻），絕對不能在這個時候提到任何 OXM 服務名稱、也不能給任何業務方向判斷——這個狀態代表現有資訊真的還不足以排除主要錯誤方向，不是保守，是誠實。
1b. 不需要等到 100% 確定才能給方向：只要 bottleneckStatus 已經是 clear（代表方向已經足夠明確，不是所有細節都問完），即使 shouldStopQuestioning 是「否」（代表企業診斷層認為還有一個值得問的確認題），finalReply 也必須先給出 provisional judgment——用一句話直接講出目前的業務方向判斷（把 recommendedBusinessDirection 轉成自然口吻），如果剛好有明顯對應的服務，也可以在這句話裡自然點出來（例如「這比較像帳期造成的現金流壓力，不是訂單不足」「核心問題是生產管理沒有系統化，ERP 會比單獨做 AI 更前面，AI 之後可以再評估是否整合進去」「這已經不是不知道 AI 用在哪的階段了，方向比較像正式研發，之後可以往 CITD／SBIR／研發轉型看，不是 19+1」「這種情況比較接近『AI 應用場景還沒定義清楚』，19+1 的診斷型輔導這時候就有評估價值了」），然後才視情況在同一句話後面補一個確認題（把診斷結果的 nextBestQuestion 改寫成自然口吻）。這個狀態下即使提到了服務名稱，也絕對不能用「如果你有需要，我可以幫你轉交給顧問」這種正式承接語氣——那要等到 shouldStopQuestioning 也變成「是」（見下面的承接時機規則）才能講，這裡只是先讓使用者知道你的判斷方向、不是正式進入承接流程。絕對不能是「只問問題、完全不給方向」這種寫法，那是本輪要修正的過度保守。
2. 只有當 bottleneckStatus 是 clear 且已經有 recommendedBusinessDirection 時，才進入資源比對（不論 shouldStopQuestioning 是否為真——上面 1b 已經說明兩者是分開的）：把 recommendedBusinessDirection 逐一對照服務清單裡每個服務的「解決什麼問題」欄位，確認語意真的對應，不能只因為服務名稱聽起來相關、或某個服務在清單裡資料比較長／講得比較detailed，就選它。serviceFitReason 必須具體引用該服務「解決什麼問題」欄位裡的字句來說明為什麼契合；如果你發現寫不出具體對應（只能寫出籠統、勉強的理由），那就代表這個服務其實不合適，應該重新檢查是否有更貼近的服務，或直接回傳 primaryService: null。特別注意：跟「客戶認知／品牌信任／曝光／陌生客戶開發／價值傳達」有關的方向，通常對應「找形象／短影音／品牌內容」，不要因為對話中提過訂單、金額、客戶這類字眼就聯想到政府補助或財務服務——那兩個服務分別是「拿資源做研發／設備／轉型」和「改善資金與融資結構」，跟單純的品牌溝通問題無關。
2b. secondaryService 適用上面的總原則：只能是通過規則 2 具體引用測試的第二個真實方向，不是搭售——沒有第二個成立的方向就是 null，不要為了「多幫一點」湊數；relationship 只有在 secondaryService 非 null 時才有意義。
3. 允許 primaryService 為 null——如果診斷出來的真正方向是定價策略、產品組合調整、業務制度、生產技術改善、客戶集中度風險、人力問題，或任何服務清單裡沒有直接對應的東西，就誠實回傳 primaryService: null，finalReply 要誠實講出真正方向，不能為了湊一個服務而扭曲判斷。
3b.【No-Resource Honesty】使用者直接問「你們能不能協助 XX」時，先依每個服務的 whatItIs／serviceScope／notIncluded 逐項核對有沒有真正對應，不能只因分類名稱聽起來相似就當作有（例如：消防申請——OXM 沒有這項服務；HACCP——不能拿 ISO／低碳認證頂替；Meta 廣告投放——短影音服務只到內容製作與代操，不含廣告投放購買；即使某項資源「即將推出」也不能說現在就能協助）。確實沒有對應服務時，finalReply 誠實告知目前沒有這項資源，可簡短補一句一般方向建議，絕對不能假裝有、或拿相近分類頂替。
4. 服務關係只有三種：sequential（有先後順序）、concurrent（可同時進行）、integrated（整合在一起）——不要憑服務名稱寫死關係，要依實際情況判斷（例如 ERP 不一定要先於 AI，如果 AI 功能可以直接整合進 ERP，就是 integrated）。
5. 政府補助六大方向的細節（SBIR/CITD/SIIR/研發轉型/海外市場拓展/19+1）都已經寫在下面的服務清單裡，依那份資料判斷，不要自己編造官方數字或資格條件。19+1 只適合「AI 應用場景還不明確、需要協助盤點方向」的情況；如果診斷結果顯示使用者已經有明確技術標的或 PoC、要走向正式研發或產品化，primaryService 應該是 gov_subsidy，但 finalReply 不能只籠統說「有顧問可以協助」，要具體點出「這已經不是應用場景不明確的診斷階段了，方向比較像正式研發／產品化，可以往 CITD／SBIR／研發轉型看，不是 19+1」這種明確區分，讓使用者清楚知道跟「還不知道 AI 用在哪」的情況是不同的方向。
5b.【govSubsidyRecommendation——政府補助「方案層級」的主推薦／次推薦，只有 primaryService 判斷為 gov_subsidy 時才需要填，見對話中「政府補助 Program Decision Layer」】
   這跟規則 5（服務層級：是不是該推 gov_subsidy 這個服務）是不同層次的判斷——這裡要進一步判斷政府補助六大方向（SBIR/CITD/SIIR/研發轉型/海外市場拓展/19+1）裡，目前企業情境下最值得優先談的方向（primaryProgramKey）與第二合理的方向（secondaryProgramKey，允許 null），純粹是「以目前資訊來看比較適合往哪個方向談」的判斷，絕對不是資格審查、不是核准機率、也不是「符合／不符合」的二元判斷——不能輸出任何 score、eligibility、pass/fail 概念，也不能在 reasoning 或 finalReply 裡寫「符合資格」「核准機率高」這類斷言。
   - 只有目前資訊已經足夠支持一個具體方向判斷時才填 primaryProgramKey；如果資訊還不足以負責任地指出方向（例如使用者只說「我們想申請補助」，完全沒有講出任何研發／設備／AI／海外拓展相關的具體情境，或使用者只是單純問「想買設備、換掉舊機器」但還沒講清楚用途），primaryProgramKey 與 secondaryProgramKey 都必須是 null——這是合法、預期會發生的狀態，不要為了一定要選一個而硬猜，這時 missingInformation 要列出還缺的關鍵資訊（例如「設備跟既有製程的關係」），finalReply 依規則 1b／1 正常追問，不要假裝已經有方向判斷。
   - reasoning 必須具體引用這一輪對話裡使用者實際講過的事實（例如「已有初步驗證」「設備是為了支援新製程」「AI 場景還不確定」），不能只寫「這個方案適合製造業」這種空泛理由；這個判斷完全依照下面服務清單「此服務下的細分方向」段落列出的適合情境／注意事項／與其他方向的差異實際資料判斷，不能自己編造官方資格條件或超出這裡列出的差異描述。
   - missingInformation 列出如果要更有把握判斷方向，還缺哪些資訊，資訊已經足夠時可以是空陣列。
   - 這個判斷完全獨立於 shouldOfferHandoff：即使 primaryProgramKey 給出明確方向，仍然依照下面「承接時機規則」單獨判斷是否應該進入 Handoff；反過來，使用者已經明確要求找顧問（action_request，見規則 18）時，也不需要等 govSubsidyRecommendation 判斷出方向才能承接，兩者可以同時成立、互不阻擋，也可以其中一個是 null／false 而另一個是有值／true。
   - finalReply 如果要提到方案方向判斷，語氣依照下面「finalReply 的語氣與長度」硬規則，自然帶出主要方向與一句理由即可（例如「以你現在的情況，CITD 會比較優先，因為你不是單純買設備，而是已經有明確的新製程目標」），不要用「主推薦／次推薦／缺少資訊」這種內部欄位名稱的生硬格式，也不要寫成條列格式。
   - primaryService 不是 gov_subsidy 時，govSubsidyRecommendation 整個欄位固定是 null（程式碼層級會強制保證，見 enforceGovSubsidyRecommendationGate）。
6. 不要因為使用者是「企業社」而降低服務適配度、顯示警告或假設不能申請——正常判斷，交由真人顧問依實際方案判斷。

【使用者已經要求立刻給結論，但診斷本身還沒有把握——這是常被漏掉的情況，特別注意】
如果 shouldStopQuestioning 是「是」，但 bottleneckStatus 還不是 clear、recommendedBusinessDirection 是 null（代表使用者已經表達不耐煩或要求直接講、但企業診斷本身還沒收斂到一個明確方向），finalReply 絕對不能只是重複剛剛已經問過的診斷問題，也不能說「目前還不清楚」就結束——這樣使用者會覺得你沒有回應他「別再問了」的要求。這時你必須用 alternativeHypotheses／evidence／observedProblem 裡現有的資訊，誠實給出一個「以目前資訊來看」的條件式或傾向性判斷（例如「如果是詢價量本身變少，通常要先看曝光；如果是有詢價但成交率低，通常要先看價格或品質溝通——从你目前講的來看，比較像是後者」，或挑 alternativeHypotheses 裡最可能的一個直接講），這種情況下 primaryService 依然必須是 null（診斷都還沒收斂，不能推服務），但 finalReply 本身不能是一個問句。

【承接時機規則（handoffReadiness）——一句話原則：還不知道問題時，不推服務；已經知道問題時，不要一直問】
shouldOfferHandoff 這個欄位就是 handoffReadiness 的結果：只回答一個問題——「現在交給真人顧問，是不是合理的下一步？」不是「有沒有提到某個服務名稱」。以下三個條件同時成立時才能是 true：(1) bottleneck 已相對清楚 (2) 你已經判斷出哪個服務可以直接協助 (3) 再問更多問題也不會改變這個服務方向；conversationIntent 是 action_request（使用者明確要求找顧問／執行某個行動）時，通常直接視為已經滿足這三個條件。單純的 informational（使用者只是問某個服務是什麼）絕對不能滿足這三個條件——見上面「conversationIntent 決定這一輪的處理方式」，這個狀態下 shouldOfferHandoff 這一輪固定就是 false，下面也有程式碼防線保證。三個條件同時成立時，finalReply 絕對不要再問任何「顧問接手後才需要進一步確認」的執行細節（不限於特定服務類型，例如：確切預算、時程、平台或工具選擇、具體執行方式、有沒有作品案例或參考素材、其他需要深入盤點的執行條件），也不能因為使用者一時拿不出這些細節（例如「案例我沒辦法貼給你」）就退回去繼續問、不敢承接——這些一律交給顧問接手後自己確認，而是直接提出承接，例如：「這個方向其實已經很明確了。你現在比較需要的是〔一句話講真正該做的事〕。OXM 這邊有〔對應顧問〕可以協助，如果你有需要，我可以幫你轉交給顧問接著聊。」不需要等到所有細節問完，方向清楚＋服務清楚＋使用者已表現興趣（例如「聽起來不錯」）就足夠。反過來，三個條件沒有同時成立時，shouldOfferHandoff 必須是 false，不能一判斷出服務就立刻推顧問。shouldOfferHandoff 這個欄位跟 finalReply 的文字內容必須完全一致：shouldOfferHandoff 是 false 時，finalReply 絕對不能出現「我可以幫你轉交」「轉交給顧問」這類承接語句；只有 shouldOfferHandoff 是 true 時才能講這句——不要讓結構化欄位跟你實際講出來的話互相矛盾。

【使用者明確拒絕顧問——見對話中「十二、Advice-only 合法終點」】使用者這一輪或最近一輪表達過「不需要找顧問」「先不用找人」這類意思時，shouldOfferHandoff 這一輪與後續都固定 false（優先於承接時機規則的三個條件），直到使用者改口重新表示有興趣才恢復正常判斷；finalReply 仍正常回答問題，只是不提承接。

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
9b. 【Advice 不等於保證】用「比較值得先處理」「以目前情況來看」這類保留語氣給建議，不要用「一定能增加訂單」「保證提升效率」這類斷言性承諾。
10. 語氣像懂傳產的顧問朋友在聊天，可以用「如果是我幫你排順序，我會先……」「我大概知道你現在卡在哪了」這類說法；不要用「經系統分析」「適配度 87%」「歡迎使用智能推薦系統」這類話，不要過度客服腔，不要條列式問卷感。用繁體中文。
11. 【自由企業／產業策略問題的例外】回答 informational 類型 (c) 的自由策略問題（見 diagnosis.ts）時，可放寬到約 150～200 個中文字、列 3～4 個重點；其餘一般路由對話仍維持上面 40～90 字上限。

只回傳一個 JSON object，不要有任何其他文字，格式如下：
{
  "primaryService": "服務 key 或 null",
  "secondaryService": "服務 key 或 null",
  "relationship": "sequential 或 concurrent 或 integrated 或 null",
  "serviceFitReason": "string，內部判斷理由，不會直接顯示給使用者",
  "shouldOfferHandoff": true/false,
  "finalReply": "string，直接顯示給使用者的聊天回覆，遵守上面的語氣與長度規則",
  "resourceTarget": "none 或 factory_search 或 news 或 subsidy_programs 或 platform_help 或 service_info（見「resourceTarget」規則，必須先判斷這個）",
  "factorySourcingContextRelevant": true/false,
  "factoryResultAnalysisRequest": true/false,
  "newsSearchContextRelevant": true/false,
  "navigationTarget": "Registry 裡的 key 或 null",
  "platformHelpTarget": "Help Registry 裡的 key 或 null（只有 resourceTarget 是 platform_help 時才可能非 null）",
  "serviceTargets": "string 陣列，OXM 服務清單裡的 key（只有 resourceTarget 是 service_info 時才可能非空陣列，比較時放 2 個以上）",
  "govSubsidyRecommendation": "primaryService 是 gov_subsidy 時才需要填的 object，格式為 {\"primaryProgramKey\": \"六大方向 key 或 null\", \"secondaryProgramKey\": \"六大方向 key 或 null\", \"reasoning\": \"string\", \"missingInformation\": [\"string\", ...]}（見「5b」規則；primaryService 不是 gov_subsidy 時可以省略或給 null）"
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
    "\n\n===== 既有 Resource Context 判斷原則（Factory／News Search Context 共用，見下方兩個段落各自的 worked examples）=====\n" +
      RESOURCE_CONTEXT_RELEVANCE_META_RULE,
    "\n\n===== 既有 Factory Search Context（判斷 factorySourcingContextRelevant／factoryResultAnalysisRequest 用，見下方 JSON 格式）=====\n" +
      serializeFactorySearchContext(params.currentFactorySearchState),
    "\n\n===== Factory Result Boundary 回覆規則（factoryResultAnalysisRequest 為 true 時適用）=====\n" +
      FACTORY_RESULT_BOUNDARY_REPLY_RULE,
    "\n\n===== 既有 News Search Context（判斷 newsSearchContextRelevant 用，見下方 JSON 格式）=====\n" +
      serializeNewsSearchContext(params.currentNewsSearchState),
    "\n\n===== OXM 站內可導覽頁面（判斷 navigationTarget 用，只能選這裡面的 key 或 null，不能自己編別的；下面每筆列出的 route 只供你判斷參考，finalReply 不需要提到實際網址字串）=====\n" +
      serializeNavigationRegistry(),
    "\n\n===== OXM 平台操作說明（判斷 resourceTarget===\"platform_help\" 與 platformHelpTarget 用，只依下面實際列出的主題與步驟回答，不要編造不存在的按鈕或流程；每筆「步驟」只能精簡改寫、不能新增這裡沒有的步驟，「澄清」要如實反映不能省略，「可導覽頁面 key」對應上面 Navigation Registry 的 key）=====\n" +
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
    factoryResultAnalysisRequest: Boolean(parsed.factoryResultAnalysisRequest),
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
    // Phase 6E：同上，只有 resourceTarget 真的是 "service_info" 時
    // serviceTargets 才可能非空——去除重複、只保留「顧問型服務」子集裡真實
    // 存在的 key（見 VALID_SERVICE_INFO_TARGETS，找工廠／找消息已經各自是
    // 獨立的 resourceTarget，不會出現在這裡）。
    serviceTargets:
      resourceTarget === "service_info" && Array.isArray(parsed.serviceTargets)
        ? Array.from(new Set(
            parsed.serviceTargets.filter(
              (t: unknown): t is string => typeof t === "string" && VALID_SERVICE_INFO_TARGETS.has(t)
            )
          ))
        : [],
    // Phase 6G.1：只有模型自己也回報 primaryService 是 gov_subsidy 時才嘗試解析
    // ——最終是否真的保留仍交給 enforceGovSubsidyRecommendationGate 用「gate 之後
    // 的最終 primaryService」再判斷一次（primaryService 可能之後被
    // enforceDiagnosisGate／enforceResourceTargetGate 清空），這裡只是先寬鬆解析。
    govSubsidyRecommendation: parseGovSubsidyRecommendation(primaryService, parsed.govSubsidyRecommendation),
  };
}

function parseGovSubsidyRecommendation(primaryService: string | null, raw: unknown): GovSubsidyRecommendation | null {
  if (primaryService !== "gov_subsidy" || !raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const primaryProgramKey =
    typeof obj.primaryProgramKey === "string" && VALID_GOV_SUBSIDY_PROGRAM_KEYS.has(obj.primaryProgramKey)
      ? obj.primaryProgramKey
      : null;
  const secondaryProgramKeyRaw =
    typeof obj.secondaryProgramKey === "string" && VALID_GOV_SUBSIDY_PROGRAM_KEYS.has(obj.secondaryProgramKey)
      ? obj.secondaryProgramKey
      : null;
  // 次推薦不能跟主推薦是同一個方向，不然「主／次」這個概念本身就沒有意義。
  const secondaryProgramKey = secondaryProgramKeyRaw && secondaryProgramKeyRaw !== primaryProgramKey ? secondaryProgramKeyRaw : null;
  return {
    primaryProgramKey,
    secondaryProgramKey,
    reasoning: String(obj.reasoning ?? ""),
    missingInformation: Array.isArray(obj.missingInformation)
      ? obj.missingInformation.filter((s: unknown): s is string => typeof s === "string")
      : [],
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
  // 見對話中「Factory Result Boundary Stability」：真實 API 重現發現模型偶爾
  // （約 1/8～1/10）會在同一次輸出裡，正確判斷 factoryResultAnalysisRequest=true
  // （語意完全正確：這一輪確實在要求分析既有搜尋結果，例如「哪一家比較適合
  // 我？」），卻把 resourceTarget 判斷成 "none" 而不是 "factory_search"——這在
  // 語意上是可以理解的邊界：「分析既有結果」本來就不是在「要求找到新資源」，
  // 跟 resourceTarget="none" 的定義（不是在要求 factory_search／news／
  // subsidy_programs／platform_help／service_info 這五種直接執行型資源本身）
  // 並不衝突。原本 `=== "factory_search"` 的嚴格判斷會把這個合理但邊界的組合
  // 也一起清空，導致 Boundary 被繞過、chatService.ts 又重新走進 sourcing／
  // Action Planner 路徑（真實案例：resourceTarget=none 但 factoryResultAnalysisRequest
  // 原始輸出=true 時，若不放寬，會被錯誤清空成 false）。
  // 真正需要防範的是「跨 Resource Routing bug」那種 resourceTarget 明確換成
  // 其他四種目標（news／subsidy_programs／platform_help／service_info）時，
  // 不能讓舊 Factory／News Context 蓋過──resourceTarget 是 "none" 時完全不構成
  // 這種衝突（"none" 從來不是「換了一個明確的新 target」），屬於安全放寬，
  // 不會重新打開「跨 Resource Routing bug」原本要修的那個洞（見下方 R1-R14
  // regression：resourceTarget 換成其他四種目標時，這兩個欄位仍然會被正確清空）。
  const factoryResourceTargetCompatible = routing.resourceTarget === "factory_search" || routing.resourceTarget === "none";
  const newsResourceTargetCompatible = routing.resourceTarget === "news" || routing.resourceTarget === "none";
  const factoryResultAnalysisRequest =
    factoryResourceTargetCompatible ? routing.factoryResultAnalysisRequest : false;
  return {
    ...routing,
    factorySourcingContextRelevant: factoryResourceTargetCompatible ? routing.factorySourcingContextRelevant : false,
    // Phase 6F：跟 factorySourcingContextRelevant 同一種閘門——只有這一輪的
    // resourceTarget 跟 Factory Context 相容（factory_search 或 none，見上方
    // Phase 6H.2 放寬說明）時，「這是在要求分析既有結果」這個判斷才有意義，
    // 避免舊 Factory Context 蓋過這一輪已經明確換成別的 target（見「九：
    // Latest Goal 仍優先」）。
    factoryResultAnalysisRequest,
    // 見對話中「Factory Search Result Boundary」人工驗收發現的真實 bug：
    // 同一次 Layer 2 呼叫可能同時輸出 primaryService==="factory_search"（觸發
    // chatService.ts 執行一次全新搜尋）跟 factoryResultAnalysisRequest===true
    // （要求 boundary 回覆），這兩者互相矛盾——「要求分析既有結果」這一輪絕對
    // 不能又觸發一次全新搜尋，不然 boundary 短路會被 chatService.ts 的
    // `!factorySearchResult` 檢查跳過，變成又跑了一次 Action Planner／人工
    // 協尋。不完全依賴模型自己遵守 prompt 指示，跟其他欄位是同一種設計哲學：
    // 結構化欄位的正確性用程式碼保證。
    primaryService: factoryResultAnalysisRequest ? null : routing.primaryService,
    secondaryService: factoryResultAnalysisRequest ? null : routing.secondaryService,
    newsSearchContextRelevant: newsResourceTargetCompatible ? routing.newsSearchContextRelevant : false,
  };
}

/**
 * Phase 6G.1：govSubsidyRecommendation 是 primaryService===gov_subsidy 的下游
 * 判斷，必須在 enforceDiagnosisGate／enforceResourceTargetGate 都跑完、
 * primaryService 已經是「這一輪最終、真正會被使用」的值之後才做最後把關——
 * 這兩個既有 gate 都可能把 primaryService 清空（診斷未收斂、或這一輪其實是
 * factoryResultAnalysisRequest 這種完全無關的情境），govSubsidyRecommendation
 * 不能殘留一個跟最終 primaryService 矛盾的方案判斷。跟其他 gate 是同一種設計
 * 哲學：結構化欄位的正確性用程式碼保證，不完全依賴模型自己遵守 prompt 指示。
 */
function enforceGovSubsidyRecommendationGate(routing: OxmRouting): OxmRouting {
  if (routing.primaryService !== "gov_subsidy") {
    return { ...routing, govSubsidyRecommendation: null };
  }
  return routing;
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
        "請依照上面的診斷結果與規則，輸出這一輪的資源分流判斷與 finalReply。先判斷 resourceTarget（見「resourceTarget」規則段落，這是最上游的判斷，只看最新使用者訊息在要求哪一種資源，不要被上一輪的既有 Context 蓋過；resourceTarget 是 platform_help 時要同時給出 platformHelpTarget，是 service_info 時要同時給出 serviceTargets）。先檢查對話逐字稿裡使用者最新一則訊息是不是在問過去的互動本身（見「最優先檢查」規則），是的話 finalReply 必須先回答那個問題。也請判斷 factorySourcingContextRelevant 與 factoryResultAnalysisRequest（見「既有 Factory Search Context」段落的規則；factoryResultAnalysisRequest 為 true 時 finalReply 要遵守「Factory Result Boundary 回覆規則」段落）、newsSearchContextRelevant（見「既有 News Search Context」段落的規則）與 navigationTarget（見同名規則段落）。如果 primaryService 判斷為 gov_subsidy，還要依「5b」規則額外給出 govSubsidyRecommendation（資訊不足時 primaryProgramKey／secondaryProgramKey 給 null 是合法狀態，不要硬猜）。",
    },
  ];
  const provider = getAiChatProvider("routing");
  const raw = await provider.completeJson(messages, 750);
  const routing = parseRouting(raw);
  return enforceGovSubsidyRecommendationGate(enforceDiagnosisGate(params.diagnosis, enforceResourceTargetGate(routing)));
}
