import { getDb } from "../db";
import { aiModelCalls } from "../../drizzle/schema";
import { getCurrentAiCallContext, formatAiLogContext, type AiModelCallLayer } from "./aiCallContext";

/**
 * Phase 8.1（見對話中「十」）：只記錄 provider SDK 回應真正提供的 token 欄位，
 * 沒有提供就是 null，不得估計／假造成統一的樣子。
 */
export interface AiModelCallUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
}

export interface LogAiModelCallInput {
  layer: AiModelCallLayer;
  model: string;
  provider: string;
  latencyMs: number;
  success: boolean;
  usage?: AiModelCallUsage;
  /** 短分類（例如 timeout／rate_limit／invalid_response），不是完整錯誤訊息或 stack。 */
  errorCategory?: string;
}

/**
 * 集中式 provider usage logging 的唯一寫入點（見對話中「九」：不要讓
 * diagnosis／routing／planner 各自記錄）。turnId／factoryId／actorUserId 一律
 * 從 AsyncLocalStorage ambient context 讀取，呼叫端不需要自己傳。
 *
 * 刻意 catch 所有錯誤、絕不 throw——usage logging 失敗不能影響使用者實際拿到
 * 的 AI 回覆（fire-and-forget-safe，見對話中的 provider instrumentation 要求）。
 */
export async function logAiModelCall(input: LogAiModelCallInput): Promise<void> {
  try {
    const ctx = getCurrentAiCallContext();
    const db = await getDb();
    if (!db) return;
    await db.insert(aiModelCalls).values({
      turnId: ctx?.turnId ?? null,
      factoryId: ctx?.factoryId ?? null,
      actorUserId: ctx?.actorUserId ?? null,
      layer: input.layer,
      model: input.model,
      provider: input.provider,
      inputTokens: input.usage?.inputTokens ?? null,
      outputTokens: input.usage?.outputTokens ?? null,
      totalTokens: input.usage?.totalTokens ?? null,
      cachedInputTokens: input.usage?.cachedInputTokens ?? null,
      reasoningTokens: input.usage?.reasoningTokens ?? null,
      latencyMs: input.latencyMs,
      success: input.success,
      errorCategory: input.errorCategory ?? null,
    });
  } catch (err) {
    console.error(
      `${formatAiLogContext(input.layer)} failed to log model call (non-fatal, does not affect AI response):`,
      err instanceof Error ? err.message : err
    );
  }
}
