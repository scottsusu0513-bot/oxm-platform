/**
 * 清理過期 PDF 型錄
 * 執行：pnpm cleanup:expired-pdfs
 *
 * 邏輯：
 * 1. 找出 type = 'pdf' 且 attachmentData.expiresAt < now 的訊息
 * 2. 若 deleted === true，skip（防止重複刪除）
 * 3. 若無 fileKey，skip 並 warn
 * 4. 從 S3 刪除檔案（失敗只 log，不中斷整體流程）
 * 5. 更新 attachmentData：deleted:true, deletedAt:now, fileKey:null
 * 6. 輸出 scanned / deleted / skipped / failed 統計
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { storageDelete } from "../server/storage";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[cleanup] DATABASE_URL not set");
    process.exit(1);
  }

  const pool = await mysql.createPool({ uri: url, connectionLimit: 5 });
  const conn = await pool.getConnection();

  const batchLimit = Math.max(1, parseInt(process.env.CLEANUP_PDF_BATCH_LIMIT ?? "100", 10) || 100);
  let scanned = 0, deleted = 0, skipped = 0, failed = 0;
  const now = new Date().toISOString();

  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, attachmentData FROM messages
       WHERE \`type\` = 'pdf'
         AND attachmentData IS NOT NULL
         AND JSON_VALUE(attachmentData, '$.expiresAt') < ?
       LIMIT ?`,
      [now, batchLimit]
    );
    console.log(`[cleanup] 批次上限：${batchLimit}`);

    scanned = rows.length;
    console.log(`[cleanup] 找到 ${scanned} 筆過期 PDF 訊息`);

    for (const row of rows) {
      const data: Record<string, any> = typeof row.attachmentData === "string"
        ? JSON.parse(row.attachmentData)
        : (row.attachmentData ?? {});

      // 已標記刪除 → skip
      if (data.deleted === true) {
        console.log(`  [skip] 訊息 #${row.id} 已標記 deleted，跳過`);
        skipped++;
        continue;
      }

      const fileKey: string | undefined = data.fileKey;

      if (!fileKey) {
        console.warn(`  [warn] 訊息 #${row.id} 沒有 fileKey，跳過`);
        skipped++;
        continue;
      }

      // 刪除 S3 檔案
      let s3Ok = true;
      try {
        await storageDelete(fileKey);
        console.log(`  [ok] 刪除 S3：${fileKey}`);
      } catch (err) {
        console.error(`  [error] S3 刪除失敗（#${row.id}，${fileKey}）:`, err);
        s3Ok = false;
        failed++;
      }

      // 無論 S3 是否成功，都標記 deleted（避免反覆重試造成問題）
      const updatedData: Record<string, any> = {
        ...data,
        fileKey: null,
        deleted: true,
        deletedAt: now,
      };
      try {
        await conn.query(
          `UPDATE messages SET attachmentData = ? WHERE id = ?`,
          [JSON.stringify(updatedData), row.id]
        );
        if (s3Ok) {
          console.log(`  [ok] 訊息 #${row.id} 標記已刪除`);
          deleted++;
        } else {
          console.log(`  [ok] 訊息 #${row.id} 已標記（S3 刪除失敗，但訊息已標記）`);
        }
      } catch (dbErr) {
        console.error(`  [error] 訊息 #${row.id} DB 更新失敗:`, dbErr);
        failed++;
      }
    }
  } finally {
    conn.release();
    await pool.end();
  }

  console.log("\n========== 清理結果 ==========");
  console.log(`掃描：${scanned} 筆`);
  console.log(`刪除：${deleted} 筆`);
  console.log(`跳過：${skipped} 筆`);
  console.log(`失敗：${failed} 筆`);
  console.log("================================");

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("[cleanup] 未預期錯誤:", err);
  process.exit(1);
});
