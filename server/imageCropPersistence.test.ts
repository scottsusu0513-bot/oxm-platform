/**
 * 圖片顯示範圍（zoom/posX/posY）中繼資料的實際持久化回歸測試——走真實本機
 * 測試資料庫（server/test-db-guard.ts 全域 setupFiles 已保證只會連到
 * oxm_test），用 appRouter.createCaller(ctx) 直接呼叫 tRPC procedure 或直接
 * 呼叫 db.ts 對應函式，不是只檢查 Tailwind class 字串。
 *
 * 涵蓋（見 CLAUDE.md「圖片顯示範圍規則」與本輪任務 Part 四）：
 * 1. 工廠頭貼／Logo：可調整、儲存後重新查詢仍保持一致；pending 狀態禁止調整；
 *    無關會員 FORBIDDEN。
 * 2. 工廠封面：owner／共管者皆可調整並持久化；無關會員 FORBIDDEN。
 * 3. 工廠相簿照片：每張照片的顯示範圍各自獨立調整，互不影響（避免多圖片
 *    共用同一份中繼資料被錯誤覆蓋）；舊照片沒有裁切資料時 fallback 為 null。
 * 4. 商品圖片：images／imageCrops 兩個陣列的索引對應關係，在移除中間一張圖片
 *    後仍保持正確對齊，不會發生「crop 依附錯圖片」的情況。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function ctxFor(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `image-crop-persist-${userId}`, email: `image-crop-persist-${userId}@example.test`,
    name: "Image Crop Persistence Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

const runId = `image-crop-persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmailVerifiedAt)
    VALUES (${openId}, ${`Image Crop Persist ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`}, NOW())
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

describe("工廠頭貼／Logo 顯示範圍持久化", () => {
  let ownerId: number, otherId: number;
  beforeAll(async () => {
    ownerId = await createTestUser();
    otherId = await createTestUser();
  });
  afterAll(async () => {
    await deleteTestUser(ownerId);
    await deleteTestUser(otherId);
  });

  it("draft 工廠：owner 可調整 avatarCrop，重新查詢仍保持一致", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-avatar-A`, {
      status: "draft",
      avatarUrl: "https://example.test/avatar-a.jpg",
      avatarCrop: { zoom: 1, posX: 50, posY: 50 },
    });
    try {
      const newCrop = { zoom: 2.4, posX: 12, posY: 88 };
      const result = await appRouter.createCaller(ctxFor(ownerId)).factory.updateAvatarCrop({ factoryId, crop: newCrop });
      expect(result.crop).toEqual(newCrop);

      const after = await db.getFactoryById(factoryId);
      expect((after as any).avatarCrop).toEqual(newCrop);
      // 只改 crop，avatarUrl 本體不受影響（不需要重新上傳）。
      expect((after as any).avatarUrl).toBe("https://example.test/avatar-a.jpg");
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("pending 狀態：首次審核中禁止調整大頭貼顯示範圍", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-avatar-B`, {
      status: "pending",
      avatarUrl: "https://example.test/avatar-b.jpg",
    });
    try {
      await expect(
        appRouter.createCaller(ctxFor(ownerId)).factory.updateAvatarCrop({ factoryId, crop: { zoom: 2, posX: 10, posY: 10 } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("無關會員呼叫 updateAvatarCrop 一律 FORBIDDEN，且原本的 crop 不受影響", async () => {
    const originalCrop = { zoom: 1.5, posX: 30, posY: 70 };
    const factoryId = await createTestFactory(ownerId, `${runId}-avatar-C`, {
      status: "draft",
      avatarUrl: "https://example.test/avatar-c.jpg",
      avatarCrop: originalCrop,
    });
    try {
      await expect(
        appRouter.createCaller(ctxFor(otherId)).factory.updateAvatarCrop({ factoryId, crop: { zoom: 3, posX: 0, posY: 0 } }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const after = await db.getFactoryById(factoryId);
      expect((after as any).avatarCrop).toEqual(originalCrop);
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("既有工廠未曾設定 avatarCrop 時 fallback 為 null（不是拋錯或壞資料）", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-avatar-D`, {
      status: "draft",
      avatarUrl: "https://example.test/avatar-d.jpg",
    });
    try {
      const factory = await db.getFactoryById(factoryId);
      expect((factory as any).avatarCrop).toBeNull();
    } finally {
      await deleteTestFactory(factoryId);
    }
  });
});

describe("工廠封面顯示範圍持久化", () => {
  let ownerId: number, coManagerId: number, otherId: number;
  beforeAll(async () => {
    ownerId = await createTestUser();
    coManagerId = await createTestUser();
    otherId = await createTestUser();
  });
  afterAll(async () => {
    await deleteTestUser(ownerId);
    await deleteTestUser(coManagerId);
    await deleteTestUser(otherId);
  });

  it("owner 調整封面 crop 後持久化；共管者也可調整同一張封面", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-cover-A`, {
      status: "approved",
      coverImageUrl: "https://example.test/cover-a.jpg",
      coverCrop: { zoom: 1, posX: 50, posY: 50 },
    });
    try {
      const ownerCrop = { zoom: 1.6, posX: 20, posY: 40 };
      await appRouter.createCaller(ctxFor(ownerId)).factory.updateCoverCrop({ factoryId, crop: ownerCrop });
      expect((await db.getFactoryById(factoryId) as any).coverCrop).toEqual(ownerCrop);

      await addCoManager(factoryId, coManagerId, ownerId);
      const coMgrCrop = { zoom: 2.2, posX: 80, posY: 15 };
      await appRouter.createCaller(ctxFor(coManagerId)).factory.updateCoverCrop({ factoryId, crop: coMgrCrop });
      const after = await db.getFactoryById(factoryId);
      expect((after as any).coverCrop).toEqual(coMgrCrop);
      expect((after as any).coverImageUrl).toBe("https://example.test/cover-a.jpg");
    } finally {
      await deleteTestFactory(factoryId);
    }
  });

  it("無關會員呼叫 updateCoverCrop 一律 FORBIDDEN", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-cover-B`, {
      status: "approved",
      coverImageUrl: "https://example.test/cover-b.jpg",
    });
    try {
      await expect(
        appRouter.createCaller(ctxFor(otherId)).factory.updateCoverCrop({ factoryId, crop: { zoom: 2, posX: 0, posY: 0 } }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await deleteTestFactory(factoryId);
    }
  });
});

describe("工廠相簿照片顯示範圍：個別調整互不影響", () => {
  let ownerId: number;
  beforeAll(async () => { ownerId = await createTestUser(); });
  afterAll(async () => { await deleteTestUser(ownerId); });

  it("調整其中一張照片的 crop，不影響同工廠其他照片的 crop；舊照片沒有 crop 時 fallback 為 null", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-photos`, { status: "approved" });
    try {
      const cropA = { zoom: 1.3, posX: 25, posY: 60 };
      const cropB = { zoom: 2.0, posX: 75, posY: 40 };
      const photoAId = await db.addFactoryPhoto(factoryId, "https://example.test/photo-a.jpg", "A", cropA);
      const photoBId = await db.addFactoryPhoto(factoryId, "https://example.test/photo-b.jpg", "B", cropB);
      // 舊照片：沒有帶入任何 crop（模擬本輪功能上線前就存在的既有照片）。
      const photoOldId = await db.addFactoryPhoto(factoryId, "https://example.test/photo-old.jpg", "OLD");

      const newCropA = { zoom: 2.8, posX: 5, posY: 95 };
      await appRouter.createCaller(ctxFor(ownerId)).factory.updatePhotoCrop({ photoId: photoAId, crop: newCropA });

      const photos = await db.getPhotosByFactoryId(factoryId);
      const byId = new Map(photos.map((p: any) => [p.id, p]));
      expect(byId.get(photoAId).crop).toEqual(newCropA);
      // B 完全沒被 A 的更新動到。
      expect(byId.get(photoBId).crop).toEqual(cropB);
      // 舊照片維持 fallback null，不會被硬塞一個假的預設值進 DB。
      expect(byId.get(photoOldId).crop).toBeNull();
    } finally {
      await deleteTestFactory(factoryId);
    }
  });
});

describe("商品圖片顯示範圍：images／imageCrops 陣列索引對齊", () => {
  let ownerId: number;
  beforeAll(async () => { ownerId = await createTestUser(); });
  afterAll(async () => { await deleteTestUser(ownerId); });

  it("建立時三張圖片各自的 crop 正確對應；移除中間一張後，剩餘圖片的 crop 不會錯位", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-product`, { status: "approved" });
    try {
      const cropA = { zoom: 1.2, posX: 10, posY: 10 };
      const cropB = { zoom: 1.8, posX: 50, posY: 50 };
      const cropC = { zoom: 2.5, posX: 90, posY: 90 };
      const productId = await appRouter.createCaller(ctxFor(ownerId)).product.create({
        factoryId,
        name: `${runId}-product`,
        images: ["https://example.test/p-a.jpg", "https://example.test/p-b.jpg", "https://example.test/p-c.jpg"],
        imageCrops: [cropA, cropB, cropC],
      }).then(r => r.id);

      const created = await db.getProductById(productId);
      expect((created as any).images).toEqual(["https://example.test/p-a.jpg", "https://example.test/p-b.jpg", "https://example.test/p-c.jpg"]);
      expect((created as any).imageCrops).toEqual([cropA, cropB, cropC]);

      // 使用者在編輯畫面移除中間那張圖片（B），前端必須把 images／imageCrops
      // 兩個陣列同步過濾（見 client/src/pages/FactoryDashboard.tsx 的
      // ProductForm），這裡驗證伺服器端如實存下過濾後的結果，C 的 crop
      // 不會被誤套用成 B 原本的位置。
      await appRouter.createCaller(ctxFor(ownerId)).product.update({
        id: productId,
        factoryId,
        images: ["https://example.test/p-a.jpg", "https://example.test/p-c.jpg"],
        imageCrops: [cropA, cropC],
      });

      const after = await db.getProductById(productId);
      expect((after as any).images).toEqual(["https://example.test/p-a.jpg", "https://example.test/p-c.jpg"]);
      expect((after as any).imageCrops).toEqual([cropA, cropC]);
      // 明確排除「C 被錯誤套用 B 的 crop」這種索引錯位。
      expect((after as any).imageCrops[1]).not.toEqual(cropB);
    } finally {
      const conn = await getDb();
      if (conn) await conn.execute(sql`DELETE FROM products WHERE factoryId = ${factoryId}`);
      await deleteTestFactory(factoryId);
    }
  });

  it("兩張圖片交換順序後，images／imageCrops 仍逐一對應正確的圖片（不是只測刪除）", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-product-swap`, { status: "approved" });
    try {
      const cropA = { zoom: 1.4, posX: 15, posY: 20 };
      const cropB = { zoom: 2.1, posX: 65, posY: 85 };
      const productId = await appRouter.createCaller(ctxFor(ownerId)).product.create({
        factoryId,
        name: `${runId}-product-swap`,
        images: ["https://example.test/swap-a.jpg", "https://example.test/swap-b.jpg"],
        imageCrops: [cropA, cropB],
      }).then(r => r.id);

      // 使用者把第二張圖片移到第一張（前端唯一會改變順序的動作是刪除造成
      // 陣列重新索引；這裡直接模擬「順序互換」這個更嚴格的排列組合，
      // 確認伺服器端不是靠陣列位置以外的任何隱藏關聯，而是如實依照送出
      // 的 images／imageCrops 陣列順序儲存）。
      await appRouter.createCaller(ctxFor(ownerId)).product.update({
        id: productId,
        factoryId,
        images: ["https://example.test/swap-b.jpg", "https://example.test/swap-a.jpg"],
        imageCrops: [cropB, cropA],
      });

      const after = await db.getProductById(productId);
      expect((after as any).images).toEqual(["https://example.test/swap-b.jpg", "https://example.test/swap-a.jpg"]);
      expect((after as any).imageCrops).toEqual([cropB, cropA]);
      expect((after as any).imageCrops[0]).toEqual(cropB);
      expect((after as any).imageCrops[1]).toEqual(cropA);
    } finally {
      const conn = await getDb();
      if (conn) await conn.execute(sql`DELETE FROM products WHERE factoryId = ${factoryId}`);
      await deleteTestFactory(factoryId);
    }
  });

  it("未帶 imageCrops 時，商品圖片維持沒有裁切資料（不會憑空產生假的裁切中繼資料）", async () => {
    const factoryId = await createTestFactory(ownerId, `${runId}-product-nocrop`, { status: "approved" });
    try {
      const productId = await appRouter.createCaller(ctxFor(ownerId)).product.create({
        factoryId,
        name: `${runId}-product-nocrop`,
        images: ["https://example.test/p-x.jpg"],
      }).then(r => r.id);
      const created = await db.getProductById(productId);
      expect((created as any).imageCrops ?? []).toEqual([]);
    } finally {
      const conn = await getDb();
      if (conn) await conn.execute(sql`DELETE FROM products WHERE factoryId = ${factoryId}`);
      await deleteTestFactory(factoryId);
    }
  });
});
