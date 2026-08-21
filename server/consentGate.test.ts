/**
 * 註冊條款 Consent Gate 的 server 端整合測試。走真實本機測試資料庫
 * （見 server/test-db-guard.ts），用 appRouter.createCaller(ctx) 直接呼叫
 * auth.me／auth.acceptConsent，比照 server/badgeOwnership.test.ts 的既有
 * 慣例（真實 insert／cleanup，不 mock db 層）。
 *
 * 每次呼叫前都用 db.getUserById() 重新從 DB 撈一份最新的 user row 組出
 * ctx.user（見 ctxForUserId），而不是共用一個寫死的 context 物件——這樣才
 * 真正比照 production 的行為：server/_core/context.ts 每個請求都會重新從
 * DB 撈一次 user，所以 acceptConsent 寫入 DB 之後，「下一次」auth.me 拿到
 * 的 ctx.user 本來就會是更新後的值，不是同一個請求內看到舊資料。
 *
 * Hotfix（見對話「OXM Consent Gate — Hotfix：修正 rollout 時間判斷」）：
 * launchAt 不再是 shared/consent.ts 裡的寫死常數，改成從
 * ENV.consentGateLaunchAt（環境變數 CONSENT_GATE_LAUNCH_AT，見 .env 本機
 * 測試專用設定）取得——這裡直接讀同一個 ENV，確保測試驗證的是「router 實際
 * 會用的那個值」，不是另外自己編一個跟 production 邏輯脫鉤的假設值。
 *
 * 涵蓋使用者第十八節列出的最低要求中，屬於 server 端的部分：
 *   (2) 舊會員（createdAt 早於 launchAt）→ auth.me 回傳 needsConsent: false
 *   (3) 上線後新會員、尚未同意 → auth.me 回傳 needsConsent: true
 *   (4) 完成 acceptConsent 之後 → auth.me 回傳 needsConsent: false
 *   (5) acceptConsent 必須登入才能呼叫（guest ctx → UNAUTHORIZED）
 *   (6) acceptConsent 正確寫入 termsAcceptedAt／termsVersion／
 *       privacyAcceptedAt／privacyVersion 四個欄位，且版本值是 server 端
 *       固定常數（CURRENT_TERMS_VERSION／CURRENT_PRIVACY_VERSION）——這支
 *       procedure 完全不接受任何 client input，version 不可能被使用者端
 *       偽造。
 *
 * 另外補上「既有正式會員等價」regression 測試（見對話「OXM 本輪修改最高級
 * 安全規則補充」）：模擬一個 migration 前就已存在、資料完整的既有會員（有
 * 既有的 role／isFactoryOwner／phone／notificationSettings 等欄位），驗證
 * auth.me 呼叫不會因為新增的四個 consent 欄位而丟出任何 runtime error，且
 * 這些既有欄位的值原封不動地被回傳、不會被這次改動動到。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import * as db from "./db";
import { appRouter } from "./routers";
import { ENV } from "./_core/env";
import type { TrpcContext } from "./_core/context";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../shared/consent";

// 這裡刻意 fail fast，而不是悄悄 fallback 成別的日期：如果本機 .env 沒有設
// CONSENT_GATE_LAUNCH_AT，下面「舊會員／新會員」的分界測試會失去意義（安全
// fallback 底下所有人都是「舊會員」，測不出真正的 boundary 行為），寧可讓
// 測試直接報錯提醒補設定，也不要產生「看起來測到、其實沒測到」的綠燈。
if (!ENV.consentGateLaunchAt) {
  throw new Error(
    "[consentGate.test.ts] CONSENT_GATE_LAUNCH_AT 未設定於本機 .env，這支測試需要一個明確的 launchAt 才能驗證 boundary 行為",
  );
}
const LAUNCH_AT = ENV.consentGateLaunchAt;

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

const runId = `consent-gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    VALUES (${openId}, ${`Consent Gate ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`}, NOW(), ${createdAt}, ${isFactoryOwner}, ${phone})
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

describe("Consent Gate — server 端", () => {
  let oldMemberId: number;
  let newMemberId: number;
  let existingRealMemberId: number;

  beforeAll(async () => {
    oldMemberId = await createTestUser(BEFORE_LAUNCH);
    newMemberId = await createTestUser(AFTER_LAUNCH);
    // 「既有正式會員等價」regression 測試專用：模擬一個資料完整、migration
    // 前就已經存在的真實會員（見下方 regression 測試）。
    existingRealMemberId = await createTestUser(BEFORE_LAUNCH, { isFactoryOwner: true, phone: "0912345678" });
  });
  afterAll(async () => {
    await deleteTestUser(oldMemberId);
    await deleteTestUser(newMemberId);
    await deleteTestUser(existingRealMemberId);
  });

  it("(2) 舊會員：auth.me 回傳 needsConsent: false，即使四個新欄位都是 NULL", async () => {
    const row = await db.getUserById(oldMemberId);
    expect((row as any)?.termsAcceptedAt).toBeNull();
    expect((row as any)?.privacyAcceptedAt).toBeNull();

    const caller = appRouter.createCaller(await ctxForUserId(oldMemberId));
    const me = await caller.auth.me();
    expect(me).not.toBeNull();
    expect((me as any).needsConsent).toBe(false);
  });

  it("(3) 上線後新會員、尚未同意：auth.me 回傳 needsConsent: true", async () => {
    const caller = appRouter.createCaller(await ctxForUserId(newMemberId));
    const me = await caller.auth.me();
    expect(me).not.toBeNull();
    expect((me as any).needsConsent).toBe(true);
  });

  it("(5) acceptConsent 需要登入，未登入呼叫會被 UNAUTHORIZED 擋下", async () => {
    await expect(appRouter.createCaller(guestCtx()).auth.acceptConsent()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("(6)(4) acceptConsent 正確寫入四個欄位（server 固定版本常數），寫入後下一次 auth.me 的 needsConsent 變為 false", async () => {
    const beforeCaller = appRouter.createCaller(await ctxForUserId(newMemberId));
    const result = await beforeCaller.auth.acceptConsent();
    expect(result).toEqual({
      success: true,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
    });

    const row = await db.getUserById(newMemberId);
    expect((row as any)?.termsAcceptedAt).not.toBeNull();
    expect((row as any)?.privacyAcceptedAt).not.toBeNull();
    expect((row as any)?.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect((row as any)?.privacyVersion).toBe(CURRENT_PRIVACY_VERSION);

    const afterCaller = appRouter.createCaller(await ctxForUserId(newMemberId));
    const me = await afterCaller.auth.me();
    expect((me as any).needsConsent).toBe(false);
  });

  describe("Regression：既有正式會員等價（見「本輪修改最高級安全規則補充」）", () => {
    it("既有會員呼叫 auth.me 不會因新增的 consent 欄位產生 runtime error，且既有欄位原封不動", async () => {
      const caller = appRouter.createCaller(await ctxForUserId(existingRealMemberId));
      const me = await caller.auth.me();

      expect(me).not.toBeNull();
      expect((me as any).needsConsent).toBe(false);
      // 既有欄位（非本次改動範圍）維持原樣，沒有被新增欄位或新邏輯動到。
      expect((me as any).isFactoryOwner).toBe(true);
      expect((me as any).phone).toBe("0912345678");
      expect((me as any).role).toBe("user");
      // 新增的四個 consent 欄位對既有會員仍是 NULL——這是預期狀態，不是異常。
      expect((me as any).termsAcceptedAt).toBeNull();
      expect((me as any).privacyAcceptedAt).toBeNull();
    });
  });
});
