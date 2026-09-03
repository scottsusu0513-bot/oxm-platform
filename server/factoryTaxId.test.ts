/**
 * 工廠「統一編號必填」的 server 端整合測試（見 shared/taxId.ts、
 * server/routers.ts 的 factory.create、server/db.ts 的
 * createFactoryAtomic）。架構比照 server/onboarding.test.ts 已驗證過的模式：
 * 真實本機測試資料庫、appRouter.createCaller(ctx) 直接呼叫 tRPC procedure、
 * 每次呼叫前用 db.getUserById() 重新撈最新 row 組出 ctx.user。
 *
 * 涵蓋：
 *   - 未帶 taxId → 拒絕（zod 必填）
 *   - taxId 為空字串 → 拒絕，訊息「請輸入統一編號」
 *   - taxId 不是 8 碼數字 → 拒絕，訊息「統一編號須為 8 碼數字」
 *   - taxId 檢查碼不對 → 拒絕，訊息「統一編號格式不正確，請確認輸入是否正確」
 *   - 有效 taxId → 建立成功，DB 內存的是正規化後的字串
 * 另外補上既有工廠 regression（對應對話「Case A–D」）：
 *   - Case A：既有工廠 taxId 為 NULL，呼叫 factory.getById 不會 crash
 *   - Case B：既有工廠（taxId NULL）呼叫 factory.update 不需要、也不會被要求帶 taxId
 *   - Case C：既有工廠（taxId NULL）呼叫 submitRevision 不需要 taxId
 *   - Case D：直接呼叫 db.createFactoryAtomic()（不經過 tRPC zod 層）不帶 taxId
 *     仍可成功，taxId 落地為 NULL（既有測試 fixture 呼叫方式不受影響）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import * as db from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

async function ctxForUserId(userId: number): Promise<TrpcContext> {
  const user = await db.getUserById(userId);
  if (!user) throw new Error("test user not found");
  return {
    user: { ...user, isAdmin: false } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const runId = `taxid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createVerifiedTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  const email = `${runId}-${userSeq}@example.test`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmail, primaryEmailVerifiedAt, createdAt, isFactoryOwner)
    VALUES (${openId}, ${`TaxId ${runId}-${userSeq}`}, ${email}, ${email}, NOW(), NOW(), FALSE)
  `);
  const [rows] = (await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`)) as unknown as [
    { id: number }[],
    unknown,
  ];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

const BASE_FACTORY_INPUT = {
  name: `${runId} 工廠`,
  industry: ["電子"],
  mfgModes: ["ODM"],
  region: "新竹市",
  capitalLevel: "<1000萬",
  address: "新竹市",
  businessType: "factory" as const,
};

async function cleanup() {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM factories WHERE name LIKE ${`${runId}%`}`);
  await conn.execute(sql`DELETE FROM users WHERE openId LIKE ${`test-${runId}-%`}`);
}

describe("工廠統一編號必填 — server 端", () => {
  afterAll(async () => {
    await cleanup();
  });

  it("未帶 taxId → zod 拒絕", async () => {
    const userId = await createVerifiedTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(userId));
    await expect(
      caller.factory.create({ ...BASE_FACTORY_INPUT, name: `${runId} A` } as any),
    ).rejects.toBeTruthy();
  });

  it("taxId 為空字串 → 拒絕，訊息「請輸入統一編號」", async () => {
    const userId = await createVerifiedTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(userId));
    await expect(
      caller.factory.create({ ...BASE_FACTORY_INPUT, name: `${runId} B`, taxId: "" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("請輸入統一編號") });
  });

  it("taxId 不是 8 碼數字 → 拒絕，訊息「統一編號須為 8 碼數字」", async () => {
    const userId = await createVerifiedTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(userId));
    await expect(
      caller.factory.create({ ...BASE_FACTORY_INPUT, name: `${runId} C`, taxId: "1234567" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("統一編號須為 8 碼數字") });
  });

  it("taxId 檢查碼不對 → 拒絕，訊息「統一編號格式不正確，請確認輸入是否正確」", async () => {
    const userId = await createVerifiedTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(userId));
    // 00000017：8 碼數字格式正確，但檢查碼不成立（見 shared/taxId.test.ts）
    await expect(
      caller.factory.create({ ...BASE_FACTORY_INPUT, name: `${runId} D`, taxId: "00000017" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("統一編號格式不正確") });
  });

  it("有效 taxId → 建立成功，DB 內存的是正規化後的字串", async () => {
    const userId = await createVerifiedTestUser();
    const caller = appRouter.createCaller(await ctxForUserId(userId));
    const result = await caller.factory.create({
      ...BASE_FACTORY_INPUT,
      name: `${runId} E`,
      taxId: "  00000016  ",
    });
    const factory = await db.getFactoryById(result.id);
    expect((factory as any)?.taxId).toBe("00000016");
  });

  describe("既有工廠 regression（taxId 為 NULL 不受影響）", () => {
    let ownerId: number;
    let factoryId: number;

    beforeAll(async () => {
      ownerId = await createVerifiedTestUser();
      // 直接呼叫 db 層，模擬「migration 0092 套用前就存在」的既有工廠：不帶 taxId。
      factoryId = await db.createFactoryAtomic(ownerId, { ...BASE_FACTORY_INPUT, name: `${runId} Existing` } as any);
    });

    it("Case A：factory.getById 對 taxId=NULL 的既有工廠不會 crash，taxId 回傳 null", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      const result: any = await caller.factory.getById({ id: factoryId });
      expect(result).not.toBeNull();
      expect(result.taxId ?? null).toBeNull();
    });

    it("Case B：factory.update（status=draft）不需要、也不要求帶 taxId", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.update({ id: factoryId, description: "更新描述，不含 taxId" }),
      ).resolves.toBeTruthy();
      const after = await db.getFactoryById(factoryId);
      expect((after as any)?.taxId).toBeNull();
    });

    it("Case C：submitRevision（已上線工廠的修改申請）不需要 taxId", async () => {
      // submitRevision 只接受 status='approved' 的工廠，這裡直接用 raw SQL
      // 把這個 regression 專用的既有工廠標記為已上線，模擬既有正式工廠。
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.submitRevision({
          factoryId,
          proposedData: { description: "送出修改申請，不含 taxId" },
          revisionReason: "regression test",
        }),
      ).resolves.toBeTruthy();
    });

    it("Case D：直接呼叫 db.createFactoryAtomic() 不帶 taxId 仍可成功，落地為 NULL", async () => {
      const newOwnerId = await createVerifiedTestUser();
      const newFactoryId = await db.createFactoryAtomic(newOwnerId, {
        ...BASE_FACTORY_INPUT,
        name: `${runId} DirectCall`,
      } as any);
      const factory = await db.getFactoryById(newFactoryId);
      expect((factory as any)?.taxId).toBeNull();
    });
  });

  // OXM Final Public Release urgent fix 2（見對話「統編不能填寫，造成工廠無法
  // 上架」）：既有工廠原本無法補填統編（FactoryDashboard.tsx 的欄位原本
  // unconditionally disabled、factory.update 的 zod schema 原本也不接受
  // taxId），這裡補上 factory.update 支援 taxId 的專屬 regression。
  describe("factory.update 補填統一編號（urgent fix 2：既有工廠可補填/更正 taxId）", () => {
    let ownerId: number;
    let factoryId: number;

    beforeAll(async () => {
      ownerId = await createVerifiedTestUser();
      factoryId = await db.createFactoryAtomic(ownerId, { ...BASE_FACTORY_INPUT, name: `${runId} UpdateTaxId` } as any);
    });

    it("draft 工廠原本 taxId 為 NULL，補填有效 8 碼 → 成功，DB 存正規化後的字串", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.update({ id: factoryId, taxId: "  00000016  " }),
      ).resolves.toBeTruthy();
      const after = await db.getFactoryById(factoryId);
      expect((after as any)?.taxId).toBe("00000016");
    });

    it("補填非 8 碼數字 → 拒絕，訊息「統一編號須為 8 碼數字」，且不覆蓋既有值", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.update({ id: factoryId, taxId: "1234567" }),
      ).rejects.toMatchObject({ message: expect.stringContaining("統一編號須為 8 碼數字") });
      const after = await db.getFactoryById(factoryId);
      expect((after as any)?.taxId).toBe("00000016");
    });

    it("補填檢查碼不對的 8 碼數字 → 拒絕，訊息「統一編號格式不正確，請確認輸入是否正確」", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.update({ id: factoryId, taxId: "00000017" }),
      ).rejects.toMatchObject({ message: expect.stringContaining("統一編號格式不正確") });
    });

    it("taxId 帶空字串 → 視為「本次不更動」，不拋錯、也不清空既有值", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.update({ id: factoryId, taxId: "" }),
      ).resolves.toBeTruthy();
      const after = await db.getFactoryById(factoryId);
      expect((after as any)?.taxId).toBe("00000016");
    });

    it("payload 完全沒帶 taxId 欄位 → 其餘欄位仍可正常更新，既有 taxId 不受影響", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.update({ id: factoryId, description: "只更新描述，不動 taxId" }),
      ).resolves.toBeTruthy();
      const after = await db.getFactoryById(factoryId);
      expect((after as any)?.taxId).toBe("00000016");
      expect((after as any)?.description).toBe("只更新描述，不動 taxId");
    });
  });
});
