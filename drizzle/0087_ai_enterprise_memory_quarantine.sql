-- Phase 11.2（見對話中「十二～十四、Legacy Memory Migration／Quarantine」）：
-- Enterprise Memory 即將從 user-scoped 改成 factory-scoped（見
-- 0088_ai_enterprise_memory_factory_scope.sql），但改之前必須先把現有
-- userId-scoped 資料做安全分類——只有「factoryId 非 null，且與該 user 目前
-- 唯一 approved affiliation 相符」的 row 才能安全遷移；其餘（factoryId
-- null、或跟目前 approved affiliation 不符、或該 user 現在完全沒有 approved
-- affiliation）一律隔離到這張表，不得猜測、不得直接掛到任何新工廠。
--
-- 這張表本身不是長期治理方案的最終型態，只是這次 reconciliation
-- （server/jobs/reconcileEnterpriseMemoryFactoryScope.ts）的安全暫存區——
-- production 上線前需要正式決定這些資料的最終處置（見稽核報告 O 段）。
--
-- 遷移編號說明：0086_ai_entitlement_quota.sql 已經套用在本機 dev DB（oxm）與
-- 本機測試 DB（oxm_test），依專案慣例不回頭改寫已套用的歷史 migration。
-- 只對本機兩個 DB 執行，不碰 production。

CREATE TABLE `aiEnterpriseMemoriesLegacyQuarantine` (
  `id` int AUTO_INCREMENT NOT NULL,
  -- 原始 aiEnterpriseMemories.id，供稽核追溯（該筆原始 row 之後會被
  -- reconciliation script 從 aiEnterpriseMemories 刪除）。
  `originalId` int NOT NULL,
  `userId` int NOT NULL,
  `factoryId` int NULL,
  `summaryText` varchar(500) NOT NULL,
  `hasMeaningfulBusinessInfo` boolean NOT NULL DEFAULT false,
  `lastInteractionAt` timestamp NOT NULL,
  `lastInteractionHadMeaningfulInfo` boolean NOT NULL DEFAULT false,
  `sourceConversationId` int NULL,
  `createdAt` timestamp NOT NULL,
  `updatedAt` timestamp NOT NULL,
  -- 隔離原因：no_factory_id／no_current_affiliation／affiliation_mismatch，
  -- 見 reconciliation script 的分類邏輯，純文字說明，不含使用者資料。
  `quarantineReason` varchar(60) NOT NULL,
  `quarantinedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
);

CREATE INDEX `aemlq_user_id_idx` ON `aiEnterpriseMemoriesLegacyQuarantine` (`userId`);
CREATE INDEX `aemlq_original_id_idx` ON `aiEnterpriseMemoriesLegacyQuarantine` (`originalId`);
