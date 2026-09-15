/**
 * 工廠公開頁「資料最近維護時間」（factories.publicContentUpdatedAt）—
 * 整合測試，真的走資料庫（沿用 server/factoryPageStatus.test.ts、
 * server/_core/financeTestFixtures.ts 已驗證過的 fixture 模式，不是 mock）。
 *
 * 背景：factories.updatedAt 是 `.onUpdateNow()`（ON UPDATE CURRENT_TIMESTAMP），
 * 同一張表任何一次真的改變欄位值的 UPDATE 都會讓它跳動——包含 CRM
 * contactStatus／adminNote、審核狀態（approve／delist）等完全不影響公開
 * 內容的操作，因此不能拿來當「公開資料最近維護時間」顯示給使用者看。
 * publicContentUpdatedAt 改成完全由應用層在偵測到 PUBLIC_CONTENT_FACTORY_FIELDS
 * 白名單內的欄位、或關聯的商品／工廠圖片實際新增／修改／刪除時，才明確 SET。
 *
 * 產品定義（已確認、非 bug）：這個欄位代表「工廠近期仍有主動維護自己在
 * OXM 上的公開資料」，只要工廠端執行公開資料的儲存／維護動作就可以刷新，
 * **不要求**這次送出的值與資料庫現有值不同——工廠重新進後台確認資料後
 * 原封不動再存一次，也視為一次主動維護，一樣要刷新。因此這裡刻意**不**
 * 測試「同值重送不得刷新」，反而明確測試「同值重送仍然刷新」（見下方
 * 「同值重送」測試），避免未來有人誤把這個行為當成 bug 修掉。
 *
 * 這裡驗證：新工廠有合理初始值、白名單欄位變更會刷新（含同值重送）、
 * 商品／工廠圖片異動會刷新、CRM／審核狀態／delisted／系統統計欄位不會
 * 刷新，以及「已上線工廠的修改申請」流程（approveRevisionAtomic）也正確
 * 依同一份白名單判斷。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import * as db from "./db";
import { factories } from "../drizzle/schema";
import { ensureTestUser, createTestFactory, deleteTestFactory, deleteTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let ownerId: number;
let factoryId: number;

async function getPublicContentUpdatedAt(id: number): Promise<Date> {
  const factory = await db.getFactoryById(id);
  if (!factory) throw new Error("factory not found");
  return new Date((factory as any).publicContentUpdatedAt);
}

/** 把 publicContentUpdatedAt 撥回一段時間之前，方便斷言「後續操作有沒有把它
 *  改成之後的時間」。刻意用跟 db.touchFactoryPublicContentUpdatedAt／
 *  db.updateFactory 完全相同的 drizzle `.update(factories).set(...)` 寫入
 *  路徑（不是另外用 raw sql 樣板塞 Date）——TIMESTAMP 欄位的 session
 *  time_zone 轉換會讓「raw sql 樣板直接帶入 Date」跟「drizzle .set() 帶入
 *  Date」序列化成不同的值，兩種寫法混用會讓這裡量出來的「之前」時間跟
 *  正式程式碼實際寫入的「之後」時間不是同一個時區基準，導致誤判。寫入後
 *  再用跟正式讀取路徑相同的 getPublicContentUpdatedAt() 讀回目前值，確保
 *  「之前」與「之後」是同一套讀寫路徑量出來的值，才能公平比較。 */
async function rewindPublicContentUpdatedAt(id: number, msAgo: number): Promise<Date> {
  const conn = await db.getDb();
  if (!conn) throw new Error("no db");
  const past = new Date(Date.now() - msAgo);
  await conn.update(factories).set({ publicContentUpdatedAt: past }).where(eq(factories.id, id));
  return getPublicContentUpdatedAt(id);
}

beforeAll(async () => {
  ownerId = await ensureTestUser(`pcua-owner-${runId}`, "公開更新時間測試擁有者");
  factoryId = await createTestFactory(ownerId, `公開更新時間測試-${runId}`, "draft");
});

afterAll(async () => {
  await deleteTestFactory(factoryId);
  await deleteTestUser(ownerId);
});

describe("新工廠：一開始就有合理初始值", () => {
  it("(1) 剛建立的工廠 publicContentUpdatedAt 不是 null，且是合理的近期時間", async () => {
    const value = await getPublicContentUpdatedAt(factoryId);
    expect(value).toBeInstanceOf(Date);
    expect(isNaN(value.getTime())).toBe(false);
    expect(Date.now() - value.getTime()).toBeLessThan(60_000);
  });
});

describe("白名單公開欄位變更 → 更新 publicContentUpdatedAt", () => {
  it("(2) 修改工廠名稱 → 更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.updateFactory(factoryId, -1, { name: `改名後-${runId}` });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });

  it("(3) 修改簡介 → 更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.updateFactory(factoryId, -1, { description: "新的公司簡介內容" });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });

  it("(5) 修改產業／地區 → 更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.updateFactory(factoryId, -1, { industry: ["紡織"], region: "台中市" });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });

  it("其他公開欄位（電話、網站、營業時間、資本額、成立年份）變更也會更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.updateFactory(factoryId, -1, {
      phone: "03-1234567",
      website: "https://example.test",
      weekdayHours: "09:00-18:00",
      capitalLevel: "1000~5000萬",
      foundedYear: 2010,
    });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });

  it("同值重送（工廠重新進後台確認後原封不動再存一次）仍然刷新——這是產品定義，不是 bug", async () => {
    const current = await db.getFactoryById(factoryId);
    const sameName = current!.name;
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.updateFactory(factoryId, -1, { name: sameName });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });
});

describe("非公開欄位變更 → 不更新 publicContentUpdatedAt", () => {
  it("(11) adminNote 修改 → 不更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.updateFactoryContactInfo(factoryId, { adminNote: "內部備註，測試用" });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBe(past.getTime());
  });

  it("(12) CRM contactStatus 修改 → 不更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.updateFactoryContactInfo(factoryId, { contactStatus: "follow_up" });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBe(past.getTime());
  });

  it("(13) 審核通過（approved）→ 不更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.approveFactoryWithBadgeSync(factoryId);
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBe(past.getTime());
  });

  it("(13) 下架（delisted）→ 不更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    const delisted = await db.delistFactory(factoryId);
    expect(delisted).toBe(true);
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBe(past.getTime());
    // 還原成 approved，後續測試仍假設這筆工廠處於 draft／approved 皆可運作的情境，
    // 這裡改回 approved 避免影響後面商品／照片測試對狀態沒有假設但求乾淨。
    await db.approveFactoryWithBadgeSync(factoryId);
  });
});

describe("商品新增／修改／刪除 → 更新 publicContentUpdatedAt", () => {
  let productId: number;

  it("(8) 新增商品 → 更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    productId = await db.createProduct({ factoryId, name: `測試商品-${runId}` });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });

  it("(9) 修改商品 → 更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.updateProduct(productId, factoryId, { description: "商品描述更新" });
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });

  it("(10) 刪除商品 → 更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.deleteProduct(productId, factoryId);
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });
});

describe("工廠圖片新增／刪除 → 更新 publicContentUpdatedAt", () => {
  let photoId: number;

  it("(6) 新增工廠圖片 → 更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    photoId = await db.addFactoryPhoto(factoryId, "https://example.test/photo.jpg");
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });

  it("(7) 刪除工廠圖片 → 更新", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    await db.deleteFactoryPhoto(photoId, factoryId);
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });
});

describe("approveRevisionAtomic：已上線（approved）工廠的修改申請流程", () => {
  async function insertPendingRevision(proposedData: Record<string, any>): Promise<number> {
    const conn = await db.getDb();
    if (!conn) throw new Error("no db");
    const factory = await db.getFactoryById(factoryId);
    const originalData = db.extractBasicData(factory as any);
    const [result]: any = await conn.execute(
      sql`INSERT INTO factoryRevisions (factoryId, submittedBy, originalData, proposedData, status, submittedAt)
          VALUES (${factoryId}, ${ownerId}, ${JSON.stringify(originalData)}, ${JSON.stringify(proposedData)}, 'pending', NOW())`
    );
    return result.insertId;
  }

  it("白名單欄位變更（例如名稱）通過審核 → 更新 publicContentUpdatedAt", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    const revisionId = await insertPendingRevision({ name: `修改申請改名-${runId}` });
    await db.approveRevisionAtomic(revisionId, -1);
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBeGreaterThan(past.getTime());
  });

  it("只變更 certificationBadges（不在公開內容白名單內）→ 不更新 publicContentUpdatedAt", async () => {
    const past = await rewindPublicContentUpdatedAt(factoryId, 10_000);
    const revisionId = await insertPendingRevision({ certificationBadges: [], certificationEvidence: [] });
    await db.approveRevisionAtomic(revisionId, -1);
    const after = await getPublicContentUpdatedAt(factoryId);
    expect(after.getTime()).toBe(past.getTime());
  });
});
