/**
 * Phase 8.2（見對話中「三十二、三十三」）：auditFactoryDailyCounterIntegrity
 * 與 getDailyUsageSummary／breakdown 系列的真實 DB 整合測試。同時涵蓋
 * H15（aggregate query correctness）與 H16（privacy：usage rows 不含內容欄位）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import {
  auditFactoryDailyCounterIntegrity,
  getDailyUsageSummary,
  getDailyUsageBreakdownByModel,
  getDailyUsageBreakdownByLayer,
  getDailyUsageBreakdownByFactory,
  getDailyUsageBreakdownByActor,
  getDailyUsageBreakdownByErrorCategory,
  getTodayActiveFactoriesUsage,
  getAiUsageDashboard,
  getRecentAiUsageTurns,
  getStaleStartedTurns,
} from "./aiUsageAudit";
import { getPermanentlyFailedConversationsCount, MAX_SUMMARY_RETRY_COUNT } from "./conversationService";
import { reserveAiTurn, completeAiTurn, failAiTurn } from "./aiQuota";
import { logAiModelCall } from "./aiUsageLogging";
import { runWithAiCallContext } from "./aiCallContext";
import { getTaipeiQuotaDate } from "./taipeiTime";
import { AI_FACTORY_DAILY_TURN_LIMIT } from "../../shared/ai/aiQuotaConfig";

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let conn: mysql.PoolConnection;
const PREFIX = "[AUDIT_TEST]";
let userCounter = 0;

async function mkUser(): Promise<number> {
  userCounter += 1;
  const email = `audit_test_${userCounter}@oxm.test`;
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
  await conn.execute("DELETE FROM aiModelCalls WHERE actorUserId IN (SELECT id FROM users WHERE email LIKE ?)", ["audit_test_%@oxm.test"]);
  await conn.execute("DELETE FROM aiUsageTurns WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiUsageTurns WHERE actorUserId IN (SELECT id FROM users WHERE email LIKE ?)", ["audit_test_%@oxm.test"]);
  await conn.execute("DELETE FROM factoryAiDailyUsage WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiConversations WHERE userId IN (SELECT id FROM users WHERE email LIKE ?)", ["audit_test_%@oxm.test"]);
  await conn.execute("DELETE FROM factories WHERE name LIKE ?", [PREFIX + "%"]);
  await conn.execute("DELETE FROM users WHERE email LIKE ?", ["audit_test_%@oxm.test"]);
}

async function setUserRole(userId: number, role: "admin" | "user"): Promise<void> {
  await conn.execute("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
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

describeIfDb("aiUsageAudit（Phase 8.2 三十二／三十三／H15／H16）", () => {
  let userId: number;
  let factoryId: number;
  const quotaDate = getTaipeiQuotaDate();

  beforeEach(async () => {
    userId = await mkUser();
    factoryId = await mkFactory(userId);
  });

  it("auditFactoryDailyCounterIntegrity：正常路徑下 counter 與 charged-turns COUNT 一致", async () => {
    // Phase 12.2：per-factory concurrency guard 一次只允許一筆 started turn，
    // 這裡模擬真實情境（每筆很快 complete）才能連續保留 3 筆。
    for (let i = 0; i < 3; i++) {
      const r = await reserveAiTurn({
        factoryId, actorUserId: userId, conversationId: null,
        clientTurnId: `audit-consistent-${i}`, bypassQuota: false,
      });
      if (r.ok) await completeAiTurn(r.turnId, {});
    }
    const mismatches = await auditFactoryDailyCounterIntegrity(quotaDate);
    const thisFactory = mismatches.find(m => m.factoryId === factoryId);
    expect(thisFactory).toMatchObject({ counterUsedTurns: 3, chargedTurnsCount: 3, mismatch: false });
  });

  it("auditFactoryDailyCounterIntegrity：人為製造不一致時能被偵測到（直接改 counter，不透過 reserveAiTurn）", async () => {
    await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "audit-drift-1", bypassQuota: false,
    });
    // 人為製造 drift：直接把 counter 改成跟真實 charged turns 數不同
    await conn.execute(
      "UPDATE factoryAiDailyUsage SET usedTurns = 99 WHERE factoryId = ? AND quotaDate = ?",
      [factoryId, quotaDate]
    );
    const mismatches = await auditFactoryDailyCounterIntegrity(quotaDate);
    const thisFactory = mismatches.find(m => m.factoryId === factoryId);
    expect(thisFactory).toMatchObject({ counterUsedTurns: 99, chargedTurnsCount: 1, mismatch: true });
  });

  it("getDailyUsageSummary + breakdown：正確統計 turns／model calls／tokens／failures", async () => {
    const reserved = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "audit-summary-1", bypassQuota: false,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;

    await runWithAiCallContext({ turnId: reserved.turnId, factoryId, actorUserId: userId }, async () => {
      await logAiModelCall({
        layer: "diagnosis", model: "audit-test-model-a", provider: "openai",
        latencyMs: 100, success: true,
        usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cachedInputTokens: null, reasoningTokens: null },
      });
      await logAiModelCall({
        layer: "routing", model: "audit-test-model-b", provider: "openai",
        latencyMs: 200, success: false, errorCategory: "timeout",
      });
    });

    const summary = await getDailyUsageSummary(quotaDate);
    expect(summary.totalTurns).toBeGreaterThanOrEqual(1);
    expect(summary.modelCalls).toBeGreaterThanOrEqual(2);
    expect(summary.inputTokens).toBeGreaterThanOrEqual(1000);
    expect(summary.modelCallFailures).toBeGreaterThanOrEqual(1);

    const byModel = await getDailyUsageBreakdownByModel(quotaDate);
    const modelA = byModel.find(r => r.key === "audit-test-model-a");
    expect(modelA).toMatchObject({ modelCalls: 1, inputTokens: 1000, outputTokens: 100 });

    const byLayer = await getDailyUsageBreakdownByLayer(quotaDate);
    const routingLayer = byLayer.find(r => r.key === "routing");
    expect(routingLayer?.failures).toBeGreaterThanOrEqual(1);

    const byFactory = await getDailyUsageBreakdownByFactory(quotaDate);
    const thisFactory = byFactory.find(r => r.factoryId === factoryId);
    expect(thisFactory?.turns).toBeGreaterThanOrEqual(1);

    const byActor = await getDailyUsageBreakdownByActor(quotaDate);
    const thisActor = byActor.find(r => r.actorUserId === userId);
    expect(thisActor?.turns).toBeGreaterThanOrEqual(1);
  });

  it("H16 隱私稽核：aiUsageTurns／aiModelCalls／factoryAiDailyUsage 三張表的欄位都不含訊息內容／PII", async () => {
    const [turnCols]: any = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aiUsageTurns'"
    );
    const [callCols]: any = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aiModelCalls'"
    );
    const [counterCols]: any = await conn.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factoryAiDailyUsage'"
    );
    const forbidden = /content|message|prompt|reply|email|phone|summary|memory|text|body/i;
    const allColumns = [...turnCols, ...callCols, ...counterCols].map((r: any) => r.COLUMN_NAME as string);
    const suspicious = allColumns.filter(c => forbidden.test(c));
    expect(suspicious).toEqual([]);
  });
});

describeIfDb("aiUsageAudit（Phase 9.2 Dashboard D 系列）", () => {
  const quotaDate = getTaipeiQuotaDate();

  it("D1：今日 summary 正確反映 turns／model calls／tokens", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const reserved = await reserveAiTurn({
      factoryId, actorUserId: ownerId, conversationId: null,
      clientTurnId: "d1-turn", bypassQuota: false,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await runWithAiCallContext({ turnId: reserved.turnId, factoryId, actorUserId: ownerId }, () =>
      logAiModelCall({
        layer: "diagnosis", model: "d1-model", provider: "openai", latencyMs: 50, success: true,
        usage: { inputTokens: 200, outputTokens: 20, totalTokens: 220, cachedInputTokens: null, reasoningTokens: null },
      })
    );
    const summary = await getDailyUsageSummary(quotaDate);
    expect(summary.totalTurns).toBeGreaterThanOrEqual(1);
    expect(summary.quotaChargedTurns).toBeGreaterThanOrEqual(1);
    expect(summary.modelCalls).toBeGreaterThanOrEqual(1);
    expect(summary.inputTokens).toBeGreaterThanOrEqual(200);
  });

  it("D2／D13：factory usage 與 admin usage（無工廠／有工廠 bypass）正確分離，不混算", async () => {
    // 一般工廠 owner：真實扣額度的 turn。
    const factoryOwnerId = await mkUser();
    const factoryId = await mkFactory(factoryOwnerId);
    const factoryTurn = await reserveAiTurn({
      factoryId, actorUserId: factoryOwnerId, conversationId: null,
      clientTurnId: "d2-factory-turn", bypassQuota: false,
    });
    expect(factoryTurn.ok).toBe(true);

    // Admin，無工廠語境。
    const adminNoFactoryId = await mkUser();
    await setUserRole(adminNoFactoryId, "admin");
    const adminNoFactoryTurn = await reserveAiTurn({
      factoryId: null, actorUserId: adminNoFactoryId, conversationId: null,
      clientTurnId: "d2-admin-no-factory-turn", bypassQuota: true,
    });
    expect(adminNoFactoryTurn.ok).toBe(true);

    // Admin，本身也是另一間工廠的 owner，bypass 使用（quotaCharged=false, status=completed）。
    const adminWithFactoryId = await mkUser();
    await setUserRole(adminWithFactoryId, "admin");
    const adminOwnFactoryId = await mkFactory(adminWithFactoryId);
    const adminBypassTurn = await reserveAiTurn({
      factoryId: adminOwnFactoryId, actorUserId: adminWithFactoryId, conversationId: null,
      clientTurnId: "d2-admin-bypass-turn", bypassQuota: true,
    });
    expect(adminBypassTurn.ok).toBe(true);
    if (adminBypassTurn.ok) {
      await conn.execute("UPDATE aiUsageTurns SET status = 'completed' WHERE id = ?", [adminBypassTurn.turnId]);
    }

    const summary = await getDailyUsageSummary(quotaDate);
    expect(summary.adminNoFactoryTurns).toBeGreaterThanOrEqual(1);
    expect(summary.adminWithFactoryBypassTurns).toBeGreaterThanOrEqual(1);

    // 一般工廠的 usedTurns 只反映自己真實扣過額度的 turn，不含任何 admin 用量。
    const factoriesUsage = await getTodayActiveFactoriesUsage(quotaDate);
    const ownRow = factoriesUsage.find(f => f.factoryId === factoryId);
    expect(ownRow?.usedTurns).toBe(1);
  });

  it("D3：by model 聚合正確（不同 model 各自累加，互不干擾）", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const reserved = await reserveAiTurn({ factoryId, actorUserId: ownerId, conversationId: null, clientTurnId: "d3-turn", bypassQuota: false });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await runWithAiCallContext({ turnId: reserved.turnId, factoryId, actorUserId: ownerId }, async () => {
      await logAiModelCall({ layer: "diagnosis", model: "d3-model-a", provider: "openai", latencyMs: 10, success: true, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } });
      await logAiModelCall({ layer: "routing", model: "d3-model-b", provider: "openai", latencyMs: 10, success: true, usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 } });
    });
    const byModel = await getDailyUsageBreakdownByModel(quotaDate);
    expect(byModel.find(m => m.key === "d3-model-a")).toMatchObject({ modelCalls: 1, inputTokens: 100 });
    expect(byModel.find(m => m.key === "d3-model-b")).toMatchObject({ modelCalls: 1, inputTokens: 50 });
  });

  it("D4：by layer 聚合正確", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const reserved = await reserveAiTurn({ factoryId, actorUserId: ownerId, conversationId: null, clientTurnId: "d4-turn", bypassQuota: false });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await runWithAiCallContext({ turnId: reserved.turnId, factoryId, actorUserId: ownerId }, () =>
      logAiModelCall({ layer: "factorySemantic", model: "d4-model", provider: "openai", latencyMs: 10, success: true, usage: { inputTokens: 30, outputTokens: 3, totalTokens: 33 } })
    );
    // layer 是真實共用的 enum 值（不像 model 字串可以取獨一無二的測試專用
    // 名稱），用 >= 避免跟同一天其他測試的 factorySemantic 呼叫互相干擾。
    const byLayer = await getDailyUsageBreakdownByLayer(quotaDate);
    const row = byLayer.find(l => l.key === "factorySemantic");
    expect(row?.modelCalls ?? 0).toBeGreaterThanOrEqual(1);
    expect(row?.inputTokens ?? 0).toBeGreaterThanOrEqual(30);
  });

  it("D5：Top Factory 排序——usedTurns 高的工廠排前面", async () => {
    const ownerA = await mkUser();
    const factoryA = await mkFactory(ownerA);
    for (let i = 0; i < 3; i++) {
      const r = await reserveAiTurn({ factoryId: factoryA, actorUserId: ownerA, conversationId: null, clientTurnId: `d5-a-${i}`, bypassQuota: false });
      if (r.ok) await completeAiTurn(r.turnId, {});
    }
    const ownerB = await mkUser();
    const factoryB = await mkFactory(ownerB);
    await reserveAiTurn({ factoryId: factoryB, actorUserId: ownerB, conversationId: null, clientTurnId: "d5-b-0", bypassQuota: false });

    const rows = await getTodayActiveFactoriesUsage(quotaDate);
    const indexA = rows.findIndex(r => r.factoryId === factoryA);
    const indexB = rows.findIndex(r => r.factoryId === factoryB);
    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeGreaterThanOrEqual(0);
    expect(indexA).toBeLessThan(indexB);
  });

  it("D6：Actor 聚合正確", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const coManagerId = await mkUser();
    const d6r1 = await reserveAiTurn({ factoryId, actorUserId: ownerId, conversationId: null, clientTurnId: "d6-owner-turn", bypassQuota: false });
    if (d6r1.ok) await completeAiTurn(d6r1.turnId, {});
    const d6r2 = await reserveAiTurn({ factoryId, actorUserId: coManagerId, conversationId: null, clientTurnId: "d6-comgr-turn-1", bypassQuota: false });
    if (d6r2.ok) await completeAiTurn(d6r2.turnId, {});
    const d6r3 = await reserveAiTurn({ factoryId, actorUserId: coManagerId, conversationId: null, clientTurnId: "d6-comgr-turn-2", bypassQuota: false });
    if (d6r3.ok) await completeAiTurn(d6r3.turnId, {});
    const byActor = await getDailyUsageBreakdownByActor(quotaDate);
    expect(byActor.find(a => a.actorUserId === ownerId)?.turns).toBe(1);
    expect(byActor.find(a => a.actorUserId === coManagerId)?.turns).toBe(2);
  });

  it("D7：真的發生過 provider 呼叫後失敗的 turn 算進 failedTurns，且不退款", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const reserved = await reserveAiTurn({ factoryId, actorUserId: ownerId, conversationId: null, clientTurnId: "d7-turn", bypassQuota: false });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await runWithAiCallContext({ turnId: reserved.turnId, factoryId, actorUserId: ownerId }, () =>
      logAiModelCall({ layer: "diagnosis", model: "d7-model", provider: "openai", latencyMs: 10, success: true, usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } })
    );
    await failAiTurn(reserved.turnId);
    const summary = await getDailyUsageSummary(quotaDate);
    expect(summary.failedTurns).toBeGreaterThanOrEqual(1);
    const [row]: any = await conn.execute("SELECT quotaCharged FROM aiUsageTurns WHERE id = ?", [reserved.turnId]);
    expect(!!row[0].quotaCharged).toBe(true); // 已經真的發生過 provider 呼叫，不退款
  });

  it("D8：errorCategory breakdown 正確分類，不含 raw error message", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const reserved = await reserveAiTurn({ factoryId, actorUserId: ownerId, conversationId: null, clientTurnId: "d8-turn", bypassQuota: false });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    await runWithAiCallContext({ turnId: reserved.turnId, factoryId, actorUserId: ownerId }, async () => {
      await logAiModelCall({ layer: "diagnosis", model: "d8-model", provider: "openai", latencyMs: 10, success: false, errorCategory: "timeout" });
      await logAiModelCall({ layer: "routing", model: "d8-model", provider: "openai", latencyMs: 10, success: false, errorCategory: "timeout" });
      await logAiModelCall({ layer: "actionPlanner", model: "d8-model", provider: "openai", latencyMs: 10, success: false, errorCategory: "rate_limit" });
    });
    // 這支函式是全平台當日聚合（不是只算這個工廠的），跟同一個 oxm_test
    // 資料庫裡其他測試／先前殘留的 model call 共用同一個計數空間——用
    // >= 而非精確相等，避免跟其他測試的資料互相干擾（同一個手法本檔案其他
    // D 系列測試也是這樣寫）。
    const byError = await getDailyUsageBreakdownByErrorCategory(quotaDate);
    expect(byError.find(e => e.errorCategory === "timeout")?.calls ?? 0).toBeGreaterThanOrEqual(2);
    expect(byError.find(e => e.errorCategory === "rate_limit")?.calls ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("D9：counterMismatchCount 正確反映人為製造的 counter 不一致", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    await reserveAiTurn({ factoryId, actorUserId: ownerId, conversationId: null, clientTurnId: "d9-turn", bypassQuota: false });
    await conn.execute("UPDATE factoryAiDailyUsage SET usedTurns = 77 WHERE factoryId = ? AND quotaDate = ?", [factoryId, quotaDate]);
    const dashboard = await getAiUsageDashboard(quotaDate);
    expect(dashboard.counterMismatchCount).toBeGreaterThanOrEqual(1);
  });

  it("D16：多間工廠／多個 actor 的名稱都能在同一次呼叫正確批次解析（factory table 與 recent turns 都測）", async () => {
    const ownerA = await mkUser();
    const factoryA = await mkFactory(ownerA);
    const ownerB = await mkUser();
    const factoryB = await mkFactory(ownerB);
    await reserveAiTurn({ factoryId: factoryA, actorUserId: ownerA, conversationId: null, clientTurnId: "d16-a", bypassQuota: false });
    await reserveAiTurn({ factoryId: factoryB, actorUserId: ownerB, conversationId: null, clientTurnId: "d16-b", bypassQuota: false });

    const factoriesUsage = await getTodayActiveFactoriesUsage(quotaDate);
    const rowA = factoriesUsage.find(f => f.factoryId === factoryA);
    const rowB = factoriesUsage.find(f => f.factoryId === factoryB);
    expect(rowA?.factoryName).toMatch(/AUDIT_TEST/);
    expect(rowB?.factoryName).toMatch(/AUDIT_TEST/);
    expect(rowA?.factoryName).not.toBe(rowB?.factoryName);

    const recent = await getRecentAiUsageTurns({ quotaDate, page: 1, pageSize: 50 });
    const foundA = recent.items.find(t => t.factoryId === factoryA);
    const foundB = recent.items.find(t => t.factoryId === factoryB);
    expect(foundA?.factoryName).toBe(rowA?.factoryName);
    expect(foundB?.factoryName).toBe(rowB?.factoryName);
    expect(foundA?.actorName).toBeTruthy();
    expect(foundB?.actorName).toBeTruthy();
  });

  it("D17（實測發現的真實 bug 迴歸測試）：recentTurns／factories 的時間戳不會因為 DB session 時區不是 UTC 而疊加兩次位移", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    // 故意用明確的字面值（不是 NOW()）插入一筆已知的台灣牆上時間，模擬
    // 「這台 DB session 時區是 Asia/Taipei」的真實情境（見對話中「四十」
    // 實測發現：drizzle 讀 timestamp 欄位會把這個字面值直接當成 UTC 貼 Z，
    // 前端再用瀏覽器本地時區顯示一次，會疊加兩次 +8 小時）。
    const knownTaipeiWallClock = "2026-08-19 15:00:00";
    const [insertResult]: any = await conn.execute(
      `INSERT INTO aiUsageTurns
        (factoryId, actorUserId, conversationId, clientTurnId, quotaDate, status, quotaCharged, attemptCount, createdAt)
       VALUES (?, ?, NULL, 'd17-turn', ?, 'completed', TRUE, 1, ?)`,
      [factoryId, ownerId, quotaDate, knownTaipeiWallClock]
    );
    const turnId = insertResult.insertId;

    const recent = await getRecentAiUsageTurns({ quotaDate, page: 1, pageSize: 100 });
    const row = recent.items.find(t => t.turnId === turnId);
    expect(row).toBeTruthy();
    // 把回傳的 ISO 字串（應該已經是真正的 UTC）用 Asia/Taipei 時區轉回台灣
    // 牆上時間，必須跟一開始寫入的字面值完全一致——如果疊加了兩次 +8 小時，
    // 這裡會多出 8 小時，測試會抓到。
    const backToTaipei = new Date(row!.createdAt).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" });
    expect(backToTaipei).toBe(knownTaipeiWallClock);

    const factoriesUsage = await getTodayActiveFactoriesUsage(quotaDate);
    const factoryRow = factoriesUsage.find(f => f.factoryId === factoryId);
    expect(factoryRow?.lastUsedAt).toBeTruthy();
    const factoryBackToTaipei = new Date(factoryRow!.lastUsedAt!).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" });
    expect(factoryBackToTaipei).toBe(knownTaipeiWallClock);
  });
});

describeIfDb("getStaleStartedTurns（Phase 10.2 P1「十三、十四」，R7-R10：卡住的 AI Turn 偵測）", () => {
  const quotaDate = getTaipeiQuotaDate();

  // 直接寫入已知 createdAt（NOW() - INTERVAL X MINUTE，由 DB 自己算，避免
  // 跟 D17 一樣去猜 DB session 時區的位移量——這裡不需要驗證時間戳序列化，
  // 只需要一個「比門檻新／舊」的相對關係，讓 DB 自己算最不會出錯）。
  async function insertTurnMinutesAgo(
    factoryId: number,
    actorUserId: number,
    clientTurnId: string,
    minutesAgo: number,
    status: "started" | "completed" | "failed" = "started"
  ): Promise<void> {
    await conn.execute(
      `INSERT INTO aiUsageTurns
        (factoryId, actorUserId, conversationId, clientTurnId, quotaDate, status, quotaCharged, attemptCount, createdAt)
       VALUES (?, ?, NULL, ?, ?, ?, TRUE, 1, NOW() - INTERVAL ? MINUTE)`,
      [factoryId, actorUserId, clientTurnId, quotaDate, status, minutesAgo]
    );
  }

  it("R7：createdAt 在門檻內（比 10 分鐘新）的 started turn 不算卡住", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const before = (await getStaleStartedTurns(10)).count;
    await insertTurnMinutesAgo(factoryId, ownerId, "r7-fresh-started", 5);
    const after = (await getStaleStartedTurns(10)).count;
    expect(after).toBe(before);
  });

  it("R8：createdAt 超過門檻（比 10 分鐘舊）的 started turn 會被算進去", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const before = (await getStaleStartedTurns(10)).count;
    await insertTurnMinutesAgo(factoryId, ownerId, "r8-stale-started", 15);
    const after = (await getStaleStartedTurns(10)).count;
    expect(after).toBe(before + 1);
  });

  it("R9：completed／failed 的 turn 即使 createdAt 很舊，也不算卡住（只有 started 才算）", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    const before = (await getStaleStartedTurns(10)).count;
    await insertTurnMinutesAgo(factoryId, ownerId, "r9-old-completed", 20, "completed");
    await insertTurnMinutesAgo(factoryId, ownerId, "r9-old-failed", 20, "failed");
    const after = (await getStaleStartedTurns(10)).count;
    expect(after).toBe(before);
  });

  it("R10：Admin Dashboard 回傳的 staleStartedTurns 跟直接呼叫 getStaleStartedTurns() 一致（沒有跟著 quotaDate 篩選，見「十三」）", async () => {
    const ownerId = await mkUser();
    const factoryId = await mkFactory(ownerId);
    await insertTurnMinutesAgo(factoryId, ownerId, "r10-stale-started", 20);

    const direct = await getStaleStartedTurns();
    const dashboard = await getAiUsageDashboard(quotaDate);
    expect(dashboard.staleStartedTurns.count).toBe(direct.count);
    expect(dashboard.staleStartedTurns.thresholdMinutes).toBe(direct.thresholdMinutes);
    expect(dashboard.staleStartedTurns.count).toBeGreaterThanOrEqual(1);
  });
});

describeIfDb("getPermanentlyFailedConversationsCount（Phase 11.2「二十二、二十三」：永久失敗摘要可視性）", () => {
  const quotaDate = getTaipeiQuotaDate();

  async function mkConversation(userId: number, status: "active" | "failed" | "permanently_failed", retryCount = 0): Promise<number> {
    const [r] = await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO aiConversations (userId, factoryId, status, retryCount, lastMessageAt, createdAt) VALUES (?, NULL, ?, ?, NOW(), NOW())",
      [userId, status, retryCount]
    );
    return r.insertId;
  }

  it("只計算 status='permanently_failed'，不含 active／failed", async () => {
    const ownerId = await mkUser();
    const before = await getPermanentlyFailedConversationsCount();
    await mkConversation(ownerId, "active");
    await mkConversation(ownerId, "failed", 2);
    const afterActiveAndFailed = await getPermanentlyFailedConversationsCount();
    expect(afterActiveAndFailed).toBe(before);

    await mkConversation(ownerId, "permanently_failed", MAX_SUMMARY_RETRY_COUNT);
    const afterPermanent = await getPermanentlyFailedConversationsCount();
    expect(afterPermanent).toBe(before + 1);
  });

  it("Admin Dashboard 回傳的 permanentlyFailedSummaryCount 跟直接呼叫一致，且不跟著 quotaDate 篩選", async () => {
    const ownerId = await mkUser();
    await mkConversation(ownerId, "permanently_failed", MAX_SUMMARY_RETRY_COUNT);

    const direct = await getPermanentlyFailedConversationsCount();
    const dashboard = await getAiUsageDashboard(quotaDate);
    expect(dashboard.permanentlyFailedSummaryCount).toBe(direct);
    expect(dashboard.permanentlyFailedSummaryCount).toBeGreaterThanOrEqual(1);
  });
});
