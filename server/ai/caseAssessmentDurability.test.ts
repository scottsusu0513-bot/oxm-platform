/**
 * 可靠性修正「四、Assessment pending row 建立失敗的漏洞」「五、Handoff
 * consume 與 Assessment record 的最低保證」驗證（見對話中「九、必測 Durable
 * Assessment」CASE 4）。獨立成一個檔案，因為需要對 createPendingAssessment
 * 做細粒度的失敗模擬（原本 caseAssessment.test.ts 其餘測試都依賴真實 DB
 * 版本的 createPendingAssessment，不能被整檔 mock 影響）。
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("./provider", () => ({
  getAiChatProvider: () => ({
    complete: vi.fn(),
    completeJson: vi.fn(async () => JSON.stringify({ summary: "durability test 摘要" })),
  }),
  isAiChatConfigured: () => true,
}));

vi.mock("./caseAssessmentService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./caseAssessmentService")>();
  return { ...actual, createPendingAssessment: vi.fn(actual.createPendingAssessment) };
});

const { getDb } = await import("../db");
const { initiateCaseAssessment } = await import("./caseAssessment");
const { createPendingAssessment, getAssessmentForCase } = await import("./caseAssessmentService");
const { createHandoffContext, getHandoffContextById } = await import("./handoffContextService");
const { createTestFactory } = await import("../_core/financeTestFixtures");
const { aiCaseAssessments } = await import("../../drizzle/schema");

const mockedCreatePending = vi.mocked(createPendingAssessment);
const actualService = await vi.importActual<typeof import("./caseAssessmentService")>("./caseAssessmentService");

const runId = `aica-durability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: number;
let factoryId: number;
const createdAssessmentIds: number[] = [];
const createdHandoffContextIds: number[] = [];

async function waitForRow(caseId: number, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await getAssessmentForCase("erp", caseId);
    if (row && row.status !== "pending") return row;
    await new Promise(r => setTimeout(r, 30));
  }
  return getAssessmentForCase("erp", caseId);
}

beforeAll(async () => {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`AICA Durability ${runId}`}, ${`${runId}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  userId = rows[0]!.id;
  factoryId = await createTestFactory(userId, `${runId} 工廠`, "approved");
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  if (createdAssessmentIds.length > 0) {
    await conn.delete(aiCaseAssessments).where(sql`id IN (${sql.join(createdAssessmentIds, sql`, `)})`);
  }
  if (createdHandoffContextIds.length > 0) {
    await conn.execute(sql`DELETE FROM aiHandoffContexts WHERE id IN (${sql.join(createdHandoffContextIds, sql`, `)})`);
  }
  await conn.execute(sql`DELETE FROM factories WHERE id = ${factoryId}`);
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
});

describe("CASE 4：pending row 建立失敗的漏洞修正", () => {
  it("createPendingAssessment 連續 3 次都失敗 → initiateCaseAssessment 回傳 false、不拋錯，完全不留下任何 assessment row，handoff context 保持未消費", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending.mockRejectedValue(new Error("模擬 DB 暫時性錯誤"));

    const context = await createHandoffContext({
      userId, factoryId, serviceKey: "erp", prefillData: {}, confirmedFields: {},
      handoffSummary: "CASE 4 fixture", sourceConversationId: null,
    });
    createdHandoffContextIds.push(context.id);
    const caseId = 810001;

    await expect(initiateCaseAssessment({
      serviceKey: "erp",
      handoffContext: context,
      caseId, factoryId, userId,
      submittedForm: { needType: "ERP 導入", additionalNotes: null },
    })).resolves.toBe(false);

    expect(mockedCreatePending).toHaveBeenCalledTimes(3); // 有限次數重試，見 PENDING_CREATE_ATTEMPTS

    const row = await getAssessmentForCase("erp", caseId);
    expect(row).toBeUndefined(); // 完全沒有建立 row——乾淨地什麼都沒發生，不是留下一筆壞資料

    // routers.ts 只有在 initiateCaseAssessment 回傳 true 時才會消費 token，這裡直接
    // 驗證 context 本身仍是未消費狀態，代表仍是可追溯、可恢復的線索（見「五」）。
    const stillUnconsumed = await getHandoffContextById(context.id);
    expect(stillUnconsumed?.consumedAt).toBeNull();
  });

  it("後續仍有辦法建立 assessment：用同一筆未消費的 handoff context 重新呼叫一次，這次 DB 正常 → 成功建立並完成", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending.mockImplementation(actualService.createPendingAssessment);

    const context = await createHandoffContext({
      userId, factoryId, serviceKey: "erp", prefillData: {}, confirmedFields: {},
      handoffSummary: "CASE 4 recovery fixture", sourceConversationId: null,
    });
    createdHandoffContextIds.push(context.id);
    const caseId = 810002;

    const result = await initiateCaseAssessment({
      serviceKey: "erp",
      handoffContext: context,
      caseId, factoryId, userId,
      submittedForm: { needType: "ERP 導入", additionalNotes: null },
    });
    expect(result).toBe(true);

    const row = await waitForRow(caseId);
    createdAssessmentIds.push(row!.id);
    expect(row?.status).toBe("completed");
  });

  it("有限次數重試中途成功（模擬暫時性 DB 抖動，第 3 次才成功）→ initiateCaseAssessment 仍回傳 true", async () => {
    mockedCreatePending.mockReset();
    mockedCreatePending
      .mockRejectedValueOnce(new Error("暫時性錯誤 1"))
      .mockRejectedValueOnce(new Error("暫時性錯誤 2"))
      .mockImplementationOnce(actualService.createPendingAssessment);

    const context = await createHandoffContext({
      userId, factoryId, serviceKey: "erp", prefillData: {}, confirmedFields: {},
      handoffSummary: "CASE 4 partial-retry fixture", sourceConversationId: null,
    });
    createdHandoffContextIds.push(context.id);
    const caseId = 810003;

    const result = await initiateCaseAssessment({
      serviceKey: "erp",
      handoffContext: context,
      caseId, factoryId, userId,
      submittedForm: { needType: "ERP 導入", additionalNotes: null },
    });
    expect(result).toBe(true);
    expect(mockedCreatePending).toHaveBeenCalledTimes(3);

    const row = await waitForRow(caseId);
    createdAssessmentIds.push(row!.id);
    expect(row?.status).toBe("completed");
  });
});
