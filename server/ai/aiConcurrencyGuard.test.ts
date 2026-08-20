/**
 * Phase 12.2 C 系列：per-factory concurrency burst guard（見對話中
 * 「六~十三」）真實 DB 整合測試。沿用 aiQuota.test.ts 的 fixture 慣例——
 * concurrency race 這種正確性只有打真實 DB 的 FOR UPDATE 才測得出來。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import { reserveAiTurn, completeAiTurn } from "./aiQuota";

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let conn: mysql.PoolConnection;

const PREFIX = "[CONCURRENCY_TEST]";
let userCounter = 0;
let factoryCounter = 0;

async function mkUser(): Promise<number> {
  userCounter += 1;
  const email = `concurrency_test_${userCounter}@oxm.test`;
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

async function cleanup() {
  await conn.execute("DELETE FROM aiModelCalls WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiUsageTurns WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM aiUsageTurns WHERE actorUserId IN (SELECT id FROM users WHERE email LIKE ?)", ["concurrency_test_%@oxm.test"]);
  await conn.execute("DELETE FROM factoryAiDailyUsage WHERE factoryId IN (SELECT id FROM factories WHERE name LIKE ?)", [PREFIX + "%"]);
  await conn.execute("DELETE FROM factories WHERE name LIKE ?", [PREFIX + "%"]);
  await conn.execute("DELETE FROM users WHERE email LIKE ?", ["concurrency_test_%@oxm.test"]);
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

describeIfDb("per-factory concurrency burst guard（Phase 12.2 C 系列）", () => {
  let userId: number;
  let factoryId: number;

  beforeEach(async () => {
    userId = await mkUser();
    factoryId = await mkFactory(userId);
  });

  it("C1：同一工廠、兩個全新 clientTurnId 同時送出——一個成功、一個 ai_busy", async () => {
    const [r1, r2] = await Promise.all([
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c1-a", bypassQuota: false }),
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c1-b", bypassQuota: false }),
    ]);
    const oks = [r1, r2].filter(r => r.ok);
    const busy = [r1, r2].filter(r => !r.ok && r.reason === "ai_busy");
    expect(oks.length).toBe(1);
    expect(busy.length).toBe(1);
  });

  it("C2：同一個 clientTurnId 重試不會被自己的 started turn 擋成 ai_busy", async () => {
    const first = await reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c2-turn", bypassQuota: false });
    expect(first.ok).toBe(true);
    const retry = await reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c2-turn", bypassQuota: false });
    expect(retry).toMatchObject({ ok: true, isRetry: true });
  });

  it("C3：不同工廠各自獨立，互不阻擋", async () => {
    const otherOwnerId = await mkUser();
    const otherFactoryId = await mkFactory(otherOwnerId);
    const [r1, r2] = await Promise.all([
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c3-a", bypassQuota: false }),
      reserveAiTurn({ factoryId: otherFactoryId, actorUserId: otherOwnerId, conversationId: null, clientTurnId: "c3-b", bypassQuota: false }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("C4：owner 與 co-manager（不同 actorUserId）同一工廠——concurrency key 是 factoryId，一樣只有一個成功", async () => {
    const coManagerId = await mkUser();
    await conn.execute(
      "INSERT INTO factoryCoManagers (factoryId, userId, invitedBy, createdAt) VALUES (?, ?, ?, NOW())",
      [factoryId, coManagerId, userId]
    );
    const [ownerResult, coManagerResult] = await Promise.all([
      reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c4-owner", bypassQuota: false }),
      reserveAiTurn({ factoryId, actorUserId: coManagerId, conversationId: null, clientTurnId: "c4-comgr", bypassQuota: false }),
    ]);
    const oks = [ownerResult, coManagerResult].filter(r => r.ok);
    const busy = [ownerResult, coManagerResult].filter(r => !r.ok && r.reason === "ai_busy");
    expect(oks.length).toBe(1);
    expect(busy.length).toBe(1);
    await conn.execute("DELETE FROM factoryCoManagers WHERE factoryId = ? AND userId = ?", [factoryId, coManagerId]);
  });

  it("C5：Admin 無工廠語境（factoryId=null）——concurrency key 是 actorUserId，同一個 actor 同時兩個新 turn 只有一個成功", async () => {
    const [r1, r2] = await Promise.all([
      reserveAiTurn({ factoryId: null, actorUserId: userId, conversationId: null, clientTurnId: "c5-a", bypassQuota: true }),
      reserveAiTurn({ factoryId: null, actorUserId: userId, conversationId: null, clientTurnId: "c5-b", bypassQuota: true }),
    ]);
    const oks = [r1, r2].filter(r => r.ok);
    const busy = [r1, r2].filter(r => !r.ok && r.reason === "ai_busy");
    expect(oks.length).toBe(1);
    expect(busy.length).toBe(1);
  });

  it("C6：兩個不同的 Admin 無工廠語境使用者各自獨立，互不阻擋", async () => {
    const otherAdminId = await mkUser();
    const [r1, r2] = await Promise.all([
      reserveAiTurn({ factoryId: null, actorUserId: userId, conversationId: null, clientTurnId: "c6-a", bypassQuota: true }),
      reserveAiTurn({ factoryId: null, actorUserId: otherAdminId, conversationId: null, clientTurnId: "c6-b", bypassQuota: true }),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("C7：超過 10 分鐘的 stale started turn 不會擋新 turn", async () => {
    const stale = await reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c7-stale", bypassQuota: false });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    // 模擬 server crash 留下的 stale started：把 createdAt 往回撥到 11 分鐘前。
    await conn.execute("UPDATE aiUsageTurns SET createdAt = (NOW() - INTERVAL 11 MINUTE) WHERE id = ?", [stale.turnId]);

    const fresh = await reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c7-fresh", bypassQuota: false });
    expect(fresh.ok).toBe(true);
  });

  it("C8：busy 的請求完全不扣 quota", async () => {
    const first = await reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c8-a", bypassQuota: false });
    expect(first.ok).toBe(true);
    const busy = await reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c8-b", bypassQuota: false });
    expect(busy).toMatchObject({ ok: false, reason: "ai_busy" });
    const [rows]: any = await conn.execute(
      "SELECT usedTurns FROM factoryAiDailyUsage WHERE factoryId = ?",
      [factoryId]
    );
    expect(rows[0]?.usedTurns ?? 0).toBe(1); // 只有 first 那筆真的扣了額度
  });

  it("C9：busy 的請求完全不建立 aiUsageTurns row（不是 provider 呼叫，是完全沒有進到 INSERT）", async () => {
    const first = await reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c9-a", bypassQuota: false });
    expect(first.ok).toBe(true);
    const busy = await reserveAiTurn({ factoryId, actorUserId: userId, conversationId: null, clientTurnId: "c9-b", bypassQuota: false });
    expect(busy).toMatchObject({ ok: false, reason: "ai_busy" });
    const [rows]: any = await conn.execute(
      "SELECT COUNT(*) as cnt FROM aiUsageTurns WHERE factoryId = ? AND clientTurnId = ?",
      [factoryId, "c9-b"]
    );
    expect(rows[0].cnt).toBe(0);
    if (first.ok) await completeAiTurn(first.turnId, {});
  });
});
