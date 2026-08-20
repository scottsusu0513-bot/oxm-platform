import "dotenv/config";
import { getRawPool, getActiveFactoryAffiliationDetail } from "../db";

/**
 * Phase 11.2（見對話中「十二～十四、三十四、三十五」）：一次性、可安全重跑的
 * 資料整理腳本，把現有 userId-scoped 的 aiEnterpriseMemories 轉成
 * factory-scoped 之前的必要前置步驟——在 schema 真正被
 * 0088_ai_enterprise_memory_factory_scope.sql 改成 UNIQUE(factoryId) NOT NULL
 * 之前，必須先確保表裡沒有 NULL factoryId、也沒有兩筆 row 指向同一個
 * factoryId，否則那支 migration 的 ALTER 會直接失敗。
 *
 * 分類規則（刻意保守，見對話中「我偏好：保守處理，只有明確可證明相符才
 * migrate」）：
 * - MIGRATE：這筆 row 的 factoryId 非 null，且與這個 userId「目前」唯一的
 *   approved affiliation（owner 或 active co-manager，見
 *   db.getActiveFactoryAffiliationDetail，跟 entitlement.ts／
 *   factoryContext.ts 完全同一套 source of truth）完全相符。
 * - QUARANTINE（其餘全部）：
 *   - no_factory_id：這筆 row 的 factoryId 本來就是 null——沒有任何已記錄的
 *     對應可以驗證，即使這個 user 現在剛好只有一個 approved affiliation，也
 *     不能「看起來合理」就自動 migrate（見對話中「保守處理」的明確指示）。
 *   - no_current_affiliation：這個 user 現在完全沒有任何 approved
 *     affiliation。
 *   - affiliation_mismatch：這筆 row 的 factoryId 跟這個 user 現在的
 *     approved affiliation 不是同一間工廠——這正是 Phase 11.1 Audit 抓到的
 *     P0 case（user 換過工廠）。
 *
 * 同一個 factoryId 如果同時有多筆 MIGRATE row（例如 owner 跟 co-manager 各自
 * 累積過一份 legacy memory，見「三十四」）：deterministic 合併——依
 * lastInteractionAt 由舊到新排序，逐筆用 `[userId=U]` 標註 provenance 串接
 * summaryText（截斷到 500 字，截斷本身也是 deterministic），
 * hasMeaningfulBusinessInfo 取 OR，lastInteractionAt／
 * lastInteractionHadMeaningfulInfo／sourceConversationId／lastActorUserId 一律
 * 取「lastInteractionAt 最新那筆」的值——不依賴、不呼叫任何 LLM，確保這支
 * 腳本本身可以無限安全重跑，不會因為 provider 額度或網路而失敗。
 *
 * Idempotency（見「三十五」）：每次執行都是「重新從 aiEnterpriseMemories 目前
 * 的即時狀態」出發做分類，不是套用固定 snapshot——處理完的 row 會被
 * UPDATE（合併後的目標 row）或 DELETE（已併入別筆、或已被隔離的 row），第二
 * 次執行時這些 row 已經不在來源表裡，天然不會重複處理；quarantine 表額外用
 * `originalId` 做 idempotent 保護，避免極端情況下重複插入同一筆歷史紀錄。
 */

export interface LegacyMemoryRow {
  id: number;
  userId: number;
  factoryId: number | null;
  summaryText: string;
  hasMeaningfulBusinessInfo: boolean;
  lastInteractionAt: Date;
  lastInteractionHadMeaningfulInfo: boolean;
  sourceConversationId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type QuarantineReason = "no_factory_id" | "no_current_affiliation" | "affiliation_mismatch";

export type ClassificationResult =
  | { outcome: "migrate"; factoryId: number }
  | { outcome: "quarantine"; reason: QuarantineReason };

export interface ReconciliationReport {
  totalRowsExamined: number;
  migratedAsIs: number;
  mergedGroups: number;
  mergedRowsAbsorbed: number;
  quarantined: number;
  quarantinedByReason: Record<QuarantineReason, number>;
  resultingFactoryScopedRows: number;
}

const SUMMARY_MAX_LENGTH = 500;

/**
 * Phase 11.2（見對話中「十二、三十三：Legacy Migration Tests L1-L4」）：純函式
 * 分類決策，跟實際 DB 讀寫（quarantineRow／UPDATE／DELETE）分離，才能不依賴
 * 真實資料庫、直接用 plain object 單元測試每一種分類情境——這點很重要，因為
 * migration 0088 之後 aiEnterpriseMemories 本身已經是 NOT NULL + UNIQUE
 * (factoryId)，沒有辦法再真的插入「NULL factoryId」或「重複 factoryId」這種
 * legacy 形狀的 row 去做整合測試，只能單元測試這個純函式本身的決策邏輯。
 */
export function classifyLegacyRow(
  row: Pick<LegacyMemoryRow, "factoryId">,
  currentAffiliation: { factoryId: number } | null
): ClassificationResult {
  if (row.factoryId == null) {
    return { outcome: "quarantine", reason: "no_factory_id" };
  }
  if (!currentAffiliation) {
    return { outcome: "quarantine", reason: "no_current_affiliation" };
  }
  if (currentAffiliation.factoryId !== row.factoryId) {
    return { outcome: "quarantine", reason: "affiliation_mismatch" };
  }
  return { outcome: "migrate", factoryId: row.factoryId };
}

/**
 * Phase 11.2（見對話中「三十四：Two Legacy Memories Same Factory」）：同一
 * factoryId 有多筆 legacy row 時的 deterministic 合併——依 lastInteractionAt
 * 由舊到新排序，逐筆標註 `[userId=U]` provenance 串接，截斷到 schema 的 500
 * 字上限（截斷本身也是 deterministic，同樣輸入永遠得到同樣輸出）。刻意不呼叫
 * 任何 LLM，確保這支腳本本身可以無限安全重跑，不會因為 provider 額度或網路
 * 問題而失敗。
 */
export function buildDeterministicMergedSummary(group: LegacyMemoryRow[]): string {
  const sorted = [...group].sort((a, b) => a.lastInteractionAt.getTime() - b.lastInteractionAt.getTime());
  const parts = sorted.map(r => `[userId=${r.userId}] ${r.summaryText}`);
  return parts.join(" | ").slice(0, SUMMARY_MAX_LENGTH);
}

export async function reconcileEnterpriseMemoryFactoryScope(): Promise<ReconciliationReport> {
  const pool = await getRawPool();
  const conn = await pool.getConnection();
  const report: ReconciliationReport = {
    totalRowsExamined: 0,
    migratedAsIs: 0,
    mergedGroups: 0,
    mergedRowsAbsorbed: 0,
    quarantined: 0,
    quarantinedByReason: { no_factory_id: 0, no_current_affiliation: 0, affiliation_mismatch: 0 },
    resultingFactoryScopedRows: 0,
  };

  try {
    // 見對話中「三十五：Migration Idempotency」：故意用 lastActorUserId AS
    // userId 讀取——migration 0088 已經把欄位從 userId 改名成
    // lastActorUserId，這支腳本設計上必須在「schema 還沒改名前」與「schema
    // 已經改名後」都能安全執行同一套邏輯（不能假設自己一定只會在改名前跑
    // 一次），用別名讓下面所有邏輯完全不用關心目前實際欄位叫什麼名字。
    const [rows]: any = await conn.execute(
      "SELECT id, lastActorUserId AS userId, factoryId, summaryText, hasMeaningfulBusinessInfo, lastInteractionAt, lastInteractionHadMeaningfulInfo, sourceConversationId, createdAt, updatedAt FROM aiEnterpriseMemories ORDER BY id"
    );
    const legacyRows = rows as LegacyMemoryRow[];
    report.totalRowsExamined = legacyRows.length;

    const migrateByFactoryId = new Map<number, LegacyMemoryRow[]>();

    for (const row of legacyRows) {
      const affiliation = row.factoryId == null ? null : await getActiveFactoryAffiliationDetail(row.userId);
      const classification = classifyLegacyRow(row, affiliation);
      if (classification.outcome === "quarantine") {
        await quarantineRow(conn, row, classification.reason, report);
        continue;
      }
      const group = migrateByFactoryId.get(classification.factoryId) ?? [];
      group.push(row);
      migrateByFactoryId.set(classification.factoryId, group);
    }

    for (const [factoryId, group] of Array.from(migrateByFactoryId.entries())) {
      if (group.length === 1) {
        report.migratedAsIs += 1;
        continue;
      }
      // 見對話中「三十四」：deterministic merge，不呼叫 LLM。
      const sorted = [...group].sort((a, b) => a.lastInteractionAt.getTime() - b.lastInteractionAt.getTime());
      const latest = sorted[sorted.length - 1];
      const keepRow = [...group].sort((a, b) => a.id - b.id)[0];
      const mergedSummary = buildDeterministicMergedSummary(group);
      const mergedHasInfo = group.some((r: LegacyMemoryRow) => r.hasMeaningfulBusinessInfo);

      await conn.execute(
        `UPDATE aiEnterpriseMemories SET
          summaryText = ?, hasMeaningfulBusinessInfo = ?, lastInteractionAt = ?,
          lastInteractionHadMeaningfulInfo = ?, sourceConversationId = ?, userId = ?
        WHERE id = ?`,
        [
          mergedSummary,
          mergedHasInfo,
          latest.lastInteractionAt,
          latest.lastInteractionHadMeaningfulInfo,
          latest.sourceConversationId,
          latest.userId,
          keepRow.id,
        ]
      );

      const absorbedIds = group.filter((r: LegacyMemoryRow) => r.id !== keepRow.id).map((r: LegacyMemoryRow) => r.id);
      if (absorbedIds.length > 0) {
        await conn.query(`DELETE FROM aiEnterpriseMemories WHERE id IN (?)`, [absorbedIds]);
      }

      report.mergedGroups += 1;
      report.mergedRowsAbsorbed += absorbedIds.length;
      void factoryId;
    }

    const [[countRow]]: any = await conn.execute("SELECT COUNT(*) as cnt FROM aiEnterpriseMemories");
    report.resultingFactoryScopedRows = Number(countRow.cnt);

    return report;
  } finally {
    conn.release();
  }
}

async function quarantineRow(
  conn: any,
  row: LegacyMemoryRow,
  reason: QuarantineReason,
  report: ReconciliationReport
): Promise<void> {
  const [[existing]]: any = await conn.execute(
    "SELECT id FROM aiEnterpriseMemoriesLegacyQuarantine WHERE originalId = ? LIMIT 1",
    [row.id]
  );
  if (!existing) {
    await conn.execute(
      `INSERT INTO aiEnterpriseMemoriesLegacyQuarantine (
        originalId, userId, factoryId, summaryText, hasMeaningfulBusinessInfo,
        lastInteractionAt, lastInteractionHadMeaningfulInfo, sourceConversationId,
        createdAt, updatedAt, quarantineReason, quarantinedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        row.id, row.userId, row.factoryId, row.summaryText, row.hasMeaningfulBusinessInfo,
        row.lastInteractionAt, row.lastInteractionHadMeaningfulInfo, row.sourceConversationId,
        row.createdAt, row.updatedAt, reason,
      ]
    );
  }
  await conn.execute("DELETE FROM aiEnterpriseMemories WHERE id = ?", [row.id]);
  report.quarantined += 1;
  report.quarantinedByReason[reason] += 1;
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  /reconcileEnterpriseMemoryFactoryScope\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  reconcileEnterpriseMemoryFactoryScope()
    .then((report) => {
      // 只印統計數字，不含任何企業摘要內容或使用者資料。
      console.log(`[OXM-AI][background][layer:memoryReconciliation] done: ${JSON.stringify(report)}`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("[OXM-AI][background][layer:memoryReconciliation] failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
