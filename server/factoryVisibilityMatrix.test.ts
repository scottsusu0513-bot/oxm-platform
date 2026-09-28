/**
 * 工廠可見性／互動授權矩陣（Production Hardening Batch 2）— 整合測試，真的走
 * 本機測試資料庫與 appRouter.createCaller。
 *
 * 規則（見 server/factoryVisibility.ts）：
 *   - 公開讀取（anonymous／buyer）：只有 approved 且 deletedAt IS NULL。
 *   - owner／active co-manager／admin：自己工廠任何狀態都能照常讀取管理資料。
 *   - 新的 buyer → factory 互動（新對話、一鍵詢價、新評價、新收藏）：只允許
 *     公開工廠；既有對話不因工廠之後下架／刪除而中斷。
 *
 * 狀態 × 角色：approved／draft／rejected／delisted／soft-deleted ×
 * anonymous／buyer／owner／co-manager／admin。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_INDUSTRY = `FVM_TEST_${runId}`;
const STATES = ["approved", "draft", "rejected", "delisted", "softDeleted"] as const;
type State = (typeof STATES)[number];

type Fixture = { factoryId: number; ownerId: number; coManagerId: number; productId: number; categoryId: number; photoId: number; reviewId: number };
const fx = {} as Record<State, Fixture>;
const userIds: number[] = [];
let buyerId = 0;
let reviewerId = 0;
let adminId = 0;

async function mkUser(label: string): Promise<number> {
  const id = await ensureTestUser(`fvm-${label}-${runId}`, `可見性矩陣-${label}`);
  userIds.push(id);
  const conn = await db.getDb();
  await conn!.execute(sql`UPDATE users SET primaryEmail = ${`fvm-${label}-${runId}@example.test`}, primaryEmailVerifiedAt = NOW() WHERE id = ${id}`);
  return id;
}

function ctx(userId: number | null, opts: { isAdmin?: boolean } = {}): TrpcContext {
  const user = userId === null ? null : ({
    id: userId, openId: `fvm-ctx-${userId}`, email: `fvm-ctx-${userId}@example.test`, name: "FVM",
    role: opts.isAdmin ? "admin" : "user", isAdmin: !!opts.isAdmin, isFactoryOwner: false,
    primaryEmail: `fvm-ctx-${userId}@example.test`, primaryEmailVerifiedAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as unknown as NonNullable<TrpcContext["user"]>);
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}
const caller = (userId: number | null, opts?: { isAdmin?: boolean }) => appRouter.createCaller(ctx(userId, opts));

beforeAll(async () => {
  const conn = (await db.getDb())!;
  buyerId = await mkUser("buyer");
  reviewerId = await mkUser("reviewer");
  adminId = await mkUser("admin");
  for (const state of STATES) {
    const ownerId = await mkUser(`owner-${state}`);
    const coManagerId = await mkUser(`co-${state}`);
    const status = state === "softDeleted" ? "delisted" : state;
    const [f] = (await conn.execute(sql`
      INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, deletedAt, createdAt, updatedAt)
      VALUES (${ownerId}, ${`FVM-${state}-${runId}`}, ${JSON.stringify([TEST_INDUSTRY])}, ${JSON.stringify(["ODM"])}, "新竹市", "<1000萬", "FVM 測試地址", ${status}, "normal", FALSE, "[]", ${state === "softDeleted" ? new Date() : null}, NOW(), NOW())
    `)) as unknown as [{ insertId: number }, unknown];
    const factoryId = f.insertId;
    await conn.execute(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy) VALUES (${factoryId}, ${coManagerId}, ${ownerId})`);
    const [c] = (await conn.execute(sql`INSERT INTO productCategories (factoryId, name) VALUES (${factoryId}, ${`分類-${state}`})`)) as unknown as [{ insertId: number }, unknown];
    const productId = await db.createProduct({ factoryId, name: `商品-${state}-${runId}`, acceptSmallOrder: false, provideSample: false });
    const [p] = (await conn.execute(sql`INSERT INTO factoryPhotos (factoryId, url) VALUES (${factoryId}, ${`https://example.test/${state}.jpg`})`)) as unknown as [{ insertId: number }, unknown];
    const [r] = (await conn.execute(sql`INSERT INTO reviews (factoryId, userId, rating, comment) VALUES (${factoryId}, ${reviewerId}, 5, ${`評價-${state}`})`)) as unknown as [{ insertId: number }, unknown];
    fx[state] = { factoryId, ownerId, coManagerId, productId, categoryId: c.insertId, photoId: p.insertId, reviewId: r.insertId };
  }
}, 120000);

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const state of STATES) {
      if (fx[state]) await conn.execute(sql`DELETE FROM factories WHERE id = ${fx[state].factoryId}`);
    }
  }
  for (const id of userIds) await deleteTestUser(id);
}, 120000);

/** 以某個角色讀取一間工廠的所有公開 API，回傳「是否真的拿到內容」。 */
async function readAll(state: State, c: ReturnType<typeof caller>) {
  const f = fx[state];
  const [detail, products, product, categories, photos, reviews] = await Promise.all([
    c.factory.getById({ id: f.factoryId }),
    c.product.getByFactory({ factoryId: f.factoryId }),
    c.product.getById({ id: f.productId }),
    c.category.getByFactory({ factoryId: f.factoryId }),
    c.factory.getPhotos({ factoryId: f.factoryId }),
    c.review.getByFactory({ factoryId: f.factoryId }),
  ]);
  return {
    detail: detail != null,
    products: products.some(p => p.id === f.productId),
    productById: product?.id === f.productId,
    categories: categories.some(x => x.id === f.categoryId),
    photos: photos.some(x => x.id === f.photoId),
    reviews: reviews.items.some((x: { id: number }) => x.id === f.reviewId),
  };
}

const ALL_TRUE = { detail: true, products: true, productById: true, categories: true, photos: true, reviews: true };
const ALL_FALSE = { detail: false, products: false, productById: false, categories: false, photos: false, reviews: false };

describe("PUBLIC READ：anonymous／buyer 只能讀 approved + 未刪除", () => {
  it.each(STATES)("anonymous × %s", async (state) => {
    expect(await readAll(state, caller(null))).toEqual(state === "approved" ? ALL_TRUE : ALL_FALSE);
  });
  it.each(STATES)("buyer × %s", async (state) => {
    expect(await readAll(state, caller(buyerId))).toEqual(state === "approved" ? ALL_TRUE : ALL_FALSE);
  });
  it("另一間工廠的 owner 也不能讀非公開工廠（不是自己的）", async () => {
    expect(await readAll("rejected", caller(fx.draft.ownerId))).toEqual(ALL_FALSE);
  });
});

describe("MANAGEMENT READ：owner／co-manager／admin 任何狀態都照常", () => {
  it.each(STATES)("owner × %s", async (state) => {
    expect(await readAll(state, caller(fx[state].ownerId))).toEqual(ALL_TRUE);
  });
  it.each(STATES)("co-manager × %s", async (state) => {
    expect(await readAll(state, caller(fx[state].coManagerId))).toEqual(ALL_TRUE);
  });
  it.each(STATES)("admin × %s", async (state) => {
    expect(await readAll(state, caller(adminId, { isAdmin: true }))).toEqual(ALL_TRUE);
  });
});

describe("PUBLIC DISCOVERY：search／sitemap／SEO existence 只含 approved + 未刪除", () => {
  it("factory.search 只回傳 approved 那一間", async () => {
    const res = await caller(null).factory.search({ industry: [TEST_INDUSTRY], pageSize: 50 });
    expect(res.items.map(f => f.id)).toEqual([fx.approved.factoryId]);
    expect(res.total).toBe(1);
  });
  it("sitemap 工廠清單只含 approved 那一間", async () => {
    const ids = new Set((await db.getApprovedFactoriesForSitemap()).map(r => r.id));
    for (const state of STATES) expect(ids.has(fx[state].factoryId)).toBe(state === "approved");
  });
  it("approved 但 deletedAt 有值（不應存在的矛盾狀態）也不會被公開", async () => {
    const conn = (await db.getDb())!;
    await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${fx.softDeleted.factoryId}`);
    try {
      expect(await readAll("softDeleted", caller(null))).toEqual(ALL_FALSE);
      const res = await caller(null).factory.search({ industry: [TEST_INDUSTRY], pageSize: 50 });
      expect(res.items.map(f => f.id)).not.toContain(fx.softDeleted.factoryId);
      const ids = new Set((await db.getApprovedFactoriesForSitemap()).map(r => r.id));
      expect(ids.has(fx.softDeleted.factoryId)).toBe(false);
    } finally {
      await conn.execute(sql`UPDATE factories SET status = 'delisted' WHERE id = ${fx.softDeleted.factoryId}`);
    }
  });
});

describe("NEW INTERACTION：buyer 只能對公開工廠建立新互動，訊息不透露狀態", () => {
  const NON_PUBLIC: State[] = ["draft", "rejected", "delisted", "softDeleted"];
  const UNAVAILABLE = /此工廠目前無法接受新詢問/;

  it.each(NON_PUBLIC)("chat.getOrCreate × %s → FORBIDDEN（統一訊息）", async (state) => {
    await expect(caller(buyerId).chat.getOrCreate({ factoryId: fx[state].factoryId })).rejects.toThrow(UNAVAILABLE);
  });
  it.each(NON_PUBLIC)("chat.sendFirstMessage × %s → FORBIDDEN，不建立對話", async (state) => {
    await expect(caller(buyerId).chat.sendFirstMessage({ factoryId: fx[state].factoryId, content: "詢價" })).rejects.toThrow(UNAVAILABLE);
    expect(await db.hasConversationBetween(buyerId, fx[state].factoryId)).toBe(false);
  });
  it("不存在的工廠 → 同一個訊息（避免 enumeration）", async () => {
    await expect(caller(buyerId).chat.getOrCreate({ factoryId: 999999999 })).rejects.toThrow(UNAVAILABLE);
  });
  it.each(NON_PUBLIC)("inquiryBatch.createAndSend × %s → FORBIDDEN，錯誤訊息不含工廠名稱", async (state) => {
    const err = await caller(buyerId).inquiryBatch.createAndSend({ title: "t", message: "m", factoryIds: [fx.approved.factoryId, fx[state].factoryId] }).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toMatch(/目前無法接受新詢問/);
    expect(String(err.message)).not.toContain(`FVM-${state}`);
  });
  it.each(NON_PUBLIC)("review.create × %s → FORBIDDEN", async (state) => {
    await expect(caller(buyerId).review.create({ factoryId: fx[state].factoryId, rating: 5 })).rejects.toThrow(UNAVAILABLE);
  });
  it.each(NON_PUBLIC)("favorite.toggle（新增）× %s → FORBIDDEN", async (state) => {
    await expect(caller(buyerId).favorite.toggle({ factoryId: fx[state].factoryId })).rejects.toThrow(UNAVAILABLE);
  });
  it("approved：chat.getOrCreate 正常建立", async () => {
    const conv = await caller(buyerId).chat.getOrCreate({ factoryId: fx.approved.factoryId });
    expect(conv?.factoryId).toBe(fx.approved.factoryId);
  });
  it("admin 仍可開啟與非公開工廠的對話（內部流程不被誤擋）", async () => {
    const conv = await caller(adminId, { isAdmin: true }).chat.getOrCreate({ factoryId: fx.draft.factoryId });
    expect(conv?.factoryId).toBe(fx.draft.factoryId);
  });
});

describe("EXISTING RELATIONSHIPS：工廠之後下架／刪除，既有對話與收藏不中斷", () => {
  it("既有收藏在工廠變成非公開後仍可取消", async () => {
    const conn = (await db.getDb())!;
    await conn.execute(sql`INSERT INTO favorites (userId, factoryId) VALUES (${buyerId}, ${fx.delisted.factoryId})`);
    const res = await caller(buyerId).favorite.toggle({ factoryId: fx.delisted.factoryId });
    expect(res.isFavorited).toBe(false);
  });
});
