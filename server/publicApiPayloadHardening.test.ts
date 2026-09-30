/**
 * Batch 3.4 Phase 2：公開／一般使用者 API 的資料邊界與 payload — 整合測試，真的走
 * 本機測試資料庫與 tRPC router。
 *
 *   - favorite.getByUser：只回傳 FactoryCardDTO（先前會帶出 ownerId、rejectionReason…）
 *   - review.getByFactory：不公開 userId／collaborationOrderId，改回傳 isMine
 *   - news.list／getBySlug：明確白名單；列表不帶 content；都不帶內部欄位
 *   - factory.getSimilar：FactoryCardDTO，候選／順序／數量與演算法結果完全相同
 *   - factory.getById：公開視角商品不帶 factoryId／createdAt／updatedAt；owner 視角不變
 *   - announcement.list：limit 上限 100
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";
import { toFactoryCardDTO, toPublicReviewDTO, toPublicProductDTO } from "./publicFactoryDto";
import { toPublicNewsListItem, toPublicNewsDetail } from "./publicNewsDto";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const IND = `PAH_IND_${runId}`;
const REGION = `PAH${Math.random().toString(36).slice(2, 9)}`;
const userIds: number[] = [];
const factoryIds: number[] = [];
const newsIds: number[] = [];

const CARD_KEYS = ["avatarCrop", "avatarUrl", "avgRating", "businessType", "id", "industry", "mfgModes", "name", "region", "reviewCount", "subIndustry"];
const FACTORY_INTERNAL = ["ownerId", "rejectionReason", "submittedAt", "updatedAt", "adminNote", "contactStatus", "deletedAt", "certificationEvidence", "certificationBadges", "taxId", "contactEmail", "phone", "status"];
const REVIEW_KEYS = ["comment", "createdAt", "id", "isMine", "projectName", "rating", "repliedAt", "reply", "reviewType", "userName"];
const NEWS_LIST_KEYS = ["firstPublishedAt", "id", "industryNames", "isCompetition", "isCrossIndustry", "isExhibition", "isImportant", "isRead", "publishedAt", "slug", "summary", "title"];
const NEWS_INTERNAL = ["createdBy", "emailNotificationSentAt", "coverImageKey", "status", "createdAt", "updatedAt"];
const PRODUCT_KEYS = ["acceptSmallOrder", "categoryId", "description", "id", "imageCrops", "images", "name", "priceMax", "priceMin", "priceType", "provideSample"];

const anon = (): TrpcContext => ({ user: null, req: { protocol: "https", headers: {} }, res: { clearCookie() {} } } as unknown as TrpcContext);
async function as(userId: number): Promise<TrpcContext> {
  const u = await db.getUserById(userId);
  return { user: { ...u!, isAdmin: false }, req: { protocol: "https", headers: {} }, res: { clearCookie() {} } } as unknown as TrpcContext;
}
async function mkUser(label: string) { const id = await ensureTestUser(`pah-${label}-${runId}`, `PAH ${label}`); userIds.push(id); return id; }
async function mkFactory(label: string, ownerId: number, opts: { status?: string; rating?: string; reviews?: number } = {}) {
  const conn = (await db.getDb())!;
  const [r] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, description, capitalLevel, ownerName, phone, contactEmail, address, taxId, avgRating, reviewCount, status, avatarUrl,
      businessType, operationStatus, certified, subIndustry, certificationBadges, certificationBadgesVisible, certificationEvidence, submittedAt, rejectionReason, contactStatus, adminNote)
    VALUES (${ownerId}, ${`PAH 工廠 ${label} ${runId}`}, ${JSON.stringify([IND])}, '["OEM"]', ${REGION}, '描述', '<1000萬', '負責人', '02-1234-5678', 'x@example.test', '地址', ${String(Math.floor(10000000 + Math.random() * 89999999))},
      ${opts.rating ?? "4.00"}, ${opts.reviews ?? 1}, ${opts.status ?? "approved"}, 'https://img.example.test/a.jpg', 'factory', 'normal', FALSE, '[]', '["bni"]', '["bni"]',
      ${JSON.stringify([{ badgeId: "bni", description: "secret", imageKeys: ["private/k"] }])}, NOW(), '內部駁回紀錄', 'follow_up', '內部 CRM 備註')
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(r.insertId);
  return r.insertId;
}

let owner: number, buyer: number, other: number, fMain: number, fDelisted: number;
beforeAll(async () => {
  owner = await mkUser("owner"); buyer = await mkUser("buyer"); other = await mkUser("other");
  fMain = await mkFactory("main", owner, { rating: "4.50", reviews: 2 });
  for (let i = 0; i < 4; i++) await mkFactory(`sim${i}`, await mkUser(`simowner${i}`), { rating: `${3 + i * 0.3}`.slice(0, 4), reviews: i });
  fDelisted = await mkFactory("delisted", await mkUser("delowner"), { status: "delisted" });
  const conn = (await db.getDb())!;
  await conn.execute(sql`INSERT INTO favorites (userId, factoryId) VALUES (${buyer}, ${fMain}), (${buyer}, ${fDelisted})`);
  await conn.execute(sql`INSERT INTO reviews (factoryId, userId, rating, comment) VALUES (${fMain}, ${buyer}, 5, '很好'), (${fMain}, ${other}, 4, '不錯')`);
  await conn.execute(sql`INSERT INTO products (factoryId, name, description, images) VALUES (${fMain}, '測試商品', '說明', '["https://img.example.test/p.jpg"]')`);
  for (const [slug, status] of [[`pah-pub-${runId}`, "published"], [`pah-draft-${runId}`, "draft"]] as const) {
    const [n] = (await conn.execute(sql`
      INSERT INTO news (slug, title, summary, content, status, isImportant, publishedAt, firstPublishedAt, emailNotificationSentAt, createdBy, coverImageKey, coverImageUrl, sourceName)
      VALUES (${slug}, ${`標題 ${slug}`}, '摘要', ${"完整正文 ".repeat(200)}, ${status}, TRUE, ${status === "published" ? sql`NOW()` : null}, ${status === "published" ? sql`NOW()` : null}, NOW(), ${owner}, 'news-covers/1/k.png', 'https://img.example.test/c.png', '來源')
    `)) as unknown as [{ insertId: number }, unknown];
    newsIds.push(n.insertId);
  }
}, 120000);

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) {
    for (const id of newsIds) await conn.execute(sql`DELETE FROM news WHERE id = ${id}`);
    for (const id of factoryIds) {
      await conn.execute(sql`DELETE FROM favorites WHERE factoryId = ${id}`);
      await conn.execute(sql`DELETE FROM reviews WHERE factoryId = ${id}`);
      await conn.execute(sql`DELETE FROM products WHERE factoryId = ${id}`);
      await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
    }
  }
  for (const id of userIds) await deleteTestUser(id);
}, 120000);

describe("favorite.getByUser（本輪主要 security fix）", () => {
  it("A–H：可見工廠只回傳 11 個卡片欄位，不含 ownerId／rejectionReason／submittedAt／updatedAt／adminNote／contactStatus／deletedAt；已下架的仍是 id＋名稱＋isUnavailable", async () => {
    const res = await appRouter.createCaller(await as(buyer)).favorite.getByUser({ page: 1, pageSize: 100 });
    const main = res.items.find(i => i.id === fMain) as Record<string, unknown>;
    const del = res.items.find(i => i.id === fDelisted) as Record<string, unknown>;
    expect(Object.keys(main).sort()).toEqual(CARD_KEYS);
    for (const k of FACTORY_INTERNAL) expect(main).not.toHaveProperty(k);
    expect(Object.keys(del).sort()).toEqual(["id", "isUnavailable", "name"]);
    expect(JSON.stringify(res)).not.toMatch(/內部駁回紀錄|內部 CRM 備註|private\/k/);
    expect(res.total).toBe(2);
  });

  it("I：DTO 是明確白名單——來源資料多出任何（未來新增的）內部欄位都不會被帶出", async () => {
    const full = (await db.getFactoryById(fMain))!;
    const dto = toFactoryCardDTO({ ...full, futureInternalSecret: "sentinel" } as any);
    expect(Object.keys(dto).sort()).toEqual(CARD_KEYS);
    expect(JSON.stringify(dto)).not.toContain("sentinel");
  });

  it("收藏／取消收藏／是否收藏的行為不變", async () => {
    const caller = appRouter.createCaller(await as(other));
    expect(await caller.favorite.isLiked({ factoryId: fMain })).toEqual({ isFavorited: false });
    await caller.favorite.toggle({ factoryId: fMain });
    expect(await caller.favorite.isLiked({ factoryId: fMain })).toEqual({ isFavorited: true });
    expect((await caller.favorite.getByUser({ page: 1, pageSize: 20 })).items.map(i => i.id)).toContain(fMain);
    await caller.favorite.toggle({ factoryId: fMain });
    expect(await caller.favorite.isLiked({ factoryId: fMain })).toEqual({ isFavorited: false });
  });
});

describe("review.getByFactory（公開評價隱私）", () => {
  it("匿名：不含 userId／collaborationOrderId，isMine 一律 false", async () => {
    const res = await appRouter.createCaller(anon()).review.getByFactory({ factoryId: fMain, page: 1, pageSize: 10 });
    expect(res.total).toBe(2);
    for (const r of res.items) {
      expect(Object.keys(r).sort()).toEqual(REVIEW_KEYS);
      expect(r).not.toHaveProperty("userId");
      expect(r).not.toHaveProperty("collaborationOrderId");
      expect(r.isMine).toBe(false);
    }
  });

  it("登入：自己的評價 isMine=true、別人的 false；內容與順序和原本相同", async () => {
    const raw = await db.getReviewsByFactory(fMain, 1, 10);
    const res = await appRouter.createCaller(await as(buyer)).review.getByFactory({ factoryId: fMain, page: 1, pageSize: 10 });
    expect(res.items.map(r => r.id)).toEqual(raw.items.map(r => r.id));
    expect(res.items.map(r => r.comment)).toEqual(raw.items.map(r => r.comment));
    const mine = res.items.find(r => r.comment === "很好")!;
    const theirs = res.items.find(r => r.comment === "不錯")!;
    expect(mine.isMine).toBe(true);
    expect(theirs.isMine).toBe(false);
  });

  it("DTO：沒有登入者時 isMine=false（不會因 undefined === undefined 誤判）", () => {
    const row = { id: 1, rating: 5, comment: "x", createdAt: new Date(), userId: 7, userName: "u", reply: null, repliedAt: null, reviewType: null, collaborationOrderId: 99, projectName: null };
    expect(toPublicReviewDTO(row, undefined).isMine).toBe(false);
    expect(toPublicReviewDTO(row, 7).isMine).toBe(true);
    expect(toPublicReviewDTO(row, 8)).not.toHaveProperty("collaborationOrderId");
  });
});

describe("news.list／getBySlug（公開消息）", () => {
  it("列表：沒有 content，也沒有 createdBy／emailNotificationSentAt／coverImageKey／status 等內部欄位；排序與數量不變", async () => {
    const raw = await db.listPublicNews({ category: "all", offset: 0, limit: 50 });
    const res = await appRouter.createCaller(anon()).news.list({ category: "all", offset: 0, limit: 50 });
    expect(res.total).toBe(raw.total);
    expect(res.items.map(i => i.slug)).toEqual(raw.items.map(i => i.slug));
    const mine = res.items.find(i => i.slug === `pah-pub-${runId}`)!;
    expect(Object.keys(mine).sort()).toEqual(NEWS_LIST_KEYS);
    expect(mine).not.toHaveProperty("content");
    for (const k of NEWS_INTERNAL) expect(mine).not.toHaveProperty(k);
    expect(res.items.some(i => i.slug === `pah-draft-${runId}`)).toBe(false);
  });

  it("詳情：有完整 content 與附件，沒有內部欄位；未發布仍是 NOT_FOUND", async () => {
    const d = await appRouter.createCaller(anon()).news.getBySlug({ slug: `pah-pub-${runId}` });
    expect(d.content).toContain("完整正文");
    expect(Array.isArray(d.attachments)).toBe(true);
    for (const k of NEWS_INTERNAL) expect(d).not.toHaveProperty(k);
    expect(d.coverImageUrl).toBe("https://img.example.test/c.png");
    await expect(appRouter.createCaller(anon()).news.getBySlug({ slug: `pah-draft-${runId}` })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("DTO 是明確白名單：來源多出的欄位不會被帶出", async () => {
    const row = (await db.getPublishedNewsBySlug(`pah-pub-${runId}`))!;
    expect(Object.keys(toPublicNewsListItem({ ...row, industryNames: [], isRead: false, sentinel: 1 } as any)).sort()).toEqual(NEWS_LIST_KEYS);
    expect(JSON.stringify(toPublicNewsDetail({ ...row, sentinel: "leak" } as any, [], []))).not.toContain("leak");
  });
});

describe("factory.getSimilar", () => {
  it("只改輸出形狀：候選／順序／數量和 db.getSimilarFactories 完全相同，每筆都是 11 個卡片欄位", async () => {
    const raw = await db.getSimilarFactories(fMain, 12);
    const res = await appRouter.createCaller(anon()).factory.getSimilar({ factoryId: fMain, limit: 12 });
    expect(raw.length).toBeGreaterThan(0);
    expect(res.map(f => f.id)).toEqual(raw.map(f => f.id));
    for (const f of res) {
      expect(Object.keys(f).sort()).toEqual(CARD_KEYS);
      for (const k of FACTORY_INTERNAL) expect(f).not.toHaveProperty(k);
    }
  });
});

describe("factory.getById 商品", () => {
  it("公開視角：商品只有 11 個欄位（沒有 factoryId／createdAt／updatedAt）", async () => {
    const d = (await appRouter.createCaller(anon()).factory.getById({ id: fMain }))!;
    expect(d.products).toHaveLength(1);
    expect(Object.keys(d.products[0]).sort()).toEqual(PRODUCT_KEYS);
    expect(Object.keys(toPublicProductDTO({ ...(d.products[0] as any), secret: 1 })).sort()).toEqual(PRODUCT_KEYS);
  });

  it("owner 視角（includeRevision）：商品維持完整資料（後台管理需要）", async () => {
    const d = (await appRouter.createCaller(await as(owner)).factory.getById({ id: fMain, includeRevision: true }))!;
    expect(d.products[0]).toHaveProperty("factoryId", fMain);
    expect(d.products[0]).toHaveProperty("createdAt");
  });
});

describe("announcement.list 上限", () => {
  it("3／20／50／100 與預設值可用；101 與超大值被拒絕", async () => {
    const caller = appRouter.createCaller(anon());
    for (const limit of [3, 20, 50, 100]) await expect(caller.announcement.list({ limit })).resolves.toBeInstanceOf(Array);
    await expect(caller.announcement.list({} as any)).resolves.toBeInstanceOf(Array);
    for (const limit of [101, 100000, 0, -1]) await expect(caller.announcement.list({ limit })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
