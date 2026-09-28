/**
 * 工廠主「刪除工廠」＝軟刪除（Production Hardening Batch 2）— 整合測試，
 * 真的走本機測試資料庫與 appRouter.createCaller。
 *
 * 修正前 factory.delete 逐表物理刪除訊息／對話／商品／評價／廣告／工廠本體，
 * 且 collaborationOrders 等以 ON DELETE CASCADE 參照 factories——工廠主刪除
 * 工廠會抹掉買家的對話、交易紀錄與評價。修正後只標記 status='delisted' +
 * deletedAt，所有歷史資料保留，工廠從此不再公開。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";
import { ENV } from "./_core/env";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_INDUSTRY = `FODL_TEST_${runId}`;
const userIds: number[] = [];
let ownerId = 0, buyerId = 0, coManagerId = 0, adminId = 0;
let factoryId = 0, productId = 0, reviewId = 0, conversationId = 0, orderId = 0;
const messageIds: number[] = [];

async function mkUser(label: string): Promise<number> {
  const id = await ensureTestUser(`fodl-${label}-${runId}`, `刪除生命週期-${label}`);
  userIds.push(id);
  return id;
}

// adminProcedure 以真正的白名單（isAdminUser）判定，沿用既有測試慣例使用
// .env 的 ADMIN_WHITELIST_EMAILS 第一筆作為 admin context 的 email。
const ADMIN_EMAIL = ENV.adminWhitelistEmails[0] ?? "";

function ctx(userId: number | null, isAdmin = false): TrpcContext {
  const user = userId === null ? null : ({
    id: userId, openId: `fodl-ctx-${userId}`, email: isAdmin ? ADMIN_EMAIL : `fodl-ctx-${userId}@example.test`, name: "FODL",
    role: isAdmin ? "admin" : "user", isAdmin, isFactoryOwner: userId === ownerId,
    primaryEmail: `fodl-ctx-${userId}@example.test`, primaryEmailVerifiedAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as unknown as NonNullable<TrpcContext["user"]>);
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}
const caller = (userId: number | null, isAdmin = false) => appRouter.createCaller(ctx(userId, isAdmin));

async function count(table: string, where: ReturnType<typeof sql>): Promise<number> {
  const conn = (await db.getDb())!;
  const [rows] = (await conn.execute(sql`SELECT COUNT(*) AS n FROM ${sql.raw(table)} WHERE ${where}`)) as unknown as [{ n: number }[], unknown];
  return Number(rows[0].n);
}

beforeAll(async () => {
  const conn = (await db.getDb())!;
  ownerId = await mkUser("owner");
  buyerId = await mkUser("buyer");
  coManagerId = await mkUser("co");
  adminId = await mkUser("admin");
  await conn.execute(sql`UPDATE users SET isFactoryOwner = TRUE WHERE id = ${ownerId}`);

  const [f] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${`FODL-${runId}`}, ${JSON.stringify([TEST_INDUSTRY])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", "FODL 測試地址", "approved", "normal", FALSE, "[]", NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  factoryId = f.insertId;
  await conn.execute(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${coManagerId}, ${ownerId})`);
  productId = await db.createProduct({ factoryId, name: `FODL 商品 ${runId}`, acceptSmallOrder: false, provideSample: false });
  const [r] = (await conn.execute(sql`INSERT INTO reviews (factoryId, userId, rating, comment) VALUES (${factoryId}, ${buyerId}, 4, "歷史評價")`)) as unknown as [{ insertId: number }, unknown];
  reviewId = r.insertId;
  const [cv] = (await conn.execute(sql`INSERT INTO conversations (userId, factoryId, lastMessageAt) VALUES (${buyerId}, ${factoryId}, NOW())`)) as unknown as [{ insertId: number }, unknown];
  conversationId = cv.insertId;
  for (const [senderId, role, content] of [[buyerId, "user", "請問可以報價嗎"], [ownerId, "factory", "可以，稍後提供"]] as const) {
    const [m] = (await conn.execute(sql`INSERT INTO messages (conversationId, senderId, senderRole, content) VALUES (${conversationId}, ${senderId}, ${role}, ${content})`)) as unknown as [{ insertId: number }, unknown];
    messageIds.push(m.insertId);
  }
  const [o] = (await conn.execute(sql`
    INSERT INTO collaborationOrders (conversationId, factoryId, buyerUserId, createdByUserId, projectName, description, status)
    VALUES (${conversationId}, ${factoryId}, ${buyerId}, ${ownerId}, "FODL 合作案", "歷史合作確認單", "accepted")
  `)) as unknown as [{ insertId: number }, unknown];
  orderId = o.insertId;
}, 120000);

afterAll(async () => {
  const conn = await db.getDb();
  if (conn && factoryId) await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
  for (const id of userIds) await deleteTestUser(id);
}, 120000);

describe("factory.delete 權限", () => {
  it("co-manager 不能刪除整間工廠（維持既有權限）", async () => {
    await expect(caller(coManagerId).factory.delete({ id: factoryId })).rejects.toThrow(/無權限刪除此工廠/);
  });
  it("一般買家不能刪除", async () => {
    await expect(caller(buyerId).factory.delete({ id: factoryId })).rejects.toThrow(/無權限刪除此工廠/);
  });
  it("刪除前確認：工廠公開、出現在搜尋", async () => {
    expect(await caller(null).factory.getById({ id: factoryId })).not.toBeNull();
    const res = await caller(null).factory.search({ industry: [TEST_INDUSTRY], pageSize: 10 });
    expect(res.items.map(x => x.id)).toContain(factoryId);
  });
});

describe("owner 執行 factory.delete → 軟刪除，歷史資料全部保留", () => {
  beforeAll(async () => {
    await caller(ownerId).factory.delete({ id: factoryId });
  });

  it("工廠列仍存在：status=delisted、deletedAt 有值", async () => {
    const f = await db.getFactoryById(factoryId);
    expect(f).toBeTruthy();
    expect(f!.status).toBe("delisted");
    expect(f!.deletedAt).not.toBeNull();
  });

  it("對話、訊息、評價、合作確認單、商品全部還在", async () => {
    expect(await count("conversations", sql`id = ${conversationId}`)).toBe(1);
    expect(await count("messages", sql`conversationId = ${conversationId}`)).toBe(messageIds.length);
    expect(await count("reviews", sql`id = ${reviewId}`)).toBe(1);
    expect(await count("collaborationOrders", sql`id = ${orderId}`)).toBe(1);
    expect(await count("products", sql`id = ${productId}`)).toBe(1);
  });

  // Batch 2.5：帳號仍擁有這間（已封存的）工廠，isFactoryOwner 保留，Navbar
  // 才會繼續顯示「工廠後台」，讓工廠主看到封存狀態與「申請重新上架」。
  it("owner 的 isFactoryOwner 旗標保留（仍擁有已封存的工廠）", async () => {
    const u = await db.getUserById(ownerId);
    expect(u?.isFactoryOwner).toBe(true);
  });

  it("重複刪除 → 明確錯誤，不覆蓋第一次的 deletedAt", async () => {
    const before = (await db.getFactoryById(factoryId))!.deletedAt;
    await expect(caller(ownerId).factory.delete({ id: factoryId })).rejects.toThrow(/已刪除/);
    expect((await db.getFactoryById(factoryId))!.deletedAt).toEqual(before);
  });

  it("公開搜尋不再出現", async () => {
    const res = await caller(null).factory.search({ industry: [TEST_INDUSTRY], pageSize: 10 });
    expect(res.items.map(x => x.id)).not.toContain(factoryId);
  });

  it("公開 getById 與從屬 API（anonymous／buyer）都拿不到", async () => {
    for (const c of [caller(null), caller(buyerId)]) {
      expect(await c.factory.getById({ id: factoryId })).toBeNull();
      expect(await c.product.getByFactory({ factoryId })).toEqual([]);
      expect(await c.product.getById({ id: productId })).toBeUndefined();
      expect((await c.review.getByFactory({ factoryId })).items).toEqual([]);
    }
  });

  it("owner／co-manager／admin 仍可查到管理資料", async () => {
    for (const c of [caller(ownerId), caller(coManagerId), caller(adminId, true)]) {
      expect((await c.factory.getById({ id: factoryId }))?.id).toBe(factoryId);
      expect((await c.product.getByFactory({ factoryId })).map(p => p.id)).toContain(productId);
    }
  });

  it("買家既有對話：仍可讀取歷史訊息", async () => {
    const res = await caller(buyerId).chat.getMessages({ conversationId });
    const ids = (Array.isArray(res) ? res : (res as { messages?: { id: number }[]; items?: { id: number }[] }).messages ?? (res as { items?: { id: number }[] }).items ?? []).map((m: { id: number }) => m.id);
    for (const id of messageIds) expect(ids).toContain(id);
  });

  it("買家既有對話：chat.getOrCreate 仍回傳原本那一筆（不因下架中斷）", async () => {
    const conv = await caller(buyerId).chat.getOrCreate({ factoryId });
    expect(conv?.id).toBe(conversationId);
  });

  // Batch 2.5 產品規則：已下架／封存工廠的歷史對話可讀、不可再傳訊。
  it("買家既有對話：只供查看，不能再傳送訊息", async () => {
    await expect(caller(buyerId).chat.send({ conversationId, content: "工廠下架後的追問" }))
      .rejects.toThrow(/此對話僅供查看歷史紀錄/);
    expect(await count("messages", sql`conversationId = ${conversationId}`)).toBe(messageIds.length);
  });

  it("其他買家不能對已刪除工廠開新對話", async () => {
    const otherBuyer = await mkUser("other-buyer");
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE users SET primaryEmailVerifiedAt = NOW() WHERE id = ${otherBuyer}`);
    await expect(caller(otherBuyer).chat.getOrCreate({ factoryId })).rejects.toThrow(/此工廠目前無法接受新詢問/);
  });

  it("admin 不能把已軟刪除的工廠直接核准回 approved（避免 approved＋deletedAt 矛盾狀態）", async () => {
    await expect(caller(adminId, true).admin.approveFactory({ factoryId })).rejects.toThrow(/已刪除/);
    expect((await db.getFactoryById(factoryId))!.status).toBe("delisted");
  });
});
