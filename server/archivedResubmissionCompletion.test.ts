/**
 * 封存工廠「重新上架資料補全」（Production Hardening Batch 2.6）— 整合測試，
 * 真的走本機測試資料庫與 appRouter.createCaller。
 *
 * 問題：Batch 2.5 封存工廠禁止一般編輯，但重新上架要求送審資料完整——資料
 * 不完整的封存工廠會卡死。修正：owner 本人可在明確標記
 * resubmissionCompletion 的少數 mutation 補齊「送審必要資料」（必填欄位＋
 * 商品），工廠在正式送出前維持 delisted + deletedAt（不公開）；其他營運
 * mutation 照舊拒絕。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_INDUSTRY = `ARC_TEST_${runId}`;
const ADMIN_EMAIL = ENV.adminWhitelistEmails[0] ?? "";
const userIds: number[] = [];
const factoryIds: number[] = [];
const ARCHIVED = /此工廠目前已下架，無法修改資料/;

async function mkUser(label: string): Promise<number> {
  const id = await ensureTestUser(`arc-${label}-${runId}`, `補全模式-${label}`);
  userIds.push(id);
  const conn = (await db.getDb())!;
  await conn.execute(sql`UPDATE users SET primaryEmail = ${`arc-${label}-${runId}@example.test`}, primaryEmailVerifiedAt = NOW() WHERE id = ${id}`);
  return id;
}

function ctx(userId: number | null, isAdmin = false): TrpcContext {
  const user = userId === null ? null : ({
    id: userId, openId: `arc-ctx-${userId}`, email: isAdmin ? ADMIN_EMAIL : `arc-ctx-${userId}@example.test`, name: "ARC",
    role: isAdmin ? "admin" : "user", isAdmin, isFactoryOwner: true,
    primaryEmail: `arc-ctx-${userId}@example.test`, primaryEmailVerifiedAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as unknown as NonNullable<TrpcContext["user"]>);
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}
const caller = (userId: number | null, isAdmin = false) => appRouter.createCaller(ctx(userId, isAdmin));

/** 建立一間 approved 工廠後由 owner 封存；ownerName 可設為 null 模擬早期資料不完整。 */
async function mkArchivedFactory(ownerId: number, label: string, opts: { ownerName?: string | null; withProduct?: boolean } = {}) {
  const conn = (await db.getDb())!;
  const [f] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, ownerName, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
    VALUES (${ownerId}, ${`ARC-${label}-${runId}`}, ${JSON.stringify([TEST_INDUSTRY])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", "ARC 測試地址", ${opts.ownerName === undefined ? "測試負責人" : opts.ownerName}, "approved", "normal", FALSE, "[]", NOW(), NOW())
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(f.insertId);
  let productId: number | null = null;
  if (opts.withProduct !== false) {
    productId = await db.createProduct({ factoryId: f.insertId, name: `ARC 商品 ${label}`, acceptSmallOrder: false, provideSample: false });
  }
  await db.ownerSoftDeleteFactory(f.insertId, ownerId);
  return { factoryId: f.insertId, productId };
}

async function assertStillArchivedAndPrivate(factoryId: number, productId?: number | null) {
  const row = await db.getFactoryById(factoryId);
  expect(row?.status).toBe("delisted");
  expect(row?.deletedAt).not.toBeNull();
  const anon = caller(null);
  expect(await anon.factory.getById({ id: factoryId })).toBeNull();
  expect(await anon.product.getByFactory({ factoryId })).toEqual([]);
  if (productId) expect(await anon.product.getById({ id: productId })).toBeUndefined();
  const search = await anon.factory.search({ industry: [TEST_INDUSTRY], pageSize: 50 });
  expect(search.items.map(f => f.id)).not.toContain(factoryId);
  expect((await db.getApprovedFactoriesForSitemap()).map(r => r.id)).not.toContain(factoryId);
}

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) for (const id of factoryIds) await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
  for (const id of userIds) await deleteTestUser(id);
}, 120000);

describe("A. 資料完整的封存工廠：直接申請重新上架", () => {
  it("getResubmissionRequirements.canSubmit=true → submitForReview → pending、deletedAt=null", async () => {
    const ownerId = await mkUser("a-owner");
    const { factoryId } = await mkArchivedFactory(ownerId, "a");
    const req = await caller(ownerId).factory.getResubmissionRequirements();
    expect(req).toMatchObject({ factoryId, canSubmit: true, missing: [] });
    await caller(ownerId).factory.submitForReview();
    const row = await db.getFactoryById(factoryId);
    expect(row?.status).toBe("pending");
    expect(row?.deletedAt).toBeNull();
  });
});

describe("B～E. 資料不完整 → 補全模式 → 補齊 → 送出", () => {
  let ownerId = 0, coManagerId = 0, buyerId = 0, otherOwnerId = 0, adminId = 0;
  let factoryId = 0, otherFactoryId = 0;
  let newProductId = 0;

  beforeAll(async () => {
    ownerId = await mkUser("b-owner");
    coManagerId = await mkUser("b-co");
    buyerId = await mkUser("b-buyer");
    otherOwnerId = await mkUser("b-other");
    adminId = await mkUser("b-admin");
    // 缺負責人、也沒有商品
    ({ factoryId } = await mkArchivedFactory(ownerId, "b", { ownerName: null, withProduct: false }));
    const conn = (await db.getDb())!;
    await conn.execute(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${coManagerId}, ${ownerId})`);
    ({ factoryId: otherFactoryId } = await mkArchivedFactory(otherOwnerId, "b-other"));
  });

  it("B. 缺負責人＋產品：申請重新上架 → 不轉換，一次回報所有缺漏（中文標籤）", async () => {
    const req = await caller(ownerId).factory.getResubmissionRequirements();
    expect(req?.canSubmit).toBe(false);
    expect(req?.missing.map(m => m.label)).toEqual(["負責人", "產品（至少一項）"]);
    await expect(caller(ownerId).factory.submitForReview())
      .rejects.toThrow("重新上架前，請先補齊以下資料：負責人、產品（至少一項）");
    await assertStillArchivedAndPrivate(factoryId);
  });

  it("C. owner 補全負責人 → 工廠仍 delisted + deletedAt、不公開", async () => {
    await caller(ownerId).factory.update({ id: factoryId, ownerName: "補上的負責人", resubmissionCompletion: true });
    expect((await db.getFactoryById(factoryId))?.ownerName).toBe("補上的負責人");
    await assertStillArchivedAndPrivate(factoryId);
    const req = await caller(ownerId).factory.getResubmissionRequirements();
    expect(req?.missing.map(m => m.key)).toEqual(["products"]);
  });

  it("C'. 補全模式只能改送審必填欄位：其他欄位（簡介／電話／徽章）→ 拒絕", async () => {
    await expect(caller(ownerId).factory.update({ id: factoryId, description: "偷改簡介", resubmissionCompletion: true }))
      .rejects.toThrow(/只能修改送審必要資料/);
    await expect(caller(ownerId).factory.update({ id: factoryId, ownerName: "x", phone: "0912", resubmissionCompletion: true }))
      .rejects.toThrow(/只能修改送審必要資料/);
    await expect(caller(ownerId).factory.update({ id: factoryId, certificationBadges: ["bni"], resubmissionCompletion: true }))
      .rejects.toThrow(/只能修改送審必要資料/);
    expect((await db.getFactoryById(factoryId))?.ownerName).toBe("補上的負責人");
  });

  it("D. owner 補全新增商品 → 商品存在，但公開商品 API 仍拿不到", async () => {
    const res = await caller(ownerId).product.create({ factoryId, name: "補全模式新增的商品", resubmissionCompletion: true });
    newProductId = res.id;
    expect(await caller(ownerId).product.getById({ id: newProductId })).toMatchObject({ id: newProductId });
    await assertStillArchivedAndPrivate(factoryId, newProductId);
  });

  it("D'. owner 補全修改／刪除商品也允許（仍不公開）", async () => {
    await caller(ownerId).product.update({ id: newProductId, factoryId, name: "改名後的商品", resubmissionCompletion: true });
    const extra = await caller(ownerId).product.create({ factoryId, name: "要刪掉的錯誤商品", resubmissionCompletion: true });
    await caller(ownerId).product.delete({ id: extra.id, factoryId, resubmissionCompletion: true });
    const names = (await caller(ownerId).product.getByFactory({ factoryId })).map(p => p.name);
    expect(names).toEqual(["改名後的商品"]);
    await assertStillArchivedAndPrivate(factoryId, newProductId);
  });

  it("F. co-manager 帶補全旗標 → 拒絕（只有 owner 本人）", async () => {
    await expect(caller(coManagerId).factory.update({ id: factoryId, ownerName: "co", resubmissionCompletion: true }))
      .rejects.toThrow(/只有工廠主可以補全重新上架資料/);
    await expect(caller(coManagerId).product.create({ factoryId, name: "co 商品", resubmissionCompletion: true }))
      .rejects.toThrow(/只有工廠主可以補全重新上架資料/);
  });

  it("G. buyer 帶補全旗標 → 拒絕", async () => {
    await expect(caller(buyerId).factory.update({ id: factoryId, ownerName: "buyer", resubmissionCompletion: true }))
      .rejects.toThrow(/無權限/);
    await expect(caller(buyerId).product.create({ factoryId, name: "buyer 商品", resubmissionCompletion: true }))
      .rejects.toThrow(/無權限/);
  });

  it("H. 另一間封存工廠的 owner → 拒絕", async () => {
    await expect(caller(otherOwnerId).factory.update({ id: factoryId, ownerName: "other", resubmissionCompletion: true }))
      .rejects.toThrow(/無權限/);
    await expect(caller(otherOwnerId).product.delete({ id: newProductId, factoryId, resubmissionCompletion: true }))
      .rejects.toThrow(/無權限/);
    expect((await db.getFactoryById(factoryId))?.ownerName).toBe("補上的負責人");
  });

  it("I. owner 沒帶補全旗標（一般 archived 操作）→ Batch 2.5 guard 照舊拒絕", async () => {
    await expect(caller(ownerId).factory.update({ id: factoryId, ownerName: "no flag" })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).product.create({ factoryId, name: "no flag" })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).product.update({ id: newProductId, factoryId, name: "no flag" })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).product.delete({ id: newProductId, factoryId })).rejects.toThrow(ARCHIVED);
  });

  it("J. 補全模式以外的資源一律拒絕：分類、照片、徽章、邀請、新合作確認單、聊天", async () => {
    await expect(caller(ownerId).category.create({ factoryId, name: "新分類" })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).factory.updateVisibleBadges({ factoryId, visibleBadgeIds: [] })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).factory.updateCoverCrop({ factoryId, crop: null })).rejects.toThrow(ARCHIVED);
    await expect(caller(ownerId).factory.inviteCoManager({ email: `arc-b-buyer-${runId}@example.test` })).rejects.toThrow(ARCHIVED);
    // 新對話／新詢價
    await expect(caller(buyerId).chat.getOrCreate({ factoryId })).rejects.toThrow(/此工廠目前無法接受新詢問/);
    await expect(caller(buyerId).inquiryBatch.createAndSend({ title: "t", message: "m", factoryIds: [factoryId] })).rejects.toThrow(/目前無法接受新詢問/);
    // 新合作確認單：先放一筆既有對話
    const conn = (await db.getDb())!;
    const [cv] = (await conn.execute(sql`INSERT INTO conversations (userId, factoryId, lastMessageAt) VALUES (${buyerId}, ${factoryId}, NOW())`)) as unknown as [{ insertId: number }, unknown];
    await expect(caller(ownerId).collaborationOrder.create({ conversationId: cv.insertId, projectName: "新案", description: "新案內容" }))
      .rejects.toThrow(/無法建立新的合作確認單/);
    await expect(caller(ownerId).chat.send({ conversationId: cv.insertId, content: "補全期間傳訊" }))
      .rejects.toThrow(/此對話僅供查看歷史紀錄/);
  });

  it("K. admin 維護權限不受影響（封面顯示範圍）", async () => {
    await expect(caller(adminId, true).factory.updateCoverCrop({ factoryId, crop: null })).resolves.toMatchObject({ crop: null });
  });

  it("E. 補齊後送出 → 伺服器重新驗證 → pending、deletedAt=null（不是 approved）", async () => {
    const req = await caller(ownerId).factory.getResubmissionRequirements();
    expect(req?.canSubmit).toBe(true);
    await caller(ownerId).factory.submitForReview();
    const row = await db.getFactoryById(factoryId);
    expect(row?.status).toBe("pending");
    expect(row?.deletedAt).toBeNull();
    expect(await caller(null).factory.getById({ id: factoryId })).toBeNull(); // pending 仍不公開
    // 已不是封存狀態：補全旗標不再有特權，pending 工廠照原本規則不能修改
    await expect(caller(ownerId).factory.update({ id: factoryId, ownerName: "再改", resubmissionCompletion: true }))
      .rejects.toThrow(/審核中/);
    expect(await caller(ownerId).factory.getResubmissionRequirements()).toBeNull();
  });
});

describe("補全旗標對一般（未封存）工廠沒有任何特權", () => {
  it("approved 工廠帶旗標更新：照原本規則需透過修改申請", async () => {
    const ownerId = await mkUser("n-owner");
    const conn = (await db.getDb())!;
    const [f] = (await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, ownerName, status, operationStatus, certified, subIndustry, createdAt, updatedAt)
      VALUES (${ownerId}, ${`ARC-normal-${runId}`}, ${JSON.stringify([TEST_INDUSTRY])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", "地址", "負責人", "approved", "normal", FALSE, "[]", NOW(), NOW())
    `)) as unknown as [{ insertId: number }, unknown];
    factoryIds.push(f.insertId);
    await expect(caller(ownerId).factory.update({ id: f.insertId, ownerName: "改", resubmissionCompletion: true }))
      .rejects.toThrow(/修改申請/);
  });
});
