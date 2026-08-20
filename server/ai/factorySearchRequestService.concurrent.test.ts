/**
 * Phase 10.2 P0：applyFactorySourcingDecision 併發 idempotency 測試（R1-R4，見
 * 「七、併發測試」）。
 *
 * 背景：原本的 applyFactorySourcingDecision 是「SELECT 既有 pending →
 * UPDATE／INSERT」的 check-then-act，沒有交易也沒有鎖。client 端網路失敗會在
 * server 端仍在執行同一次請求時就先解除 pending、允許使用者按 Retry（見
 * client/src/contexts/aiChatSendController.ts 的 performSend），而 server 端
 * 完全沒有 AbortSignal，兩次執行會真的同時跑——這個測試用兩條真實的併發
 * async 呼叫重現這個 race，驗證修好之後的版本（交易 + FOR UPDATE 鎖住一定
 * 存在的 aiConversations parent row）不會再產生重複的人工協尋 request。
 *
 * 沿用 server/factory-uniqueness-concurrent.test.ts 的併發測試慣例：走真實本機
 * DB、用 Promise.allSettled 讓兩個 async 鏈同時發起，檢查最終 DB 狀態。
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const mockCreatePlatformNotifications = vi.fn();
vi.mock("../notifications", () => ({
  createPlatformNotifications: (...args: unknown[]) => mockCreatePlatformNotifications(...args),
}));

const mockGetAdminUserIds = vi.fn();
vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return { ...actual, getAdminUserIds: (...args: unknown[]) => mockGetAdminUserIds(...args) };
});

import { applyFactorySourcingDecision, claimAndNotifyFactorySearchRequest } from "./factorySearchRequestService";
import type { AiFactorySearchRequest } from "../../drizzle/schema";

const DB_URL = process.env.DATABASE_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

let pool: mysql.Pool;
let setupConn: mysql.PoolConnection;
const PREFIX = "[AFSR_CONCURRENT_TEST]";
let userSeq = 0;

async function mkUser(): Promise<number> {
  userSeq += 1;
  const email = `afsr_concurrent_test_${Date.now()}_${userSeq}@oxm.test`;
  const [r] = await setupConn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, email, name, isFactoryOwner, role, lastSignedIn) VALUES (?, ?, ?, FALSE, 'user', NOW())",
    [email, email, `${PREFIX} ${email}`]
  );
  return r.insertId;
}

async function mkConversation(userId: number): Promise<number> {
  const [r] = await setupConn.execute<mysql.ResultSetHeader>(
    "INSERT INTO aiConversations (userId, factoryId, status, lastMessageAt, createdAt) VALUES (?, NULL, 'active', NOW(), NOW())",
    [userId]
  );
  return r.insertId;
}

function decisionParams(conversationId: number, userId: number, variant: string) {
  return {
    userId,
    conversationId,
    factoryId: null,
    mainIndustries: ["金屬加工"],
    regions: ["台中市"],
    coreCapabilities: ["五軸加工"],
    candidateCount: 10,
    directCapabilityMatchCount: 0,
    missingCapabilities: ["五軸加工"],
    requestedMatchCount: null,
    plannerReason: `併發測試 ${variant}`,
  };
}

async function cleanup() {
  await setupConn.execute("DELETE FROM aiFactorySearchRequests WHERE requestSummary LIKE ?", ["%併發測試%"]);
  await setupConn.execute("DELETE FROM aiConversations WHERE userId IN (SELECT id FROM users WHERE email LIKE ?)", ["afsr_concurrent_test_%@oxm.test"]);
  await setupConn.execute("DELETE FROM users WHERE email LIKE ?", ["afsr_concurrent_test_%@oxm.test"]);
}

beforeAll(async () => {
  if (!DB_URL) return;
  pool = mysql.createPool(DB_URL);
  setupConn = await pool.getConnection();
  await cleanup();
});

afterAll(async () => {
  if (!DB_URL) return;
  await cleanup();
  setupConn.release();
  await pool.end();
});

describeIfDb("applyFactorySourcingDecision：併發 idempotency（Phase 10.2 P0，R1-R4）", () => {
  it("R1：同一 conversation 被併發呼叫兩次（模擬同一輪 turn 的 Retry race）→ 最終只有一筆 active request", async () => {
    const userId = await mkUser();
    const conversationId = await mkConversation(userId);

    const results = await Promise.allSettled([
      applyFactorySourcingDecision(decisionParams(conversationId, userId, "R1-A")),
      applyFactorySourcingDecision(decisionParams(conversationId, userId, "R1-B")),
    ]);

    // 兩次呼叫都必須「安全完成」（不能有非預期的 throw——check-then-act race
    // 修好前後都不應該讓呼叫端看到例外，這裡驗證交易化之後依然如此）。
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length, `不應該有非預期的例外: ${JSON.stringify(rejected)}`).toBe(0);

    const requestIds = results.map((r) => (r as PromiseFulfilledResult<{ requestId: number }>).value.requestId);
    // 兩次呼叫的 requestId 必須相同（第二次是「命中既有 pending 並更新」，不是新建一筆）。
    expect(requestIds[0]).toBe(requestIds[1]);

    const [rows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT id, status FROM aiFactorySearchRequests WHERE conversationId = ?",
      [conversationId]
    );
    expect(rows.length, "同一 conversation 最終應該只有一筆 request row").toBe(1);
    expect(rows[0]!.status).toBe("pending");
  }, 30000);

  it("R2（retry-pipeline 語意，見「八」）：同一使用者 turn 的原始請求＋Retry 同時抵達 → 不產生重複 sourcing", async () => {
    const userId = await mkUser();
    const conversationId = await mkConversation(userId);

    // 模擬「原始請求仍在 server 端執行」與「client 因網路逾時觸發 Retry、
    // server 端收到第二次呼叫」——兩者對 chatService 而言就是對同一
    // conversationId 呼叫 applyFactorySourcingDecision 兩次，不需要真的跑一次
    // 完整 ai.chat HTTP round trip 才能驗證這一層的 idempotency。
    const [originalResult, retryResult] = await Promise.allSettled([
      applyFactorySourcingDecision(decisionParams(conversationId, userId, "R2-original")),
      applyFactorySourcingDecision(decisionParams(conversationId, userId, "R2-retry")),
    ]);

    expect(originalResult.status).toBe("fulfilled");
    expect(retryResult.status).toBe("fulfilled");

    const [rows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM aiFactorySearchRequests WHERE conversationId = ?",
      [conversationId]
    );
    expect(rows.length, "原始請求 + Retry 最終只能有一筆 sourcing request").toBe(1);
  }, 30000);

  it("R3：兩個不同 conversation 併發呼叫 → 各自獨立產生自己的 request，互不影響", async () => {
    const userId = await mkUser();
    const conversationA = await mkConversation(userId);
    const conversationB = await mkConversation(userId);

    const results = await Promise.allSettled([
      applyFactorySourcingDecision(decisionParams(conversationA, userId, "R3-A")),
      applyFactorySourcingDecision(decisionParams(conversationB, userId, "R3-B")),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const [rowsA] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM aiFactorySearchRequests WHERE conversationId = ?",
      [conversationA]
    );
    const [rowsB] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM aiFactorySearchRequests WHERE conversationId = ?",
      [conversationB]
    );
    expect(rowsA.length).toBe(1);
    expect(rowsB.length).toBe(1);
    expect(rowsA[0]!.id).not.toBe(rowsB[0]!.id);
  }, 30000);

  it("R4：既有 CAS+dedupeKey 通知機制沿用不變——併發 claim+notify 同一筆 request 只成功通知一次", async () => {
    mockCreatePlatformNotifications.mockReset();
    mockCreatePlatformNotifications.mockResolvedValue(undefined);
    mockGetAdminUserIds.mockReset();
    mockGetAdminUserIds.mockResolvedValue([999901]);

    const userId = await mkUser();
    const conversationId = await mkConversation(userId);
    const { requestId } = await applyFactorySourcingDecision(decisionParams(conversationId, userId, "R4"));

    const [rows] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM aiFactorySearchRequests WHERE id = ?",
      [requestId]
    );
    const request = rows[0] as unknown as AiFactorySearchRequest;

    const outcomes = await Promise.allSettled([
      claimAndNotifyFactorySearchRequest(request),
      claimAndNotifyFactorySearchRequest(request),
    ]);
    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);

    // 兩次併發 claim，只有一次真的贏得 CAS 並送出通知——不會產生兩批通知。
    expect(mockCreatePlatformNotifications).toHaveBeenCalledTimes(1);

    const [after] = await setupConn.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM aiFactorySearchRequests WHERE id = ?",
      [requestId]
    );
    expect(after[0]!.status).toBe("notified");
  }, 30000);
});
