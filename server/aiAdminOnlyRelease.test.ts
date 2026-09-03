/**
 * OXM Final Public Release — Admin-only Release regression（見對話「OXM Final
 * Public Release — Add Two Urgent Fixes Before Push」urgent fix 1）。
 *
 * 產品決策：OXM AI 目前因使用成本考量暫不對一般使用者開放（ENV.aiReleaseMode
 * 預設 "coming_soon"），但 Admin 必須能正常使用。實作把 server/routers.ts 的
 * releaseMode／entitlementStatus／ai.chat 三個既有短路條件從「ENV.aiReleaseMode
 * !== "live" 就一律短路」改成「ENV.aiReleaseMode !== "live" 且非 Admin 才短
 * 路」，沿用既有 ctx.user?.isAdmin 訊號（與 resolveAiEntitlement 呼叫同一個
 * 來源），沒有新增第二套權限系統。
 *
 * 這個檔案跟 server/aiKillSwitchRouter.test.ts（測 OXM_AI_ENABLED，比 release
 * mode 更內層的獨立 gate）刻意分開：kill switch 檔案把 release mode 固定設成
 * "live" 只測 kill switch 本身；這裡反過來把 release mode 固定設成
 * "coming_soon"、kill switch 固定設成 "true"（enabled），只測 release mode 這
 * 一層短路本身對五種身分（匿名／一般會員／工廠 owner／co-manager／admin）的
 * 行為，避免兩個檔案互相測到對方負責的 gate。
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { createTestFactory } from "./_core/financeTestFixtures";
import type { TrpcContext } from "./_core/context";
import type { EnterpriseDiagnosis } from "./ai/diagnosis";

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

const anonymousCtx: TrpcContext = { user: undefined, req: {} as any, res: {} as any };

function ctxFor(userId: number, isAdmin: boolean): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `admin-release-${userId}`, email: `admin-release-${userId}@example.test`,
    name: "Admin Only Release Test", loginMethod: "manus", role: "user", isFactoryOwner: false,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    isAdmin,
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

let clientTurnIdSeq = 0;
function nextClientTurnId(): string {
  clientTurnIdSeq += 1;
  return `admin-release-turn-${clientTurnIdSeq}`;
}

const runId = `admin-release-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
let userSeq = 0;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  userSeq += 1;
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Admin Release ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  createdUserIds.push(id);
  return id;
}

const BASE_DIAGNOSIS: EnterpriseDiagnosis = {
  conversationIntent: "business_exploration",
  casualTurnDomainRelevant: true,
  observedProblem: "測試訊息",
  likelyBottleneck: null,
  bottleneckStatus: "unclear",
  evidence: [],
  alternativeHypotheses: [],
  secondaryConcern: null,
  recommendedBusinessDirection: null,
  nextBestQuestion: "admin-only release 測試回覆",
  shouldStopQuestioning: false,
  userWantsAction: false,
  confirmedFacts: {},
};

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("ai release mode Admin-only bypass（release mode = coming_soon，kill switch = enabled）", () => {
  let appRouterWithComingSoon: typeof import("./routers")["appRouter"];
  const originalReleaseMode = process.env.OXM_AI_RELEASE_MODE;
  const originalEnabled = process.env.OXM_AI_ENABLED;

  let memberId: number;
  let ownerId: number;
  let factoryId: number;
  let coManagerId: number;
  let adminId: number;

  beforeAll(async () => {
    memberId = await createTestUser();
    ownerId = await createTestUser();
    factoryId = await createTestFactory(ownerId, `[ADMIN_RELEASE_TEST] ${runId}`);
    coManagerId = await createTestUser();
    adminId = await createTestUser();

    const conn = await getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(sql`INSERT INTO factoryCoManagers (factoryId, userId, invitedBy, createdAt) VALUES (${factoryId}, ${coManagerId}, ${ownerId}, NOW())`);

    process.env.OXM_AI_RELEASE_MODE = "coming_soon";
    process.env.OXM_AI_ENABLED = "true";
    vi.resetModules();
    const mod = await import("./routers");
    appRouterWithComingSoon = mod.appRouter;

    mockRunEnterpriseDiagnosis.mockResolvedValue(BASE_DIAGNOSIS);
    mockRunOxmRouting.mockResolvedValue({
      primaryService: null,
      secondaryService: null,
      relationship: null,
      serviceFitReason: "",
      shouldOfferHandoff: false,
      finalReply: "admin-only release 測試回覆",
    });
  });

  afterAll(async () => {
    if (originalReleaseMode === undefined) delete process.env.OXM_AI_RELEASE_MODE; else process.env.OXM_AI_RELEASE_MODE = originalReleaseMode;
    if (originalEnabled === undefined) delete process.env.OXM_AI_ENABLED; else process.env.OXM_AI_ENABLED = originalEnabled;
    vi.resetModules();

    const conn = await getDb();
    if (!conn) return;
    await conn.execute(sql`DELETE FROM aiModelCalls WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiUsageTurns WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiUsageTurns WHERE actorUserId IN (${adminId})`);
    await conn.execute(sql`DELETE FROM factoryAiDailyUsage WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiHandoffContexts WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiFactorySearchRequests WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM factoryCoManagers WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
    if (createdUserIds.length > 0) {
      await conn.execute(sql`DELETE FROM users WHERE id IN (${sql.join(createdUserIds, sql`, `)})`);
    }
  });

  describe("releaseMode query：只有 Admin 在 coming_soon 期間看到 live", () => {
    it("匿名 → mode 仍是 coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(anonymousCtx).ai.releaseMode();
      expect(result).toEqual({ mode: "coming_soon" });
    });

    it("Admin → mode 回報 live", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(adminId, true)).ai.releaseMode();
      expect(result).toEqual({ mode: "live" });
    });
  });

  describe("entitlementStatus query：非 Admin 一律 coming_soon，Admin 略過短路拿到真正的 entitlement", () => {
    it("匿名 → kind: coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(anonymousCtx).ai.entitlementStatus();
      expect(result).toEqual({ kind: "coming_soon" });
    });

    it("一般會員（無工廠）→ kind: coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(memberId, false)).ai.entitlementStatus();
      expect(result).toEqual({ kind: "coming_soon" });
    });

    it("工廠 owner → kind: coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(ownerId, false)).ai.entitlementStatus();
      expect(result).toEqual({ kind: "coming_soon" });
    });

    it("co-manager → kind: coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(coManagerId, false)).ai.entitlementStatus();
      expect(result).toEqual({ kind: "coming_soon" });
    });

    it("Admin → 略過 coming_soon 短路，回傳真正的 kind: admin entitlement（非 coming_soon）", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(adminId, true)).ai.entitlementStatus();
      expect(result.kind).toBe("admin");
      expect(result).not.toEqual({ kind: "coming_soon" });
    });
  });

  describe("ai.chat mutation：非 Admin 一律 denied/coming_soon 且零 side effect，Admin 真正跑完整個 pipeline", () => {
    it("匿名 → status: denied, reason: coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(anonymousCtx).ai.chat({
        message: "匿名測試訊息", clientTurnId: nextClientTurnId(),
      });
      expect(result).toEqual({ status: "denied", reason: "coming_soon" });
    });

    it("一般會員 → status: denied, reason: coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(memberId, false)).ai.chat({
        message: "一般會員測試訊息", clientTurnId: nextClientTurnId(),
      });
      expect(result).toEqual({ status: "denied", reason: "coming_soon" });
    });

    it("工廠 owner → status: denied, reason: coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(ownerId, false)).ai.chat({
        message: "工廠 owner 測試訊息", clientTurnId: nextClientTurnId(),
      });
      expect(result).toEqual({ status: "denied", reason: "coming_soon" });
    });

    it("co-manager → status: denied, reason: coming_soon", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(coManagerId, false)).ai.chat({
        message: "co-manager 測試訊息", clientTurnId: nextClientTurnId(),
      });
      expect(result).toEqual({ status: "denied", reason: "coming_soon" });
    });

    it("非 Admin 被 coming_soon 擋下時完全不觸碰 provider／quota（零 side effect）", async () => {
      mockRunEnterpriseDiagnosis.mockClear();
      mockRunOxmRouting.mockClear();
      mockCompleteJson.mockClear();
      await appRouterWithComingSoon.createCaller(ctxFor(ownerId, false)).ai.chat({
        message: "不應該打任何 provider", clientTurnId: nextClientTurnId(),
      });
      expect(mockRunEnterpriseDiagnosis).not.toHaveBeenCalled();
      expect(mockRunOxmRouting).not.toHaveBeenCalled();
      expect(mockCompleteJson).not.toHaveBeenCalled();
      const conn = await getDb();
      const [rows]: any = await conn!.execute(sql`SELECT COUNT(*) as cnt FROM aiUsageTurns WHERE factoryId = ${factoryId}`);
      expect(rows[0].cnt).toBe(0);
    });

    it("Admin → 不會被 coming_soon 擋下，真正跑完整個 pipeline 並拿到 status: ok 的真實回覆", async () => {
      mockRunEnterpriseDiagnosis.mockClear();
      mockRunOxmRouting.mockClear();
      const result = await appRouterWithComingSoon.createCaller(ctxFor(adminId, true)).ai.chat({
        message: "admin 測試訊息", clientTurnId: nextClientTurnId(),
      });
      expect(result.status).toBe("ok");
      expect(result).not.toMatchObject({ status: "denied", reason: "coming_soon" });
      if (result.status === "ok") {
        expect(result.reply).toBe("admin-only release 測試回覆");
      }
      expect(mockRunEnterpriseDiagnosis).toHaveBeenCalledTimes(1);
      expect(mockRunOxmRouting).toHaveBeenCalledTimes(1);
    });

    it("Admin 呼叫不會因 quota 被擋（既有 bypassQuota，quota_exhausted 不會發生）", async () => {
      const result = await appRouterWithComingSoon.createCaller(ctxFor(adminId, true)).ai.chat({
        message: "admin 第二次測試訊息，驗證不受 quota 限制", clientTurnId: nextClientTurnId(),
      });
      expect(result.status).not.toBe("denied");
    });
  });
});
