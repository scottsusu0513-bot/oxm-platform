-- Phase 11.2（見對話中「一～二、正式架構決策／Enterprise Memory Schema」）：
-- Enterprise Memory 從 user-scoped 改成 factory-scoped——OXM AI 記住的是
-- 「這間企業」，不是「這個人的企業背景」。同一間 approved 工廠的 owner／
-- co-manager 共用同一份記憶；user 離開 A 工廠、加入 B 工廠後，只會讀到 B
-- 工廠自己的記憶，不會繼續讀到 A 工廠的舊記憶（見 Phase 11.1 Audit 認定的
-- P0：cross-factory memory leakage）。
--
-- 前置條件：這支 migration 執行前，必須先跑過
-- server/jobs/reconcileEnterpriseMemoryFactoryScope.ts，確保 aiEnterpriseMemories
-- 裡沒有 factoryId IS NULL、也沒有兩筆 row 指向同一個 factoryId（否則下面的
-- UNIQUE INDEX／NOT NULL 會直接失敗）——無法安全歸屬的舊資料已經被隔離進
-- 0087_ai_enterprise_memory_quarantine.sql 建立的
-- aiEnterpriseMemoriesLegacyQuarantine。
--
-- userId 欄位改名為 lastActorUserId，語意從「查詢 key」降級為「純稽核用途：
-- 最後一次觸發這筆記憶更新的是哪個登入帳號」，不得再被拿來當作讀取權限或
-- scope 判斷依據（見對話中「二」：不要讓未來開發者誤以為仍然 user-scoped）。
--
-- factoryId 的 FK 從 ON DELETE SET NULL 改成 ON DELETE CASCADE：工廠一旦被
-- owner 自助真的物理刪除，該工廠的 Enterprise Memory 不應該變成無主資料
-- （見對話中「十五、Factory Delete」，admin 的下架/軟刪除不是真正的
-- DELETE，不會觸發這個 FK）。
--
-- 遷移編號說明：0087_ai_enterprise_memory_quarantine.sql 已經套用在本機
-- dev DB（oxm）與本機測試 DB（oxm_test），依專案慣例不回頭改寫已套用的歷史
-- migration。只對本機兩個 DB 執行，不碰 production。

ALTER TABLE `aiEnterpriseMemories` DROP FOREIGN KEY `aiEnterpriseMemories_userId_users_id_fk`;
ALTER TABLE `aiEnterpriseMemories` DROP FOREIGN KEY `aiEnterpriseMemories_factoryId_factories_id_fk`;
ALTER TABLE `aiEnterpriseMemories` DROP INDEX `aem_user_id_uq`;

ALTER TABLE `aiEnterpriseMemories` CHANGE COLUMN `userId` `lastActorUserId` int NULL;
ALTER TABLE `aiEnterpriseMemories` MODIFY COLUMN `factoryId` int NOT NULL;

ALTER TABLE `aiEnterpriseMemories`
  ADD CONSTRAINT `aiEnterpriseMemories_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `aiEnterpriseMemories_lastActorUserId_users_id_fk` FOREIGN KEY (`lastActorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL;

CREATE UNIQUE INDEX `aem_factory_id_uq` ON `aiEnterpriseMemories` (`factoryId`);
