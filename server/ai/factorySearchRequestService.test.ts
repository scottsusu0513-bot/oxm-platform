/**
 * Phase 6A.1：Factory Search 人工協尋——lifecycle / trigger / CAS / retry /
 * finalize summary clause 驗證。連本機測試 DB，只 mock 站內通知的底層
 * createPlatformNotifications（避免測試套件真的寫入 communityNotifications、
 * 也才能控制「這次通知成功／失敗」來測 retry），以及 getAdminUserIds（固定
 * 一組假 admin id，不依賴真實 ADMIN_WHITELIST_EMAILS 環境設定）。
 */
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";

const mockCreatePlatformNotifications = vi.fn();
vi.mock("../notifications", () => ({
  createPlatformNotifications: (...args: unknown[]) => mockCreatePlatformNotifications(...args),
}));

const mockGetAdminUserIds = vi.fn();
vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>();
  return { ...actual, getAdminUserIds: (...args: unknown[]) => mockGetAdminUserIds(...args) };
});

import { getDb } from "../db";
import { createTestFactory } from "../_core/financeTestFixtures";
import {
  applyFactorySourcingDecision,
  resolvePendingRequestIfSuperseded,
  cancelFactorySearchRequestForConversation,
  getPendingFactorySearchRequestForConversation,
  claimAndNotifyFactorySearchRequest,
  finalizeFactorySearchRequestForConversation,
  buildFinalizeSummaryClause,
  retryPendingFactorySearchNotifications,
} from "./factorySearchRequestService";
import { aiFactorySearchRequests } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const runId = `afsr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userSeq = 0;
let convSeq = 1000000 + Math.floor(Math.random() * 100000);
const cleanupUserIds: number[] = [];
const cleanupFactoryIds: number[] = [];

async function makeUser(): Promise<number> {
  userSeq += 1;
  const conn = await getDb();
  if (!conn) throw new Error("no db");
  const openId = `test-${runId}-${userSeq}`;
  await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`AFSR ${runId}-${userSeq}`}, ${`${runId}-${userSeq}@example.test`})`);
  const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
  const id = rows[0]!.id;
  cleanupUserIds.push(id);
  return id;
}

function nextConversationId(): number {
  convSeq += 1;
  return convSeq;
}

beforeEach(() => {
  mockCreatePlatformNotifications.mockReset();
  mockCreatePlatformNotifications.mockResolvedValue(undefined);
  mockGetAdminUserIds.mockReset();
  mockGetAdminUserIds.mockResolvedValue([999901, 999902]);
});

afterAll(async () => {
  const conn = await getDb();
  if (!conn) return;
  for (const id of cleanupFactoryIds) await conn.execute(sql`DELETE FROM factories WHERE id = ${id}`);
  for (const id of cleanupUserIds) {
    await conn.execute(sql`DELETE FROM aiFactorySearchRequests WHERE userId = ${id}`);
    await conn.execute(sql`DELETE FROM users WHERE id = ${id}`);
  }
});

describe("applyFactorySourcingDecision：純持久化，不做 trigger 判斷（trigger 判斷已經移到 actionPlanner.ts）", () => {
  it("沒有既有 pending → 新增一筆 pending，欄位如實記錄，reason 併入 summary", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    const { requestId } = await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["台中市"], coreCapabilities: ["五軸加工"],
      candidateCount: 30, directCapabilityMatchCount: 0, missingCapabilities: ["五軸加工"],
      requestedMatchCount: null,
      plannerReason: "目前候選都沒有五軸加工的直接證據",
    });
    const row = await getPendingFactorySearchRequestForConversation(conversationId);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(requestId);
    expect(row!.status).toBe("pending");
    expect(row!.candidateCount).toBe(30); // 30 家完整保留在快照裡，不是被清成 0
    expect(row!.requestSummary).toContain("五軸加工");
    expect(row!.requestSummary).toContain("目前候選都沒有五軸加工的直接證據");
  });

  it("已有既有 pending → 更新同一筆，不新增第二筆", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    const first = await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["澎湖縣"], coreCapabilities: ["CNC"],
      candidateCount: 0, directCapabilityMatchCount: 0, missingCapabilities: [],
      requestedMatchCount: null, plannerReason: "澎湖沒有符合條件的候選",
    });
    const second = await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["金門縣"], coreCapabilities: ["CNC"],
      candidateCount: 0, directCapabilityMatchCount: 0, missingCapabilities: [],
      requestedMatchCount: null, plannerReason: "金門也沒有符合條件的候選",
    });
    expect(second.requestId).toBe(first.requestId);
    const row = await getPendingFactorySearchRequestForConversation(conversationId);
    expect((row!.hardFiltersJson as { regions: string[] }).regions).toEqual(["金門縣"]);
  });

  it("requestedMatchCount 如實記錄（已經是呼叫端／Action Planner 換算好的絕對值）", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["台中市"], coreCapabilities: ["五軸加工"],
      candidateCount: 10, directCapabilityMatchCount: 1, missingCapabilities: [],
      requestedMatchCount: 3, plannerReason: "使用者希望有三家可以比較，目前只確認 1 家",
    });
    const row = await getPendingFactorySearchRequestForConversation(conversationId);
    expect(row!.requestedMatchCount).toBe(3);
    expect(row!.directCapabilityMatchCount).toBe(1);
  });
});

describe("resolvePendingRequestIfSuperseded：新搜尋已解決舊 pending 時的自動收尾（bookkeeping，非 AI 判斷）", () => {
  it("有既有 pending → 轉為 cancelled", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    const { requestId } = await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["澎湖縣"], coreCapabilities: ["CNC"],
      candidateCount: 0, directCapabilityMatchCount: 0, missingCapabilities: [],
      requestedMatchCount: null, plannerReason: "x",
    });
    await resolvePendingRequestIfSuperseded(conversationId);
    const db = await getDb();
    const [row] = await db!.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, requestId)).limit(1);
    expect(row!.status).toBe("cancelled");
  });

  it("沒有既有 pending → 安全無操作（不拋錯）", async () => {
    const conversationId = nextConversationId();
    await expect(resolvePendingRequestIfSuperseded(conversationId)).resolves.toBeUndefined();
  });
});

describe("使用者取消（CASE 4／十一 Ownership）", () => {
  it("CASE 4：pending 後取消 → cancelledAt 有值，status=cancelled", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["澎湖縣"], coreCapabilities: [],
      candidateCount: 0, directCapabilityMatchCount: 0, missingCapabilities: [],
      requestedMatchCount: null, plannerReason: "測試用理由",
    });
    const cancelled = await cancelFactorySearchRequestForConversation({ conversationId, userId });
    expect(cancelled).toBe(true);
    expect(await getPendingFactorySearchRequestForConversation(conversationId)).toBeNull();
  });

  it("CASE 11：User B 嘗試取消 User A 的 request → 失敗，request 仍是 pending", async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const conversationId = nextConversationId();
    await applyFactorySourcingDecision({
      userId: userA, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["澎湖縣"], coreCapabilities: [],
      candidateCount: 0, directCapabilityMatchCount: 0, missingCapabilities: [],
      requestedMatchCount: null, plannerReason: "測試用理由",
    });
    const result = await cancelFactorySearchRequestForConversation({ conversationId, userId: userB });
    expect(result).toBe(false);
    const row = await getPendingFactorySearchRequestForConversation(conversationId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending");
  });
});

describe("Admin Notification（CASE 5／9／10）", () => {
  it("CASE 5：claim + notify 成功 → notified，通知內容包含必要欄位", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    const { requestId } = await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["台中市"], coreCapabilities: ["五軸加工"],
      candidateCount: 30, directCapabilityMatchCount: 0, missingCapabilities: ["五軸加工"],
      requestedMatchCount: null, plannerReason: "測試用理由",
    });
    const db = await getDb();
    const [request] = await db!.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, requestId!)).limit(1);

    const outcome = await claimAndNotifyFactorySearchRequest(request!);
    expect(outcome).toBe("notified");
    expect(mockCreatePlatformNotifications).toHaveBeenCalledTimes(1);
    const notifs = mockCreatePlatformNotifications.mock.calls[0][0] as Array<{ message: string; recipientUserId: number; dedupeKey: string }>;
    expect(notifs.length).toBe(2); // 兩個假 admin
    expect(notifs[0].message).toContain(`User ID：${userId}`);
    expect(notifs[0].message).toContain("五軸加工");
    expect(notifs[0].message).toContain(`Request ID：#${requestId}`);
    expect(notifs[0].dedupeKey).toBe(`ai_factory_search_request:${requestId}:u999901`);

    const [after] = await db!.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, requestId!)).limit(1);
    expect(after!.status).toBe("notified");
    expect(after!.notifiedAt).not.toBeNull();
  });

  it("CASE 9／10：notify 第一次失敗 → notification_failed，retry job 之後成功 → notified，且只通知一次成功批次", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    const { requestId } = await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["台中市"], coreCapabilities: ["五軸加工"],
      candidateCount: 30, directCapabilityMatchCount: 0, missingCapabilities: ["五軸加工"],
      requestedMatchCount: null, plannerReason: "測試用理由",
    });
    const db = await getDb();

    mockCreatePlatformNotifications.mockRejectedValueOnce(new Error("simulated notify failure"));
    const [request] = await db!.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, requestId!)).limit(1);
    const firstOutcome = await claimAndNotifyFactorySearchRequest(request!);
    expect(firstOutcome).toBe("failed");

    const [afterFail] = await db!.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, requestId!)).limit(1);
    expect(afterFail!.status).toBe("notification_failed");
    expect(afterFail!.notificationRetryCount).toBe(1);
    expect(afterFail!.lastNotificationError).toContain("simulated notify failure");

    // request 沒有消失，資料仍然完整——retry job 可以獨立重新處理，不需要重讀 conversation。
    mockCreatePlatformNotifications.mockResolvedValue(undefined);
    const retryResult = await retryPendingFactorySearchNotifications();
    expect(retryResult.succeeded).toBeGreaterThanOrEqual(1);

    const [afterRetry] = await db!.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, requestId!)).limit(1);
    expect(afterRetry!.status).toBe("notified");

    // 第二次 retry：已經 notified，不應該再被 retry job 撿到、也不會再呼叫一次通知。
    mockCreatePlatformNotifications.mockClear();
    const secondRetry = await retryPendingFactorySearchNotifications();
    const notifiedAgain = mockCreatePlatformNotifications.mock.calls.some(
      call => (call[0] as Array<{ dedupeKey: string }>).some(n => n.dedupeKey.startsWith(`ai_factory_search_request:${requestId}:`))
    );
    expect(notifiedAgain).toBe(false);
    void secondRetry;
  });
});

describe("Cancel / Notify Race（CASE 12）", () => {
  it("先 cancel 再嘗試 finalize → finalize 不通知，最終狀態是 cancelled", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["台中市"], coreCapabilities: ["五軸加工"],
      candidateCount: 30, directCapabilityMatchCount: 0, missingCapabilities: ["五軸加工"],
      requestedMatchCount: null, plannerReason: "測試用理由",
    });
    await cancelFactorySearchRequestForConversation({ conversationId, userId });

    const finalized = await finalizeFactorySearchRequestForConversation(conversationId);
    expect(finalized!.status).toBe("cancelled");
    expect(mockCreatePlatformNotifications).not.toHaveBeenCalled();
  });

  it("先 claim+notify 成功、之後才嘗試 cancel → cancel 失敗（不能同時 cancelled+notified）", async () => {
    const userId = await makeUser();
    const conversationId = nextConversationId();
    const { requestId } = await applyFactorySourcingDecision({
      userId, conversationId, factoryId: null,
      mainIndustries: ["金屬加工"], regions: ["台中市"], coreCapabilities: ["五軸加工"],
      candidateCount: 30, directCapabilityMatchCount: 0, missingCapabilities: ["五軸加工"],
      requestedMatchCount: null, plannerReason: "測試用理由",
    });
    const db = await getDb();
    const [request] = await db!.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, requestId!)).limit(1);
    const outcome = await claimAndNotifyFactorySearchRequest(request!);
    expect(outcome).toBe("notified");

    const cancelled = await cancelFactorySearchRequestForConversation({ conversationId, userId });
    expect(cancelled).toBe(false);

    const [after] = await db!.select().from(aiFactorySearchRequests).where(eq(aiFactorySearchRequests.id, requestId!)).limit(1);
    expect(after!.status).toBe("notified"); // 沒有變成 cancelled，也沒有殘留兩種狀態同時成立
  });
});

describe("buildFinalizeSummaryClause（見「二十九、三十、三十一」）", () => {
  it("沒有 request → null", () => {
    expect(buildFinalizeSummaryClause(null)).toBeNull();
  });

  it("pending/notified 狀態 → 帶「結果未知」的敘述", () => {
    const clause = buildFinalizeSummaryClause({
      id: 1, userId: 1, factoryId: null, conversationId: 1, status: "notified",
      hardFiltersJson: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
      rankingSignalsJson: ["五軸加工"], coreCapabilitiesJson: ["五軸加工"],
      requestSummary: "x", candidateCount: 30, directCapabilityMatchCount: 0, requestedMatchCount: null,
      notifiedAt: new Date(), cancelledAt: null, notificationClaimedAt: new Date(),
      notificationRetryCount: 0, lastNotificationError: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any);
    expect(clause).toContain("台中市");
    expect(clause).toContain("金屬加工");
    expect(clause).toContain("結果未知");
  });

  it("cancelled 狀態 → 明確表示不需要，不能出現「結果未知」（避免下次誤以為還在找，見三十一）", () => {
    const clause = buildFinalizeSummaryClause({
      id: 1, userId: 1, factoryId: null, conversationId: 1, status: "cancelled",
      hardFiltersJson: { mainIndustries: ["金屬加工"], regions: ["台中市"] },
      rankingSignalsJson: ["五軸加工"], coreCapabilitiesJson: ["五軸加工"],
      requestSummary: "x", candidateCount: 30, directCapabilityMatchCount: 0, requestedMatchCount: null,
      notifiedAt: null, cancelledAt: new Date(), notificationClaimedAt: null,
      notificationRetryCount: 0, lastNotificationError: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any);
    expect(clause).toContain("不需要人工協尋");
    expect(clause).not.toContain("結果未知");
  });
});
