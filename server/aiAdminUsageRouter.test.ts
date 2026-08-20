/**
 * Phase 9.2：admin.aiUsage.dashboard／admin.aiUsage.recentTurns 的路由層
 * 整合測試——走真實本機測試資料庫，用 appRouter.createCaller(ctx) 直接呼叫
 * tRPC procedure（沿用 server/adminFactoryCrm.test.ts 的 createAuthContext
 * 慣例：isAdminUser() 在本機只認 .env 裡實際設定的 ADMIN_WHITELIST_EMAILS，
 * 不能只靠隨便設一個 isAdmin:true 欄位）。
 *
 * A1-A3：權限稽核。D11／D12／D14：response shape／分頁／空日期。
 * D1-D10／D13／D15／D16 的資料正確性測試在 server/ai/aiUsageAudit.test.ts
 * （service 層，用更精細的 fixture 控制），這裡不重複。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getTaipeiQuotaDate } from "./ai/taipeiTime";
import { AI_FACTORY_DAILY_TURN_LIMIT } from "../shared/ai/aiQuotaConfig";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let conn: mysql.PoolConnection;
const PREFIX = "[ADMIN_AI_ROUTER_TEST]";

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// 見 adminFactoryCrm.test.ts 的同一段說明：本機 isAdminUser() 只認
// ADMIN_WHITELIST_EMAILS，不能靠自訂 isAdmin 欄位 bypass adminProcedure。
function createAuthContext(id: number, overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const isAdmin = overrides?.role === "admin";
  const user: AuthenticatedUser = {
    id,
    openId: isAdmin ? "admin-ai-router-test-admin" : `ai-router-test-user-${id}`,
    email: isAdmin ? "scottsusu0513@gmail.com" : `ai-router-test-${id}@example.test`,
    name: "AI Usage Router Test",
    loginMethod: isAdmin ? "google" : "manus",
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

let userCounter = 0;
async function mkUser(): Promise<number> {
  userCounter += 1;
  const email = `admin_ai_router_test_${userCounter}@oxm.test`;
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, email, name, isFactoryOwner, role, lastSignedIn) VALUES (?, ?, ?, FALSE, 'user', NOW())",
    [email, email, email]
  );
  return r.insertId;
}

async function mkFactory(ownerId: number): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'normal', FALSE, ?, NOW(), NOW())",
    [ownerId, `${PREFIX} F${ownerId}`, JSON.stringify(["電子"]), JSON.stringify(["ODM"]), "新竹市", "<1000萬", "新竹市", "[]"]
  );
  return r.insertId;
}

async function cleanup() {
  await conn.execute("DELETE FROM aiModelCalls WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiUsageTurns WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiUsageTurns WHERE actorUserId IN (SELECT id FROM users WHERE email LIKE ?)", ["admin_ai_router_test_%@oxm.test"]);
  await conn.execute("DELETE FROM factoryAiDailyUsage WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM factories WHERE name LIKE ?", [PREFIX + "%"]);
  await conn.execute("DELETE FROM users WHERE email LIKE ?", ["admin_ai_router_test_%@oxm.test"]);
}

beforeAll(async () => {
  if (!DB_URL) return;
  pool = mysql.createPool(DB_URL);
  conn = await pool.getConnection();
  await cleanup();
});

afterAll(async () => {
  if (!DB_URL) return;
  await cleanup();
  conn.release();
  await pool.end();
});

describeIfDb("admin.aiUsage（Phase 9.2 router 層）", () => {
  it("A1：一般登入使用者（無工廠、非 admin）呼叫 dashboard 被拒絕", async () => {
    const userId = await mkUser();
    const caller = appRouter.createCaller(createAuthContext(userId, { role: "user" }));
    await expect(caller.admin.aiUsage.dashboard()).rejects.toThrow();
  });

  it("A1b：guest 呼叫 dashboard 被拒絕", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    await expect(caller.admin.aiUsage.dashboard()).rejects.toThrow();
  });

  it("A2：已核准工廠的 owner（非 admin）呼叫 dashboard 被拒絕", async () => {
    const ownerId = await mkUser();
    await mkFactory(ownerId);
    const caller = appRouter.createCaller(createAuthContext(ownerId, { role: "user" }));
    await expect(caller.admin.aiUsage.dashboard()).rejects.toThrow();
    await expect(caller.admin.aiUsage.recentTurns({ page: 1, pageSize: 20 })).rejects.toThrow();
  });

  it("A3：admin 呼叫 dashboard／recentTurns 都允許", async () => {
    const adminId = await mkUser();
    const caller = appRouter.createCaller(createAuthContext(adminId, { role: "admin" }));
    const dashboard = await caller.admin.aiUsage.dashboard();
    expect(dashboard.quotaDate).toBe(getTaipeiQuotaDate());
    const recent = await caller.admin.aiUsage.recentTurns({ page: 1, pageSize: 20 });
    expect(recent).toHaveProperty("items");
  });

  it("D11：response 不含任何內容欄位（message／content／prompt／email／phone／memory／formData 之類）", async () => {
    const adminId = await mkUser();
    const caller = appRouter.createCaller(createAuthContext(adminId, { role: "admin" }));
    const dashboard = await caller.admin.aiUsage.dashboard();
    const recent = await caller.admin.aiUsage.recentTurns({ page: 1, pageSize: 20 });
    const forbidden = /message|content|prompt|response|email|phone|memory|formdata/i;
    const serialized = JSON.stringify({ dashboard, recent });
    // 只檢查「鍵名」不含禁止字樣（值本身可能剛好包含子字串，例如
    // resourceTarget 的值是 "factory_search"，所以只檢查 key，不檢查整個
    // serialize 結果——這裡改用結構化方式逐一檢查已知回傳物件的 key。
    function collectKeys(obj: unknown, acc: Set<string>) {
      if (Array.isArray(obj)) { obj.forEach(v => collectKeys(v, acc)); return; }
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          acc.add(k);
          collectKeys(v, acc);
        }
      }
    }
    const keys = new Set<string>();
    collectKeys(dashboard, keys);
    collectKeys(recent, keys);
    const suspiciousKeys = Array.from(keys).filter(k => forbidden.test(k));
    expect(suspiciousKeys).toEqual([]);
    expect(serialized.length).toBeGreaterThan(0); // 避免 unused var 警告，同時確認真的有序列化到東西
  });

  it("D12：recentTurns 分頁參數正確反映在回傳的 page/pageSize/total/totalPages", async () => {
    const adminId = await mkUser();
    const caller = appRouter.createCaller(createAuthContext(adminId, { role: "admin" }));
    const page1 = await caller.admin.aiUsage.recentTurns({ page: 1, pageSize: 5 });
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(5);
    expect(page1.totalPages).toBe(Math.ceil(page1.total / 5));
  });

  it("D14：完全沒有資料的日期，dashboard 回傳全零而不是 error", async () => {
    const adminId = await mkUser();
    const caller = appRouter.createCaller(createAuthContext(adminId, { role: "admin" }));
    const dashboard = await caller.admin.aiUsage.dashboard({ quotaDate: "2020-01-01" });
    expect(dashboard.summary.totalTurns).toBe(0);
    expect(dashboard.factories).toEqual([]);
    expect(dashboard.counterMismatchCount).toBe(0);
  });

  it("D15：factories[].limit 一律等於 AI_FACTORY_DAILY_TURN_LIMIT（不是前端／router 自己硬寫的數字）", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const quotaDate = getTaipeiQuotaDate();
    await conn.execute(
      "INSERT INTO aiUsageTurns (factoryId, actorUserId, conversationId, clientTurnId, quotaDate, status, quotaCharged, attemptCount, createdAt) VALUES (?, ?, NULL, 'd15-turn', ?, 'completed', TRUE, 1, NOW())",
      [factoryId, ownerId, quotaDate]
    );
    await conn.execute(
      "INSERT INTO factoryAiDailyUsage (factoryId, quotaDate, usedTurns) VALUES (?, ?, 1)",
      [factoryId, quotaDate]
    );
    const adminId = await mkUser();
    const caller = appRouter.createCaller(createAuthContext(adminId, { role: "admin" }));
    const dashboard = await caller.admin.aiUsage.dashboard();
    const row = dashboard.factories.find(f => f.factoryId === factoryId);
    expect(row?.limit).toBe(AI_FACTORY_DAILY_TURN_LIMIT);
  });
});
