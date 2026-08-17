import "dotenv/config";
import { retryPendingFactorySearchNotifications } from "../ai/factorySearchRequestService";

/**
 * Phase 6A.1（見「二十五、Notification Retry」）：處理 notification_failed，
 * 以及 claim 卡住超過 staleness 閾值的 notifying，逐筆重新 claim + notify。
 * 不重新讀 raw conversation——aiFactorySearchRequests 本身已經是完整快照。
 *
 * 只由外部排程或人工直接執行本檔案（CLI 進入點見下方），本輪不設定正式
 * production 排程，只提供本地可手動執行的能力（見「不要 production cron」）。
 */
const invokedDirectly = typeof process.argv[1] === "string" &&
  /retryPendingFactorySearchNotifications\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  retryPendingFactorySearchNotifications()
    .then((result) => {
      console.log(`[cron] retry-pending-factory-search-notifications: attempted=${result.attempted} succeeded=${result.succeeded} stillFailing=${result.stillFailing}`);
      process.exit(result.stillFailing > 0 ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error("[cron] retry-pending-factory-search-notifications failed:", err instanceof Error ? err.message : "unknown error");
      process.exit(1);
    });
}
