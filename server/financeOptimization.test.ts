/**
 * 企業財務優化專區 — 整合測試。
 *
 * 涵蓋 server/db.ts、server/routers.ts 的 financeCenter／financeConsultant
 * 路由與資料模型：獨立於政府補助顧問（upgradeApplications／upgradeConsultants）
 * 的財務優化案件（financeApplications／financeConsultants）。
 *
 * ── Fail-closed DB 安全閘門 ──────────────────────────────────────────────
 * 這個檔案會真的 INSERT／UPDATE／DELETE 資料，因此在任何資料庫操作之前，
 * 必須先通過 assertFinanceIntegrationTestDbSafety() 的檢查：
 *   1. NODE_ENV 必須是 "test"（vitest 預設會自動設定，不需要手動指定）。
 *   2. 必須明確設定 FINANCE_INTEGRATION_TESTS_CONFIRMED=1（opt-in 旗標）。
 *   3. FINANCE_TEST_DATABASE_URL 的 host 必須是 loopback（localhost／
 *      127.0.0.1／::1）——只檢查 host 不夠，因為 SSH／port-forward tunnel
 *      仍可能讓正式資料庫看起來像 localhost。
 *   4. database 名稱必須精確等於核准的測試資料庫名稱（預設 "oxm_test"）。
 * 任一條件不符會在最頂層直接 throw，整份測試檔案完全不會執行到任何測試、
 * 更不會呼叫任何 db.ts 函式。詳見 server/_core/financeIntegrationTestDbGuard.ts
 * 與其純邏輯單元測試 server/financeIntegrationTestDbGuard.test.ts。
 *
 * 通過安全閘門後，這裡才把 process.env.DATABASE_URL 覆寫成
 * FINANCE_TEST_DATABASE_URL（getDb() 是 lazy singleton，只在第一次真正呼叫
 * 時才讀取這個值，因此在任何 it()/beforeAll() 執行前覆寫是安全的）。
 *
 * ── Fixture 原則（本輪修正）──────────────────────────────────────────────
 * 不再暫時綁定／解除既有 north／central／south 補助顧問（該作法已被回饋
 * 認定會弄髒共用測試資料庫的既有狀態）。oxm_test 是全新複製 schema、完全
 * 沒有任何 upgradeConsultants／financeConsultants 種子資料的隔離資料庫，
 * 因此本檔案改成「自己建立一筆新的 upgradeConsultants fixture、自己刪除」，
 * 徹底不觸碰任何非自己建立的顧問列。所有 user、factory、財務顧問、補助顧問
 * 與案件都由本檔案建立，並只清理自己建立的 fixture。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { assertFinanceIntegrationTestDbSafety } from "./_core/financeIntegrationTestDbGuard";
import type { TrpcContext } from "./_core/context";

// runId 必須在任何模組被動態載入之前就先算好（純值運算，不依賴 DB／router），
// 因為下面要用它組出這次測試唯一的管理員白名單 email，且這個 email 必須在
// server/_core/env.ts（透過 ./routers 遞移載入、模組頂層就會快取
// ADMIN_WHITELIST_EMAILS 的值）被評估之前就設定好。
const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PREFIX = `[FIN_TEST_${runId}]`;

// ── 管理員通知隔離（第七輪修正）───────────────────────────────────────────
// 舊版直接借用正式 ADMIN_WHITELIST_EMAILS 的真實 email（scottsusu0513@gmail.com）
// 建立測試用「管理員」fixture，讓 getAdminUserIds()／notifyAdmins() 認得它是
// 管理員。問題在於 getAdminUserIds()（server/db.ts）是用 email 對 users 表做
// 全域比對，任何「email 剛好等於正式白名單 email」的既有使用者都會被
// notifyAdmins() 一併寫入測試通知——與這次測試建立的 fixture 完全無關的既有
// 資料因此被污染（第六輪／第七輪驗收發現的殘留通知即為此因）。
// 修正方式：在任何會快取 ADMIN_WHITELIST_EMAILS 的模組被動態載入之前，把這個
// 測試 process 的 process.env.ADMIN_WHITELIST_EMAILS 暫時覆寫成這次測試唯一、
// 隨機產生的 email——只有這次測試自建的 fixture 使用者會符合這個白名單，
// 不可能命中任何既有使用者。這只在這個 vitest 測試 process 的記憶體內生效，
// 不寫入 .env、不改變 .env 本身、不影響正式站或 pnpm dev（那些行程有各自
// 獨立的 process.env），結束後在 afterAll 還原成原始值。
const FIN_TEST_ADMIN_EMAIL = `fin-test-admin-${runId}@example.test`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([FIN_TEST_ADMIN_EMAIL]);

// ── Fail-closed 安全閘門：真正的執行順序保證 ────────────────────────────────
// ESM 的 static import 會在模組載入階段被 hoist，實際評估順序永遠早於同檔案
// 內任何一般敘述式——即使把 static import 寫在檔案最下面，它仍然會在下面這段
// 驗證程式碼之前執行。因此不能用「把 import 寫在後面」這種文字順序來保證安全，
// 必須把所有會觸碰 DB／讀取 DATABASE_URL 的模組（./db、./routers，以及它們遞
// 移 import 到的任何模組，例如 server/_core/env.ts 會在模組頂層以
// `process.env.DATABASE_URL ?? ""` 這種方式把值快取進一個 const 物件）全部
// 改成動態 import()，並且用 await 確保它們真的要等到下面驗證＋覆寫
// process.env.DATABASE_URL 完成之後才會開始載入、評估。
// `import type` 純型別匯入在編譯後會被完全抹除、不會產生任何執行期 import
// 陳述式，因此 TrpcContext 保留 static import type 是安全的。
const { host: SAFE_TEST_DB_HOST, database: SAFE_TEST_DB_NAME } = assertFinanceIntegrationTestDbSafety({
  nodeEnv: process.env.NODE_ENV,
  optInFlag: process.env.FINANCE_INTEGRATION_TESTS_CONFIRMED,
  databaseUrl: process.env.FINANCE_TEST_DATABASE_URL,
});
process.env.DATABASE_URL = process.env.FINANCE_TEST_DATABASE_URL;
console.log(`[financeOptimization.test.ts] DB safety gate passed — host=${SAFE_TEST_DB_HOST} database=${SAFE_TEST_DB_NAME}`);

// 安全閘門通過、process.env.DATABASE_URL 已覆寫為核准值之後，才動態載入任何
// 會讀取 DATABASE_URL 或連線 DB 的模組（./routers 會 import ./db、
// server/_core/env.ts 等）——這也是 ADMIN_WHITELIST_EMAILS 覆寫必須生效的
// 同一個時間點之後，道理相同：./routers 遞移載入 server/_core/env.ts 時才會
// 把 ADMIN_WHITELIST_EMAILS 讀進 ENV.adminWhitelistEmails 常數。
const { appRouter } = await import("./routers");
const db = await import("./db");
const { getDb } = db;
// 第九輪修正（Medium #1／#2）：共用 fixture／cleanup helper 本身 import 了
// ./db，必須跟 ./routers、./db 一樣延後到安全閘門＋ADMIN_WHITELIST_EMAILS
// 覆寫都完成之後才動態載入，否則會提早把 server/_core/env.ts 的
// ADMIN_WHITELIST_EMAILS 快取成覆寫前的原始值，破壞這個檔案原本的隔離保證。
const {
  ensureTestUser,
  deleteTestUser,
  createTestFactory,
  deleteTestFactory,
  deleteFinanceApp,
  deleteFinanceConsultant,
  captureNotificationIds,
  waitForNotificationIds,
  deleteNotificationsByIds,
  findExistingNotificationIds,
} = await import("./_core/financeTestFixtures");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const isAdmin = overrides?.role === "admin";
  // 注意：id 沒有預設值，必須由呼叫端明確指定一個真實存在於 oxm_test 的
  // userId（見下方 adminCtx(id)）。這裡故意不再沿用舊版寫死 id:1 的作法——
  // 那只是因為共用 oxm 開發資料庫剛好有 id=1 的使用者才「恰好能動」，在全新
  // 複製、auto_increment 從任意值開始的隔離 oxm_test 裡，id=1 不保證對應
  // 任何真實使用者，寫入 lastUpdatedByUserId 這類有 FK 約束的欄位時會直接
  // 失敗（ER_NO_REFERENCED_ROW_2）。
  const user: AuthenticatedUser = {
    id: overrides?.id ?? -1,
    openId: isAdmin ? "test-finance-admin" : "test-finance-user",
    // isAdminUser()（server/_core/admin.ts）是用這個 email 比對
    // ENV.adminWhitelistEmails——已被上面覆寫成只包含 FIN_TEST_ADMIN_EMAIL，
    // 所以這裡的管理員 context 也必須用同一個 email，adminProcedure 才會放行。
    email: isAdmin ? FIN_TEST_ADMIN_EMAIL : "test@example.com",
    name: "Test User",
    loginMethod: isAdmin ? "google" : "manus",
    role: "user",
    isAdmin,
    isFactoryOwner: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function unauthenticatedContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const adminCtx = (id: number) => createAuthContext({ role: "admin", id });
const userCtx = (id: number, name: string) => createAuthContext({ role: "user", id, name });

async function createTestFinanceApp(overrides: {
  factoryId: number;
  status: db.FinanceApplication["status"];
  assignedConsultantId?: number | null;
  companyName?: string;
}): Promise<number> {
  return db.createFinanceApplication({
    factoryId: overrides.factoryId,
    companyNameSnapshot: overrides.companyName ?? `${PREFIX} 工廠A`,
    companyAddressSnapshot: "測試地址",
    contactName: "測試", phone: "0900000000", contactTime: "任何時間",
    consentAgreed: true, status: overrides.status,
    assignedConsultantId: overrides.assignedConsultantId ?? null,
    statusTimeline: { [overrides.status]: new Date().toISOString() },
  });
}

async function waitForNotification(dedupeKeyPrefix: string, timeoutMs = 2000): Promise<number> {
  const conn = await getDb();
  if (!conn) return 0;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [rows] = await conn.execute(
      sql`SELECT COUNT(*) as n FROM communityNotifications WHERE dedupeKey LIKE ${`${dedupeKeyPrefix}%`}`,
    ) as unknown as [{ n: number }[], unknown];
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0 || Date.now() > deadline) return n;
    await new Promise(r => setTimeout(r, 50));
  }
}

// ── 測試資料：申請人（工廠 owner）與其已審核通過的工廠 ─────────────────────
// 型別故意用 number | undefined（不是預設 1 或其他既有身分 fallback）：
// 在 beforeAll 中途失敗時，尚未建立的欄位必須保持 undefined，讓下面的
// cleanupCreatedFixtures() 能精確判斷「這個 ID 是否真的建立成功過」，
// 絕對不會把 undefined／null／預設值傳進任何 DELETE 的 SQL 參數。
let ownerAId: number | undefined;
let ownerBId: number | undefined;
let factoryAId: number | undefined;
let factoryBId: number | undefined;

// ── 財務顧問（獨立於政府補助顧問） ────────────────────────────────────────
let financeConsultantUserId: number | undefined;
let financeConsultantId: number | undefined;

// 用來驗證 notifyAdmins 實際有寫入通知的測試用「管理員」帳號——email 是本次
// 執行唯一產生的 FIN_TEST_ADMIN_EMAIL（見檔案開頭的 ADMIN_WHITELIST_EMAILS
// 覆寫），不會命中任何既有使用者，getAdminUserIds() 只可能找到這個 fixture。
let adminNotifyUserId: number | undefined;

/**
 * 依 FK 安全順序清理本次 beforeAll 已確定建立成功的 fixture：
 * 子資料（financeApplications／communityNotifications，由
 * deleteTestFactory／users 的 ON DELETE CASCADE 一併處理）→
 * consultant／factory 關聯 → factory → user。
 * 每一步都先判斷對應 ID 是否為 number（真的建立成功過）才刪除，
 * 未建立的欄位維持 undefined、直接跳過，不會把 undefined 傳進 SQL。
 * success、afterAll、以及 beforeAll 中途失敗的 catch 全部呼叫同一支函式，
 * 且都是安全、可重複呼叫（已刪除的 ID 再刪一次只是 affected rows=0）。
 */
async function cleanupSharedFixtures(): Promise<void> {
  if (typeof financeConsultantId === "number") {
    await deleteFinanceConsultant(financeConsultantId);
    financeConsultantId = undefined;
  }
  if (typeof factoryAId === "number") {
    await deleteTestFactory(factoryAId); // 內含 DELETE FROM financeApplications WHERE factoryId=...
    factoryAId = undefined;
  }
  if (typeof factoryBId === "number") {
    await deleteTestFactory(factoryBId);
    factoryBId = undefined;
  }
  if (typeof ownerAId === "number") {
    await deleteTestUser(ownerAId);
    ownerAId = undefined;
  }
  if (typeof ownerBId === "number") {
    await deleteTestUser(ownerBId);
    ownerBId = undefined;
  }
  if (typeof financeConsultantUserId === "number") {
    await deleteTestUser(financeConsultantUserId);
    financeConsultantUserId = undefined;
  }
  if (typeof adminNotifyUserId === "number") {
    // 第九輪修正（Medium #2）：不再只依賴刪除使用者觸發的 ON DELETE CASCADE
    // 作為「通知已清乾淨」的證據。先精確查出這個 fixture 管理員目前收到的
    // 所有 notification id，用這些精確主鍵刪除，比對 affected rows 與查到的
    // id 數量一致，再重新查詢確認全部不存在，最後才刪除 user 本身（此時 user
    // 底下應該已經沒有通知，cascade 只是收尾防線，不是主要證據）。
    const notificationIds = await captureNotificationIds(adminNotifyUserId);
    if (notificationIds.length > 0) {
      const affectedRows = await deleteNotificationsByIds(notificationIds);
      if (affectedRows !== notificationIds.length) {
        throw new Error(
          `[cleanupSharedFixtures] adminNotifyUserId 通知清理筆數不符：追蹤到 ${notificationIds.length} 筆，實際刪除 ${affectedRows} 筆`,
        );
      }
      const stillExisting = await findExistingNotificationIds(notificationIds);
      if (stillExisting.length > 0) {
        throw new Error(`[cleanupSharedFixtures] 刪除後仍有殘留 notification id：${stillExisting.join(",")}`);
      }
    }
    await deleteTestUser(adminNotifyUserId);
    adminNotifyUserId = undefined;
  }
}

function restoreAdminWhitelistEmails(): void {
  if (ORIGINAL_ADMIN_WHITELIST_EMAILS === undefined) {
    delete process.env.ADMIN_WHITELIST_EMAILS;
  } else {
    process.env.ADMIN_WHITELIST_EMAILS = ORIGINAL_ADMIN_WHITELIST_EMAILS;
  }
}

beforeAll(async () => {
  try {
    ownerAId = await ensureTestUser(`test-fin-ownerA-${runId}`, "財務測試申請人A");
    ownerBId = await ensureTestUser(`test-fin-ownerB-${runId}`, "財務測試申請人B");
    factoryAId = await createTestFactory(ownerAId, `${PREFIX} 工廠A`, "approved");
    factoryBId = await createTestFactory(ownerBId, `${PREFIX} 工廠B`, "approved");

    financeConsultantUserId = await ensureTestUser(`test-fin-consultant-${runId}`, "財務測試顧問");
    financeConsultantId = await db.adminCreateFinanceConsultant("財務測試顧問設定");
    await db.adminBindFinanceConsultantUser(financeConsultantId, financeConsultantUserId);

    adminNotifyUserId = await ensureTestUser(`test-fin-admin-notify-${runId}`, "財務測試管理員收件人", FIN_TEST_ADMIN_EMAIL);
  } catch (err) {
    // 中途失敗也要清理已經建立成功的部分，不留下半套 fixture。
    await cleanupSharedFixtures();
    throw err;
  }
}, 30000);

afterAll(async () => {
  await cleanupSharedFixtures();
  restoreAdminWhitelistEmails();
}, 30000);

// ── 1. 未登入不能送出 ──────────────────────────────────────────────────────
describe("financeCenter.submitApplication: 未登入", () => {
  it("未登入呼叫直接被拒絕（UNAUTHORIZED）", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext());
    await expect(caller.financeCenter.submitApplication({
      contactName: "測試聯絡人", phone: "0900000000", contactTime: "任何時間",
      consentAgreed: true, factoryId: factoryAId,
    })).rejects.toThrow();
  });
});

// ── 2. 使用者不能替無權管理的工廠送出；3. 公司名稱地址由 server 讀取 ──────
describe("financeCenter.submitApplication: 工廠授權與伺服器端資料來源", () => {
  it("非工廠 owner／co-manager 送出會被拒絕（FORBIDDEN）", async () => {
    const caller = appRouter.createCaller(userCtx(ownerBId, "財務測試申請人B"));
    await expect(caller.financeCenter.submitApplication({
      contactName: "測試聯絡人", phone: "0900000000", contactTime: "任何時間",
      consentAgreed: true, factoryId: factoryAId, // ownerB 嘗試代表 ownerA 的工廠送出
    })).rejects.toThrow(/無法代表此工廠送出申請/);
  });

  it("公司名稱／地址由 server 依 factoryId 重新讀取，不接受前端提供的欄位（schema 本身不接受這些輸入）", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
    const result = await caller.financeCenter.submitApplication({
      contactName: "測試聯絡人", phone: "0900000000", contactTime: "平日上午",
      consentAgreed: true, factoryId: factoryAId,
      // @ts-expect-error 刻意夾帶偽造欄位，驗證 zod 會忽略／schema 不接受
      companyName: "偽造公司名稱", companyAddress: "偽造地址",
    } as any);
    expect(result.success).toBe(true);
    const app = await db.getFinanceApplicationById(result.id);
    expect(app?.companyNameSnapshot).toBe(`${PREFIX} 工廠A`);
    expect(app?.companyAddressSnapshot).toBe(`${PREFIX} 工廠A 測試地址一號`);
    await deleteFinanceApp(result.id);
  });
});

// ── 4. 表單不包含統編及公司經營概況 ───────────────────────────────────────
describe("financeCenter.submitApplication input schema: 不含統編／經營概況／下次追蹤日期", () => {
  const source = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf-8");
  const block = source.match(/financeCenter: router\(\{[\s\S]*?financeConsultant: router\(\{/)?.[0] ?? "";

  it("submitApplication 輸入 schema 找不到統編、經營概況、稅務融資勾選、下次追蹤日期欄位", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/統一編號|taxId|businessOverview|經營概況|hasTaxIssue|hasFinancingIssue|nextFollowUpDate/);
  });
});

// ── 5. 聯絡人／電話／方便聯絡時間／同意欄位驗證 ───────────────────────────
describe("financeCenter.submitApplication: 欄位驗證", () => {
  it("電話格式不正確時拒絕送出", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
    await expect(caller.financeCenter.submitApplication({
      contactName: "測試聯絡人", phone: "abc", contactTime: "平日上午",
      consentAgreed: true, factoryId: factoryAId,
    })).rejects.toThrow();
  });

  it("未勾選同意條款（consentAgreed 非 true）時 zod 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
    await expect(caller.financeCenter.submitApplication({
      contactName: "測試聯絡人", phone: "0900000000", contactTime: "平日上午",
      consentAgreed: false as unknown as true, factoryId: factoryAId,
    })).rejects.toThrow();
  });

  it("聯絡人姓名為空字串時拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
    await expect(caller.financeCenter.submitApplication({
      contactName: "", phone: "0900000000", contactTime: "平日上午",
      consentAgreed: true, factoryId: factoryAId,
    })).rejects.toThrow();
  });
});

// ── 6. 重複申請防護；7. 結案後可重新申請 ──────────────────────────────────
describe("financeCenter.submitApplication: 重複申請防護與結案後重新申請", () => {
  it("同一工廠已有 new／evaluating／deferred 未結案案件時，再次申請被拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
    const first = await caller.financeCenter.submitApplication({
      contactName: "聯絡人1", phone: "0900000001", contactTime: "上午",
      consentAgreed: true, factoryId: factoryAId,
    });
    try {
      await expect(caller.financeCenter.submitApplication({
        contactName: "聯絡人2", phone: "0900000002", contactTime: "下午",
        consentAgreed: true, factoryId: factoryAId,
      })).rejects.toThrow(/已有進行中的企業財務優化案件/);
    } finally {
      await deleteFinanceApp(first.id);
    }
  });

  it("案件結案（won）後，同一工廠可以重新建立新案件", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
    const first = await caller.financeCenter.submitApplication({
      contactName: "聯絡人1", phone: "0900000001", contactTime: "上午",
      consentAgreed: true, factoryId: factoryAId,
    });
    // new -> evaluating -> won（顧問身分推進，走真實 tRPC 呼叫）
    const consultantCaller = appRouter.createCaller(userCtx(financeConsultantUserId, "財務測試顧問"));
    await consultantCaller.financeConsultant.updateCaseStatus({ applicationId: first.id, nextStatus: "evaluating" });
    await consultantCaller.financeConsultant.updateCaseStatus({ applicationId: first.id, nextStatus: "won" });

    const second = await caller.financeCenter.submitApplication({
      contactName: "聯絡人3", phone: "0900000003", contactTime: "晚上",
      consentAgreed: true, factoryId: factoryAId,
    });
    expect(second.success).toBe(true);
    await deleteFinanceApp(first.id);
    await deleteFinanceApp(second.id);
  });
});

// ── 8. 合法／非法狀態轉換 ──────────────────────────────────────────────────
describe("financeConsultant.updateCaseStatus: 狀態機", () => {
  async function makeCase(status: db.FinanceApplication["status"]): Promise<number> {
    return createTestFinanceApp({ factoryId: factoryAId, status, assignedConsultantId: financeConsultantId });
  }

  it("new → evaluating 合法", async () => {
    const id = await makeCase("new");
    try {
      const caller = appRouter.createCaller(userCtx(financeConsultantUserId, "財務測試顧問"));
      await caller.financeConsultant.updateCaseStatus({ applicationId: id, nextStatus: "evaluating" });
      const app = await db.getFinanceApplicationById(id);
      expect(app?.status).toBe("evaluating");
    } finally { await deleteFinanceApp(id); }
  });

  it("new → won 非法（必須先經過 evaluating）", async () => {
    const id = await makeCase("new");
    try {
      const caller = appRouter.createCaller(userCtx(financeConsultantUserId, "財務測試顧問"));
      await expect(caller.financeConsultant.updateCaseStatus({ applicationId: id, nextStatus: "won" })).rejects.toThrow();
    } finally { await deleteFinanceApp(id); }
  });

  it("evaluating → deferred／not_interested／won 皆合法", async () => {
    for (const next of ["deferred", "not_interested", "won"] as const) {
      const id = await makeCase("evaluating");
      try {
        const caller = appRouter.createCaller(userCtx(financeConsultantUserId, "財務測試顧問"));
        await caller.financeConsultant.updateCaseStatus({ applicationId: id, nextStatus: next });
        const app = await db.getFinanceApplicationById(id);
        expect(app?.status).toBe(next);
      } finally { await deleteFinanceApp(id); }
    }
  });

  it("deferred → evaluating／not_interested／won 皆合法", async () => {
    for (const next of ["evaluating", "not_interested", "won"] as const) {
      const id = await makeCase("deferred");
      try {
        const caller = appRouter.createCaller(userCtx(financeConsultantUserId, "財務測試顧問"));
        await caller.financeConsultant.updateCaseStatus({ applicationId: id, nextStatus: next });
        const app = await db.getFinanceApplicationById(id);
        expect(app?.status).toBe(next);
      } finally { await deleteFinanceApp(id); }
    }
  });

  it("結案狀態（not_interested／won）無法再轉出", async () => {
    const wonId = await makeCase("won");
    const niId = await makeCase("not_interested");
    try {
      const caller = appRouter.createCaller(userCtx(financeConsultantUserId, "財務測試顧問"));
      await expect(caller.financeConsultant.updateCaseStatus({ applicationId: wonId, nextStatus: "evaluating" })).rejects.toThrow();
      await expect(caller.financeConsultant.updateCaseStatus({ applicationId: niId, nextStatus: "evaluating" })).rejects.toThrow();
    } finally {
      await deleteFinanceApp(wonId);
      await deleteFinanceApp(niId);
    }
  });
});

// ── 9. 補助顧問不能讀取財務案件；10. 財務顧問不能讀取補助案件 ─────────────
// 不再暫時綁定既有 north／central／south 補助顧問。oxm_test 是全新複製的
// 隔離資料庫，upgradeConsultants 表一開始完全沒有資料，因此這裡自己建立一筆
// 全新的 north 顧問 fixture（沒有任何既有列可能被誤觸），測試結束後自行刪除。
describe("跨顧問類型權限隔離", () => {
  it("財務顧問呼叫 upgradeConsultant.myCases 會被拒絕（沒有補助顧問身分）", async () => {
    const caller = appRouter.createCaller(userCtx(financeConsultantUserId, "財務測試顧問"));
    await expect(caller.upgradeConsultant.myCases({ limit: 50, offset: 0 })).rejects.toThrow(/您不是顧問/);
  });

  it("補助顧問（自建 fixture，非既有 north/central/south）呼叫 financeConsultant.myCases 會被拒絕（沒有財務顧問身分）", async () => {
    // 兩個步驟都建立資源，中途任何一步失敗都必須清理已成功的部分，因此連建立
    // 過程都包在 try 裡，用 let（不是 const）+ undefined 初始值追蹤。
    let govUserId: number | undefined;
    let govConsultantId: number | undefined;
    try {
      govUserId = await ensureTestUser(`test-fin-govonly-${runId}`, "純補助顧問測試帳號");
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      const [result] = await conn.execute(sql`
        INSERT INTO upgradeConsultants (name, regionKey, userId, serviceAreas, isActive, createdAt, updatedAt)
        VALUES (${"財務測試-自建北部補助顧問"}, "north", ${govUserId}, ${JSON.stringify(["台北市"])}, true, NOW(), NOW())
      `) as unknown as [{ insertId: number }, unknown];
      govConsultantId = result.insertId;

      const caller = appRouter.createCaller(userCtx(govUserId, "純補助顧問測試帳號"));
      await expect(caller.financeConsultant.myCases({ limit: 50, offset: 0 })).rejects.toThrow(/您不是財務優化顧問/);
    } finally {
      const conn = await getDb();
      if (typeof govConsultantId === "number" && conn) {
        await conn.execute(sql`DELETE FROM upgradeConsultants WHERE id = ${govConsultantId}`);
      }
      if (typeof govUserId === "number") {
        await deleteTestUser(govUserId);
      }
    }
  });
});

// ── 11. 管理員可查看兩類案件 ───────────────────────────────────────────────
describe("管理員可查看補助與財務兩類案件", () => {
  it("admin.financeConsultant.myCases 可看到財務案件；admin.upgradeConsultant.myCases 可看到補助案件", async () => {
    const financeId = await createTestFinanceApp({ factoryId: factoryAId, status: "new" });
    try {
      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      const financeResult = await admin.financeConsultant.myCases({ limit: 200, offset: 0 });
      expect(financeResult.items.map(i => i.id)).toContain(financeId);
      // 補助顧問中心對管理員一律可查看（既有行為，未受影響）
      const upgradeResult = await admin.upgradeConsultant.myCases({ limit: 200, offset: 0 });
      expect(Array.isArray(upgradeResult.items)).toBe(true);
    } finally {
      await deleteFinanceApp(financeId);
    }
  });
});

// ── 12. 顧問內部備註不會洩漏給一般申請人 ──────────────────────────────────
describe("financeCenter.myApplicationProgress: 不回傳顧問內部備註", () => {
  it("顧問寫入備註後，申請人查詢進度時看不到 notes 欄位", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
    const submitted = await caller.financeCenter.submitApplication({
      contactName: "聯絡人", phone: "0900000009", contactTime: "上午",
      consentAgreed: true, factoryId: factoryAId,
    });
    try {
      const consultantCaller = appRouter.createCaller(userCtx(financeConsultantUserId, "財務測試顧問"));
      await consultantCaller.financeConsultant.updateCaseNotes({ applicationId: submitted.id, notes: "這是顧問內部備註，不可外洩" });

      const progress = await caller.financeCenter.myApplicationProgress();
      const item = progress.applications.find((a: any) => a.id === submitted.id);
      expect(item).toBeTruthy();
      expect(item).not.toHaveProperty("notes");
      expect(item).not.toHaveProperty("assignedConsultantId");
      expect(item).not.toHaveProperty("lastUpdatedByUserId");
      expect(item).not.toHaveProperty("lastUpdatedByNameSnapshot");
      expect(Object.keys(item as object).sort()).toEqual([
        "companyAddressSnapshot", "companyNameSnapshot", "consentAgreed",
        "contactName", "contactTime", "createdAt", "factoryId", "id",
        "phone", "status", "statusTimeline", "updatedAt",
      ].sort());
    } finally {
      await deleteFinanceApp(submitted.id);
    }
  });
});

// ── financeConsultants.userId UNIQUE 約束（允許多筆 NULL） ────────────────
describe("financeConsultants.userId: DB 層 UNIQUE 約束", () => {
  it("同一 userId 不能被綁定到兩筆顧問紀錄；DB 唯一索引在高併發下仍可靠擋下", async () => {
    const conn = await getDb();
    if (!conn) throw new Error("no db");
    const extraConsultantId = await db.adminCreateFinanceConsultant("財務測試顧問設定-重複綁定測試");
    try {
      await expect(
        conn.execute(sql`UPDATE financeConsultants SET userId = ${financeConsultantUserId} WHERE id = ${extraConsultantId}`)
      ).rejects.toThrow();
    } finally {
      await deleteFinanceConsultant(extraConsultantId);
    }
  });

  it("多筆顧問紀錄的 userId 皆為 NULL 時不受唯一索引限制（尚未綁定的顧問可以並存）", async () => {
    let idA: number | undefined;
    let idB: number | undefined;
    try {
      idA = await db.adminCreateFinanceConsultant("財務測試顧問設定-未綁定A");
      idB = await db.adminCreateFinanceConsultant("財務測試顧問設定-未綁定B");
      const a = await db.getFinanceConsultantById(idA);
      const b = await db.getFinanceConsultantById(idB);
      expect(a?.userId ?? null).toBeNull();
      expect(b?.userId ?? null).toBeNull();
    } finally {
      if (typeof idA === "number") await deleteFinanceConsultant(idA);
      if (typeof idB === "number") await deleteFinanceConsultant(idB);
    }
  });

  it("financeConsultant.adminBindUser 綁定已被其他顧問紀錄使用的 userId 時，回傳 BAD_REQUEST 而非內部錯誤", async () => {
    const extraConsultantId = await db.adminCreateFinanceConsultant("財務測試顧問設定-API重複綁定測試");
    try {
      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      await expect(admin.financeConsultant.adminBindUser({
        consultantId: extraConsultantId, userId: financeConsultantUserId,
      })).rejects.toThrow(/一個帳號同時只能擔任一位財務優化顧問/);
      const extra = await db.getFinanceConsultantById(extraConsultantId);
      expect(extra?.userId ?? null).toBeNull();
    } finally {
      await deleteFinanceConsultant(extraConsultantId);
    }
  });

  it("解除綁定（userId=null）不受唯一約束影響", async () => {
    let tempUserId: number | undefined;
    let tempConsultantId: number | undefined;
    try {
      tempUserId = await ensureTestUser(`test-fin-unbind-${runId}`, "財務解綁測試帳號");
      tempConsultantId = await db.adminCreateFinanceConsultant("財務測試顧問設定-解綁測試");
      await db.adminBindFinanceConsultantUser(tempConsultantId, tempUserId);
      const result = await db.adminBindFinanceConsultantUser(tempConsultantId, null);
      expect(result.reassignedCases).toEqual([]);
      const after = await db.getFinanceConsultantById(tempConsultantId);
      expect(after?.userId ?? null).toBeNull();
    } finally {
      if (typeof tempConsultantId === "number") await deleteFinanceConsultant(tempConsultantId);
      if (typeof tempUserId === "number") await deleteTestUser(tempUserId);
    }
  });

  it("adminBindUser 即使 pre-check 通過，DB 層 ER_DUP_ENTRY 競態也會被攔截成固定的 BAD_REQUEST（不外洩原始 SQL 錯誤）", async () => {
    // 模擬併發：兩個管理員請求幾乎同時嘗試把「同一個」userId 綁到兩筆不同的
    // 顧問紀錄。router 的 pre-check（assertFinanceConsultantUserNotBoundElsewhere）
    // 本身有 await，兩個 Promise.all 併發呼叫都可能在對方寫入前通過 pre-check，
    // 真正的防線是 DB 的 fc_user_id_uq UNIQUE INDEX；這裡驗證併發下仍然只有
    //一筆成功，且失敗的那筆錯誤訊息乾淨（不是原始 MySQL 錯誤字串）。
    let raceUserId: number | undefined;
    let consultantX: number | undefined;
    let consultantY: number | undefined;
    try {
      raceUserId = await ensureTestUser(`test-fin-race-${runId}`, "財務併發測試帳號");
      consultantX = await db.adminCreateFinanceConsultant("財務測試顧問設定-併發X");
      consultantY = await db.adminCreateFinanceConsultant("財務測試顧問設定-併發Y");
      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      const results = await Promise.allSettled([
        admin.financeConsultant.adminBindUser({ consultantId: consultantX, userId: raceUserId }),
        admin.financeConsultant.adminBindUser({ consultantId: consultantY, userId: raceUserId }),
      ]);
      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      const errMessage = rejected[0].reason instanceof Error ? rejected[0].reason.message : String(rejected[0].reason);
      expect(errMessage).not.toMatch(/SQL|ER_DUP_ENTRY|Duplicate entry/i);
      expect(errMessage).toMatch(/一個帳號同時只能擔任一位財務優化顧問/);
    } finally {
      if (typeof consultantX === "number") await deleteFinanceConsultant(consultantX);
      if (typeof consultantY === "number") await deleteFinanceConsultant(consultantY);
      if (typeof raceUserId === "number") await deleteTestUser(raceUserId);
    }
  });
});

// ── 13. 未設定財務顧問時案件仍安全建立 ────────────────────────────────────
describe("尚未指派財務顧問時的安全建立", () => {
  it("暫時停用唯一的財務顧問後送出：案件仍建立成功，assignedConsultantId 為 null，管理員仍看得到", async () => {
    await db.adminSetFinanceConsultantActive(financeConsultantId, false);
    try {
      const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
      const result = await caller.financeCenter.submitApplication({
        contactName: "聯絡人", phone: "0900000008", contactTime: "上午",
        consentAgreed: true, factoryId: factoryAId,
      });
      expect(result.success).toBe(true);
      const app = await db.getFinanceApplicationById(result.id);
      expect(app?.assignedConsultantId).toBeNull();
      expect(app?.status).toBe("new");

      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      const adminList = await admin.financeCenter.adminList({ limit: 200, offset: 0 });
      const item = adminList.items.find(i => i.id === result.id);
      expect(item).toBeTruthy();
      expect((item as any)?.assignedConsultantUserName ?? null).toBeNull();

      await deleteFinanceApp(result.id);
    } finally {
      await db.adminSetFinanceConsultantActive(financeConsultantId, true);
    }
  });
});

// ── 14（新）. autoAssignFinanceConsultant 候選人邏輯：isActive AND userId 已綁定 ──
describe("autoAssignFinanceConsultant: 候選人必須同時符合 isActive=true 且已綁定 userId", () => {
  it("唯一 active 顧問但 userId=NULL：不得自動指派", async () => {
    // beforeAll 建立的 financeConsultantId 本身就是 active+已綁定，必須暫時
    // 停用它，才能讓「未綁定的這筆」成為系統中唯一的 active 顧問，真正驗證
    // 「唯一 active 但未綁定」這個情境（否則永遠會先命中 financeConsultantId）。
    await db.adminSetFinanceConsultantActive(financeConsultantId, false);
    const unboundActiveId = await db.adminCreateFinanceConsultant("財務測試-唯一啟用未綁定");
    try {
      const result = await db.autoAssignFinanceConsultant();
      expect(result).toBeNull();
    } finally {
      await db.adminSetFinanceConsultantActive(financeConsultantId, true);
      await deleteFinanceConsultant(unboundActiveId);
    }
  });

  it("一位 active＋已綁定，以及一位 active＋未綁定：自動指派給已綁定者", async () => {
    const unboundActiveId = await db.adminCreateFinanceConsultant("財務測試-啟用未綁定(混合)");
    try {
      // beforeAll 已建立 financeConsultantId（active + 已綁定 financeConsultantUserId）
      const result = await db.autoAssignFinanceConsultant();
      expect(result?.id).toBe(financeConsultantId);
    } finally {
      await deleteFinanceConsultant(unboundActiveId);
    }
  });

  it("兩位 active＋已綁定：不得自動指派（無法判斷該分派給誰）", async () => {
    let secondUserId: number | undefined;
    let secondConsultantId: number | undefined;
    try {
      secondUserId = await ensureTestUser(`test-fin-second-consultant-${runId}`, "財務測試顧問二");
      secondConsultantId = await db.adminCreateFinanceConsultant("財務測試顧問設定二");
      await db.adminBindFinanceConsultantUser(secondConsultantId, secondUserId);
      const result = await db.autoAssignFinanceConsultant();
      expect(result).toBeNull();
    } finally {
      if (typeof secondConsultantId === "number") await deleteFinanceConsultant(secondConsultantId);
      if (typeof secondUserId === "number") await deleteTestUser(secondUserId);
    }
  });

  it("零位有效顧問（停用 beforeAll 建立的唯一顧問）：不得自動指派", async () => {
    await db.adminSetFinanceConsultantActive(financeConsultantId, false);
    try {
      const result = await db.autoAssignFinanceConsultant();
      expect(result).toBeNull();
    } finally {
      await db.adminSetFinanceConsultantActive(financeConsultantId, true);
    }
  });

  it("submitApplication 端對端驗證：零位有效顧問時，新案件安全建立為未指派，且管理員收到通知", async () => {
    await db.adminSetFinanceConsultantActive(financeConsultantId, false);
    try {
      const caller = appRouter.createCaller(userCtx(ownerAId, "財務測試申請人A"));
      const beforeCount = await waitForNotification("finance_unassigned:", 100);
      const result = await caller.financeCenter.submitApplication({
        contactName: "聯絡人", phone: "0900000077", contactTime: "上午",
        consentAgreed: true, factoryId: factoryAId,
      });
      const app = await db.getFinanceApplicationById(result.id);
      expect(app?.assignedConsultantId).toBeNull();
      const afterCount = await waitForNotification(`finance_unassigned:${result.id}`, 2000);
      expect(afterCount).toBeGreaterThan(0);
      void beforeCount;
      await deleteFinanceApp(result.id);
    } finally {
      await db.adminSetFinanceConsultantActive(financeConsultantId, true);
    }
  });
});

// ── 15（新）. 禁止指派給無法承辦的顧問 ─────────────────────────────────────
describe("financeConsultant.adminAssignConsultant: 拒絕指派給無法承辦的顧問", () => {
  it("拒絕指派給已停用的顧問", async () => {
    let inactiveId: number | undefined;
    let inactiveUserId: number | undefined;
    let caseId: number | undefined;
    try {
      inactiveId = await db.adminCreateFinanceConsultant("財務測試-停用顧問");
      inactiveUserId = await ensureTestUser(`test-fin-inactive-${runId}`, "財務測試-停用顧問帳號");
      await db.adminBindFinanceConsultantUser(inactiveId, inactiveUserId);
      await db.adminSetFinanceConsultantActive(inactiveId, false);
      caseId = await createTestFinanceApp({ factoryId: factoryAId, status: "new" });
      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      await expect(admin.financeConsultant.adminAssignConsultant({
        applicationId: caseId, consultantId: inactiveId,
      })).rejects.toThrow(/已停用/);
      const app = await db.getFinanceApplicationById(caseId);
      expect(app?.assignedConsultantId).toBeNull();
    } finally {
      if (typeof caseId === "number") await deleteFinanceApp(caseId);
      if (typeof inactiveId === "number") await deleteFinanceConsultant(inactiveId);
      if (typeof inactiveUserId === "number") await deleteTestUser(inactiveUserId);
    }
  });

  it("拒絕指派給 userId=NULL 的未綁定顧問", async () => {
    let unboundId: number | undefined;
    let caseId: number | undefined;
    try {
      unboundId = await db.adminCreateFinanceConsultant("財務測試-未綁定顧問");
      caseId = await createTestFinanceApp({ factoryId: factoryAId, status: "new" });
      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      await expect(admin.financeConsultant.adminAssignConsultant({
        applicationId: caseId, consultantId: unboundId,
      })).rejects.toThrow(/尚未綁定使用者帳號/);
      const app = await db.getFinanceApplicationById(caseId);
      expect(app?.assignedConsultantId).toBeNull();
    } finally {
      if (typeof caseId === "number") await deleteFinanceApp(caseId);
      if (typeof unboundId === "number") await deleteFinanceConsultant(unboundId);
    }
  });

  it("拒絕指派給不存在的顧問 ID", async () => {
    const caseId = await createTestFinanceApp({ factoryId: factoryAId, status: "new" });
    try {
      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      await expect(admin.financeConsultant.adminAssignConsultant({
        applicationId: caseId, consultantId: 999_999_999,
      })).rejects.toThrow(/找不到顧問/);
    } finally {
      await deleteFinanceApp(caseId);
    }
  });

  it("db.adminAssignFinanceConsultant 本身也拒絕（defense-in-depth，繞過 router 直接呼叫 db 層仍受保護）", async () => {
    let inactiveId: number | undefined;
    let inactiveUserId: number | undefined;
    let caseId: number | undefined;
    try {
      inactiveId = await db.adminCreateFinanceConsultant("財務測試-DB層停用顧問");
      inactiveUserId = await ensureTestUser(`test-fin-db-inactive-${runId}`, "財務測試-DB層停用帳號");
      await db.adminBindFinanceConsultantUser(inactiveId, inactiveUserId);
      await db.adminSetFinanceConsultantActive(inactiveId, false);
      caseId = await createTestFinanceApp({ factoryId: factoryAId, status: "new" });
      await expect(db.adminAssignFinanceConsultant(caseId, inactiveId)).rejects.toThrow(/已停用/);
    } finally {
      if (typeof caseId === "number") await deleteFinanceApp(caseId);
      if (typeof inactiveId === "number") await deleteFinanceConsultant(inactiveId);
      if (typeof inactiveUserId === "number") await deleteTestUser(inactiveUserId);
    }
  });

  it("成功指派給啟用中且已綁定的顧問（正常路徑仍然可用）", async () => {
    const caseId = await createTestFinanceApp({ factoryId: factoryAId, status: "new" });
    try {
      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      await admin.financeConsultant.adminAssignConsultant({ applicationId: caseId, consultantId: financeConsultantId });
      const app = await db.getFinanceApplicationById(caseId);
      expect(app?.assignedConsultantId).toBe(financeConsultantId);
    } finally {
      await deleteFinanceApp(caseId);
    }
  });
});

// ── 16（新）. 停用／解除綁定顧問：名下未結案案件安全改為未指派 ────────────
describe("顧問停用／解除綁定：級聯安全改派", () => {
  it("停用顧問：名下 new/evaluating/deferred 案件安全改為未指派，記錄最後更新者與時間，not_interested/won 不受影響", async () => {
    let cUserId: number | undefined;
    let cId: number | undefined;
    let newCaseId: number | undefined;
    let evalCaseId: number | undefined;
    let wonCaseId: number | undefined;
    try {
      cUserId = await ensureTestUser(`test-fin-cascade-deactivate-${runId}`, "財務測試-級聯停用顧問帳號");
      cId = await db.adminCreateFinanceConsultant("財務測試-級聯停用顧問");
      await db.adminBindFinanceConsultantUser(cId, cUserId);

      newCaseId = await createTestFinanceApp({ factoryId: factoryAId, status: "new", assignedConsultantId: cId });
      evalCaseId = await createTestFinanceApp({ factoryId: factoryBId, status: "evaluating", assignedConsultantId: cId });
      wonCaseId = await createTestFinanceApp({ factoryId: factoryAId, status: "won", assignedConsultantId: cId, companyName: `${PREFIX} 已結案` });
      const beforeUpdatedAt = (await db.getFinanceApplicationById(wonCaseId))?.updatedAt;

      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      await admin.financeConsultant.adminSetActive({ consultantId: cId, isActive: false });

      const newCase = await db.getFinanceApplicationById(newCaseId);
      const evalCase = await db.getFinanceApplicationById(evalCaseId);
      const wonCase = await db.getFinanceApplicationById(wonCaseId);

      expect(newCase?.assignedConsultantId).toBeNull();
      expect(evalCase?.assignedConsultantId).toBeNull();
      // 最後更新者／時間必須同步更新
      expect(newCase?.lastUpdatedByUserId).toBe(adminNotifyUserId);
      expect(evalCase?.lastUpdatedByUserId).toBe(adminNotifyUserId);

      // 結案案件不受影響：仍指向原顧問，最後更新時間也沒有被動過
      expect(wonCase?.assignedConsultantId).toBe(cId);
      expect(wonCase?.updatedAt?.getTime()).toBe(beforeUpdatedAt?.getTime());

      // 通知管理員有案件需要重新指派
      const notifCount = await waitForNotification(`finance_cascade_deactivate:${cId}:`, 2000);
      expect(notifCount).toBeGreaterThan(0);
    } finally {
      if (typeof newCaseId === "number") await deleteFinanceApp(newCaseId);
      if (typeof evalCaseId === "number") await deleteFinanceApp(evalCaseId);
      if (typeof wonCaseId === "number") await deleteFinanceApp(wonCaseId);
      if (typeof cId === "number") await deleteFinanceConsultant(cId);
      if (typeof cUserId === "number") await deleteTestUser(cUserId);
    }
  });

  it("解除綁定使用者：名下未結案案件同樣安全改為未指派，並通知管理員", async () => {
    let cUserId: number | undefined;
    let cId: number | undefined;
    let deferredCaseId: number | undefined;
    try {
      cUserId = await ensureTestUser(`test-fin-cascade-unbind-${runId}`, "財務測試-級聯解綁顧問帳號");
      cId = await db.adminCreateFinanceConsultant("財務測試-級聯解綁顧問");
      await db.adminBindFinanceConsultantUser(cId, cUserId);

      deferredCaseId = await createTestFinanceApp({ factoryId: factoryAId, status: "deferred", assignedConsultantId: cId });
      const admin = appRouter.createCaller(adminCtx(adminNotifyUserId));
      await admin.financeConsultant.adminBindUser({ consultantId: cId, userId: null });

      const deferredCase = await db.getFinanceApplicationById(deferredCaseId);
      expect(deferredCase?.assignedConsultantId).toBeNull();
      expect(deferredCase?.lastUpdatedByUserId).toBe(adminNotifyUserId);

      const notifCount = await waitForNotification(`finance_cascade_unbind:${cId}:`, 2000);
      expect(notifCount).toBeGreaterThan(0);
    } finally {
      if (typeof deferredCaseId === "number") await deleteFinanceApp(deferredCaseId);
      if (typeof cId === "number") await deleteFinanceConsultant(cId);
      if (typeof cUserId === "number") await deleteTestUser(cUserId);
    }
  });

  it("停用未帶有任何未結案案件的顧問：不會產生多餘的級聯通知（reassignedCases 為空陣列）", async () => {
    const idleId = await db.adminCreateFinanceConsultant("財務測試-無案件顧問");
    try {
      const result = await db.adminSetFinanceConsultantActive(idleId, false);
      expect(result.reassignedCases).toEqual([]);
    } finally {
      await db.adminSetFinanceConsultantActive(idleId, true);
      await deleteFinanceConsultant(idleId);
    }
  });
});

// ── 17. 前端契約：顧問中心分流頁與財務看板 ────────────────────────────────
//
// 【本輪（第五輪）驗收後說明】以下這個區塊全部都是「僅靜態原始碼契約檢查」
// （readFileSync + 字串／regex 比對），只證明「原始碼裡還有這些字樣／連結」，
// 不是任何實際渲染、權限判斷、分頁或行動版排版行為的證明——第四輪驗收明確
// 指出這類檢查曾被誤當成行為測試的證據使用，這輪已經把真正需要行為證明的
// 部分抽成純函式並移到別處驗證：
//   - 承辦顧問指派選單的篩選邏輯 → selectAssignableConsultants，見
//     server/financeConsultantCasesViewState.test.ts
//   - 多工廠狀態判斷（anyFactoryStatus）→ resolveAnyFactoryStatus，見
//     server/financeOptimizationApplyStatus.test.ts
//   - 載入更多分頁（replace-not-append／去重／穩定排序）→ 已完全移除這裡
//     原本用 readFileSync 檢查 hasMore／載入更多字樣的假測試，改用真正的
//     reducer 行為測試，見 server/financeCasesPagination.test.ts
//   - 手機版標題與返回鈕不重疊、無橫向溢出 → 已完全移除這裡原本檢查
//     mt-14/pt-14 class 字串的假測試，改用瀏覽器真實 DOM 量測驗證（見本輪
//     報告的瀏覽器複驗章節，而非自動化 vitest 測試檔案）。
// 保留在下面的幾個 it() 純粹是「連結／文字是否還在原始碼裡」這種低風險、
// 內容型的靜態契約檢查，不代表任何行為已被驗證通過。
describe("client/src/pages/ConsultantHub.tsx: 顧問中心第一層分流（僅靜態原始碼契約，非行為證明）", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "client", "src", "pages", "ConsultantHub.tsx"),
    "utf-8"
  );
  it("包含企業補助顧問與財務優化顧問兩個入口，分別連到既有／新的案件看板路由", () => {
    expect(source).toMatch(/企業補助顧問/);
    expect(source).toMatch(/財務優化顧問/);
    expect(source).toMatch(/\/upgrade-consultant\/cases/);
    expect(source).toMatch(/\/finance-consultant\/cases/);
  });
});

describe("client/src/pages/FinanceConsultantCases.tsx: 五個看板文字內容（僅靜態原始碼契約，非行為證明）", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "client", "src", "pages", "FinanceConsultantCases.tsx"),
    "utf-8"
  );
  it("TAB_ORDER 依序為 新案件／評估中／緩追區／無意願／成交區", () => {
    const match = source.match(/const TAB_ORDER[\s\S]*?\];/);
    expect(match, "找不到 TAB_ORDER").not.toBeNull();
    const block = match![0];
    const idx = (k: string) => block.indexOf(`key: "${k}"`);
    expect(idx("new")).toBeGreaterThan(-1);
    expect(idx("evaluating")).toBeGreaterThan(idx("new"));
    expect(idx("deferred")).toBeGreaterThan(idx("evaluating"));
    expect(idx("not_interested")).toBeGreaterThan(idx("deferred"));
    expect(idx("won")).toBeGreaterThan(idx("not_interested"));
  });

  it("不顯示統一編號或下次追蹤日期欄位", () => {
    expect(source).not.toMatch(/統一編號|下次追蹤日期/);
  });

  it("案件卡片顯示公司名稱、地址、聯絡人、電話、方便聯絡時間、送出時間、承辦顧問、最後更新者", () => {
    expect(source).toMatch(/companyNameSnapshot/);
    expect(source).toMatch(/companyAddressSnapshot/);
    expect(source).toMatch(/contactName/);
    expect(source).toMatch(/contactTime/);
    expect(source).toMatch(/assignedConsultantUserName/);
    expect(source).toMatch(/lastUpdatedByNameSnapshot/);
  });

  it("深層網址返回 fallback 依 /admin 路徑分流，不落到網站首頁 \"/\"", () => {
    expect(source).toMatch(/isAdminRoute\s*=\s*location\.startsWith\(["']\/admin["']\)/);
    expect(source).not.toMatch(/FloatingBackButton\s+fallbackHref="\/"/);
  });

  it("元件確實引用 resolveFinanceCasesViewState 決定畫面狀態分支（真實判斷邏輯的行為測試見 server/financeConsultantCasesViewState.test.ts）", () => {
    expect(source).toMatch(/import \{ resolveFinanceCasesViewState, selectAssignableConsultants \} from ".\/financeConsultantCasesViewState"/);
    expect(source).toMatch(/viewState === "login-required"/);
    expect(source).toMatch(/viewState === "no-permission"/);
  });
});

describe("client/src/components/Navbar.tsx: 企業財務優化入口暫不公開曝光（僅靜態原始碼契約，非行為證明）", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "client", "src", "components", "Navbar.tsx"),
    "utf-8"
  );
  // 上線前決定暫不公開曝光此入口：桌面下拉選單／手機 Accordion 共用的
  // dropdownItems 資料來源不應該再含有這個連結，避免日後不小心又加回去。
  // route 本身（/finance-optimization、/finance-optimization/apply）與既有
  // 登入／工廠資格權限限制不受影響，管理員後台與顧問中心的入口也不受影響。
  it("找資源下拉選單不包含企業財務優化的公開連結", () => {
    expect(source).not.toMatch(/企業財務優化/);
    expect(source).not.toMatch(/\/finance-optimization/);
  });
  it("顧問中心入口在兩種顧問身分皆有效或為管理員時導向 /consultant-center", () => {
    expect(source).toMatch(/consultantCenterHref/);
    expect(source).toMatch(/\/consultant-center/);
  });
});
