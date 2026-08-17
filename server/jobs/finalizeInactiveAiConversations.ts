import "dotenv/config";
import { getInactiveConversations } from "../ai/conversationService";
import { endConversationAndSummarize } from "../ai/memory";

/** 最後一次互動後多久沒有新訊息，視為「這次互動已經結束」——只是拿來判斷
 * 收尾時機，不是逐字對話的保存期限（30 天保存規則已經取消，見對話中
 * 「六、新增 inactivity finalization」）。 */
export const INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;

export interface FinalizeInactiveAiConversationsResult {
  attempted: number;
  succeeded: number;
  stillFailing: number;
}

/**
 * Conversation 收尾的主要觸發路徑：使用者離開後不一定會再回來開新對話，
 * 純靠「下次開新使用階段時才收尾上一段」（lazy finalization，見
 * server/ai/chatService.ts 的 resolveConversationForTurn）在使用者永遠不
 * 回來的情況下永遠不會被觸發，逐字對話會無限期留在 active——這違反
 * 「conversation 只是暫存工作區」的原則。這個 job 定期找出所有超過
 * INACTIVITY_THRESHOLD_MS 沒有新訊息的 active 對話，主動收尾（摘要 → merge
 * 進 Enterprise Memory → 刪除原文）。lazy finalization 仍然保留作為第二道
 * 保險（見「七、保留 Lazy Finalization 當第二道保險」），避免任何漏網對話
 * 永久卡在 active。
 *
 * 只由外部排程（例如 Render Cron Job）直接執行本檔案（CLI 進入點，見檔案最
 * 下方），本輪不設定正式排程，只提供本地可手動執行的能力。
 */
export async function finalizeInactiveAiConversations(
  thresholdMs: number = INACTIVITY_THRESHOLD_MS
): Promise<FinalizeInactiveAiConversationsResult> {
  const inactive = await getInactiveConversations(thresholdMs);
  let succeeded = 0;
  let stillFailing = 0;

  for (const conversation of inactive) {
    const result = await endConversationAndSummarize(conversation);
    if (result.success) {
      succeeded++;
    } else {
      stillFailing++;
    }
  }

  return { attempted: inactive.length, succeeded, stillFailing };
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  /finalizeInactiveAiConversations\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  finalizeInactiveAiConversations()
    .then((result) => {
      // 只印統計數字，不含任何對話內容或使用者資料。
      console.log(`[cron] finalize-inactive-ai-conversations: attempted=${result.attempted} succeeded=${result.succeeded} stillFailing=${result.stillFailing}`);
      process.exit(result.stillFailing > 0 ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error("[cron] finalize-inactive-ai-conversations failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
