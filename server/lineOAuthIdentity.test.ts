/**
 * LINE Login：email 不是可信身分，不得觸發 email 帳號合併（Production
 * Hardening Batch 2.6）。
 *
 * 修正前 server/_core/oauth.ts 以 `providerEmailVerified: lineEmail !== null`
 * 呼叫 handleOAuthCallback——只要 LINE 回傳 email 就視為已驗證，會依
 * primaryEmail 自動合併到既有 OXM 帳號。LINE 官方 ID token 沒有
 * email_verified claim，OXM 無從驗證這個 email 屬於登入者。修正後 LINE 身分
 * 只以 provider user ID（sub）識別。
 *
 * 走真實本機測試資料庫與 handleOAuthCallback（所有 provider 共用的登入處理）。
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { handleOAuthCallback, isLineEmailVerified } from "./_core/oauthHelpers";
import { isAdminUser } from "./_core/admin";
import { ENV } from "./_core/env";
import { ensureTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createdOpenIds: string[] = [];
const createdUserIds: number[] = [];

afterAll(async () => {
  const conn = await db.getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM userAuthAccounts WHERE providerAccountId LIKE ${`lid-${runId}-%`}`);
  for (const openId of createdOpenIds) await conn.execute(sql`DELETE FROM users WHERE openId = ${openId}`);
  for (const id of createdUserIds) await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
});

/** 模擬 oauth.ts LINE callback 實際傳給 handleOAuthCallback 的參數。 */
async function lineLogin(sub: string, email: string | null, verifiedOverride?: boolean) {
  const providerAccountId = `lid-${runId}-${sub}`;
  createdOpenIds.push(`line_${providerAccountId}`);
  return handleOAuthCallback({
    provider: "line",
    providerAccountId,
    providerEmail: email,
    providerEmailVerified: verifiedOverride ?? isLineEmailVerified(),
    displayName: `LINE 測試 ${sub}`,
  });
}

async function googleLogin(sub: string, email: string, verified: boolean) {
  const providerAccountId = `lid-${runId}-g-${sub}`;
  createdOpenIds.push(`google_${providerAccountId}`);
  return handleOAuthCallback({ provider: "google", providerAccountId, providerEmail: email, providerEmailVerified: verified, displayName: `Google ${sub}` });
}

async function existingUserWithPrimaryEmail(label: string, email: string) {
  const id = await ensureTestUser(`lid-existing-${label}-${runId}`, `既有帳號 ${label}`);
  createdUserIds.push(id);
  await db.setPrimaryEmailVerified(id, email);
  return (await db.getUserById(id))!;
}

describe("LINE email 驗證訊號", () => {
  it("isLineEmailVerified 永遠是 false（LINE 沒有可驗證的 email_verified）", () => {
    expect(isLineEmailVerified()).toBe(false);
    expect(isLineEmailVerified({ email: "a@example.com", email_verified: true })).toBe(false);
  });
  it("oauth.ts 的 LINE callback 使用 isLineEmailVerified()，不再以「有 email」判定已驗證", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "_core", "oauth.ts"), "utf-8");
    expect(source).toContain("providerEmailVerified: isLineEmailVerified()");
    expect(source).not.toMatch(/providerEmailVerified:\s*lineEmail\s*!==\s*null/);
  });
});

describe("Case A：LINE email 等於既有帳號的 primaryEmail → 不合併", () => {
  it("建立獨立的 LINE 帳號，既有帳號不受影響", async () => {
    const email = `lid-a-${runId}@example.test`;
    const existing = await existingUserWithPrimaryEmail("a", email);
    const result = await lineLogin("a", email);
    expect(result.openId).not.toBe(existing.openId);
    expect(result.openId).toBe(`line_lid-${runId}-a`);
    const created = await db.getUserByOpenId(result.openId);
    expect(created?.primaryEmail ?? null).toBeNull();   // 不成為可信 primaryEmail
    expect(created?.email ?? null).toBeNull();          // 不寫入 users.email
  });

  it("縱深防禦：即使呼叫端誤傳 providerEmailVerified=true，LINE 也不合併", async () => {
    const email = `lid-a2-${runId}@example.test`;
    const existing = await existingUserWithPrimaryEmail("a2", email);
    const result = await lineLogin("a2", email, true);
    expect(result.openId).not.toBe(existing.openId);
  });
});

describe("Case B：同一個 LINE provider identity 第二次登入 → 同一個 OXM 帳號", () => {
  it("第二次登入回到原本的帳號，不會每次都建立新帳號", async () => {
    const first = await lineLogin("b", `lid-b-${runId}@example.test`);
    const second = await lineLogin("b", `lid-b-${runId}@example.test`);
    const third = await lineLogin("b", null); // LINE 這次沒給 email
    expect(second.openId).toBe(first.openId);
    expect(third.openId).toBe(first.openId);
    const u1 = await db.getUserByOpenId(first.openId);
    const linked = await db.getUserByAuthAccount("line", `lid-${runId}-b`);
    expect(linked?.id).toBe(u1?.id);
  });
});

describe("Case C：LINE email 等於 admin 白名單 email → 不取得 admin", () => {
  it("新 LINE 帳號不是 admin", async () => {
    const adminEmail = ENV.adminWhitelistEmails[0];
    expect(adminEmail).toBeTruthy();
    const result = await lineLogin("c", adminEmail!);
    const user = await db.getUserByOpenId(result.openId);
    expect(user?.role).not.toBe("admin");
    expect(isAdminUser(user!)).toBe(false);
  });
});

describe("Case D：LINE 沒有 email → 登入照常", () => {
  it("建立帳號並可再次登入同一帳號", async () => {
    const first = await lineLogin("d", null);
    expect(await db.getUserByOpenId(first.openId)).toBeTruthy();
    expect((await lineLogin("d", null)).openId).toBe(first.openId);
  });
});

describe("Case E／F：Google 行為不受影響", () => {
  it("E：Google verified_email=true → 維持原本的正確合併", async () => {
    const email = `lid-e-${runId}@example.test`;
    const existing = await existingUserWithPrimaryEmail("e", email);
    expect((await googleLogin("e", email, true)).openId).toBe(existing.openId);
  });
  it("F：Google verified_email=false → 不合併", async () => {
    const email = `lid-f-${runId}@example.test`;
    const existing = await existingUserWithPrimaryEmail("f", email);
    expect((await googleLogin("f", email, false)).openId).not.toBe(existing.openId);
  });
});
