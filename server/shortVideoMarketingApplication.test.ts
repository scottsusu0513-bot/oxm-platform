/**
 * 短影音與品牌內容行銷專區 — 整合測試。走真實本機測試資料庫（受
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
 * 3. 公司名稱／地址一律由 server 依 factoryId 讀取工廠資料寫入，不接受前端
 *    覆寫（schema 本身不接受 companyName／companyAddress 欄位）。
 * 4. servicesWanted／isUnsure 互斥；platforms／noPlatformYet 互斥。
 * 5. 同一工廠已有未結案案件時擋下重複申請。
 * 6. 自動指派：serviceAreas 與 servicesWanted 有交集、剛好一位符合的顧問才
 *    自動指派；否則案件建立為 unassigned。
 * 7. 顧問只能看見指派給自己的案件，看不到指派給其他顧問的案件；管理員可看全部。
 * 8. 顧問不能更新未指派給自己的案件。
 * 9. 狀態轉移白名單：不允許的狀態跳轉會被拒絕。
 * 10. 申請人收到站內通知；指派成功時顧問也收到站內通知（真實寫入，非 mock）。
 * 11. 短影音案件不會出現在其他服務（財務優化）的清單中，資料完全獨立。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

// Shared Cleanup（見對話「Vitest ADMIN_WHITELIST_EMAILS env race」）：
// server/_core/env.ts 的 ENV.adminWhitelistEmails 現在是 getter（每次存取才
// 重新讀 process.env），不再是模組載入當下算一次就凍結的值——下面的覆寫
// 因此不需要再搶在任何動態 import 完成之前，改到 beforeAll 才真正寫入
// process.env（模組頂層程式碼是 Vitest collect 階段執行，多檔案的 collect
// 階段可能交錯，留在頂層會讓多個測試檔互相搶著改同一個全域
// process.env）。
const runId = `svm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
const SVM_TEST_ADMIN_EMAIL = `svm-test-admin-${runId}@example.test`;

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
  const ctx = userCtx(id, "短影音測試管理員", true);
  (ctx.user as AuthenticatedUser).email = SVM_TEST_ADMIN_EMAIL;
  return ctx;
}

async function deleteShortVideoCase(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM shortVideoCases WHERE id = ${id}`);
}

async function deleteShortVideoConsultant(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM shortVideoConsultants WHERE id = ${id}`);
}

async function deleteFixtureFactory(factoryId: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM shortVideoCases WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
}

async function createConsultant(name: string, userId: number | null, serviceAreas: string[]): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO shortVideoConsultants (name, userId, serviceAreas, isActive, createdAt, updatedAt)
    VALUES (${name}, ${userId}, ${JSON.stringify(serviceAreas)}, TRUE, NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

// factories.ownerId 有 UNIQUE 約束（uq_factory_owner_id）：一個使用者最多只能
// 擁有一間工廠，因此每一間測試工廠都必須用各自獨立的 owner 使用者，不能讓
// 同一個 owner 建立第二間工廠。
let ownerAId: number, ownerBId: number, ownerPendingId: number, ownerCId: number, ownerDId: number;
let consultantUserId: number, otherConsultantUserId: number, socialConsultantUserId: number, adminUserId: number;
let factoryAId: number, factoryBId: number, pendingFactoryId: number;
const cleanupCaseIds: number[] = [];
const cleanupConsultantIds: number[] = [];
const cleanupOwnerIds: number[] = [];

beforeAll(async () => {
  process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([SVM_TEST_ADMIN_EMAIL]);
  ownerAId = await ensureTestUser(`${runId}-ownerA`, "短影音測試申請人A");
  ownerBId = await ensureTestUser(`${runId}-ownerB`, "短影音測試申請人B");
  ownerPendingId = await ensureTestUser(`${runId}-ownerPending`, "短影音測試申請人-待審");
  ownerCId = await ensureTestUser(`${runId}-ownerC`, "短影音測試申請人C");
  ownerDId = await ensureTestUser(`${runId}-ownerD`, "短影音測試申請人D");
  consultantUserId = await ensureTestUser(`${runId}-consultant`, "短影音測試顧問甲");
  otherConsultantUserId = await ensureTestUser(`${runId}-consultant2`, "短影音測試顧問乙");
  socialConsultantUserId = await ensureTestUser(`${runId}-consultant3`, "短影音測試顧問丙");
  adminUserId = await ensureTestUser(`${runId}-admin`, "短影音測試管理員", SVM_TEST_ADMIN_EMAIL);
  cleanupOwnerIds.push(ownerAId, ownerBId, ownerPendingId, ownerCId, ownerDId);
  factoryAId = await createTestFactory(ownerAId, `${runId} 工廠A`, "approved");
  factoryBId = await createTestFactory(ownerBId, `${runId} 工廠B`, "approved");
  pendingFactoryId = await createTestFactory(ownerPendingId, `${runId} 工廠待審`, "pending");
});

afterAll(async () => {
  for (const id of cleanupCaseIds) await deleteShortVideoCase(id);
  for (const id of cleanupConsultantIds) await deleteShortVideoConsultant(id);
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
  primaryGoal: "quick_intro" as const,
  additionalNotes: undefined,
  consentAgreed: true as const,
};

describe("shortVideoCenter.submitApplication：未登入", () => {
  it("拋出 UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({ user: undefined, req: {} as any, res: {} as any });
    await expect(caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: ["shooting"], isUnsure: false, platforms: [], noPlatformYet: true,
    })).rejects.toThrow();
  });
});

describe("shortVideoCenter.submitApplication：工廠授權與資格", () => {
  it("非工廠擁有者/共管者送出申請 → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(ownerBId, "測試B"));
    await expect(caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: ["shooting"], isUnsure: false, platforms: [], noPlatformYet: true,
    })).rejects.toThrow(/無法代表此工廠/);
  });

  it("工廠尚未通過審核 → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(ownerPendingId, "測試-待審"));
    await expect(caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: pendingFactoryId, servicesWanted: ["shooting"], isUnsure: false, platforms: [], noPlatformYet: true,
    })).rejects.toThrow(/通過審核/);
  });
});

describe("shortVideoCenter.submitApplication：servicesWanted／isUnsure、platforms／noPlatformYet 互斥驗證", () => {
  // 刻意在每個 it() 內才呼叫 userCtx(ownerAId, ...)，不要在 describe() 主體
  // 頂層建立（describe 主體在 collection 階段就同步執行，早於 beforeAll
  // 賦值 ownerAId，這時候 ownerAId 還是 undefined；如果在頂層建立 caller，
  // 會把 undefined 永久綁進 context closure——本區塊目前 4 個測試都會先被
  // zod .refine() 擋下、不會真的進到 resolver，因此舊寫法暫時沒有暴露這個
  // 問題，但仍是潛在正確性風險，見 server/certificationCenterApplication.test.ts
  // 同名區塊實際踩到的相同 bug）。

  it("isUnsure=true 但仍帶 servicesWanted → 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: ["shooting"], isUnsure: true, platforms: [], noPlatformYet: true,
    })).rejects.toThrow();
  });

  it("isUnsure=false 但 servicesWanted 是空陣列 → 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: [], isUnsure: false, platforms: [], noPlatformYet: true,
    })).rejects.toThrow();
  });

  it("noPlatformYet=true 但仍帶 platforms → 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: ["shooting"], isUnsure: false, platforms: ["instagram"], noPlatformYet: true,
    })).rejects.toThrow();
  });

  it("noPlatformYet=false 但 platforms 是空陣列 → 拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: ["shooting"], isUnsure: false, platforms: [], noPlatformYet: false,
    })).rejects.toThrow();
  });
});

describe("shortVideoCenter.submitApplication：公司資料一律由伺服器帶入，且成功建立案件、寫入站內通知", () => {
  it("案件的 companyNameSnapshot／companyAddressSnapshot 等於工廠實際資料，未指派顧問時狀態為 unassigned，申請人收到站內通知", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    const result = await caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: ["shooting", "interview"], isUnsure: false, platforms: ["instagram"], noPlatformYet: false,
    });
    expect(result.success).toBe(true);
    cleanupCaseIds.push(result.id);

    const factory = await db.getFactoryById(factoryAId);
    const item = await db.getShortVideoCaseById(result.id);
    expect(item?.companyNameSnapshot).toBe(factory?.name);
    expect(item?.companyAddressSnapshot).toBe(factory?.address);
    // 目前尚未建立任何顧問 fixture，自動指派候選人為 0 位 → unassigned。
    expect(item?.status).toBe("unassigned");
    expect(item?.assignedConsultantId).toBeNull();

    const notifIds = await waitForNotificationIds(ownerAId, 1);
    expect(notifIds.length).toBeGreaterThan(0);
  });

  it("同一工廠已有未結案案件時，重複申請被拒絕", async () => {
    const caller = appRouter.createCaller(userCtx(ownerAId, "測試A"));
    await expect(caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryAId, servicesWanted: ["kol"], isUnsure: false, platforms: [], noPlatformYet: true,
    })).rejects.toThrow(/已有進行中/);
  });
});

describe("自動指派：serviceAreas 交集且剛好一位符合才自動指派", () => {
  it("剛好一位符合 serviceAreas 的啟用中顧問時自動指派，顧問收到站內通知", async () => {
    const consultantId = await createConsultant(`${runId} 顧問-拍攝`, consultantUserId, ["shooting"]);
    cleanupConsultantIds.push(consultantId);

    const caller = appRouter.createCaller(userCtx(ownerBId, "測試B"));
    const result = await caller.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: factoryBId, servicesWanted: ["shooting"], isUnsure: false, platforms: [], noPlatformYet: true,
    });
    cleanupCaseIds.push(result.id);

    const item = await db.getShortVideoCaseById(result.id);
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
    consultantAId = await createConsultant(`${runId} 顧問-社群`, socialConsultantUserId, ["social"]);
    consultantBId = await createConsultant(`${runId} 顧問-媒體`, otherConsultantUserId, ["media"]);
    cleanupConsultantIds.push(consultantAId, consultantBId);

    // 用這個 describe 專屬的新 owner／工廠（ownerC／ownerD），避免與前一個
    // describe 已建立的工廠（ownerA 已擁有 factoryA、ownerB 已擁有
    // factoryB——factories.ownerId 是 UNIQUE，同一 owner 不能再建第二間工廠）衝突。
    tmpFactoryAId = await createTestFactory(ownerCId, `${runId} 工廠C-社群`, "approved");
    tmpFactoryBId = await createTestFactory(ownerDId, `${runId} 工廠D-媒體`, "approved");

    const callerA = appRouter.createCaller(userCtx(ownerCId, "測試C"));
    const rA = await callerA.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: tmpFactoryAId, servicesWanted: ["social"], isUnsure: false, platforms: [], noPlatformYet: true,
    });
    caseAId = rA.id;
    cleanupCaseIds.push(caseAId);

    const callerB = appRouter.createCaller(userCtx(ownerDId, "測試D"));
    const rB = await callerB.shortVideoCenter.submitApplication({
      ...baseInput, factoryId: tmpFactoryBId, servicesWanted: ["media"], isUnsure: false, platforms: [], noPlatformYet: true,
    });
    caseBId = rB.id;
    cleanupCaseIds.push(caseBId);
  });

  afterAll(async () => {
    await deleteFixtureFactory(tmpFactoryAId);
    await deleteFixtureFactory(tmpFactoryBId);
  });

  it("顧問甲（社群）只看到自己的案件，看不到指派給顧問乙的案件", async () => {
    const caller = appRouter.createCaller(userCtx(socialConsultantUserId, "顧問甲"));
    const cases = await caller.shortVideoConsultant.myCases({});
    const ids = cases.map(c => c.id);
    expect(ids).toContain(caseAId);
    expect(ids).not.toContain(caseBId);
  });

  it("顧問乙（媒體）只看到自己的案件", async () => {
    const caller = appRouter.createCaller(userCtx(otherConsultantUserId, "顧問乙"));
    const cases = await caller.shortVideoConsultant.myCases({});
    const ids = cases.map(c => c.id);
    expect(ids).toContain(caseBId);
    expect(ids).not.toContain(caseAId);
  });

  it("管理員可看到全部案件", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const cases = await caller.shortVideoConsultant.myCases({});
    const ids = cases.map(c => c.id);
    expect(ids).toContain(caseAId);
    expect(ids).toContain(caseBId);
  });

  it("顧問乙嘗試更新顧問甲的案件狀態 → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(otherConsultantUserId, "顧問乙"));
    await expect(caller.shortVideoConsultant.updateCaseStatus({ caseId: caseAId, nextStatus: "needs_interview" })).rejects.toThrow(/不是此案件的承辦顧問/);
  });

  it("狀態轉移白名單：new 不能直接跳到 completed", async () => {
    const caller = appRouter.createCaller(userCtx(socialConsultantUserId, "顧問甲"));
    await expect(caller.shortVideoConsultant.updateCaseStatus({ caseId: caseAId, nextStatus: "completed" })).rejects.toThrow(/不能推進/);
  });

  it("狀態轉移白名單：new → needs_interview 合法", async () => {
    const caller = appRouter.createCaller(userCtx(socialConsultantUserId, "顧問甲"));
    const result = await caller.shortVideoConsultant.updateCaseStatus({ caseId: caseAId, nextStatus: "needs_interview" });
    expect(result.success).toBe(true);
    const item = await db.getShortVideoCaseById(caseAId);
    expect(item?.status).toBe("needs_interview");
  });

  // 管理員後台新增的三張入口卡片（見 AdminDashboard.tsx）連到既有頁面，
  // 沒有新增或修改任何 router procedure；這裡補測既有 adminAssignConsultant
  // 的權限邊界與基本功能。
  it("非管理員（一般申請人）呼叫 adminAssignConsultant → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(ownerCId, "測試C"));
    await expect(caller.shortVideoConsultant.adminAssignConsultant({
      caseId: caseBId, consultantId: consultantAId,
    })).rejects.toThrow(/10002/);
  });

  it("非管理員（其他顧問）呼叫 adminAssignConsultant → FORBIDDEN", async () => {
    const caller = appRouter.createCaller(userCtx(socialConsultantUserId, "顧問甲"));
    await expect(caller.shortVideoConsultant.adminAssignConsultant({
      caseId: caseBId, consultantId: consultantAId,
    })).rejects.toThrow(/10002/);
  });

  it("管理員呼叫 adminAssignConsultant 可將案件手動重新指派給另一位顧問", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const result = await caller.shortVideoConsultant.adminAssignConsultant({
      caseId: caseBId, consultantId: consultantAId,
    });
    expect(result.success).toBe(true);
    const item = await db.getShortVideoCaseById(caseBId);
    expect(item?.assignedConsultantId).toBe(consultantAId);

    await caller.shortVideoConsultant.adminAssignConsultant({
      caseId: caseBId, consultantId: consultantBId,
    });
  });
});

describe("短影音案件不會混入財務優化清單，資料完全獨立", () => {
  it("financeConsultant.myCases（管理員）不含短影音案件建立的任何 factoryId 記錄", async () => {
    const caller = appRouter.createCaller(adminCtx(adminUserId));
    const financeCases = await caller.financeConsultant.myCases({});
    const financeFactoryIds = financeCases.items.map(c => c.factoryId);
    expect(financeFactoryIds).not.toContain(factoryAId);
    expect(financeFactoryIds).not.toContain(factoryBId);
  });
});

describe("短影音專區完全不呼叫任何 Email 寄送函式（靜態原始碼檢查）", () => {
  it("server/routers.ts 的 shortVideoCenter／shortVideoConsultant 區塊沒有任何 sendXxxEmail 呼叫", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "routers.ts"), "utf-8");
    const startIdx = source.indexOf("shortVideoCenter: router({");
    const endMarker = "// ===== ISO 與低碳認證專區：公開查詢 =====";
    const endIdx = source.indexOf(endMarker, startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = source.slice(startIdx, endIdx);
    expect(block).not.toMatch(/send\w*Email/);
  });
});
