/**
 * 新會員 Spotlight 新手導引的 server 端整合測試。走真實本機測試資料庫，用
 * appRouter.createCaller(ctx) 直接呼叫 auth.me／auth.completeOnboarding，
 * 架構完全比照 server/consentGate.test.ts 已驗證過的模式（真實
 * insert／cleanup、每次呼叫前用 db.getUserById() 重新撈最新 row 組出
 * ctx.user，比照 production 每個請求都重新從 DB 撈一次 user 的行為）。
 *
 * 涵蓋（對應對話「二十六」）：
 *   Case A：launch 前既有會員 → auth.me 回傳 needsOnboarding: false
 *   Case B：launch 後新會員、尚未完成 → auth.me 回傳 needsOnboarding: true
 *   Case C：完成 auth.completeOnboarding 之後 → needsOnboarding: false
 *   Case D：略過（呼叫同一支 API）→ 效果與完成相同，needsOnboarding: false
 *   auth.completeOnboarding 必須登入才能呼叫（guest ctx → UNAUTHORIZED）
 *   auth.completeOnboarding 只更新 onboardingCompletedAt，不動其他欄位
 * 另外補上「既有正式會員等價」regression 測試：模擬一個 migration 前就已
 * 存在、資料完整的既有會員，驗證 auth.me 呼叫不會因為新增的
 * onboardingCompletedAt 欄位產生任何 runtime error，且既有欄位原封不動。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import * as db from "./db";
import { appRouter } from "./routers";
import { ENV } from "./_core/env";
import type { TrpcContext } from "./_core/context";

if (!ENV.onboardingLaunchAt) {
  throw new Error(
    "[onboarding.test.ts] ONBOARDING_LAUNCH_AT 未設定於本機 .env，這支測試需要一個明確的 launchAt 才能驗證 boundary 行為",
  );
}
const LAUNCH_AT = ENV.onboardingLaunchAt;

function guestCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function ctxForUserId(userId: number): Promise<TrpcContext> {
  const user = await db.getUserById(userId);
  if (!user) throw new Error("test user not found");
  return {
    user: { ...user, isAdmin: false } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const runId = `onboarding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;

async function createTestUser(createdAt: Date, extra: Record<string, unknown> = {}): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  const isFactoryOwner = (extra.isFactoryOwner as boolean | undefined) ?? false;
  const phone = (extra.phone as string | undefined) ?? null;
  await conn.execute(sql`
    INSERT INTO users (openId, name, email, primaryEmailVerifiedAt, createdAt, isFactoryOwner, phone)
    VALUES (${openId}, ${`Onboarding ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`}, NOW(), ${createdAt}, ${isFactoryOwner}, ${phone})
  `);
  const [rows] = (await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`)) as unknown as [
    { id: number }[],
    unknown,
  ];
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

const BEFORE_LAUNCH = new Date(LAUNCH_AT.getTime() - 24 * 60 * 60 * 1000);
const AFTER_LAUNCH = new Date(LAUNCH_AT.getTime() + 24 * 60 * 60 * 1000);

describe("Onboarding Tour — server 端", () => {
  let oldMemberId: number;
  let newMemberId: number;
  let skipMemberId: number;
  let existingRealMemberId: number;

  beforeAll(async () => {
    oldMemberId = await createTestUser(BEFORE_LAUNCH);
    newMemberId = await createTestUser(AFTER_LAUNCH);
    skipMemberId = await createTestUser(AFTER_LAUNCH);
    existingRealMemberId = await createTestUser(BEFORE_LAUNCH, { isFactoryOwner: true, phone: "0912345678" });
  });
  afterAll(async () => {
    await deleteTestUser(oldMemberId);
    await deleteTestUser(newMemberId);
    await deleteTestUser(skipMemberId);
    await deleteTestUser(existingRealMemberId);
  });

  it("Case A：舊會員（launch 前）→ auth.me 回傳 needsOnboarding: false", async () => {
    const row = await db.getUserById(oldMemberId);
    expect((row as any)?.onboardingCompletedAt).toBeNull();

    const caller = appRouter.createCaller(await ctxForUserId(oldMemberId));
    const me = await caller.auth.me();
    expect(me).not.toBeNull();
    expect((me as any).needsOnboarding).toBe(false);
  });

  it("Case B：新會員（launch 後）、尚未完成 → auth.me 回傳 needsOnboarding: true", async () => {
    const caller = appRouter.createCaller(await ctxForUserId(newMemberId));
    const me = await caller.auth.me();
    expect(me).not.toBeNull();
    expect((me as any).needsOnboarding).toBe(true);
  });

  it("auth.completeOnboarding 需要登入，未登入呼叫會被 UNAUTHORIZED 擋下", async () => {
    await expect(appRouter.createCaller(guestCtx()).auth.completeOnboarding()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("Case C：完成導覽（呼叫 auth.completeOnboarding）後，onboardingCompletedAt 寫入、needsOnboarding 變 false，且不動其他欄位", async () => {
    const before = await db.getUserById(newMemberId);

    const caller = appRouter.createCaller(await ctxForUserId(newMemberId));
    const result = await caller.auth.completeOnboarding();
    expect(result).toEqual({ success: true });

    const after = await db.getUserById(newMemberId);
    expect((after as any)?.onboardingCompletedAt).not.toBeNull();
    // 其他欄位不受影響
    expect((after as any)?.name).toBe((before as any)?.name);
    expect((after as any)?.email).toBe((before as any)?.email);
    expect((after as any)?.role).toBe((before as any)?.role);

    const afterCaller = appRouter.createCaller(await ctxForUserId(newMemberId));
    const me = await afterCaller.auth.me();
    expect((me as any).needsOnboarding).toBe(false);
  });

  it("Case D：略過導覽（呼叫同一支 auth.completeOnboarding）→ 效果與完成相同", async () => {
    const caller = appRouter.createCaller(await ctxForUserId(skipMemberId));
    await caller.auth.completeOnboarding();

    const row = await db.getUserById(skipMemberId);
    expect((row as any)?.onboardingCompletedAt).not.toBeNull();

    const afterCaller = appRouter.createCaller(await ctxForUserId(skipMemberId));
    const me = await afterCaller.auth.me();
    expect((me as any).needsOnboarding).toBe(false);
  });

  describe("Regression：既有正式會員等價", () => {
    it("既有會員呼叫 auth.me 不會因新增的 onboardingCompletedAt 欄位產生 runtime error，且既有欄位原封不動", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(existingRealMemberId));
      const me = await caller.auth.me();

      expect(me).not.toBeNull();
      expect((me as any).needsOnboarding).toBe(false);
      expect((me as any).isFactoryOwner).toBe(true);
      expect((me as any).phone).toBe("0912345678");
      expect((me as any).onboardingCompletedAt).toBeNull();
    });
  });
});
