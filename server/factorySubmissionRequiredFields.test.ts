/**
 * 工廠「送審完整度」共用規則的 server 端整合測試（見任務定案「工廠上架／
 * 送審必填欄位 audit（收斂輪）」，另見 server/factoryOwnerNameRequired.test.ts
 * 專門涵蓋負責人一個欄位的完整情境）。
 *
 * 背景：上一輪只修負責人，這輪 audit 確認 region／capitalLevel／mfgModes／
 * address 是同一種漏洞形狀——目前產品 UI 都已明確標示必填、client 端
 * validate() 真的會擋，但至少有一層 server zod（create 和／或 update）沒有
 * 擋空白／空陣列：
 *   - region／capitalLevel：factory.create 是 z.string()（無 min），
 *     factory.update 是 z.string().optional()（無 min）——建立與編輯兩層
 *     都沒擋。
 *   - mfgModes：factory.create 有 min(1)，但 factory.update 是
 *     z.array(z.string()).optional()（無 min），可以存成 []。
 *   - address：factory.create 有 min(1)，但 factory.update 是
 *     z.string().optional()（無 min），可以存成 ""——這是這輪 audit 重新
 *     逐一確認欄位時新發現的缺口，不在使用者原始回報範圍內，但符合
 *     「create 合法 → update 清空 → submitForReview 沒有重驗」同一種模式，
 *     一併納入共用 validator（見任務定案「如果存在，就必須納入共用
 *     submission validator」）。
 *
 * 這些欄位跟負責人共用同一個 server/routers.ts 的 getFactorySubmissionError()，
 * 這裡用同一套「draft 可以留白，送審才檢查」的測試模式驗證：
 *   - factory.update（draft）：允許把欄位存成空白／空陣列（草稿儲存）
 *   - factory.submitForReview：draft/rejected 工廠欄位空白時擋下，補齊後
 *     才能成功送審
 *   - factory.submitRevision（approved 工廠修改申請）：
 *     1. proposedData 主動把欄位改成空值 → 拒絕
 *     2. proposedData 沒帶該欄位，但 original 已有合法值 → 允許（沿用原值）
 *     3. legacy original 為空，proposed 沒有補上 → 拒絕
 *     4. legacy original 為空，proposed 補上合法值 → 允許
 *   - 四個欄位都有合法值時 → 送審／修改申請成功（regression：不誤傷正常流程）
 *
 * 架構比照 server/factoryTaxId.test.ts／factoryOwnerNameRequired.test.ts
 * 已驗證過的模式：真實本機測試資料庫、appRouter.createCaller(ctx) 直接呼叫
 * tRPC procedure。
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

const runId = `submitreq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createVerifiedTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  const email = `${runId}-${userSeq}@example.test`;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmail, primaryEmailVerifiedAt, createdAt, isFactoryOwner)
    VALUES (${openId}, ${`SubmitReq ${runId}-${userSeq}`}, ${email}, ${email}, NOW(), NOW(), FALSE)
  `);
  const [rows] = (await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`)) as unknown as [
    { id: number }[],
    unknown,
  ];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

// 全部欄位都合法的基準值——每個欄位測試時只覆蓋自己要測的那一個。
const VALID_FACTORY_INPUT = {
  name: `${runId} 工廠`,
  industry: ["電子"],
  mfgModes: ["ODM"],
  region: "新竹市",
  capitalLevel: "<1000萬",
  address: "新竹市東區某路 1 號",
  businessType: "factory" as const,
  taxId: "00000016",
  ownerName: "陳老闆",
};

async function cleanup() {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM factories WHERE name LIKE ${`${runId}%`}`);
  await conn.execute(sql`DELETE FROM users WHERE openId LIKE ${`test-${runId}-%`}`);
}

type FieldCase = {
  key: "region" | "capitalLevel" | "mfgModes" | "address";
  label: string;
  validValue: unknown;
  blankValue: unknown;
  message: string;
};

const FIELD_CASES: FieldCase[] = [
  { key: "region", label: "地區", validValue: "新竹市", blankValue: "", message: "請選擇地區" },
  { key: "capitalLevel", label: "資本額", validValue: "<1000萬", blankValue: "", message: "請選擇資本額" },
  { key: "mfgModes", label: "代工模式", validValue: ["ODM"], blankValue: [], message: "請至少選擇一種代工模式" },
  { key: "address", label: "地址", validValue: "新竹市東區某路 1 號", blankValue: "", message: "請填寫地址" },
];

describe("工廠送審完整度共用規則 — region／capitalLevel／mfgModes／address", () => {
  afterAll(async () => {
    await cleanup();
  });

  it("四個欄位都有合法值（含負責人）→ 送審成功，狀態變成 pending（regression：不誤傷正常流程）", async () => {
    const ownerId = await createVerifiedTestUser();
    const factoryId = await db.createFactoryAtomic(ownerId, {
      ...VALID_FACTORY_INPUT, name: `${runId} AllValid`,
    } as any);
    await db.createProduct({ factoryId, name: "測試產品" });

    const caller = appRouter.createCaller(await ctxForUserId(ownerId));
    await expect(caller.factory.submitForReview()).resolves.toMatchObject({ success: true });
    const after = await db.getFactoryById(factoryId);
    expect(after?.status).toBe("pending");
  });

  for (const field of FIELD_CASES) {
    describe(`欄位：${field.label}（${field.key}）`, () => {
      it("factory.update（draft）允許把此欄位存成空白／空陣列（草稿儲存，不是送審）", async () => {
        const ownerId = await createVerifiedTestUser();
        const factoryId = await db.createFactoryAtomic(ownerId, {
          ...VALID_FACTORY_INPUT, name: `${runId} DraftSave-${field.key}`,
        } as any);
        const caller = appRouter.createCaller(await ctxForUserId(ownerId));
        await expect(
          caller.factory.update({ id: factoryId, [field.key]: field.blankValue } as any),
        ).resolves.toBeTruthy();
        const after = await db.getFactoryById(factoryId);
        expect((after as any)?.[field.key]).toEqual(field.blankValue);
      });

      it(`draft 工廠此欄位空白 + 已有一項產品 → 送審被拒絕，訊息「${field.message}」`, async () => {
        const ownerId = await createVerifiedTestUser();
        const factoryId = await db.createFactoryAtomic(ownerId, {
          ...VALID_FACTORY_INPUT, name: `${runId} SubmitBlank-${field.key}`, [field.key]: field.blankValue,
        } as any);
        await db.createProduct({ factoryId, name: "測試產品" });

        const caller = appRouter.createCaller(await ctxForUserId(ownerId));
        await expect(caller.factory.submitForReview()).rejects.toMatchObject({
          message: expect.stringContaining(field.message),
        });
        const after = await db.getFactoryById(factoryId);
        expect(after?.status).toBe("draft");
      });

      it("補齊此欄位後 → 送審成功，狀態變成 pending", async () => {
        const ownerId = await createVerifiedTestUser();
        const factoryId = await db.createFactoryAtomic(ownerId, {
          ...VALID_FACTORY_INPUT, name: `${runId} SubmitFixed-${field.key}`, [field.key]: field.blankValue,
        } as any);
        await db.createProduct({ factoryId, name: "測試產品" });

        const caller = appRouter.createCaller(await ctxForUserId(ownerId));
        await caller.factory.update({ id: factoryId, [field.key]: field.validValue } as any);
        await expect(caller.factory.submitForReview()).resolves.toMatchObject({ success: true });
        const after = await db.getFactoryById(factoryId);
        expect(after?.status).toBe("pending");
      });

      it("submitRevision：原本已有合法值、修改申請沒有帶此欄位 → 沿用原值，成功（regression）", async () => {
        const ownerId = await createVerifiedTestUser();
        const factoryId = await db.createFactoryAtomic(ownerId, {
          ...VALID_FACTORY_INPUT, name: `${runId} RevisionKeep-${field.key}`,
        } as any);
        const conn = await getDb();
        if (!conn) throw new Error("no db");
        await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

        const caller = appRouter.createCaller(await ctxForUserId(ownerId));
        await expect(
          caller.factory.submitRevision({
            factoryId,
            proposedData: { description: "只改簡介，不動其他欄位" },
            revisionReason: `regression test ${field.key}`,
          }),
        ).resolves.toMatchObject({ success: true });
      });

      it("submitRevision：proposedData 主動把此欄位改成空值 → 拒絕，不建立 pending revision", async () => {
        const ownerId = await createVerifiedTestUser();
        const factoryId = await db.createFactoryAtomic(ownerId, {
          ...VALID_FACTORY_INPUT, name: `${runId} RevisionBlank-${field.key}`,
        } as any);
        const conn = await getDb();
        if (!conn) throw new Error("no db");
        await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

        const caller = appRouter.createCaller(await ctxForUserId(ownerId));
        await expect(
          caller.factory.submitRevision({
            factoryId,
            proposedData: { [field.key]: field.blankValue },
            revisionReason: `regression test ${field.key}`,
          }),
        ).rejects.toMatchObject({ message: expect.stringContaining(field.message) });

        const pending = await db.getPendingRevisionByFactory(factoryId);
        expect(pending).toBeNull();
      });

      it("submitRevision：模擬修法前的舊資料（此欄位為空），修改申請沒有補上 → 拒絕", async () => {
        const ownerId = await createVerifiedTestUser();
        const factoryId = await db.createFactoryAtomic(ownerId, {
          ...VALID_FACTORY_INPUT, name: `${runId} RevisionLegacyBlocked-${field.key}`, [field.key]: field.blankValue,
        } as any);
        const conn = await getDb();
        if (!conn) throw new Error("no db");
        await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

        const caller = appRouter.createCaller(await ctxForUserId(ownerId));
        await expect(
          caller.factory.submitRevision({
            factoryId,
            proposedData: { description: "只改簡介，不補這個必填欄位" },
            revisionReason: `regression test ${field.key}`,
          }),
        ).rejects.toMatchObject({ message: expect.stringContaining(field.message) });

        // 不可下架、不可自動竄改：工廠仍是 approved，資料保持原樣未被亂動。
        const after = await db.getFactoryById(factoryId);
        expect(after?.status).toBe("approved");
      });

      it("submitRevision：同一筆舊資料，這次修改申請主動補上此欄位 → 成功建立 pending revision", async () => {
        const ownerId = await createVerifiedTestUser();
        const factoryId = await db.createFactoryAtomic(ownerId, {
          ...VALID_FACTORY_INPUT, name: `${runId} RevisionLegacyFixed-${field.key}`, [field.key]: field.blankValue,
        } as any);
        const conn = await getDb();
        if (!conn) throw new Error("no db");
        await conn.execute(sql`UPDATE factories SET status = 'approved' WHERE id = ${factoryId}`);

        const caller = appRouter.createCaller(await ctxForUserId(ownerId));
        const result = await caller.factory.submitRevision({
          factoryId,
          proposedData: { [field.key]: field.validValue },
          revisionReason: `regression test ${field.key}`,
        });
        expect(result.success).toBe(true);

        const adminId = await createVerifiedTestUser();
        await db.approveRevisionAtomic(result.revisionId, adminId);
        const after = await db.getFactoryById(factoryId);
        expect((after as any)?.[field.key]).toEqual(field.validValue);
      });
    });
  }
});
