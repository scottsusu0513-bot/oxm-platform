import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { aiEnterpriseMemories, type AiConversation, type AiEnterpriseMemory } from "../../drizzle/schema";
import { getAiChatProvider, type AiChatMessage } from "./provider";
import { runWithAiCallContext, logAiError } from "./aiCallContext";
import { serializeHistory } from "./serialize";
import { getAllMessages, deleteConversationAndMessages, markConversationSummaryFailed } from "./conversationService";
import { finalizeFactorySearchRequestForConversation, buildFinalizeSummaryClause } from "./factorySearchRequestService";
import type { AiChatTurn } from "./types";

/** 沒有取得任何有價值企業資訊時的固定摘要文字——用來區分「聊過但沒有有效
 * 資訊」跟「從來沒聊過」（後者是這個 user 完全沒有 aiEnterpriseMemories 這筆
 * row）。見對話中「三、摘要是必做，不可以沒有」。 */
export const NO_MEANINGFUL_INFO_SUMMARY = "本次未提供可形成企業判斷的關鍵資訊。";

export interface ConversationSummaryResult {
  summaryText: string;
  hasMeaningfulBusinessInfo: boolean;
}

/**
 * Phase 12.2（見對話「十四~二十」）：Memory Summary 偶爾出現
 * `Unterminated string in JSON` ——追到真實根因：generateConversationSummary
 * 原本只給 completeJson 300 tokens 的預算，但 SUMMARY_SYSTEM_PROMPT 本身
 * 允許 summaryText 最多 200 個中文字（CJK 在 GPT tokenizer 底下經常一個字
 * 就吃掉 1.5~2.5 token，200 字加上 JSON 結構本身很容易逼近甚至超過 300），
 * 且非 gpt-5 系列模型完全沒有 provider.ts 既有的「新參數模型多留 4 倍
 * 餘裕」safety net（那個 safety net 只套用在 usesNewCompletionParams 的
 * 模型）。這不是「每一層都可能有這個 bug」的臆測——Diagnosis(550)／
 * Routing(750)／ActionPlanner(300，但輸出結構遠比 summary 精簡)／
 * ResponseComposer(350) 都是本輪連帶盤點過的既有呼叫端，各自的 budget 相對
 * 自己的輸出長度要求都留有更寬裕的比例，只有 Memory 這兩處 summary
 * 生成（generateConversationSummary／mergeEnterpriseMemory）用同一個偏緊的
 * 300，且輸出長度上限（200~500 中文字）明顯比其他層級的 JSON 輸出更長。
 *
 * 修法只動這一層：(1) 提高這裡專用的 token 上限（300 → 1024，不是無限拉
 * 高）；(2) 改用 OpenAI Structured Outputs（json_schema + strict:true）取代
 * 原本的自由格式 json_object，讓 provider 端就先保證欄位形狀；(3)
 * 萬一仍然拿到無法解析的 JSON（例如真的被 max_completion_tokens 截斷，
 * finish_reason==='length'），在同一次 finalize attempt 內最多重試一次
 * parser-level retry（見「十八」，重新呼叫一次 provider，不是用 regex/
 * substring 從壞掉的字串硬湊），兩次都失敗就直接拋出，交給既有的
 * markConversationSummaryFailed／retry job 機制處理——原文永遠不會因為這裡
 * 失敗而被刪除（見「十九」：不自己造假 fallback 摘要）。
 */
const MEMORY_SUMMARY_MAX_TOKENS = 1024;

const CONVERSATION_SUMMARY_JSON_SCHEMA = {
  name: "conversation_summary",
  schema: {
    type: "object",
    properties: {
      summaryText: { type: "string" },
      hasMeaningfulBusinessInfo: { type: "boolean" },
    },
    required: ["summaryText", "hasMeaningfulBusinessInfo"],
    additionalProperties: false,
  },
};

const MERGED_MEMORY_JSON_SCHEMA = {
  name: "merged_enterprise_memory",
  schema: {
    type: "object",
    properties: {
      summaryText: { type: "string" },
    },
    required: ["summaryText"],
    additionalProperties: false,
  },
};

/**
 * 呼叫 completeJson 並嘗試 JSON.parse，失敗時在同一次呼叫內重試最多一次
 * （見「十八」）。每次 completeJson 呼叫本身都會各自透過既有的
 * logAiModelCall 記錄 aiModelCalls（見 provider.ts），這裡不用另外處理成本
 * 紀錄。兩次都失敗時，把最後一次的 parse error 原樣拋出——不吞掉、不猜測、
 * 不從壞掉的字串硬湊資料。
 */
async function completeJsonWithParseRetry(
  provider: { completeJson: (messages: AiChatMessage[], maxTokens?: number, jsonSchema?: { name: string; schema: Record<string, unknown> }) => Promise<string> },
  messages: AiChatMessage[],
  jsonSchema: { name: string; schema: Record<string, unknown> }
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await provider.completeJson(messages, MEMORY_SUMMARY_MAX_TOKENS, jsonSchema);
    try {
      return JSON.parse(raw);
    } catch (err) {
      lastError = err;
      logAiError(
        "memorySummary",
        `completeJsonWithParseRetry: attempt ${attempt} produced unparseable JSON, ${attempt < 2 ? "retrying once" : "giving up"}`,
        err
      );
    }
  }
  throw lastError;
}

const SUMMARY_SYSTEM_PROMPT = `
你是企業對話摘要員。這是一個內部處理步驟，你的輸出不會直接顯示給使用者看，只會被存成一段極短的跨對話記憶，供未來的對話在需要時參考。

任務：把接下來這一整段使用者與 OXM AI 的對話，濃縮成一段極短摘要。

【硬規則】
1. 只記真正重要、使用者明確講過的企業資訊（產業／主要問題／bottleneck／已判斷出的方向／是否已經準備轉交顧問等），絕對不要重寫整段對話內容，也不要用完整優美的句子鋪陳。
2. 用電報式的極短短句，例如：「銘板製造；老客戶流失、價格競爭；主方向品牌內容；尚未轉交。」「庫存／排程混亂；ERP 為主、AI 可整合；尚未轉交。」「已完成 AI 瑕疵辨識 PoC；下一步評估正式研發產品化。」
3. 不要記寒暄（你好、謝謝這類）、不要記一般 FAQ 問答、不要記模型自己的推測、不要記使用者沒有明確確認過的事。
4. 如果整段對話完全沒有透露任何可以形成企業判斷的關鍵資訊（例如只是打招呼、說「隨便看看」「沒事，先這樣」這類），summaryText 必須完全等於「${NO_MEANINGFUL_INFO_SUMMARY}」這句話，一個字都不要改，hasMeaningfulBusinessInfo 設為 false。
5. 除了第 4 點的情況以外，hasMeaningfulBusinessInfo 一律設為 true。
6. summaryText 最多 200 個中文字，越短越好，不需要湊到這個上限。

只回傳一個 JSON object，不要有任何其他文字：
{ "summaryText": "string", "hasMeaningfulBusinessInfo": true/false }
`.trim();

export async function generateConversationSummary(messages: AiChatTurn[]): Promise<ConversationSummaryResult> {
  if (messages.length === 0) {
    return { summaryText: NO_MEANINGFUL_INFO_SUMMARY, hasMeaningfulBusinessInfo: false };
  }
  // Phase 8.1：只是標註 usage log 的 layer 分類，不影響模型選擇。
  const provider = getAiChatProvider("memorySummary");
  const chatMessages: AiChatMessage[] = [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content: "以下是這一整段對話的逐字稿：\n\n" + serializeHistory(messages) },
  ];
  const parsed = await completeJsonWithParseRetry(provider, chatMessages, CONVERSATION_SUMMARY_JSON_SCHEMA);
  const summaryText = typeof parsed.summaryText === "string" && parsed.summaryText.trim()
    ? parsed.summaryText.trim().slice(0, 500)
    : NO_MEANINGFUL_INFO_SUMMARY;
  return {
    summaryText,
    hasMeaningfulBusinessInfo: Boolean(parsed.hasMeaningfulBusinessInfo),
  };
}

export interface MergedEnterpriseMemory {
  summaryText: string;
  hasMeaningfulBusinessInfo: boolean;
}

const MERGE_SYSTEM_PROMPT = `
你是企業長期記憶維護員。這是內部處理步驟，輸出不會直接顯示給使用者看。

你會拿到兩份資料：
1. 這位使用者「既有」的企業長期摘要（更早以前累積下來、目前仍然有效的重點）。
2. 剛剛結束的這次對話新產生的摘要。

任務：把兩者合併成一份新的、最新版的企業長期摘要，取代舊的那份。

【硬規則】
1. 輸出的是「目前最新狀態」，不是歷史日誌——絕對不要用「8/1 提到…8/5 又提到…」這種按時間條列、逐次累加的寫法，把所有仍然有效的資訊整合成一段連貫、精簡的現況描述。
2. 如果新資訊更新或確認了既有資訊裡某個不確定／過時的狀態（例如既有寫「ERP 已送出，完成狀態未知」，新資訊確認「ERP 已經導入完成」），用新的確定狀態取代舊的不確定狀態，絕對不能同時保留兩個互相矛盾或重複的描述。
3. 如果新資訊是既有資訊的延伸（例如既有是「品牌內容方向」，新資訊是「已經開始拍短影音」），合併成一句更新過的描述（例如「品牌內容／短影音已開始執行」），不要重複贅述已經講過的部分，也不要只留下新的那句而遺漏舊的仍然有效的背景。
4. 既有摘要裡跟這次新資訊完全無關、也沒有被取代或過時的內容，原樣保留。
5. 電報式極短句，跟輸入摘要的風格一致，總長度不超過 500 個中文字，越短越好，不需要湊字數。
6. 不要臆測、不要新增使用者沒有明確說過的細節。

只回傳一個 JSON object：
{ "summaryText": "string" }
`.trim();

/**
 * 把「既有 Enterprise Memory」與「這次對話新產生的摘要」合併成新的長期記憶
 * （見對話中「三、Enterprise Memory 必須採 merge / update，而不是 blind
 * overwrite」）。刻意用決策樹先排除三個不需要呼叫模型的情況，只有「既有記憶
 * 跟這次對話都有實質內容」時才真的需要語意合併，其餘情況都是確定性的結果：
 *
 * - 既有沒有內容、這次也沒有內容 → 維持「本次未提供關鍵資訊」的固定文字。
 * - 既有沒有內容、這次有內容 → 既有本來就是空的，直接採用這次的內容。
 * - 既有有內容、這次沒有內容 → 完全不動既有內容（這是本輪要修的核心規則：
 *   不能因為這次沒講重點就洗掉之前真正重要的企業記憶）。
 * - 既有有內容、這次也有內容 → 才需要呼叫模型做語意合併（處理新舊資訊互相
 *   更新／取代／補充的情況，例如「ERP 已送，完成未知」→「ERP 已完成」）。
 */
export async function mergeEnterpriseMemory(
  existing: AiEnterpriseMemory | null,
  newSummary: ConversationSummaryResult
): Promise<MergedEnterpriseMemory> {
  const existingHasInfo = !!existing?.hasMeaningfulBusinessInfo;
  const newHasInfo = newSummary.hasMeaningfulBusinessInfo;

  if (!existingHasInfo && !newHasInfo) {
    return { summaryText: NO_MEANINGFUL_INFO_SUMMARY, hasMeaningfulBusinessInfo: false };
  }
  if (!existingHasInfo && newHasInfo) {
    return { summaryText: newSummary.summaryText, hasMeaningfulBusinessInfo: true };
  }
  if (existingHasInfo && !newHasInfo) {
    return { summaryText: existing!.summaryText, hasMeaningfulBusinessInfo: true };
  }

  // Phase 8.1：只是標註 usage log 的 layer 分類，不影響模型選擇。
  const provider = getAiChatProvider("memoryMerge");
  const chatMessages: AiChatMessage[] = [
    { role: "system", content: MERGE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `既有的企業長期摘要：「${existing!.summaryText}」`,
        `這次對話新產生的摘要：「${newSummary.summaryText}」`,
      ].join("\n"),
    },
  ];
  const parsed = await completeJsonWithParseRetry(provider, chatMessages, MERGED_MEMORY_JSON_SCHEMA);
  const mergedText = typeof parsed.summaryText === "string" && parsed.summaryText.trim()
    ? parsed.summaryText.trim().slice(0, 500)
    : newSummary.summaryText;
  return { summaryText: mergedText, hasMeaningfulBusinessInfo: true };
}

/**
 * Phase 11.2（見對話中「四、Memory Write API」）：一間工廠一筆，upsert（merge
 * 後寫入合併結果，不是新增也不是無條件覆寫）——unique target 是 factoryId，
 * 不再是 userId（見 drizzle/schema.ts 的 aiEnterpriseMemories 註解）。
 * lastActorUserId 純粹是稽核用途的 attribution，不影響這筆記憶「屬於哪個
 * factoryId」這件事。
 */
export async function upsertEnterpriseMemory(params: {
  factoryId: number;
  lastActorUserId: number | null;
  summaryText: string;
  hasMeaningfulBusinessInfo: boolean;
  lastInteractionHadMeaningfulInfo: boolean;
  sourceConversationId: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  await db
    .insert(aiEnterpriseMemories)
    .values({
      factoryId: params.factoryId,
      lastActorUserId: params.lastActorUserId,
      summaryText: params.summaryText,
      hasMeaningfulBusinessInfo: params.hasMeaningfulBusinessInfo,
      lastInteractionAt: now,
      lastInteractionHadMeaningfulInfo: params.lastInteractionHadMeaningfulInfo,
      sourceConversationId: params.sourceConversationId,
    })
    .onDuplicateKeyUpdate({
      set: {
        lastActorUserId: params.lastActorUserId,
        summaryText: params.summaryText,
        hasMeaningfulBusinessInfo: params.hasMeaningfulBusinessInfo,
        lastInteractionAt: now,
        lastInteractionHadMeaningfulInfo: params.lastInteractionHadMeaningfulInfo,
        sourceConversationId: params.sourceConversationId,
      },
    });
}

/**
 * Phase 11.2（見對話中「三、Memory Read API」）：唯一允許的讀取路徑是
 * factoryId——沒有 factoryId 就是不讀 memory，呼叫端不得 fallback 成
 * userId、不得 fallback 成上一次的 factoryId、不得 fallback 成「隨便找一筆
 * 最近的 memory」。factoryId 為 null 的情況（例如 admin 沒有 approved 工廠）
 * 完全不應該呼叫這個函式，應該在呼叫端就直接跳過整個 memory 讀取步驟（見
 * server/ai/chatService.ts）。
 */
export async function getEnterpriseMemory(factoryId: number): Promise<AiEnterpriseMemory | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.factoryId, factoryId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Phase 11.2（見對話中「二十九、Memory Reset API」）：最小 server capability，
 * 供 Admin support／未來使用者自助重設／測試清理／governance 緊急處理使用。
 * 本輪刻意不建立對外 route（見對話說明：先只建立 service helper + tests），
 * 呼叫端必須自行決定授權檢查——這裡不做任何權限判斷，純粹是「清空這間工廠
 * 的企業記憶」這個資料操作本身。傳入不存在的 factoryId 是安全的 no-op（沒有
 * 東西可刪）。
 */
export async function resetEnterpriseMemory(factoryId: number): Promise<{ deleted: boolean }> {
  const db = await getDb();
  if (!db) return { deleted: false };
  const result = await db.delete(aiEnterpriseMemories).where(eq(aiEnterpriseMemories.factoryId, factoryId));
  const affectedRows = (result[0] as { affectedRows?: number }).affectedRows ?? 0;
  return { deleted: affectedRows > 0 };
}

export interface EndConversationResult {
  success: boolean;
}

/**
 * Conversation 收尾（見「八、摘要完成的安全順序」的硬規則）：
 * 1. 取完整逐字稿
 * 2. 產生「這次對話」的摘要（Conversation Summary）
 * 3. 讀取既有 Enterprise Memory
 * 4. 用「這次摘要 + 既有 memory」合併出新的 Enterprise Memory（見
 *    mergeEnterpriseMemory；沒有新資訊時既有內容原樣保留，不會被清空）
 * 5. 合併結果連同這次互動的 metadata（lastInteractionAt／
 *    lastInteractionHadMeaningfulInfo）一起寫入成功
 * 6. 才刪除這筆 conversation／底下所有 aiMessages
 *
 * 任何一步失敗，整段直接進 catch：標記 status='failed'、retryCount+1、記錄
 * 錯誤訊息，原文完全不動——不會拋錯讓呼叫端中斷（呼叫端通常還要接著建立新
 * 對話處理使用者這一輪的新訊息，收尾失敗不該擋住這件事）。
 *
 * Phase 6A.1（見「二十三、二十四」）：Factory Search 人工協尋的 claim+notify
 * 刻意放在步驟 1 跟 2 之間、且用自己獨立的 try/catch 包起來——notifyAdmins
 * 等價實作失敗絕對不能讓 summary/memory 失敗、絕對不能讓 raw conversation
 * 卡住不刪（request 自己已經是完整快照，通知失敗有獨立的 retry job，見
 * server/ai/factorySearchRequestService.ts）。放在 generateConversationSummary
 * 之前執行，是因為需要它「最終」的 request 狀態（notified／cancelled／
 * notification_failed）來組出 buildFinalizeSummaryClause() 要併入摘要的那句
 * 誠實敘述（見「二十九、三十」）。
 */
export async function endConversationAndSummarize(conversation: AiConversation): Promise<EndConversationResult> {
  // Phase 8.1（見對話中「三十六：Memory finalize 不消耗使用者 quota，但仍記
  // model usage」）：turnId 為 null（不屬於任何使用者可見 turn），
  // factoryId／actorUserId 用這個 conversation 本身已知的值。
  return runWithAiCallContext(
    { turnId: null, factoryId: conversation.factoryId, actorUserId: conversation.userId },
    () => endConversationAndSummarizeImpl(conversation)
  );
}

async function endConversationAndSummarizeImpl(conversation: AiConversation): Promise<EndConversationResult> {
  // 見對話中「二十五、Admin No-Factory Finalization」：沒有 approved 工廠
  // context 的對話（目前唯一情況是 admin 使用 AI 但自己沒有 approved 工廠）
  // 天生沒有 Enterprise Memory 可以歸屬——不產生摘要、不呼叫任何 LLM（避免
  // 白燒 API 成本）、不讀寫 aiEnterpriseMemories，直接安全刪除原文。人工協尋
  // claim+notify（若有）仍然照常執行，那是獨立於 Enterprise Memory 的機制。
  if (conversation.factoryId == null) {
    try {
      await finalizeFactorySearchRequestForConversation(conversation.id);
    } catch (error) {
      logAiError("memorySummary", `finalizeFactorySearchRequestForConversation failed for conversation ${conversation.id} (no-factory)`, error);
    }
    try {
      await deleteConversationAndMessages(conversation.id);
      return { success: true };
    } catch (error) {
      logAiError("memorySummary", `no-factory raw delete failed for conversation ${conversation.id}`, error);
      try {
        await markConversationSummaryFailed(conversation.id, error);
      } catch (markError) {
        logAiError("memorySummary", `failed to mark conversation ${conversation.id} as failed`, markError);
      }
      return { success: false };
    }
  }

  const factoryId = conversation.factoryId;
  let factorySearchClause: string | null = null;
  try {
    const finalizedRequest = await finalizeFactorySearchRequestForConversation(conversation.id);
    factorySearchClause = buildFinalizeSummaryClause(finalizedRequest);
  } catch (error) {
    logAiError("memorySummary", `finalizeFactorySearchRequestForConversation failed for conversation ${conversation.id}`, error);
  }

  try {
    const messages = await getAllMessages(conversation.id);
    const conversationSummary = await generateConversationSummary(
      messages.map(m => ({ role: m.role, content: m.content }) satisfies AiChatTurn)
    );
    if (factorySearchClause) {
      conversationSummary.summaryText = conversationSummary.hasMeaningfulBusinessInfo
        ? `${conversationSummary.summaryText}${factorySearchClause}`
        : factorySearchClause;
      conversationSummary.hasMeaningfulBusinessInfo = true;
    }
    const existingMemory = await getEnterpriseMemory(factoryId);
    const merged = await mergeEnterpriseMemory(existingMemory, conversationSummary);
    await upsertEnterpriseMemory({
      factoryId,
      lastActorUserId: conversation.userId,
      summaryText: merged.summaryText,
      hasMeaningfulBusinessInfo: merged.hasMeaningfulBusinessInfo,
      lastInteractionHadMeaningfulInfo: conversationSummary.hasMeaningfulBusinessInfo,
      sourceConversationId: conversation.id,
    });
    await deleteConversationAndMessages(conversation.id);
    return { success: true };
  } catch (error) {
    logAiError("memorySummary", `endConversationAndSummarize failed for conversation ${conversation.id}`, error);
    try {
      await markConversationSummaryFailed(conversation.id, error);
    } catch (markError) {
      logAiError("memorySummary", `failed to mark conversation ${conversation.id} as failed`, markError);
    }
    return { success: false };
  }
}
