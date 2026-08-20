import "dotenv/config";
import { getFailedConversations, getPermanentlyFailedConversationsCount, MAX_SUMMARY_RETRY_COUNT } from "../ai/conversationService";
import { endConversationAndSummarize } from "../ai/memory";

export interface RetryFailedAiSummariesResult {
  attempted: number;
  succeeded: number;
  stillFailing: number;
  /** Phase 11.2（見「二十二」）：這次執行後，累計達到 MAX_SUMMARY_RETRY_COUNT 上限、不會再被自動撿到的對話總數（只是回報現況，不是這次新增的數量）。 */
  permanentlyFailedTotal: number;
}

/**
 * 收尾失敗的 conversation（status='failed'，見「四、摘要成功前，原文不能
 * 刪」＋「十四、失敗摘要資料的技術保底」）重試：逐筆重新嘗試
 * endConversationAndSummarize（摘要 → 寫入 Enterprise Memory → 刪除原文）。
 * 成功就整筆消失，仍然失敗會再次被標記 failed、retryCount 再 +1，留給下一次
 * 排程繼續重試——這裡刻意不做複雜的 backoff／queue，V1 先求「安全可重試」。
 *
 * Phase 11.2（見對話中「二十二、Failed Summary Retention」）：重試不再無上限
 * ——markConversationSummaryFailed 內部達到 MAX_SUMMARY_RETRY_COUNT（見
 * conversationService.ts）後會把狀態轉成 permanently_failed，這裡的
 * getFailedConversations() 只查 status='failed'，之後不會再自動撿到那些
 * row；原文依然保留，只是變成需要人工判斷的 governance 案件（見 Admin AI
 * 管理頁的 permanentlyFailedSummaryCount）。
 *
 * 只由外部排程（例如 Render Cron Job）直接執行本檔案（CLI 進入點，見檔案最
 * 下方）；建議排程頻率見 server/jobs/README（每 30 分鐘）。
 */
export async function retryFailedAiSummaries(): Promise<RetryFailedAiSummariesResult> {
  const failed = await getFailedConversations();
  let succeeded = 0;
  let stillFailing = 0;

  for (const conversation of failed) {
    const result = await endConversationAndSummarize(conversation);
    if (result.success) {
      succeeded++;
    } else {
      stillFailing++;
    }
  }

  const permanentlyFailedTotal = await getPermanentlyFailedConversationsCount();
  return { attempted: failed.length, succeeded, stillFailing, permanentlyFailedTotal };
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  /retryFailedAiSummaries\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  retryFailedAiSummaries()
    .then((result) => {
      // 只印統計數字，不含任何對話內容或使用者資料。
      console.log(`[OXM-AI][background][layer:summaryRetryJob] attempted=${result.attempted} succeeded=${result.succeeded} stillFailing=${result.stillFailing} permanentlyFailedTotal=${result.permanentlyFailedTotal} maxRetryCount=${MAX_SUMMARY_RETRY_COUNT}`);
      process.exit(result.stillFailing > 0 ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error("[OXM-AI][background][layer:summaryRetryJob] failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
