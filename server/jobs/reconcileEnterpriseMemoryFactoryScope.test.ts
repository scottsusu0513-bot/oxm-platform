/**
 * Phase 11.2「三十三：Legacy Migration Tests」驗證。
 *
 * L1-L4 是 classifyLegacyRow() 的純函式單元測試（不連 DB）——這是刻意的
 * 設計選擇：migration 0088 之後 aiEnterpriseMemories 已經是
 * NOT NULL + UNIQUE(factoryId)，沒有辦法再真的對這張表插入「factoryId 是
 * NULL」或「兩筆同 factoryId」這種 legacy 形狀的資料去做整合測試，只能單元
 * 測試分類決策本身的邏輯（見 reconcileEnterpriseMemoryFactoryScope.ts 檔頭
 * 說明）。
 *
 * L5 是 buildDeterministicMergedSummary() 的純函式單元測試（多筆 legacy row
 * 合併成一筆時的 deterministic 合併策略）。
 *
 * 最後補一個真實 DB 的 happy-path 整合測試：驗證
 * reconcileEnterpriseMemoryFactoryScope() 對「目前資料已經全部乾淨（每筆都
 * 對得上目前 approved affiliation）」的狀態是安全、idempotent 的 no-op——這是
 * migration 0088 之後這張表唯一還能被真實建構出來的狀態，也是本輪已經對
 * 真實本機 dev DB（oxm）實際跑過兩次、確認過完全相同結果的那個路徑（見
 * Phase 11.2 report N/Q）。
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  classifyLegacyRow,
  buildDeterministicMergedSummary,
  reconcileEnterpriseMemoryFactoryScope,
  type LegacyMemoryRow,
} from "./reconcileEnterpriseMemoryFactoryScope";
import { createTestFactory, deleteTestFactory } from "../_core/financeTestFixtures";
import { upsertEnterpriseMemory, getEnterpriseMemory } from "../ai/memory";

function fakeLegacyRow(overrides: Partial<LegacyMemoryRow> & { userId: number }): LegacyMemoryRow {
  return {
    id: 1,
    factoryId: null,
    summaryText: "測試摘要",
    hasMeaningfulBusinessInfo: true,
    lastInteractionAt: new Date("2026-01-01T00:00:00Z"),
    lastInteractionHadMeaningfulInfo: true,
    sourceConversationId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("classifyLegacyRow — 純函式分類決策（L1-L4）", () => {
  it("L1：factoryId 非 null 且與目前唯一 approved affiliation 相符 → migrate", () => {
    const row = fakeLegacyRow({ userId: 1, factoryId: 100 });
    const result = classifyLegacyRow(row, { factoryId: 100 });
    expect(result).toEqual({ outcome: "migrate", factoryId: 100 });
  });

  it("L2：factoryId 與目前 approved affiliation 不一致（換過工廠）→ quarantine/affiliation_mismatch", () => {
    const row = fakeLegacyRow({ userId: 1, factoryId: 100 });
    const result = classifyLegacyRow(row, { factoryId: 200 });
    expect(result).toEqual({ outcome: "quarantine", reason: "affiliation_mismatch" });
  });

  it("L3：factoryId 本來就是 null → quarantine/no_factory_id，即使傳入看起來相符的 affiliation 也不猜測", () => {
    const row = fakeLegacyRow({ userId: 1, factoryId: null });
    // 故意傳入「看起來唯一、合理」的 affiliation，驗證分類函式不會因為
    // 「看起來合理」就自動判定為 migrate（見對話中「保守處理」的明確指示）。
    const result = classifyLegacyRow(row, { factoryId: 999 });
    expect(result).toEqual({ outcome: "quarantine", reason: "no_factory_id" });
  });

  it("L4：user 現在完全沒有任何 approved affiliation → quarantine/no_current_affiliation", () => {
    const row = fakeLegacyRow({ userId: 1, factoryId: 100 });
    const result = classifyLegacyRow(row, null);
    expect(result).toEqual({ outcome: "quarantine", reason: "no_current_affiliation" });
  });
});

describe("buildDeterministicMergedSummary — 純函式合併策略（L5：Two Legacy Memories Same Factory）", () => {
  it("依 lastInteractionAt 由舊到新排序，逐筆標註 provenance 串接，不呼叫任何 LLM", () => {
    const owner = fakeLegacyRow({
      id: 1, userId: 10, factoryId: 100,
      summaryText: "CNC 車銑複合；老客戶流失。",
      lastInteractionAt: new Date("2026-01-01T00:00:00Z"),
    });
    const coManager = fakeLegacyRow({
      id: 2, userId: 20, factoryId: 100,
      summaryText: "已導入 ERP。",
      lastInteractionAt: new Date("2026-02-01T00:00:00Z"),
    });
    const merged = buildDeterministicMergedSummary([coManager, owner]); // 故意傳入非排序順序，驗證函式自己排序
    expect(merged).toBe("[userId=10] CNC 車銑複合；老客戶流失。 | [userId=20] 已導入 ERP。");
  });

  it("結果截斷到 500 字上限（deterministic：同樣輸入永遠得到同樣輸出）", () => {
    const longText = "字".repeat(400);
    const row1 = fakeLegacyRow({ id: 1, userId: 10, factoryId: 100, summaryText: longText, lastInteractionAt: new Date("2026-01-01T00:00:00Z") });
    const row2 = fakeLegacyRow({ id: 2, userId: 20, factoryId: 100, summaryText: longText, lastInteractionAt: new Date("2026-02-01T00:00:00Z") });
    const merged = buildDeterministicMergedSummary([row1, row2]);
    expect(merged.length).toBe(500);
    // 重跑一次同樣輸入，結果必須完全一致（idempotent，不含任何隨機性/時間依賴）。
    const mergedAgain = buildDeterministicMergedSummary([row1, row2]);
    expect(mergedAgain).toBe(merged);
  });
});

describe("reconcileEnterpriseMemoryFactoryScope — 真實 DB happy-path 整合測試（資料已乾淨時安全 no-op）", () => {
  const runId = `reconcile-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdUserIds: number[] = [];
  const createdFactoryIds: number[] = [];

  async function mkUserWithApprovedFactory(): Promise<{ userId: number; factoryId: number }> {
    const conn = await getDb();
    if (!conn) throw new Error("no db");
    const openId = `test-${runId}-${createdUserIds.length}`;
    await conn.execute(sql`INSERT INTO users (openId, name, email) VALUES (${openId}, ${`Reconcile Test ${runId}`}, ${`${openId}@example.test`})`);
    const [rows] = await conn.execute(sql`SELECT id FROM users WHERE openId = ${openId} LIMIT 1`) as unknown as [{ id: number }[], unknown];
    const userId = rows[0]!.id;
    createdUserIds.push(userId);
    const factoryId = await createTestFactory(userId, `[RECONCILE_TEST] ${runId}-${userId}`);
    createdFactoryIds.push(factoryId);
    return { userId, factoryId };
  }

  afterAll(async () => {
    const conn = await getDb();
    if (!conn) return;
    for (const factoryId of createdFactoryIds) await deleteTestFactory(factoryId);
    if (createdUserIds.length > 0) {
      await conn.execute(sql`DELETE FROM users WHERE id IN (${sql.join(createdUserIds, sql`, `)})`);
    }
  });

  it("已經是乾淨的 factory-scoped 資料（factoryId 對得上目前 approved affiliation）→ 不隔離、不合併，內容原樣保留", async () => {
    const { factoryId, userId } = await mkUserWithApprovedFactory();
    await upsertEnterpriseMemory({
      factoryId, lastActorUserId: userId,
      summaryText: "已經是 factory-scoped 的正常資料", hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: true, sourceConversationId: 1,
    });

    // Phase 12.2（見對話「二十一、二十二」：test isolation flake 修正）：
    // reconcileEnterpriseMemoryFactoryScope() 設計上就是對整張
    // aiEnterpriseMemories 表做全表掃描（見對話「三十五：Migration
    // Idempotency」，這是正確、必要的 production 行為，不能只掃這個測試自己
    // 建立的 factory）。在 vitest 平行 worker 下，同一個 oxm_test 隨時可能有
    // 其他測試檔案正在做 factory 狀態轉換（approve/delist/刪除）而讓別的
    // row 暫時真的符合 quarantine 條件——這是那些 row 的真實、正確分類結果，
    // 不是這支腳本的 bug。原本斷言 report.quarantined===0／
    // mergedGroups===0 是對「全表」的斷言，會被其他測試檔案的合法活動連帶
    // 觸發、間歇性失敗。改成只驗證「這個測試自己建立的這筆 row」本身沒有被
    // 隔離、沒有被誤合併——getEnterpriseMemory(factoryId) 拿到的內容原封不動
    // 就是這筆 row 沒有被 quarantine（quarantine 會把它從
    // aiEnterpriseMemories 移除）、也沒有被合併覆寫的直接證明，不需要依賴
    // 全域計數。
    const report = await reconcileEnterpriseMemoryFactoryScope();
    expect(report.totalRowsExamined).toBeGreaterThanOrEqual(1);

    const memory = await getEnterpriseMemory(factoryId);
    expect(memory?.summaryText).toBe("已經是 factory-scoped 的正常資料");
  });

  it("Q：Migration Idempotency——對同一批已乾淨資料重跑兩次，結果完全一致，不重複處理", async () => {
    const { factoryId, userId } = await mkUserWithApprovedFactory();
    await upsertEnterpriseMemory({
      factoryId, lastActorUserId: userId,
      summaryText: "idempotency 測試資料", hasMeaningfulBusinessInfo: true,
      lastInteractionHadMeaningfulInfo: true, sourceConversationId: 1,
    });

    // 同上：不斷言全域 quarantined／mergedGroups 計數（見上一個 it() 的說明），
    // 只驗證這個測試自己的 row 在連跑兩次之後內容仍然完全一致、沒有被動到。
    await reconcileEnterpriseMemoryFactoryScope();
    await reconcileEnterpriseMemoryFactoryScope();

    const memory = await getEnterpriseMemory(factoryId);
    expect(memory?.summaryText).toBe("idempotency 測試資料"); // 沒有被第二次執行意外改動
  });
});
