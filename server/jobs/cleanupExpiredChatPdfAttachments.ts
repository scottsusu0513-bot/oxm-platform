import "dotenv/config";
import * as db from "../db";
import { privateStorageDeleteObject, isPrivateStorageConfigured } from "../privateStorage";
import {
  CHAT_PDF_ADMIN_GRACE_MS,
  isChatPdfDueForPhysicalDeletion,
  isS3NotFoundError,
  parsePrivateChatPdfAttachment,
} from "../chatPdfAttachment";

export type ChatPdfCleanupResult = {
  scanned: number;
  deleted: number;
  skipped: number;
  failed: number;
};

export type ChatPdfCleanupDeps = {
  listDue: (expiresBeforeIso: string, limit: number) => Promise<{ id: number; attachmentData: unknown }[]>;
  deleteObject: (key: string) => Promise<void>;
  markDeleted: (messageId: number, expectedFileKey: string, deletedAtIso: string) => Promise<boolean>;
};

const defaultDeps: ChatPdfCleanupDeps = {
  listDue: db.getChatPdfAttachmentsDueForCleanup,
  deleteObject: privateStorageDeleteObject,
  markDeleted: db.markChatPdfAttachmentDeleted,
};

/**
 * 聊天 PDF 型錄實體刪除（Batch 3.5；取代舊的 scripts/cleanup-expired-pdfs.ts）。
 *
 * 期限：一般參與者 7 天後就不能下載（server 拒絕簽章），管理員另有 30 天寬限期；
 * 這裡處理的是第 37 天（expiresAt + 30 天）的實體刪除。只刪私有 bucket 的單一
 * 明確 key，不做 prefix／萬用字元刪除。
 *
 *   - 物件刪除成功（或 S3 回報本來就不存在）→ 條件式 UPDATE 標記 deleted／
 *     deletedAt、fileKey 設為 null；檔名／大小／期限保留，聊天紀錄仍顯示
 *     「已逾期」卡片
 *   - 其他 S3 錯誤 → 計入 failed、不標記，下次排程自動重試（不假裝成功）
 *   - 兩個排程同時執行：條件式 UPDATE 只有一個會生效；另一個對已刪除物件的
 *     DeleteObject 是冪等的，不會出錯，也不會重新建立 key
 *
 * 私有儲存未設定或 DB 無法連線 → 直接 throw，讓 CLI 以非 0 結束（Render Cron
 * 顯示失敗，而不是每天安靜地掃到 0 筆）。
 */
export async function runChatPdfAttachmentCleanup(
  opts: { now?: Date; limit?: number } = {},
  deps: ChatPdfCleanupDeps = defaultDeps,
): Promise<ChatPdfCleanupResult> {
  if (deps === defaultDeps && !isPrivateStorageConfigured()) {
    throw new Error("私有附件儲存尚未設定");
  }
  const now = opts.now ?? new Date();
  const limit = Math.max(1, opts.limit ?? 200);
  const expiresBeforeIso = new Date(now.getTime() - CHAT_PDF_ADMIN_GRACE_MS).toISOString();
  const nowIso = now.toISOString();

  const candidates = await deps.listDue(expiresBeforeIso, limit);
  let deleted = 0, skipped = 0, failed = 0;

  for (const row of candidates) {
    const attachment = parsePrivateChatPdfAttachment(row.attachmentData);
    if (!attachment || !attachment.fileKey || attachment.deleted === true || attachment.deletedAt != null
      || !isChatPdfDueForPhysicalDeletion(attachment, now)) {
      skipped++;
      continue;
    }
    try {
      await deps.deleteObject(attachment.fileKey);
    } catch (err) {
      if (!isS3NotFoundError(err)) {
        failed++;
        continue;
      }
    }
    try {
      if (await deps.markDeleted(row.id, attachment.fileKey, nowIso)) deleted++;
      else skipped++; // 另一個排程已經處理過
    } catch {
      failed++;
    }
  }

  return { scanned: candidates.length, deleted, skipped, failed };
}

export function decideExitCode(result: ChatPdfCleanupResult): number {
  return result.failed > 0 ? 1 : 0;
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  /cleanupExpiredChatPdfAttachments\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  runChatPdfAttachmentCleanup()
    .then((result) => {
      // 只印統計數字：不含 key、signed URL、檔名、AWS 憑證或會員個資。
      console.log(`[cron] cleanup-expired-chat-pdfs: scanned=${result.scanned} deleted=${result.deleted} skipped=${result.skipped} failed=${result.failed}`);
      process.exit(decideExitCode(result));
    })
    .catch((err: unknown) => {
      console.error("[cron] cleanup-expired-chat-pdfs failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
