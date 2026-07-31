/**
 * 財務優化整合測試共用 fixture／cleanup helper — 第九輪修正（Medium #1／#2）。
 *
 * 背景：第八輪獨立驗收發現 server/financeOptimizationFixtureCleanupSafety.test.ts
 * 自己重新實作了一套 ensureTestUser／createTestFactory／deleteTestFactory 等
 * helper，跟 server/financeOptimization.test.ts 實際使用的同名函式是兩份各自
 * 維護、逐漸出現細微差異（例如 status 是否可參數化、地址文字）的複製品——
 * 安全測試只證明了「新寫的這一份範例」在建立中途失敗時能清乾淨，無法證明
 * 正式測試實際會執行到的那份程式碼本身安全。
 *
 * 修正方式：把這幾個函式的唯一實作抽到這裡，financeOptimization.test.ts 與
 * financeOptimizationFixtureCleanupSafety.test.ts 都改成從這裡 import，維持
 * 完全相同的參數簽章，讓兩份測試檔案原本呼叫這些函式的地方不需要修改呼叫
 * 方式——差別只在於「這是同一份實作」而不是各自的複製品。
 *
 * 另外提供 notification 主鍵層級的追蹤／精確刪除工具，供
 * financeOptimization.test.ts（清理 adminNotifyUserId 收到的通知）與
 * financeOptimizationNotificationIsolation.test.ts（Medium #2／#5）共用：
 * 一律先查出精確 id、刪除後比對 affected rows 與已追蹤 id 數一致、再重新
 * 查詢確認 0 筆殘留，ON DELETE CASCADE 只作為最後一道防線，不是主要證據。
 */
import { sql } from "drizzle-orm";
import * as db from "../db";

export async function ensureTestUser(openId: string, name: string, email?: string): Promise<number> {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const userEmail = email ?? `${openId}@example.test`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email) VALUES (${openId}, ${name}, ${userEmail})
    ON DUPLICATE KEY UPDATE name = VALUES(name)
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error(`failed to create fixture user ${openId}`);
  return id;
}

export async function deleteTestUser(userId: number): Promise<void> {
  const conn = await db.getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
}

export async function createTestFactory(
  ownerId: number,
  name: string,
  status: "approved" | "pending" | "draft" = "approved",
): Promise<number> {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${name}, ${JSON.stringify(["電子"])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", ${`${name} 測試地址一號`}, ${status}, "normal", FALSE, "[]", NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

export async function deleteTestFactory(factoryId: number): Promise<void> {
  const conn = await db.getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM financeApplications WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
}

export async function deleteFinanceApp(id: number): Promise<void> {
  const conn = await db.getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM financeApplications WHERE id = ${id}`);
}

export async function deleteFinanceConsultant(id: number): Promise<void> {
  const conn = await db.getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM financeConsultants WHERE id = ${id}`);
}

export async function countRows(table: string, whereSql: ReturnType<typeof sql>): Promise<number> {
  const conn = await db.getDb();
  if (!conn) return 0;
  const [rows] = await conn.execute(
    sql`SELECT COUNT(*) as n FROM ${sql.raw(table)} WHERE ${whereSql}`,
  ) as unknown as [{ n: number }[], unknown];
  return Number(rows[0]?.n ?? 0);
}

// ── Medium #2：通知必須以精確主鍵追蹤與刪除，cascade 只是最後防線 ──────────

/** 查出目前寫給某收件者的所有 communityNotifications 主鍵（精確查詢，非 LIKE）。 */
export async function captureNotificationIds(recipientUserId: number): Promise<number[]> {
  const conn = await db.getDb();
  if (!conn) return [];
  const [rows] = await conn.execute(
    sql`SELECT id FROM communityNotifications WHERE recipientUserId = ${recipientUserId}`,
  ) as unknown as [{ id: number }[], unknown];
  return rows.map(r => r.id);
}

/**
 * 輪詢直到某收件者的 notification 數量達到 minCount 或逾時，回傳最後一次查到
 * 的完整 id 陣列。呼叫端必須自行對回傳值長度做硬性斷言（例如
 * expect(ids.length).toBeGreaterThan(0)）——這裡本身不斷言，只負責等待＋回報。
 */
export async function waitForNotificationIds(
  recipientUserId: number,
  minCount: number,
  timeoutMs = 2000,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ids = await captureNotificationIds(recipientUserId);
    if (ids.length >= minCount || Date.now() > deadline) return ids;
    await new Promise(r => setTimeout(r, 50));
  }
}

/**
 * 依精確主鍵刪除通知，回傳實際刪除的 affected rows——呼叫端必須比對這個數字
 * 與自己追蹤的 id 數量一致，不可只信任「沒有拋錯」就代表刪對了筆數。
 * 不接受空陣列以外的模糊條件（LIKE／時間範圍等一律不在這支函式的職責內）。
 */
export async function deleteNotificationsByIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const conn = await db.getDb();
  if (!conn) return 0;
  const [result] = await conn.execute(
    sql`DELETE FROM communityNotifications WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
  ) as unknown as [{ affectedRows: number }, unknown];
  return result.affectedRows;
}

/** 精確查詢這些 id 目前是否還存在（刪除後驗證用，回傳仍存在的 id 子集合）。 */
export async function findExistingNotificationIds(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const conn = await db.getDb();
  if (!conn) return [];
  const [rows] = await conn.execute(
    sql`SELECT id FROM communityNotifications WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
  ) as unknown as [{ id: number }[], unknown];
  return rows.map(r => r.id);
}
