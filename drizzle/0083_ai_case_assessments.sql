-- OXM AI Phase 5：AI Case Assessment——AI 導件案件正式成立後，用最終 submitted
-- form + handoff snapshot（confirmedFacts／handoffSummary）+ 安全企業 context
-- 生成的服務專屬 AI 初判，給顧問接手用。五個服務案件表各自獨立，這裡用單一
-- 共用表（serviceKey + caseId polymorphic reference，故意不建錯誤的跨表 FK，
-- 理由同 aiHandoffContexts.sourceConversationId）。
--
-- 遷移編號說明：0082_ai_handoff_contexts.sql 已經套用在本機 dev DB（oxm）與
-- 本機測試 DB（oxm_test），這裡是下一個安全的號碼。只對本機兩個 DB 執行，
-- 不碰 production。

CREATE TABLE `aiCaseAssessments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NULL,
  `factoryId` int NULL,
  `serviceKey` varchar(50) NOT NULL,
  `caseId` int NOT NULL,
  `handoffContextId` int NULL,
  `status` enum('pending','completed','failed') NOT NULL DEFAULT 'pending',
  `assessmentJson` json NULL,
  `assessmentText` text NULL,
  `retryCount` int NOT NULL DEFAULT 0,
  `lastError` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `aiCaseAssessments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `aiCaseAssessments_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL,
  CONSTRAINT `aiCaseAssessments_handoffContextId_aiHandoffContexts_id_fk` FOREIGN KEY (`handoffContextId`) REFERENCES `aiHandoffContexts`(`id`) ON DELETE SET NULL
);

CREATE UNIQUE INDEX `aica_service_case_uq` ON `aiCaseAssessments` (`serviceKey`, `caseId`);
CREATE INDEX `aica_status_idx` ON `aiCaseAssessments` (`status`);
CREATE INDEX `aica_handoff_context_idx` ON `aiCaseAssessments` (`handoffContextId`);
