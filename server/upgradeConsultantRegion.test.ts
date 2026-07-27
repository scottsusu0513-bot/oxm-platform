/**
 * 政府補助顧問專區流程調整 — 回歸測試。
 *
 * 涵蓋三個互相關聯的變更（皆在 server/db.ts、server/routers.ts）：
 *
 * 1. 新增「deferred」（緩追區）案件狀態：位於 ineligible 與 accepted 之間，
 *    可與 evaluating 互轉，也可直接轉 accepted／ineligible；緩追案件計入
 *    真實總進件數，但不計入過件率分子分母。過件率分子（UPGRADE_ACCEPTED_STATUSES）
 *    ＝ accepted/consulting/submitted/rejected/approved/transforming/completed
 *    （rejected 是「已通過 OXM 資格審核、送件後遭政府駁回」，OXM 資格審核本身
 *    仍算通過，因此計入分子，不當成未通過）；分母
 *    （UPGRADE_ELIGIBILITY_DECIDED_STATUSES）＝分子 ∪ {ineligible}；
 *    new/unassigned/evaluating/deferred/archived 一律排除（尚未定案或無法確認）。
 *
 * 2. 顧問案件存取權限一律以「案件地區」（resolveRegionKey(location)）比對
 *    「顧問目前的有效區域身分」判斷（見 findConsultantForApplicationRegion），
 *    不是只看 upgradeApplications.assignedConsultantId——否則同區尚未分派、
 *    或因資料不一致而 assignedConsultantId 對不上的案件會被漏掉／誤放行。
 *    這裡刻意建立一筆「assignedConsultantId 指向北部顧問、但地址在南部」的
 *    測試案件，直接證明權限判斷確實是看地區而非 FK。
 *
 * 3. 每次管理員／顧問對案件的 mutation，都會同步記錄 lastUpdatedByUserId／
 *    lastUpdatedByNameSnapshot（沿用 communityBidOffers 已驗證過的 snapshot
 *    慣例）；承辦顧問顯示名稱一路沿真實關聯取得（assignedConsultantId →
 *    upgradeConsultants → 綁定的 userId → users 顯示名稱）。
 *
 * 測試手法：
 * - upgradeConsultants 的 north/central/south 三筆是既有 seed 資料，regionKey
 *   有 UNIQUE 索引不能另外新增，因此沿用 server/upgradeConsultantEmail.test.ts
 *   已驗證過的「暫時綁定→驗證→還原」模式，且全程只用 db.bindConsultantUser
 *   這個真實函式（不繞過真正的綁定/驗證邏輯）。
 * - 顧問帳號用 loginPopup.test.ts 已驗證過的原生 SQL 建立測試使用者模式
 *   （避開 db.upsertUser 對 schema 全欄位的假設）。
 * - 案件權限與 mutation 走 appRouter.createCaller(ctx) 真實 tRPC 呼叫（沿用
 *   server/factory.test.ts、server/loginPopup.test.ts 已驗證過的模式），不是
 *   直接呼叫 db 層繞過 Router 的權限檢查。
 * - 過件率統計是全域聚合（不是特定測試資料的計數），因此用「操作前後差值」
 *   斷言，而不是斷言絕對值，避免與本機資料庫既有資料互相干擾。
 * - 前端顯示邏輯（頁面順序、緩追區操作按鈕、承辦顧問／最後更新者 fallback
 *   文字）採用與 server/announcementActionUrl.test.ts、
 *   server/upgradeConsultantEmail.test.ts 相同的原始碼內容斷言手法，不引入
 *   新的元件渲染測試框架。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { getDb } from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const isAdmin = overrides?.role === "admin";
  // 重要：upgradeConsultant 的 myCases/updateCaseStatus/updateCaseNotes/
  // updateCaseAmounts/acknowledge 都是 protectedProcedure，內部直接讀取
  // ctx.user.isAdmin 這個欄位本身（不是像 adminProcedure 那樣重新呼叫
  // isAdminUser() 從 email 白名單推導），因此這裡必須明確設定 isAdmin，
  // 否則即使 email 在白名單內，也會被誤判成一般使用者、走進顧問權限分支。
  const user: AuthenticatedUser = {
    id: 1,
    openId: isAdmin ? "test-upgrade-region-admin" : "test-upgrade-region-user",
    email: isAdmin ? "scottsusu0513@gmail.com" : "test@example.com",
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

const adminCtx = () => createAuthContext({ role: "admin" });
const userCtx = (id: number, name: string) => createAuthContext({ role: "user", id, name });

const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function ensureTestUser(openId: string, name: string): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`
    INSERT INTO users (openId, name, email) VALUES (${openId}, ${name}, ${`${openId}@example.test`})
    ON DUPLICATE KEY UPDATE name = VALUES(name)
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error(`failed to create test user ${openId}`);
  return id;
}

async function deleteTestUser(userId: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
}

async function createTestCase(overrides: {
  companyName: string;
  location: string;
  status: db.UpgradeApplication["status"];
  assignedConsultantId: number | null;
}): Promise<number> {
  return db.createUpgradeApplication({
    companyName: overrides.companyName,
    contactName: "測試聯絡人",
    phone: "0900000000",
    email: `${runId}-${overrides.companyName}@example.test`,
    location: overrides.location,
    capitalAmount: "under_500w",
    employeeCount: "1_5",
    factoryType: "general",
    exportStatus: "no_export",
    consentAgreed: true,
    status: overrides.status,
    assignedConsultantId: overrides.assignedConsultantId,
    statusTimeline: { [overrides.status]: new Date().toISOString() },
  });
}

async function deleteTestCase(id: number): Promise<void> {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM upgradeApplications WHERE id = ${id}`);
}

// ── 顧問帳號暫時綁定（沿用 upgradeConsultantEmail.test.ts 已驗證過的模式） ──
let northConsultant: Awaited<ReturnType<typeof db.getConsultantByRegion>>;
let centralConsultant: Awaited<ReturnType<typeof db.getConsultantByRegion>>;
let southConsultant: Awaited<ReturnType<typeof db.getConsultantByRegion>>;
let originalNorthUserId: number | null;
let originalCentralUserId: number | null;
let originalSouthUserId: number | null;

let northUserId: number;
let centralUserId: number;
let southUserId: number;

beforeAll(async () => {
  northConsultant = await db.getConsultantByRegion("north");
  centralConsultant = await db.getConsultantByRegion("central");
  southConsultant = await db.getConsultantByRegion("south");
  if (!northConsultant || !centralConsultant || !southConsultant) {
    throw new Error("本機測試資料庫缺少 north/central/south 顧問 seed 資料，無法執行此測試");
  }
  originalNorthUserId = northConsultant.userId;
  originalCentralUserId = centralConsultant.userId;
  originalSouthUserId = southConsultant.userId;

  [northUserId, centralUserId, southUserId] = await Promise.all([
    ensureTestUser(`test-upgrade-region-north-${runId}`, "北部測試顧問"),
    ensureTestUser(`test-upgrade-region-central-${runId}`, "中部測試顧問"),
    ensureTestUser(`test-upgrade-region-south-${runId}`, "南部測試顧問"),
  ]);

  await db.bindConsultantUser(northConsultant.id, northUserId);
  await db.bindConsultantUser(centralConsultant.id, centralUserId);
  await db.bindConsultantUser(southConsultant.id, southUserId);
}, 30000);

afterAll(async () => {
  if (northConsultant) await db.bindConsultantUser(northConsultant.id, originalNorthUserId);
  if (centralConsultant) await db.bindConsultantUser(centralConsultant.id, originalCentralUserId);
  if (southConsultant) await db.bindConsultantUser(southConsultant.id, originalSouthUserId);
  await Promise.all([
    deleteTestUser(northUserId),
    deleteTestUser(centralUserId),
    deleteTestUser(southUserId),
  ]);
}, 30000);

// ── 1. 緩追區狀態：進入、顯示、恢復評估 ───────────────────────────────────
describe("upgradeConsultant.updateCaseStatus: 緩追區狀態轉換", () => {
  it("evaluating 可移至 deferred，adminList 顯示為 deferred", async () => {
    const caseId = await createTestCase({
      companyName: "緩追測試A", location: "台北市", status: "evaluating", assignedConsultantId: northConsultant!.id,
    });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await caller.upgradeConsultant.updateCaseStatus({ applicationId: caseId, nextStatus: "deferred" });
      const app = await db.getUpgradeApplicationById(caseId);
      expect(app?.status).toBe("deferred");
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("deferred 可恢復評估（重新評估，deferred → evaluating）", async () => {
    const caseId = await createTestCase({
      companyName: "緩追測試B", location: "台北市", status: "deferred", assignedConsultantId: northConsultant!.id,
    });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await caller.upgradeConsultant.updateCaseStatus({ applicationId: caseId, nextStatus: "evaluating" });
      const app = await db.getUpgradeApplicationById(caseId);
      expect(app?.status).toBe("evaluating");
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("deferred 可直接轉為 accepted（沿用既有立案流程）", async () => {
    const caseId = await createTestCase({
      companyName: "緩追測試C", location: "台北市", status: "deferred", assignedConsultantId: northConsultant!.id,
    });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await caller.upgradeConsultant.updateCaseStatus({ applicationId: caseId, nextStatus: "accepted" });
      const app = await db.getUpgradeApplicationById(caseId);
      expect(app?.status).toBe("accepted");
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("deferred 可直接轉為 ineligible（沿用既有資格不符流程）", async () => {
    const caseId = await createTestCase({
      companyName: "緩追測試D", location: "台北市", status: "deferred", assignedConsultantId: northConsultant!.id,
    });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await caller.upgradeConsultant.updateCaseStatus({ applicationId: caseId, nextStatus: "ineligible" });
      const app = await db.getUpgradeApplicationById(caseId);
      expect(app?.status).toBe("ineligible");
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("new 不能直接跳到 deferred（必須先經過 evaluating）", async () => {
    const caseId = await createTestCase({
      companyName: "緩追測試E", location: "台北市", status: "new", assignedConsultantId: northConsultant!.id,
    });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await expect(caller.upgradeConsultant.updateCaseStatus({ applicationId: caseId, nextStatus: "deferred" })).rejects.toThrow();
    } finally {
      await deleteTestCase(caseId);
    }
  });
});

// ── 2. 過件率：分子分母範圍（rejected／consulting 計入分子，緩追／評估中排除） ──
describe("getUpgradePublicStats / countUpgradeApplications: 過件率分子分母範圍", () => {
  it("新增一筆 deferred 案件：總進件數 +1，但 evaluatedCases／acceptedCases 不變", async () => {
    const beforeTotal = await db.countUpgradeApplications();
    const beforeStats = await db.getUpgradePublicStats();

    const caseId = await createTestCase({
      companyName: "過件率測試-緩追", location: "台北市", status: "deferred", assignedConsultantId: northConsultant!.id,
    });
    try {
      const afterTotal = await db.countUpgradeApplications();
      const afterStats = await db.getUpgradePublicStats();

      expect(afterTotal).toBe(beforeTotal + 1);
      expect(afterStats.evaluatedCases).toBe(beforeStats.evaluatedCases);
      expect(afterStats.acceptedCases).toBe(beforeStats.acceptedCases);
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("新增一筆 ineligible 案件：evaluatedCases +1，acceptedCases 不變（資格判定已定案，但未通過）", async () => {
    const beforeStats = await db.getUpgradePublicStats();
    const caseId = await createTestCase({
      companyName: "過件率測試-資格不符", location: "台北市", status: "ineligible", assignedConsultantId: northConsultant!.id,
    });
    try {
      const afterStats = await db.getUpgradePublicStats();
      expect(afterStats.evaluatedCases).toBe(beforeStats.evaluatedCases + 1);
      expect(afterStats.acceptedCases).toBe(beforeStats.acceptedCases);
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("新增一筆 accepted 案件：evaluatedCases 與 acceptedCases 皆 +1（已完成資格判定且通過）", async () => {
    const beforeStats = await db.getUpgradePublicStats();
    const caseId = await createTestCase({
      companyName: "過件率測試-已立案", location: "台北市", status: "accepted", assignedConsultantId: northConsultant!.id,
    });
    try {
      const afterStats = await db.getUpgradePublicStats();
      expect(afterStats.evaluatedCases).toBe(beforeStats.evaluatedCases + 1);
      expect(afterStats.acceptedCases).toBe(beforeStats.acceptedCases + 1);
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("新增一筆 evaluating 案件（待評估）：evaluatedCases／acceptedCases 皆不變（尚未定案）", async () => {
    const beforeStats = await db.getUpgradePublicStats();
    const caseId = await createTestCase({
      companyName: "過件率測試-評估中", location: "台北市", status: "evaluating", assignedConsultantId: northConsultant!.id,
    });
    try {
      const afterStats = await db.getUpgradePublicStats();
      expect(afterStats.evaluatedCases).toBe(beforeStats.evaluatedCases);
      expect(afterStats.acceptedCases).toBe(beforeStats.acceptedCases);
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("新增一筆 rejected 案件：evaluatedCases 與 acceptedCases 皆 +1（政府駁回，但 OXM 資格審核仍算通過，不可當成未通過）", async () => {
    const beforeStats = await db.getUpgradePublicStats();
    const caseId = await createTestCase({
      companyName: "過件率測試-政府駁回", location: "台北市", status: "rejected", assignedConsultantId: northConsultant!.id,
    });
    try {
      const afterStats = await db.getUpgradePublicStats();
      expect(afterStats.evaluatedCases).toBe(beforeStats.evaluatedCases + 1);
      expect(afterStats.acceptedCases).toBe(beforeStats.acceptedCases + 1);
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("新增一筆 consulting 案件（legacy「已立案」同義字）：evaluatedCases 與 acceptedCases 皆 +1", async () => {
    const beforeStats = await db.getUpgradePublicStats();
    const caseId = await createTestCase({
      companyName: "過件率測試-legacy已立案", location: "台北市", status: "consulting", assignedConsultantId: northConsultant!.id,
    });
    try {
      const afterStats = await db.getUpgradePublicStats();
      expect(afterStats.evaluatedCases).toBe(beforeStats.evaluatedCases + 1);
      expect(afterStats.acceptedCases).toBe(beforeStats.acceptedCases + 1);
    } finally {
      await deleteTestCase(caseId);
    }
  });
});

// ── 3. 北中南顧問區域權限 ──────────────────────────────────────────────────
describe("upgradeConsultant.myCases / 單筆存取: 依案件地區而非 assignedConsultantId 判斷", () => {
  it("北部顧問只能在 myCases 取得北部案件，看不到中部／南部案件", async () => {
    const northCase = await createTestCase({ companyName: "區域測試-北", location: "台北市", status: "evaluating", assignedConsultantId: northConsultant!.id });
    const centralCase = await createTestCase({ companyName: "區域測試-中", location: "台中市", status: "evaluating", assignedConsultantId: centralConsultant!.id });
    const southCase = await createTestCase({ companyName: "區域測試-南", location: "高雄市", status: "evaluating", assignedConsultantId: southConsultant!.id });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      const { items } = await caller.upgradeConsultant.myCases({ limit: 200, offset: 0 });
      const ids = items.map(i => i.id);
      expect(ids).toContain(northCase);
      expect(ids).not.toContain(centralCase);
      expect(ids).not.toContain(southCase);
    } finally {
      await deleteTestCase(northCase);
      await deleteTestCase(centralCase);
      await deleteTestCase(southCase);
    }
  });

  it("管理員可在 myCases 取得北中南全部案件", async () => {
    const northCase = await createTestCase({ companyName: "區域測試-管理員北", location: "台北市", status: "evaluating", assignedConsultantId: northConsultant!.id });
    const centralCase = await createTestCase({ companyName: "區域測試-管理員中", location: "台中市", status: "evaluating", assignedConsultantId: centralConsultant!.id });
    const southCase = await createTestCase({ companyName: "區域測試-管理員南", location: "高雄市", status: "evaluating", assignedConsultantId: southConsultant!.id });
    try {
      const admin = appRouter.createCaller(adminCtx());
      const { items } = await admin.upgradeConsultant.myCases({ limit: 200, offset: 0 });
      const ids = items.map(i => i.id);
      expect(ids).toContain(northCase);
      expect(ids).toContain(centralCase);
      expect(ids).toContain(southCase);
    } finally {
      await deleteTestCase(northCase);
      await deleteTestCase(centralCase);
      await deleteTestCase(southCase);
    }
  });

  it("assignedConsultantId 指向北部、但地址在南部的案件：北部顧問不能存取，南部顧問可以存取（證明依地區而非 FK 判斷）", async () => {
    const mismatchedCase = await createTestCase({
      companyName: "區域測試-錯位案件", location: "高雄市", status: "evaluating", assignedConsultantId: northConsultant!.id,
    });
    try {
      const northCaller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await expect(northCaller.upgradeConsultant.updateCaseNotes({ applicationId: mismatchedCase, notes: "北部顧問嘗試修改" })).rejects.toThrow();

      const southCaller = appRouter.createCaller(userCtx(southUserId, "南部測試顧問"));
      await expect(southCaller.upgradeConsultant.updateCaseNotes({ applicationId: mismatchedCase, notes: "南部顧問修改" })).resolves.toMatchObject({ success: true });
    } finally {
      await deleteTestCase(mismatchedCase);
    }
  });

  it("顧問無法讀取或修改其他區域的指定案件 ID（updateCaseStatus／updateCaseNotes／updateCaseAmounts／acknowledge 皆套用相同限制）", async () => {
    const southCase = await createTestCase({ companyName: "區域測試-權限南", location: "高雄市", status: "evaluating", assignedConsultantId: southConsultant!.id });
    const southNewCase = await createTestCase({ companyName: "區域測試-權限南-new", location: "高雄市", status: "new", assignedConsultantId: southConsultant!.id });
    try {
      const northCaller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await expect(northCaller.upgradeConsultant.updateCaseStatus({ applicationId: southCase, nextStatus: "ineligible" })).rejects.toThrow();
      await expect(northCaller.upgradeConsultant.updateCaseNotes({ applicationId: southCase, notes: "x" })).rejects.toThrow();
      await expect(northCaller.upgradeConsultant.updateCaseAmounts({ applicationId: southCase, plannedSubsidyAmount: 1000 })).rejects.toThrow();
      await expect(northCaller.upgradeConsultant.acknowledge({ applicationId: southNewCase })).rejects.toThrow();
    } finally {
      await deleteTestCase(southCase);
      await deleteTestCase(southNewCase);
    }
  });

  it("地址無法解析出任何已知區域的案件：顧問一律不能存取，只有管理員能查看", async () => {
    const noRegionCase = await createTestCase({
      companyName: "區域測試-無法辨識地址", location: "火星殖民地第一區", status: "evaluating", assignedConsultantId: null,
    });
    try {
      const northCaller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await expect(northCaller.upgradeConsultant.updateCaseNotes({ applicationId: noRegionCase, notes: "x" })).rejects.toThrow();

      const admin = appRouter.createCaller(adminCtx());
      await expect(admin.upgradeConsultant.updateCaseNotes({ applicationId: noRegionCase, notes: "管理員可以修改" })).resolves.toMatchObject({ success: true });
    } finally {
      await deleteTestCase(noRegionCase);
    }
  });
});

// ── 4. 指派時區域一致性（backfillUnassignedCasesToConsultant 既有不變式） ──
describe("backfillUnassignedCasesToConsultant: 只補派區域相符的案件", () => {
  it("綁定北部顧問時，只補派地址解析為北部的 unassigned 案件，南部的 unassigned 案件不受影響", async () => {
    const northUnassigned = await createTestCase({ companyName: "補派測試-北", location: "台北市", status: "unassigned", assignedConsultantId: null });
    const southUnassigned = await createTestCase({ companyName: "補派測試-南", location: "高雄市", status: "unassigned", assignedConsultantId: null });
    try {
      const { backfilledIds } = await db.backfillUnassignedCasesToConsultant(northConsultant!.id, "north");
      expect(backfilledIds).toContain(northUnassigned);
      expect(backfilledIds).not.toContain(southUnassigned);

      const northRow = await db.getUpgradeApplicationById(northUnassigned);
      const southRow = await db.getUpgradeApplicationById(southUnassigned);
      expect(northRow?.assignedConsultantId).toBe(northConsultant!.id);
      expect(southRow?.assignedConsultantId).toBeNull();
      expect(southRow?.status).toBe("unassigned");
    } finally {
      await deleteTestCase(northUnassigned);
      await deleteTestCase(southUnassigned);
    }
  });
});

// ── 5. 非管理員顧問只能有一個有效區域身分 ─────────────────────────────────
describe("bindConsultantUser / adminBindUser: 同一帳號不能同時綁定多個地區", () => {
  it("db.bindConsultantUser 拒絕把已綁定北部的使用者再綁到中部", async () => {
    // northUserId 目前綁定在 north（beforeAll 已綁定），嘗試再綁到 central 應該被拒絕。
    await expect(db.bindConsultantUser(centralConsultant!.id, northUserId)).rejects.toThrow(/一個帳號同時只能擔任一個地區的有效顧問/);
    // 確認 central 沒有真的被改動
    const central = await db.getConsultantById(centralConsultant!.id);
    expect(central?.userId).toBe(centralUserId);
  });

  it("upgradeConsultant.adminBindUser 呼叫時同樣拒絕並回傳 BAD_REQUEST 訊息，不是內部錯誤", async () => {
    const admin = appRouter.createCaller(adminCtx());
    await expect(admin.upgradeConsultant.adminBindUser({ consultantId: southConsultant!.id, userId: northUserId }))
      .rejects.toThrow(/一個帳號同時只能擔任一個地區的有效顧問/);
  });

  it("解除綁定（userId=null）不受此限制", async () => {
    // 用一個從未綁定過的全新測試使用者驗證解除綁定路徑本身不受影響。
    const tempUserId = await ensureTestUser(`test-upgrade-region-unbind-${runId}`, "解綁測試帳號");
    try {
      await expect(db.bindConsultantUser(centralConsultant!.id, tempUserId)).resolves.toBeUndefined();
      await expect(db.bindConsultantUser(centralConsultant!.id, null)).resolves.toBeUndefined();
    } finally {
      // 還原 central 綁定，避免影響其他測試
      await db.bindConsultantUser(centralConsultant!.id, centralUserId);
      await deleteTestUser(tempUserId);
    }
  });
});

// ── 6. 最後更新者／更新時間／承辦顧問顯示名稱 ─────────────────────────────
describe("案件 mutation 的最後更新者記錄 與 承辦顧問顯示名稱", () => {
  it("顧問呼叫 updateCaseNotes 後，lastUpdatedByUserId／lastUpdatedByNameSnapshot 會更新為該顧問", async () => {
    const caseId = await createTestCase({ companyName: "更新者測試-顧問", location: "台北市", status: "evaluating", assignedConsultantId: northConsultant!.id });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await caller.upgradeConsultant.updateCaseNotes({ applicationId: caseId, notes: "顧問備註" });
      const app = await db.getUpgradeApplicationById(caseId);
      expect(app?.lastUpdatedByUserId).toBe(northUserId);
      expect(app?.lastUpdatedByNameSnapshot).toBe("北部測試顧問");
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("管理員呼叫 updateCaseStatus 後，lastUpdatedByNameSnapshot 顯示管理員名稱而非顧問名稱", async () => {
    const caseId = await createTestCase({ companyName: "更新者測試-管理員", location: "台北市", status: "evaluating", assignedConsultantId: northConsultant!.id });
    try {
      const admin = appRouter.createCaller(adminCtx());
      await admin.upgradeConsultant.updateCaseStatus({ applicationId: caseId, nextStatus: "ineligible" });
      const app = await db.getUpgradeApplicationById(caseId);
      expect(app?.lastUpdatedByUserId).toBe(1); // adminCtx() 使用 id=1
      expect(app?.lastUpdatedByNameSnapshot).toBe("Test User");
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("updateCaseAmounts／acknowledge／upgradeCenter.adminUpdateStatus 也都會記錄最後更新者", async () => {
    const amountsCase = await createTestCase({ companyName: "更新者測試-金額", location: "台北市", status: "accepted", assignedConsultantId: northConsultant!.id });
    const ackCase = await createTestCase({ companyName: "更新者測試-查收", location: "台北市", status: "new", assignedConsultantId: northConsultant!.id });
    const adminUpdateCase = await createTestCase({ companyName: "更新者測試-admin更新", location: "台北市", status: "evaluating", assignedConsultantId: null });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      await caller.upgradeConsultant.updateCaseAmounts({ applicationId: amountsCase, plannedSubsidyAmount: 500000 });
      const amountsApp = await db.getUpgradeApplicationById(amountsCase);
      expect(amountsApp?.lastUpdatedByUserId).toBe(northUserId);

      await caller.upgradeConsultant.acknowledge({ applicationId: ackCase });
      const ackApp = await db.getUpgradeApplicationById(ackCase);
      expect(ackApp?.lastUpdatedByUserId).toBe(northUserId);

      const admin = appRouter.createCaller(adminCtx());
      await admin.upgradeCenter.adminUpdateStatus({ id: adminUpdateCase, status: "ineligible" });
      const adminApp = await db.getUpgradeApplicationById(adminUpdateCase);
      expect(adminApp?.lastUpdatedByUserId).toBe(1);
    } finally {
      await deleteTestCase(amountsCase);
      await deleteTestCase(ackCase);
      await deleteTestCase(adminUpdateCase);
    }
  });

  it("myCases／upgradeCenter.adminList 回傳的案件帶有 assignedConsultantUserName（由真實關聯 join 取得，非案件地區字串）", async () => {
    const caseId = await createTestCase({ companyName: "承辦顧問測試", location: "台北市", status: "evaluating", assignedConsultantId: northConsultant!.id });
    try {
      const caller = appRouter.createCaller(userCtx(northUserId, "北部測試顧問"));
      const { items } = await caller.upgradeConsultant.myCases({ limit: 200, offset: 0 });
      const item = items.find(i => i.id === caseId);
      expect(item).toBeTruthy();
      expect((item as { assignedConsultantUserName?: string | null })?.assignedConsultantUserName).toBe("北部測試顧問");
      // 不可以是案件地區字串
      expect((item as { assignedConsultantUserName?: string | null })?.assignedConsultantUserName).not.toBe("台北市");

      const admin = appRouter.createCaller(adminCtx());
      const adminResult = await admin.upgradeCenter.adminList({ limit: 200, offset: 0 });
      const adminItem = adminResult.items.find(i => i.id === caseId);
      expect((adminItem as { assignedConsultantUserName?: string | null })?.assignedConsultantUserName).toBe("北部測試顧問");
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("未指派顧問的案件，assignedConsultantUserName 為 null（前端顯示「尚未指派」）", async () => {
    const caseId = await createTestCase({ companyName: "未指派測試", location: "台北市", status: "new", assignedConsultantId: null });
    try {
      const admin = appRouter.createCaller(adminCtx());
      const result = await admin.upgradeCenter.adminList({ limit: 200, offset: 0 });
      const item = result.items.find(i => i.id === caseId);
      expect((item as { assignedConsultantUserName?: string | null })?.assignedConsultantUserName ?? null).toBeNull();
    } finally {
      await deleteTestCase(caseId);
    }
  });

  it("從未被本次邏輯更新過的舊案件：lastUpdatedByUserId 為 null、lastUpdatedByNameSnapshot 為空字串（不可猜測，視為「尚無更新紀錄」）", async () => {
    const caseId = await createTestCase({ companyName: "舊案件測試", location: "台北市", status: "new", assignedConsultantId: null });
    try {
      const app = await db.getUpgradeApplicationById(caseId);
      expect(app?.lastUpdatedByUserId ?? null).toBeNull();
      expect(app?.lastUpdatedByNameSnapshot).toBe("");
    } finally {
      await deleteTestCase(caseId);
    }
  });
});

// ── 7. adminGetUpgradeStats 涵蓋 deferred 統計 ────────────────────────────
describe("adminGetUpgradeStats: 回傳緩追區數量統計", () => {
  it("回傳物件包含頂層 deferred 與 byRegion[region].deferred 欄位", async () => {
    const caseId = await createTestCase({ companyName: "統計測試-緩追", location: "台北市", status: "deferred", assignedConsultantId: northConsultant!.id });
    try {
      const stats = await db.adminGetUpgradeStats();
      expect(typeof stats.deferred).toBe("number");
      expect(stats.deferred).toBeGreaterThanOrEqual(1);
      expect(stats.byRegion.north).toBeTruthy();
      expect(typeof stats.byRegion.north!.deferred).toBe("number");
      expect(stats.byRegion.north!.deferred).toBeGreaterThanOrEqual(1);
    } finally {
      await deleteTestCase(caseId);
    }
  });
});

// ── 8. 前端原始碼內容斷言：頁面順序、緩追區操作、顯示 fallback ────────────
describe("client/src/pages/ConsultantCases.tsx: 緩追區 UI 與顯示 fallback", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "client", "src", "pages", "ConsultantCases.tsx"),
    "utf-8"
  );

  it("TAB_ORDER 順序為 資格不符 → 緩追區 → 已立案處理", () => {
    const tabOrderMatch = source.match(/const TAB_ORDER = \[[\s\S]*?\];/);
    expect(tabOrderMatch, "找不到 TAB_ORDER").not.toBeNull();
    const block = tabOrderMatch![0];
    const ineligibleIdx = block.indexOf('key: "ineligible"');
    const deferredIdx = block.indexOf('key: "deferred"');
    const acceptedIdx = block.indexOf('key: "accepted"');
    expect(ineligibleIdx).toBeGreaterThan(-1);
    expect(deferredIdx).toBeGreaterThan(ineligibleIdx);
    expect(acceptedIdx).toBeGreaterThan(deferredIdx);
  });

  it("評估中操作區有「移至緩追區」按鈕，呼叫 nextStatus: deferred", () => {
    expect(source).toMatch(/移至緩追區/);
    expect(source).toMatch(/nextStatus: "deferred"/);
  });

  it("緩追區狀態有「重新評估」操作，呼叫 nextStatus: evaluating", () => {
    expect(source).toMatch(/重新評估/);
    expect(source).toMatch(/eff === "deferred"/);
  });

  it("承辦顧問／最後更新者顯示區塊含正確 fallback 文字", () => {
    expect(source).toMatch(/item\.assignedConsultantUserName \?\? "尚未指派"/);
    expect(source).toMatch(/"尚無更新紀錄"/);
  });

  it("最後更新時間格式化函式固定使用 Asia/Taipei 時區", () => {
    const fnMatch = source.match(/function fmtTaipeiDateTime[\s\S]*?\n\}/);
    expect(fnMatch, "找不到 fmtTaipeiDateTime").not.toBeNull();
    expect(fnMatch![0]).toMatch(/timeZone: "Asia\/Taipei"/);
  });
});

describe("client/src/pages/AdminUpgradeApplications.tsx: 緩追區 UI 與顯示 fallback", () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "client", "src", "pages", "AdminUpgradeApplications.tsx"),
    "utf-8"
  );

  it("STATUSES 中 deferred 位於 ineligible 與 accepted 之間", () => {
    const ineligibleIdx = source.indexOf('value: "ineligible"');
    const deferredIdx = source.indexOf('value: "deferred"');
    const acceptedIdx = source.indexOf('value: "accepted"');
    expect(ineligibleIdx).toBeGreaterThan(-1);
    expect(deferredIdx).toBeGreaterThan(ineligibleIdx);
    expect(acceptedIdx).toBeGreaterThan(deferredIdx);
  });

  it("承辦顧問／最後更新者顯示區塊含正確 fallback 文字", () => {
    expect(source).toMatch(/item\.assignedConsultantUserName \?\? "尚未指派"/);
    expect(source).toMatch(/"尚無更新紀錄"/);
  });
});
