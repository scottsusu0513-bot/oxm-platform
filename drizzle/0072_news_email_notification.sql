-- 產業消息「是否已寄送 Email 通知」的唯一標記欄位。nullable、無 default，
-- 既有消息一律維持 NULL（=尚未寄送），本檔案本身不 backfill、不觸發任何寄信。
-- 只有 news.create（首次建立即發布，且管理員勾選「同時發送 Email 通知」）
-- 才可能寫入這個欄位，見 server/routers.ts 的 dispatchNewsNotifications。
-- 本檔案已套用至本機 oxm 與 oxm_test（供本機測試執行），未套用至任何正式
-- （production）資料庫，詳見任務指示。
ALTER TABLE `news`
  ADD COLUMN `emailNotificationSentAt` timestamp NULL AFTER `firstPublishedAt`;
