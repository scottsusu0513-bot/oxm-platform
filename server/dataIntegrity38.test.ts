/**
 * Production Hardening Batch 3.8：資料一致性／交易／併發回歸測試。全部真的走本機
 * 測試資料庫，併發以 Promise.all 同時送出（不是只讀程式碼宣稱安全）。
 *
 *   1. 合作確認單狀態轉換：同時兩個以上的請求只有一個生效，另一個得到「狀態已變更」，
 *      只會產生一則系統訊息
 *   2. 日期修改申請：不會產生兩筆 pending；回應是原子的（申請狀態與訂單日期一起更新）
 *   3. 重複下訂：不會產生兩筆 pending 申請；接受只會建立一張新訂單；中途失敗整體 rollback
 *   4. 刪除對話不會連帶刪掉合作確認單
 *   5. 評價：同一使用者併發只會有一筆；刪除評價後工廠平均分數與評價數重新計算
 *   6. 收藏：併發切換不會產生重複收藏
 *   7. 社群需求單：需求單與目標產業在同一個 transaction，失敗整體 rollback
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const userIds: number[] = [];
const factoryIds: number[] = [];

async function exec(q: ReturnType<typeof sql>) { return (await db.getDb())!.execute(q) as unknown as Promise<[any, unknown]>; }
async function rows<T = any>(q: ReturnType<typeof sql>): Promise<T[]> { return (await exec(q))[0] as T[]; }
async function mkUser(label: string) { const id = await ensureTestUser(`di38-${label}-${runId}`, `DI38 ${label}`); userIds.push(id); return id; }
async function ctxOf(userId: number): Promise<TrpcContext> {
  const u = (await db.getUserById(userId))!;
  return { user: { ...u, role: "user", isAdmin: false }, req: { protocol: "https", headers: {} }, res: { clearCookie() {}, cookie() {} } } as unknown as TrpcContext;
}
async function mkFactory(ownerId: number) {
  const [r] = await exec(sql`INSERT INTO factories (ownerId, name, industry, mfgModes, region, description, capitalLevel, address, status, operationStatus, certified, subIndustry, businessType, avgRating, reviewCount)
    VALUES (${ownerId}, ${`DI38 工廠 ${runId}-${ownerId}`}, '["金屬加工"]', '["OEM"]', '台北市', '描述', '<1000萬', '地址', 'approved', 'normal', FALSE, '[]', 'factory', '0.00', 0)`);
  factoryIds.push(r.insertId);
  return r.insertId as number;
}
async function mkConversation(buyer: number, factoryId: number) {
  const [r] = await exec(sql`INSERT INTO conversations (userId, factoryId) VALUES (${buyer}, ${factoryId})`);
  return r.insertId as number;
}
const orderData = (conversationId: number, factoryId: number, buyer: number, owner: number) => ({
  conversationId, factoryId, buyerUserId: buyer, createdByUserId: owner, projectName: `專案 ${runId}`, description: "描述",
  depositDueDate: "2026-11-01", productionStartDate: "2026-11-05", expectedCompletionDate: "2026-11-20",
  expectedShipmentDate: "2026-11-25", finalPaymentDueDate: "2026-11-30",
});
async function orderStatus(id: number) { return (await rows(sql`SELECT status FROM collaborationOrders WHERE id = ${id}`))[0]?.status; }
async function settle<T>(ps: Promise<T>[]) { return Promise.allSettled(ps); }
const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter(r => r.status === "fulfilled");

let owner: number, buyer: number, factoryId: number;
beforeAll(async () => {
  owner = await mkUser("owner");
  buyer = await mkUser("buyer");
  factoryId = await mkFactory(owner);
}, 60000);

afterAll(async () => {
  for (const f of factoryIds) {
    await exec(sql`DELETE FROM reviews WHERE factoryId = ${f}`);
    await exec(sql`DELETE FROM favorites WHERE factoryId = ${f}`);
    await exec(sql`DELETE FROM collaborationOrders WHERE factoryId = ${f}`);
    await exec(sql`DELETE FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE factoryId = ${f})`);
    await exec(sql`DELETE FROM conversations WHERE factoryId = ${f}`);
    await exec(sql`DELETE FROM factories WHERE id = ${f}`);
  }
  await exec(sql`DELETE FROM communityBids WHERE title LIKE ${`%di38-${runId}%`}`);
  for (const u of userIds) await deleteTestUser(u);
}, 60000);

describe("1. 合作確認單狀態轉換（條件式更新）", () => {
  it("需求方同時「接受」與「拒絕」：只有一個生效，另一個 CONFLICT，只有一則系統訊息", async () => {
    const conv = await mkConversation(buyer, factoryId);
    const orderId = await db.createCollaborationOrder(orderData(conv, factoryId, buyer, owner));
    const caller = appRouter.createCaller(await ctxOf(buyer));
    const rs = await settle([
      caller.collaborationOrder.respond({ orderId, action: "accepted" }),
      caller.collaborationOrder.respond({ orderId, action: "rejected" }),
      caller.collaborationOrder.respond({ orderId, action: "accepted" }),
    ]);
    expect(fulfilled(rs)).toHaveLength(1);
    for (const r of rs) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: expect.stringMatching(/CONFLICT|BAD_REQUEST/) });
    expect(["accepted", "rejected"]).toContain(await orderStatus(orderId));
    const msgs = await rows(sql`SELECT id FROM messages WHERE conversationId = ${conv} AND type = 'text'`);
    expect(msgs).toHaveLength(1);
  });

  it("DB 層：respond／requestCancel／respondCancel／updateStatus／earlyComplete／earlyShip 各自併發只成功一次", async () => {
    const conv = await mkConversation(await mkUser("b2"), factoryId);
    const orderId = await db.createCollaborationOrder(orderData(conv, factoryId, buyer, owner));
    const accept = { acceptedByUserId: buyer, acceptedAsType: "user" as const, acceptedAsFactoryId: null };
    expect((await Promise.all([db.respondCollaborationOrder(orderId, "accepted", accept), db.respondCollaborationOrder(orderId, "rejected")])).filter(Boolean)).toHaveLength(1);
    await exec(sql`UPDATE collaborationOrders SET status = 'accepted' WHERE id = ${orderId}`);
    expect((await Promise.all([db.earlyCompleteOrder(orderId, owner), db.earlyCompleteOrder(orderId, owner)])).filter(Boolean)).toHaveLength(1);
    expect((await Promise.all([db.earlyShipOrder(orderId, owner), db.earlyShipOrder(orderId, owner)])).filter(Boolean)).toHaveLength(1);
    expect((await Promise.all([db.updateCollaborationOrderStatus(orderId, "in_progress", "accepted"), db.updateCollaborationOrderStatus(orderId, "in_progress", "accepted")])).filter(Boolean)).toHaveLength(1);
    expect(await orderStatus(orderId)).toBe("in_progress");
    expect((await Promise.all([
      db.requestCancelCollaborationOrder(orderId, buyer, "a", "in_progress"),
      db.requestCancelCollaborationOrder(orderId, owner, "b", "in_progress"),
    ])).filter(Boolean)).toHaveLength(1);
    expect((await Promise.all([db.respondCancelCollaborationOrder(orderId, "accept"), db.respondCancelCollaborationOrder(orderId, "reject")])).filter(Boolean)).toHaveLength(1);
    expect(["cancelled", "in_progress"]).toContain(await orderStatus(orderId));
  });

  it("非法轉換被拒：狀態已不是 fromStatus 時 updateStatus 不生效", async () => {
    const conv = await mkConversation(await mkUser("b3"), factoryId);
    const orderId = await db.createCollaborationOrder(orderData(conv, factoryId, buyer, owner));
    expect(await db.updateCollaborationOrderStatus(orderId, "completed", "shipped")).toBe(false);
    expect(await orderStatus(orderId)).toBe("pending");
  });
});

describe("2. 日期修改申請", () => {
  it("同時送出三次：只有一筆 pending；同時接受＋拒絕只有一個生效；接受時訂單日期同步更新", async () => {
    const conv = await mkConversation(await mkUser("b4"), factoryId);
    const orderId = await db.createCollaborationOrder(orderData(conv, factoryId, buyer, owner));
    const req = (d: string) => db.createCollaborationOrderChangeRequest({
      orderId, requestedByUserId: owner, reason: "r",
      oldValues: { expectedCompletionDate: "2026-11-20" }, newValues: { expectedCompletionDate: d, depositDueDate: "2026-11-01", productionStartDate: "2026-11-05", expectedShipmentDate: "2026-11-25", finalPaymentDueDate: "2026-11-30" },
    });
    const rs = await settle([req("2026-11-21"), req("2026-11-22"), req("2026-11-23")]);
    expect(fulfilled(rs)).toHaveLength(1);
    for (const r of rs) if (r.status === "rejected") expect((r.reason as Error).message).toBe("PENDING_EXISTS");
    const pending = await rows(sql`SELECT id, newValuesJson FROM collaborationOrderChangeRequests WHERE orderId = ${orderId} AND status = 'pending'`);
    expect(pending).toHaveLength(1);
    const reqId = pending[0].id;
    const responses = await settle([db.respondCollaborationOrderChangeRequest(reqId, "accepted"), db.respondCollaborationOrderChangeRequest(reqId, "rejected")]);
    expect(fulfilled(responses)).toHaveLength(1);
    const [cr] = await rows(sql`SELECT status FROM collaborationOrderChangeRequests WHERE id = ${reqId}`);
    const [o] = await rows(sql`SELECT expectedCompletionDate FROM collaborationOrders WHERE id = ${orderId}`);
    const newDate = (typeof pending[0].newValuesJson === "string" ? JSON.parse(pending[0].newValuesJson) : pending[0].newValuesJson).expectedCompletionDate;
    if (cr.status === "accepted") expect(String(o.expectedCompletionDate)).toContain(newDate.slice(-2));
    else expect(String(o.expectedCompletionDate)).toContain("20");
  });
});

describe("3. 重複下訂", () => {
  async function completedOrder() {
    const b = await mkUser(`rb-${Math.random().toString(36).slice(2, 6)}`);
    const conv = await mkConversation(b, factoryId);
    const orderId = await db.createCollaborationOrder(orderData(conv, factoryId, b, owner));
    await exec(sql`UPDATE collaborationOrders SET status = 'completed' WHERE id = ${orderId}`);
    return { b, conv, orderId };
  }

  it("同時送出三次申請：只有一筆 pending（其餘 PENDING_EXISTS）", async () => {
    const { b, conv, orderId } = await completedOrder();
    const mk = () => db.createRepeatOrderRequest({ originalOrderId: orderId, conversationId: conv, requestedByUserId: b });
    const rs = await settle([mk(), mk(), mk()]);
    expect(fulfilled(rs)).toHaveLength(1);
    expect(await rows(sql`SELECT id FROM collaborationOrderRepeatRequests WHERE originalOrderId = ${orderId} AND status = 'pending'`)).toHaveLength(1);
  });

  it("同時接受三次：只建立一張新合作確認單（accepted），申請變成 accepted", async () => {
    const { b, conv, orderId } = await completedOrder();
    const requestId = await db.createRepeatOrderRequest({ originalOrderId: orderId, conversationId: conv, requestedByUserId: b });
    const accept = () => db.acceptRepeatOrderRequestAtomic(requestId, orderData(conv, factoryId, b, owner), { acceptedByUserId: b, acceptedAsType: "user", acceptedAsFactoryId: null });
    const rs = await settle([accept(), accept(), accept()]);
    expect(fulfilled(rs)).toHaveLength(1);
    for (const r of rs) if (r.status === "rejected") expect((r.reason as Error).message).toBe("NOT_PENDING");
    const newOrders = await rows(sql`SELECT id, status, currentStage FROM collaborationOrders WHERE conversationId = ${conv} AND id <> ${orderId}`);
    expect(newOrders).toHaveLength(1);
    expect(newOrders[0]).toMatchObject({ status: "accepted", currentStage: "awaiting_deposit" });
    expect((await rows(sql`SELECT status FROM collaborationOrderRepeatRequests WHERE id = ${requestId}`))[0].status).toBe("accepted");
  });

  it("失敗注入：建立新訂單失敗（FK 不存在）→ 整體 rollback，申請仍是 pending、沒有新訂單，可安全重試", async () => {
    const { b, conv, orderId } = await completedOrder();
    const requestId = await db.createRepeatOrderRequest({ originalOrderId: orderId, conversationId: conv, requestedByUserId: b });
    await expect(db.acceptRepeatOrderRequestAtomic(requestId, { ...orderData(conv, factoryId, b, owner), buyerUserId: 2147480000 }, { acceptedByUserId: b, acceptedAsType: "user", acceptedAsFactoryId: null })).rejects.toBeTruthy();
    expect((await rows(sql`SELECT status FROM collaborationOrderRepeatRequests WHERE id = ${requestId}`))[0].status).toBe("pending");
    expect(await rows(sql`SELECT id FROM collaborationOrders WHERE conversationId = ${conv} AND id <> ${orderId}`)).toHaveLength(0);
    await expect(db.acceptRepeatOrderRequestAtomic(requestId, orderData(conv, factoryId, b, owner), { acceptedByUserId: b, acceptedAsType: "user", acceptedAsFactoryId: null })).resolves.toBeGreaterThan(0);
  });
});

describe("4. 刪除對話不會連帶刪掉合作確認單", () => {
  it("有合作確認單的對話：CONFLICT，對話／訊息／訂單都保留；沒有訂單的對話：訊息與對話一起刪除", async () => {
    const b = await mkUser("del-b");
    const conv = await mkConversation(b, factoryId);
    await db.saveMessage(conv, b, "user", "hi", "text");
    const orderId = await db.createCollaborationOrder(orderData(conv, factoryId, b, owner));
    const caller = appRouter.createCaller(await ctxOf(owner));
    await expect(caller.chat.deleteConversation({ conversationId: conv })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await rows(sql`SELECT id FROM conversations WHERE id = ${conv}`)).toHaveLength(1);
    expect(await rows(sql`SELECT id FROM messages WHERE conversationId = ${conv}`)).toHaveLength(1);
    expect(await orderStatus(orderId)).toBe("pending");

    const b2 = await mkUser("del-b2");
    const conv2 = await mkConversation(b2, factoryId);
    await db.saveMessage(conv2, b2, "user", "hi", "text");
    await expect(caller.chat.deleteConversation({ conversationId: conv2 })).resolves.toEqual({ success: true });
    expect(await rows(sql`SELECT id FROM conversations WHERE id = ${conv2}`)).toHaveLength(0);
    expect(await rows(sql`SELECT id FROM messages WHERE conversationId = ${conv2}`)).toHaveLength(0);
  });
});

describe("5. 評價", () => {
  it("同一使用者同時送出五次：只有一筆評價；工廠評價數／平均分數正確", async () => {
    const reviewer = await mkUser("reviewer");
    const f = await mkFactory(await mkUser("rev-owner"));
    const rs = await settle(Array.from({ length: 5 }, (_, i) => db.createReview({ factoryId: f, userId: reviewer, rating: 5 - (i % 2), comment: "c" })));
    expect(fulfilled(rs)).toHaveLength(1);
    expect(await rows(sql`SELECT id FROM reviews WHERE factoryId = ${f} AND userId = ${reviewer}`)).toHaveLength(1);
    const [fac] = await rows(sql`SELECT reviewCount FROM factories WHERE id = ${f}`);
    expect(Number(fac.reviewCount)).toBe(1);
  });

  it("刪除評價後重新計算工廠平均分數與評價數（原本不會更新）", async () => {
    const f = await mkFactory(await mkUser("rev-owner2"));
    const r1 = await mkUser("r1"), r2 = await mkUser("r2");
    await db.createReview({ factoryId: f, userId: r1, rating: 5 });
    await db.createReview({ factoryId: f, userId: r2, rating: 1 });
    expect((await rows(sql`SELECT reviewCount, avgRating FROM factories WHERE id = ${f}`))[0]).toMatchObject({ reviewCount: 2 });
    const [mine] = await rows(sql`SELECT id FROM reviews WHERE factoryId = ${f} AND userId = ${r2}`);
    await appRouter.createCaller(await ctxOf(r2)).review.delete({ id: mine.id });
    const [after] = await rows(sql`SELECT reviewCount, avgRating FROM factories WHERE id = ${f}`);
    expect(Number(after.reviewCount)).toBe(1);
    expect(Number(after.avgRating)).toBe(5);
  });

  it("驗證評價：同一張合作確認單同時送出三次，只有一筆", async () => {
    const b = await mkUser("vr");
    const conv = await mkConversation(b, factoryId);
    const orderId = await db.createCollaborationOrder(orderData(conv, factoryId, b, owner));
    const rs = await settle(Array.from({ length: 3 }, () => db.createVerifiedOrderReview({ factoryId, userId: b, collaborationOrderId: orderId, rating: 5 })));
    expect(fulfilled(rs)).toHaveLength(1);
    expect(await rows(sql`SELECT id FROM reviews WHERE collaborationOrderId = ${orderId}`)).toHaveLength(1);
  });
});

describe("6. 收藏", () => {
  it("同時切換兩次：依序執行（一次收藏、一次取消），永遠不會有重複的收藏列", async () => {
    const u = await mkUser("fav");
    const results = await Promise.all([db.toggleFavorite(u, factoryId), db.toggleFavorite(u, factoryId)]);
    expect([...results].sort()).toEqual([false, true]);
    expect((await rows(sql`SELECT COUNT(*) n FROM favorites WHERE userId = ${u} AND factoryId = ${factoryId}`))[0].n).toBe(0);
    await Promise.all(Array.from({ length: 5 }, () => db.toggleFavorite(u, factoryId)));
    const [{ n }] = await rows(sql`SELECT COUNT(*) n FROM favorites WHERE userId = ${u} AND factoryId = ${factoryId}`);
    expect(Number(n)).toBeLessThanOrEqual(1);
  });
});

describe("7. 社群需求單寫入的原子性", () => {
  const base = (title: string) => ({
    spaceCode: "cross-industry", authorUserId: owner, authorFactoryId: null, authorNameSnapshot: "a", authorFactoryNameSnapshot: null, authorRoleSnapshot: null,
    title, description: "d", quantity: null, material: null, specifications: null, sampleRequired: false, desiredDeliveryDate: null,
    deliveryLocation: null, budgetMin: null, budgetMax: null, images: [], pinnedProductIds: [], durationHours: 72,
  });
  it("建立：目標產業寫入失敗 → 需求單本體也 rollback（不留下沒有目標產業的需求單）", async () => {
    const title = `失敗 di38-${runId}`;
    await expect(db.createCommunityBid({ ...base(title), targetIndustrySpaceCodes: ["x".repeat(200)] })).rejects.toBeTruthy();
    expect(await rows(sql`SELECT id FROM communityBids WHERE title = ${title}`)).toHaveLength(0);
  });
  it("更新：新的目標產業寫入失敗 → 原本的目標產業與本體欄位都保留", async () => {
    const title = `更新 di38-${runId}`;
    const bidId = await db.createCommunityBid({ ...base(title), targetIndustrySpaceCodes: ["metal-processing"] });
    await expect(db.updateCommunityBid(bidId, { title: `改名 di38-${runId}`, targetIndustrySpaceCodes: ["y".repeat(200)] })).rejects.toBeTruthy();
    expect((await rows(sql`SELECT title FROM communityBids WHERE id = ${bidId}`))[0].title).toBe(title);
    expect((await rows(sql`SELECT spaceCode FROM communityBidIndustries WHERE bidId = ${bidId}`)).map(r => r.spaceCode)).toEqual(["metal-processing"]);
  });
});

describe("8. 時區假設檢查", () => {
  it("回傳 DB session 與行程的時區位移（正式站兩者都應為 UTC＝0；本機只驗證可執行）", async () => {
    const r = await db.checkDbTimezoneAssumptions();
    expect(r).toMatchObject({ dbOffsetSeconds: expect.any(Number), processOffsetMinutes: expect.any(Number) });
  });
});
