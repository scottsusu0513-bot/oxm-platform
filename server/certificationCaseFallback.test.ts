/**
 * ISO 与低碳認證專區 — Phase 2 QA 修正 regression test。
 *
 * 走真實本機測試資料庫（受 server/test-db-guard.ts 全域 setupFiles 保護，
 * 不可能連到正式/遠端資料庫），用 appRouter.createCaller(ctx) 直接呼叫 tRPC
 * procedure，與 certificationCenterApplication.test.ts 相同手法。
 *
 * 涵蓋這次修正的三件事：
 * 1. auto-assign 在 candidates 不是剛好一位時，fallback 到「管理員白名單
 *    綁定的啟用中顧問」（剛好一位才 fallback；0 位或多位一律維持
 *    unassigned，不亂猜）。
 * 2. adminAssignConsultant 指派給仍是 unassigned 的案件時，同一次操作內
 *    一併把 status 轉成 new，並寫入 statusHistory；已經是其他狀態的案件
 *    重新指派時狀態不受影響。
 * 3. certificationCases.updatedAt 在 notes／status 更新後會正確改變（drift
 *    修正後的行為）。
 *
 * 本檔案跟 certificationCenterApplication.test.ts 一樣，全程覆寫
 * ADMIN_WHITELIST_EMAILS 成本檔案專屬、每次執行期才決定的假 email
 * （runId 帶時間戳＋亂數），確保不會跟其他測試檔案、或本機開發用的真實
 * 管理員 email 衝突。
 *
 * 每個 it() 各自建立自己的 owner／factory／consultant，並在該測試結束前
 * （try/finally）立刻清乾淨，不依賴單一共用的全域 afterAll——factories 有
 * 「一個 owner 只能有一間工廠」的 UNIQUE 限制、certificationConsultants
 * 也有「一個 userId 只能綁一筆顧問」的 UNIQUE 限制，多個測試共用同一個
 * ownerId／adminUserId 卻延後到檔案結尾才清理，會互相撞到這兩個唯一索引。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const runId = `ccf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
const CCF_TEST_ADMIN_EMAIL = `ccf-test-admin-${runId}@example.test`;
process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([CCF_TEST_ADMIN_EMAIL]);

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
  const ctx = userCtx(id, "ISO Fallback 測試管理員", true);
  (ctx.user as AuthenticatedUser).email = CCF_TEST_ADMIN_EMAIL;
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

async function createConsultant(name: string, userId: number | null, serviceAreas: string[], isActive = true): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO certificationConsultants (name, userId, serviceAreas, isActive, createdAt, updatedAt)
    VALUES (${name}, ${userId}, ${JSON.stringify(serviceAreas)}, ${isActive}, NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

let adminUserId: number;
let seq = 0;
/** 每次呼叫都建立一組全新的 owner + factory，避免 factories.uq_factory_owner_id 撞號。 */
async function freshOwnerFactory(label: string): Promise<{ ownerId: number; factoryId: number }> {
  seq += 1;
  const ownerId = await ensureTestUser(`${runId}-owner-${seq}`, `ISO Fallback 測試申請人-${label}`);
  const factoryId = await createTestFactory(ownerId, `${runId} ${label}`, "approved");
  return { ownerId, factoryId };
}
async function cleanupOwnerFactory(ownerId: number, factoryId: number): Promise<void> {
  await deleteFixtureFactory(factoryId);
  await deleteTestUser(ownerId);
}

beforeAll(async () => {
  await db.ensureCertificationServiceCatalogSeeded();
  const catalog = await db.listPublicCertificationServices();
  if (catalog.length < 1) throw new Error("測試前置條件失敗：現有已上架認證服務目錄為空");
  adminUserId = await ensureTestUser(`${runId}-admin`, "ISO Fallback 測試管理員", CCF_TEST_ADMIN_EMAIL);
});

afterAll(async () => {
  await deleteTestUser(adminUserId);
  process.env.ADMIN_WHITELIST_EMAILS = ORIGINAL_ADMIN_WHITELIST_EMAILS;
});

async function validServiceCode(): Promise<string> {
  const catalog = await db.listPublicCertificationServices();
  return catalog[0].code;
}

const baseInput = {
  contactName: "測試聯絡人",
  phone: "0912345678",
  contactTime: "平日下午",
  additionalNotes: undefined,
  consentAgreed: true as const,
};

describe("Auto-assign fallback：candidates 剛好一位時，不受 fallback 影響", () => {
  it("剛好一位符合的顧問存在時，即使 fallback 顧問也存在，仍指派給該候選人本人", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-A");
    const exactUserId = await ensureTestUser(`${runId}-exact-user`, "唯一候選人本人");
    const exactConsultantId = await createConsultant(`${runId} 唯一候選人`, exactUserId, [validCode], true);
    const fallbackConsultantId = await createConsultant(`${runId} fallback-exact`, adminUserId, ["unrelated-service-code-zz"], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });
      const item = await db.getCertificationCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(exactConsultantId);
      expect(item?.assignedConsultantId).not.toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");
      await deleteCertificationCase(result.id);
    } finally {
      await deleteCertificationConsultant(exactConsultantId);
      await deleteCertificationConsultant(fallbackConsultantId);
      await deleteTestUser(exactUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：zero candidate", () => {
  it("完全沒有符合的顧問時，fallback 到管理員白名單綁定的啟用中顧問", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-zero");
    // fallback 顧問本身的 serviceAreas 刻意設成「不包含 validCode」的其他
    // 代碼——如果留空陣列，空陣列本身視為「什麼都符合」，會讓這筆顧問直接
    // 從主要 candidates 篩選就命中（candidates.length===1，走的是原本
    // auto-assign 路徑，不是真的在測 fallback 分支）。這裡刻意排除，才是
    // 真正的「主要篩選 0 位候選人，退而求其次呼叫
    // findFallbackCertificationConsultant」情境；該函式判斷依據只看 userId
    // 是否屬於管理員白名單，不看 serviceAreas，所以這筆顧問仍然找得到。
    const fallbackConsultantId = await createConsultant(`${runId} fallback-zero`, adminUserId, ["unrelated-service-code-zz"], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });
      const item = await db.getCertificationCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");

      const notifIds = await waitForNotificationIds(adminUserId, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteCertificationCase(result.id);
    } finally {
      await deleteCertificationConsultant(fallbackConsultantId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：multiple candidates", () => {
  it("兩位以上候選人都符合（無法唯一決定）時，fallback 到管理員白名單綁定的啟用中顧問", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-multi");
    const userA = await ensureTestUser(`${runId}-multiA`, "候選人甲");
    const userB = await ensureTestUser(`${runId}-multiB`, "候選人乙");
    const consultantA = await createConsultant(`${runId} 候選甲`, userA, [], true);
    const consultantB = await createConsultant(`${runId} 候選乙`, userB, [], true);
    // fallback 顧問排除 validCode，避免它自己也混進主要 candidates 篩選、
    // 讓 candidates 變成 3 位而非單純的「甲、乙兩位候選人無法唯一決定」。
    const fallbackConsultantId = await createConsultant(`${runId} fallback-multi`, adminUserId, ["unrelated-service-code-zz"], true);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });
      const item = await db.getCertificationCaseById(result.id);
      expect(item?.assignedConsultantId).toBe(fallbackConsultantId);
      expect(item?.status).toBe("new");
      await deleteNotificationsByIds(await captureNotificationIds(adminUserId));
      await deleteCertificationCase(result.id);
    } finally {
      await deleteCertificationConsultant(consultantA);
      await deleteCertificationConsultant(consultantB);
      await deleteCertificationConsultant(fallbackConsultantId);
      await deleteTestUser(userA);
      await deleteTestUser(userB);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Auto-assign fallback：fallback 顧問本身不存在或已停用時，維持 unassigned", () => {
  it("fallback 顧問缺席（管理員未綁定任何啟用中顧問身分）→ unassigned，通知管理員", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-missing-fallback");
    // 本測試刻意不建立任何綁定 adminUserId 的顧問記錄。
    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });
      const item = await db.getCertificationCaseById(result.id);
      expect(item?.assignedConsultantId).toBeNull();
      expect(item?.status).toBe("unassigned");

      const notifIds = await waitForNotificationIds(adminUserId, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteCertificationCase(result.id);
    } finally {
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("fallback 顧問存在但已停用（isActive=false）→ 同樣視為缺席，unassigned，通知管理員", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-inactive-fallback");
    const inactiveFallbackId = await createConsultant(`${runId} fallback-inactive`, adminUserId, [], false);

    try {
      const caller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await caller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });
      const item = await db.getCertificationCaseById(result.id);
      expect(item?.assignedConsultantId).toBeNull();
      expect(item?.status).toBe("unassigned");

      const notifIds = await waitForNotificationIds(adminUserId, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteCertificationCase(result.id);
    } finally {
      await deleteCertificationConsultant(inactiveFallbackId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Admin 手動指派 unassigned 案件：同一次操作離開 unassigned", () => {
  it("unassigned → 指派顧問 → status 變 new、statusHistory 記一筆 admin_assign、新顧問收到通知", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-manual-assign");
    const consultantUserId = await ensureTestUser(`${runId}-manual-consultant`, "手動指派顧問");
    let consultantId = -1;

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });
      // 這個測試刻意在指派前先確認案件真的是 unassigned（沒有任何 fallback
      // 顧問存在），才有意義驗證「指派後離開 unassigned」這件事。手動指派的
      // 顧問要在案件建立「之後」才建立——如果案件建立時它就已存在，
      // serviceAreas 留空（=符合所有服務）會讓它直接被 auto-assign
      // 的主要候選人篩選命中，案件一開始就不會是 unassigned，測不到本測試
      // 真正要驗證的「admin 指派讓案件離開 unassigned」這件事。
      consultantId = await createConsultant(`${runId} 手動指派顧問`, consultantUserId, [], true);
      const before = await db.getCertificationCaseById(result.id);
      expect(before?.status).toBe("unassigned");
      expect(before?.claimedAt).toBeNull();

      const adminCaller = appRouter.createCaller(adminCtx(adminUserId));
      const assignResult = await adminCaller.certificationConsultant.adminAssignConsultant({
        caseId: result.id, consultantId,
      });
      expect(assignResult.success).toBe(true);

      const after = await db.getCertificationCaseById(result.id);
      expect(after?.assignedConsultantId).toBe(consultantId);
      expect(after?.status).toBe("new");
      // claimedAt 語意上專屬顧問自助取件（見 claimCertificationCase），管理員
      // 指派不強行寫入，維持與 auto-assign 一致的既有語意。
      expect(after?.claimedAt).toBeNull();

      const history = (after?.statusHistory ?? []) as Array<{ status: string; action?: string; byUserId: number }>;
      const lastEntry = history[history.length - 1];
      expect(lastEntry?.status).toBe("new");
      expect(lastEntry?.action).toBe("admin_assign");
      expect(lastEntry?.byUserId).toBe(adminUserId);

      const notifIds = await waitForNotificationIds(consultantUserId, 1);
      expect(notifIds.length).toBeGreaterThan(0);
      await deleteNotificationsByIds(notifIds);
      await deleteCertificationCase(result.id);
    } finally {
      if (consultantId !== -1) await deleteCertificationConsultant(consultantId);
      await deleteTestUser(consultantUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });

  it("案件已經離開 unassigned 後，改派另一位顧問只換承辦人，狀態不變", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-reassign");
    const consultantUserId1 = await ensureTestUser(`${runId}-reassign1`, "改派前顧問");
    const consultantUserId2 = await ensureTestUser(`${runId}-reassign2`, "改派後顧問");
    const consultant1 = await createConsultant(`${runId} 改派前顧問`, consultantUserId1, [], true);
    const consultant2 = await createConsultant(`${runId} 改派後顧問`, consultantUserId2, [], true);

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });

      const adminCaller = appRouter.createCaller(adminCtx(adminUserId));
      // 第一次指派（不論案件建立當下是 unassigned 還是已自動指派，這裡都
      // 明確指定給 consultant1，之後的狀態轉移才是本測試真正要驗證的行為）。
      await adminCaller.certificationConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant1 });
      const consultantCaller1 = appRouter.createCaller(userCtx(consultantUserId1, "改派前顧問"));
      await consultantCaller1.certificationConsultant.updateCaseStatus({ caseId: result.id, nextStatus: "needs_interview" });
      const midway = await db.getCertificationCaseById(result.id);
      expect(midway?.status).toBe("needs_interview");

      // 案件已經進展到 needs_interview，改派給另一位顧問：只換承辦人，狀態
      // 不會被「指派時自動轉 new」的規則往回拉。
      await adminCaller.certificationConsultant.adminAssignConsultant({ caseId: result.id, consultantId: consultant2 });
      const after = await db.getCertificationCaseById(result.id);
      expect(after?.assignedConsultantId).toBe(consultant2);
      expect(after?.status).toBe("needs_interview");

      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId1));
      await deleteNotificationsByIds(await captureNotificationIds(consultantUserId2));
      await deleteCertificationCase(result.id);
    } finally {
      await deleteCertificationConsultant(consultant1);
      await deleteCertificationConsultant(consultant2);
      await deleteTestUser(consultantUserId1);
      await deleteTestUser(consultantUserId2);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("Fallback 只在建立案件時執行：手動改派後不會被搶回", () => {
  it("fallback 建立的案件，手動改派給其他顧問後，狀態查詢不會把它改回 fallback 顧問", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-fallback-then-reassign");
    const fallbackConsultantId = await createConsultant(`${runId} fallback-owns-truth`, adminUserId, ["unrelated-service-code-zz"], true);
    const otherUserId = await ensureTestUser(`${runId}-other-owner`, "後手接手顧問");
    let otherConsultantId = -1;

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });
      const afterCreate = await db.getCertificationCaseById(result.id);
      expect(afterCreate?.assignedConsultantId).toBe(fallbackConsultantId);

      // 「後手接手顧問」要在案件建立之後才建立——serviceAreas 留空
      // （=符合所有服務）如果案件建立當下它就已存在，會直接被 auto-assign
      // 的主要候選人篩選命中，afterCreate 就不會是 fallbackConsultantId，
      // 測不到本測試真正要驗證的「fallback 只在建立當下執行一次」這件事。
      otherConsultantId = await createConsultant(`${runId} 後手接手顧問`, otherUserId, [], true);
      const adminCaller = appRouter.createCaller(adminCtx(adminUserId));
      await adminCaller.certificationConsultant.adminAssignConsultant({ caseId: result.id, consultantId: otherConsultantId });

      // 多次重新查詢／模擬「顧問看板重新整理」，確認 fallback 不會在讀取時
      // 又把案件搶回去——fallback 只發生在
      // createCertificationCaseWithAutoAssign 這個建立路徑，其餘任何查詢
      // 都不會呼叫它。
      for (let i = 0; i < 3; i++) {
        const check = await db.getCertificationCaseById(result.id);
        expect(check?.assignedConsultantId).toBe(otherConsultantId);
      }

      await deleteNotificationsByIds(await captureNotificationIds(adminUserId));
      await deleteNotificationsByIds(await captureNotificationIds(otherUserId));
      await deleteCertificationCase(result.id);
    } finally {
      await deleteCertificationConsultant(fallbackConsultantId);
      if (otherConsultantId !== -1) await deleteCertificationConsultant(otherConsultantId);
      await deleteTestUser(otherUserId);
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});

describe("certificationCases.updatedAt：drift 修正後應正確反映每次更新", () => {
  it("建立後 updatedAt 等於 createdAt；notes 更新、status 更新後 updatedAt 都會前進，createdAt 不變", async () => {
    const validCode = await validServiceCode();
    const { ownerId, factoryId } = await freshOwnerFactory("case-updatedat");

    try {
      const applyCaller = appRouter.createCaller(userCtx(ownerId, "測試申請人"));
      const result = await applyCaller.certificationCenter.submitApplication({
        ...baseInput, factoryId, servicesWanted: [validCode], isUnsure: false,
      });

      const initial = await db.getCertificationCaseById(result.id);
      const createdAt = initial!.createdAt.getTime();

      await sleep(1100);
      const adminCaller = appRouter.createCaller(adminCtx(adminUserId));
      await adminCaller.certificationConsultant.updateCaseNotes({ caseId: result.id, notes: "QA 測試備註" });
      const afterNotes = await db.getCertificationCaseById(result.id);
      expect(afterNotes!.createdAt.getTime()).toBe(createdAt);
      expect(afterNotes!.updatedAt.getTime()).toBeGreaterThan(initial!.updatedAt.getTime());

      await sleep(1100);
      await db.updateCertificationCaseStatus(result.id, "archived", { userId: adminUserId, name: "QA" }, { reason: "測試清理" });
      const afterStatus = await db.getCertificationCaseById(result.id);
      expect(afterStatus!.createdAt.getTime()).toBe(createdAt);
      expect(afterStatus!.updatedAt.getTime()).toBeGreaterThan(afterNotes!.updatedAt.getTime());

      await deleteCertificationCase(result.id);
    } finally {
      await cleanupOwnerFactory(ownerId, factoryId);
    }
  });
});
