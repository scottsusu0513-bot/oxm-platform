/**
 * 工廠「負責人必填」的 server 端整合測試（見任務定案「工廠上架／送審必填
 * 欄位 audit」，收斂輪見任務定案「工廠上架／送審必填欄位 audit（收斂
 * 輪）」）。
 *
 * 背景：使用者回報「工廠在負責人欄位完全沒有填寫的情況下，仍然可以送出
 * 審核」。Audit 發現根因有兩層：
 *   1. factory.create 的 zod schema 原本是 ownerName: z.string().optional()，
 *      建立工廠當下就不強制填寫。
 *   2. 真正把 draft／rejected 工廠變成 pending 的唯一入口
 *      factory.submitForReview 完全沒有驗證任何基本資料欄位是否填寫完整
 *      （只檢查狀態與「至少一項產品」），即使 create 當初有要求，先建立、
 *      再用 factory.update 把負責人清空的工廠，一樣能送出審核。
 *   3. factory.submitRevision（approved 工廠的修改申請）的
 *      FactoryBasicDataSchema 整個是 .partial()，只驗證型別、不驗證完整度，
 *      同樣擋不住「這筆申請核准後負責人會變成空白」的情況。
 *
 * 收斂輪修正：第一輪把 ownerName 在 factory.create 直接改成
 * z.string().trim().min(1)，等於讓「建立草稿」也要完整——但 factory.create
 * 實際建立的是 status='draft'（見 db.createFactoryAtomic），不是送審，
 * 「可以儲存草稿，但不能用不完整資料送審」，這樣做反而製造了新的語意矛盾。
 * 這輪已把 factory.create 的 ownerName revert 回
 * z.string().optional()（跟修法之前的寫法完全一致），完整度要求集中回
 * 真正的送審關卡（submitForReview／submitRevision），改用共用的
 * server/routers.ts getFactorySubmissionError() 判斷，不再各自寫一份。
 *
 * 架構比照 server/factoryTaxId.test.ts 已驗證過的模式：真實本機測試資料庫、
 * appRouter.createCaller(ctx) 直接呼叫 tRPC procedure、每次呼叫前用
 * db.getUserById() 重新撈最新 row 組出 ctx.user。
 *
 * 涵蓋：
 *   - factory.create：未帶／空字串／純空白 ownerName 皆可成功建立
 *     draft（收斂輪：create 不再是完整度的把關點）
 *   - factory.update（draft）：允許把 ownerName 存成空白——草稿儲存與送審
 *     驗證必須分開，不能因為新增必填規則就連草稿都存不了
 *   - factory.submitForReview：draft／rejected 工廠 ownerName 空白時擋下，
 *     填寫後才能成功送審（狀態變成 pending）
 *   - factory.submitRevision：approved 工廠現有負責人不變動時不受影響
 *     （regression）；模擬「這次修法之前就存在」的舊資料（ownerName 為
 *     NULL）在送出修改申請時被要求補上負責人，補上後才能成功
 *
 * 另見 server/factorySubmissionRequiredFields.test.ts：region／capitalLevel／
 * mfgModes／address 四個同型欄位的完整送審規則測試（同一套共用 validator）。
 */
import { afterAll, describe, expect, it } from "vitest";
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

const runId = `ownername-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createVerifiedTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  const email = `${runId}-${userSeq}@example.test`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmail, primaryEmailVerifiedAt, createdAt, isFactoryOwner)
    VALUES (${openId}, ${`OwnerName ${runId}-${userSeq}`}, ${email}, ${email}, NOW(), NOW(), FALSE)
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
  taxId: "00000016",
};

async function cleanup() {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM factories WHERE name LIKE ${`${runId}%`}`);
  await conn.execute(sql`DELETE FROM users WHERE openId LIKE ${`test-${runId}-%`}`);
}

describe("工廠負責人必填 — server 端", () => {
  afterAll(async () => {
    await cleanup();
  });

  describe("factory.create（收斂輪：create 只負責建立 draft，不是完整度把關點）", () => {
    it("未帶 ownerName → 建立成功（draft 允許留白，完整度留到送審才檢查）", async () => {
      const userId = await createVerifiedTestUser();
      const caller = appRouter.createCaller(await ctxForUserId(userId));
      const result = await caller.factory.create({ ...BASE_FACTORY_INPUT, name: `${runId} A` } as any);
      const factory = await db.getFactoryById(result.id);
      expect(factory?.status).toBe("draft");
      expect((factory as any)?.ownerName ?? null).toBeNull();
    });

    it("ownerName 為空字串 → 建立成功，DB 存空字串", async () => {
      const userId = await createVerifiedTestUser();
      const caller = appRouter.createCaller(await ctxForUserId(userId));
      const result = await caller.factory.create({ ...BASE_FACTORY_INPUT, name: `${runId} B`, ownerName: "" });
      const factory = await db.getFactoryById(result.id);
      expect((factory as any)?.ownerName).toBe("");
    });

    it("ownerName 為純空白字串「   」→ 建立成功（draft 階段不視為錯誤，不做 trim／完整度檢查）", async () => {
      const userId = await createVerifiedTestUser();
      const caller = appRouter.createCaller(await ctxForUserId(userId));
      const result = await caller.factory.create({ ...BASE_FACTORY_INPUT, name: `${runId} C`, ownerName: "   " });
      const factory = await db.getFactoryById(result.id);
      expect((factory as any)?.ownerName).toBe("   ");
    });

    it("ownerName 正常值 → 建立成功，DB 存原始字串（create 不再做 trim，正規化留給有需要時的送審關卡）", async () => {
      const userId = await createVerifiedTestUser();
      const caller = appRouter.createCaller(await ctxForUserId(userId));
      const result = await caller.factory.create({
        ...BASE_FACTORY_INPUT,
        name: `${runId} D`,
        ownerName: "  陳老闆  ",
      });
      const factory = await db.getFactoryById(result.id);
      expect((factory as any)?.ownerName).toBe("  陳老闆  ");
    });
  });

  describe("factory.update（draft）：草稿儲存允許負責人留白，不可與送審驗證混為一談", () => {
    let ownerId: number;
    let factoryId: number;

    it("draft 工廠可以把 ownerName 存成空字串（草稿儲存，不是送審）", async () => {
      ownerId = await createVerifiedTestUser();
      factoryId = await db.createFactoryAtomic(ownerId, {
        ...BASE_FACTORY_INPUT, name: `${runId} DraftSave`, ownerName: "陳老闆",
      } as any);
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.update({ id: factoryId, ownerName: "" }),
      ).resolves.toBeTruthy();
      const after = await db.getFactoryById(factoryId);
      expect((after as any)?.ownerName).toBe("");
    });
  });

  describe("factory.submitForReview：draft／rejected 工廠送審時才真正檢查負責人", () => {
    let ownerId: number;
    let factoryId: number;

    it("draft 工廠負責人空白 + 已有一項產品 → 送審被拒絕，訊息「請填寫負責人」", async () => {
      ownerId = await createVerifiedTestUser();
      // 直接呼叫 db 層模擬「create 尚未加上必填驗證之前」就存在的舊資料，
      // 或使用者透過 factory.update 把負責人清空之後的狀態。
      factoryId = await db.createFactoryAtomic(ownerId, {
        ...BASE_FACTORY_INPUT, name: `${runId} SubmitBlank`, ownerName: "",
      } as any);
      await db.createProduct({ factoryId, name: "測試產品" });

      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(caller.factory.submitForReview()).rejects.toMatchObject({
        message: expect.stringContaining("請填寫負責人"),
      });
      const after = await db.getFactoryById(factoryId);
      expect(after?.status).toBe("draft");
    });

    it("補上負責人後 → 送審成功，狀態變成 pending", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await caller.factory.update({ id: factoryId, ownerName: "陳老闆" });
      await expect(caller.factory.submitForReview()).resolves.toMatchObject({ success: true });
      const after = await db.getFactoryById(factoryId);
      expect(after?.status).toBe("pending");
    });

    it("rejected 工廠重新送審：負責人空白一樣被擋下，補上後才能成功", async () => {
      const rejOwnerId = await createVerifiedTestUser();
      const rejFactoryId = await db.createFactoryAtomic(rejOwnerId, {
        ...BASE_FACTORY_INPUT, name: `${runId} RejectedResubmit`, ownerName: "陳老闆",
      } as any);
      await db.createProduct({ factoryId: rejFactoryId, name: "測試產品" });
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      // 模擬審核退件，且退件期間使用者把負責人清空了。
      await conn.execute(sql`UPDATE factories SET status = 'rejected', ownerName = '' WHERE id = ${rejFactoryId}`);

      const caller = appRouter.createCaller(await ctxForUserId(rejOwnerId));
      await expect(caller.factory.submitForReview()).rejects.toMatchObject({
        message: expect.stringContaining("請填寫負責人"),
      });

      await caller.factory.update({ id: rejFactoryId, ownerName: "陳老闆" });
      await expect(caller.factory.submitForReview()).resolves.toMatchObject({ success: true });
      const after = await db.getFactoryById(rejFactoryId);
      expect(after?.status).toBe("pending");
    });
  });

  describe("factory.submitRevision：approved 工廠的修改申請一樣要保證負責人不會變空白", () => {
    it("原本已有合法負責人、這次修改申請沒有帶 ownerName → 沿用原值，成功（regression：不影響一般修改申請）", async () => {
      const ownerId = await createVerifiedTestUser();
      const factoryId = await db.createFactoryAtomic(ownerId, {
        ...BASE_FACTORY_INPUT, name: `${runId} RevisionKeep`, ownerName: "陳老闆",
      } as any);
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.submitRevision({
          factoryId,
          proposedData: { description: "只改簡介，不動負責人" },
          revisionReason: "regression test",
        }),
      ).resolves.toMatchObject({ success: true });
    });

    it("模擬修法前的舊資料（ownerName 為 NULL）：修改申請沒有補上負責人 → 拒絕，訊息「請填寫負責人」", async () => {
      const ownerId = await createVerifiedTestUser();
      const factoryId = await db.createFactoryAtomic(ownerId, {
        ...BASE_FACTORY_INPUT, name: `${runId} RevisionLegacyBlocked`,
      } as any); // 不帶 ownerName，落地為 NULL
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.submitRevision({
          factoryId,
          proposedData: { description: "只改簡介，不補負責人" },
          revisionReason: "regression test",
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining("請填寫負責人") });

      // 不可下架、不可自動竄改：工廠仍是 approved，資料保持原樣未被亂動。
      const after = await db.getFactoryById(factoryId);
      expect(after?.status).toBe("approved");
      expect((after as any)?.ownerName ?? null).toBeNull();
    });

    it("同一筆舊資料，這次修改申請主動補上負責人 → 成功建立 pending revision", async () => {
      const ownerId = await createVerifiedTestUser();
      const factoryId = await db.createFactoryAtomic(ownerId, {
        ...BASE_FACTORY_INPUT, name: `${runId} RevisionLegacyFixed`,
      } as any);
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      const result = await caller.factory.submitRevision({
        factoryId,
        proposedData: { ownerName: "陳老闆", description: "補上負責人" },
        revisionReason: "regression test",
      });
      expect(result.success).toBe(true);

      const adminId = await createVerifiedTestUser();
      await db.approveRevisionAtomic(result.revisionId, adminId);
      const after = await db.getFactoryById(factoryId);
      expect((after as any)?.ownerName).toBe("陳老闆");
    });

    it("proposedData.ownerName 帶空字串／純空白 → 拒絕，訊息「請填寫負責人」，不建立 pending revision", async () => {
      const ownerId = await createVerifiedTestUser();
      const factoryId = await db.createFactoryAtomic(ownerId, {
        ...BASE_FACTORY_INPUT, name: `${runId} RevisionBlankOwner`, ownerName: "陳老闆",
      } as any);
      const conn = await getDb();
      if (!conn) throw new Error("no db");
      await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

      const caller = appRouter.createCaller(await ctxForUserId(ownerId));
      await expect(
        caller.factory.submitRevision({
          factoryId,
          proposedData: { ownerName: "   " },
          revisionReason: "regression test",
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining("請填寫負責人") });

      const pending = await db.getPendingRevisionByFactory(factoryId);
      expect(pending).toBeNull();
    });
  });
});
