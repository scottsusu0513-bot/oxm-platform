/**
 * 管理員工廠審核操作（下架／刪除）＋工廠聯絡備註 CRM 功能整合測試。
 * 對應任務規則：已批准工廠不可再出現拒絕／批准、下架與刪除的語意差異、
 * contactStatus／adminNote 的預設值／CRUD／篩選、以及 admin-only 權限保護
 * （尤其是 public API 絕不能洩漏 adminNote／contactStatus）。
 *
 * 走真實本機測試 DB（見 server/test-db-guard.ts，只允許 oxm_test），透過
 * appRouter.createCaller 直接呼叫 tRPC procedure，不啟動實際 HTTP server。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const isAdmin = overrides?.role === "admin";
  // isAdminUser()（server/_core/admin.ts）在本機測試環境只透過
  // ADMIN_WHITELIST_EMAILS（見 .env）判定管理員——本機沒有設定 OWNER_OPEN_ID，
  // 所以其他測試檔案慣用的特殊 openId 寫法在這個環境不會生效。這裡直接用
  // .env 裡實際設定的白名單 email，讓管理員測試在本機能得到真實的通過/失敗訊號。
  const user: AuthenticatedUser = {
    id: 1,
    openId: isAdmin ? "admin-crm-test-admin" : "test-user-1",
    email: isAdmin ? "scottsusu0513@gmail.com" : "test@example.com",
    name: "Test User",
    loginMethod: isAdmin ? "google" : "manus",
    role: "user",
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

const adminCtx = createAuthContext({ role: "admin" });
const adminCaller = appRouter.createCaller(adminCtx);
const userCtx = createAuthContext({ role: "user" });
const userCaller = appRouter.createCaller(userCtx);
const publicCaller = appRouter.createCaller(createPublicContext());

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let ownerIds: number[] = [];
let fDelistCycleId: number;
let fDeleteFlowId: number;
let fDeleteGuardId: number; // pending — never touched by delist/delete
let fContactCrmId: number;

beforeAll(async () => {
  const o1 = await ensureTestUser(`admin-crm-o1-${runId}`, "CRM測試A");
  const o2 = await ensureTestUser(`admin-crm-o2-${runId}`, "CRM測試B");
  const o3 = await ensureTestUser(`admin-crm-o3-${runId}`, "CRM測試C");
  const o4 = await ensureTestUser(`admin-crm-o4-${runId}`, "CRM測試D");
  ownerIds = [o1, o2, o3, o4];

  fDelistCycleId = await createTestFactory(o1, `CRM下架循環-${runId}`, "approved");
  fDeleteFlowId = await createTestFactory(o2, `CRM刪除流程-${runId}`, "approved");
  fDeleteGuardId = await createTestFactory(o3, `CRM刪除防呆-${runId}`, "pending");
  fContactCrmId = await createTestFactory(o4, `CRM聯絡備註-${runId}`, "approved");
});

afterAll(async () => {
  await deleteTestFactory(fDelistCycleId);
  await deleteTestFactory(fDeleteFlowId);
  await deleteTestFactory(fDeleteGuardId);
  await deleteTestFactory(fContactCrmId);
  for (const id of ownerIds) await deleteTestUser(id);
});

describe("已批准工廠審核操作：下架／重新上架", () => {
  it("非 approved 工廠不能下架（伺服器端防呆，對應 UI 只在 approved 工廠顯示下架按鈕）", async () => {
    await expect(adminCaller.admin.delistFactory({ factoryId: fDeleteGuardId })).rejects.toThrow(/已批准/);
  });

  it("approved 工廠下架成功，狀態變成 delisted", async () => {
    const result = await adminCaller.admin.delistFactory({ factoryId: fDelistCycleId });
    expect(result).toEqual({ success: true });
    const raw = await db.getFactoryById(fDelistCycleId);
    expect(raw?.status).toBe("delisted");
  });

  it("下架不會刪除工廠 DB 紀錄", async () => {
    const raw = await db.getFactoryById(fDelistCycleId);
    expect(raw).not.toBeNull();
    expect(raw?.deletedAt).toBeNull();
  });

  it("下架後不出現在公開 factory.search（依 keyword 精確比對）", async () => {
    const result = await publicCaller.factory.search({ keyword: `CRM下架循環-${runId}`, page: 1, pageSize: 10 });
    expect(result.items.find((f: any) => f.id === fDelistCycleId)).toBeUndefined();
  });

  it("下架後公開 factory.getById 回傳 null（比照既有 draft/pending/rejected 行為）", async () => {
    const result = await publicCaller.factory.getById({ id: fDelistCycleId });
    expect(result).toBeNull();
  });

  it("下架後管理員仍可在工廠列表找到（status='delisted' 篩選）", async () => {
    const result = await adminCaller.admin.getFactories({ page: 1, pageSize: 50, status: "delisted" });
    expect(result.items.some((f: any) => f.id === fDelistCycleId)).toBe(true);
  });

  it("重新上架（沿用 approveFactory）：狀態回到 approved，重新出現在公開頁", async () => {
    await adminCaller.admin.approveFactory({ factoryId: fDelistCycleId });
    const raw = await db.getFactoryById(fDelistCycleId);
    expect(raw?.status).toBe("approved");
    const publicResult = await publicCaller.factory.getById({ id: fDelistCycleId });
    expect(publicResult).not.toBeNull();
  });
});

describe("已批准工廠審核操作：刪除（軟刪除）", () => {
  let reviewId: number;

  beforeAll(async () => {
    // 造一筆掛在 fDeleteFlowId 底下的評價，驗證軟刪除不會波及關聯資料。
    const reviewerId = await ensureTestUser(`admin-crm-reviewer-${runId}`, "CRM測試評價者");
    ownerIds.push(reviewerId);
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [result] = await conn.execute(sql`
      INSERT INTO reviews (factoryId, userId, rating, comment, createdAt, updatedAt)
      VALUES (${fDeleteFlowId}, ${reviewerId}, 5, ${"軟刪除保留測試"}, NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];
    reviewId = result.insertId;
  });

  it("非 approved／delisted 工廠不能刪除（伺服器端防呆）", async () => {
    await expect(adminCaller.admin.deleteFactory({ factoryId: fDeleteGuardId })).rejects.toThrow(/已批准或已下架/);
  });

  it("approved 工廠可以軟刪除：status 變 delisted 且 deletedAt 被標記", async () => {
    const result = await adminCaller.admin.deleteFactory({ factoryId: fDeleteFlowId });
    expect(result).toEqual({ success: true });
    const raw = await db.getFactoryById(fDeleteFlowId);
    expect(raw?.status).toBe("delisted");
    expect(raw?.deletedAt).not.toBeNull();
  });

  it("軟刪除不會造成 orphan data：關聯的 review 紀錄仍然存在", async () => {
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const [rows] = await conn.execute(sql`SELECT id FROM reviews WHERE id = ${reviewId}`) as unknown as [{ id: number }[], unknown];
    expect(rows.length).toBe(1);
  });

  it("軟刪除後從管理員預設工廠列表隱藏（即使不帶 status 篩選）", async () => {
    const result = await adminCaller.admin.getFactories({ page: 1, pageSize: 50, search: `CRM刪除流程-${runId}` });
    expect(result.items.find((f: any) => f.id === fDeleteFlowId)).toBeUndefined();
  });

  it("軟刪除後公開端也找不到", async () => {
    const result = await publicCaller.factory.getById({ id: fDeleteFlowId });
    expect(result).toBeNull();
  });

  it("重複刪除同一筆已刪除工廠會失敗（deletedAt 已存在，不可覆蓋）", async () => {
    await expect(adminCaller.admin.deleteFactory({ factoryId: fDeleteFlowId })).rejects.toThrow(/已被刪除/);
  });
});

describe("聯絡狀態 contactStatus 與管理員備註 adminNote", () => {
  it("新工廠預設 contactStatus 為 not_called（灰色／尚未聯絡）", async () => {
    const raw = await db.getFactoryById(fContactCrmId);
    expect(raw?.contactStatus).toBe("not_called");
    expect(raw?.adminNote).toBeNull();
  });

  it("admin 可以更新 contactStatus 與 adminNote", async () => {
    await adminCaller.admin.updateFactoryContactInfo({
      factoryId: fContactCrmId,
      contactStatus: "follow_up",
      adminNote: "8/13 已致電，老闆不在，下週再打",
    });
    const raw = await db.getFactoryById(fContactCrmId);
    expect(raw?.contactStatus).toBe("follow_up");
    expect(raw?.adminNote).toBe("8/13 已致電，老闆不在，下週再打");
  });

  it("可以再改成 not_interested", async () => {
    await adminCaller.admin.updateFactoryContactInfo({ factoryId: fContactCrmId, contactStatus: "not_interested" });
    const raw = await db.getFactoryById(fContactCrmId);
    expect(raw?.contactStatus).toBe("not_interested");
    // 只更新 contactStatus，未帶 adminNote 時不應清空既有備註
    expect(raw?.adminNote).toBe("8/13 已致電，老闆不在，下週再打");
  });

  it("可以清空備註（傳入 null）", async () => {
    await adminCaller.admin.updateFactoryContactInfo({ factoryId: fContactCrmId, adminNote: null });
    const raw = await db.getFactoryById(fContactCrmId);
    expect(raw?.adminNote).toBeNull();
    // 清空備註不應影響 contactStatus
    expect(raw?.contactStatus).toBe("not_interested");
  });

  it("admin.getFactories 的 contactStatus 篩選可與其他條件（search）組合", async () => {
    await adminCaller.admin.updateFactoryContactInfo({ factoryId: fContactCrmId, contactStatus: "follow_up" });
    const matched = await adminCaller.admin.getFactories({
      page: 1, pageSize: 50,
      search: `CRM聯絡備註-${runId}`,
      contactStatus: "follow_up",
    });
    expect(matched.items.some((f: any) => f.id === fContactCrmId)).toBe(true);

    const notMatched = await adminCaller.admin.getFactories({
      page: 1, pageSize: 50,
      search: `CRM聯絡備註-${runId}`,
      contactStatus: "not_called",
    });
    expect(notMatched.items.find((f: any) => f.id === fContactCrmId)).toBeUndefined();
  });

  it("一般使用者不能呼叫 admin.updateFactoryContactInfo／delistFactory／deleteFactory", async () => {
    await expect(userCaller.admin.updateFactoryContactInfo({ factoryId: fContactCrmId, contactStatus: "follow_up" })).rejects.toThrow();
    await expect(userCaller.admin.delistFactory({ factoryId: fContactCrmId })).rejects.toThrow();
    await expect(userCaller.admin.deleteFactory({ factoryId: fContactCrmId })).rejects.toThrow();
  });

  it("公開 factory.getById 絕不包含 adminNote／contactStatus", async () => {
    const result: any = await publicCaller.factory.getById({ id: fContactCrmId });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("adminNote");
    expect(result).not.toHaveProperty("contactStatus");
  });

  it("公開 factory.search 結果絕不包含 adminNote／contactStatus", async () => {
    const result = await publicCaller.factory.search({ keyword: `CRM聯絡備註-${runId}`, page: 1, pageSize: 10 });
    const match = result.items.find((f: any) => f.id === fContactCrmId) as any;
    expect(match).toBeDefined();
    expect(match).not.toHaveProperty("adminNote");
    expect(match).not.toHaveProperty("contactStatus");
  });

  it("工廠 owner 自己的 factory.getMine 也絕不包含 adminNote／contactStatus", async () => {
    const factory = await db.getFactoryById(fContactCrmId);
    expect(factory).not.toBeUndefined();
    const ownerCtx = createAuthContext({ id: factory!.ownerId, role: "user" });
    const ownerCaller = appRouter.createCaller(ownerCtx);
    const result: any = await ownerCaller.factory.getMine();
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("adminNote");
    expect(result).not.toHaveProperty("contactStatus");
  });

  it("admin.getFactoryDetail（管理員專用）可以看到 adminNote／contactStatus", async () => {
    const result: any = await adminCaller.admin.getFactoryDetail({ id: fContactCrmId });
    expect(result).toHaveProperty("adminNote");
    expect(result).toHaveProperty("contactStatus");
  });
});
