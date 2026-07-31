/**
 * 財務優化通知隔離 — 回歸測試（第七輪建立，第九輪修正）。
 *
 * 背景：server/financeOptimization.test.ts 舊版直接借用正式 ADMIN_WHITELIST_EMAILS
 * 的真實 email 建立測試用「管理員」fixture，讓 getAdminUserIds()／notifyAdmins()
 * 認得它是管理員。但 getAdminUserIds()（server/db.ts）是用 email 對 users 表
 * 做全域比對，任何「email 剛好等於正式白名單 email」的既有使用者都會被
 * notifyAdmins() 一併寫入測試通知——與這次測試建立的 fixture 完全無關的既有
 * 資料因此被污染（第六輪／第七輪驗收發現 oxm_test 裡殘留了寫給既有使用者的
 * 測試通知）。
 *
 * 修正機制（與 financeOptimization.test.ts 相同）：
 * 1. 在任何會快取 ADMIN_WHITELIST_EMAILS 的模組（server/_core/env.ts，透過
 *    ./db／./notifyHelper 遞移載入）被動態載入之前，把這個測試 process 的
 *    process.env.ADMIN_WHITELIST_EMAILS 暫時覆寫成本次測試唯一、隨機產生的
 *    email，結束後在 afterAll 還原。只在這個 vitest 測試 process 的記憶體內
 *    生效，不寫入 .env、不影響正式站或 pnpm dev。
 * 2. communityNotifications 的清理一律以精確主鍵刪除作為主要證據，ON DELETE
 *    CASCADE 只作為使用者刪除後的最後防線（第九輪修正，見下）。
 *
 * ── 第九輪修正（Medium #2／#3／#4）────────────────────────────────────────
 * - Medium #2：新通知一律先查出精確 notification id、刪除後比對 affected rows
 *   與追蹤到的 id 數量一致、再重新查詢確認 0 筆殘留，不再只依賴刪除 user 觸發
 *   的 cascade 作為「已清乾淨」的證據。
 * - Medium #3：ADMIN_WHITELIST_EMAILS 覆寫、fail-closed 安全檢查、動態 import
 *   全部包進同一個 try/catch——任何一步拋錯都會先還原環境變數再重新拋出，
 *   不會因為模組頂層還沒執行到 afterAll 就讓覆寫值永久留在這個 process 裡。
 * - Medium #4：不再只模擬一位既有管理員。beforeAll 會用「覆寫前」的原始
 *   ADMIN_WHITELIST_EMAILS 找出 oxm_test 裡所有符合的既有使用者，記錄每一位
 *   的 notification id 集合；afterAll 還原環境變數前重新查詢，逐一比對前後
 *   完全一致——不只是「其中一個模擬帳號」，而是全面普查。不輸出白名單 email
 *   內容到任何 log。
 *
 * 這裡直接呼叫真實的 notifyAdmins()（server/notifyHelper.ts）搭配真實
 * getAdminUserIds()（真的查詢 oxm_test），驗證：
 *   1. 覆寫後，既有（模擬）管理員完全收不到本次測試觸發的通知。
 *   2. 本次自建的 fixture 管理員確實收到通知。
 *   3. 刪除 fixture 使用者後，通知透過精確主鍵刪除歸零（cascade 僅為後備）。
 *   4. fixture 建立中途失敗時，try/finally 仍會清理已建立成功的部分。
 *   5. 所有真實符合原始白名單的既有使用者，前後 notification id 集合不變。
 * 全部走真實 DB 行為驗證，不使用 readFileSync／regex 比對原始碼。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { assertFinanceIntegrationTestDbSafety } from "./_core/financeIntegrationTestDbGuard";
// envOverrideGuard.ts 刻意完全不 import ../db，可以安全 static import——見該
// 檔案開頭的說明。財務測試共用的 create／cleanup helper（會 import ../db）
// 則維持動態 import，順序仍在下面的安全閘門＋環境變數覆寫之後。
import { createEnvOverrideGuard, runProtected } from "./_core/envOverrideGuard";

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// 覆寫必須在任何會快取 ADMIN_WHITELIST_EMAILS 的模組被動態載入之前完成。
const TEST_ADMIN_EMAIL = `fin-notif-iso-admin-${runId}@example.test`;

// 第九輪修正（Medium #3）：覆寫、fail-closed 安全檢查、動態 import 全部包進
// runProtected()——任一步拋錯都先呼叫 guard.restore() 還原環境變數再重新
// 拋出，不會讓覆寫值因為模組載入失敗、afterAll 從未被註冊而永久留在這個
// vitest process 裡。guard.restore 本身是 idempotent，afterAll 還會再呼叫
// 一次同一個函式，兩次呼叫效果相同。
const adminWhitelistGuard = createEnvOverrideGuard("ADMIN_WHITELIST_EMAILS", JSON.stringify([TEST_ADMIN_EMAIL]));
const ORIGINAL_ADMIN_WHITELIST_EMAILS = adminWhitelistGuard.original;

let db!: typeof import("./db");
let notifyAdmins!: typeof import("./notifyHelper").notifyAdmins;
let ensureTestUser!: typeof import("./_core/financeTestFixtures").ensureTestUser;
let deleteTestUser!: typeof import("./_core/financeTestFixtures").deleteTestUser;
let waitForNotificationIds!: typeof import("./_core/financeTestFixtures").waitForNotificationIds;
let deleteNotificationsByIds!: typeof import("./_core/financeTestFixtures").deleteNotificationsByIds;
let findExistingNotificationIds!: typeof import("./_core/financeTestFixtures").findExistingNotificationIds;
let captureNotificationIds!: typeof import("./_core/financeTestFixtures").captureNotificationIds;

await runProtected(adminWhitelistGuard.restore, async () => {
  const { host: SAFE_TEST_DB_HOST, database: SAFE_TEST_DB_NAME } = assertFinanceIntegrationTestDbSafety({
    nodeEnv: process.env.NODE_ENV,
    optInFlag: process.env.FINANCE_INTEGRATION_TESTS_CONFIRMED,
    databaseUrl: process.env.FINANCE_TEST_DATABASE_URL,
  });
  process.env.DATABASE_URL = process.env.FINANCE_TEST_DATABASE_URL;
  console.log(`[financeOptimizationNotificationIsolation.test.ts] DB safety gate passed — host=${SAFE_TEST_DB_HOST} database=${SAFE_TEST_DB_NAME}`);

  db = await import("./db");
  ({ notifyAdmins } = await import("./notifyHelper"));
  ({
    ensureTestUser,
    deleteTestUser,
    waitForNotificationIds,
    deleteNotificationsByIds,
    findExistingNotificationIds,
    captureNotificationIds,
  } = await import("./_core/financeTestFixtures"));
});

const { getDb } = db;

async function countNotificationsFor(userId: number): Promise<number> {
  const conn = await getDb();
  if (!conn) return 0;
  const [rows] = await conn.execute(
    sql`SELECT COUNT(*) as n FROM communityNotifications WHERE recipientUserId = ${userId}`,
  ) as unknown as [{ n: number }[], unknown];
  return Number(rows[0]?.n ?? 0);
}

// ── Medium #4：全面普查所有符合「原始（覆寫前）」白名單的既有使用者 ────────
// 不只模擬一位既有管理員；查出 oxm_test 裡所有 email 符合原始白名單的真實
// 使用者，測試前後逐一比對其 notification id 集合必須完全一致。不把白名單
// email 內容輸出到任何 log。
let existingWhitelistUserIds: number[] = [];
const notificationIdsBefore = new Map<number, number[]>();

beforeAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  let originalEmails: string[] = [];
  try {
    originalEmails = JSON.parse(ORIGINAL_ADMIN_WHITELIST_EMAILS ?? "[]");
  } catch {
    originalEmails = [];
  }
  if (originalEmails.length === 0) return;
  const [rows] = await conn.execute(
    sql`SELECT id FROM users WHERE email IN (${sql.join(originalEmails.map(e => sql`${e}`), sql`, `)})`,
  ) as unknown as [{ id: number }[], unknown];
  existingWhitelistUserIds = rows.map(r => r.id);
  for (const uid of existingWhitelistUserIds) {
    notificationIdsBefore.set(uid, await captureNotificationIds(uid));
  }
});

afterAll(async () => {
  // Medium #4：全面比對——不是只看某一個模擬帳號，而是所有符合原始白名單的
  // 既有使用者，notification id 集合前後必須完全一致（不得增減）。
  for (const uid of existingWhitelistUserIds) {
    const after = await captureNotificationIds(uid);
    const before = notificationIdsBefore.get(uid) ?? [];
    expect(after.slice().sort((a, b) => a - b)).toEqual(before.slice().sort((a, b) => a - b));
  }
  adminWhitelistGuard.restore();
});

describe("ADMIN_WHITELIST_EMAILS 測試隔離：notifyAdmins 只會寫給本次覆寫後的 fixture 管理員", () => {
  it("既有（模擬）管理員完全收不到本次測試觸發的通知；本次自建的管理員 fixture 才會收到", async () => {
    let existingAdminId: number | undefined;
    let fixtureAdminId: number | undefined;
    let fixtureNotificationIds: number[] = [];
    try {
      // 模擬一個與本次測試無關、剛好用了「原始（覆寫前）白名單 email」的既有
      // 管理員帳號——即使 email 相符，覆寫後的 getAdminUserIds() 也不該找到它。
      const originalEmails: string[] = (() => {
        try { return JSON.parse(ORIGINAL_ADMIN_WHITELIST_EMAILS ?? "[]"); } catch { return []; }
      })();
      const simulatedExistingEmail = originalEmails[0] ?? "existing-admin-placeholder@example.test";
      existingAdminId = await ensureTestUser(`test-notif-iso-existing-${runId}`, "模擬既有管理員", simulatedExistingEmail);
      fixtureAdminId = await ensureTestUser(`test-notif-iso-fixture-${runId}`, "本次測試管理員 fixture", TEST_ADMIN_EMAIL);

      const beforeExisting = await countNotificationsFor(existingAdminId);
      const beforeFixture = await countNotificationsFor(fixtureAdminId);
      expect(beforeExisting).toBe(0);
      expect(beforeFixture).toBe(0);

      notifyAdmins({
        eventType: "finance_notif_isolation_test",
        eventGroup: "finance",
        message: `[NOTIF_ISO_TEST_${runId}] 測試通知`,
        actionUrl: "/admin/finance-applications",
        titleSnapshot: "通知隔離測試",
        dedupeKey: `notif_iso_test:${runId}`,
      });

      // Medium #2：精確查出 fixture 管理員收到的 notification id（不只是數量）。
      fixtureNotificationIds = await waitForNotificationIds(fixtureAdminId, 1, 2000);
      expect(fixtureNotificationIds.length).toBeGreaterThanOrEqual(1);

      // 給既有管理員一點時間，確認它「完全沒有」收到（不是還沒寫入、之後才到）
      await new Promise(r => setTimeout(r, 300));
      const afterExisting = await countNotificationsFor(existingAdminId);
      expect(afterExisting).toBe(beforeExisting);
    } finally {
      // Medium #2：先以精確主鍵刪除 fixture 管理員收到的通知，比對 affected
      // rows 與追蹤到的 id 數量一致，再刪除 user（此時應已無通知可被 cascade）。
      if (fixtureNotificationIds.length > 0) {
        const affectedRows = await deleteNotificationsByIds(fixtureNotificationIds);
        expect(affectedRows).toBe(fixtureNotificationIds.length);
      }
      if (typeof fixtureAdminId === "number") await deleteTestUser(fixtureAdminId);
      if (typeof existingAdminId === "number") await deleteTestUser(existingAdminId);
    }
  });

  it("刪除 fixture 管理員收到的通知以精確主鍵刪除，刪除後重新查詢確認 0 筆殘留（cascade 僅作為後備）", async () => {
    let fixtureAdminId: number | undefined;
    let notificationIds: number[] = [];
    try {
      fixtureAdminId = await ensureTestUser(`test-notif-iso-cascade-${runId}`, "cascade 測試管理員", TEST_ADMIN_EMAIL);
      notifyAdmins({
        eventType: "finance_notif_isolation_cascade_test",
        eventGroup: "finance",
        message: `[NOTIF_ISO_CASCADE_${runId}]`,
        actionUrl: "/admin/finance-applications",
        titleSnapshot: "cascade 測試",
        dedupeKey: `notif_iso_cascade_test:${runId}`,
      });
      // Medium #2：精確查出 notification id，不只是 COUNT。
      notificationIds = await waitForNotificationIds(fixtureAdminId, 1, 2000);
      expect(notificationIds.length).toBeGreaterThanOrEqual(1);

      // 以精確主鍵刪除作為主要清理證據；affected rows 必須與追蹤到的 id 數量一致。
      const affectedRows = await deleteNotificationsByIds(notificationIds);
      expect(affectedRows).toBe(notificationIds.length);

      // 重新查詢，確認剛才追蹤到的每一筆 id 都已經不存在。
      const stillExisting = await findExistingNotificationIds(notificationIds);
      expect(stillExisting).toEqual([]);

      const idToDelete = fixtureAdminId;
      await deleteTestUser(idToDelete); // 此時已無通知可被 cascade，純粹是使用者 fixture 清理
      fixtureAdminId = undefined;
    } finally {
      if (typeof fixtureAdminId === "number") await deleteTestUser(fixtureAdminId);
    }
  });

  it("fixture 建立中途失敗（模擬 FK 違反）時，try/finally 仍會清理已建立成功的部分，事後零殘留", async () => {
    const failureOpenId = `test-notif-iso-failure-${runId}`;
    let userId: number | undefined;
    let threw = false;
    try {
      userId = await ensureTestUser(failureOpenId, "失敗路徑測試", `${failureOpenId}@example.test`);
      // 模擬「下一步建立失敗」：financeConsultants.userId 有真正的 FK 參照
      // users.id，故意用不存在的 userId 觸發 FK 違反，代表 beforeAll／fixture
      // 建立序列中途某一步真的失敗的情境。
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      await conn.execute(sql`
        INSERT INTO financeConsultants (name, userId, isActive, createdAt, updatedAt)
        VALUES (${"失敗路徑測試顧問"}, 999999999, true, NOW(), NOW())
      `);
    } catch {
      threw = true;
    } finally {
      if (typeof userId === "number") await deleteTestUser(userId);
    }
    expect(threw).toBe(true);

    const conn = await getDb();
    if (!conn) throw new Error("no db");
    const [rows] = await conn.execute(
      sql`SELECT COUNT(*) as n FROM users WHERE openId = ${failureOpenId}`,
    ) as unknown as [{ n: number }[], unknown];
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });
});

// ── Medium #3 回歸驗證：環境變數還原機制本身的純邏輯測試 ────────────────────
// 不需要真實資料庫：直接驗證 createEnvOverrideGuard／runProtected 這兩個純
// 函式（本檔案上面用來保護 ADMIN_WHITELIST_EMAILS 覆寫的同一套機制）在
// 「安全檢查階段拋錯」「動態 import 階段拋錯」「正常結束」三種情境下，環境
// 變數是否都確實完全恢復。
describe("Medium #3 回歸：createEnvOverrideGuard／runProtected 環境變數還原保證", () => {
  const TEST_ENV_VAR = "__FINANCE_TEST_ENV_OVERRIDE_GUARD_REGRESSION__";

  it("安全檢查階段（fn 的第一步）拋錯後，環境值完全恢復", async () => {
    process.env[TEST_ENV_VAR] = "original-value";
    const { createEnvOverrideGuard: createGuard, runProtected: run } = await import("./_core/envOverrideGuard");
    const guard = createGuard(TEST_ENV_VAR, "overridden-value");
    expect(process.env[TEST_ENV_VAR]).toBe("overridden-value");

    await expect(
      run(guard.restore, async () => {
        throw new Error("模擬安全檢查失敗");
      }),
    ).rejects.toThrow("模擬安全檢查失敗");

    expect(process.env[TEST_ENV_VAR]).toBe("original-value");
    delete process.env[TEST_ENV_VAR];
  });

  it("動態 import 階段（fn 的後半段）拋錯後，環境值完全恢復", async () => {
    process.env[TEST_ENV_VAR] = "original-value-2";
    const { createEnvOverrideGuard: createGuard, runProtected: run } = await import("./_core/envOverrideGuard");
    const guard = createGuard(TEST_ENV_VAR, "overridden-value-2");

    await expect(
      run(guard.restore, async () => {
        // 模擬「安全檢查通過，但後面的動態 import 才失敗」的情境。
        await Promise.resolve();
        throw new Error("模擬動態 import 失敗");
      }),
    ).rejects.toThrow("模擬動態 import 失敗");

    expect(process.env[TEST_ENV_VAR]).toBe("original-value-2");
    delete process.env[TEST_ENV_VAR];
  });

  it("正常結束（fn 成功）時不會提前還原，必須等呼叫端自己的 afterAll 呼叫 restore()", async () => {
    process.env[TEST_ENV_VAR] = "original-value-3";
    const { createEnvOverrideGuard: createGuard, runProtected: run } = await import("./_core/envOverrideGuard");
    const guard = createGuard(TEST_ENV_VAR, "overridden-value-3");

    const result = await run(guard.restore, async () => "ok");
    expect(result).toBe("ok");
    expect(process.env[TEST_ENV_VAR]).toBe("overridden-value-3"); // 尚未還原

    guard.restore();
    expect(process.env[TEST_ENV_VAR]).toBe("original-value-3");
    delete process.env[TEST_ENV_VAR];
  });

  it("restore() 是 idempotent：呼叫兩次以上效果相同（afterAll 與 catch 區塊都可能各呼叫一次）", async () => {
    delete process.env[TEST_ENV_VAR]; // 原本未定義的情境
    const { createEnvOverrideGuard: createGuard } = await import("./_core/envOverrideGuard");
    const guard = createGuard(TEST_ENV_VAR, "overridden-value-4");
    expect(process.env[TEST_ENV_VAR]).toBe("overridden-value-4");

    guard.restore();
    expect(process.env[TEST_ENV_VAR]).toBeUndefined();
    guard.restore(); // 再呼叫一次，結果必須相同
    expect(process.env[TEST_ENV_VAR]).toBeUndefined();
  });
});
