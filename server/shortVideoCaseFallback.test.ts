/**
 * 短影音與品牌內容行銷專區 — Phase 2 QA 修正 regression test。
 *
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 全域 setupFiles 保護，
 * 不可能連到正式/遠端資料庫或本機開發用的 oxm），用 appRouter.createCaller(ctx)
 * 直接呼叫 tRPC procedure，與 server/certificationCaseFallback.test.ts（ISO
 * Phase 2）／server/erpCaseFallback.test.ts（ERP Phase 2）完全對稱的手法與
 * 慣例。
 *
 * 涵蓋這次修正的四件事：
 * 1. auto-assign 在 candidates 不是剛好一位時，fallback 到「管理員白名單
 *    綁定的啟用中短影音顧問」（剛好一位才 fallback；0 位或多位一律維持
 *    unassigned）。
 * 2. adminAssignShortVideoConsultant 指派給仍是 unassigned 的案件時，同一
 *    次操作內一併把 status 轉成 new，並寫入 statusHistory；已經是其他狀態
 *    的案件重新指派時狀態不受影響。
 * 3. Admin 指派成功後通知新承辦顧問。
 * 4. shortVideoCases.updatedAt／shortVideoConsultants.updatedAt 在更新後會
 *    正確反映。
 *
 * 每個 it() 各自建立自己的 owner／factory／consultant（含 fallback 用的
 * admin-bound consultant），並在該測試結束前（try/finally）立刻清乾淨，不
 * 依賴單一共用的全域 afterAll——factories 有「一個 owner 只能有一間工廠」的
 * UNIQUE 限制、shortVideoConsultants 也有「一個 userId 只能綁一筆顧問」的
 * UNIQUE 限制，多個測試共用同一個 ownerId／adminUserId 卻延後到檔案結尾才
 * 清理，會互相撞到這兩個唯一索引（ISO/ERP Phase 2 寫測試時已踩過這個坑，
 * 這裡從一開始就用 per-test 建立、per-test 清理）。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const runId = `svcf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
const SVCF_TEST_ADMIN_EMAIL_A = `svcf-test-admin-a-${runId}@example.test`;
const SVCF_TEST_ADMIN_EMAIL_B = `svcf-test-admin-b-${runId}@example.test`;
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
  const ctx = userCtx(id, "短影音 Fallback 測試管理員甲", true);
  (ctx.user as AuthenticatedUser).email = SVCF_TEST_ADMIN_EMAIL_A;
  return ctx;
}
function adminCtxB(id: number): TrpcContext {
  const ctx = userCtx(id, "短影音 Fallback 測試管理員乙", true);
  (ctx.user as AuthenticatedUser).email = SVCF_TEST_ADMIN_EMAIL_B;
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

async function createShortVideoConsultant(name: string, userId: number | null, serviceAreas: string[], isActive = true): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO shortVideoConsultants (name, userId, serviceAreas, isActive, createdAt, updatedAt)
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
  const ownerId = await ensureTestUser(`${runId}-owner-${seq}`, `短影音 Fallback 測試申請人-${label}`);
  const factoryId = await createTestFactory(ownerId, `${runId} ${label}`, "approved");
  return { ownerId, factoryId };
}
async function cleanupOwnerFactory(ownerId: number, factoryId: number): Promise<void> {
  const conn = await getDb();
  if (conn) {
    await conn.execute(sql`DELETE FROM shortVideoCases WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
  }
  await deleteTestUser(ownerId);
}

beforeAll(async () => {
  process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([SVCF_TEST_ADMIN_EMAIL_A, SVCF_TEST_ADMIN_EMAIL_B]);
  adminUserIdA = await ensureTestUser(`${runId}-admin-a`, "短影音 Fallback 測試管理員甲", SVCF_TEST_ADMIN_EMAIL_A);
  adminUserIdB = await ensureTestUser(`${runId}-admin-b`, "短影音 Fallback 測試管理員乙", SVCF_TEST_ADMIN_EMAIL_B);
});

afterAll(async () => {
  await deleteTestUser(adminUserIdA);
  await deleteTestUser(adminUserIdB);
  process.env.ADMIN_WHITELIST_EMAILS = ORIGINAL_ADMIN_WHITELIST_EMAILS;
});

const SERVICE = "shooting";
const OTHER_SERVICE = "kol";

const baseInput = {
  contactName: "測試聯絡人",
  phone: "0912345678",
  contactTime: "平日下午",
  primaryGoal: "quick_intro" as const,
  platforms: [] as string[],
  noPlatformYet: true,
  additionalNotes: undefined,
  consentAgreed: true as const,
};

describe("Auto-assign fallback：candidates 剛好一位時，不受 fallback 影響", () => {
  it("剛好一位符合的顧問存在時，即使 fallback 顧問也存在，仍指派給該候選人本人", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-A");
    const exactUserId = await ensureTestUser(`${runId}-exact-user`, "唯一候選人本人");
    const exactConsultantId = await createShortVideoConsultant(`${runId} 唯一候選人`, exactUserId, [SERVICE], true);
    // fallback 顧問的 serviceAreas 刻意排除 SERVICE，避免它自己也混進主要
    // candidates 篩選（那樣測到的就不是「恰好一位不受 fallback 影響」了）。
    const fallbackConsultantId = await createShortVideoConsultant(`${runId} fallback-exact`, adminUserIdA, [OTHER_SERVICE], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      const item = await db.getShortVideoCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(exactConsultantId);
      expect(item?.assignedConsultantId).not.toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");
      await deleteShortVideoCase(result.id);
    } finally {
      await deleteShortVideoConsultant(exactConsultantId);
      await deleteShortVideoConsultant(fallbackConsultantId);
      await deleteTestUser(exactUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：zero candidate", () => {
  it("完全沒有符合的顧問時，fallback 到管理員白名單綁定的啟用中短影音顧問；顧問收到 short_video_new_case 通知，不再另外通知 admin", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-zero");
    const fallbackConsultantId = await createShortVideoConsultant(`${runId} fallback-zero`, adminUserIdA, [OTHER_SERVICE], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      const item = await db.getShortVideoCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");

      const notifIds = await waitForNotificationIds(adminUserIdA, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteShortVideoCase(result.id);
    } finally {
      await deleteShortVideoConsultant(fallbackConsultantId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：multiple candidates", () => {
  it("兩位以上候選人都符合（無法唯一決定）時，fallback 到管理員白名單綁定的啟用中短影音顧問", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-multi");
    const userA = await ensureTestUser(`${runId}-multiA`, "候選人甲");
    const userB = await ensureTestUser(`${runId}-multiB`, "候選人乙");
    const consultantA = await createShortVideoConsultant(`${runId} 候選甲`, userA, [SERVICE], true);
    const consultantB = await createShortVideoConsultant(`${runId} 候選乙`, userB, [SERVICE], true);
    const fallbackConsultantId = await createShortVideoConsultant(`${runId} fallback-multi`, adminUserIdA, [OTHER_SERVICE], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      const item = await db.getShortVideoCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");
      await deleteNotificationsByIds(await captureNotificationIds(adminUserIdA));
      await deleteShortVideoCase(result.id);
    } finally {
      await deleteShortVideoConsultant(consultantA);
      await deleteShortVideoConsultant(consultantB);
      await deleteShortVideoConsultant(fallbackConsultantId);
      await deleteTestUser(userA);
      await deleteTestUser(userB);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：fallback 顧問不可用時，維持 unassigned + notifyAdmins", () => {
  it("fallback 顧問缺席（管理員未綁定任何啟用中短影音顧問身分）→ unassigned，通知管理員", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-missing-fallback");
    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      const item = await db.getShortVideoCaseById(result.id);
      expect(item?.assignedConsultantId).toBeNull();
      expect(item?.status).toBe("unassigned");

      const notifIds = await waitForNotificationIds(adminUserIdA, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteShortVideoCase(result.id);
    } finally {
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("fallback 顧問存在但已停用（isActive=false）→ 同樣視為缺席，unassigned，通知管理員", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-inactive-fallback");
    const inactiveFallbackId = await createShortVideoConsultant(`${runId} fallback-inactive`, adminUserIdA, [], false);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      const item = await db.getShortVideoCaseById(result.id);
      expect(item?.assignedConsultantId).toBeNull();
      expect(item?.status).toBe("unassigned");

      const notifIds = await waitForNotificationIds(adminUserIdA, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteShortVideoCase(result.id);
    } finally {
      await deleteShortVideoConsultant(inactiveFallbackId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("有兩位管理員白名單使用者各自綁定了短影音顧問身分（fallback 本身也判斷不出唯一對象）→ unassigned，通知管理員", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-multi-fallback");
    const fallbackA = await createShortVideoConsultant(`${runId} fallback-A`, adminUserIdA, [OTHER_SERVICE], true);
    const fallbackB = await createShortVideoConsultant(`${runId} fallback-B`, adminUserIdB, [OTHER_SERVICE], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      const item = await db.getShortVideoCaseById(result.id);
      expect(item?.assignedConsultantId).toBeNull();
      expect(item?.status).toBe("unassigned");

      await deleteNotificationsByIds(await captureNotificationIds(adminUserIdA));
      await deleteNotificationsByIds(await captureNotificationIds(adminUserIdB));
      await deleteShortVideoCase(result.id);
    } finally {
      await deleteShortVideoConsultant(fallbackA);
      await deleteShortVideoConsultant(fallbackB);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Fallback 只在建立案件時執行：手動改派後不會被搶回", () => {
  it("fallback 建立的案件，手動改派給其他顧問後，狀態查詢不會把它改回 fallback 顧問", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-fallback-then-reassign");
    const fallbackConsultantId = await createShortVideoConsultant(`${runId} fallback-owns-truth`, adminUserIdA, [OTHER_SERVICE], true);
    const otherUserId = await ensureTestUser(`${runId}-other-owner`, "後手接手顧問");
    let otherConsultantId = -1;

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      const afterCreate = await db.getShortVideoCaseById(result.id);
      expect(afterCreate?.assignedConsultantId).toBe(fallbackConsultantId);

      otherConsultantId = await createShortVideoConsultant(`${runId} 後手接手顧問`, otherUserId, [], true);
      const adminCaller = appRouter.createCaller(adminCtxA(adminUserIdA));
      await adminCaller.shortVideoConsultant.adminAssignConsultant({ caseId: result.id, consultantId: otherConsultantId });

      for (let i = 0; i < 3; i++) {
        const check = await db.getShortVideoCaseById(result.id);
        expect(check?.assignedConsultantId).toBe(otherConsultantId);
      }

      await deleteNotificationsByIds(await captureNotificationIds(adminUserIdA));
      await deleteNotificationsByIds(await captureNotificationIds(otherUserId));
      await deleteShortVideoCase(result.id);
    } finally {
      await deleteShortVideoConsultant(fallbackConsultantId);
      if (otherConsultantId !== -1) await deleteShortVideoConsultant(otherConsultantId);
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
      const result = await applyCaller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      // 手動指派的顧問要在案件建立「之後」才建立——如果案件建立時它就已
      // 存在，serviceAreas 留空（=符合所有服務）會讓它直接被 auto-assign
      // 的主要候選人篩選命中，案件一開始就不會是 unassigned。
      consultantId = await createShortVideoConsultant(`${runId} 手動指派顧問`, consultantUserId, [], true);
      const before = await db.getShortVideoCaseById(result.id);
      expect(before?.status).toBe("unassigned");
      expect(before?.claimedAt).toBeNull();

      const adminCaller = appRouter.createCaller(adminCtxA(adminUserIdA));
      const assignResult = await adminCaller.shortVideoConsultant.adminAssignConsultant({
        caseId: result.id, consultantId,
      });
      expect(assignResult.success).toBe(true);

      const after = await db.getShortVideoCaseById(result.id);
      expect(after?.assignedConsultantId).toBe(consultantId);
      expect(after?.status).toBe("new");
      // claimedAt 語意上專屬顧問自助取件（見 claimShortVideoCase），管理員
      // 指派不強行寫入，維持與 auto-assign 一致的既有語意。
      expect(after?.claimedAt).toBeNull();

      const history = (after?.statusHistory ?? []) as Array<{ status: string; action?: string; byUserId: number }>;
      const lastEntry = history[history.length - 1];
      expect(lastEntry?.status).toBe("new");
      expect(lastEntry?.action).toBe("admin_assign");
      expect(lastEntry?.byUserId).toBe(adminUserIdA);

      const notifIds = await waitForNotificationIds(consultantUserId, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteShortVideoCase(result.id);
    } finally {
      if (consultantId !== -1) await deleteShortVideoConsultant(consultantId);
      await deleteTestUser(consultantUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("案件已經離開 unassigned 後，改派另一位顧問只換承辦人，狀態不變（new / needs_interview / proposal / in_progress 皆同）", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-reassign-progressed");
    const consultantUserId1 = await ensureTestUser(`${runId}-reassign1`, "改派前顧問");
    const consultantUserId2 = await ensureTestUser(`${runId}-reassign2`, "改派後顧問");
    const consultantUserId3 = await ensureTestUser(`${runId}-reassign3`, "改派後顧問2");
    const consultantUserId4 = await ensureTestUser(`${runId}-reassign4`, "改派後顧問3");
    const consultant1 = await createShortVideoConsultant(`${runId} 改派前顧問`, consultantUserId1, [], true);
    const consultant2 = await createShortVideoConsultant(`${runId} 改派後顧問`, consultantUserId2, [], true);
    const consultant3 = await createShortVideoConsultant(`${runId} 改派後顧問2`, consultantUserId3, [], true);
    const consultant4 = await createShortVideoConsultant(`${runId} 改派後顧問3`, consultantUserId4, [], true);

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });

      const adminCaller = appRouter.createCaller(adminCtxA(adminUserIdA));
      await adminCaller.shortVideoConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant1 });

      // new + reassign → new 不變
      await adminCaller.shortVideoConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant2 });
      const afterNewReassign = await db.getShortVideoCaseById(result.id);
      expect(afterNewReassign?.assignedConsultantId).toBe(consultant2);
      expect(afterNewReassign?.status).toBe("new");

      // 推進到 needs_interview，改派 → needs_interview 不變
      const consultantCaller2 = appRouter.createCaller(userCtx(consultantUserId2, "改派後顧問"));
      await consultantCaller2.shortVideoConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "needs_interview" });
      await adminCaller.shortVideoConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant3 });
      const afterInterviewReassign = await db.getShortVideoCaseById(result.id);
      expect(afterInterviewReassign?.assignedConsultantId).toBe(consultant3);
      expect(afterInterviewReassign?.status).toBe("needs_interview");

      // 推進到 proposal，改派 → proposal 不變
      const consultantCaller3 = appRouter.createCaller(userCtx(consultantUserId3, "改派後顧問2"));
      await consultantCaller3.shortVideoConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "proposal" });
      await adminCaller.shortVideoConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant4 });
      const afterProposalReassign = await db.getShortVideoCaseById(result.id);
      expect(afterProposalReassign?.assignedConsultantId).toBe(consultant4);
      expect(afterProposalReassign?.status).toBe("proposal");

      // 推進到 pre_production → script_review → in_progress，改派 → in_progress 不變
      const consultantCaller4 = appRouter.createCaller(userCtx(consultantUserId4, "改派後顧問3"));
      await consultantCaller4.shortVideoConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "pre_production" });
      await consultantCaller4.shortVideoConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "script_review" });
      await consultantCaller4.shortVideoConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "in_progress" });
      await adminCaller.shortVideoConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant1 });
      const afterInProgressReassign = await db.getShortVideoCaseById(result.id);
      expect(afterInProgressReassign?.assignedConsultantId).toBe(consultant1);
      expect(afterInProgressReassign?.status).toBe("in_progress");

      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId1));
      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId2));
      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId3));
      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId4));
      await deleteShortVideoCase(result.id);
    } finally {
      await deleteShortVideoConsultant(consultant1);
      await deleteShortVideoConsultant(consultant2);
      await deleteShortVideoConsultant(consultant3);
      await deleteShortVideoConsultant(consultant4);
      await deleteTestUser(consultantUserId1);
      await deleteTestUser(consultantUserId2);
      await deleteTestUser(consultantUserId3);
      await deleteTestUser(consultantUserId4);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("解除指派（consultantId=null）不會產生「已指派」通知", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-unassign-noop");
    const consultantUserId = await ensureTestUser(`${runId}-unassign-noop`, "解除指派用顧問");
    let consultantId = -1;

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });
      // 顧問要在案件建立「之後」才建立——理由同上：避免 submitApplication
      // 自己先發一次 short_video_new_case 通知，干擾下面「指派後只會有一筆
      // 通知」的判斷。
      consultantId = await createShortVideoConsultant(`${runId} 解除指派用顧問`, consultantUserId, [], true);

      const adminCaller = appRouter.createCaller(adminCtxA(adminUserIdA));
      await adminCaller.shortVideoConsultant.adminAssignConsultant({ caseId: result.id, consultantId });
      const firstAssignNotifIds = await waitForNotificationIds(consultantUserId, 1);
      expect(firstAssignNotifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(firstAssignNotifIds);

      await adminCaller.shortVideoConsultant.adminAssignConsultant({ caseId: result.id, consultantId: null });
      const after = await db.getShortVideoCaseById(result.id);
      expect(after?.assignedConsultantId).toBeNull();

      // 解除指派沒有「新承辦顧問」可通知，不應該產生任何新通知。等待一小段
      // 時間確認沒有遲到的新通知冒出來，而不是只查一次瞬間快照。
      await sleep(300);
      const notifIds = await captureNotificationIds(consultantUserId);
      expect(notifIds.length).toBe(0);
      await deleteShortVideoCase(result.id);
    } finally {
      if (consultantId !== -1) await deleteShortVideoConsultant(consultantId);
      await deleteTestUser(consultantUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("shortVideoCases.updatedAt / shortVideoConsultants.updatedAt：drift 修正後應正確反映每次更新", () => {
  it("shortVideoCases：建立後 updatedAt 等於 createdAt；notes 更新、status 更新後 updatedAt 都會前進，createdAt 不變", async () => {
    const { ownerId, factoryId } = await freshOwnerFactory("case-updatedat");
    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.shortVideoCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [SERVICE], isUnsure: false,
      });

      const initial = await db.getShortVideoCaseById(result.id);
      const createdAt = initial!.createdAt.getTime();
      expect(initial!.updatedAt.getTime()).toBe(createdAt);

      await sleep(1100);
      await db.updateShortVideoCaseNotes(result.id, "QA 測試備註", { userId: adminUserIdA, name: "QA" });
      const afterNotes = await db.getShortVideoCaseById(result.id);
      expect(afterNotes!.createdAt.getTime()).toBe(createdAt);
      expect(afterNotes!.updatedAt.getTime()).toBeGreaterThan(initial!.updatedAt.getTime());

      await sleep(1100);
      await db.updateShortVideoCaseStatus(result.id, "archived", { userId: adminUserIdA, name: "QA" }, { reason: "測試清理" });
      const afterStatus = await db.getShortVideoCaseById(result.id);
      expect(afterStatus!.createdAt.getTime()).toBe(createdAt);
      expect(afterStatus!.updatedAt.getTime()).toBeGreaterThan(afterNotes!.updatedAt.getTime());

      await deleteShortVideoCase(result.id);
    } finally {
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("shortVideoConsultants：建立後 updatedAt 等於 createdAt；安全欄位更新（isActive 切換）後 updatedAt 前進，createdAt 不變", async () => {
    const consultantUserId = await ensureTestUser(`${runId}-consultant-updatedat`, "updatedAt 測試顧問");
    const consultantId = await createShortVideoConsultant(`${runId} updatedAt 測試顧問`, consultantUserId, [], true);
    try {
      const initial = await db.getShortVideoConsultantById(consultantId);
      const createdAt = initial!.createdAt.getTime();
      expect(initial!.updatedAt.getTime()).toBe(createdAt);

      await sleep(1100);
      await db.adminSetShortVideoConsultantActive(consultantId, false);
      const afterToggle = await db.getShortVideoConsultantById(consultantId);
      expect(afterToggle!.createdAt.getTime()).toBe(createdAt);
      expect(afterToggle!.updatedAt.getTime()).toBeGreaterThan(initial!.updatedAt.getTime());
    } finally {
      await deleteShortVideoConsultant(consultantId);
      await deleteTestUser(consultantUserId);
    }
  });
});
