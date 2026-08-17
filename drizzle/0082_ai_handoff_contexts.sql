-- OXM AI Phase 4：AI Handoff Context——AI 對話判斷可承接的真人服務後，使用者
-- 點【幫你送出詢問】時，server 建立這筆短效 snapshot，交給既有表單（政府
-- 補助／ERP／ISO／短影音／財務）預填。與 aiConversations／aiEnterpriseMemories
-- 完全獨立的一張新表，不影響既有 AI lifecycle 表格。
--
-- 遷移編號說明：0081_ai_enterprise_memory_merge.sql 已經套用在本機 dev DB
-- （oxm）與本機測試 DB（oxm_test），這裡是下一個安全的號碼。只對本機兩個 DB
-- 執行，不碰 production。

CREATE TABLE `aiHandoffContexts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `token` varchar(64) NOT NULL,
  `userId` int NOT NULL,
  `factoryId` int NULL,
  `serviceKey` varchar(50) NOT NULL,
  `prefillDataJson` json NOT NULL,
  `confirmedFieldsJson` json NOT NULL,
  `handoffSummary` varchar(500) NOT NULL,
  `sourceConversationId` int NULL,
  `expiresAt` timestamp NOT NULL,
  `acknowledgedAt` timestamp NULL,
  `consumedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `aiHandoffContexts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `aiHandoffContexts_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL
);

CREATE UNIQUE INDEX `ahc_token_uq` ON `aiHandoffContexts` (`token`);
CREATE INDEX `ahc_user_id_idx` ON `aiHandoffContexts` (`userId`);
