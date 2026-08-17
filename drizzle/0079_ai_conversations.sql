-- OXM AI（企業需求診斷與資源分流）對話：aiConversations + aiMessages。
--
-- 完全獨立於既有買家↔工廠 conversations／messages 表——那是人對人詢價聊天，
-- 這是使用者跟 AI 的診斷對話，語意、生命週期、保存規則都不同。
--
-- 逐字訊息（aiMessages）只保存 30 天，由 server/ai/cleanup.ts 的
-- cleanupExpiredAiMessages() 批次刪除，本 migration 只建表，不建立正式排程
-- （Phase 2 本輪只做本地端功能，正式 Render/Railway cron 留待 production
-- deployment 階段）。
--
-- 遷移編號說明：drizzle/meta/_journal.json 目前只記錄到 idx 28
-- （tag 0028_upgrade_center），但 drizzle/ 目錄下的實體 .sql 檔案已經到
-- 0078，本機 DB 的 __drizzle_migrations 追蹤表也只有 21 筆、且已知
-- upgradePrograms（0076）等後期 migration 尚未套用到本機 DB——這代表這個
-- 專案的 migration 檔案編號與 drizzle-kit 自己的追蹤機制長期不同步，向下一個
-- migration 只能依實體檔案的最高編號（0078）往下取，不能信任 journal／
-- __drizzle_migrations 的追蹤筆數。因此使用 0079，並且直接對本機 DB 執行這份
-- SQL（不透過 drizzle-kit migrate），因為這是全新的表、不依賴中間任何一個
-- migration 的狀態，可以安全地獨立套用。

CREATE TABLE `aiConversations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `factoryId` int NULL,
  `status` enum('active','closed') NOT NULL DEFAULT 'active',
  `currentStateJson` json NULL,
  `pendingActionJson` json NULL,
  `lastMessageAt` timestamp NOT NULL DEFAULT (now()),
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `aiConversations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `aiConversations_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL
);

CREATE INDEX `aic_user_status_idx` ON `aiConversations` (`userId`, `status`, `expiresAt`);

CREATE TABLE `aiMessages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `conversationId` int NOT NULL,
  `role` enum('user','assistant') NOT NULL,
  `content` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `aiMessages_conversationId_aiConversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `aiConversations`(`id`) ON DELETE CASCADE
);

CREATE INDEX `aim_conversation_idx` ON `aiMessages` (`conversationId`, `createdAt`);
CREATE INDEX `aim_created_at_idx` ON `aiMessages` (`createdAt`);
