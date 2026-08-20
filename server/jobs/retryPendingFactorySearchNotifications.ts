import "dotenv/config";
import { retryPendingFactorySearchNotifications } from "../ai/factorySearchRequestService";

/**
 * Phase 6A.1（見「二十五、Notification Retry」）：處理 notification_failed，
 * 以及 claim 卡住超過 staleness 閾值的 notifying，逐筆重新 claim + notify。
 * 不重新讀 raw conversation——aiFactorySearchRequests 本身已經是完整快照。
 *
 * 只由外部排程（例如 Render Cron Job）直接執行本檔案（CLI 進入點見下方）；
 * 建議排程頻率見 server/jobs/README.md（每 10-15 分鐘）。
 */
const invokedDirectly = typeof process.argv[1] === "string" &&
  /retryPendingFactorySearchNotifications\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  retryPendingFactorySearchNotifications()
    .then((result) => {
      console.log(`[OXM-AI][background][layer:sourcingNotificationRetryJob] attempted=${result.attempted} succeeded=${result.succeeded} stillFailing=${result.stillFailing}`);
      process.exit(result.stillFailing > 0 ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error("[OXM-AI][background][layer:sourcingNotificationRetryJob] failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
