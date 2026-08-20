import "dotenv/config";
import {
  listFailedAssessments,
  listStalePendingAssessments,
  createPendingAssessmentIfMissing,
  markAssessmentFailed,
  incrementAssessmentRetryCount,
} from "../ai/caseAssessmentService";
import { listSubmittedHandoffContextsMissingAssessment } from "../ai/handoffContextService";
import { buildRetryInitiateParams, regenerateCaseAssessment } from "../ai/caseAssessment";
import type { HandoffEligibleServiceKey } from "../../shared/ai/handoffServices";
import type { AiCaseAssessment } from "../../drizzle/schema";

export interface RetryFailedAiCaseAssessmentsResult {
  attempted: number;
  succeeded: number;
  stillFailing: number;
}

/**
 * 可靠性修正（見對話中「六、Fire-and-forget 的 stale pending 問題」）：一筆
 * pending 超過這個時間都還沒被更新過，代表 fire-and-forget 的生成很可能因為
 * process 重啟等原因中斷、永遠不會自己完成，才視為需要救回；30 秒～幾分鐘內
 * 的 pending 仍可能只是正常生成中（LLM 呼叫本身通常幾秒到十幾秒完成），不
 * 應該搶著重試。10 分鐘遠超過正常生成耗時，同時仍在使用者可接受的合理恢復
 * 時間內。
 */
export const STALE_PENDING_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Missing-assessment recovery（見對話中「五、新增 Missing Assessment
 * Recovery」）：掃出「已經成功送出正式案件、卻完全沒有 aiCaseAssessment
 * row」的 handoff（典型成因：pending row INSERT 連續 3 次都失敗，見上一輪
 * 可靠性修正的 CASE 4），逐筆 create-if-missing 補建 pending row。
 *
 * create-if-missing 本身已經處理「另一個 worker／另一次排程同時搶著補建」
 * 的併發安全（見「六、Recovery 不得建立重複 assessment」）：查到已存在就
 * 回傳 created:false，這裡不會把它排進這次要處理的候選清單，避免重複生成
 * 或撞 UNIQUE(serviceKey, caseId) 讓整個 job 因為單一 exception 中斷。
 */
async function recoverMissingAssessments(): Promise<AiCaseAssessment[]> {
  const missingHandoffs = await listSubmittedHandoffContextsMissingAssessment();
  const recovered: AiCaseAssessment[] = [];
  for (const handoff of missingHandoffs) {
    if (handoff.submittedCaseId == null) continue;
    try {
      const { row, created } = await createPendingAssessmentIfMissing({
        userId: handoff.userId,
        factoryId: handoff.factoryId,
        serviceKey: handoff.serviceKey as HandoffEligibleServiceKey,
        caseId: handoff.submittedCaseId,
        handoffContextId: handoff.id,
      });
      if (created) recovered.push(row);
    } catch (err) {
      console.error(
        `[OXM-AI][background][layer:caseAssessmentRetryJob] missing-assessment recovery 建立 pending row 失敗 (${handoff.serviceKey}#${handoff.submittedCaseId}):`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return recovered;
}

/**
 * status='failed'、「pending 超過 STALE_PENDING_THRESHOLD_MS 都沒有更新過」、
 * 以及「已送出正式案件但完全沒有 assessment row」三種情況一併處理（見對話中
 * 「二十五、Assessment 失敗重試」「六、Fire-and-forget 的 stale pending 問題」
 * 「五、新增 Missing Assessment Recovery」）：逐筆重新讀回目前最新的正式案件
 * 資料 + handoff context（見「七、Retry 必須重新讀 authoritative case data」
 * ——不重用第一次可能已經過期／有衝突的完整 prompt，每次都重新組一次
 * authoritativeAssessmentContext），重新呼叫一次 LLM 生成，成功就 UPDATE
 * 同一筆 row 為 completed（絕不 INSERT 新 row，見「八、Assessment record
 * 不得重複」——三種情況都共用同一套 buildRetryInitiateParams/
 * regenerateCaseAssessment，一律操作同一筆既有 row），仍然失敗就標記 failed、
 * retryCount 再 +1，留給下一次排程繼續重試。
 *
 * 只由外部排程（例如 Render Cron Job）直接執行本檔案（CLI 進入點，見下方），
 * 沿用 retryFailedAiSummaries.ts 同一種風格；建議排程頻率見
 * server/jobs/README.md（每 30 分鐘）。
 */
export async function retryFailedAiCaseAssessments(): Promise<RetryFailedAiCaseAssessmentsResult> {
  const [failed, stalePending, recoveredFromMissing] = await Promise.all([
    listFailedAssessments(),
    listStalePendingAssessments(STALE_PENDING_THRESHOLD_MS),
    recoverMissingAssessments(),
  ]);
  const candidates = [...failed, ...stalePending, ...recoveredFromMissing];
  let succeeded = 0;
  let stillFailing = 0;

  for (const assessment of candidates) {
    try {
      const params = await buildRetryInitiateParams(assessment);
      if (!params) {
        stillFailing++;
        await markAssessmentFailed(assessment.id, "retry: 找不到對應的案件或 handoff context，無法重新生成").catch(() => {});
        continue;
      }
      await incrementAssessmentRetryCount(assessment.id, assessment.retryCount);
      await regenerateCaseAssessment(assessment.id, params);
      succeeded++;
    } catch (err) {
      stillFailing++;
      const message = err instanceof Error ? err.message : "unknown error";
      await markAssessmentFailed(assessment.id, message).catch(() => {});
    }
  }

  return { attempted: candidates.length, succeeded, stillFailing };
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  /retryFailedAiCaseAssessments\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  retryFailedAiCaseAssessments()
    .then((result) => {
      console.log(`[OXM-AI][background][layer:caseAssessmentRetryJob] attempted=${result.attempted} succeeded=${result.succeeded} stillFailing=${result.stillFailing}`);
      process.exit(result.stillFailing > 0 ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error("[OXM-AI][background][layer:caseAssessmentRetryJob] failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
