import "dotenv/config";
import { getFailedConversations } from "../ai/conversationService";
import { endConversationAndSummarize } from "../ai/memory";

export interface RetryFailedAiSummariesResult {
  attempted: number;
  succeeded: number;
  stillFailing: number;
}

/**
 * 收尾失敗的 conversation（status='failed'，見「四、摘要成功前，原文不能
 * 刪」＋「十四、失敗摘要資料的技術保底」）重試：逐筆重新嘗試
 * endConversationAndSummarize（摘要 → 寫入 Enterprise Memory → 刪除原文）。
 * 成功就整筆消失，仍然失敗會再次被標記 failed、retryCount 再 +1，留給下一次
 * 排程繼續重試——這裡刻意不做複雜的 backoff／queue，V1 先求「安全可重試」。
 *
 * 只由外部排程（例如 Render Cron Job）直接執行本檔案（CLI 進入點，見檔案最
 * 下方），本輪不設定正式排程，只提供本地可手動執行的能力。
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

  return { attempted: failed.length, succeeded, stillFailing };
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  /retryFailedAiSummaries\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  retryFailedAiSummaries()
    .then((result) => {
      // 只印統計數字，不含任何對話內容或使用者資料。
      console.log(`[cron] retry-failed-ai-summaries: attempted=${result.attempted} succeeded=${result.succeeded} stillFailing=${result.stillFailing}`);
      process.exit(result.stillFailing > 0 ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error("[cron] retry-failed-ai-summaries failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
