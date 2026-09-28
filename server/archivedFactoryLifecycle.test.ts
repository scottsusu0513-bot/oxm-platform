/**
 * 工廠主封存（owner soft-delete）後的完整生命週期（Production Hardening
 * Batch 2.5）— 整合測試，真的走本機測試資料庫與 appRouter.createCaller。
 *
 * 產品規則：
 *   - 封存後原工廠保留，歷史評價／聊天／合作確認單全部保留且可讀。
 *   - 不得建立全新工廠（避免 刪除 → 重建 → 洗評價），只能「申請重新上架」。
 *   - 重新上架＝重新進入管理員審核：deletedAt 清空、status=pending，絕不直接 approved；
 *     送審完整度與產品數量驗證照常適用；只有 owner 本人可以申請。
 *   - 封存工廠不得繼續營運：編輯資料、商品、照片、邀請、新合作確認單、新對話都拒絕。
 *   - 既有對話：可讀，不可再傳訊（雙向）。
 *   - 封存工廠的 owner 可以接受其他工廠的次管理者邀請（原 ownership 保留）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_INDUSTRY = `AFL_TEST_${runId}`;
const ADMIN_EMAIL = ENV.adminWhitelistEmails[0] ?? "";
const userIds: number[] = [];
const factoryIds: number[] = [];

async function mkUser(label: string): Promise<number> {
  const id = await ensureTestUser(`afl-${label}-${runId}`, `封存生命週期-${label}`);
  userIds.push(id);
  const conn = (await db.getDb())!;
  await conn.execute(sql`UPDATE users SET primaryEmail = ${`afl-${label}-${runId}@example.test`}, primaryEmailVerifiedAt = NOW() WHERE id = ${id}`);
  return id;
}

function ctx(userId: number, isAdmin = false): TrpcContext {
  const user = {
    id: userId, openId: `afl-ctx-${userId}`, email: isAdmin ? ADMIN_EMAIL : `afl-ctx-${userId}@example.test`, name: "AFL",
    role: isAdmin ? "admin" : "user", isAdmin, isFactoryOwner: false,
    primaryEmail: `afl-ctx-${userId}@example.test`, primaryEmailVerifiedAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as unknown as NonNullable<TrpcContext["user"]>;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}
const caller = (userId: number, isAdmin = false) => appRouter.createCaller(ctx(userId, isAdmin));

async function mkFactory(ownerId: number, label: string, opts: { status?: string; ownerName?: string | null } = {}): Promise<number> {
  const conn = (await db.getDb())!;
  const [f] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, ownerName, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${`AFL-${label}-${runId}`}, ${JSON.stringify([TEST_INDUSTRY])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", "AFL 測試地址", ${opts.ownerName === undefined ? "測試負責人" : opts.ownerName}, ${opts.status ?? "approved"}, "normal", FALSE, "[]", NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(f.insertId);
  await conn.execute(sql`UPDATE users SET isFactoryOwner = TRUE WHERE id = ${ownerId}`);
  return f.insertId;
}

async function count(table: string, where: ReturnType<typeof sql>): Promise<number> {
  const conn = (await db.getDb())!;
  const [rows] = (await conn.execute(sql`SELECT COUNT(*) AS n FROM ${sql.raw(table)} WHERE ${where}`)) as unknown as [{ n: number }[], unknown];
  return Number(rows[0].n);
}

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) for (const id of factoryIds) await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
  for (const id of userIds) await deleteTestUser(id);
}, 120000);

// ── 主情境：一間有完整歷史的 approved 工廠被 owner 封存 ─────────────────────
let ownerId = 0, buyerId = 0, coManagerId = 0, strangerId = 0, adminId = 0;
let factoryId = 0, productId = 0, photoId = 0, reviewId = 0, conversationId = 0, orderId = 0;
const messageIds: number[] = [];

beforeAll(async () => {
  const conn = (await db.getDb())!;
  ownerId = await mkUser("owner");
  buyerId = await mkUser("buyer");
  coManagerId = await mkUser("co");
  strangerId = await mkUser("stranger");
  adminId = await mkUser("admin");
  factoryId = await mkFactory(ownerId, "main");
  await conn.execute(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${coManagerId}, ${ownerId})`);
  productId = await db.createProduct({ factoryId, name: `AFL 商品 ${runId}`, acceptSmallOrder: false, provideSample: false });
  const [p] = (await conn.execute(sql`INSERT INTO factoryPhotos (factoryId, url) VALUES (${factoryId}, "https://example.test/afl.jpg")`)) as unknown as [{ insertId: number }, unknown];
  photoId = p.insertId;
  const [r] = (await conn.execute(sql`INSERT INTO reviews (factoryId, userId, rating, comment) VALUES (${factoryId}, ${buyerId}, 3, "封存前的評價")`)) as unknown as [{ insertId: number }, unknown];
  reviewId = r.insertId;
  const [cv] = (await conn.execute(sql`INSERT INTO conversations (userId, factoryId, lastMessageAt) VALUES (${buyerId}, ${factoryId}, NOW())`)) as unknown as [{ insertId: number }, unknown];
  conversationId = cv.insertId;
  for (const [senderId, role, content] of [[buyerId, "user", "封存前詢價"], [ownerId, "factory", "封存前回覆"]] as const) {
    const [m] = (await conn.execute(sql`INSERT INTO messages (conversationId, senderId, senderRole, content) VALUES (${conversationId}, ${senderId}, ${role}, ${content})`)) as unknown as [{ insertId: number }, unknown];
    messageIds.push(m.insertId);
  }
  const [o] = (await conn.execute(sql`
    INSERT INTO collaborationOrders (conversationId, factoryId, buyerUserId, createdByUserId, projectName, description, status, acceptedAsType)
    VALUES (${conversationId}, ${factoryId}, ${buyerId}, ${ownerId}, "AFL 合作案", "封存前的合作確認單", "completed", "user")
  `)) as unknown as [{ insertId: number }, unknown];
  orderId = o.insertId;

  // 封存前：approved 工廠可以正常傳訊（對照組）
  await caller(buyerId).chat.send({ conversationId, content: "封存前最後一則" });
  messageIds.push(-1); // 佔位：只用來計數

  await caller(ownerId).factory.delete({ id: factoryId });
}, 120000);

describe("A. 封存後 owner 仍擁有原工廠，後台可以辨識封存狀態", () => {
  it("getMine 仍回傳原工廠，isArchived=true、status=delisted；ownership 與 isFactoryOwner 保留", async () => {
    const mine = await caller(ownerId).factory.getMine();
    expect(mine?.id).toBe(factoryId);
    expect(mine?.isArchived).toBe(true);
    expect(mine?.status).toBe("delisted");
    const row = await db.getFactoryById(factoryId);
    expect(row?.ownerId).toBe(ownerId);
    expect((await db.getUserById(ownerId))?.isFactoryOwner).toBe(true);
  });
});

describe("F. 歷史紀錄全部保留且可讀", () => {
  it("對話、訊息、評價、合作確認單、商品、照片都還在", async () => {
    expect(await count("conversations", sql`id = ${conversationId}`)).toBe(1);
    expect(await count("messages", sql`conversationId = ${conversationId}`)).toBe(messageIds.length);
    expect(await count("reviews", sql`id = ${reviewId}`)).toBe(1);
    expect(await count("collaborationOrders", sql`id = ${orderId}`)).toBe(1);
    expect(await count("products", sql`id = ${productId}`)).toBe(1);
    expect(await count("factoryPhotos", sql`id = ${photoId}`)).toBe(1);
  });
  it("買家與 owner 都能讀歷史訊息；owner 可讀歷史評價與合作確認單", async () => {
    for (const uid of [buyerId, ownerId]) {
      const res: any = await caller(uid).chat.getMessages({ conversationId });
      const list: { content: string }[] = Array.isArray(res) ? res : (res.messages ?? res.items ?? []);
      expect(list.map(m => m.content)).toContain("封存前詢價");
    }
    const reviews = await caller(ownerId).review.getByFactory({ factoryId });
    expect(reviews.items.map((x: { id: number }) => x.id)).toContain(reviewId);
    const order = await caller(buyerId).collaborationOrder.getById({ orderId });
    expect(order?.id ?? (order as any)?.order?.id).toBe(orderId);
  });
});

describe("G. 歷史對話：可讀，不可寫（雙向）", () => {
  const READ_ONLY = /此工廠目前已停止服務，此對話僅供查看歷史紀錄/;
  it("getConversationMeta.canSendMessages=false", async () => {
    const meta = await caller(buyerId).chat.getConversationMeta({ conversationId });
    expect(meta?.canSendMessages).toBe(false);
  });
  it("buyer → factory chat.send 拒絕", async () => {
    await expect(caller(buyerId).chat.send({ conversationId, content: "還在嗎" })).rejects.toThrow(READ_ONLY);
  });
  it("factory → buyer chat.send 拒絕（owner 與 co-manager）", async () => {
    await expect(caller(ownerId).chat.send({ conversationId, content: "回覆" })).rejects.toThrow(READ_ONLY);
    await expect(caller(coManagerId).chat.send({ conversationId, content: "回覆" })).rejects.toThrow(READ_ONLY);
  });
  it("sendFirstMessage 走既有對話也拒絕", async () => {
    await expect(caller(buyerId).chat.sendFirstMessage({ factoryId, content: "再問一次" })).rejects.toThrow(READ_ONLY);
  });
  it("傳送商品卡拒絕", async () => {
    await expect(caller(ownerId).chat.sendProduct({ conversationId, productIds: [productId] })).rejects.toThrow(READ_ONLY);
  });
  it("拒絕後訊息數量沒有增加", async () => {
    expect(await count("messages", sql`conversationId = ${conversationId}`)).toBe(messageIds.length);
  });
  it("其他買家不能開新對話", async () => {
    await expect(caller(strangerId).chat.getOrCreate({ factoryId })).rejects.toThrow(/此工廠目前無法接受新詢問/);
  });
});

describe("E. 封存工廠不得繼續營運（owner／co-manager）", () => {
  const ARCHIVED = /此工廠目前已下架，無法修改資料/;
  it("編輯工廠資料 → 拒絕", async () => {
    await expect(caller(ownerId).factory.update({ id: factoryId, description: "改描述" })).rejects.toThrow(ARCHIVED);
    await expect(caller(coManagerId).factory.update({ id: factoryId, description: "改描述" })).rejects.toThrow(ARCHIVED);
  });
  it("商品 create／update／delete → 拒絕", async () => {
    await expect(caller(ownerId).product.create({ factoryId, name: "新商品" })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).product.update({ id: productId, factoryId, name: "改名" })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).product.delete({ id: productId, factoryId })).rejects.toThrow(ARCHIVED);
    expect(await count("products", sql`id = ${productId}`)).toBe(1);
  });
  it("分類 create → 拒絕", async () => {
    await expect(caller(ownerId).category.create({ factoryId, name: "新分類" })).rejects.toThrow(ARCHIVED);
  });
  it("照片 delete／caption／crop → 拒絕", async () => {
    await expect(caller(ownerId).factory.deletePhoto({ photoId })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).factory.updatePhotoCaption({ photoId, caption: "新說明" })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).factory.updatePhotoCrop({ photoId, crop: null })).rejects.toThrow(ARCHIVED);
    expect(await count("factoryPhotos", sql`id = ${photoId}`)).toBe(1);
  });
  it("邀請次管理者 → 拒絕", async () => {
    await expect(caller(ownerId).factory.inviteCoManager({ email: `afl-stranger-${runId}@example.test` })).rejects.toThrow(ARCHIVED);
  });
  it("新合作確認單 → 拒絕；重複下訂 → 拒絕", async () => {
    await expect(caller(ownerId).collaborationOrder.create({ conversationId, projectName: "新案", description: "新案內容" }))
      .rejects.toThrow(/無法建立新的合作確認單/);
    await expect(caller(buyerId).collaborationOrder.requestRepeat({ orderId })).rejects.toThrow(/無法建立新的合作確認單/);
  });
  it("一般修改申請（submitRevision）→ 拒絕", async () => {
    await expect(caller(ownerId).factory.submitRevision({ factoryId, proposedData: { description: "x" }, revisionReason: "測試修改" }))
      .rejects.toThrow();
  });
});

describe("I. 重建保護：封存工廠的 owner 不能建立全新工廠", () => {
  it("factory.create → 拒絕", async () => {
    await expect(caller(ownerId).factory.create({
      name: `AFL-recreate-${runId}`, industry: [TEST_INDUSTRY], mfgModes: ["ODM"], region: "新竹市",
      capitalLevel: "<1000萬", address: "重建地址", taxId: "00000016",
    })).rejects.toThrow(/您已擁有工廠/);
  });
});

describe("B／D. 申請重新上架 → pending → admin approve → approved", () => {
  it("buyer／co-manager／其他人不能替這間工廠申請（他們不是 owner）", async () => {
    // submitForReview 以呼叫者本人的 owned factory 為對象：這些人沒有 owned
    // factory，不可能碰到這間工廠。
    for (const uid of [buyerId, coManagerId, strangerId]) {
      await expect(caller(uid).factory.submitForReview()).rejects.toThrow(/找不到工廠/);
    }
    const row = await db.getFactoryById(factoryId);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.status).toBe("delisted");
  });

  it("封存狀態下 admin 不能直接 approve", async () => {
    await expect(caller(adminId, true).admin.approveFactory({ factoryId })).rejects.toThrow(/已刪除/);
  });

  it("owner 申請重新上架 → deletedAt=null、status=pending（不是 approved），仍不公開", async () => {
    await caller(ownerId).factory.submitForReview();
    const row = await db.getFactoryById(factoryId);
    expect(row?.deletedAt).toBeNull();
    expect(row?.status).toBe("pending");
    expect(row?.status).not.toBe("approved");
    const anon = appRouter.createCaller({ user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] });
    expect(await anon.factory.getById({ id: factoryId })).toBeNull();
    // 審核中對話仍唯讀
    expect((await caller(buyerId).chat.getConversationMeta({ conversationId }))?.canSendMessages).toBe(false);
  });

  it("重複申請 → 拒絕（已不是封存狀態，也不是 draft／rejected）", async () => {
    await expect(caller(ownerId).factory.submitForReview()).rejects.toThrow();
  });

  it("出現在管理員既有的待審清單", async () => {
    const pending: any = await caller(adminId, true).admin.getPendingFactories({ page: 1, pageSize: 100 });
    const items: { id: number }[] = pending.items ?? pending;
    expect(items.map(f => f.id)).toContain(factoryId);
  });

  it("admin approve → approved；公開可見，對話恢復可寫", async () => {
    await caller(adminId, true).admin.approveFactory({ factoryId });
    const row = await db.getFactoryById(factoryId);
    expect(row?.status).toBe("approved");
    expect(row?.deletedAt).toBeNull();
    expect((await caller(buyerId).chat.getConversationMeta({ conversationId }))?.canSendMessages).toBe(true);
    await caller(buyerId).chat.send({ conversationId, content: "恢復上架後的新訊息" });
  });
});

describe("C. 重新上架驗證：送審完整度與產品數量照常適用", () => {
  let incompleteOwner = 0, noProductOwner = 0;
  let incompleteFactory = 0, noProductFactory = 0;

  beforeAll(async () => {
    incompleteOwner = await mkUser("incomplete");
    noProductOwner = await mkUser("noproduct");
    incompleteFactory = await mkFactory(incompleteOwner, "incomplete", { ownerName: null });
    await db.createProduct({ factoryId: incompleteFactory, name: "有商品", acceptSmallOrder: false, provideSample: false });
    noProductFactory = await mkFactory(noProductOwner, "noproduct");
    await db.ownerSoftDeleteFactory(incompleteFactory, incompleteOwner);
    await db.ownerSoftDeleteFactory(noProductFactory, noProductOwner);
  });

  it("缺必填（負責人）→ 拒絕，維持封存狀態", async () => {
    await expect(caller(incompleteOwner).factory.submitForReview()).rejects.toThrow(/負責人/);
    const row = await db.getFactoryById(incompleteFactory);
    expect(row?.deletedAt).not.toBeNull();
  });

  it("沒有商品 → 依既有規則拒絕，維持封存狀態", async () => {
    await expect(caller(noProductOwner).factory.submitForReview()).rejects.toThrow(/至少新增一項產品/);
    const row = await db.getFactoryById(noProductFactory);
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe("H. 次管理者邀請：封存工廠的 owner 可以加入其他工廠", () => {
  let archivedOwner = 0, activeOwner = 0, hostOwner = 0, hostFactory = 0;

  beforeEach(async () => {
    const conn = (await db.getDb())!;
    if (!hostFactory) {
      archivedOwner = await mkUser("archived-owner");
      activeOwner = await mkUser("active-owner");
      hostOwner = await mkUser("host-owner");
      const archivedFactory = await mkFactory(archivedOwner, "archived");
      await db.createProduct({ factoryId: archivedFactory, name: "封存工廠商品", acceptSmallOrder: false, provideSample: false });
      await db.ownerSoftDeleteFactory(archivedFactory, archivedOwner);
      await mkFactory(activeOwner, "active");
      hostFactory = await mkFactory(hostOwner, "host");
    }
    await conn.execute(sql`DELETE FROM factoryCoManagerInvitations WHERE factoryId = ${hostFactory}`);
  });

  it("封存工廠的 owner：可以被邀請並接受；原工廠 ownership 保留", async () => {
    const invite = await caller(hostOwner).factory.inviteCoManager({ email: `afl-archived-owner-${runId}@example.test` });
    expect(invite.conversationId).not.toBeNull();
    const conn = (await db.getDb())!;
    const [rows] = (await conn.execute(sql`SELECT id FROM factoryCoManagerInvitations WHERE factoryId = ${hostFactory} AND inviteeUserId = ${archivedOwner} AND status = 'pending'`)) as unknown as [{ id: number }[], unknown];
    await db.acceptInvitation(rows[0].id, archivedOwner);
    expect(await db.isActiveCoManager(hostFactory, archivedOwner)).toBe(true);
    const owned = await db.getFactoryByOwnerId(archivedOwner);
    expect(owned?.deletedAt).not.toBeNull(); // 原工廠仍屬於他，未被刪除
  });

  it("身兼他廠次管理者時不能申請重新上架（一人一廠）", async () => {
    await expect(caller(archivedOwner).factory.submitForReview()).rejects.toThrow(/請先退出/);
  });

  it("擁有「有效」工廠的 owner：維持既有規則，不能被邀請", async () => {
    await expect(caller(hostOwner).factory.inviteCoManager({ email: `afl-active-owner-${runId}@example.test` }))
      .rejects.toThrow(/已擁有或管理其他工廠/);
  });
});

describe("favorite：收藏之後被封存的工廠只回傳最小資訊，可取消收藏", () => {
  it("getByUser 回傳 isUnavailable，不帶工廠資料；toggle 可取消", async () => {
    const favOwner = await mkUser("fav-owner");
    const fan = await mkUser("fan");
    const fid = await mkFactory(favOwner, "fav");
    await caller(fan).favorite.toggle({ factoryId: fid });
    await db.ownerSoftDeleteFactory(fid, favOwner);
    const favs = await caller(fan).favorite.getByUser({ page: 1, pageSize: 20 });
    const item: any = favs.items.find((f: any) => f.id === fid);
    expect(item).toEqual({ id: fid, name: `AFL-fav-${runId}`, isUnavailable: true });
    const res = await caller(fan).favorite.toggle({ factoryId: fid });
    expect(res.isFavorited).toBe(false);
  });
});
