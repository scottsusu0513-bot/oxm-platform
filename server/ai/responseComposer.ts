import { getAiChatProvider, type AiChatMessage } from "./provider";
import { serializeHistory } from "./serialize";
import type { AiChatTurn } from "./types";
import type { FactorySearchStateSnapshot } from "./factorySearchState";
import type { ActionReasonCategory } from "./actionPlanner";
import type { OxmActionKey } from "./actionRegistry";

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
5. 絕對不要自己編造工廠名稱或細節——只能使用上面「候選前幾名」列出的公司名稱，其餘一律不提。
`.trim();

const RESPONSE_COMPOSER_SYSTEM_PROMPT = `
你是 OXM AI 對話裡的「最終回覆生成」步驟，專門負責工廠搜尋／人工協尋相關的這一輪回覆。OXM 是台灣的 B2B 製造業媒合平台。

你的任務：根據下面「這一輪真實發生的事」（搜尋結果、結構化狀態、Action 決定與實際執行結果），生成這一輪唯一會顯示給使用者的聊天回覆。你不能執行任何動作、不能改變任何決定，你只是誠實地把已經發生的事講成一段自然的話。

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
  factorySearch: ComposerFactorySearchInput;
  action: ComposerActionInput | null;
}): Promise<string> {
  const systemPrompt = [
    RESPONSE_COMPOSER_SYSTEM_PROMPT,
    "\n===== 這一輪真實發生的搜尋狀態 =====\n" + serializeComposerFactorySearchInput(params.factorySearch),
    "\n===== 這一輪真實發生的 Action 決定與執行結果 =====\n" + serializeComposerActionInput(params.action),
  ].join("\n");
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
