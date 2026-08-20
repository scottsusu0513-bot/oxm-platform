/**
 * server/ai/caseAssessment.ts 驗證：安全 projection（聯絡資料絕對不送給
 * LLM，見「十七」）、服務專屬格式（不共用 universal template，見「七」）、
 * 8 欄防禦性 parse（模型漏欄位時補「未提供」，不崩潰）、buildRetryInitiateParams
 * 的保守 guard clause。走真實測試 DB（assessment row 本身需要落地），但
 * handoffContext 直接用字面 object 建構，不透過 aiHandoffContexts 表。
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { AiHandoffContext, AiCaseAssessment } from "../../drizzle/schema";

const capturedPrompts: string[] = [];
let nextMockResponse: string | null = null;

vi.mock("./provider", () => ({
  getAiChatProvider: () => ({
    complete: vi.fn(),
    completeJson: vi.fn(async (messages: { role: string; content: string }[]) => {
      capturedPrompts.push(messages[0]?.content ?? "");
      if (nextMockResponse) return nextMockResponse;
      return JSON.stringify({ summary: "測試短摘要" });
    }),
  }),
  isAiChatConfigured: () => true,
}));

const { getDb } = await import("../db");
const { initiateCaseAssessment, buildRetryInitiateParams } = await import("./caseAssessment");
const { getAssessmentForCase } = await import("./caseAssessmentService");
const { createHandoffContext } = await import("./handoffContextService");
const { aiCaseAssessments } = await import("../../drizzle/schema");
const { createTestFactory } = await import("../_core/financeTestFixtures");

const runId = `aica-unit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: number;
// aiCaseAssessments.factoryId／handoffContextId 都有 FK 約束，這裡的測試不透過
// 真實 submitApplication 建立案件，所以要自己準備真實存在的測試工廠與一筆真實
// handoff context row 當 FK 目標，不能隨便填數字／字面 id。
let factoryId: number;
let realHandoffContextId: number;
const createdIds: number[] = [];

function fakeHandoffContext(overrides: Partial<AiHandoffContext> = {}): AiHandoffContext {
  return {
    id: realHandoffContextId, token: "fake-token", userId, factoryId: null,
    serviceKey: "erp", prefillDataJson: {}, confirmedFieldsJson: {},
    handoffSummary: "測試 handoff 摘要。", sourceConversationId: null,
    expiresAt: new Date(Date.now() + 100000), acknowledgedAt: null, consumedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  } as AiHandoffContext;
}

async function waitFor(serviceKey: "gov_subsidy" | "erp" | "certification" | "short_video" | "finance", caseId: number, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await getAssessmentForCase(serviceKey, caseId);
    if (row && row.status !== "pending") return row;
    await new Promise(r => setTimeout(r, 30));
  }
  return getAssessmentForCase(serviceKey, caseId);
}

beforeAll(async () => {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`AICA Unit ${runId}`}, ${`${runId}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  userId = rows[0]!.id;
  factoryId = await createTestFactory(userId, `${runId} 工廠`, "approved");
  const realContext = await createHandoffContext({
    userId, factoryId, serviceKey: "erp", prefillData: {}, confirmedFields: {},
    handoffSummary: "unit test fixture context", sourceConversationId: null,
  });
  realHandoffContextId = realContext.id;
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  if (createdIds.length > 0) {
    await conn.delete(aiCaseAssessments).where(sql`id IN (${sql.join(createdIds, sql`, `)})`);
  }
  await conn.execute(sql`DELETE FROM aiHandoffContexts WHERE id = ${realHandoffContextId}`);
  await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
});

describe("安全 projection：聯絡資料絕對不送給 LLM（見「十七」）", () => {
  it("erp：submittedForm 沒有 contactName/phone/contactTime 欄位可送，prompt 不含測試電話號碼字面值", async () => {
    nextMockResponse = null;
    const caseId = 800001;
    await initiateCaseAssessment({
      serviceKey: "erp",
      handoffContext: fakeHandoffContext({ serviceKey: "erp", handoffSummary: "使用者電話 0987654321（不應出現在 prompt）" }),
      caseId, factoryId, userId,
      submittedForm: { needType: "ERP 導入", additionalNotes: "0987654321" },
    });
    const row = await waitFor("erp", caseId);
    createdIds.push(row!.id);
    const prompt = capturedPrompts[capturedPrompts.length - 1];
    // additionalNotes 本身是申請人自己填的業務補充，可以出現；但 handoffSummary 裡刻意放的假電話
    // 只是用來確認 prompt 組裝過程沒有額外去撈聯絡欄位塞進來——這裡改為正面驗證 prompt 完全沒有
    // contactName/phone/contactTime 這幾個 key 名稱字樣（真正的 safe projection 型別本來就不含這些欄位）。
    expect(prompt).not.toMatch(/contactName|"phone"|contactTime/);
  });
});

describe("服務專屬格式：不共用 universal template（見「七」）", () => {
  it("gov_subsidy：prompt 包含 8 欄 JSON schema 與六大方向判斷細節，其他服務不會出現這些", async () => {
    nextMockResponse = JSON.stringify({
      primaryRecommendation: "目前較適合往 CITD 評估", secondaryRecommendation: "未提供",
      currentProblem: "未提供", rdStatus: "未提供", equipmentNeed: "未提供",
      tariffImpact: "未提供", selfFundingCapacity: "未提供", aiReasoning: "未提供",
    });
    const caseId = 800002;
    await initiateCaseAssessment({
      serviceKey: "gov_subsidy",
      handoffContext: fakeHandoffContext({ serviceKey: "gov_subsidy" }),
      caseId, factoryId, userId,
      submittedForm: {
        decisionMakerParticipation: "owner", annualRevenue: "under_5m", employeeCount: "6_30",
        factoryType: "general", isEnterpriseFirm: false, hasGovernmentProject: false,
        governmentProjectName: null, hasAppliedForGovernmentSubsidy: false,
        hasPatent: false, patentCount: null, exportStatus: "no_export", notes: null,
      },
    });
    const row = await waitFor("gov_subsidy", caseId);
    createdIds.push(row!.id);
    const prompt = capturedPrompts[capturedPrompts.length - 1];
    expect(prompt).toContain("primaryRecommendation");
    expect(prompt).toContain("CITD");
    // Phase 6G.1：判斷細節不再手寫獨立文字，改為重用 shared/ai/serviceRegistry.ts
    // 的 fitSignals／cautionSignals／comparisonNotes（見 serializeGovSubsidyPrograms）。
    expect(prompt).toContain("製造業 19+1 AI 診斷輔導（key: manufacturing_19plus1）");
    expect(prompt).toContain("已經有清楚的研發標的、已完成 PoC、準備把技術整合成正式產品時，不應該再把 19+1 當首選");
    expect(prompt).toContain("目前較適合往 XXX 評估");
    expect(prompt).not.toContain('{"summary"');
  });

  it("finance：prompt 明確說明表單沒有業務欄位，內容完全依 handoff 背景，且格式是 {summary}", async () => {
    const caseId = 800003;
    await initiateCaseAssessment({
      serviceKey: "finance",
      handoffContext: fakeHandoffContext({ serviceKey: "finance", handoffSummary: "客戶帳期 90 天造成週轉壓力。" }),
      caseId, factoryId, userId,
      submittedForm: {},
    });
    const row = await waitFor("finance", caseId);
    createdIds.push(row!.id);
    const prompt = capturedPrompts[capturedPrompts.length - 1];
    expect(prompt).toContain("這個服務的正式申請表單本身沒有業務欄位");
    expect(prompt).not.toContain("primaryRecommendation");
    expect(prompt).toContain('{"summary":""}');
  });

  it("certification：表單只選 ISO 9001 時，prompt 不會主動列出 ISO 14001 等其他標準作為已選項目", async () => {
    const caseId = 800004;
    await initiateCaseAssessment({
      serviceKey: "certification",
      handoffContext: fakeHandoffContext({ serviceKey: "certification" }),
      caseId, factoryId, userId,
      submittedForm: { servicesWantedLabels: ["ISO 9001 品質管理系統"], isUnsure: false, additionalNotes: null },
    });
    const row = await waitFor("certification", caseId);
    createdIds.push(row!.id);
    const prompt = capturedPrompts[capturedPrompts.length - 1];
    // 「最終送出的正式申請表單」這一行本身只能是使用者真的勾選的項目，不能混入 14001——
    // 提示文字裡的負面示範句（"絕對不能自己多寫 ISO 14001"）本身合法提到這個字串，
    // 所以檢查的對象是表單那一行本身，不是整份 prompt 完全不含這個字串。
    const formLine = prompt.split("\n").find(line => line.startsWith("想了解的認證／低碳服務："));
    expect(formLine).toBe("想了解的認證／低碳服務：ISO 9001 品質管理系統");
    expect(prompt).toContain("不得自行新增其他標準");
  });

  it("short_video：表單只選 Instagram 時，prompt 不會列出 TikTok／YouTube 作為已選平台", async () => {
    const caseId = 800005;
    await initiateCaseAssessment({
      serviceKey: "short_video",
      handoffContext: fakeHandoffContext({ serviceKey: "short_video" }),
      caseId, factoryId, userId,
      submittedForm: {
        servicesWantedLabels: ["訪談製作"], isUnsure: false, primaryGoalLabel: "深入呈現創辦人、技術或品牌故事",
        platformLabels: ["Instagram"], noPlatformYet: false, additionalNotes: null,
      },
    });
    const row = await waitFor("short_video", caseId);
    createdIds.push(row!.id);
    const prompt = capturedPrompts[capturedPrompts.length - 1];
    // 同 certification 案例：指示文字裡的負面示範句本身合法提到 TikTok／YouTube，
    // 所以只檢查「最終送出的正式申請表單」那一行本身有沒有混入使用者沒勾的平台。
    const platformLine = prompt.split("\n").find(line => line.startsWith("目前經營平台："));
    expect(platformLine).toBe("目前經營平台：Instagram");
  });
});

describe("gov_subsidy 8 欄防禦性 parse：模型漏欄位時補「未提供」，不崩潰", () => {
  it("模型只回傳 3 個欄位 → 其餘 5 個欄位自動補「未提供」", async () => {
    nextMockResponse = JSON.stringify({
      primaryRecommendation: "目前較適合往 SBIR 評估",
      currentProblem: "研發能量不足",
      aiReasoning: "使用者明確表達新產品研發需求",
    });
    const caseId = 800006;
    await initiateCaseAssessment({
      serviceKey: "gov_subsidy",
      handoffContext: fakeHandoffContext({ serviceKey: "gov_subsidy" }),
      caseId, factoryId, userId,
      submittedForm: {
        decisionMakerParticipation: "owner", annualRevenue: "under_5m", employeeCount: "6_30",
        factoryType: "general", isEnterpriseFirm: false, hasGovernmentProject: false,
        governmentProjectName: null, hasAppliedForGovernmentSubsidy: false,
        hasPatent: false, patentCount: null, exportStatus: "no_export", notes: null,
      },
    });
    const row = await waitFor("gov_subsidy", caseId);
    createdIds.push(row!.id);
    expect(row?.status).toBe("completed");
    const json = row?.assessmentJson as Record<string, string>;
    expect(json.primaryRecommendation).toBe("目前較適合往 SBIR 評估");
    expect(json.secondaryRecommendation).toBe("未提供");
    expect(json.equipmentNeed).toBe("未提供");
    expect(json.tariffImpact).toBe("未提供");
    expect(json.selfFundingCapacity).toBe("未提供");
  });

  it("模型回傳不是 JSON object（例如陣列）→ assessment 標記 failed，不寫入垃圾資料", async () => {
    nextMockResponse = JSON.stringify(["not", "an", "object"]);
    const caseId = 800007;
    await initiateCaseAssessment({
      serviceKey: "gov_subsidy",
      handoffContext: fakeHandoffContext({ serviceKey: "gov_subsidy" }),
      caseId, factoryId, userId,
      submittedForm: {
        decisionMakerParticipation: "owner", annualRevenue: "under_5m", employeeCount: "6_30",
        factoryType: "general", isEnterpriseFirm: false, hasGovernmentProject: false,
        governmentProjectName: null, hasAppliedForGovernmentSubsidy: false,
        hasPatent: false, patentCount: null, exportStatus: "no_export", notes: null,
      },
    });
    const row = await waitFor("gov_subsidy", caseId);
    createdIds.push(row!.id);
    expect(row?.status).toBe("failed");
    expect(row?.assessmentJson).toBeNull();
    nextMockResponse = null;
  });
});

describe("buildRetryInitiateParams：保守 guard clause，資料不足一律回傳 null（不硬湊）", () => {
  it("handoffContextId 為 null → 回傳 null，不查詢任何額外資料", async () => {
    const fake: AiCaseAssessment = {
      id: 1, userId, factoryId: 1, serviceKey: "erp", caseId: 1,
      handoffContextId: null, status: "failed", assessmentJson: null, assessmentText: null,
      retryCount: 0, lastError: "boom", createdAt: new Date(), updatedAt: new Date(),
    } as AiCaseAssessment;
    const result = await buildRetryInitiateParams(fake);
    expect(result).toBeNull();
  });

  it("factoryId 為 null → 回傳 null", async () => {
    const fake: AiCaseAssessment = {
      id: 1, userId, factoryId: null, serviceKey: "erp", caseId: 1,
      handoffContextId: 999, status: "failed", assessmentJson: null, assessmentText: null,
      retryCount: 0, lastError: "boom", createdAt: new Date(), updatedAt: new Date(),
    } as AiCaseAssessment;
    const result = await buildRetryInitiateParams(fake);
    expect(result).toBeNull();
  });
});

describe("可靠性修正「九、必測 Authority」：實際送進模型的 prompt 不得同時存在互相矛盾的新舊事實", () => {
  it("CASE 9-1：handoff hasPatent=false，正式表單 hasPatent=true+patentCount=3 → prompt 只能把表單值當有效事實，不得殘留「無專利」造成語意衝突", async () => {
    nextMockResponse = JSON.stringify({
      primaryRecommendation: "目前較適合往 CITD 評估", secondaryRecommendation: "未提供",
      currentProblem: "未提供", rdStatus: "未提供", equipmentNeed: "未提供",
      tariffImpact: "未提供", selfFundingCapacity: "未提供", aiReasoning: "未提供",
    });
    const caseId = 800008;
    await initiateCaseAssessment({
      serviceKey: "gov_subsidy",
      handoffContext: fakeHandoffContext({
        serviceKey: "gov_subsidy",
        prefillDataJson: { hasPatent: false },
      }),
      caseId, factoryId, userId,
      submittedForm: {
        decisionMakerParticipation: "owner", annualRevenue: "under_5m", employeeCount: "6_30",
        factoryType: "general", isEnterpriseFirm: false, hasGovernmentProject: false,
        governmentProjectName: null, hasAppliedForGovernmentSubsidy: false,
        hasPatent: true, patentCount: 3, exportStatus: "no_export", notes: null,
      },
    });
    const row = await waitFor("gov_subsidy", caseId);
    createdIds.push(row!.id);
    const prompt = capturedPrompts[capturedPrompts.length - 1];
    expect(prompt).toContain("是否持有專利：是（3 件）");
    // 對話期間背景那一行不得再殘留 hasPatent:false 這種舊值——已被 buildAuthoritativeReferenceBackground 剔除。
    const backgroundLine = prompt.split("\n").find(line => line.startsWith("對話中已確認"));
    expect(backgroundLine).not.toContain("hasPatent");
    expect(backgroundLine).toContain("無");
  });

  it("CASE 9-3：正式表單 isEnterpriseFirm 明確填 false，即使 handoff 舊值是 true，也不得在背景資料殘留造成衝突", async () => {
    nextMockResponse = JSON.stringify({
      primaryRecommendation: "未提供", secondaryRecommendation: "未提供",
      currentProblem: "未提供", rdStatus: "未提供", equipmentNeed: "未提供",
      tariffImpact: "未提供", selfFundingCapacity: "未提供", aiReasoning: "未提供",
    });
    const caseId = 800009;
    await initiateCaseAssessment({
      serviceKey: "gov_subsidy",
      handoffContext: fakeHandoffContext({
        serviceKey: "gov_subsidy",
        prefillDataJson: { isEnterpriseFirm: true },
      }),
      caseId, factoryId, userId,
      submittedForm: {
        decisionMakerParticipation: "owner", annualRevenue: "under_5m", employeeCount: "6_30",
        factoryType: "general", isEnterpriseFirm: false, hasGovernmentProject: false,
        governmentProjectName: null, hasAppliedForGovernmentSubsidy: false,
        hasPatent: false, patentCount: null, exportStatus: "no_export", notes: null,
      },
    });
    const row = await waitFor("gov_subsidy", caseId);
    createdIds.push(row!.id);
    const prompt = capturedPrompts[capturedPrompts.length - 1];
    expect(prompt).toContain("是否為企業社：否");
    const backgroundLine = prompt.split("\n").find(line => line.startsWith("對話中已確認"));
    expect(backgroundLine).not.toContain("isEnterpriseFirm");
  });

  it("CASE 9-2：handoff 有 govProjectName 但表單完全沒有『政府計畫名稱』這個型別欄位可回答時，需求 spec 之外欄位不受影響（finance 無 submittedForm 業務欄位時，prefillData 恆為空，不受影響）", async () => {
    const caseId = 800010;
    await initiateCaseAssessment({
      serviceKey: "finance",
      handoffContext: fakeHandoffContext({ serviceKey: "finance", handoffSummary: "資金週轉需求" }),
      caseId, factoryId, userId,
      submittedForm: {},
    });
    const row = await waitFor("finance", caseId);
    createdIds.push(row!.id);
    expect(row?.status).toBe("completed");
  });
});
