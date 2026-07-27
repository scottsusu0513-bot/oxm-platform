-- 政府補助顧問專區流程調整：
-- 1) 新增「deferred」(緩追區) 狀態：工廠體質符合但目前無適合補助方案時的暫緩處理狀態，
--    位於 ineligible（資格不符）與 accepted（已立案處理中）之間，可與 evaluating 互轉。
-- 2) 新增 lastUpdatedByUserId / lastUpdatedByNameSnapshot：記錄最後一次修改案件的
--    使用者（管理員或顧問），沿用 communityBidOffers 已驗證過的 snapshot 慣例——
--    FK 對應真實 userId（使用者被刪除時 SET NULL，不影響歷史紀錄），name snapshot
--    另外保存當下顯示名稱，避免使用者之後改名或被刪除時舊紀錄的顯示名稱跟著消失。
-- 上線前由管理員手動執行，不可在 production 自動執行。
ALTER TABLE `upgradeApplications`
  MODIFY COLUMN `status`
  ENUM('new','evaluating','ineligible','deferred','accepted','submitted','rejected','approved','transforming','completed','unassigned','archived','viewed','contacted','consulting')
  NOT NULL DEFAULT 'new';

ALTER TABLE `upgradeApplications`
  ADD COLUMN `lastUpdatedByUserId` int NULL,
  ADD COLUMN `lastUpdatedByNameSnapshot` varchar(100) NOT NULL DEFAULT '';

ALTER TABLE `upgradeApplications`
  ADD CONSTRAINT `upgradeApplications_lastUpdatedByUserId_fk` FOREIGN KEY (`lastUpdatedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL;

CREATE INDEX `ua_last_updater_idx` ON `upgradeApplications` (`lastUpdatedByUserId`);
