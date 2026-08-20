import { AsyncLocalStorage } from "async_hooks";
import type { AiChatLayer } from "./provider";

/**
 * Phase 8.1（見對話中「九」）：provider 層 usage logging 的分類標籤。直接
 * 沿用 provider.ts 既有的 AiChatLayer（diagnosis／routing／actionPlanner／
 * responseComposer／casualPauseGate／caseAssessment／memorySummary／
 * memoryMerge），不重新定義一套平行、命名風格不一致的 enum；再加上唯一一個
 * 走另一條 semantic-search.ts client（不是 provider.ts 的 OpenAiChatProvider）
 * 的 factorySemantic。
 */
export type AiModelCallLayer = AiChatLayer | "factorySemantic";

/**
 * 刻意只放 provider 層真正需要的三個 id，不把整個 request／session object
 * 傳進來（見對話中「九：AiModelCallContext 不要把整個 request 傳進
 * provider」）。turnId 為 null 代表目前這次 LLM 呼叫不屬於任何使用者可見
 * turn（背景流程），factoryId／actorUserId 在背景流程有已知值時仍應填入，
 * 完全未知時才為 null。
 */
export interface AiModelCallContext {
  turnId: number | null;
  factoryId: number | null;
  actorUserId: number | null;
}

const aiCallContextStorage = new AsyncLocalStorage<AiModelCallContext>();

/**
 * 包住一段呼叫鏈（chatService／caseAssessment／memory 的入口），讓中間所有
 * diagnosis/routing/planner/composer/semantic-search 呼叫都不需要改自己的
 * function signature 就能取得同一份 context——見對話中「AsyncLocalStorage」
 * 設計選擇。
 */
export function runWithAiCallContext<T>(context: AiModelCallContext, fn: () => Promise<T>): Promise<T> {
  return aiCallContextStorage.run(context, fn);
}

/** 沒有包在 runWithAiCallContext 內時回傳 undefined（例如測試直接呼叫 provider）。 */
export function getCurrentAiCallContext(): AiModelCallContext | undefined {
  return aiCallContextStorage.getStore();
}

/**
 * Phase 10.2 P1（見對話中「十五、十六」）：統一 AI 相關 server error log 的
 * prefix 格式，只做這一件事——不引入 trace／OpenTelemetry／request-id 平台
 * （turnId 已經確認是足夠的關聯 key，見「十五」）。turnId 預設從
 * AsyncLocalStorage ambient context 讀（chatService.ts／memory.ts／
 * caseAssessment.ts 的呼叫鏈全都包在 runWithAiCallContext 內，跟
 * logAiModelCall 讀法一致）；routers.ts 的 ai.chat 最外層 catch 執行時已經
 * 離開了 runWithAiCallContext 的 callback scope（ALS 只在 callback 同步／
 * 非同步延續內有效，callback reject 之後、外層 catch 拿到的時候已經不在範圍
 * 內），所以那裡改用 turnIdOverride 明確傳入當時已知的 reservation.turnId。
 *
 * 刻意只留 turnId／layer 兩個維度——不落地 prompt、assistant 回覆、
 * confirmedFacts、memory、PII、表單內容，呼叫端也不應該把這些塞進 message
 * 參數（見「十六」）。
 */
export function formatAiLogContext(layer: string, turnIdOverride?: number | null): string {
  const turnId = turnIdOverride !== undefined ? turnIdOverride : (getCurrentAiCallContext()?.turnId ?? null);
  return turnId != null ? `[OXM-AI][turn:${turnId}][layer:${layer}]` : `[OXM-AI][background][layer:${layer}]`;
}

/** formatAiLogContext() + console.error 的小 wrapper，避免每個呼叫端自己重複組字串。 */
export function logAiError(layer: string, message: string, err?: unknown, turnIdOverride?: number | null): void {
  console.error(`${formatAiLogContext(layer, turnIdOverride)} ${message}`, err instanceof Error ? err.message : err);
}
