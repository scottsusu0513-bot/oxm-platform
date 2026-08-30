/**
 * Phase 5：AI Case Assessment 整合測試。走真實本機測試資料庫（受
 * server/test-db-guard.ts 全域 setupFiles 保護），用 appRouter.createCaller(ctx)
 * 直接呼叫 tRPC procedure。AI provider 全檔案 mock（見對話中「三十八、Real API
 * Smoke Test」是另外用真實 OpenAI API 跑的手動腳本，不是這份自動化測試套件
 * 的責任——這裡只驗證架構本身：權威順序、失敗不拖垮案件、權限沿用、
 * polymorphic unique、direct-entry regression）。
 *
 * 對應「三十七、五服務必測」CASE 1/2/7/8/9/10。
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

let forceFailureMarker = "__NO_FAILURE__";
const capturedPrompts: string[] = [];

vi.mock("./ai/provider", () => ({
  getAiChatProvider: () => ({
    complete: vi.fn(),
    completeJson: vi.fn(async (messages: { role: string; content: string }[]) => {
      const content = messages[0]?.content ?? "";
      capturedPrompts.push(content);
      if (content.includes(forceFailureMarker)) {
        throw new Error("mock provider boom");
      }
      if (content.includes("primaryRecommendation")) {
        return JSON.stringify({
          primaryRecommendation: "目前較適合往 CITD 評估",
          secondaryRecommendation: "SBIR（若研發創新程度較高）",
          currentProblem: "產線效率待提升",
          rdStatus: "已有明確技術升級標的",
          equipmentNeed: "未提供",
          tariffImpact: "未提供",
          selfFundingCapacity: "未提供",
          aiReasoning: "依表單顯示的技術升級需求判斷",
        });
      }
      return JSON.stringify({ summary: "AI 生成的測試短摘要內容。" });
    }),
  }),
  isAiChatConfigured: () => true,
}));

const runId = `aica-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ADMIN_WHITELIST_EMAILS = process.env.ADMIN_WHITELIST_EMAILS;
const TEST_ADMIN_EMAIL = `aica-test-admin-${runId}@example.test`;
// Shared Cleanup（見對話「Vitest ADMIN_WHITELIST_EMAILS env race」）：覆寫搬到
// beforeAll，理由同 certificationCaseFallback.test.ts 開頭註解。
const { appRouter } = await import("./routers");
const db = await import("./db");
const { getDb } = db;
const { ensureTestUser, deleteTestUser, createTestFactory } = await import("./_core/financeTestFixtures");
const { createHandoffContext } = await import("./ai/handoffContextService");
const { getAssessmentForCase } = await import("./ai/caseAssessmentService");
const { retryFailedAiCaseAssessments } = await import("./jobs/retryFailedAiCaseAssessments");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function userCtx(id: number, name: string, isAdmin = false): TrpcContext {
  const user: AuthenticatedUser = {
    id, openId: `${runId}-${id}`, email: `${runId}-${id}@example.test`,
    name, loginMethod: "manus", role: isAdmin ? "admin" : "user", isFactoryOwner: false,
    isAdmin,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

function adminCtx(id: number): TrpcContext {
  const ctx = userCtx(id, "AICA 測試管理員", true);
  (ctx.user as AuthenticatedUser).email = TEST_ADMIN_EMAIL;
  return ctx;
}

async function waitForAssessment(serviceKey: "gov_subsidy" | "erp" | "certification" | "short_video" | "finance", caseId: number, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await getAssessmentForCase(serviceKey, caseId);
    if (row && row.status !== "pending") return row;
    await new Promise(r => setTimeout(r, 50));
  }
  return getAssessmentForCase(serviceKey, caseId);
}

async function cleanupFactoryAndCases(factoryId: number) {
  const conn = await getDb();
  if (!conn) return;
  await conn.execute(sql`DELETE FROM aiCaseAssessments WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM aiHandoffContexts WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM upgradeApplications WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM erpCases WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM certificationCases WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM shortVideoCases WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM financeApplications WHERE factoryId = ${factoryId}`);
  await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
}

// 每個服務的「同一工廠最多一筆未結案案件」限制各自獨立生效，erp/finance 需要
// 各自乾淨的工廠才能重複送出申請，因此每個需要 erp/finance submitApplication
// 的測試各用一間專屬工廠，只有 gov_subsidy（用 email+phone 防重複，不是
// factoryId）可以共用同一間。
// factories.ownerId 有 UNIQUE 限制（一個使用者最多一間工廠），所以每間需要
// 獨立的工廠都要搭配獨立的 owner 帳號，不能共用 ownerId 建立多間。
let ownerId: number, adminUserId: number, erpConsultantUserId: number, otherErpConsultantUserId: number;
let owner7Id: number, owner8Id: number, owner9Id: number, financeOwnerId: number;
let factoryId: number;
let erpFactoryId7: number, erpFactoryId8: number, erpFactoryId9: number, financeFactoryId: number;
const cleanupOwnerIds: number[] = [];
const cleanupFactoryIds: number[] = [];

beforeAll(async () => {
  process.env.ADMIN_WHITELIST_EMAILS = JSON.stringify([TEST_ADMIN_EMAIL]);
  ownerId = await ensureTestUser(`${runId}-owner`, "AICA 測試申請人");
  owner7Id = await ensureTestUser(`${runId}-owner7`, "AICA 測試申請人7");
  owner8Id = await ensureTestUser(`${runId}-owner8`, "AICA 測試申請人8");
  owner9Id = await ensureTestUser(`${runId}-owner9`, "AICA 測試申請人9");
  financeOwnerId = await ensureTestUser(`${runId}-owner-fin`, "AICA 測試申請人-財務");
  adminUserId = await ensureTestUser(`${runId}-admin`, "AICA 測試管理員", TEST_ADMIN_EMAIL);
  erpConsultantUserId = await ensureTestUser(`${runId}-erp-consultant`, "AICA ERP 顧問甲");
  otherErpConsultantUserId = await ensureTestUser(`${runId}-erp-consultant2`, "AICA ERP 顧問乙");
  cleanupOwnerIds.push(ownerId, owner7Id, owner8Id, owner9Id, financeOwnerId, adminUserId, erpConsultantUserId, otherErpConsultantUserId);
  factoryId = await createTestFactory(ownerId, `${runId} 工廠`, "approved");
  erpFactoryId7 = await createTestFactory(owner7Id, `${runId} 工廠-CASE7`, "approved");
  erpFactoryId8 = await createTestFactory(owner8Id, `${runId} 工廠-CASE8`, "approved");
  erpFactoryId9 = await createTestFactory(owner9Id, `${runId} 工廠-CASE9`, "approved");
  financeFactoryId = await createTestFactory(financeOwnerId, `${runId} 工廠-財務`, "approved");
  cleanupFactoryIds.push(factoryId, erpFactoryId7, erpFactoryId8, erpFactoryId9, financeFactoryId);
});

afterAll(async () => {
  for (const id of cleanupFactoryIds) await cleanupFactoryAndCases(id);
  for (const id of cleanupOwnerIds) await deleteTestUser(id);
  process.env.ADMIN_WHITELIST_EMAILS = ORIGINAL_ADMIN_WHITELIST_EMAILS;
});

describe("CASE 1：政府補助 AI 導件全流程", () => {
  it("handoff → submitApplication 成功 → aiAssessment=completed，8 欄齊全", async () => {
    const handoff = await createHandoffContext({
      userId: ownerId, factoryId, serviceKey: "gov_subsidy",
      prefillData: { hasPatent: false },
      confirmedFields: { hasPatent: { sourceFact: "hasPatent" } },
      handoffSummary: "製造業想做新製程，有設備需求，尚未申請過補助。",
      sourceConversationId: null,
    });

    const caller = appRouter.createCaller(userCtx(ownerId, "AICA 測試申請人"));
    const result = await caller.upgradeCenter.submitApplication({
      companyName: "AICA 測試公司", contactName: "測試聯絡人", phone: "0912345678",
      email: `${runId}@example.test`, location: "新竹市", capitalAmount: "500萬",
      decisionMakerParticipation: "owner", annualRevenue: "under_5m", employeeCount: "6_30",
      factoryType: "general", isEnterpriseFirm: false, hasGovernmentProject: false,
      hasAppliedForGovernmentSubsidy: false, hasPatent: false, exportStatus: "no_export",
      consentAgreed: true, factoryId, aiHandoffToken: handoff.token,
    });
    expect(result.success).toBe(true);

    const assessment = await waitForAssessment("gov_subsidy", result.id);
    expect(assessment?.status).toBe("completed");
    const json = assessment?.assessmentJson as Record<string, unknown>;
    for (const key of [
      "primaryRecommendation", "secondaryRecommendation", "currentProblem", "rdStatus",
      "equipmentNeed", "tariffImpact", "selfFundingCapacity", "aiReasoning",
    ]) {
      expect(typeof json[key]).toBe("string");
      expect((json[key] as string).length).toBeGreaterThan(0);
    }
    // 不知道的欄位誠實寫「未提供」，不得杜撰（mock 回傳已示範這個規則）。
    expect(json.equipmentNeed).toBe("未提供");

    // handoff token 應該已被消費。
    const [row] = await (await getDb())!.execute(sql`SELECT consumedAt FROM aiHandoffContexts WHERE id = ${handoff.id}`) as unknown as [{ consumedAt: Date | null }[], unknown];
    expect(row[0]?.consumedAt).not.toBeNull();
  });
});

describe("CASE 2：正式表單值優先於 confirmedFacts（authority 順序）", () => {
  it("對話 confirmedFacts 是 hasPatent=false，表單改成 hasPatent=true/patentCount=3 → 案件與 assessment 一律以表單為準", async () => {
    const handoff = await createHandoffContext({
      userId: ownerId, factoryId, serviceKey: "gov_subsidy",
      prefillData: { hasPatent: false },
      confirmedFields: { hasPatent: { sourceFact: "hasPatent" } },
      handoffSummary: "測試 CASE 2：對話期間表示沒有專利。",
      sourceConversationId: null,
    });

    const caller = appRouter.createCaller(userCtx(ownerId, "AICA 測試申請人"));
    const result = await caller.upgradeCenter.submitApplication({
      companyName: "AICA CASE2 公司", contactName: "測試聯絡人", phone: "0912345678",
      email: `${runId}-case2@example.test`, location: "新竹市", capitalAmount: "500萬",
      decisionMakerParticipation: "owner", annualRevenue: "under_5m", employeeCount: "6_30",
      factoryType: "general", isEnterpriseFirm: false, hasGovernmentProject: false,
      hasAppliedForGovernmentSubsidy: false, hasPatent: true, patentCount: 3, exportStatus: "no_export",
      consentAgreed: true, factoryId, aiHandoffToken: handoff.token,
    });
    const assessment = await waitForAssessment("gov_subsidy", result.id);
    expect(assessment?.status).toBe("completed");

    // 可靠性修正後：直接檢查送進 LLM 的 prompt 內容——權威區塊（最終送出的正式申請
    // 表單）必須寫的是 3 件專利；「對話期間背景」不再讓模型自己判斷衝突，而是由
    // server 端 buildAuthoritativeReferenceBackground 先把已被表單回答的 hasPatent
    // 舊值（false）整個剔除，prompt 裡不應該再出現任何 hasPatent:false 這種殘留衝突值。
    const lastPrompt = capturedPrompts[capturedPrompts.length - 1];
    expect(lastPrompt).toContain("是否持有專利：是（3 件）");
    expect(lastPrompt).not.toContain('"hasPatent":false');
    const backgroundLine = lastPrompt.split("\n").find(line => line.startsWith("對話中已確認"));
    expect(backgroundLine).not.toContain("hasPatent");

    const caseRow = await db.getUpgradeApplicationById(result.id);
    expect(caseRow?.hasPatent).toBe(true);
    expect(caseRow?.patentCount).toBe(3);
  });
});

describe("CASE 7：一般直接表單案件（非 AI handoff）完全不建立 assessment", () => {
  it("submitApplication 沒有帶 aiHandoffToken → 找不到任何 assessment record", async () => {
    const caller = appRouter.createCaller(userCtx(owner7Id, "AICA 測試申請人7"));
    const result = await caller.erpOptimization.submitApplication({
      factoryId: erpFactoryId7, contactName: "測試聯絡人", phone: "0912345678", contactTime: "平日下午",
      needType: "unsure", consentAgreed: true,
    });
    expect(result.success).toBe(true);
    await new Promise(r => setTimeout(r, 200));
    const assessment = await getAssessmentForCase("erp", result.id);
    expect(assessment).toBeUndefined();

    const caller2 = appRouter.createCaller(adminCtx(adminUserId));
    const cases = await caller2.erpConsultant.myCases({});
    const item = cases.find((c: any) => c.id === result.id);
    expect(item?.aiAssessment).toBeNull();
  });
});

describe("CASE 8/10：LLM 失敗不拖垮案件，可重試成功，且不會產生第二筆 assessment", () => {
  it("LLM 失敗 → 案件成功、assessment=failed；retry 成功後 UPDATE 同一筆為 completed", async () => {
    forceFailureMarker = "AICA_FORCE_FAILURE_SENTINEL";
    const handoff = await createHandoffContext({
      userId: owner8Id, factoryId: erpFactoryId8, serviceKey: "erp",
      prefillData: {}, confirmedFields: {},
      handoffSummary: "測試 CASE 8：AICA_FORCE_FAILURE_SENTINEL",
      sourceConversationId: null,
    });

    const caller = appRouter.createCaller(userCtx(owner8Id, "AICA 測試申請人8"));
    const result = await caller.erpOptimization.submitApplication({
      factoryId: erpFactoryId8, contactName: "測試聯絡人", phone: "0912345678", contactTime: "平日下午",
      needType: "erp_adoption", consentAgreed: true, aiHandoffToken: handoff.token,
    });
    // 案件必須成功建立，即使等等 LLM 會失敗。
    expect(result.success).toBe(true);

    const failedAssessment = await waitForAssessment("erp", result.id);
    expect(failedAssessment?.status).toBe("failed");
    expect(failedAssessment?.lastError).toBeTruthy();
    expect(failedAssessment?.retryCount).toBe(0);

    // 模擬 provider 恢復正常，重試。
    forceFailureMarker = "__NO_FAILURE__";
    const retryResult = await retryFailedAiCaseAssessments();
    expect(retryResult.succeeded).toBeGreaterThanOrEqual(1);

    const completed = await getAssessmentForCase("erp", result.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.id).toBe(failedAssessment!.id); // 同一筆 UPDATE，不是新 insert
    expect(completed!.retryCount).toBeGreaterThanOrEqual(1);

    // serviceKey+caseId 仍然只有一筆。
    const conn = await getDb();
    const [rows] = await conn!.execute(
      sql`SELECT COUNT(*) as c FROM aiCaseAssessments WHERE serviceKey = 'erp' AND caseId = ${result.id}`
    ) as unknown as [{ c: number }[], unknown];
    expect(Number(rows[0].c)).toBe(1);
  });
});

describe("CASE 9：權限完全沿用原案件（IDOR 防護）", () => {
  it("沒有指派到這筆案件的 ERP 顧問，myCases 列表完全看不到這筆案件、也就看不到 aiAssessment", async () => {
    const handoff = await createHandoffContext({
      userId: owner9Id, factoryId: erpFactoryId9, serviceKey: "erp",
      prefillData: {}, confirmedFields: {},
      handoffSummary: "測試 CASE 9 權限。",
      sourceConversationId: null,
    });
    const caller = appRouter.createCaller(userCtx(owner9Id, "AICA 測試申請人9"));
    const result = await caller.erpOptimization.submitApplication({
      factoryId: erpFactoryId9, contactName: "測試聯絡人", phone: "0912345678", contactTime: "平日下午",
      needType: "erp_adoption", consentAgreed: true, aiHandoffToken: handoff.token,
    });
    await waitForAssessment("erp", result.id);

    // 建立一位跟這筆案件完全無關（未被指派）的 ERP 顧問帳號。
    const conn = await getDb();
    const [consultantResult] = await conn!.execute(sql`
      INSERT INTO erpConsultants (name, userId, serviceAreas, isActive, createdAt, updatedAt)
      VALUES (${`${runId} 無關顧問`}, ${otherErpConsultantUserId}, ${JSON.stringify([])}, TRUE, NOW(), NOW())
    `) as unknown as [{ insertId: number }, unknown];

    const strangerCaller = appRouter.createCaller(userCtx(otherErpConsultantUserId, "無關顧問"));
    const cases = await strangerCaller.erpConsultant.myCases({});
    expect(cases.find((c: any) => c.id === result.id)).toBeUndefined();

    await conn!.execute(sql`DELETE FROM erpConsultants WHERE id = ${consultantResult.insertId}`);
  });
});

describe("各服務 smoke：erp/certification/short_video/finance 都能各自產生短摘要 assessment", () => {
  it("finance：表單無業務欄位，仍正確產生 { summary } assessment", async () => {
    const handoff = await createHandoffContext({
      userId: financeOwnerId, factoryId: financeFactoryId, serviceKey: "finance",
      prefillData: {}, confirmedFields: {},
      handoffSummary: "訂單正常，客戶帳期約 90 天造成週轉壓力。",
      sourceConversationId: null,
    });
    const caller = appRouter.createCaller(userCtx(financeOwnerId, "AICA 測試申請人-財務"));
    const result = await caller.financeCenter.submitApplication({
      factoryId: financeFactoryId, contactName: "測試聯絡人", phone: "0912345678", contactTime: "平日下午",
      consentAgreed: true, aiHandoffToken: handoff.token,
    });
    const assessment = await waitForAssessment("finance", result.id);
    expect(assessment?.status).toBe("completed");
    expect((assessment?.assessmentJson as Record<string, unknown>).summary).toBeTruthy();
  });
});
