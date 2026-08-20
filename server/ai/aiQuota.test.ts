/**
 * Phase 8.1 Q 系列：reserveAiTurn／completeAiTurn／failAiTurn 真實 DB 整合
 * 測試（見對話中「三、四、五、六、十」）。同樣沿用
 * factory-uniqueness-concurrent.test.ts 的 fixture 慣例——quota race 這種
 * P0 正確性只有打真實 DB 的 FOR UPDATE 才測得出來，mock 不出這種行為。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { reserveAiTurn, completeAiTurn, failAiTurn, checkFactoryAiQuota } from "./aiQuota";
import { getTaipeiQuotaDate } from "./taipeiTime";
import { AI_FACTORY_DAILY_TURN_LIMIT } from "../../shared/ai/aiQuotaConfig";
import { logAiModelCall } from "./aiUsageLogging";
import { runWithAiCallContext } from "./aiCallContext";

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let conn: mysql.PoolConnection;

const PREFIX = "[QUOTA_TEST]";
let userCounter = 0;
let factoryCounter = 0;

async function mkUser(): Promise<number> {
  userCounter += 1;
  const email = `quota_test_${userCounter}@oxm.test`;
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, email, name, isFactoryOwner, role, lastSignedIn) VALUES (?, ?, ?, FALSE, 'user', NOW())",
    [email, email, email]
  );
  return r.insertId;
}

async function mkFactory(ownerId: number): Promise<number> {
  factoryCounter += 1;
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO factories (ownerId, name, industry, mfgModes, region, capitalLevel, address, status, operationStatus, certified, subIndustry, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'normal', FALSE, ?, NOW(), NOW())",
    [ownerId, `${PREFIX} F${factoryCounter}`, JSON.stringify(["電子"]), JSON.stringify(["ODM"]), "新竹市", "<1000萬", "新竹市", "[]"]
  );
  return r.insertId;
}

async function mkCoManager(factoryId: number, userId: number, invitedBy: number): Promise<void> {
  await conn.execute(
    "INSERT INTO factoryCoManagers (factoryId, userId, invitedBy, createdAt) VALUES (?, ?, ?, NOW())",
    [factoryId, userId, invitedBy]
  );
}

async function mkConversation(userId: number, factoryId: number): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO aiConversations (userId, factoryId, status, lastMessageAt, createdAt) VALUES (?, ?, 'active', NOW(), NOW())",
    [userId, factoryId]
  );
  return r.insertId;
}

async function cleanup() {
  await conn.execute("DELETE FROM factoryCoManagers WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiModelCalls WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiUsageTurns WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiUsageTurns WHERE actorUserId IN (SELECT id FROM users WHERE email LIKE ?)", ["quota_test_%@oxm.test"]);
  await conn.execute("DELETE FROM aiConversations WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM factoryAiDailyUsage WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM factories WHERE name LIKE ?", [PREFIX + "%"]);
  await conn.execute("DELETE FROM users WHERE email LIKE ?", ["quota_test_%@oxm.test"]);
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

describeIfDb("reserveAiTurn / completeAiTurn / failAiTurn（Phase 8.1 Q 系列）", () => {
  let userId: number;
  let factoryId: number;

  beforeEach(async () => {
    userId = await mkUser();
    factoryId = await mkFactory(userId);
  });

  it("Q1：全新 turn 成功保留，quotaCharged=true，counter 從 0 變 1", async () => {
    const result = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q1-turn", bypassQuota: false,
    });
    expect(result).toMatchObject({ ok: true, quotaCharged: true, isRetry: false });
    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(1);
  });

  it("Q2：連續保留滿 20 筆後，第 21 筆回傳 quota_exhausted，counter 停在上限", async () => {
    // Phase 12.2：per-factory concurrency guard 一次只允許一筆 started
    // turn，這裡每筆保留後立刻 complete（模擬真實一輪對話很快跑完），才能
    // 連續測滿 20 筆而不被 busy guard 擋下。
    for (let i = 0; i < AI_FACTORY_DAILY_TURN_LIMIT; i++) {
      const r = await reserveAiTurn({
        factoryId, actorUserId: userId, conversationId: null,
        clientTurnId: `q2-turn-${i}`, bypassQuota: false,
      });
      expect(r.ok).toBe(true);
      if (r.ok) await completeAiTurn(r.turnId, {});
    }
    const overflow = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q2-turn-overflow", bypassQuota: false,
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.reason).toBe("quota_exhausted");
    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(AI_FACTORY_DAILY_TURN_LIMIT);
  });

  it("Q3（P0）：額度只剩 1 筆時，兩個同時送出的請求只有一個成功，counter 精準停在上限，不會變成 21", async () => {
    const quotaDate = getTaipeiQuotaDate();
    await conn.execute(
      "INSERT INTO factoryAiDailyUsage (factoryId, quotaDate, usedTurns) VALUES (?, ?, ?)",
      [factoryId, quotaDate, AI_FACTORY_DAILY_TURN_LIMIT - 1]
    );
    const [r1, r2] = await Promise.all([
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "q3-race-a", bypassQuota: false }),
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "q3-race-b", bypassQuota: false }),
    ]);
    const oks = [r1, r2].filter(r => r.ok);
    const fails = [r1, r2].filter(r => !r.ok);
    expect(oks.length).toBe(1);
    expect(fails.length).toBe(1);
    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(AI_FACTORY_DAILY_TURN_LIMIT);
  });

  it("Q4：同一個 clientTurnId 重試不會重複扣 quota，只累加 attemptCount", async () => {
    const first = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q4-turn", bypassQuota: false,
    });
    expect(first.ok).toBe(true);
    const retry = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q4-turn", bypassQuota: false,
    });
    expect(retry).toMatchObject({ ok: true, isRetry: true, quotaCharged: true });
    if (first.ok && retry.ok) expect(retry.turnId).toBe(first.turnId);
    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(1);
    const [rows]: any = await conn.execute("SELECT attemptCount FROM aiUsageTurns WHERE id = ?", [(first as any).turnId]);
    expect(rows[0].attemptCount).toBe(2);
  });

  it("Q5：provider 呼叫前就失敗（沒有任何 aiModelCalls row）→ failAiTurn 退款，retry 會拿到全新的 quota 檢查", async () => {
    const first = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q5-turn", bypassQuota: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await failAiTurn(first.turnId);

    const afterFail = await checkFactoryAiQuota(factoryId);
    expect(afterFail.used).toBe(0);

    const retry = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q5-turn", bypassQuota: false,
    });
    expect(retry).toMatchObject({ ok: true, isRetry: true, quotaCharged: true });
    const afterRetry = await checkFactoryAiQuota(factoryId);
    expect(afterRetry.used).toBe(1);
  });

  it("Q6：已經發生過至少一次 provider 呼叫後失敗 → 不退款（真實成本已產生）", async () => {
    const first = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q6-turn", bypassQuota: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await conn.execute(
      "INSERT INTO aiModelCalls (turnId, factoryId, actorUserId, layer, model, provider, latencyMs, success, createdAt) VALUES (?, ?, ?, 'diagnosis', 'gpt-test', 'openai', 100, TRUE, NOW())",
      [first.turnId, factoryId, userId]
    );
    await failAiTurn(first.turnId);
    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(1);
    const [rows]: any = await conn.execute("SELECT quotaCharged FROM aiUsageTurns WHERE id = ?", [first.turnId]);
    expect(!!rows[0].quotaCharged).toBe(true);
  });

  it("Q7：admin bypass（bypassQuota=true）不扣 counter，quotaCharged 恆為 false", async () => {
    const result = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q7-turn", bypassQuota: true,
    });
    expect(result).toMatchObject({ ok: true, quotaCharged: false });
    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(0);
  });

  it("Q8：admin 無工廠語境（factoryId=null）可以保留 turn，完全不觸碰 factoryAiDailyUsage", async () => {
    const result = await reserveAiTurn({
      factoryId: null, actorUserId: userId, conversationId: null,
      clientTurnId: "q8-turn", bypassQuota: true,
    });
    expect(result).toMatchObject({ ok: true, quotaCharged: false });
    const [rows]: any = await conn.execute("SELECT factoryId FROM aiUsageTurns WHERE id = ?", [(result as any).turnId]);
    expect(rows[0].factoryId).toBeNull();
  });

  it("Q9：completeAiTurn 寫入 intent／resourceTarget／conversationId，不影響 quotaCharged", async () => {
    const reserved = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "q9-turn", bypassQuota: false,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    const conversationId = await mkConversation(userId, factoryId);
    await completeAiTurn(reserved.turnId, { intent: "factory_search", resourceTarget: null, conversationId });
    const [rows]: any = await conn.execute(
      "SELECT status, intent, conversationId, quotaCharged FROM aiUsageTurns WHERE id = ?",
      [reserved.turnId]
    );
    expect(rows[0].status).toBe("completed");
    expect(rows[0].intent).toBe("factory_search");
    expect(rows[0].conversationId).toBe(conversationId);
    expect(!!rows[0].quotaCharged).toBe(true);
  });

  it("Q10：checkFactoryAiQuota 對從未使用過的工廠回傳 used=0／exhausted=false", async () => {
    const status = await checkFactoryAiQuota(factoryId);
    expect(status).toMatchObject({ used: 0, exhausted: false, limit: AI_FACTORY_DAILY_TURN_LIMIT });
  });

  it("Q11：不同工廠的每日額度互相獨立（工廠 A 用滿不影響工廠 B）", async () => {
    const otherUserId = await mkUser();
    const otherFactoryId = await mkFactory(otherUserId);
    for (let i = 0; i < AI_FACTORY_DAILY_TURN_LIMIT; i++) {
      const r = await reserveAiTurn({
        factoryId, actorUserId: userId, conversationId: null,
        clientTurnId: `q11-a-${i}`, bypassQuota: false,
      });
      if (r.ok) await completeAiTurn(r.turnId, {});
    }
    const otherResult = await reserveAiTurn({
      factoryId: otherFactoryId, actorUserId: otherUserId, conversationId: null,
      clientTurnId: "q11-b-1", bypassQuota: false,
    });
    expect(otherResult.ok).toBe(true);
  });
});

describeIfDb("Phase 8.2 Hardening（H 系列）", () => {
  let userId: number;
  let factoryId: number;

  beforeEach(async () => {
    userId = await mkUser();
    factoryId = await mkFactory(userId);
  });

  it("H2：admin 無工廠語境（factoryId=null）的 retry 正確去重，不會因 MySQL NULL 唯一性語意產生重複 row", async () => {
    const first = await reserveAiTurn({
      factoryId: null, actorUserId: userId, conversationId: null,
      clientTurnId: "h2-admin-null-turn", bypassQuota: true,
    });
    expect(first.ok).toBe(true);
    const retry = await reserveAiTurn({
      factoryId: null, actorUserId: userId, conversationId: null,
      clientTurnId: "h2-admin-null-turn", bypassQuota: true,
    });
    expect(retry).toMatchObject({ ok: true, isRetry: true, quotaCharged: false });
    if (first.ok && retry.ok) expect(retry.turnId).toBe(first.turnId);

    const [rows]: any = await conn.execute(
      "SELECT COUNT(*) as cnt FROM aiUsageTurns WHERE factoryId IS NULL AND actorUserId = ? AND clientTurnId = ?",
      [userId, "h2-admin-null-turn"]
    );
    expect(rows[0].cnt).toBe(1);
  });

  it("H3（Phase 12.2 起行為改變，見對話「六」）：同一工廠、同一使用者、兩個瀏覽器分頁（兩個不同 clientTurnId）同時送出——per-factory concurrency guard 生效後只有一個成功，另一個回傳 ai_busy，counter 只 +1，不是 Phase 8.2 當初的「都成功、+2」", async () => {
    const [r1, r2] = await Promise.all([
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "h3-tab-a", bypassQuota: false }),
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "h3-tab-b", bypassQuota: false }),
    ]);
    const oks = [r1, r2].filter(r => r.ok);
    const busy = [r1, r2].filter(r => !r.ok && r.reason === "ai_busy");
    expect(oks.length).toBe(1);
    expect(busy.length).toBe(1);
    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(1);
  });

  it("H4：owner 與 co-manager（兩個不同 actorUserId）在額度只剩 1 筆時同時送出，只有一個成功，counter 精準停在上限", async () => {
    const coManagerUserId = await mkUser();
    await mkCoManager(factoryId, coManagerUserId, userId);
    const quotaDate = getTaipeiQuotaDate();
    await conn.execute(
      "INSERT INTO factoryAiDailyUsage (factoryId, quotaDate, usedTurns) VALUES (?, ?, ?)",
      [factoryId, quotaDate, AI_FACTORY_DAILY_TURN_LIMIT - 1]
    );
    const [ownerResult, coManagerResult] = await Promise.all([
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "h4-owner-turn", bypassQuota: false }),
      reserveAiTurn({ factoryId, actorUserId: coManagerUserId, conversationId: null, clientTurnId: "h4-comanager-turn", bypassQuota: false }),
    ]);
    const oks = [ownerResult, coManagerResult].filter(r => r.ok);
    const fails = [ownerResult, coManagerResult].filter(r => !r.ok);
    expect(oks.length).toBe(1);
    expect(fails.length).toBe(1);
    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(AI_FACTORY_DAILY_TURN_LIMIT);
  });

  it("H5（P0 fail-closed）：quota DB 操作本身失敗（FK 違反等真實 DB 錯誤）時，reserveAiTurn 必須 throw，不能默默放行", async () => {
    // 用不存在的 factoryId 讓 INSERT INTO aiUsageTurns 的 FK constraint 真的失敗，
    // 驗證是不是「DB 出錯 = 直接拒絕」而不是被吞掉、回傳 ok:true。
    const nonExistentFactoryId = 999999999;
    await expect(
      reserveAiTurn({
        factoryId: nonExistentFactoryId, actorUserId: userId, conversationId: null,
        clientTurnId: "h5-fk-violation", bypassQuota: false,
      })
    ).rejects.toThrow();
  });

  it("H6（fail-open）：usage analytics 寫入失敗（FK 違反）時，logAiModelCall 不能 throw——只影響成本紀錄，不影響使用者拿到的 AI 回覆", async () => {
    const nonExistentTurnId = 999999999;
    await expect(
      runWithAiCallContext({ turnId: nonExistentTurnId, factoryId, actorUserId: userId }, () =>
        logAiModelCall({ layer: "diagnosis", model: "h6-test-model", provider: "openai", latencyMs: 10, success: true })
      )
    ).resolves.toBeUndefined();
  });

  it("H10：Retry 保留舊嘗試與新嘗試各自產生的 model call 成本，不會被覆寫或遺失", async () => {
    const first = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "h10-retry-turn", bypassQuota: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Attempt 1：只有 diagnosis 成功，routing 之前假設 network 中斷（不模擬失敗細節，
    // 只驗證這一次呼叫產生的 aiModelCalls row 會被保留）。
    await runWithAiCallContext({ turnId: first.turnId, factoryId, actorUserId: userId }, () =>
      logAiModelCall({ layer: "diagnosis", model: "h10-model", provider: "openai", latencyMs: 100, success: true,
        usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550, cachedInputTokens: null, reasoningTokens: null } })
    );

    // Retry：同一個 clientTurnId，quotaCharged 已經是 true，只累加 attemptCount，
    // 不新增第二筆 aiUsageTurns row。
    const retry = await reserveAiTurn({
      factoryId, actorUserId: userId, conversationId: null,
      clientTurnId: "h10-retry-turn", bypassQuota: false,
    });
    expect(retry).toMatchObject({ ok: true, isRetry: true, turnId: first.turnId });

    // Attempt 2：diagnosis 與 routing 都成功。
    await runWithAiCallContext({ turnId: first.turnId, factoryId, actorUserId: userId }, async () => {
      await logAiModelCall({ layer: "diagnosis", model: "h10-model", provider: "openai", latencyMs: 90, success: true,
        usage: { inputTokens: 510, outputTokens: 55, totalTokens: 565, cachedInputTokens: null, reasoningTokens: null } });
      await logAiModelCall({ layer: "routing", model: "h10-model", provider: "openai", latencyMs: 200, success: true,
        usage: { inputTokens: 900, outputTokens: 80, totalTokens: 980, cachedInputTokens: null, reasoningTokens: null } });
    });

    const [rows]: any = await conn.execute(
      "SELECT layer, inputTokens FROM aiModelCalls WHERE turnId = ? ORDER BY id ASC",
      [first.turnId]
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r: any) => r.layer)).toEqual(["diagnosis", "diagnosis", "routing"]);
    expect(rows.map((r: any) => r.inputTokens)).toEqual([500, 510, 900]);

    const [turnRows]: any = await conn.execute("SELECT attemptCount FROM aiUsageTurns WHERE id = ?", [first.turnId]);
    expect(turnRows[0].attemptCount).toBe(2);

    const status = await checkFactoryAiQuota(factoryId);
    expect(status.used).toBe(1); // 只扣一次，不因為 retry 或多筆 model call 而重複扣
  });
});
