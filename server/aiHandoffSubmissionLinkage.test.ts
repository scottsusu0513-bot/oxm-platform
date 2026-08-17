/**
 * Phase 5 可靠性修正（Handoff Submit Idempotency + 移除衝突 Raw Summary）
 * 驗證——對應對話中「九、必測：Idempotency」CASE 1-5、「十、必測：Raw
 * Summary Conflict」CASE 6-7。走真實本機測試資料庫，用
 * appRouter.createCaller(ctx) 直接呼叫 tRPC procedure。
 *
 * Missing-assessment recovery（見「十一、Recovery 邏輯全部保留」）另外用一個
 * describe block 補充驗證沒有被這輪的 claim/finalize 拆分破壞。
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { sql, eq } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";
import { aiHandoffContexts } from "../drizzle/schema";

vi.mock("./ai/provider", () => ({
  getAiChatProvider: () => ({
    complete: vi.fn(),
    completeJson: vi.fn(async (messages: { role: string; content: string }[]) => {
      capturedPrompts.push(messages[0]?.content ?? "");
      return JSON.stringify({
        primaryRecommendation: "目前較適合往 CITD 評估", secondaryRecommendation: "未提供",
        currentProblem: "未提供", rdStatus: "未提供", equipmentNeed: "未提供",
        tariffImpact: "未提供", selfFundingCapacity: "未提供", aiReasoning: "未提供",
      });
    }),
  }),
  isAiChatConfigured: () => true,
}));

vi.mock("./ai/caseAssessmentService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai/caseAssessmentService")>();
  return { ...actual, createPendingAssessment: vi.fn(actual.createPendingAssessment) };
});

const capturedPrompts: string[] = [];

const { appRouter } = await import("./routers");
const { getDb } = await import("./db");
const { ensureTestUser, deleteTestUser, createTestFactory } = await import("./_core/financeTestFixtures");
const { createHandoffContext, getHandoffContextById } = await import("./ai/handoffContextService");
const { createPendingAssessment, getAssessmentForCase } = await import("./ai/caseAssessmentService");
const { retryFailedAiCaseAssessments } = await import("./jobs/retryFailedAiCaseAssessments");

const mockedCreatePending = vi.mocked(createPendingAssessment);
const actualService = await vi.importActual<typeof import("./ai/caseAssessmentService")>("./ai/caseAssessmentService");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const runId = `ahsl2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function ctxFor(userId: number): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId, openId: `${runId}-${userId}`, email: `${runId}-${userId}@example.test`,
    name: "AHSL2 測試申請人", loginMethod: "manus", role: "user", isFactoryOwner: false,
    isAdmin: false, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as AuthenticatedUser;
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => {} } as unknown as TrpcContext["res"] };
}

async function waitForAssessment(caseId: number, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await getAssessmentForCase("gov_subsidy", caseId);
    if (row && row.status !== "pending") return row;
    await new Promise(r => setTimeout(r, 50));
  }
  return getAssessmentForCase("gov_subsidy", caseId);
}

const cleanupFactoryIds: number[] = [];
const cleanupUserIds: number[] = [];
let userSeq = 0;

async function makeUserAndFactory(): Promise<{ userId: number; factoryId: number }> {
  userSeq += 1;
  const userId = await ensureTestUser(`test-${runId}-${userSeq}`, `AHSL2 User ${runId}-${userSeq}`);
  const factoryId = await createTestFactory(userId, `${runId} 工廠${userSeq}`, "approved");
  cleanupUserIds.push(userId);
  cleanupFactoryIds.push(factoryId);
  return { userId, factoryId };
}

function baseGovSubsidyInput(params: { email: string; factoryId: number; aiHandoffToken?: string }) {
  return {
    companyName: `${runId} 公司`, contactName: "測試聯絡人", phone: "0912345678",
    email: params.email, location: "新竹市", capitalAmount: "500萬",
    decisionMakerParticipation: "owner" as const, annualRevenue: "under_5m", employeeCount: "6_30",
    factoryType: "general", isEnterpriseFirm: false, hasGovernmentProject: false,
    hasAppliedForGovernmentSubsidy: false, hasPatent: true, patentCount: 3, exportStatus: "no_export",
    consentAgreed: true as const,
    factoryId: params.factoryId, aiHandoffToken: params.aiHandoffToken,
  };
}

async function countUpgradeApplicationsByEmail(email: string): Promise<number> {
  const conn = await getDb();
  const [rows] = await conn!.execute(
    sql`SELECT COUNT(*) as c FROM upgradeApplications WHERE email = ${email}`
  ) as unknown as [{ c: number }[], unknown];
  return Number(rows[0].c);
}

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  for (const factoryId of cleanupFactoryIds) {
    await conn.execute(sql`DELETE FROM aiCaseAssessments WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM aiHandoffContexts WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM upgradeApplications WHERE factoryId = ${factoryId}`);
    await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
  }
  for (const userId of cleanupUserIds) {
    await deleteTestUser(userId);
  }
});

describe("CASE 1：同一 aiHandoffToken 連續 submit 兩次 → 不建立第二筆 case", () => {
  it("第二次呼叫回傳既有案件結果，DB 仍只有一筆案件", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending.mockImplementation(actualService.createPendingAssessment);

    const { userId, factoryId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId, factoryId, serviceKey: "gov_subsidy",
      prefillData: {}, confirmedFields: {}, handoffSummary: "CASE 1 fixture。",
      sourceConversationId: null,
    });
    const email = `${runId}-case1@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));

    const first = await caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }));
    const second = await caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }));

    expect(second.id).toBe(first.id); // 回既有案件結果，不是新案件
    expect(await countUpgradeApplicationsByEmail(email)).toBe(1);

    const handoffAfter = await getHandoffContextById(handoff.id);
    expect(handoffAfter?.submittedCaseId).toBe(first.id);
  });
});

describe("CASE 2：模擬第一次 response 在網路途中遺失，client retry 同 token", () => {
  it("retry 不建立第二筆 case，可以取得第一次 case 的結果", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending.mockImplementation(actualService.createPendingAssessment);

    const { userId, factoryId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId, factoryId, serviceKey: "gov_subsidy",
      prefillData: {}, confirmedFields: {}, handoffSummary: "CASE 2 fixture。",
      sourceConversationId: null,
    });
    const email = `${runId}-case2@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));

    // 第一次 submit：DB 端已經成功（案件建立＋handoff finalize），視為 response 遺失，
    // 這裡直接模擬 client 用同一個 token 重新呼叫一次。
    const first = await caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }));
    const retry = await caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }));

    expect(retry.id).toBe(first.id);
    expect(await countUpgradeApplicationsByEmail(email)).toBe(1);
  });
});

describe("CASE 3：兩個相同 token 的 submit 併發執行 → 最終只能有一筆正式 case", () => {
  it("併發送出，DB 最終只有一筆案件，handoff.submittedCaseId 指向該筆，最多一筆 assessment", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending.mockImplementation(actualService.createPendingAssessment);

    const { userId, factoryId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId, factoryId, serviceKey: "gov_subsidy",
      prefillData: {}, confirmedFields: {}, handoffSummary: "CASE 3 fixture。",
      sourceConversationId: null,
    });
    const email = `${runId}-case3@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));

    const input = baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token });
    const results = await Promise.allSettled([
      caller.upgradeCenter.submitApplication(input),
      caller.upgradeCenter.submitApplication(input),
    ]);

    const succeeded = results.filter((r): r is PromiseFulfilledResult<{ success: true; id: number }> => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1); // 至少一個成功（可能兩個都成功，但都指向同一筆）
    const distinctIds = new Set(succeeded.map(r => r.value.id));
    expect(distinctIds.size).toBe(1); // 不管兩個 request 各自拿到什麼結果，id 只能有一種

    expect(await countUpgradeApplicationsByEmail(email)).toBe(1);

    const handoffAfter = await getHandoffContextById(handoff.id);
    expect(handoffAfter?.submittedCaseId).toBe([...distinctIds][0]);

    const conn = await getDb();
    const [countRows] = await conn!.execute(
      sql`SELECT COUNT(*) as c FROM aiCaseAssessments WHERE serviceKey = 'gov_subsidy' AND caseId = ${handoffAfter!.submittedCaseId}`
    ) as unknown as [{ c: number }[], unknown];
    expect(Number(countRows[0].c)).toBeLessThanOrEqual(1);
  });
});

describe("CASE 4：request 完全沒有 aiHandoffToken → direct entry 完全正常", () => {
  it("不帶 token 的一般申請，成功建立案件，不受 idempotency 機制影響", async () => {
    const { userId, factoryId } = await makeUserAndFactory();
    const email = `${runId}-case4@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));

    const result = await caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId }));
    expect(result.success).toBe(true);
    expect(await countUpgradeApplicationsByEmail(email)).toBe(1);
  });
});

describe("CASE 5：token 不存在／非本人／service 不符／已過期 → 安全拒絕，不得靜默降級成 direct entry", () => {
  it("token 完全不存在 → 拒絕，不建立案件", async () => {
    const { userId, factoryId } = await makeUserAndFactory();
    const email = `${runId}-case5a@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));
    await expect(
      caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: "this-token-does-not-exist" }))
    ).rejects.toThrow();
    expect(await countUpgradeApplicationsByEmail(email)).toBe(0);
  });

  it("token 屬於別人 → 拒絕，不建立案件", async () => {
    const { userId: ownerUserId, factoryId } = await makeUserAndFactory();
    const { userId: attackerUserId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId: ownerUserId, factoryId, serviceKey: "gov_subsidy",
      prefillData: {}, confirmedFields: {}, handoffSummary: "CASE 5b fixture。",
      sourceConversationId: null,
    });
    const email = `${runId}-case5b@example.test`;
    const caller = appRouter.createCaller(ctxFor(attackerUserId));
    await expect(
      caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }))
    ).rejects.toThrow();
    expect(await countUpgradeApplicationsByEmail(email)).toBe(0);
  });

  it("service 不符 → 拒絕，不建立案件", async () => {
    const { userId, factoryId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId, factoryId, serviceKey: "erp", // 建立時是 erp，稍後卻拿去 submit gov_subsidy
      prefillData: {}, confirmedFields: {}, handoffSummary: "CASE 5c fixture。",
      sourceConversationId: null,
    });
    const email = `${runId}-case5c@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));
    await expect(
      caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }))
    ).rejects.toThrow();
    expect(await countUpgradeApplicationsByEmail(email)).toBe(0);
  });

  it("token 已過期 → 拒絕，不建立案件", async () => {
    const { userId, factoryId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId, factoryId, serviceKey: "gov_subsidy",
      prefillData: {}, confirmedFields: {}, handoffSummary: "CASE 5d fixture。",
      sourceConversationId: null,
    });
    // 用 drizzle 的 .update() 搭配 JS Date 物件寫入（跟 createHandoffContext
    // 寫入 expiresAt 走同一套 mysql2 序列化路徑），確保跟 claimHandoffForSubmission
    // 讀回來比較時的 JS Date 語意完全一致——不能用純 SQL 端的 DATE_SUB(NOW(),...)
    // 寫入，那樣會跟 JS Date 的讀寫慣例不一致（見 handoffContextService.ts
    // claimHandoffForSubmission 的說明）。
    const conn = await getDb();
    await conn!.update(aiHandoffContexts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(aiHandoffContexts.id, handoff.id));

    const email = `${runId}-case5d@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));
    await expect(
      caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }))
    ).rejects.toThrow();
    expect(await countUpgradeApplicationsByEmail(email)).toBe(0);
  });
});

describe("CASE 6：handoffSummary 提到「沒有專利」+ hasPatent=false，表單改 hasPatent=true/3 件 → 送進 LLM 的完整 prompt 不得出現「沒有專利」「無專利」", () => {
  it("直接 assert 完整 prompt 內容，不只看 assessment output", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending.mockImplementation(actualService.createPendingAssessment);

    const { userId, factoryId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId, factoryId, serviceKey: "gov_subsidy",
      prefillData: { hasPatent: false },
      confirmedFields: { hasPatent: { sourceFact: "hasPatent" } },
      handoffSummary: "客戶目前沒有專利，想了解政府補助方向。",
      sourceConversationId: null,
    });
    const email = `${runId}-case6@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));
    const result = await caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }));
    await waitForAssessment(result.id);

    const lastPrompt = capturedPrompts[capturedPrompts.length - 1];
    expect(lastPrompt).toContain("是否持有專利：是（3 件）");
    // 只檢查「對話期間背景」這個區塊本身（見「六～八」的目標），不是整份 prompt——
    // gov_subsidy 模板自己在更下面的【文案規則】段落，本來就合法包含「沒有專利」
    // 這個負面示範句（教模型不要因為沒聊到就亂推論），那是既有、不相關的文字，
    // 不是這裡要驗證的對象。
    const backgroundSection = lastPrompt.slice(
      lastPrompt.indexOf("===== 對話期間背景"),
      lastPrompt.indexOf("===== 六大政府補助方向側寫")
    );
    expect(backgroundSection).not.toContain("沒有專利");
    expect(backgroundSection).not.toContain("無專利");
    // 原始 handoffSummary 整句話也不應該出現——不是只過濾關鍵字，而是整段 raw
    // summary 都被 deterministic 排除（見「六～八」）。
    expect(backgroundSection).not.toContain("客戶目前沒有專利，想了解政府補助方向。");
  });
});

describe("CASE 7：handoffSummary 沒有跟表單衝突時，仍可保留完整需求背景（不因為部分欄位被回答就整段廢掉）", () => {
  it("ERP：handoffSummary 描述現況、表單只回答 needType，沒有布林型別事實衝突 → 摘要原文仍然出現在 prompt", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending.mockImplementation(actualService.createPendingAssessment);

    const { userId, factoryId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId, factoryId, serviceKey: "erp",
      prefillData: { needType: "erp_adoption" },
      confirmedFields: { needType: { sourceFact: "needType" } },
      handoffSummary: "工單庫存人工、排程混亂，希望導 ERP。",
      sourceConversationId: null,
    });

    const { initiateCaseAssessment } = await import("./ai/caseAssessment");
    const caseId = 999888100 + userId;
    await initiateCaseAssessment({
      serviceKey: "erp",
      handoffContext: handoff,
      caseId, factoryId, userId,
      submittedForm: { needType: "ERP 導入", additionalNotes: null },
    });
    const start = Date.now();
    let row = await getAssessmentForCase("erp", caseId);
    while ((!row || row.status === "pending") && Date.now() - start < 4000) {
      await new Promise(r => setTimeout(r, 50));
      row = await getAssessmentForCase("erp", caseId);
    }

    const lastPrompt = capturedPrompts[capturedPrompts.length - 1];
    expect(lastPrompt).toContain("工單庫存人工、排程混亂，希望導 ERP。");

    const conn = await getDb();
    await conn!.execute(sql`DELETE FROM aiCaseAssessments WHERE serviceKey = 'erp' AND caseId = ${caseId}`);
  });
});

describe("Missing-assessment recovery 仍正常運作（見「十一、Recovery 邏輯全部保留」）", () => {
  it("assessment pending row 建立失敗、但 case 已成功 finalize → recovery job 補建成功", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending.mockRejectedValue(new Error("模擬 DB 暫時性錯誤"));

    const { userId, factoryId } = await makeUserAndFactory();
    const handoff = await createHandoffContext({
      userId, factoryId, serviceKey: "gov_subsidy",
      prefillData: {}, confirmedFields: {}, handoffSummary: "recovery fixture。",
      sourceConversationId: null,
    });
    const email = `${runId}-recovery@example.test`;
    const caller = appRouter.createCaller(ctxFor(userId));
    const result = await caller.upgradeCenter.submitApplication(baseGovSubsidyInput({ email, factoryId, aiHandoffToken: handoff.token }));

    const handoffAfter = await getHandoffContextById(handoff.id);
    expect(handoffAfter?.consumedAt).not.toBeNull();
    expect(handoffAfter?.submittedCaseId).toBe(result.id);
    expect(await getAssessmentForCase("gov_subsidy", result.id)).toBeUndefined();

    mockedCreatePending.mockImplementation(actualService.createPendingAssessment);
    await retryFailedAiCaseAssessments();
    const row = await waitForAssessment(result.id);
    expect(row?.status).toBe("completed");
  });
});
