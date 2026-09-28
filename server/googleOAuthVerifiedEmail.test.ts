/**
 * Google OAuth：只信任 Google 明確回傳 verified_email === true 的 email
 * （Production Hardening Batch 2）。
 *
 * 修正前 server/_core/oauth.ts 寫死 `providerEmailVerified: true // Google
 * always verifies email`，未驗證的 Google email 也會：
 *   - 觸發以 primaryEmail 為依據的自動帳號合併（可能接管既有帳號）；
 *   - 寫進 users.email 而參與 admin email 白名單判斷；
 *   - 被設成可信 primaryEmail。
 * 這裡用真實本機測試資料庫走 handleOAuthCallback（所有 provider 共用的登入
 * 處理），驗證四種情境。
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import * as db from "./db";
import { handleOAuthCallback, isGoogleEmailVerified } from "./_core/oauthHelpers";
import { isAdminUser } from "./_core/admin";
import { ENV } from "./_core/env";
import { ensureTestUser } from "./_core/financeTestFixtures";

const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createdOpenIds: string[] = [];
const createdUserIds: number[] = [];

afterAll(async () => {
  const conn = await db.getDb();
  if (!conn) return;
  // 合併情境會把本次的 provider 帳號掛到既有 user 上，先移除這些連結。
  await conn.execute(sql`DELETE FROM userAuthAccounts WHERE provider = 'google' AND providerAccountId LIKE ${`gv-${runId}-%`}`);
  for (const openId of createdOpenIds) await conn.execute(sql`DELETE FROM users WHERE openId = ${openId}`);
  for (const id of createdUserIds) await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
});

async function login(accountSuffix: string, email: string | null, verified: boolean) {
  const providerAccountId = `gv-${runId}-${accountSuffix}`;
  createdOpenIds.push(`google_${providerAccountId}`);
  return handleOAuthCallback({
    provider: "google",
    providerAccountId,
    providerEmail: email,
    providerEmailVerified: verified,
    displayName: `Google 驗證測試 ${accountSuffix}`,
  });
}

describe("isGoogleEmailVerified：只有 verified_email === true 才算已驗證", () => {
  it.each([
    [{ verified_email: true }, true],
    [{ verified_email: false }, false],
    [{}, false],                        // 欄位缺失 → 不可 fallback true
    [{ verified_email: "true" }, false], // 非布林值不接受
    [{ verified_email: 1 }, false],
    [null, false],
    [undefined, false],
  ])("%j → %s", (info, expected) => {
    expect(isGoogleEmailVerified(info as { verified_email?: unknown } | null | undefined)).toBe(expected);
  });

  it("oauth.ts 的 Google callback 使用實際的 verified_email，不再寫死 true", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "_core", "oauth.ts"), "utf-8");
    expect(source).toContain("providerEmailVerified: isGoogleEmailVerified(userInfo)");
    expect(source).not.toMatch(/providerEmailVerified:\s*true/);
  });
});

describe("handleOAuthCallback（Google）：verified 與 unverified 的帳號合併", () => {
  it("verified_email=true → 維持原有流程：同 email 的既有帳號自動合併", async () => {
    const email = `gv-merge-yes-${runId}@example.test`;
    const existingId = await ensureTestUser(`gv-existing-yes-${runId}`, "既有帳號（會被合併）");
    createdUserIds.push(existingId);
    await db.setPrimaryEmailVerified(existingId, email);
    const existing = await db.getUserById(existingId);

    const result = await login("merge-yes", email, true);
    expect(result.openId).toBe(existing!.openId);
  });

  it("verified_email=false → 不合併：建立獨立的新帳號，既有帳號不受影響", async () => {
    const email = `gv-merge-no-${runId}@example.test`;
    const existingId = await ensureTestUser(`gv-existing-no-${runId}`, "既有帳號（不可被接管）");
    createdUserIds.push(existingId);
    await db.setPrimaryEmailVerified(existingId, email);
    const existing = await db.getUserById(existingId);

    const result = await login("merge-no", email, false);
    expect(result.openId).not.toBe(existing!.openId);
    expect(result.openId).toBe(`google_gv-${runId}-merge-no`);

    const created = await db.getUserByOpenId(result.openId);
    expect(created?.email ?? null).toBeNull();        // 未驗證 email 不寫入 users.email
    expect(created?.primaryEmail ?? null).toBeNull(); // 也不成為可信 primaryEmail
    expect(created?.primaryEmailVerifiedAt ?? null).toBeNull();
  });
});

describe("handleOAuthCallback（Google）：admin email 白名單只接受已驗證 email", () => {
  const adminEmail = ENV.adminWhitelistEmails[0];

  it("前提：測試環境有設定 admin 白名單", () => {
    expect(adminEmail).toBeTruthy();
  });

  it("verified_email=false + admin 白名單 email → 不取得 admin", async () => {
    const result = await login("admin-unverified", adminEmail!, false);
    const user = await db.getUserByOpenId(result.openId);
    expect(user).toBeTruthy();
    expect(user!.role).not.toBe("admin");
    expect(user!.email ?? null).toBeNull();
    expect(isAdminUser(user!)).toBe(false);
  });

  it("verified_email=true + admin 白名單 email → 原有流程取得 admin", async () => {
    // 白名單 email 可能已被本機既有帳號設成 primaryEmail（會觸發合併），這裡
    // 只斷言最後登入的那個帳號是 admin，不論是新帳號還是合併到的既有帳號。
    const result = await login("admin-verified", adminEmail!, true);
    const user = await db.getUserByOpenId(result.openId);
    expect(user).toBeTruthy();
    expect(isAdminUser(user!)).toBe(true);
  });
});
