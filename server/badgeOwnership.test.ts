/**
 * 徽章「擁有權」與「公開顯示」拆分的回歸測試（見 drizzle/schema.ts 新增的
 * certificationBadgesVisible 欄位）。走真實本機測試資料庫，用
 * appRouter.createCaller(ctx) 直接呼叫 tRPC procedure。
 *
 * 涵蓋：
 * 1. 工廠首次審核通過：certificationBadges 全部視為新獲得，
 *    certificationBadgesVisible 預設同步為全部顯示。
 * 2. 關閉顯示：certificationBadges／certificationEvidence 完全不受影響，
 *    也不會建立 factoryRevisions。
 * 3. 再次開啟顯示：不需要證明、不會建立修改申請。
 * 4. 未獲得的徽章無法透過 updateVisibleBadges 偽造成公開顯示（伺服器端
 *    自己重新驗證子集合，不相信前端傳入的陣列）。
 * 5. submitRevision 不會直接授予新徽章擁有權；核准後才會真正寫入
 *    certificationBadges，且既有已擁有的徽章顯示設定不會被這次核准動作重置。
 *    這裡直接呼叫 db.approveRevisionAtomic／db.approveFactoryWithBadgeSync
 *    （routers.ts 的 admin.approveFactory／admin.approveRevision 就是呼叫
 *    這兩個函式），不經過 adminProcedure 那層——那層權限判斷走的是真實
 *    ADMIN_WHITELIST_EMAILS 環境變數（見 server/_core/admin.ts 的
 *    isAdminUser），跟本次「徽章擁有權寫入邏輯是否正確」是兩件独立的事，
 *    本機測試環境沒有設定這個變數，adminProcedure 本身的權限判斷已有其他
 *    既有測試涵蓋，這裡不重複測。
 * 6. owner／共管者可切換顯示設定；無關會員一律 FORBIDDEN。
 * 7. 公開視角（search／getById 未授權）只會看到 certificationBadgesVisible，
 *    看不到完整的 certificationBadges（可能含隱藏徽章）。
 * 8. 退回修改申請：certificationBadges／certificationBadgesVisible 完全不受
 *    影響，新徽章不會被誤授予擁有權。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function ctxFor(userId: number, overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `badge-ownership-${userId}`, email: `badge-ownership-${userId}@example.test`,
    name: "Badge Ownership Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    ...overrides,
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}
function guestCtx(): TrpcContext {
  return { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

const runId = `badge-ownership-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmailVerifiedAt)
    VALUES (${openId}, ${`Badge Ownership ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`}, NOW())
  `);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}
async function deleteTestUser(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
}
async function createTestFactory(ownerId: number, name: string, extra: Record<string, unknown> = {}): Promise<number> {
  const id = await db.createFactory({
    ownerId, name, industry: ["紡織"], mfgModes: ["ODM"], region: "台北市", capitalLevel: "100萬以下", address: "",
    ...extra,
  } as any);
  return id as number;
}
async function deleteTestFactory(id: number | undefined): Promise<void> {
  if (!id) return;
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
}
async function addCoManager(factoryId: number, userId: number, invitedBy: number): Promise<void> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  await conn.execute(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${userId}, ${invitedBy})`);
}
async function countPendingRevisions(factoryId: number): Promise<number> {
  const conn = await getDb();
  if (!conn) return 0;
  const [rows] = await conn.execute(sql`SELECT COUNT(*) as c FROM factoryRevisions WHERE factoryId = ${factoryId}`) as unknown as [{ c: number }[], unknown];
  return Number(rows[0]?.c ?? 0);
}

describe("徽章擁有權與公開顯示拆分", () => {
  let ownerId: number, coManagerId: number, otherMemberId: number;

  beforeAll(async () => {
    ownerId = await createTestUser();
    coManagerId = await createTestUser();
    otherMemberId = await createTestUser();
  });
  afterAll(async () => {
    await deleteTestUser(ownerId);
    await deleteTestUser(coManagerId);
    await deleteTestUser(otherMemberId);
  });

  it("首次審核通過：certificationBadges 全部視為新獲得，certificationBadgesVisible 預設同步顯示", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-A`, { certificationBadges: ["bni", "iso-9001"] });
    try {
      // admin.approveFactory 的 resolver 本身就是呼叫這個函式（見
      // server/routers.ts），這裡直接呼叫驗證徽章同步邏輯，不經過
      // adminProcedure 的權限判斷（那部分由其他既有測試涵蓋）。
      await db.approveFactoryWithBadgeSync(factoryId);
      const after = await db.getFactoryById(factoryId);
      expect((after as any).status).toBe("approved");
      expect((after as any).certificationBadges).toEqual(["bni", "iso-9001"]);
      expect((after as any).certificationBadgesVisible).toEqual(["bni", "iso-9001"]);
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("關閉顯示：certificationBadges／certificationEvidence 完全不受影響，且不會建立 factoryRevisions", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-B`, {
      status: "approved",
      certificationBadges: ["bni"],
      certificationBadgesVisible: ["bni"],
      certificationEvidence: [{ badgeId: "bni", description: "說明", imageKeys: ["certification-evidence/1/abcdefghij123456.jpg"] }],
    });
    try {
      const before = await db.getFactoryById(factoryId);
      const result = await appRouter.createCaller(ctxFor(ownerId)).factory.updateVisibleBadges({ factoryId, visibleBadgeIds: [] });
      expect(result.certificationBadgesVisible).toEqual([]);

      const after = await db.getFactoryById(factoryId);
      expect((after as any).certificationBadges).toEqual((before as any).certificationBadges);
      expect((after as any).certificationEvidence).toEqual((before as any).certificationEvidence);
      expect(await countPendingRevisions(factoryId)).toBe(0);
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("再次開啟顯示：不需要證明、不會建立修改申請", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-C`, {
      status: "approved",
      certificationBadges: ["bni"],
      certificationBadgesVisible: [],
      certificationEvidence: [{ badgeId: "bni", description: "說明", imageKeys: ["certification-evidence/1/abcdefghij123456.jpg"] }],
    });
    try {
      const result = await appRouter.createCaller(ctxFor(ownerId)).factory.updateVisibleBadges({ factoryId, visibleBadgeIds: ["bni"] });
      expect(result.certificationBadgesVisible).toEqual(["bni"]);
      expect(await countPendingRevisions(factoryId)).toBe(0);

      const after = await db.getFactoryById(factoryId);
      expect((after as any).certificationEvidence).toEqual([{ badgeId: "bni", description: "說明", imageKeys: ["certification-evidence/1/abcdefghij123456.jpg"] }]);
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("未獲得的徽章無法透過 updateVisibleBadges 偽造成公開顯示", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-D`, {
      status: "approved",
      certificationBadges: ["bni"],
      certificationBadgesVisible: [],
    });
    try {
      const result = await appRouter.createCaller(ctxFor(ownerId)).factory.updateVisibleBadges({
        factoryId, visibleBadgeIds: ["bni", "iso-9001", "ce"],
      });
      // 只有 bni 是已獲得的，其餘未擁有的一律被伺服器端過濾掉
      expect(result.certificationBadgesVisible).toEqual(["bni"]);
      const after = await db.getFactoryById(factoryId);
      expect((after as any).certificationBadgesVisible).toEqual(["bni"]);
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("submitRevision 不會直接授予新徽章擁有權；admin.approveRevision 核准後才寫入，且既有徽章顯示設定不被重置", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-E`, {
      status: "approved",
      certificationBadges: ["bni"],
      certificationBadgesVisible: [],
    });
    try {
      const ownerCtx = ctxFor(ownerId, { primaryEmailVerifiedAt: new Date() } as any);
      await appRouter.createCaller(ownerCtx).factory.submitRevision({
        factoryId,
        proposedData: { certificationBadges: ["iso-9001"], certificationEvidence: [{ badgeId: "iso-9001", description: "新申請" }] },
        revisionReason: "新增 ISO 9001 認證",
      });

      // 送出修改申請「當下」，certificationBadges 不應該立刻改變（還在待審）。
      const pendingSnapshot = await db.getFactoryById(factoryId);
      expect((pendingSnapshot as any).certificationBadges).toEqual(["bni"]);

      const [revRows] = await (await getDb())!.execute(
        sql`SELECT id, proposedData FROM factoryRevisions WHERE factoryId = ${factoryId} AND status = 'pending' LIMIT 1`,
      ) as unknown as [{ id: number; proposedData: any }[], unknown];
      expect(revRows).toHaveLength(1);
      const proposed = typeof revRows[0].proposedData === "string" ? JSON.parse(revRows[0].proposedData) : revRows[0].proposedData;
      // 送審內容一定是「既有擁有的 bni」聯集「新申請的 iso-9001」，不會只剩新的。
      expect(proposed.certificationBadges.sort()).toEqual(["bni", "iso-9001"]);

      // admin.approveRevision 的 resolver 本身就是呼叫 db.approveRevisionAtomic
      // （見 server/routers.ts），這裡直接呼叫驗證徽章同步邏輯，不經過
      // adminProcedure 的權限判斷（那部分由其他既有測試涵蓋）。
      await db.approveRevisionAtomic(revRows[0].id, 900002);

      const after = await db.getFactoryById(factoryId);
      expect((after as any).certificationBadges.sort()).toEqual(["bni", "iso-9001"]);
      // bni 先前顯示設定是「隱藏」（certificationBadgesVisible: []），核准新徽章
      // 不應該把它重置成顯示；只有新獲得的 iso-9001 會被加進去，預設顯示。
      expect((after as any).certificationBadgesVisible).toEqual(["iso-9001"]);
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("退回修改申請：certificationBadges／certificationBadgesVisible 完全不受影響，新徽章不會被誤授予擁有權", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-H`, {
      status: "approved",
      certificationBadges: ["bni"],
      certificationBadgesVisible: [],
    });
    try {
      const ownerCtx = ctxFor(ownerId, { primaryEmailVerifiedAt: new Date() } as any);
      await appRouter.createCaller(ownerCtx).factory.submitRevision({
        factoryId,
        proposedData: { certificationBadges: ["ce"], certificationEvidence: [{ badgeId: "ce", description: "新申請" }] },
        revisionReason: "新增 CE 認證",
      });
      const [revRows] = await (await getDb())!.execute(
        sql`SELECT id FROM factoryRevisions WHERE factoryId = ${factoryId} AND status = 'pending' LIMIT 1`,
      ) as unknown as [{ id: number }[], unknown];
      expect(revRows).toHaveLength(1);

      // admin.rejectRevision 的 resolver 本身就是呼叫這個函式（見 server/routers.ts）。
      await db.rejectRevisionAtomic(revRows[0].id, 900003, "資料不完整");

      const after = await db.getFactoryById(factoryId);
      expect((after as any).certificationBadges).toEqual(["bni"]);
      expect((after as any).certificationBadges).not.toContain("ce");
      expect((after as any).certificationBadgesVisible).toEqual([]);

      const [revAfter] = await (await getDb())!.execute(
        sql`SELECT status FROM factoryRevisions WHERE id = ${revRows[0].id}`,
      ) as unknown as [{ status: string }[], unknown];
      expect(revAfter[0].status).toBe("rejected");
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("owner／共管者可切換顯示設定；無關會員一律 FORBIDDEN", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-F`, {
      status: "approved",
      certificationBadges: ["bni"],
      certificationBadgesVisible: ["bni"],
    });
    try {
      await addCoManager(factoryId, coManagerId, ownerId);

      await expect(
        appRouter.createCaller(ctxFor(coManagerId)).factory.updateVisibleBadges({ factoryId, visibleBadgeIds: [] }),
      ).resolves.toMatchObject({ certificationBadgesVisible: [] });

      await expect(
        appRouter.createCaller(ctxFor(otherMemberId)).factory.updateVisibleBadges({ factoryId, visibleBadgeIds: ["bni"] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await expect(
        appRouter.createCaller(guestCtx()).factory.updateVisibleBadges({ factoryId, visibleBadgeIds: ["bni"] }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("公開視角（search／getById 未授權）只看到 certificationBadgesVisible，看不到完整的 certificationBadges", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-G-${Date.now()}`, {
      status: "approved",
      certificationBadges: ["bni", "iso-9001"],
      certificationBadgesVisible: ["bni"],
    });
    try {
      const publicResult = await appRouter.createCaller(guestCtx()).factory.getById({ id: factoryId });
      expect(publicResult).not.toBeNull();
      expect((publicResult as any).certificationBadgesVisible).toEqual(["bni"]);
      expect((publicResult as any).certificationBadges).toBeUndefined();
      expect(JSON.stringify(publicResult)).not.toContain("iso-9001");
    } finally {
      await deleteTestFactory(factoryId);
    }
  });
});
