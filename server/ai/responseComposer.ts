import { getAiChatProvider, type AiChatMessage } from "./provider";
import { serializeHistory } from "./serialize";
import type { AiChatTurn } from "./types";
import type { FactorySearchStateSnapshot } from "./factorySearchState";
import type { NewsSearchStateSnapshot } from "./newsSearchState";
import type { ActionReasonCategory } from "./actionPlanner";
import type { OxmActionKey } from "./actionRegistry";
import type { SubsidyProgramsActionResult } from "./subsidyProgramsAction";

/**
 * Final Response Composer（見對話中「OXM AI 已完成功能整體驗收修正」十一）。
 *
 * 這是 Tool/Action Result 產生之後、真正組出使用者會看到的那句話的唯一地方
 * ——正式把「決定下一步 Action」（server/ai/actionPlanner.ts）跟「這一輪該
 * 說什麼」拆成兩個獨立責任，因為人工驗收發現合在一起容易讓 decision 與
 * wording 前後不一致（例如 decision 判斷要重新搜尋，wording 卻只承諾「需要
 * 的話我可以幫你搜尋」）。
 *
 * 只有在跟工廠搜尋相關的這一輪才會被呼叫（見 chatService.ts 的
 * shouldPlanFactoryAction 判斷，跟 Action Planner 共用同一個 gate）——這是
 * 這一輪唯一允許新增的 LLM call，一般企業診斷對話完全不會多打這一次（見
 * 「三十二」呼叫次數盤點）。
 *
 * 這一層必須看得到「真實發生了什麼」，不能只看 AI 自己的決定：
 * - 本輪是否真的執行過 search_factories（isFreshSearch），還是延續舊的
 *   snapshot（沒有重新查）。
 * - 結構化搜尋狀態 MATCH_FOUND／SIMILAR_ONLY／NO_HARD_CANDIDATE（見
 *   factorySearchAction.ts 的 FactorySearchStatus）。
 * - Action Planner 的決定（如果有跑）。
 * - 那個決定「實際執行」的結果——成功／失敗／完全沒有要執行的 action，
 *   這一項一律由 chatService.ts 依真實 DB 寫入結果傳進來，不信任 AI 自己
 *   猜測或樂觀假設。
 */

export type FactoryActionOutcome = "succeeded" | "failed" | "not_applicable";

export interface ComposerFactorySearchInput extends FactorySearchStateSnapshot {
  /** true＝這一輪真的執行了新的 search_factories；false＝延續既有 snapshot，這一輪沒有重新查詢。 */
  isFreshSearch: boolean;
}

/**
 * Phase 6B（見對話中「找消息」）：跟 ComposerFactorySearchInput 同一種角色，
 * 給找消息這一輪用。跟工廠搜尋互斥——同一輪只會有其中一個有值，不會同時
 * 出現（見 chatService.ts 的呼叫端判斷）。
 */
export interface ComposerNewsSearchInput extends NewsSearchStateSnapshot {
  /** true＝這一輪真的執行了新的 search_news；false＝延續既有 snapshot，這一輪沒有重新查詢。 */
  isFreshSearch: boolean;
}

/**
 * Phase 6C（見對話中「政府補助資訊查詢 ≠ Handoff」）：跟
 * ComposerFactorySearchInput／ComposerNewsSearchInput 同一種角色，給政府補助
 * 方案查詢這一輪用。跟工廠搜尋／找消息互斥——同一輪只會有其中一個有值。
 * 沒有 isFreshSearch 欄位：這個 Action 沒有持久化的 currentSubsidyQueryState
 * （見對話中「十九：不要為了形式硬加」），每次觸發都是當輪即時查詢，固定就是
 * 新鮮結果。
 */
export interface ComposerSubsidyQueryInput extends SubsidyProgramsActionResult {}

export interface ComposerActionInput {
  action: OxmActionKey | "none";
  reasonCategory: ActionReasonCategory;
  /** 見 FactoryActionOutcome：只有 request_factory_sourcing／cancel_factory_sourcing 才有 succeeded/failed 兩種結果，action 是 none 時固定是 not_applicable。 */
  outcome: FactoryActionOutcome;
}

function serializeComposerFactorySearchInput(input: ComposerFactorySearchInput): string {
  const lines = [
    input.isFreshSearch
      ? "這一輪剛剛真的重新執行了一次工廠搜尋，下面是這次的真實結果："
      : "這一輪沒有重新搜尋，下面是延續自稍早某一輪、目前仍然有效的搜尋狀態：",
    `Hard Filters：地區＝${input.hardFilters.regions.join("、") || "（無）"}；主產業＝${input.hardFilters.mainIndustries.join("、") || "（無）"}`,
    `使用者這次真正要找的核心能力：${input.coreCapabilities.join("、") || "（沒有指定特定能力，只要求符合地區／產業本身）"}`,
    `結構化狀態：${input.status}`,
    input.status === "NO_HARD_CANDIDATE"
      ? "NO_HARD_CANDIDATE 的意思：平台上目前真的沒有任何一家工廠符合這組地區／主產業條件（Hard Filter 候選集合是 0 家）——你的回覆必須誠實講清楚「目前 OXM 工廠資料中還沒有找到符合條件的工廠」，絕對不能提到任何工廠名稱或列出候選（因為根本沒有），也絕對不能拿之前其他輪搜尋過的工廠來充數。"
      : input.status === "SIMILAR_ONLY"
        ? `SIMILAR_ONLY 的意思：Hard Filter 候選集合有 ${input.candidateCount} 家，但沒有任何一家的公開資料能明確確認使用者真正要的核心能力（${input.missingCoreCapabilities.join("、")}）——你的回覆必須先誠實講清楚「真正要的能力目前沒有在平台上明確找到」，再自然地說下面列出的是同樣符合地區／產業條件、可以先參考看看的相似工廠，讓使用者清楚知道這兩件事是分開的，不能讓使用者誤以為已經找到真正符合的工廠。`
        : `MATCH_FOUND 的意思：候選集合有 ${input.candidateCount} 家，其中 ${input.directCapabilityMatchCount} 家的公開資料明確符合使用者要的能力（或使用者這次本來就只要求符合地區／產業，沒有特別指定能力）——可以自然、有信心地說明找到了符合的工廠。`,
    input.topResults.length > 0
      ? "目前候選前幾名（安全摘要，只能用這裡列出的公司名稱，不能自己編造）：\n" +
        input.topResults.map(c => `- ${c.companyName}（${c.region}，相關度：${c.relevanceTier}）`).join("\n")
      : "目前沒有任何候選可以列出。",
  ];
  return lines.join("\n");
}

/**
 * Phase 6B（見對話中「找消息」）：跟 serializeComposerFactorySearchInput 同一種
 * 角色。找消息目前沒有人工協尋這類後續 action（見「十三」），0 results 一律
 * 誠實告知，不能編造消息、不能自動上網搜尋、不能假裝有結果、不能顯示舊卡片
 * （這件事本身由 chatService.ts 保證：newsSearch 只在這一輪真的執行過
 * search_news 時才會帶有效的 topResults，不會 fallback 舊資料）。
 */
function serializeComposerNewsSearchInput(input: ComposerNewsSearchInput): string {
  const categoryLabels: string[] = [];
  if (input.categoryFilters.isExhibition) categoryLabels.push("展覽");
  if (input.categoryFilters.isCompetition) categoryLabels.push("競賽");
  if (input.categoryFilters.isImportant) categoryLabels.push("重要消息");
  if (input.categoryFilters.isCrossIndustry) categoryLabels.push("跨產業資訊");
  const lines = [
    input.isFreshSearch
      ? "這一輪剛剛真的重新執行了一次消息搜尋，下面是這次的真實結果："
      : "這一輪沒有重新搜尋，下面是延續自稍早某一輪、目前仍然有效的搜尋狀態：",
    `搜尋條件：類型＝${categoryLabels.join("、") || "（無）"}；產業＝${input.industryNames.join("、") || "（無）"}；關鍵字＝${input.keywords.join("、") || "（無）"}`,
    input.resultCount === 0
      ? "目前 OXM 的消息資料裡完全沒有找到符合這組條件的內容——你的回覆必須誠實講清楚「目前 OXM 的消息資料裡還沒有找到符合這個條件的內容」，絕對不能編造消息、不能說要幫忙上網查、不能列出任何消息標題（因為根本沒有），也絕對不能拿之前其他輪搜尋過的消息來充數。這個 Phase 目前沒有人工找消息的後續服務，不要說「可以幫你留意」「我會通知你」這類承諾。"
      : `找到 ${input.resultCount} 則符合的消息，可以自然、有信心地說明找到了相關消息。`,
    input.topResults.length > 0
      ? "目前候選前幾則（安全摘要，只能用這裡列出的標題，不能自己編造）：\n" +
        input.topResults.map(c => `- ${c.title}（相關度：${c.relevanceTier}）`).join("\n")
      : "目前沒有任何候選可以列出。",
  ];
  return lines.join("\n");
}

/**
 * Phase 6C：見「來源權威」——資訊優先序是 (1) 下面列出的 DB 真實方案資料，
 * (2) registryOnlyMatch（Service Registry 既有知識，只在 DB 完全沒有對應
 * 資料時才當背景知識用），(3) 對話目前事實。DB 與舊 prompt 靜態知識衝突時，
 * DB 資料優先——這裡刻意不把 Service Registry 完整內容餵進來，只在 DB 查無
 * 資料時才附上單一相關側寫，避免走回「AI 自己背一份固定清單」的老路。
 */
function serializeComposerSubsidyQueryInput(input: ComposerSubsidyQueryInput): string {
  const lines = [
    `目前 OXM 啟用中的政府補助方案共 ${input.totalActiveCount} 個。`,
    input.compareMode
      ? "使用者這一輪是在比較多個方案，回覆時針對下面列出的每個方案分別講清楚差異（適合對象／核心用途／重要限制），不要漏掉任何一個被要求比較的方案，也不要多比較使用者沒問的方案。"
      : "",
    input.zeroResult
      ? "DB 裡目前沒有找到符合的公開方案資料——絕對不能編造方案名稱、金額或資格條件，也不能說要幫忙上網查。"
      : `找到 ${input.candidates.length} 個符合的方案，可以自然、有信心地介紹。`,
    input.candidates.length > 0
      ? "目前符合的方案（安全摘要，只能使用這裡列出的名稱與欄位內容，不能自己編造或補充金額/資格等這裡沒有的細節）：\n" +
        input.candidates.map(c => {
          const parts = [
            `- ${c.title}${c.shortTitle ? `（${c.shortTitle}）` : ""}`,
            `核心用途：${c.description}`,
            c.targetAudience ? `適合對象：${c.targetAudience}` : "",
            c.highlights.length ? `重點特色：${c.highlights.join("、")}` : "",
            c.maxFundingLabel ? `補助上限（官方文字標籤，不是精確保證金額）：${c.maxFundingLabel}` : "",
            c.registryProfile ? `補充背景知識（僅供理解方案定位，不是 OXM 公開頁面的正式文字）：${c.registryProfile}` : "",
          ].filter(Boolean);
          return parts.join("；");
        }).join("\n")
      : "",
    input.registryOnlyMatch
      ? `使用者這一輪提到的「${input.registryOnlyMatch.name}」目前不是 upgradePrograms 資料表裡的公開方案卡片，但 OXM 既有顧問知識庫有這個方向的背景資訊，可以誠實地當作背景知識回答（不要說成「目前 OXM 官網有這個方案卡片」）：${input.registryOnlyMatch.profile}`
      : "",
    !input.zeroResult || input.registryOnlyMatch
      ? ""
      : "如果使用者問的名詞完全不在上面任何一種資料來源裡，誠實說「目前 OXM 沒有找到符合的方案資料」，不要用一般知識自己補充猜測的內容。",
  ].filter(Boolean);
  return lines.join("\n");
}

function serializeComposerActionInput(action: ComposerActionInput | null): string {
  if (!action || action.action === "none") {
    return "這一輪沒有觸發任何人工協尋相關的 action（不是 request_factory_sourcing 也不是 cancel_factory_sourcing）——回覆裡絕對不能提到「已經交給OXM」「已經取消」這類話，只需要誠實描述上面的搜尋狀態本身。";
  }
  if (action.action === "request_factory_sourcing") {
    return action.outcome === "succeeded"
      ? `這一輪的決定是 request_factory_sourcing，而且已經真的成功寫入資料庫——你可以誠實地用陳述語氣告訴使用者「已經把這個需求交給 OXM 負責人協助人工找廠，找到後會用站內信通知你」（這件事真的已經發生了，不是徵詢），但不能承諾多快完成或保證結果。`
      : `這一輪的決定原本是 request_factory_sourcing，但實際寫入資料庫失敗了——絕對不能說「已經交給OXM」這種話，必須誠實告訴使用者目前協尋需求還沒有成功送出，請稍後再試一次或聯繫客服，但仍然要先把上面的搜尋狀態本身講清楚。`;
  }
  // cancel_factory_sourcing
  return action.outcome === "succeeded"
    ? "這一輪的決定是 cancel_factory_sourcing，而且已經真的取消成功——自然地回應使用者不需要協尋了就好，不用再重複強調搜尋細節。"
    : "這一輪的決定原本是 cancel_factory_sourcing，但實際取消失敗了——誠實告訴使用者剛剛取消時系統出了點問題，請稍後再試一次或聯繫客服。";
}

const RESPONSE_STYLE_RULES = `
【finalReply 的語氣與長度——硬規則，違反視為錯誤輸出】
使用者主要用手機閱讀，這是在聊天，不是寫報告。
1. 整段最多 90 個中文字，目標 40～90 字，這是強制上限不是參考值。
2. 每段最多 1～2 句話，一句話只講一個概念。
3. 不要條列、不要「經系統分析」這種客服腔，不要出現任何內部技術詞（候選數、tier、rankingSignals、hard filter、AI Score、適配度百分比等）。
4. 用繁體中文，語氣像懂傳產的顧問朋友在聊天。
5. 絕對不要自己編造工廠名稱、消息標題、補助方案名稱或細節（金額、資格條件）——只能使用上面列出的真實資料，其餘一律不提。
`.trim();

const RESPONSE_COMPOSER_SYSTEM_PROMPT = `
你是 OXM AI 對話裡的「最終回覆生成」步驟，專門負責工廠搜尋／人工協尋、找消息、或政府補助方案查詢相關的這一輪回覆（這三者同一輪只會出現其中一種，不會同時發生）。OXM 是台灣的 B2B 製造業媒合平台。

你的任務：根據下面「這一輪真實發生的事」（搜尋結果、結構化狀態、Action 決定與實際執行結果——如果有），生成這一輪唯一會顯示給使用者的聊天回覆。你不能執行任何動作、不能改變任何決定，你只是誠實地把已經發生的事講成一段自然的話。

${RESPONSE_STYLE_RULES}

只回傳一個 JSON object，不要有任何其他文字：
{
  "finalReply": "string，這一輪要顯示給使用者的聊天回覆"
}
`.trim();

function parseComposerOutput(raw: string): string {
  const parsed = JSON.parse(raw);
  const finalReply = String(parsed.finalReply ?? "").trim();
  if (!finalReply) {
    throw new Error("Final Response Composer 回傳空的 finalReply");
  }
  return finalReply;
}

export async function composeFinalResponse(params: {
  history: AiChatTurn[];
  /** 工廠搜尋這一輪的真實狀態；找消息這一輪固定是 null（見 newsSearch）。 */
  factorySearch?: ComposerFactorySearchInput | null;
  /** Phase 6B：找消息這一輪的真實狀態；工廠搜尋這一輪固定是 null（見 factorySearch）。呼叫端保證三者剛好其中一個有值，不會同時有值或同時是 null。 */
  newsSearch?: ComposerNewsSearchInput | null;
  /** Phase 6C：政府補助方案查詢這一輪的真實狀態；其餘兩種情況固定是 null。 */
  subsidySearch?: ComposerSubsidyQueryInput | null;
  /** 只有工廠搜尋／人工協尋這一輪才可能有值；找消息、補助查詢目前沒有這個概念（見「十三」），固定傳 null。 */
  action: ComposerActionInput | null;
}): Promise<string> {
  const sections = [RESPONSE_COMPOSER_SYSTEM_PROMPT];
  if (params.factorySearch) {
    sections.push("\n===== 這一輪真實發生的工廠搜尋狀態 =====\n" + serializeComposerFactorySearchInput(params.factorySearch));
    sections.push("\n===== 這一輪真實發生的 Action 決定與執行結果 =====\n" + serializeComposerActionInput(params.action));
  }
  if (params.newsSearch) {
    sections.push("\n===== 這一輪真實發生的消息搜尋狀態 =====\n" + serializeComposerNewsSearchInput(params.newsSearch));
  }
  if (params.subsidySearch) {
    sections.push("\n===== 這一輪真實發生的政府補助方案查詢狀態 =====\n" + serializeComposerSubsidyQueryInput(params.subsidySearch));
  }
  const systemPrompt = sections.join("\n");
  const messages: AiChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: "以下是目前這段對話最近的逐字稿（幫助你判斷語氣與已知資訊，不要重複使用者剛講過的話）：\n\n" + serializeHistory(params.history),
    },
  ];
  const provider = getAiChatProvider("responseComposer");
  const raw = await provider.completeJson(messages, 350);
  return parseComposerOutput(raw);
}
