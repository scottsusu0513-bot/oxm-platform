import "dotenv/config";
import * as db from "../db";
import { getDb } from "../db";
import { privateStorageDeleteObject, isPrivateStorageConfigured } from "../privateStorage";

export type NewsAttachmentCleanupResult = {
  scanned: number;
  deleted: number;
  failed: number;
};

/**
 * 掃描 downloadExpiresAt 已到期、非永久（expirationType != 'never'）、尚未刪除
 * 實體檔案（storageDeletedAt IS NULL）的 PDF 附件，逐筆刪除私有 S3 物件並標記
 * storageDeletedAt。刻意逐筆 try/catch：單筆失敗只累加 deleteAttempts、把失敗
 * 原因寫進 DB（deleteFailureReason，僅管理員後台看得到），不影響同批次其他
 * 附件，下次執行會自動重試。只用明確的單一 storageKey 呼叫 DeleteObject，不做
 * 任何 prefix／萬用字元刪除；S3 DeleteObject 對「物件本來就不存在」一律回傳
 * 成功，因此會直接視為刪除成功，不會進到失敗分支。已經有 storageDeletedAt 的
 * 附件不會被 db.getNewsAttachmentsDueForCleanup() 選到，重跑排程不會重複處理
 * 同一筆。
 *
 * 私有儲存未設定、或資料庫連線失敗，都視為「整體設定錯誤」直接 throw——這種
 * 情況下這次排程完全無法運作，讓呼叫端（CLI 進入點）以非 0 結束，Render Cron
 * 才會把這次執行顯示為失敗，而不是每天都安靜地「掃到 0 筆」而没人發現。
 *
 * 單筆附件刪除失敗不會中止整批次（繼續處理其他附件、寫進 DB、下次排程自動
 * 重試），但只要這次批次結束後 failed > 0，CLI 進入點就會以非 0 結束——即使
 * 其他附件都刪除成功。失敗的附件不會漏掉，DB 已經記錄了 deleteAttempts／
 * deleteFailureReason，讓 Render Cron 的執行紀錄明確顯示「這次有失敗」，而不是
 * 因為「大部分都成功」就被誤判成整批成功。
 *
 * 只由 Render Cron Job 直接執行本檔案（CLI 進入點，見檔案最下方），不透過任何
 * HTTP endpoint，不需要對外開放的 cron secret。
 */
export async function runNewsAttachmentCleanup(): Promise<NewsAttachmentCleanupResult> {
  if (!isPrivateStorageConfigured()) {
    // 跟 privateStorage.ts 用同一句精簡訊息，不列出缺的是哪一項變數
    // （bucket／region／access key／secret key 四項任一缺少都會走到這裡）。
    throw new Error("私有附件儲存尚未設定，PDF 附件功能目前無法使用。");
  }

  const conn = await getDb();
  if (!conn) {
    throw new Error("資料庫連線失敗");
  }

  const candidates = await db.getNewsAttachmentsDueForCleanup();
  let deleted = 0;
  let failed = 0;

  for (const attachment of candidates) {
    try {
      await privateStorageDeleteObject(attachment.storageKey);
      await db.markNewsAttachmentStorageDeleted(attachment.id);
      deleted++;
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      // deleteFailureReason 只寫進 DB（管理員後台可見），不印到 log——避免 log
      // 裡出現 S3 SDK 錯誤訊息可能夾帶的 key 路徑等內部資訊。單筆記錄失敗本身
      // 不影響其他附件，繼續處理下一筆。
      try {
        await db.recordNewsAttachmentDeleteFailure(attachment.id, msg);
      } catch {
        // 記錄失敗原因這一步本身失敗，不中斷整批次，下次排程仍會重新嘗試這筆。
      }
    }
  }

  return { scanned: candidates.length, deleted, failed };
}

/**
 * 批次跑完後的 CLI exit code 決策，拆成純函式方便單獨測試：failed === 0（含
 * scanned === 0 的「無資料」情況）→ 0；failed > 0 → 1，即使同一批次裡有其他
 * 附件刪除成功，只要有任何一筆失敗，這次執行就不能算成功。
 */
export function decideExitCode(result: NewsAttachmentCleanupResult): number {
  return result.failed > 0 ? 1 : 0;
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  /cleanupExpiredNewsAttachments\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  runNewsAttachmentCleanup()
    .then((result) => {
      // 只印統計數字：不含 storageKey、signed URL、檔名、AWS 憑證或會員個資。
      console.log(`[cron] cleanup-expired-news-attachments: scanned=${result.scanned} deleted=${result.deleted} failed=${result.failed}`);
      process.exit(decideExitCode(result));
    })
    .catch((err: unknown) => {
      console.error("[cron] cleanup-expired-news-attachments failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
