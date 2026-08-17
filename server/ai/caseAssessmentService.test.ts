/**
 * server/ai/caseAssessmentService.ts 驗證——單純 DB CRUD，走真實本機測試
 * 資料庫。對應對話中「六、共用 AI Case Assessment table」「二十六、不要因
 * 重試造成重複 assessment」。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { aiCaseAssessments } from "../../drizzle/schema";
import {
  createPendingAssessment, markAssessmentCompleted, markAssessmentFailed,
  incrementAssessmentRetryCount, getAssessmentForCase, getAssessmentsForCases, listFailedAssessments,
} from "./caseAssessmentService";

const runId = `aica-svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: number;
const createdIds: number[] = [];

async function createTestUser(): Promise<number> {
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`AICA Svc ${runId}`}, ${`${runId}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]?.id;
  if (!id) throw new Error("failed to create test user");
  return id;
}

beforeAll(async () => {
  userId = await createTestUser();
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  if (createdIds.length > 0) {
    await conn.delete(aiCaseAssessments).where(sql`id IN (${sql.join(createdIds, sql`, `)})`);
  }
  await conn.execute(sql`DELETE FROM users WHERE id = ${userId}`);
});

describe("createPendingAssessment / getAssessmentForCase", () => {
  it("建立後 status 是 pending，assessmentJson/assessmentText 都是 null", async () => {
    const id = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "erp", caseId: 900001, handoffContextId: null,
    });
    createdIds.push(id);
    const row = await getAssessmentForCase("erp", 900001);
    expect(row?.status).toBe("pending");
    expect(row?.assessmentJson).toBeNull();
    expect(row?.assessmentText).toBeNull();
    expect(row?.retryCount).toBe(0);
  });

  it("同一 serviceKey+caseId 已存在時，再次 createPendingAssessment 會因為 unique index 失敗（見「二十六」）", async () => {
    await expect(createPendingAssessment({
      userId, factoryId: null, serviceKey: "erp", caseId: 900001, handoffContextId: null,
    })).rejects.toThrow();
  });

  it("不同 serviceKey 但相同 caseId 數字：視為不同案件，可以各自建立（polymorphic reference）", async () => {
    const id = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "certification", caseId: 900001, handoffContextId: null,
    });
    createdIds.push(id);
    const certRow = await getAssessmentForCase("certification", 900001);
    const erpRow = await getAssessmentForCase("erp", 900001);
    expect(certRow).toBeTruthy();
    expect(erpRow).toBeTruthy();
    expect(certRow?.id).not.toBe(erpRow?.id);
  });
});

describe("markAssessmentCompleted / markAssessmentFailed", () => {
  it("markAssessmentCompleted 寫入 assessmentJson/assessmentText，status 變 completed，lastError 清空", async () => {
    const id = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "short_video", caseId: 900002, handoffContextId: null,
    });
    createdIds.push(id);
    await markAssessmentFailed(id, "第一次先失敗一次");
    await markAssessmentCompleted(id, { assessmentJson: { summary: "測試摘要" }, assessmentText: "測試摘要" });
    const row = await getAssessmentForCase("short_video", 900002);
    expect(row?.status).toBe("completed");
    expect(row?.assessmentJson).toEqual({ summary: "測試摘要" });
    expect(row?.assessmentText).toBe("測試摘要");
    expect(row?.lastError).toBeNull();
  });

  it("markAssessmentFailed 只更新 status/lastError，不寫入 assessmentJson（不得把殘缺輸出當正式內容，見「二十五」）", async () => {
    const id = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "finance", caseId: 900003, handoffContextId: null,
    });
    createdIds.push(id);
    await markAssessmentFailed(id, "provider timeout");
    const row = await getAssessmentForCase("finance", 900003);
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("provider timeout");
    expect(row?.assessmentJson).toBeNull();
  });
});

describe("incrementAssessmentRetryCount", () => {
  it("每次呼叫 retryCount +1", async () => {
    const id = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "gov_subsidy", caseId: 900004, handoffContextId: null,
    });
    createdIds.push(id);
    await incrementAssessmentRetryCount(id, 0);
    await incrementAssessmentRetryCount(id, 1);
    const row = await getAssessmentForCase("gov_subsidy", 900004);
    expect(row?.retryCount).toBe(2);
  });
});

describe("getAssessmentsForCases（批次查詢）", () => {
  it("回傳的 Map 只包含真的存在 assessment 的 caseId，其餘（一般直接表單案件）不在 Map 裡", async () => {
    const id1 = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "erp", caseId: 900010, handoffContextId: null,
    });
    const id2 = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "erp", caseId: 900011, handoffContextId: null,
    });
    createdIds.push(id1, id2);
    const map = await getAssessmentsForCases("erp", [900010, 900011, 900012]);
    expect(map.has(900010)).toBe(true);
    expect(map.has(900011)).toBe(true);
    expect(map.has(900012)).toBe(false); // 一般直接表單案件，沒有 row
  });

  it("caseIds 為空陣列時直接回傳空 Map，不查詢 DB", async () => {
    const map = await getAssessmentsForCases("erp", []);
    expect(map.size).toBe(0);
  });
});

describe("listFailedAssessments", () => {
  it("只回傳 status=failed 的 row", async () => {
    const idPending = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "certification", caseId: 900020, handoffContextId: null,
    });
    const idFailed = await createPendingAssessment({
      userId, factoryId: null, serviceKey: "certification", caseId: 900021, handoffContextId: null,
    });
    createdIds.push(idPending, idFailed);
    await markAssessmentFailed(idFailed, "boom");

    const failed = await listFailedAssessments();
    const ids = failed.map(f => f.id);
    expect(ids).toContain(idFailed);
    expect(ids).not.toContain(idPending);
  });
});
