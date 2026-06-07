-- 工廠負責人身分唯一性 constraints
--
-- 業務規則：同一 userId 在任何時間只能有一個有效工廠身分
--   (a) 擔任某一間工廠的 owner（factories.ownerId）
--   (b) 擔任某一間工廠的 active co-manager（factoryCoManagers，removedAt IS NULL）
--   (c) 兩者不得同時存在，且不得同時隸屬兩間以上工廠
--
-- 執行前預檢（應全為 0 rows）：
--   SELECT ownerId, COUNT(*) n FROM factories GROUP BY ownerId HAVING n > 1;
--   SELECT userId, COUNT(DISTINCT factoryId) n FROM factoryCoManagers WHERE removedAt IS NULL GROUP BY userId HAVING n > 1;
--   SELECT f.ownerId FROM factories f INNER JOIN factoryCoManagers cm ON cm.userId = f.ownerId AND cm.removedAt IS NULL AND cm.factoryId != f.id;
--   SELECT factoryId, userId, COUNT(*) n FROM factoryCoManagers WHERE removedAt IS NULL GROUP BY factoryId, userId HAVING n > 1;

-- 1. factories.ownerId 唯一索引
--    保證同一個 userId 最多擁有一間工廠
ALTER TABLE `factories` ADD UNIQUE INDEX `uq_factory_owner_id` (`ownerId`);

--> statement-breakpoint

-- 2. factoryCoManagers: 虛擬生成欄位 + 唯一索引
--    activeUserId = userId when removedAt IS NULL, else NULL
--    MySQL UNIQUE INDEX 允許多個 NULL，保留 removed 歷史紀錄
ALTER TABLE `factoryCoManagers`
  ADD COLUMN `activeUserId` INT GENERATED ALWAYS AS (
    CASE WHEN `removedAt` IS NULL THEN `userId` ELSE NULL END
  ) VIRTUAL;

--> statement-breakpoint

ALTER TABLE `factoryCoManagers`
  ADD UNIQUE INDEX `uq_active_co_manager_user` (`activeUserId`);
