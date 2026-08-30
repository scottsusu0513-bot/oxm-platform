/**
 * ERP 數位化服務 — Phase 2 QA 修正 regression test。
 *
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 全域 setupFiles 保護，
 * 不可能連到正式/遠端資料庫或本機開發用的 oxm），用 appRouter.createCaller(ctx)
 * 直接呼叫 tRPC procedure，與 server/certificationCaseFallback.test.ts（ISO
 * Phase 2）完全對稱的手法與慣例。
 *
 * 涵蓋這次修正的四件事：
 * 1. auto-assign 在 candidates 不是剛好一位時，fallback 到「管理員白名單
 *    綁定的啟用中 ERP 顧問」（剛好一位才 fallback；0 位或多位一律維持
 *    unassigned）。
 * 2. adminAssignErpConsultant 指派給仍是 unassigned 的案件時，同一次操作內
 *    一併把 status 轉成 new，並寫入 statusHistory；已經是其他狀態的案件
 *    重新指派時狀態不受影響。
 * 3. Admin 指派成功後通知新承辦顧問。
 * 4. erpCases.updatedAt／erpConsultants.updatedAt 在更新後會正確反映。
 *
 * 每個 it() 各自建立自己的 owner／factory／consultant（含 fallback 用的
 * admin-bound consultant），並在該測試結束前（try/finally）立刻清乾淨，不
 * 依賴單一共用的全域 afterAll——factories 有「一個 owner 只能有一間工廠」的
 * UNIQUE 限制、erpConsultants 也有「一個 userId 只能綁一筆顧問」的 UNIQUE
 * 限制，多個測試共用同一個 ownerId／adminUserId 卻延後到檔案結尾才清理，會
 * 互相撞到這兩個唯一索引（ISO Phase 2 寫測試時已踩過這個坑，這裡從一開始
 * 就用per-test 建立、per-test 清理）。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const runId = `ecf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
const ECF_TEST_ADMIN_EMAIL_A = `ecf-test-admin-a-${runId}@example.test`;
const ECF_TEST_ADMIN_EMAIL_B = `ecf-test-admin-b-${runId}@example.test`;
// Shared Cleanup（見對話「Vitest ADMIN_WHITELIST_EMAILS env race」）：覆寫搬到
// beforeAll，理由同 certificationCaseFallback.test.ts 開頭註解——
// ENV.adminWhitelistEmails 現在是 getter，不再需要在模組頂層（collect 階段）
// 搶著改 process.env。
const { appRouter } = await import("./routers");
const db = await import("./db");
const { getDb } = db;
const {
  ensureTestUser, deleteTestUser, createTestFactory,
  waitForNotificationIds, deleteNotificationsByIds, captureNotificationIds,
} = await import("./_core/financeTestFixtures");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function userCtx(id: number, name: string, isAdmin = false, email?: string): TrpcContext {
  const user: AuthenticatedUser = {
    id, openId: `${runId}-${id}`, email: email ?? `${runId}-${id}@example.test`,
    name, loginMethod: "manus", role: isAdmin ? "admin" : "user", isFactoryOwner: false,
    isAdmin,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

function adminCtxA(id: number): TrpcContext {
  const ctx = userCtx(id, "ERP Fallback 測試管理員甲", true);
  (ctx.user as AuthenticatedUser).email = ECF_TEST_ADMIN_EMAIL_A;
  return ctx;
}
function adminCtxB(id: number): TrpcContext {
  const ctx = userCtx(id, "ERP Fallback 測試管理員乙", true);
  (ctx.user as AuthenticatedUser).email = ECF_TEST_ADMIN_EMAIL_B;
  return ctx;
}

async function deleteErpCase(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM erpCases WHERE id = ${id}`);
}

async function deleteErpConsultant(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM erpConsultants WHERE id = ${id}`);
}

async function createErpConsultant(name: string, userId: number | null, serviceAreas: string[], isActive = true): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO erpConsultants (name, userId, serviceAreas, isActive, createdAt, updatedAt)
    VALUES (${name}, ${userId}, ${JSON.stringify(serviceAreas)}, ${isActive}, NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

let adminUserIdA: number;
let adminUserIdB: number;
let seq = 0;
/** 每次呼叫都建立一組全新的 owner + factory，避免 factories.uq_factory_owner_id 撞號。 */
async function freshOwnerFactory(label: string): Promise<{ ownerId: number; factoryId: number }> {
  seq += 1;
  const ownerId = await ensureTestUser(`${runId}-owner-${seq}`, `ERP Fallback 測試申請人-${label}`);
  const factoryId = await createTestFactory(ownerId, `${runId} ${label}`, "approved");
  return { ownerId, factoryId };
}
async function cleanupOwnerFactory(ownerId: number, factoryId: number): Promise<void> {
  const conn = await getDb();
  if (conn) {
    await conn.execute(sql`DELETE FROM erpCases WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
  }
  await deleteTestUser(ownerId);
}

beforeAll(async () => {
  process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([ECF_TEST_ADMIN_EMAIL_A, ECF_TEST_ADMIN_EMAIL_B]);
  adminUserIdA = await ensureTestUser(`${runId}-admin-a`, "ERP Fallback 測試管理員甲", ECF_TEST_ADMIN_EMAIL_A);
  adminUserIdB = await ensureTestUser(`${runId}-admin-b`, "ERP Fallback 測試管理員乙", ECF_TEST_ADMIN_EMAIL_B);
});

afterAll(async () => {
  await deleteTestUser(adminUserIdA);
  await deleteTestUser(adminUserIdB);
  process.env.ADMIN_WHITELIST_EMAILS = ORIGINAL_ADMIN_WHITELIST_EMAILS;
});

const NEED_TYPE = "erp_adoption";
const OTHER_NEED_TYPE = "line_optimization";

const baseInput = {
  contactName: "測試聯絡人",
  phone: "0912345678",
  contactTime: "平日下午",
  additionalNotes: undefined,
  consentAgreed: true as const,
};

describe("Auto-assign fallback：candidates 剛好一位時，不受 fallback 影響", () => {
  it("剛好一位符合的顧問存在時，即使 fallback 顧問也存在，仍指派給該候選人本人", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-A");
    const exactUserId = await ensureTestUser(`${runId}-exact-user`, "唯一候選人本人");
    const exactConsultantId = await createErpConsultant(`${runId} 唯一候選人`, exactUserId, [NEED_TYPE], true);
    // fallback 顧問的 serviceAreas 刻意排除 NEED_TYPE，避免它自己也混進主要
    // candidates 篩選（那樣測到的就不是「恰好一位不受 fallback 影響」了）。
    const fallbackConsultantId = await createErpConsultant(`${runId} fallback-exact`, adminUserIdA, [OTHER_NEED_TYPE], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      const item = await db.getErpCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(exactConsultantId);
      expect(item?.assignedConsultantId).not.toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");
      await deleteErpCase(result.id);
    } finally {
      await deleteErpConsultant(exactConsultantId);
      await deleteErpConsultant(fallbackConsultantId);
      await deleteTestUser(exactUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：zero candidate", () => {
  it("完全沒有符合的顧問時，fallback 到管理員白名單綁定的啟用中 ERP 顧問；顧問收到 erp_new_case 通知，不再另外通知 admin", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-zero");
    const fallbackConsultantId = await createErpConsultant(`${runId} fallback-zero`, adminUserIdA, [OTHER_NEED_TYPE], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      const item = await db.getErpCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");

      // fallback 成功：新承辦顧問應收到 erp_new_case，不應該再收到
      // erp_unassigned（避免同一筆案件重複通知）。
      const notifIds = await waitForNotificationIds(adminUserIdA, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteErpCase(result.id);
    } finally {
      await deleteErpConsultant(fallbackConsultantId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：multiple candidates", () => {
  it("兩位以上候選人都符合（無法唯一決定）時，fallback 到管理員白名單綁定的啟用中 ERP 顧問", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-multi");
    const userA = await ensureTestUser(`${runId}-multiA`, "候選人甲");
    const userB = await ensureTestUser(`${runId}-multiB`, "候選人乙");
    const consultantA = await createErpConsultant(`${runId} 候選甲`, userA, [NEED_TYPE], true);
    const consultantB = await createErpConsultant(`${runId} 候選乙`, userB, [NEED_TYPE], true);
    const fallbackConsultantId = await createErpConsultant(`${runId} fallback-multi`, adminUserIdA, [OTHER_NEED_TYPE], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      const item = await db.getErpCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");
      await deleteNotificationsByIds(await captureNotificationIds(adminUserIdA));
      await deleteErpCase(result.id);
    } finally {
      await deleteErpConsultant(consultantA);
      await deleteErpConsultant(consultantB);
      await deleteErpConsultant(fallbackConsultantId);
      await deleteTestUser(userA);
      await deleteTestUser(userB);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：fallback 顧問不可用時，維持 unassigned + notifyAdmins", () => {
  it("fallback 顧問缺席（管理員未綁定任何啟用中 ERP 顧問身分）→ unassigned，通知管理員", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-missing-fallback");
    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      const item = await db.getErpCaseById(result.id);
      expect(item?.assignedConsultantId).toBeNull();
      expect(item?.status).toBe("unassigned");

      const notifIds = await waitForNotificationIds(adminUserIdA, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteErpCase(result.id);
    } finally {
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("fallback 顧問存在但已停用（isActive=false）→ 同樣視為缺席，unassigned，通知管理員", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-inactive-fallback");
    const inactiveFallbackId = await createErpConsultant(`${runId} fallback-inactive`, adminUserIdA, [], false);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      const item = await db.getErpCaseById(result.id);
      expect(item?.assignedConsultantId).toBeNull();
      expect(item?.status).toBe("unassigned");

      const notifIds = await waitForNotificationIds(adminUserIdA, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteErpCase(result.id);
    } finally {
      await deleteErpConsultant(inactiveFallbackId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("有兩位管理員白名單使用者各自綁定了 ERP 顧問身分（fallback 本身也判斷不出唯一對象）→ unassigned，通知管理員", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-multi-fallback");
    const fallbackA = await createErpConsultant(`${runId} fallback-A`, adminUserIdA, [OTHER_NEED_TYPE], true);
    const fallbackB = await createErpConsultant(`${runId} fallback-B`, adminUserIdB, [OTHER_NEED_TYPE], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      const item = await db.getErpCaseById(result.id);
      expect(item?.assignedConsultantId).toBeNull();
      expect(item?.status).toBe("unassigned");

      await deleteNotificationsByIds(await captureNotificationIds(adminUserIdA));
      await deleteNotificationsByIds(await captureNotificationIds(adminUserIdB));
      await deleteErpCase(result.id);
    } finally {
      await deleteErpConsultant(fallbackA);
      await deleteErpConsultant(fallbackB);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Fallback 只在建立案件時執行：手動改派後不會被搶回", () => {
  it("fallback 建立的案件，手動改派給其他顧問後，狀態查詢不會把它改回 fallback 顧問", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-fallback-then-reassign");
    const fallbackConsultantId = await createErpConsultant(`${runId} fallback-owns-truth`, adminUserIdA, [OTHER_NEED_TYPE], true);
    const otherUserId = await ensureTestUser(`${runId}-other-owner`, "後手接手顧問");
    let otherConsultantId = -1;

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      const afterCreate = await db.getErpCaseById(result.id);
      expect(afterCreate?.assignedConsultantId).toBe(fallbackConsultantId);

      otherConsultantId = await createErpConsultant(`${runId} 後手接手顧問`, otherUserId, [], true);
      const adminCaller = appRouter.createCaller(adminCtxA(adminUserIdA));
      await adminCaller.erpConsultant.adminAssignConsultant({ caseId: result.id, consultantId: otherConsultantId });

      for (let i = 0; i < 3; i++) {
        const check = await db.getErpCaseById(result.id);
        expect(check?.assignedConsultantId).toBe(otherConsultantId);
      }

      await deleteNotificationsByIds(await captureNotificationIds(adminUserIdA));
      await deleteNotificationsByIds(await captureNotificationIds(otherUserId));
      await deleteErpCase(result.id);
    } finally {
      await deleteErpConsultant(fallbackConsultantId);
      if (otherConsultantId !== -1) await deleteErpConsultant(otherConsultantId);
      await deleteTestUser(otherUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Admin 手動指派 unassigned 案件：同一次操作離開 unassigned，並通知新承辦顧問", () => {
  it("unassigned → 指派顧問 → status 變 new、statusHistory 記一筆 admin_assign、新顧問收到通知", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-manual-assign");
    const consultantUserId = await ensureTestUser(`${runId}-manual-consultant`, "手動指派顧問");
    let consultantId = -1;

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      // 手動指派的顧問要在案件建立「之後」才建立——如果案件建立時它就已
      // 存在，serviceAreas 留空（=符合所有 needType）會讓它直接被 auto-assign
      // 的主要候選人篩選命中，案件一開始就不會是 unassigned。
      consultantId = await createErpConsultant(`${runId} 手動指派顧問`, consultantUserId, [], true);
      const before = await db.getErpCaseById(result.id);
      expect(before?.status).toBe("unassigned");
      expect(before?.claimedAt).toBeNull();

      const adminCaller = appRouter.createCaller(adminCtxA(adminUserIdA));
      const assignResult = await adminCaller.erpConsultant.adminAssignConsultant({
        caseId: result.id, consultantId,
      });
      expect(assignResult.success).toBe(true);

      const after = await db.getErpCaseById(result.id);
      expect(after?.assignedConsultantId).toBe(consultantId);
      expect(after?.status).toBe("new");
      // claimedAt 語意上專屬顧問自助取件（見 claimErpCase），管理員指派不
      // 強行寫入，維持與 auto-assign 一致的既有語意。
      expect(after?.claimedAt).toBeNull();

      const history = (after?.statusHistory ?? []) as Array<{ status: string; action?: string; byUserId: number }>;
      const lastEntry = history[history.length - 1];
      expect(lastEntry?.status).toBe("new");
      expect(lastEntry?.action).toBe("admin_assign");
      expect(lastEntry?.byUserId).toBe(adminUserIdA);

      const notifIds = await waitForNotificationIds(consultantUserId, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteErpCase(result.id);
    } finally {
      if (consultantId !== -1) await deleteErpConsultant(consultantId);
      await deleteTestUser(consultantUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("案件已經離開 unassigned 後，改派另一位顧問只換承辦人，狀態不變（new / needs_triage / proposal 皆同）", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-reassign-progressed");
    const consultantUserId1 = await ensureTestUser(`${runId}-reassign1`, "改派前顧問");
    const consultantUserId2 = await ensureTestUser(`${runId}-reassign2`, "改派後顧問");
    const consultantUserId3 = await ensureTestUser(`${runId}-reassign3`, "改派後顧問2");
    const consultant1 = await createErpConsultant(`${runId} 改派前顧問`, consultantUserId1, [], true);
    const consultant2 = await createErpConsultant(`${runId} 改派後顧問`, consultantUserId2, [], true);
    const consultant3 = await createErpConsultant(`${runId} 改派後顧問2`, consultantUserId3, [], true);

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });

      const adminCaller = appRouter.createCaller(adminCtxA(adminUserIdA));
      await adminCaller.erpConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant1 });

      // new + reassign → new 不變
      await adminCaller.erpConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant2 });
      const afterNewReassign = await db.getErpCaseById(result.id);
      expect(afterNewReassign?.assignedConsultantId).toBe(consultant2);
      expect(afterNewReassign?.status).toBe("new");

      // 推進到 needs_triage，改派 → needs_triage 不變
      const consultantCaller2 = appRouter.createCaller(userCtx(consultantUserId2, "改派後顧問"));
      await consultantCaller2.erpConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "needs_triage" });
      await adminCaller.erpConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant3 });
      const afterTriageReassign = await db.getErpCaseById(result.id);
      expect(afterTriageReassign?.assignedConsultantId).toBe(consultant3);
      expect(afterTriageReassign?.status).toBe("needs_triage");

      // 推進到 diagnosis → solution_design → proposal，改派 → proposal 不變
      const consultantCaller3 = appRouter.createCaller(userCtx(consultantUserId3, "改派後顧問2"));
      await consultantCaller3.erpConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "diagnosis" });
      await consultantCaller3.erpConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "solution_design" });
      await consultantCaller3.erpConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "proposal" });
      await adminCaller.erpConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant1 });
      const afterProposalReassign = await db.getErpCaseById(result.id);
      expect(afterProposalReassign?.assignedConsultantId).toBe(consultant1);
      expect(afterProposalReassign?.status).toBe("proposal");

      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId1));
      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId2));
      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId3));
      await deleteErpCase(result.id);
    } finally {
      await deleteErpConsultant(consultant1);
      await deleteErpConsultant(consultant2);
      await deleteErpConsultant(consultant3);
      await deleteTestUser(consultantUserId1);
      await deleteTestUser(consultantUserId2);
      await deleteTestUser(consultantUserId3);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("解除指派（consultantId=null）不會產生「已指派」通知", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-unassign-noop");
    const consultantUserId = await ensureTestUser(`${runId}-unassign-noop`, "解除指派用顧問");
    let consultantId = -1;

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });
      // 顧問要在案件建立「之後」才建立——如果案件建立時它就已存在（且
      // serviceAreas 留空＝符合所有 needType），會被 auto-assign 的主要
      // candidates 篩選直接命中，submitApplication 自己就會先發一次
      // erp_new_case 通知，干擾下面「指派後只會有一筆通知」的判斷。
      consultantId = await createErpConsultant(`${runId} 解除指派用顧問`, consultantUserId, [], true);

      const adminCaller = appRouter.createCaller(adminCtxA(adminUserIdA));
      await adminCaller.erpConsultant.adminAssignConsultant({ caseId: result.id, consultantId });
      // notifyUser 是 fire-and-forget，指派 mutation 回傳當下不保證通知已經
      // 寫入完成——用 waitForNotificationIds 等到真的寫入後再清掉，避免下面
      // 的「解除指派不應再產生通知」檢查誤把這筆遲到的第一次指派通知算成
      // 解除指派後的新通知。
      const firstAssignNotifIds = await waitForNotificationIds(consultantUserId, 1);
      expect(firstAssignNotifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(firstAssignNotifIds);

      await adminCaller.erpConsultant.adminAssignConsultant({ caseId: result.id, consultantId: null });
      const after = await db.getErpCaseById(result.id);
      expect(after?.assignedConsultantId).toBeNull();

      // 解除指派沒有「新承辦顧問」可通知，不應該產生任何新通知。等待一小段
      // 時間確認沒有遲到的新通知冒出來，而不是只查一次瞬間快照。
      await new Promise(r => setTimeout(r, 300));
      const notifIds = await captureNotificationIds(consultantUserId);
      expect(notifIds.length).toBe(0);
      await deleteErpCase(result.id);
    } finally {
      if (consultantId !== -1) await deleteErpConsultant(consultantId);
      await deleteTestUser(consultantUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("erpCases.updatedAt / erpConsultants.updatedAt：drift 修正後應正確反映每次更新", () => {
  it("erpCases：建立後 updatedAt 等於 createdAt；notes 更新、status 更新後 updatedAt 都會前進，createdAt 不變", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-updatedat");
    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.erpOptimization.submitApplication({
        ...baseInput, factoryId, needType: NEED_TYPE,
      });

      const initial = await db.getErpCaseById(result.id);
      const createdAt = initial!.createdAt.getTime();
      expect(initial!.updatedAt.getTime()).toBe(createdAt);

      await sleep(1100);
      await db.updateErpCaseNotes(result.id, "QA 測試備註", { userId: adminUserIdA, name: "QA" });
      const afterNotes = await db.getErpCaseById(result.id);
      expect(afterNotes!.createdAt.getTime()).toBe(createdAt);
      expect(afterNotes!.updatedAt.getTime()).toBeGreaterThan(initial!.updatedAt.getTime());

      await sleep(1100);
      await db.updateErpCaseStatus(result.id, "archived", { userId: adminUserIdA, name: "QA" }, { reason: "測試清理" });
      const afterStatus = await db.getErpCaseById(result.id);
      expect(afterStatus!.createdAt.getTime()).toBe(createdAt);
      expect(afterStatus!.updatedAt.getTime()).toBeGreaterThan(afterNotes!.updatedAt.getTime());

      await deleteErpCase(result.id);
    } finally {
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("erpConsultants：建立後 updatedAt 等於 createdAt；安全欄位更新（isActive 切換）後 updatedAt 前進，createdAt 不變", async () => {
    const consultantUserId = await ensureTestUser(`${runId}-consultant-updatedat`, "updatedAt 測試顧問");
    const consultantId = await createErpConsultant(`${runId} updatedAt 測試顧問`, consultantUserId, [], true);
    try {
      const initial = await db.getErpConsultantById(consultantId);
      const createdAt = initial!.createdAt.getTime();
      expect(initial!.updatedAt.getTime()).toBe(createdAt);

      await sleep(1100);
      await db.adminSetErpConsultantActive(consultantId, false);
      const afterToggle = await db.getErpConsultantById(consultantId);
      expect(afterToggle!.createdAt.getTime()).toBe(createdAt);
      expect(afterToggle!.updatedAt.getTime()).toBeGreaterThan(initial!.updatedAt.getTime());
    } finally {
      await deleteErpConsultant(consultantId);
      await deleteTestUser(consultantUserId);
    }
  });
});
