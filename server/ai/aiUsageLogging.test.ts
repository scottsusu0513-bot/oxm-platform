/**
 * Phase 8.1 U 系列（logAiModelCall 落地正確性）：真實 DB 寫入測試，驗證
 * turnId／factoryId／actorUserId 正確從 ambient context 讀出，沒有 context
 * 時寫 null（不是拋錯或跳過——provider.ts 的呼叫不保證一定在 AI Shell turn
 * 內，例如背景腳本），以及 token 欄位缺席時忠實寫 null（不估計、不假造）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { logAiModelCall } from "./aiUsageLogging";
import { runWithAiCallContext } from "./aiCallContext";
import { reserveAiTurn } from "./aiQuota";

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let conn: mysql.PoolConnection;
// aiModelCalls 的 turnId／factoryId／actorUserId 都有 FK 限制，必須指向真實
// 存在的 row（不能像原本草稿一樣隨便寫 111/222/333）——這裡建一組最小 fixture
// 供整個檔案共用。
let realUserId: number;
let realFactoryId: number;
let realTurnId: number;

async function latestRowForModel(model: string): Promise<any> {
  const [rows]: any = await conn.execute(
    "SELECT * FROM aiModelCalls WHERE model = ? ORDER BY id DESC LIMIT 1",
    [model]
  );
  return rows[0];
}

beforeAll(async () => {
  if (!DB_URL) return;
  pool = mysql.createPool(DB_URL);
  conn = await pool.getConnection();

  const email = "usage_log_test_fixture@oxm.test";
  const [userResult] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, email, name, isFactoryOwner, role, lastSignedIn) VALUES (?, ?, ?, FALSE, 'user', NOW())",
    [email, email, email]
  );
  realUserId = userResult.insertId;
  const [factoryResult] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'normal', FALSE, ?, NOW(), NOW())",
    [realUserId, "[USAGE_LOG_TEST] Fixture Factory", JSON.stringify(["電子"]), JSON.stringify(["ODM"]), "新竹市", "<1000萬", "新竹市", "[]"]
  );
  realFactoryId = factoryResult.insertId;
  const reserved = await reserveAiTurn({
    factoryId: realFactoryId, actorUserId: realUserId, conversationId: null,
    clientTurnId: "usage-log-test-fixture-turn", bypassQuota: false,
  });
  if (!reserved.ok) throw new Error("fixture reserveAiTurn failed unexpectedly");
  realTurnId = reserved.turnId;
});

afterAll(async () => {
  if (!DB_URL) return;
  await conn.execute("DELETE FROM aiModelCalls WHERE model LIKE 'usage-log-test-%'");
  await conn.execute("DELETE FROM aiUsageTurns WHERE id = ?", [realTurnId]);
  await conn.execute("DELETE FROM factoryAiDailyUsage WHERE factoryId = ?", [realFactoryId]);
  await conn.execute("DELETE FROM factories WHERE id = ?", [realFactoryId]);
  await conn.execute("DELETE FROM users WHERE id = ?", [realUserId]);
  conn.release();
  await pool.end();
});

describeIfDb("logAiModelCall（Phase 8.1 U 系列）", () => {
  it("U6：有 ambient context 時，turnId／factoryId／actorUserId 正確寫入", async () => {
    const model = "usage-log-test-with-context";
    await runWithAiCallContext({ turnId: realTurnId, factoryId: realFactoryId, actorUserId: realUserId }, () =>
      logAiModelCall({
        layer: "diagnosis",
        model,
        provider: "openai",
        latencyMs: 42,
        success: true,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: null, reasoningTokens: null },
      })
    );
    const row = await latestRowForModel(model);
    expect(row).toBeTruthy();
    expect(row.turnId).toBe(realTurnId);
    expect(row.factoryId).toBe(realFactoryId);
    expect(row.actorUserId).toBe(realUserId);
    expect(row.inputTokens).toBe(100);
    expect(row.outputTokens).toBe(20);
    expect(row.totalTokens).toBe(120);
    expect(row.cachedInputTokens).toBeNull();
    expect(!!row.success).toBe(true);
  });

  it("U7：沒有 ambient context 時仍然落地一筆 row，turnId／factoryId／actorUserId 為 null（不是跳過不記）", async () => {
    const model = "usage-log-test-no-context";
    await logAiModelCall({
      layer: "diagnosis",
      model,
      provider: "openai",
      latencyMs: 10,
      success: true,
    });
    const row = await latestRowForModel(model);
    expect(row).toBeTruthy();
    expect(row.turnId).toBeNull();
    expect(row.factoryId).toBeNull();
    expect(row.actorUserId).toBeNull();
    expect(row.inputTokens).toBeNull();
  });

  it("U8：失敗呼叫記錄 success=false 與 errorCategory，不記錄任何 usage 欄位", async () => {
    const model = "usage-log-test-failure";
    await logAiModelCall({
      layer: "routing",
      model,
      provider: "openai",
      latencyMs: 5,
      success: false,
      errorCategory: "rate_limit",
    });
    const row = await latestRowForModel(model);
    expect(!!row.success).toBe(false);
    expect(row.errorCategory).toBe("rate_limit");
    expect(row.totalTokens).toBeNull();
  });

  it("H13：Admin 無工廠語境（factoryId=null）的 model call 仍正確落地，turnId／actorUserId 有值，factoryId 為 null", async () => {
    const model = "usage-log-test-admin-null-factory";
    await runWithAiCallContext({ turnId: realTurnId, factoryId: null, actorUserId: realUserId }, () =>
      logAiModelCall({ layer: "caseAssessment", model, provider: "openai", latencyMs: 15, success: true })
    );
    const row = await latestRowForModel(model);
    expect(row).toBeTruthy();
    expect(row.turnId).toBe(realTurnId);
    expect(row.factoryId).toBeNull();
    expect(row.actorUserId).toBe(realUserId);
  });
});
