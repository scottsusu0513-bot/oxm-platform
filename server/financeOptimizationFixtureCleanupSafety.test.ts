/**
 * 財務優化測試 fixture 建立中途失敗的清理保護 — 回歸測試（第七輪建立，第九輪修正）。
 *
 * 背景：server/financeOptimization.test.ts／server/upgradeConsultantRegion.test.ts
 * 舊版的 beforeAll／it() 常見寫法是「先循序建立好幾筆資源，最後才包一個
 * try/finally」——如果建立序列中途（例如第二、第三步）失敗，前面已經成功
 * 建立的資源會因為包在 try 區塊之外、finally 根本不會執行到而永久殘留。
 * 第七輪已經把 server/financeOptimization.test.ts／
 * server/upgradeConsultantRegion.test.ts 內所有這種寫法改成「建立步驟本身
 * 也包進 try，用 let（不是 const）+ undefined 初始值追蹤每一步是否真的成功」。
 *
 * 這裡用一組獨立、可控制的 user → factory → consultant → application 建立
 * 鏈，在鏈的每一個階段之後都刻意讓下一步失敗（用真正會違反 FK／NOT NULL
 * 限制的寫法，不是 mock），驗證同樣的「try 包住建立步驟＋finally 依已確認
 * 建立的部分清理」寫法，在鏈的任何一個階段失敗都能做到零殘留。全部走真實
 * DB 行為驗證（真的 INSERT／DELETE oxm_test），不是 readFileSync／regex。
 *
 * ── 第九輪修正（Medium #1／#2／#5）───────────────────────────────────────
 * 第八輪獨立驗收指出：這裡原本自己重新實作了一套 ensureTestUser／
 * createTestFactory／deleteTestFactory，跟 financeOptimization.test.ts 實際
 * 使用的同名函式是兩份各自維護的複製品，無法證明「正式測試真正會執行到的
 * cleanup 路徑」本身安全。現在改成從 server/_core/financeTestFixtures.ts
 * import 同一份實作——兩份測試檔案呼叫的是完全相同的程式碼，不是看起來很
 * 像的另一份範例（Medium #1）。
 *
 * 情境 4 額外修正：通知不再只靠刪除 user 觸發的 ON DELETE CASCADE 作為
 * 「已清乾淨」的證據，改成先精確查出 notification id、輪詢後加上硬性斷言
 * 確認真的有寫入（Medium #5：先前的版本輪詢後沒有斷言就直接觸發下一步刻意
 * 失敗，逾時未寫入仍可能「通過」），再依精確主鍵刪除並比對 affected rows／
 * 重新查詢確認 0 筆殘留（Medium #2）。
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { assertFinanceIntegrationTestDbSafety } from "./_core/financeIntegrationTestDbGuard";

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { host: SAFE_TEST_DB_HOST, database: SAFE_TEST_DB_NAME } = assertFinanceIntegrationTestDbSafety({
  nodeEnv: process.env.NODE_ENV,
  optInFlag: process.env.FINANCE_INTEGRATION_TESTS_CONFIRMED,
  databaseUrl: process.env.FINANCE_TEST_DATABASE_URL,
});
process.env.DATABASE_URL = process.env.FINANCE_TEST_DATABASE_URL;
console.log(`[financeOptimizationFixtureCleanupSafety.test.ts] DB safety gate passed — host=${SAFE_TEST_DB_HOST} database=${SAFE_TEST_DB_NAME}`);

const db = await import("./db");
const { getDb } = db;
const { notifyUser } = await import("./notifyHelper");
// 與 financeOptimization.test.ts 完全相同的 import 來源，兩份測試檔案共用
// 同一套 create／cleanup 實作（Medium #1）。
const {
  ensureTestUser,
  deleteTestUser,
  createTestFactory,
  deleteTestFactory,
  countRows,
  waitForNotificationIds,
  deleteNotificationsByIds,
  findExistingNotificationIds,
} = await import("./_core/financeTestFixtures");

describe("fixture 建立中途失敗：try 必須包住建立步驟本身，才能清理已成功的部分", () => {
  it("情境 1／4：只成功建立 user，下一步（用不存在的 userId 建立 consultant，違反 FK）失敗——user 必須被清理，零殘留", async () => {
    const openId = `test-cleanup-safety-u1-${runId}`;
    let userId: number | undefined;
    let threw = false;
    try {
      userId = await ensureTestUser(openId, "情境1測試使用者");
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      // 用不存在的 userId 建立顧問，觸發 financeConsultants.userId 的 FK 違反。
      await conn.execute(sql`
        INSERT INTO financeConsultants (name, userId, isActive, createdAt, updatedAt)
        VALUES (${"情境1不應該存在的顧問"}, 999999901, true, NOW(), NOW())
      `);
    } catch {
      threw = true;
    } finally {
      if (typeof userId === "number") await deleteTestUser(userId);
    }
    expect(threw).toBe(true);
    expect(await countRows("users", sql`openId = ${openId}`)).toBe(0);
  });

  it("情境 2／4：成功建立 user＋factory，下一步（顧問綁定不存在的 userId）失敗——user 與 factory 都必須被清理，零殘留", async () => {
    const openId = `test-cleanup-safety-u2-${runId}`;
    let userId: number | undefined;
    let factoryId: number | undefined;
    let threw = false;
    try {
      userId = await ensureTestUser(openId, "情境2測試使用者");
      factoryId = await createTestFactory(userId, `[CLEANUP_SAFETY_${runId}] 情境2工廠`);
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      await conn.execute(sql`
        INSERT INTO financeConsultants (name, userId, isActive, createdAt, updatedAt)
        VALUES (${"情境2不應該存在的顧問"}, 999999902, true, NOW(), NOW())
      `);
    } catch {
      threw = true;
    } finally {
      if (typeof factoryId === "number") await deleteTestFactory(factoryId);
      if (typeof userId === "number") await deleteTestUser(userId);
    }
    expect(threw).toBe(true);
    expect(await countRows("users", sql`openId = ${openId}`)).toBe(0);
    expect(await countRows("factories", sql`name = ${`[CLEANUP_SAFETY_${runId}] 情境2工廠`}`)).toBe(0);
  });

  it("情境 3／4：成功建立 user＋factory＋consultant，下一步（案件指派不存在的 factoryId，違反 openFactoryId 唯一索引所需的真實工廠）失敗——三者都必須被清理，零殘留", async () => {
    const openId = `test-cleanup-safety-u3-${runId}`;
    let userId: number | undefined;
    let factoryId: number | undefined;
    let consultantId: number | undefined;
    let threw = false;
    try {
      userId = await ensureTestUser(openId, "情境3測試使用者");
      factoryId = await createTestFactory(userId, `[CLEANUP_SAFETY_${runId}] 情境3工廠`);
      consultantId = await db.adminCreateFinanceConsultant(`情境3測試顧問-${runId}`);
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      // 用不存在的 factoryId 建立案件，觸發 financeApplications.factoryId 的 FK 違反。
      await conn.execute(sql`
        INSERT INTO financeApplications
          (factoryId, companyNameSnapshot, companyAddressSnapshot, contactName, phone, contactTime, consentAgreed, status, assignedConsultantId, statusTimeline, createdAt, updatedAt)
        VALUES (999999903, ${"情境3不應該存在的案件"}, "地址", "聯絡人", "0900000000", "任何時間", TRUE, "new", ${consultantId}, ${JSON.stringify({ new: new Date().toISOString() })}, NOW(), NOW())
      `);
    } catch {
      threw = true;
    } finally {
      if (typeof consultantId === "number") await db.adminSetFinanceConsultantActive(consultantId, true).catch(() => {});
      if (typeof consultantId === "number") {
        const conn = await getDb();
        if (conn) await conn.execute(sql`DELETE FROM financeConsultants WHERE id = ${consultantId}`);
      }
      if (typeof factoryId === "number") await deleteTestFactory(factoryId);
      if (typeof userId === "number") await deleteTestUser(userId);
    }
    expect(threw).toBe(true);
    expect(await countRows("users", sql`openId = ${openId}`)).toBe(0);
    expect(await countRows("factories", sql`name = ${`[CLEANUP_SAFETY_${runId}] 情境3工廠`}`)).toBe(0);
    expect(await countRows("financeConsultants", sql`name = ${`情境3測試顧問-${runId}`}`)).toBe(0);
  });

  it("情境 4／4：成功建立 user＋factory＋consultant＋application 並觸發一筆通知，下一步失敗——四者（含精確主鍵刪除的通知）都必須被清理，零殘留", async () => {
    const openId = `test-cleanup-safety-u4-${runId}`;
    let userId: number | undefined;
    let factoryId: number | undefined;
    let consultantId: number | undefined;
    let applicationId: number | undefined;
    let notificationIds: number[] = [];
    let threw = false;
    try {
      userId = await ensureTestUser(openId, "情境4測試使用者");
      factoryId = await createTestFactory(userId, `[CLEANUP_SAFETY_${runId}] 情境4工廠`);
      consultantId = await db.adminCreateFinanceConsultant(`情境4測試顧問-${runId}`);
      applicationId = await db.createFinanceApplication({
        factoryId,
        companyNameSnapshot: `[CLEANUP_SAFETY_${runId}] 情境4案件`,
        companyAddressSnapshot: "地址",
        contactName: "聯絡人",
        phone: "0900000000",
        contactTime: "任何時間",
        consentAgreed: true,
        status: "new",
        assignedConsultantId: consultantId,
        statusTimeline: { new: new Date().toISOString() },
      });
      // 觸發一筆通知（寫給 userId 本身，只是為了證明「案件＋通知都建立成功後」
      // 才失敗的情境；下面故意用重複 primary key 的 INSERT 讓下一步失敗）。
      notifyUser(userId, {
        eventType: "finance_cleanup_safety_test",
        eventGroup: "finance",
        message: `[CLEANUP_SAFETY_${runId}] 情境4通知`,
        actionUrl: "/finance-optimization",
        titleSnapshot: "情境4",
        dedupeKey: `cleanup_safety_test:${runId}`,
      });
      // 第九輪修正（Medium #5）：等通知真的寫入時，改成精確查出 notification
      // id（不只是 COUNT），並在繼續往下模擬「下一步失敗」之前先做硬性斷言——
      // 逾時仍為 0 筆時測試必須直接失敗，不能悄悄放行到下一步。
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      notificationIds = await waitForNotificationIds(userId, 1, 2000);
      expect(notificationIds.length).toBeGreaterThan(0);
      // 模擬下一步失敗：重複插入同一個 id 的 factories 主鍵，觸發 duplicate entry。
      await conn.execute(sql`
        INSERT INTO factories (id, ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
        VALUES (${factoryId}, ${userId}, ${"重複主鍵應該失敗"}, '["電子"]', '["ODM"]', "新竹市", "<1000萬", "地址", "approved", "normal", FALSE, "[]", NOW(), NOW())
      `);
    } catch {
      threw = true;
    } finally {
      // 第九輪修正（Medium #2）：通知以精確主鍵刪除作為主要清理證據，比對
      // affected rows 與追蹤到的 id 數量一致；刪除 user 觸發的 cascade 只作為
      // 這之後的最後防線（此時應該已經沒有通知可被 cascade 到）。
      if (notificationIds.length > 0) {
        const affectedRows = await deleteNotificationsByIds(notificationIds);
        expect(affectedRows).toBe(notificationIds.length);
      }
      if (typeof applicationId === "number") {
        const conn = await getDb();
        if (conn) await conn.execute(sql`DELETE FROM financeApplications WHERE id = ${applicationId}`);
      }
      if (typeof consultantId === "number") {
        const conn = await getDb();
        if (conn) await conn.execute(sql`DELETE FROM financeConsultants WHERE id = ${consultantId}`);
      }
      if (typeof factoryId === "number") await deleteTestFactory(factoryId);
      if (typeof userId === "number") await deleteTestUser(userId); // 收尾防線，此時應無殘留通知
    }
    expect(threw).toBe(true);
    expect(await countRows("users", sql`openId = ${openId}`)).toBe(0);
    expect(await countRows("factories", sql`name = ${`[CLEANUP_SAFETY_${runId}] 情境4工廠`}`)).toBe(0);
    expect(await countRows("financeConsultants", sql`name = ${`情境4測試顧問-${runId}`}`)).toBe(0);
    if (typeof applicationId === "number") {
      expect(await countRows("financeApplications", sql`id = ${applicationId}`)).toBe(0);
    }
    // Medium #2：重新以精確主鍵查詢，確認剛才追蹤到的每一筆 notification id
    // 都已經不存在（不是用 LIKE／時間範圍等模糊條件推斷）。
    expect(notificationIds.length).toBeGreaterThan(0);
    const stillExisting = await findExistingNotificationIds(notificationIds);
    expect(stillExisting).toEqual([]);
  });
});
