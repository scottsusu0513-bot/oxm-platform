-- OXM AI conversation lifecycle 改版：取消「逐字對話保存 30 天」規則，改成
-- 「conversation 只是當次互動的暫存工作區，收尾時一定要產生摘要並寫進
-- aiEnterpriseMemories，摘要成功後才刪除這次的 aiConversations/aiMessages
-- 原文；摘要失敗則原文暫時保留、標記 failed 待重試」。
--
-- 遷移編號說明：0079_ai_conversations.sql 已經套用在本機 dev DB（oxm）與本機
-- 測試 DB（oxm_test），依專案慣例不回頭改寫已套用的歷史 migration，這裡是
-- 下一個安全的號碼（0079 之後，目前 drizzle/ 目錄下最新實體檔案）。只對本機
-- 兩個 DB 執行，不碰 production。

-- aiConversations：拿掉「30 天窗口」欄位 expiresAt；status 的 enum 從
-- ('active','closed') 改成 ('active','failed')——正常結束的對話會被整筆
-- 刪除，不會留下 'closed' 這種持久終態；新增收尾失敗的重試欄位。
--
-- 注意：aic_user_status_idx（userId, status, expiresAt）是 userId 外鍵約束
-- 目前依賴的支援索引（MySQL 用複合索引的前綴欄位滿足 FK 需求），不能直接
-- DROP INDEX，直接 DROP COLUMN expiresAt 會讓 MySQL 自動把索引縮成
-- (userId, status)、繼續滿足 FK 需求，不需要另外手動重建索引。
ALTER TABLE `aiConversations` DROP COLUMN `expiresAt`;
ALTER TABLE `aiConversations` MODIFY COLUMN `status` enum('active','failed') NOT NULL DEFAULT 'active';
ALTER TABLE `aiConversations`
  ADD COLUMN `retryCount` int NOT NULL DEFAULT 0 AFTER `pendingActionJson`,
  ADD COLUMN `lastSummaryError` text NULL AFTER `retryCount`;

-- aiMessages：cleanup job 專用的 createdAt 索引不再需要（沒有「刪超過 30 天
-- 的訊息」這個排程了，收尾一律整段刪除）。這個索引不是任何 FK 的支援索引
-- （conversationId 的 FK 有自己獨立的索引），可以直接 DROP。
ALTER TABLE `aiMessages` DROP INDEX `aim_created_at_idx`;

-- 跨對話的長期記憶：一個 user 一筆，每次 conversation 收尾都是 upsert 覆寫。
CREATE TABLE `aiEnterpriseMemories` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `factoryId` int NULL,
  `summaryText` varchar(500) NOT NULL,
  `hasMeaningfulBusinessInfo` boolean NOT NULL DEFAULT false,
  `sourceConversationId` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `aiEnterpriseMemories_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `aiEnterpriseMemories_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL
);

CREATE UNIQUE INDEX `aem_user_id_uq` ON `aiEnterpriseMemories` (`userId`);
