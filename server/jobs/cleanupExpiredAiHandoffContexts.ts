import "dotenv/config";
import { cleanupExpiredHandoffContexts } from "../ai/handoffContextService";

/**
 * 清掉已過期、且從未被使用者送出過的 handoff context（見「二十九、Handoff
 * Context 在表單 submit 後」：consumed 過的即使過期也保留供 Phase 5 參考，
 * 只清沒有被使用過的）。
 *
 * 只由外部排程（例如 Render Cron Job）直接執行本檔案（CLI 進入點，見檔案最
 * 下方）；建議排程頻率見 server/jobs/README.md（每小時）。
 */
export async function runAiHandoffContextCleanup(): Promise<{ deleted: number }> {
  return cleanupExpiredHandoffContexts();
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  /cleanupExpiredAiHandoffContexts\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  runAiHandoffContextCleanup()
    .then((result) => {
      console.log(`[OXM-AI][background][layer:handoffCleanupJob] deleted=${result.deleted}`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("[OXM-AI][background][layer:handoffCleanupJob] failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
