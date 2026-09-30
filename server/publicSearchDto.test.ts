/**
 * 公開搜尋／公開詳情的輸出形狀（Production Hardening Batch 3.1）— 整合測試，
 * 真的走本機測試資料庫。
 *
 * 正式站 audit：factory.search 每筆回傳整個 factories row（37 個欄位），包含
 * ownerId（使用者帳號 id）、rejectionReason（審核駁回理由，重新通過後仍殘留）、
 * submittedAt、contactEmail、taxId 等搜尋卡片完全用不到的欄位；factory.getById
 * 公開視角同樣回傳 ownerId／rejectionReason／submittedAt。
 *
 * 這裡驗證：
 *   A. 搜尋輸出不含內部欄位（明確白名單）
 *   B. 搜尋卡片／SEO 頁／相關工廠卡片需要的欄位都在
 *   C. 預設搜尋的 ID／順序與「相同條件的完整 row 查詢＋相同 ORDER BY」完全一致
 *   E. industry／region 篩選結果不變
 *   F. searchFingerprint 不變
 *   H. 公開詳情不洩漏內部欄位，但詳情頁需要的欄位都在
 *   I. owner 視角（getById includeRevision／getMine）維持原樣
 *   J. base64 頭貼本輪不改（DB 只有 base64、沒有替代 URL），原樣回傳，不會壞圖
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { ensureTestUser, deleteTestUser } from "./_core/financeTestFixtures";
import { buildSearchFingerprint } from "@shared/searchFingerprint";
import { toPublicFactorySearchResult } from "./publicFactoryDto";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_INDUSTRY = `PSD_IND_${runId}`;
const OTHER_INDUSTRY = `PSD_OTHER_${runId}`;
const TEST_REGION = `PSD${Math.random().toString(36).slice(2, 10)}`;
const BASE64_AVATAR = `data:image/jpeg;base64,${"A".repeat(2000)}`;

const ownerIds: number[] = [];
const factoryIds: number[] = [];

const PUBLIC_SEARCH_KEYS = [
  "id", "name", "industry", "subIndustry", "mfgModes", "region", "description", "capitalLevel", "foundedYear",
  "ownerName", "contactPersonName", "phone", "website", "address", "avgRating", "reviewCount", "avatarUrl",
  "avatarCrop", "businessType", "operationStatus", "certified", "weekdayHours", "weekendHours", "certificationBadgesVisible",
].sort();
const INTERNAL_KEYS = [
  "ownerId", "rejectionReason", "submittedAt", "adminNote", "contactStatus", "certificationEvidence", "deletedAt",
  "certificationBadges", "status", "taxId", "contactEmail", "createdAt", "updatedAt", "publicContentUpdatedAt",
  "businessNote", "coverImageUrl", "coverCrop", "avgResponseHours",
];
// 搜尋卡片（FactoryResultCard）、SEO 產業／地區頁（FactoriesLandingResults／IndustryPage）、
// Search.tsx（businessType 前端篩選）、相關工廠卡片（RelatedFactoryCard）實際讀的欄位。
const UI_REQUIRED_KEYS = [
  "id", "name", "avatarUrl", "avatarCrop", "businessType", "certificationBadgesVisible", "website", "contactPersonName",
  "ownerName", "mfgModes", "weekdayHours", "weekendHours", "operationStatus", "avgRating", "reviewCount", "description",
  "region", "foundedYear", "address", "phone", "industry", "subIndustry",
];

async function insertFactory(i: number, opts: { industry: string; rating: string; reviews: number; avatar?: string | null; name?: string }) {
  const conn = (await db.getDb())!;
  const ownerId = await ensureTestUser(`psd-owner-${i}-${runId}`, `DTO 測試擁有者-${i}`);
  ownerIds.push(ownerId);
  const [r] = (await conn.execute(sql`
    INSERT INTO factories (ownerId, name, industry, mfgModes, region, description, capitalLevel, ownerName, contactPersonName, phone, website, contactEmail, address, taxId,
      avgRating, reviewCount, status, avatarUrl, coverImageUrl, businessType, operationStatus, certified, subIndustry,
      certificationBadges, certificationBadgesVisible, certificationEvidence, weekdayHours, weekendHours, businessNote, submittedAt, rejectionReason, contactStatus, adminNote)
    VALUES (${ownerId}, ${opts.name ?? `PSD 工廠 ${i} ${runId}`}, ${JSON.stringify([opts.industry])}, ${JSON.stringify(["OEM"])}, ${TEST_REGION}, ${`描述 ${i}`}, "<1000萬",
      ${`負責人${i}`}, ${`窗口${i}`}, "02-1234-5678", "https://example.test", ${`psd-${i}@example.test`}, ${`地址 ${i}`}, "12345678",
      ${opts.rating}, ${opts.reviews}, "approved", ${opts.avatar ?? `https://img.example.test/${i}.jpg`}, "https://img.example.test/cover.jpg", "factory", "normal", FALSE, ${JSON.stringify([])},
      ${JSON.stringify(["bni", "iso9001"])}, ${JSON.stringify(["bni"])}, ${JSON.stringify([{ badgeId: "iso9001", description: "secret", imageKeys: ["private/key"] }])},
      "08:00-17:00", "休息", "備註", NOW(), "之前駁回：資料不齊（內部審核紀錄）", "follow_up", "內部 CRM 備註")
  `)) as unknown as [{ insertId: number }, unknown];
  factoryIds.push(r.insertId);
  return { id: r.insertId, ownerId };
}

let fixtures: { id: number; ownerId: number }[] = [];

beforeAll(async () => {
  fixtures = [
    await insertFactory(0, { industry: TEST_INDUSTRY, rating: "4.50", reviews: 2 }),
    await insertFactory(1, { industry: TEST_INDUSTRY, rating: "0.00", reviews: 0, avatar: BASE64_AVATAR }),
    await insertFactory(2, { industry: TEST_INDUSTRY, rating: "4.50", reviews: 2 }),
    await insertFactory(3, { industry: TEST_INDUSTRY, rating: "5.00", reviews: 1 }),
    await insertFactory(4, { industry: OTHER_INDUSTRY, rating: "3.00", reviews: 1 }),
    await insertFactory(5, { industry: TEST_INDUSTRY, rating: "0.00", reviews: 0 }),
  ];
}, 120000);

afterAll(async () => {
  const conn = await db.getDb();
  if (conn) for (const id of factoryIds) await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
  for (const id of ownerIds) await deleteTestUser(id);
}, 120000);

const publicCtx = (): TrpcContext => ({ user: null, req: { protocol: "https", headers: {} }, res: { cookie() {}, clearCookie() {}, setHeader() {} } } as unknown as TrpcContext);
async function ownerCtx(ownerId: number): Promise<TrpcContext> {
  const user = await db.getUserById(ownerId);
  return { ...publicCtx(), user } as unknown as TrpcContext;
}

/** 修改前的輸出等價參考：完整 row（SELECT *）＋相同 WHERE＋相同 ORDER BY。 */
async function referenceIds(where: ReturnType<typeof sql>) {
  const conn = (await db.getDb())!;
  const [rows] = (await conn.execute(sql`
    SELECT * FROM factories WHERE status = 'approved' AND deletedAt IS NULL AND ${where}
    ORDER BY avgRating DESC, reviewCount DESC, id ASC
  `)) as unknown as [{ id: number }[], unknown];
  return rows.map(r => r.id);
}

describe("factory.search 公開輸出", () => {
  it("A／B：items 的欄位＝明確白名單；不含任何內部欄位；UI 需要的欄位都在", async () => {
    const res = await appRouter.createCaller(publicCtx()).factory.search({ region: [TEST_REGION], page: 1, pageSize: 20 });
    expect(res.items.length).toBe(6);
    for (const item of res.items) {
      expect(Object.keys(item).sort()).toEqual(PUBLIC_SEARCH_KEYS);
      for (const k of INTERNAL_KEYS) expect(item).not.toHaveProperty(k);
      for (const k of UI_REQUIRED_KEYS) expect(item).toHaveProperty(k);
      // 隱藏徽章不外流：擁有 bni＋iso9001，只公開 bni
      expect(item.certificationBadgesVisible).toEqual(["bni"]);
    }
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("內部審核紀錄");
    expect(serialized).not.toContain("內部 CRM 備註");
    expect(serialized).not.toContain("private/key");
  });

  it("C／E：industry＋region 篩選的 total／ID／順序與完整 row 參考查詢完全一致", async () => {
    const caller = appRouter.createCaller(publicCtx());
    const byIndustry = await caller.factory.search({ industry: [TEST_INDUSTRY], page: 1, pageSize: 20 });
    const expectedIndustry = await referenceIds(sql`JSON_OVERLAPS(industry, ${JSON.stringify([TEST_INDUSTRY])})`);
    expect(byIndustry.total).toBe(expectedIndustry.length);
    expect(byIndustry.items.map(i => i.id)).toEqual(expectedIndustry);
    expect(expectedIndustry).toEqual([fixtures[3].id, fixtures[0].id, fixtures[2].id, fixtures[1].id, fixtures[5].id]);

    const byRegion = await caller.factory.search({ region: [TEST_REGION], page: 1, pageSize: 20 });
    expect(byRegion.items.map(i => i.id)).toEqual(await referenceIds(sql`region = ${TEST_REGION}`));
  });

  it("D：分頁（pageSize=2）逐頁合併＝完整結果，無重複、無遺漏", async () => {
    const caller = appRouter.createCaller(publicCtx());
    const all: number[] = [];
    for (let page = 1; page <= 4; page++) {
      const r = await caller.factory.search({ region: [TEST_REGION], page, pageSize: 2 });
      all.push(...r.items.map(i => i.id));
    }
    expect(new Set(all).size).toBe(6);
    expect(all).toEqual(await referenceIds(sql`region = ${TEST_REGION}`));
  });

  it("C：keyword relevance 路徑（JS 候選池排序）也只輸出白名單欄位，ID 與完整名稱比對一致", async () => {
    const r = await appRouter.createCaller(publicCtx()).factory.search({ keyword: `PSD 工廠 3 ${runId}`, page: 1, pageSize: 20 });
    expect(r.items[0]?.id).toBe(fixtures[3].id);
    for (const item of r.items) expect(Object.keys(item).sort()).toEqual(PUBLIC_SEARCH_KEYS);
  });

  it("F：searchFingerprint 與 buildSearchFingerprint(input) 一致", async () => {
    const input = { industry: [TEST_INDUSTRY], region: [TEST_REGION], page: 1, pageSize: 20 };
    const r = await appRouter.createCaller(publicCtx()).factory.search(input);
    expect(r.searchFingerprint).toBe(buildSearchFingerprint({ industry: input.industry, region: input.region }));
  });

  it("J：DB 只有 base64 的頭貼本輪不改，原樣回傳（不會變成壞圖或空白）", async () => {
    const r = await appRouter.createCaller(publicCtx()).factory.search({ region: [TEST_REGION], page: 1, pageSize: 20 });
    expect(r.items.find(i => i.id === fixtures[1].id)?.avatarUrl).toBe(BASE64_AVATAR);
  });

  it("ads.factory 與 items 用同一個 DTO：完整 row 轉出來也只有白名單欄位", async () => {
    const full = await db.getFactoryById(fixtures[0].id);
    const dto = toPublicFactorySearchResult(full!);
    expect(Object.keys(dto).sort()).toEqual(PUBLIC_SEARCH_KEYS);
  });
});

describe("factory.getSimilar 公開輸出", () => {
  it("Batch 3.4：相關工廠改用 FactoryCardDTO（11 個卡片欄位），不含任何內部欄位", async () => {
    const similar = await appRouter.createCaller(publicCtx()).factory.getSimilar({ factoryId: fixtures[0].id, limit: 12 });
    const CARD_KEYS = ["avatarCrop", "avatarUrl", "avgRating", "businessType", "id", "industry", "mfgModes", "name", "region", "reviewCount", "subIndustry"];
    for (const item of similar) {
      expect(Object.keys(item).sort()).toEqual(CARD_KEYS);
      for (const k of INTERNAL_KEYS) expect(item).not.toHaveProperty(k);
    }
  });
});

describe("factory.getById", () => {
  it("H：公開視角不含 ownerId／rejectionReason／submittedAt／updatedAt 等內部欄位，詳情頁需要的欄位都在", async () => {
    const d = (await appRouter.createCaller(publicCtx()).factory.getById({ id: fixtures[0].id }))!;
    for (const k of ["ownerId", "rejectionReason", "submittedAt", "updatedAt", "adminNote", "contactStatus", "certificationEvidence", "deletedAt", "certificationBadges"]) {
      expect(d).not.toHaveProperty(k);
    }
    for (const k of ["name", "description", "contactEmail", "taxId", "coverImageUrl", "coverCrop", "businessNote", "avgResponseHours", "publicContentUpdatedAt", "createdAt", "capitalLevel", "products", "avatarUrl"]) {
      expect(d).toHaveProperty(k);
    }
    expect(d.certificationBadgesVisible).toEqual(["bni"]);
  });

  it("I：owner（includeRevision）與 getMine 維持原本的完整資料（含 ownerId／rejectionReason／certificationBadges）", async () => {
    const caller = appRouter.createCaller(await ownerCtx(fixtures[0].ownerId));
    const own = (await caller.factory.getById({ id: fixtures[0].id, includeRevision: true }))!;
    expect(own.ownerId).toBe(fixtures[0].ownerId);
    expect(own.rejectionReason).toContain("內部審核紀錄");
    expect(own).toHaveProperty("submittedAt");
    expect(own.certificationBadges).toEqual(["bni", "iso9001"]);
    expect(own).not.toHaveProperty("certificationEvidence");
    const mine = (await caller.factory.getMine())!;
    expect(mine.ownerId).toBe(fixtures[0].ownerId);
    expect(mine.rejectionReason).toContain("內部審核紀錄");
    expect(mine).not.toHaveProperty("adminNote");
  });
});
