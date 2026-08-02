/**
 * 建立工廠 — 主信箱驗證攔截（前端提前攔截 + 後端硬性防線）
 *
 * 背景：後端 factory.create 一直都用 requireVerifiedEmail() 擋下未驗證主信箱
 * 的帳號（見 server/routers.ts）。這裡新增的前端攔截（client/src/pages/
 * FactoryRegister.tsx）只是把同一條規則提前到「進入表單前」，不能取代、也
 * 不能弱化後端這一層。本檔案專門驗證：
 *   1. 後端硬性防線本身仍然有效（沒有 primaryEmail／有 primaryEmail 但未
 *      驗證，兩種情況都必須被擋下，且沒有任何工廠被建立）。
 *   2. Google／LINE／Apple 等不同登入方式一律只以 primaryEmailVerifiedAt
 *      判斷，沒有任何 loginMethod 例外或繞過。
 *   3. 已驗證使用者不受影響，可以正常建立工廠（真實 DB fixture + 事後清除）。
 *
 * 拒絕路徑（requireVerifiedEmail 在呼叫 db.createFactoryAtomic 之前就丟出
 * TRPCError）完全不會寫入資料庫，因此可以用純記憶體的 ctx.user 物件測試，
 * 不需要真的建立使用者列。成功路徑因為 createFactoryAtomic 會對 users 表下
 * `SELECT ... FOR UPDATE` 鎖，需要真實存在的 user id，因此用 mysql2 建立
 * 一筆真實測試使用者列，並在 afterAll 清除。
 */
import { describe, it, expect, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(overrides: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-1",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "google",
    role: "user",
    isFactoryOwner: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  } as AuthenticatedUser;
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const MINIMAL_FACTORY_INPUT = {
  name: "[EMAIL_GUARD_TEST] Factory",
  industry: ["電子"],
  mfgModes: ["ODM"],
  region: "新竹市",
  capitalLevel: "1000萬以下",
  address: "新竹市東區某路 1 號",
  businessType: "factory" as const,
};

describe("factory.create 拒絕路徑：後端 primaryEmailVerifiedAt 硬性防線仍然有效", () => {
  it("沒有 primaryEmail 的帳號送出，被 FORBIDDEN／UNVERIFIED_EMAIL 擋下", async () => {
    const ctx = createAuthContext({
      id: 900001, openId: "guard-test-no-email",
      primaryEmail: null, primaryEmailVerifiedAt: null,
    } as Partial<AuthenticatedUser>);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.factory.create(MINIMAL_FACTORY_INPUT)).rejects.toThrow("UNVERIFIED_EMAIL");
  });

  it("有 primaryEmail 但尚未驗證，送出一樣被 FORBIDDEN／UNVERIFIED_EMAIL 擋下", async () => {
    const ctx = createAuthContext({
      id: 900002, openId: "guard-test-unverified-email",
      primaryEmail: "guard-test-unverified@oxm.test", primaryEmailVerifiedAt: null,
    } as Partial<AuthenticatedUser>);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.factory.create(MINIMAL_FACTORY_INPUT)).rejects.toThrow("UNVERIFIED_EMAIL");
  });

  it.each(["google", "line", "apple"] as const)(
    "%s 登入且尚未驗證主信箱，一律只以 primaryEmailVerifiedAt 判斷，同樣被擋下（沒有 loginMethod 例外）",
    async (loginMethod) => {
      const ctx = createAuthContext({
        id: 900010, openId: `guard-test-${loginMethod}`,
        loginMethod,
        primaryEmail: `guard-test-${loginMethod}@oxm.test`, primaryEmailVerifiedAt: null,
      } as Partial<AuthenticatedUser>);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.factory.create(MINIMAL_FACTORY_INPUT)).rejects.toThrow("UNVERIFIED_EMAIL");
    },
  );
});

describe("factory.create 成功路徑：primaryEmailVerifiedAt 有值時可以正常建立工廠", () => {
  let pool: mysql.Pool | undefined;
  let createdUserId: number | undefined;

  afterAll(async () => {
    if (!pool) return;
    // 依賴順序清除，避免 FK 錯誤；工廠與使用者都用固定標記，方便辨識與清除。
    await pool.execute("DELETE FROM factories WHERE name = ?", [MINIMAL_FACTORY_INPUT.name]);
    if (createdUserId) {
      await pool.execute("DELETE FROM users WHERE id = ?", [createdUserId]);
    }
    await pool.end();
  });

  it("Google 登入、primaryEmailVerifiedAt 有值的帳號可以正常建立工廠", async () => {
    // createFactoryAtomic 會對 users 表下 SELECT ... FOR UPDATE 鎖，需要真實
    // 存在的 user id，因此這裡建立一筆真實測試使用者列（非純記憶體 ctx）。
    pool = mysql.createPool(process.env.DATABASE_URL!);
    const email = "guard-test-verified@oxm.test";
    const [insertResult]: any = await pool.execute(
      "INSERT INTO users (openId, email, name, primaryEmail, primaryEmailVerifiedAt, loginMethod, isFactoryOwner, role, lastSignedIn) VALUES (?, ?, ?, ?, NOW(), 'google', FALSE, 'user', NOW())",
      ["guard-test-verified-openid", email, "Guard Test Verified", email],
    );
    createdUserId = insertResult.insertId;

    const ctx = createAuthContext({
      id: createdUserId, openId: "guard-test-verified-openid",
      primaryEmail: email, primaryEmailVerifiedAt: new Date(), loginMethod: "google",
    } as Partial<AuthenticatedUser>);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.factory.create(MINIMAL_FACTORY_INPUT);
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
  }, 15000);
});
