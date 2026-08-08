/**
 * ISO 與低碳認證專區 — 整合測試。走真實本機測試資料庫（受
 * server/test-db-guard.ts 全域 setupFiles 保護，不可能連到正式/遠端資料庫），
 * 用 appRouter.createCaller(ctx) 直接呼叫 tRPC procedure。
 *
 * 本專區完全不呼叫任何 Email 寄送函式（沒有 sendXxxEmail），因此天生不會
 * 寄出真實 Email；站內通知走既有 createPlatformNotifications（真實寫入
 * communityNotifications 表，這是預期行為、不是需要 mock 的外部副作用）；
 * 本檔案沒有任何呼叫路徑會帶 push 參數給 notifyUser／notifyAdmins，因此也
 * 不會觸發真實 Push。
 *
 * 涵蓋：
 * 1. 未登入無法送出申請。
 * 2. 無權管理該工廠 / 工廠未通過審核 → FORBIDDEN。
 * 3. 公司名稱／地址一律由 server 依 factoryId 讀取工廠資料寫入，不接受前端覆寫。
 * 4. servicesWanted／isUnsure 互斥。
 * 5. servicesWanted 必須是現有已上架（published + serviceEnabled）認證服務
 *    代碼，帶入不存在或已下架的代碼會被拒絕（白名單驗證，非固定列舉）。
 * 6. 同一工廠已有未結案案件時擋下重複申請。
 * 7. 自動指派：serviceAreas 與 servicesWanted 有交集、剛好一位符合的顧問才
 *    自動指派；否則案件建立為 unassigned。
 * 8. 顧問只能看見指派給自己的案件；管理員可看全部。
 * 9. 顧問不能更新未指派給自己的案件；狀態轉移白名單生效。
 * 10. 短影音／財務優化清單不含 ISO 認證案件建立的 factoryId，資料完全獨立。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

// runId／CCM_TEST_ADMIN_EMAIL／ADMIN_WHITELIST_EMAILS 覆寫必須在任何會動態
// 載入 ./routers（遞移載入 server/_core/env.ts，模組頂層就會把
// ADMIN_WHITELIST_EMAILS 讀進快取的 ENV.adminWhitelistEmails 常數）之前完成，
// 否則 adminProcedure（isAdminUser()）永遠不會認得下面 adminCtx() 建立的
// 測試管理員 email，即使之後在 beforeAll 裡再設一次 process.env 也沒用——
// 同樣的手法與說明見 server/financeOptimization.test.ts 開頭。
const runId = `ccm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
const CCM_TEST_ADMIN_EMAIL = `ccm-test-admin-${runId}@example.test`;
process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([CCM_TEST_ADMIN_EMAIL]);

const { appRouter } = await import("./routers");
const db = await import("./db");
const { getDb } = db;
const {
  ensureTestUser, deleteTestUser, createTestFactory,
  waitForNotificationIds, deleteNotificationsByIds, captureNotificationIds,
} = await import("./_core/financeTestFixtures");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function userCtx(id: number, name: string, isAdmin = false): TrpcContext {
  const user: AuthenticatedUser = {
    id, openId: `${runId}-${id}`, email: `${runId}-${id}@example.test`,
    name, loginMethod: "manus", role: isAdmin ? "admin" : "user", isFactoryOwner: false,
    isAdmin,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

function adminCtx(id: number): TrpcContext {
  const ctx = userCtx(id, "ISO 測試管理員", true);
  (ctx.user as AuthenticatedUser).email = CCM_TEST_ADMIN_EMAIL;
  return ctx;
}

async function deleteCertificationCase(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM certificationCases WHERE id = ${id}`);
}

async function deleteCertificationConsultant(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM certificationConsultants WHERE id = ${id}`);
}

async function deleteFixtureFactory(factoryId: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM certificationCases WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
}

async function createConsultant(name: string, userId: number | null, serviceAreas: string[]): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO certificationConsultants (name, userId, serviceAreas, isActive, createdAt, updatedAt)
    VALUES (${name}, ${userId}, ${JSON.stringify(serviceAreas)}, TRUE, NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

let ownerAId: number, ownerBId: number, ownerPendingId: number, ownerCId: number, ownerDId: number;
let consultantUserId: number, otherConsultantUserId: number, socialConsultantUserId: number, adminUserId: number;
let factoryAId: number, factoryBId: number, pendingFactoryId: number;
let validCode1: string, validCode2: string, validCode3: string;
const cleanupCaseIds: number[] = [];
const cleanupConsultantIds: number[] = [];
const cleanupOwnerIds: number[] = [];

beforeAll(async () => {
  // 既有已上架認證服務目錄的種子（冪等），確保本檔案不依賴其他測試檔案的
  // 執行順序，也不需要另建一套固定服務清單。
  await db.ensureCertificationServiceCatalogSeeded();
  const catalog = await db.listPublicCertificationServices();
  if (catalog.length < 3) throw new Error("測試前置條件失敗：現有已上架認證服務目錄不足 3 項");
  validCode1 = catalog[0].code;
  validCode2 = catalog[1].code;
  validCode3 = catalog[2].code;

  ownerAId = await ensureTestUser(`${runId}-ownerA`, "ISO 測試申請人A");
  ownerBId = await ensureTestUser(`${runId}-ownerB`, "ISO 測試申請人B");
  ownerPendingId = await ensureTestUser(`${runId}-ownerPending`, "ISO 測試申請人-待審");
  ownerCId = await ensureTestUser(`${runId}-ownerC`, "ISO 測試申請人C");
  ownerDId = await ensureTestUser(`${runId}-ownerD`, "ISO 測試申請人D");
  consultantUserId = await ensureTestUser(`${runId}-consultant`, "ISO 測試顧問甲");
  otherConsultantUserId = await ensureTestUser(`${runId}-consultant2`, "ISO 測試顧問乙");
  socialConsultantUserId = await ensureTestUser(`${runId}-consultant3`, "ISO 測試顧問丙");
  adminUserId = await ensureTestUser(`${runId}-admin`, "ISO 測試管理員", CCM_TEST_ADMIN_EMAIL);
  cleanupOwnerIds.push(ownerAId, ownerBId, ownerPendingId, ownerCId, ownerDId);
  factoryAId = await createTestFactory(ownerAId, `${runId} 工廠A`, "approved");
  factoryBId = await createTestFactory(ownerBId, `${runId} 工廠B`, "approved");
  pendingFactoryId = await createTestFactory(ownerPendingId, `${runId} 工廠待審`, "pending");
});

afterAll(async () => {
  for (const id of cleanupCaseIds) await deleteCertificationCase(id);
  for (const id of cleanupConsultantIds) await deleteCertificationConsultant(id);
  await deleteFixtureFactory(factoryAId);
  await deleteFixtureFactory(factoryBId);
  await deleteFixtureFactory(pendingFactoryId);
  for (const id of cleanupOwnerIds) await deleteTestUser(id);
  await deleteTestUser(consultantUserId);
  await deleteTestUser(otherConsultantUserId);
  await deleteTestUser(socialConsultantUserId);
  await deleteTestUser(adminUserId);
  process.env.ADMIN_WHITELIST_EMAILS = ORIGINAL_ADMIN_WHITELIST_EMAILS;
});

const baseInput = {
  contactName: "測試聯絡人",
  phone: "0912345678",
  contactTime: "平日下午",
  additionalNotes: undefined,
  consentAgreed: true as const,
};

describe("certificationCenter.submitApplication：未登入", () => {
  it("拋出 UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({ user: undefined, req: {} as any, res: {} as any });
    await expect(caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: [], isUnsure: true,
    })).rejects.toThrow();
  });
});

describe("certificationCenter.submitApplication：工廠授權與資格", () => {
  it("非工廠擁有者/共管者送出申請 → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(ownerBId, "測試B"));
    await expect(caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: [], isUnsure: true,
    })).rejects.toThrow(/無法代表此工廠/);
  });

  it("工廠尚未通過審核 → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(ownerPendingId, "測試-待審"));
    await expect(caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: pendingFactoryId, servicesWanted: [], isUnsure: true,
    })).rejects.toThrow(/通過審核/);
  });
});

describe("certificationCenter.submitApplication：servicesWanted／isUnsure 互斥驗證與白名單檢查", () => {
  // 刻意在每個 it() 內才呼叫 userCtx(ownerAId, ...)，不要在 describe() 主體
  // 頂層建立（describe 主體會在 collection 階段就同步執行，早於 beforeAll
  // 賦值 ownerAId，這時候 ownerAId 還是 undefined；如果在頂層建立
  // caller，會把 undefined 永久綁進 context closure，導致之後任何「通過
  // zod 驗證、真正進到 resolver」的測試都會先被工廠授權檢查擋下，得到
  //「無法代表此工廠」而不是真正要驗證的錯誤）。

  it("isUnsure=true 但仍帶 servicesWanted → 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: [validCode1], isUnsure: true,
    })).rejects.toThrow();
  });

  it("isUnsure=false 但 servicesWanted 是空陣列 → 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: [], isUnsure: false,
    })).rejects.toThrow();
  });

  it("servicesWanted 帶入不存在的服務代碼 → 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: ["not-a-real-service-code-xyz"], isUnsure: false,
    })).rejects.toThrow(/不存在或已下架/);
  });
});

describe("certificationCenter.submitApplication：公司資料一律由伺服器帶入，且成功建立案件、寫入站內通知", () => {
  it("案件的 companyNameSnapshot／companyAddressSnapshot 等於工廠實際資料，未指派顧問時狀態為 unassigned，申請人收到站內通知", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    const result = await caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: [validCode1, validCode2], isUnsure: false,
    });
    expect(result.success).toBe(true);
    cleanupCaseIds.push(result.id);

    const factory = await db.getFactoryById(factoryAId);
    const item = await db.getCertificationCaseById(result.id);
    expect(item?.companyNameSnapshot).toBe(factory?.name);
    expect(item?.companyAddressSnapshot).toBe(factory?.address);
    expect(item?.status).toBe("unassigned");
    expect(item?.assignedConsultantId).toBeNull();

    const notifIds = await waitForNotificationIds(ownerAId, 1);
    expect(notifIds.length).toBeGreaterThan(0);
  });

  it("同一工廠已有未結案案件時，重複申請被拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: [], isUnsure: true,
    })).rejects.toThrow(/已有進行中/);
  });
});

describe("自動指派：serviceAreas 交集且剛好一位符合才自動指派", () => {
  it("剛好一位符合 serviceAreas 的啟用中顧問時自動指派，顧問收到站內通知", async () => {
    const consultantId = await createConsultant(`${runId} 顧問-指定服務`, consultantUserId, [validCode1]);
    cleanupConsultantIds.push(consultantId);

    const caller = appRouter.createCaller(userCtx(ownerBId, "測試B"));
    const result = await caller.certificationCenter.submitApplication({
      ...baseInput, factoryId: factoryBId, servicesWanted: [validCode1], isUnsure: false,
    });
    cleanupCaseIds.push(result.id);

    const item = await db.getCertificationCaseById(result.id);
    expect(item?.assignedConsultantId).toBe(consultantId);
    expect(item?.status).toBe("new");

    const notifIds = await waitForNotificationIds(consultantUserId, 1);
    expect(notifIds.length).toBeGreaterThan(0);
    await deleteNotificationsByIds(await captureNotificationIds(consultantUserId));
  });
});

describe("顧問案件看板：只能看見指派給自己的案件", () => {
  let caseAId: number, caseBId: number;
  let tmpFactoryAId: number, tmpFactoryBId: number;
  let consultantAId: number, consultantBId: number;

  beforeAll(async () => {
    // 刻意使用 validCode3／validCode2（不是 validCode1），避免與「自動指派」
    // describe 已建立、仍存活到本檔案 afterAll 才清理的 validCode1 顧問
    // （consultantUserId）重疊，否則同一服務代碼會有兩位候選顧問，自動指派
    // 會判定為「不只一位符合」而回退成 unassigned，導致本區塊的斷言失敗。
    consultantAId = await createConsultant(`${runId} 顧問-甲類`, socialConsultantUserId, [validCode3]);
    consultantBId = await createConsultant(`${runId} 顧問-乙類`, otherConsultantUserId, [validCode2]);
    cleanupConsultantIds.push(consultantAId, consultantBId);

    tmpFactoryAId = await createTestFactory(ownerCId, `${runId} 工廠C`, "approved");
    tmpFactoryBId = await createTestFactory(ownerDId, `${runId} 工廠D`, "approved");

    const callerA = appRouter.createCaller(userCtx(ownerCId, "測試C"));
    const rA = await callerA.certificationCenter.submitApplication({
      ...baseInput, factoryId: tmpFactoryAId, servicesWanted: [validCode3], isUnsure: false,
    });
    caseAId = rA.id;
    cleanupCaseIds.push(caseAId);

    const callerB = appRouter.createCaller(userCtx(ownerDId, "測試D"));
    const rB = await callerB.certificationCenter.submitApplication({
      ...baseInput, factoryId: tmpFactoryBId, servicesWanted: [validCode2], isUnsure: false,
    });
    caseBId = rB.id;
    cleanupCaseIds.push(caseBId);
  });

  afterAll(async () => {
    await deleteFixtureFactory(tmpFactoryAId);
    await deleteFixtureFactory(tmpFactoryBId);
  });

  it("顧問甲只看到自己的案件，看不到指派給顧問乙的案件", async () => {
    const caller = appRouter.createCaller(userCtx(socialConsultantUserId, "顧問甲"));
    const cases = await caller.certificationConsultant.myCases({});
    const ids = cases.map(c => c.id);
    expect(ids).toContain(caseAId);
    expect(ids).not.toContain(caseBId);
  });

  it("顧問乙只看到自己的案件", async () => {
    const caller = appRouter.createCaller(userCtx(otherConsultantUserId, "顧問乙"));
    const cases = await caller.certificationConsultant.myCases({});
    const ids = cases.map(c => c.id);
    expect(ids).toContain(caseBId);
    expect(ids).not.toContain(caseAId);
  });

  it("管理員可看到全部案件", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const cases = await caller.certificationConsultant.myCases({});
    const ids = cases.map(c => c.id);
    expect(ids).toContain(caseAId);
    expect(ids).toContain(caseBId);
  });

  it("顧問乙嘗試更新顧問甲的案件狀態 → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(otherConsultantUserId, "顧問乙"));
    await expect(caller.certificationConsultant.updateCaseStatus({ caseId: caseAId, nextStatus: "needs_interview" })).rejects.toThrow(/不是此案件的承辦顧問/);
  });

  it("狀態轉移白名單：new 不能直接跳到 completed", async () => {
    const caller = appRouter.createCaller(userCtx(socialConsultantUserId, "顧問甲"));
    await expect(caller.certificationConsultant.updateCaseStatus({ caseId: caseAId, nextStatus: "completed" })).rejects.toThrow(/不能推進/);
  });

  it("狀態轉移白名單：new → needs_interview 合法", async () => {
    const caller = appRouter.createCaller(userCtx(socialConsultantUserId, "顧問甲"));
    const result = await caller.certificationConsultant.updateCaseStatus({ caseId: caseAId, nextStatus: "needs_interview" });
    expect(result.success).toBe(true);
    const item = await db.getCertificationCaseById(caseAId);
    expect(item?.status).toBe("needs_interview");
  });

  // 管理員後台新增的三張入口卡片（見 AdminDashboard.tsx）連到既有頁面，
  // 沒有新增或修改任何 router procedure；這裡補測既有 adminAssignConsultant
  // 的權限邊界與基本功能，確認「非管理員仍無法使用管理員才有的案件管理
  // 能力」，且該功能本身確實可用（新入口不是連到一個實際上壞掉的功能）。
  it("非管理員（一般申請人）呼叫 adminAssignConsultant → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(ownerCId, "測試C"));
    await expect(caller.certificationConsultant.adminAssignConsultant({
      caseId: caseBId, consultantId: consultantAId,
    })).rejects.toThrow(/10002/);
  });

  it("非管理員（其他顧問）呼叫 adminAssignConsultant → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(socialConsultantUserId, "顧問甲"));
    await expect(caller.certificationConsultant.adminAssignConsultant({
      caseId: caseBId, consultantId: consultantAId,
    })).rejects.toThrow(/10002/);
  });

  it("管理員呼叫 adminAssignConsultant 可將案件手動重新指派給另一位顧問", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const result = await caller.certificationConsultant.adminAssignConsultant({
      caseId: caseBId, consultantId: consultantAId,
    });
    expect(result.success).toBe(true);
    const item = await db.getCertificationCaseById(caseBId);
    expect(item?.assignedConsultantId).toBe(consultantAId);

    // 復原成原本的顧問乙，避免影響本 describe 其他測試對 caseBId 的既有假設。
    await caller.certificationConsultant.adminAssignConsultant({
      caseId: caseBId, consultantId: consultantBId,
    });
  });
});

describe("ISO 認證案件不會混入短影音／財務優化清單，資料完全獨立", () => {
  it("financeConsultant.myCases（管理員）不含 ISO 案件建立的任何 factoryId 記錄", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const financeCases = await caller.financeConsultant.myCases({});
    const financeFactoryIds = financeCases.items.map(c => c.factoryId);
    expect(financeFactoryIds).not.toContain(factoryAId);
    expect(financeFactoryIds).not.toContain(factoryBId);
  });
});

describe("ISO 認證專區完全不呼叫任何 Email 寄送函式（靜態原始碼檢查）", () => {
  it("server/routers.ts 的 certificationCenter／certificationConsultant 區塊沒有任何 sendXxxEmail 呼叫", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf-8");
    const startIdx = source.indexOf("certificationCenter: router({");
    const endMarker = "// ===== ERP 與產線優化專區 =====";
    const endIdx = source.indexOf(endMarker, startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = source.slice(startIdx, endIdx);
    expect(block).not.toMatch(/send\w*Email/);
  });
});
