/**
 * retryFailedAiCaseAssessments() 驗證（見對話中「二十五、Assessment 失敗
 * 重試」「二十六、不要因重試造成重複 assessment」）：對 status=failed 的
 * assessment 重新生成，成功就 UPDATE 為 completed，仍失敗保持 failed 並
 * retryCount 累加，統計數字正確；serviceKey+caseId 全程只有一筆 row。
 * provider mock 掉，DB 走真實本機測試資料庫。
 */
import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

const mockCompleteJson = vi.fn();
vi.mock("../ai/provider", () => ({
  getAiChatProvider: () => ({ completeJson: mockCompleteJson }),
  isAiChatConfigured: () => true,
}));

const { getDb } = await import("../db");
const { retryFailedAiCaseAssessments, STALE_PENDING_THRESHOLD_MS } = await import("./retryFailedAiCaseAssessments");
const { createPendingAssessment, markAssessmentFailed, getAssessmentForCase } = await import("../ai/caseAssessmentService");
const { createHandoffContext } = await import("../ai/handoffContextService");
const { createTestFactory } = await import("../_core/financeTestFixtures");

const runId = `retry-aica-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: number;
// erpCases 有「同一工廠最多一筆未結案案件」的限制，每個測試各自需要一間乾淨的工廠。
let factoryId: number, factoryId2: number, factoryId3: number, factoryId4: number, factoryId5: number;
const createdCaseIds: number[] = [];
const createdAssessmentIds: number[] = [];
let handoffContextId: number;

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Retry AICA ${runId}`}, ${`${runId}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

/** 直接寫一筆最小可用的 erpCases row，供 buildRetryInitiateParams 重新讀回。 */
async function createTestErpCase(forFactoryId: number): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const [result] = await conn.execute(sql`
    INSERT INTO erpCases (factoryId, companyNameSnapshot, companyAddressSnapshot, contactName, phone, contactTime, needType, consentAgreed, status, createdAt, updatedAt)
    VALUES (${forFactoryId}, ${`${runId} 公司`}, ${`${runId} 地址`}, "測試聯絡人", "0912345678", "平日下午", "erp_adoption", TRUE, "unassigned", NOW(), NOW())
  `) as unknown as [{ insertId: number }, unknown];
  return result.insertId;
}

const cleanupUserIds: number[] = [];
const cleanupFactoryIds: number[] = [];

beforeAll(async () => {
  userId = await createTestUser();
  factoryId = await createTestFactory(userId, `${runId} 工廠`, "approved");
  cleanupUserIds.push(userId);
  cleanupFactoryIds.push(factoryId);

  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const owner2Open = `test-${runId}-2`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${owner2Open}, ${`Retry AICA ${runId}-2`}, ${`${runId}-2@example.test`})`);
  const [rows2] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${owner2Open} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const owner2Id = rows2[0]!.id;
  factoryId2 = await createTestFactory(owner2Id, `${runId} 工廠2`, "approved");
  cleanupUserIds.push(owner2Id);
  cleanupFactoryIds.push(factoryId2);

  const owner3Open = `test-${runId}-3`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${owner3Open}, ${`Retry AICA ${runId}-3`}, ${`${runId}-3@example.test`})`);
  const [rows3] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${owner3Open} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const owner3Id = rows3[0]!.id;
  factoryId3 = await createTestFactory(owner3Id, `${runId} 工廠3`, "approved");
  cleanupUserIds.push(owner3Id);
  cleanupFactoryIds.push(factoryId3);

  const owner4Open = `test-${runId}-4`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${owner4Open}, ${`Retry AICA ${runId}-4`}, ${`${runId}-4@example.test`})`);
  const [rows4] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${owner4Open} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const owner4Id = rows4[0]!.id;
  factoryId4 = await createTestFactory(owner4Id, `${runId} 工廠4`, "approved");
  cleanupUserIds.push(owner4Id);
  cleanupFactoryIds.push(factoryId4);

  const owner5Open = `test-${runId}-5`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${owner5Open}, ${`Retry AICA ${runId}-5`}, ${`${runId}-5@example.test`})`);
  const [rows5] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${owner5Open} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const owner5Id = rows5[0]!.id;
  factoryId5 = await createTestFactory(owner5Id, `${runId} 工廠5`, "approved");
  cleanupUserIds.push(owner5Id);
  cleanupFactoryIds.push(factoryId5);

  const context = await createHandoffContext({
    userId, factoryId, serviceKey: "erp", prefillData: {}, confirmedFields: {},
    handoffSummary: "retry job fixture context", sourceConversationId: null,
  });
  handoffContextId = context.id;
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  if (createdAssessmentIds.length > 0) {
    await conn.execute(sql`DELETE FROM aiCaseAssessments WHERE id IN (${sql.join(createdAssessmentIds, sql`, `)})`);
  }
  if (createdCaseIds.length > 0) {
    await conn.execute(sql`DELETE FROM erpCases WHERE id IN (${sql.join(createdCaseIds, sql`, `)})`);
  }
  await conn.execute(sql`DELETE FROM aiHandoffContexts WHERE id = ${handoffContextId}`);
  for (const id of cleanupFactoryIds) await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
  for (const id of cleanupUserIds) await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
});

beforeEach(() => {
  mockCompleteJson.mockReset();
});

describe("retryFailedAiCaseAssessments", () => {
  it("重試成功：failed → completed，UPDATE 同一筆（不新增第二筆），retryCount +1", async () => {
    const caseId = await createTestErpCase(factoryId);
    createdCaseIds.push(caseId);
    const assessmentId = await createPendingAssessment({
      userId, factoryId, serviceKey: "erp", caseId, handoffContextId,
    });
    createdAssessmentIds.push(assessmentId);
    await markAssessmentFailed(assessmentId, "first attempt failed");

    mockCompleteJson.mockResolvedValue(JSON.stringify({ summary: "重試後成功的摘要" }));

    const result = await retryFailedAiCaseAssessments();
    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const row = await getAssessmentForCase("erp", caseId);
    expect(row?.id).toBe(assessmentId); // 同一筆 UPDATE
    expect(row?.status).toBe("completed");
    expect((row?.assessmentJson as Record<string, unknown>).summary).toBe("重試後成功的摘要");
    expect(row?.retryCount).toBe(1);

    const conn = await getDb();
    const [countRows] = await conn!.execute(
      sql`SELECT COUNT(*) as c FROM aiCaseAssessments WHERE serviceKey = 'erp' AND caseId = ${caseId}`
    ) as unknown as [{ c: number }[], unknown];
    expect(Number(countRows[0].c)).toBe(1);
  });

  it("重試仍然失敗：保持 failed，retryCount 累加，不會被刪除或新增第二筆", async () => {
    const caseId = await createTestErpCase(factoryId2);
    createdCaseIds.push(caseId);
    const assessmentId = await createPendingAssessment({
      userId, factoryId: factoryId2, serviceKey: "erp", caseId, handoffContextId,
    });
    createdAssessmentIds.push(assessmentId);
    await markAssessmentFailed(assessmentId, "first attempt failed");

    mockCompleteJson.mockRejectedValue(new Error("still failing"));

    const result = await retryFailedAiCaseAssessments();
    expect(result.stillFailing).toBeGreaterThanOrEqual(1);

    const row = await getAssessmentForCase("erp", caseId);
    expect(row?.id).toBe(assessmentId);
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(1);
    expect(row?.lastError).toContain("still failing");
  });

  it("handoffContext 或案件已經找不到時（例如已被清除）：安全略過，標記仍是 failed，不拋錯中斷整個 job", async () => {
    const caseId = await createTestErpCase(factoryId3);
    createdCaseIds.push(caseId);
    const assessmentId = await createPendingAssessment({
      userId, factoryId: factoryId3, serviceKey: "erp", caseId, handoffContextId: null,
    });
    createdAssessmentIds.push(assessmentId);
    await markAssessmentFailed(assessmentId, "first attempt failed");

    const result = await retryFailedAiCaseAssessments();
    expect(result.stillFailing).toBeGreaterThanOrEqual(1);

    const row = await getAssessmentForCase("erp", caseId);
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toContain("找不到對應的案件或 handoff context");
  });

  it("CASE 5：pending 超過 stale 門檻（模擬 process 在生成前中斷）→ retry job 可以重新生成，completed，同一 serviceKey+caseId 仍只有一筆", async () => {
    const caseId = await createTestErpCase(factoryId4);
    createdCaseIds.push(caseId);
    const assessmentId = await createPendingAssessment({
      userId, factoryId: factoryId4, serviceKey: "erp", caseId, handoffContextId,
    });
    createdAssessmentIds.push(assessmentId);
    // 直接把 updatedAt 改到超過 stale 門檻之前，模擬「已經很久沒有被更新過」的中斷 pending。
    const conn = await getDb();
    if (!conn) throw new Error("no db");
    await conn.execute(
      sql`UPDATE aiCaseAssessments SET updatedAt = DATE_SUB(NOW(), INTERVAL ${Math.ceil(STALE_PENDING_THRESHOLD_MS / 60000) + 5} MINUTE) WHERE id = ${assessmentId}`
    );

    mockCompleteJson.mockResolvedValue(JSON.stringify({ summary: "stale pending 恢復後生成成功" }));
    const result = await retryFailedAiCaseAssessments();
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const row = await getAssessmentForCase("erp", caseId);
    expect(row?.id).toBe(assessmentId);
    expect(row?.status).toBe("completed");
    expect((row?.assessmentJson as Record<string, unknown>).summary).toBe("stale pending 恢復後生成成功");

    const [countRows] = await conn.execute(
      sql`SELECT COUNT(*) as c FROM aiCaseAssessments WHERE serviceKey = 'erp' AND caseId = ${caseId}`
    ) as unknown as [{ c: number }[], unknown];
    expect(Number(countRows[0].c)).toBe(1);
  });

  it("CASE 6：pending 剛建立幾十秒（仍可能正常生成中）→ retry job 不搶著重試，狀態維持 pending 不受影響", async () => {
    const caseId = await createTestErpCase(factoryId5);
    createdCaseIds.push(caseId);
    const assessmentId = await createPendingAssessment({
      userId, factoryId: factoryId5, serviceKey: "erp", caseId, handoffContextId,
    });
    createdAssessmentIds.push(assessmentId);
    // 不動 updatedAt——維持剛建立的狀態（幾乎等於「幾秒鐘前」），應該被排除在 stale 名單外。

    mockCompleteJson.mockResolvedValue(JSON.stringify({ summary: "不應該被呼叫到" }));
    await retryFailedAiCaseAssessments();

    const row = await getAssessmentForCase("erp", caseId);
    expect(row?.id).toBe(assessmentId);
    expect(row?.status).toBe("pending");
    expect(row?.assessmentJson).toBeNull();
    expect(row?.retryCount).toBe(0);
  });
});
