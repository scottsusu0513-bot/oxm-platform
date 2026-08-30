/**
 * 顧問自助取件（取件／unassignedCases／adminForceStatus）— 整合測試。
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 全域 setupFiles 保護，
 * 不可能連到正式/遠端資料庫），用 appRouter.createCaller(ctx) 直接呼叫
 * tRPC procedure。涵蓋 ISO／ERP／短影音三個服務，三者結構對稱、各自完全
 * 獨立（各自的表、各自的顧問、各自的案件），因此同一份測試邏輯對三個
 * service 各跑一次，而不是共用同一批資料。
 *
 * 涵蓋：
 * 1. 沒有啟用中顧問身份 → claimCase／unassignedCases 皆 FORBIDDEN。
 * 2. 有啟用中顧問身份、案件為 unassigned → 取件成功：assignedConsultantId、
 *    status（'unassigned'→'new'）、claimedAt、statusHistory（action:'claim'）
 *    皆正確寫入，且案件從 unassignedCases 消失。
 * 3. 已被取走（或已指派）的案件再次取件 → CONFLICT。
 * 4. 兩位顧問對同一筆案件同時取件（Promise.all 真正併發）→ 只有一位成功，
 *    另一位收到 CONFLICT，且最終案件只歸屬一位顧問（不會兩邊都成功）。
 * 5. 管理員可在取件後重新指派（adminAssignConsultant）給另一位顧問，或改回
 *    未指派（consultantId: null）。
 * 6. 例外狀態（deferred/no_interest/not_applicable/archived）沒有 reason
 *    → BAD_REQUEST；有 reason → 成功，statusReason 與 statusHistory 皆記錄
 *    原因。
 * 7. adminForceStatus 略過轉移白名單直接跳到任意狀態，但仍要求 reason，
 *    statusHistory 記錄 forced:true。
 * 8. 三個服務的案件互相隔離：certification 顧問看不到 erp／短影音的待取件
 *    案件，反之亦然。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const runId = `ccc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
const CCC_TEST_ADMIN_EMAIL = `ccc-test-admin-${runId}@example.test`;
// Shared Cleanup（見對話「Vitest ADMIN_WHITELIST_EMAILS env race」）：覆寫搬到
// beforeAll，理由同 certificationCaseFallback.test.ts 開頭註解。
const { appRouter } = await import("./routers");
const db = await import("./db");
const { getDb } = db;
const { ensureTestUser, deleteTestUser, createTestFactory, deleteTestFactory } = await import("./_core/financeTestFixtures");

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
  const ctx = userCtx(id, "取件測試管理員", true);
  (ctx.user as AuthenticatedUser).email = CCC_TEST_ADMIN_EMAIL;
  return ctx;
}

async function createConsultant(table: "certificationConsultants" | "erpConsultants" | "shortVideoConsultants", name: string, userId: number | null): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  // 每個 it() 可能重複綁定 consultantAUserId／consultantBUserId 到同一張表，
  // userId 有 unique index（見 cc_user_id_uq／ec_user_id_uq／svc_user_id_uq），
  // 先清掉舊資料列，讓每個測試案例都能獨立、可重複執行，不必依賴測試順序。
  if (userId != null) {
    await conn.execute(sql`DELETE FROM ${sql.raw(table)} WHERE userId = ${userId}`);
  }
  // serviceAreas 刻意不用空陣列：空陣列在 matchesXConsultant（見 server/db.ts
  // createXCaseWithAutoAssign）代表「承接全部服務」，若用空陣列，這裡建立的
  // 顧問在整份測試套件平行執行期間會被其他測試檔案（例如
  // shortVideoMarketingApplication.test.ts 的自動指派『剛好一位符合』測試）
  // 一併算進候選人數，破壞它們對候選人數量的假設。這裡的測試只驗證取件／
  // 狀態流程，不依賴自動指派比對，改用一個不會匹配任何真實服務代碼的
  // sentinel 值，確保不會洩漏到其他檔案的自動指派候選人集合。
  const sentinelServiceAreas = JSON.stringify(["__consultant_case_claim_test_sentinel__"]);
  const [result] = await conn.execute(sql`
    INSERT INTO ${sql.raw(table)} (name, userId, serviceAreas, isActive, createdAt, updatedAt)
    VALUES (${name}, ${userId}, ${sentinelServiceAreas}, TRUE, NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

async function createCertificationCase(factoryId: number): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO certificationCases
      (factoryId, companyNameSnapshot, companyAddressSnapshot, contactName, phone, contactTime,
       servicesWanted, isUnsure, consentAgreed, status, assignedConsultantId, lastUpdatedByNameSnapshot, createdAt, updatedAt)
    VALUES (${factoryId}, "取件測試公司", "取件測試地址", "測試聯絡人", "0912345678", "平日下午",
       ${"[]"}, TRUE, TRUE, "unassigned", NULL, "", NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

async function createErpCase(factoryId: number): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO erpCases
      (factoryId, companyNameSnapshot, companyAddressSnapshot, contactName, phone, contactTime,
       needType, consentAgreed, status, assignedConsultantId, lastUpdatedByNameSnapshot, createdAt, updatedAt)
    VALUES (${factoryId}, "取件測試公司", "取件測試地址", "測試聯絡人", "0912345678", "平日下午",
       "unsure", TRUE, "unassigned", NULL, "", NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

async function createShortVideoCase(factoryId: number): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO shortVideoCases
      (factoryId, companyNameSnapshot, companyAddressSnapshot, contactName, phone, contactTime,
       servicesWanted, isUnsure, primaryGoal, platforms, noPlatformYet, consentAgreed, status, assignedConsultantId, lastUpdatedByNameSnapshot, createdAt, updatedAt)
    VALUES (${factoryId}, "取件測試公司", "取件測試地址", "測試聯絡人", "0912345678", "平日下午",
       ${"[]"}, TRUE, "unsure", ${"[]"}, TRUE, TRUE, "unassigned", NULL, "", NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

async function deleteRows(table: string, whereSql: ReturnType<typeof sql>): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM ${sql.raw(table)} WHERE ${whereSql}`);
}

let ownerId: number, adminUserId: number;
let consultantAUserId: number, consultantBUserId: number, noProfileUserId: number;
let factoryId: number;
const cleanupCertConsultantIds: number[] = [];
const cleanupErpConsultantIds: number[] = [];
const cleanupVideoConsultantIds: number[] = [];
const extraFactoryIds: number[] = [];
const extraOwnerIds: number[] = [];
let factoryCounter = 0;

// 三張案件表的 openFactoryId 是「未結案狀態下等於 factoryId」的產生欄位＋唯一
// 索引（見 drizzle/schema.ts 註解），代表「同一工廠最多一筆未結案案件」是
// 資料庫層級的業務規則，不是本測試該繞過的限制——因此每筆測試案件改用各自
// 獨立的 factory，而不是共用同一個 factoryId 重複建立多筆 unassigned 案件。
// factories 另外對 ownerId 有 uq_factory_owner_id（一個使用者最多一間工廠），
// 所以每個新 factory 也要配一個新的 owner，不能沿用同一個 ownerId。
async function createCaseFactory(): Promise<number> {
  factoryCounter += 1;
  const thisOwnerId = await ensureTestUser(`${runId}-caseOwner${factoryCounter}`, `取件測試申請人${factoryCounter}`);
  extraOwnerIds.push(thisOwnerId);
  const id = await createTestFactory(thisOwnerId, `${runId} 工廠${factoryCounter}`, "approved");
  extraFactoryIds.push(id);
  return id;
}

beforeAll(async () => {
  process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([CCC_TEST_ADMIN_EMAIL]);
  ownerId = await ensureTestUser(`${runId}-owner`, "取件測試申請人");
  adminUserId = await ensureTestUser(`${runId}-admin`, "取件測試管理員", CCC_TEST_ADMIN_EMAIL);
  consultantAUserId = await ensureTestUser(`${runId}-consultantA`, "取件測試顧問甲");
  consultantBUserId = await ensureTestUser(`${runId}-consultantB`, "取件測試顧問乙");
  noProfileUserId = await ensureTestUser(`${runId}-noprofile`, "取件測試無權限使用者");
  factoryId = await createTestFactory(ownerId, `${runId} 工廠`, "approved");
});

afterAll(async () => {
  await deleteRows("certificationCases", sql`factoryId = ${factoryId}`);
  await deleteRows("erpCases", sql`factoryId = ${factoryId}`);
  await deleteRows("shortVideoCases", sql`factoryId = ${factoryId}`);
  for (const id of cleanupCertConsultantIds) await deleteRows("certificationConsultants", sql`id = ${id}`);
  for (const id of cleanupErpConsultantIds) await deleteRows("erpConsultants", sql`id = ${id}`);
  for (const id of cleanupVideoConsultantIds) await deleteRows("shortVideoConsultants", sql`id = ${id}`);
  await deleteTestFactory(factoryId);
  // factories.id 對三張案件表都是 ON DELETE CASCADE（見 drizzle/schema.ts），
  // 刪除 factory 會自動一併清掉其名下的案件，不需要另外逐筆刪 case。
  for (const id of extraFactoryIds) await deleteTestFactory(id);
  for (const id of extraOwnerIds) await deleteTestUser(id);
  await deleteTestUser(ownerId);
  await deleteTestUser(adminUserId);
  await deleteTestUser(consultantAUserId);
  await deleteTestUser(consultantBUserId);
  await deleteTestUser(noProfileUserId);
  process.env.ADMIN_WHITELIST_EMAILS = ORIGINAL_ADMIN_WHITELIST_EMAILS;
});

type ServiceFixture = {
  name: string;
  routerKey: "certificationConsultant" | "erpConsultant" | "shortVideoConsultant";
  table: "certificationConsultants" | "erpConsultants" | "shortVideoConsultants";
  createCase: (factoryId: number) => Promise<number>;
  getCaseById: (id: number) => Promise<any>;
  cleanupConsultantIds: number[];
  // 從 'new'（取件後的初始狀態）依合法轉移規則一路推進到 'completed' 的完整
  // 路徑，逐一驗證每一步都被允許、且不能跳過中間必要階段。
  fullPathFromNew: string[];
};

const services: ServiceFixture[] = [
  {
    name: "certification",
    routerKey: "certificationConsultant",
    table: "certificationConsultants",
    createCase: createCertificationCase,
    getCaseById: db.getCertificationCaseById,
    cleanupConsultantIds: cleanupCertConsultantIds,
    fullPathFromNew: ["needs_interview", "scope_assessment", "proposal", "in_progress", "verification", "completed"],
  },
  {
    name: "erp",
    routerKey: "erpConsultant",
    table: "erpConsultants",
    createCase: createErpCase,
    getCaseById: db.getErpCaseById,
    cleanupConsultantIds: cleanupErpConsultantIds,
    fullPathFromNew: ["needs_triage", "diagnosis", "solution_design", "proposal", "in_progress", "pilot_adjustment", "acceptance", "completed"],
  },
  {
    name: "shortVideo",
    routerKey: "shortVideoConsultant",
    table: "shortVideoConsultants",
    createCase: createShortVideoCase,
    getCaseById: db.getShortVideoCaseById,
    cleanupConsultantIds: cleanupVideoConsultantIds,
    fullPathFromNew: ["needs_interview", "proposal", "pre_production", "script_review", "in_progress", "draft_review", "delivered", "completed"],
  },
];

for (const svc of services) {
  describe(`${svc.routerKey}.claimCase / unassignedCases`, () => {
    it("沒有啟用中顧問身份 → unassignedCases 與 claimCase 皆 FORBIDDEN", async () => {
      const caller = appRouter.createCaller(userCtx(noProfileUserId, "無權限"));
      await expect((caller as any)[svc.routerKey].unassignedCases()).rejects.toThrow(/不是/);
      const caseId = await svc.createCase(await createCaseFactory());
      await expect((caller as any)[svc.routerKey].claimCase({ caseId })).rejects.toThrow(/不是/);
      await deleteRows(svc.table === "certificationConsultants" ? "certificationCases" : svc.table === "erpConsultants" ? "erpCases" : "shortVideoCases", sql`id = ${caseId}`);
    });

    it("啟用中顧問可在 unassignedCases 看到案件，取件成功後從清單消失", async () => {
      const consultantId = await createConsultant(svc.table, `${svc.name}-consultantA`, consultantAUserId);
      svc.cleanupConsultantIds.push(consultantId);
      const caseId = await svc.createCase(await createCaseFactory());

      const caller = appRouter.createCaller(userCtx(consultantAUserId, "顧問甲"));
      const before = await (caller as any)[svc.routerKey].unassignedCases();
      expect(before.map((c: any) => c.id)).toContain(caseId);

      const result = await (caller as any)[svc.routerKey].claimCase({ caseId });
      expect(result.success).toBe(true);
      expect(result.case.assignedConsultantId).toBe(consultantId);
      expect(result.case.status).toBe("new");

      const item = await svc.getCaseById(caseId);
      expect(item?.assignedConsultantId).toBe(consultantId);
      expect(item?.status).toBe("new");
      expect(item?.claimedAt).toBeTruthy();
      const history = (item?.statusHistory ?? []) as any[];
      expect(history.some(h => h.action === "claim" && h.status === "new")).toBe(true);

      const after = await (caller as any)[svc.routerKey].unassignedCases();
      expect(after.map((c: any) => c.id)).not.toContain(caseId);
    });

    it("已取走的案件再次取件 → CONFLICT", async () => {
      const consultantAId = await createConsultant(svc.table, `${svc.name}-consultantA2`, consultantAUserId);
      const consultantBId = await createConsultant(svc.table, `${svc.name}-consultantB2`, consultantBUserId);
      svc.cleanupConsultantIds.push(consultantAId, consultantBId);
      const caseId = await svc.createCase(await createCaseFactory());

      const callerA = appRouter.createCaller(userCtx(consultantAUserId, "顧問甲"));
      const callerB = appRouter.createCaller(userCtx(consultantBUserId, "顧問乙"));

      await (callerA as any)[svc.routerKey].claimCase({ caseId });
      await expect((callerB as any)[svc.routerKey].claimCase({ caseId })).rejects.toMatchObject({ code: "CONFLICT" });

      const item = await svc.getCaseById(caseId);
      expect(item?.assignedConsultantId).toBe(consultantAId);
    });

    it("兩位顧問真正併發取件同一筆案件 → 只有一位成功", async () => {
      const consultantAId = await createConsultant(svc.table, `${svc.name}-raceA`, consultantAUserId);
      const consultantBId = await createConsultant(svc.table, `${svc.name}-raceB`, consultantBUserId);
      svc.cleanupConsultantIds.push(consultantAId, consultantBId);
      const caseId = await svc.createCase(await createCaseFactory());

      const callerA = appRouter.createCaller(userCtx(consultantAUserId, "顧問甲"));
      const callerB = appRouter.createCaller(userCtx(consultantBUserId, "顧問乙"));

      const results = await Promise.allSettled([
        (callerA as any)[svc.routerKey].claimCase({ caseId }),
        (callerB as any)[svc.routerKey].claimCase({ caseId }),
      ]);

      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });

      const item = await svc.getCaseById(caseId);
      expect([consultantAId, consultantBId]).toContain(item?.assignedConsultantId);
      expect(item?.status).toBe("new");
    });

    it("管理員可在取件後重新指派給另一位顧問，或改回未指派", async () => {
      const consultantAId = await createConsultant(svc.table, `${svc.name}-reassignA`, consultantAUserId);
      const consultantBId = await createConsultant(svc.table, `${svc.name}-reassignB`, consultantBUserId);
      svc.cleanupConsultantIds.push(consultantAId, consultantBId);
      const caseId = await svc.createCase(await createCaseFactory());

      const callerA = appRouter.createCaller(userCtx(consultantAUserId, "顧問甲"));
      await (callerA as any)[svc.routerKey].claimCase({ caseId });

      const adminCaller = appRouter.createCaller(adminCtx(adminUserId));
      await (adminCaller as any)[svc.routerKey].adminAssignConsultant({ caseId, consultantId: consultantBId });
      let item = await svc.getCaseById(caseId);
      expect(item?.assignedConsultantId).toBe(consultantBId);

      await (adminCaller as any)[svc.routerKey].adminAssignConsultant({ caseId, consultantId: null });
      item = await svc.getCaseById(caseId);
      expect(item?.assignedConsultantId).toBeNull();
    });

    it("adminForceStatus 略過轉移白名單，仍要求 reason 並記錄 forced", async () => {
      const consultantAId = await createConsultant(svc.table, `${svc.name}-forceA`, consultantAUserId);
      svc.cleanupConsultantIds.push(consultantAId);
      const caseId = await svc.createCase(await createCaseFactory());
      const callerA = appRouter.createCaller(userCtx(consultantAUserId, "顧問甲"));
      await (callerA as any)[svc.routerKey].claimCase({ caseId }); // status: unassigned -> new

      const adminCaller = appRouter.createCaller(adminCtx(adminUserId));
      await expect((adminCaller as any)[svc.routerKey].adminForceStatus({
        caseId, nextStatus: "completed", reason: "",
      })).rejects.toThrow();

      const result = await (adminCaller as any)[svc.routerKey].adminForceStatus({
        caseId, nextStatus: "completed", reason: "管理員驗收測試：直接結案",
      });
      expect(result.success).toBe(true);
      const item = await svc.getCaseById(caseId);
      expect(item?.status).toBe("completed");
      expect(item?.statusReason).toBe("管理員驗收測試：直接結案");
      const history = (item?.statusHistory ?? []) as any[];
      expect(history.some(h => h.forced === true && h.status === "completed")).toBe(true);
    });

    it("進入例外狀態（deferred）沒有 reason → BAD_REQUEST；有 reason → 成功並記錄", async () => {
      const consultantAId = await createConsultant(svc.table, `${svc.name}-reasonA`, consultantAUserId);
      svc.cleanupConsultantIds.push(consultantAId);
      const caseId = await svc.createCase(await createCaseFactory());
      const callerA = appRouter.createCaller(userCtx(consultantAUserId, "顧問甲"));
      await (callerA as any)[svc.routerKey].claimCase({ caseId }); // status: unassigned -> new

      await expect((callerA as any)[svc.routerKey].updateCaseStatus({
        caseId, nextStatus: "deferred",
      })).rejects.toThrow(/原因/);

      const result = await (callerA as any)[svc.routerKey].updateCaseStatus({
        caseId, nextStatus: "deferred", reason: "客戶要求延後聯繫",
      });
      expect(result.success).toBe(true);
      const item = await svc.getCaseById(caseId);
      expect(item?.status).toBe("deferred");
      expect(item?.statusReason).toBe("客戶要求延後聯繫");
      const history = (item?.statusHistory ?? []) as any[];
      expect(history.some(h => h.status === "deferred" && h.reason === "客戶要求延後聯繫" && !h.forced)).toBe(true);
    });

    it(`完整合法路徑：new 依序推進到 completed（${svc.fullPathFromNew.join(" → ")}），不得跳過中間階段`, async () => {
      const consultantAId = await createConsultant(svc.table, `${svc.name}-pathA`, consultantAUserId);
      svc.cleanupConsultantIds.push(consultantAId);
      const caseId = await svc.createCase(await createCaseFactory());
      const callerA = appRouter.createCaller(userCtx(consultantAUserId, "顧問甲"));
      await (callerA as any)[svc.routerKey].claimCase({ caseId }); // status: unassigned -> new

      // 開頭就驗證一次「不能跳過中間階段」：從 new 直接跳到路徑最後一步（completed）必須被拒絕。
      await expect((callerA as any)[svc.routerKey].updateCaseStatus({
        caseId, nextStatus: "completed",
      })).rejects.toThrow(/不能推進/);

      for (const nextStatus of svc.fullPathFromNew) {
        const result = await (callerA as any)[svc.routerKey].updateCaseStatus({ caseId, nextStatus });
        expect(result.success).toBe(true);
      }
      const item = await svc.getCaseById(caseId);
      expect(item?.status).toBe("completed");
    });
  });
}

describe("三服務待取件清單互相隔離", () => {
  it("certification 的待取件案件不會出現在 erp／短影音的待取件清單", async () => {
    const certConsultantId = await createConsultant("certificationConsultants", "isolation-cert", consultantAUserId);
    const erpConsultantId = await createConsultant("erpConsultants", "isolation-erp", consultantAUserId);
    const videoConsultantId = await createConsultant("shortVideoConsultants", "isolation-video", consultantAUserId);
    cleanupCertConsultantIds.push(certConsultantId);
    cleanupErpConsultantIds.push(erpConsultantId);
    cleanupVideoConsultantIds.push(videoConsultantId);

    const certCaseId = await createCertificationCase(factoryId);
    const caller = appRouter.createCaller(userCtx(consultantAUserId, "顧問甲"));

    const certUnassigned = await caller.certificationConsultant.unassignedCases();
    const erpUnassigned = await caller.erpConsultant.unassignedCases();
    const videoUnassigned = await caller.shortVideoConsultant.unassignedCases();

    expect(certUnassigned.map(c => c.id)).toContain(certCaseId);
    expect(erpUnassigned.map((c: any) => c.id)).not.toContain(certCaseId);
    expect(videoUnassigned.map((c: any) => c.id)).not.toContain(certCaseId);
  });
});
