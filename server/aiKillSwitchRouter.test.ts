/**
 * Phase 12.2 K 系列：OXM_AI_ENABLED 全域 kill switch（見對話中「一~五」）。
 *
 * ENV.aiEnabled 是 env.ts 模組載入當下算出來的值，不是每次讀取都重算，所以
 * K1-K3 用 vi.resetModules() + 動態 import 讓 env.ts 用當時設定的
 * OXM_AI_ENABLED 重新求值一次（沿用 server/_core/security.test.ts 已經驗證
 * 過的手法）。K4-K8 需要真的打真實 DB＋tRPC router 驗證「disabled 時完全零
 * side effect」，同樣用 resetModules 讓 routers.ts／env.ts 用 disabled 狀態
 * 重新載入一次，但只做一次（不是每個 case 各自 reset 一次），避免不必要地
 * 反覆重建 DB pool。
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { createTestFactory } from "./_core/financeTestFixtures";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const mockRunEnterpriseDiagnosis = vi.fn();
vi.mock("./ai/diagnosis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/diagnosis")>();
  return { ...actual, runEnterpriseDiagnosis: (...args: unknown[]) => mockRunEnterpriseDiagnosis(...args) };
});

const mockRunOxmRouting = vi.fn();
vi.mock("./ai/routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/routing")>();
  return { ...actual, runOxmRouting: (...args: unknown[]) => mockRunOxmRouting(...args) };
});

const mockCompleteJson = vi.fn();
vi.mock("./ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/provider")>();
  return { ...actual, getAiChatProvider: () => ({ completeJson: (...args: unknown[]) => mockCompleteJson(...args) }) };
});

function ctxForFactoryOwner(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `kill-switch-owner-${userId}`, email: `kill-switch-owner-${userId}@example.test`,
    name: "Kill Switch Factory Owner Test", loginMethod: "manus", role: "user", isFactoryOwner: true,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    isAdmin: false,
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

function ctxForAdminNoFactory(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `kill-switch-admin-${userId}`, email: `kill-switch-admin-${userId}@example.test`,
    name: "Kill Switch Admin No Factory Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    isAdmin: true,
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

let clientTurnIdSeq = 0;
function nextClientTurnId(): string {
  clientTurnIdSeq += 1;
  return `kill-switch-turn-${clientTurnIdSeq}`;
}

const runId = `kill-switch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Kill Switch ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  createdUserIds.push(id);
  return id;
}

describe("ENV.aiEnabled 語意（Phase 12.2 K1-K3：unset→enabled，明確 true/false）", () => {
  async function aiEnabledFor(value: string | undefined): Promise<boolean> {
    const original = process.env.OXM_AI_ENABLED;
    if (value === undefined) delete process.env.OXM_AI_ENABLED; else process.env.OXM_AI_ENABLED = value;
    vi.resetModules();
    try {
      const { ENV } = await import("./_core/env");
      return ENV.aiEnabled;
    } finally {
      if (original === undefined) delete process.env.OXM_AI_ENABLED; else process.env.OXM_AI_ENABLED = original;
      vi.resetModules();
    }
  }

  it("K1：OXM_AI_ENABLED=true → enabled", async () => {
    expect(await aiEnabledFor("true")).toBe(true);
  });

  it("K2：unset → 預設 enabled（不能因 production 忘記設定就變成關閉）", async () => {
    expect(await aiEnabledFor(undefined)).toBe(true);
  });

  it("K3：OXM_AI_ENABLED=false → disabled", async () => {
    expect(await aiEnabledFor("false")).toBe(false);
  });
});

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("ai.chat kill switch server-side gate（Phase 12.2 K4-K8：disabled 時零 side effect）", () => {
  let disabledAppRouter: typeof import("./routers")["appRouter"];
  const originalEnvValue = process.env.OXM_AI_ENABLED;
  // Phase 13.0.1（見對話「二、六」）：kill switch 測的是 OXM_AI_ENABLED，跟
  // release mode（OXM_AI_RELEASE_MODE）是兩個完全獨立的 gate——release mode
  // 短路在 ai.chat 最前面，比 kill switch 更外層，release mode 的預設安全值
  // "coming_soon" 會讓這裡的 disabledAppRouter 永遠回傳 reason=coming_soon，
  // 根本測不到 kill switch 本身。這裡必須明確把 release mode 設成 "live"，
  // 才是「正式開放後、kill switch 關閉」這個要測的產品狀態；Coming Soon
  // 本身已經有 Phase 13.0 專屬測試，不在這個檔案裡重複測。
  const originalReleaseMode = process.env.OXM_AI_RELEASE_MODE;
  let ownerId: number;
  let factoryId: number;
  let adminId: number;

  beforeAll(async () => {
    ownerId = await createTestUser();
    factoryId = await createTestFactory(ownerId, `[KILL_SWITCH_TEST] ${runId}`);
    adminId = await createTestUser();

    process.env.OXM_AI_ENABLED = "false";
    process.env.OXM_AI_RELEASE_MODE = "live";
    vi.resetModules();
    const mod = await import("./routers");
    disabledAppRouter = mod.appRouter;
  });

  afterAll(async () => {
    if (originalEnvValue === undefined) delete process.env.OXM_AI_ENABLED; else process.env.OXM_AI_ENABLED = originalEnvValue;
    if (originalReleaseMode === undefined) delete process.env.OXM_AI_RELEASE_MODE; else process.env.OXM_AI_RELEASE_MODE = originalReleaseMode;
    vi.resetModules();

    const conn = await getDb();
    if (!conn) return;
    await conn.execute(sql`DELETE FROM aiModelCalls WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiUsageTurns WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiUsageTurns WHERE actorUserId = ${adminId}`);
    await conn.execute(sql`DELETE FROM factoryAiDailyUsage WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiHandoffContexts WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiFactorySearchRequests WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
    if (createdUserIds.length > 0) {
      await conn.execute(sql`DELETE FROM users WHERE id IN (${sql.join(createdUserIds, sql`, `)})`);
    }
  });

  it("K3（server 回應）：disabled 時 ai.chat 回傳 deterministic status=denied/reason=ai_disabled，不是 500", async () => {
    const result = await disabledAppRouter.createCaller(ctxForFactoryOwner(ownerId)).ai.chat({
      message: "disabled 狀態下的測試訊息", clientTurnId: nextClientTurnId(),
    });
    expect(result).toEqual({ status: "denied", reason: "ai_disabled" });
  });

  it("K4：disabled 時完全不觸碰 quota（factoryAiDailyUsage 沒有任何列被建立/變更）", async () => {
    await disabledAppRouter.createCaller(ctxForFactoryOwner(ownerId)).ai.chat({
      message: "不應該扣額度", clientTurnId: nextClientTurnId(),
    });
    const conn = await getDb();
    const [rows]: any = await conn!.execute(sql`SELECT usedTurns FROM factoryAiDailyUsage WHERE factoryId = ${factoryId}`);
    expect(rows.length).toBe(0);
  });

  it("K5：disabled 時不建立任何 aiUsageTurns row", async () => {
    await disabledAppRouter.createCaller(ctxForFactoryOwner(ownerId)).ai.chat({
      message: "不應該建立 usage turn", clientTurnId: nextClientTurnId(),
    });
    const conn = await getDb();
    const [rows]: any = await conn!.execute(sql`SELECT COUNT(*) as cnt FROM aiUsageTurns WHERE factoryId = ${factoryId}`);
    expect(rows[0].cnt).toBe(0);
  });

  it("K6：disabled 時完全不呼叫任何 provider 層（Diagnosis／Routing／Memory Summary）", async () => {
    mockRunEnterpriseDiagnosis.mockClear();
    mockRunOxmRouting.mockClear();
    mockCompleteJson.mockClear();
    await disabledAppRouter.createCaller(ctxForFactoryOwner(ownerId)).ai.chat({
      message: "不應該打任何 provider", clientTurnId: nextClientTurnId(),
    });
    expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
    expect(mockRunOxmRouting).not.toHaveBeenCalled();
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it("K7：disabled 時不建立任何 conversation／handoff／sourcing side effect", async () => {
    const conn = await getDb();
    const [before]: any = await conn!.execute(sql`SELECT COUNT(*) as cnt FROM aiConversations WHERE factoryId = ${factoryId}`);
    await disabledAppRouter.createCaller(ctxForFactoryOwner(ownerId)).ai.chat({
      message: "幫我找台中的 CNC 加工廠", clientTurnId: nextClientTurnId(),
    });
    const [after]: any = await conn!.execute(sql`SELECT COUNT(*) as cnt FROM aiConversations WHERE factoryId = ${factoryId}`);
    expect(after[0].cnt).toBe(before[0].cnt);
    const [handoffRows]: any = await conn!.execute(sql`SELECT COUNT(*) as cnt FROM aiHandoffContexts WHERE factoryId = ${factoryId}`);
    expect(handoffRows[0].cnt).toBe(0);
  });

  it("K8：disabled 時 Admin 也不能用（整個系統緊急停止，不是使用者限制）", async () => {
    const result = await disabledAppRouter.createCaller(ctxForAdminNoFactory(adminId)).ai.chat({
      message: "admin 也應該被擋", clientTurnId: nextClientTurnId(),
    });
    expect(result).toEqual({ status: "denied", reason: "ai_disabled" });
    const conn = await getDb();
    const [rows]: any = await conn!.execute(sql`SELECT COUNT(*) as cnt FROM aiUsageTurns WHERE actorUserId = ${adminId}`);
    expect(rows[0].cnt).toBe(0);
  });
});
