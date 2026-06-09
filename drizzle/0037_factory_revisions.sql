-- ===== 工廠基本資料修改申請表 =====
-- 已上線工廠（status='approved'）變更基本資料時，須提交此修改申請由管理員審核。
-- pendingFactoryId 為 VIRTUAL generated column，配合 UNIQUE INDEX 保證每間工廠最多一筆 pending 申請。
-- MySQL UNIQUE INDEX 對 NULL 值免除約束，因此 non-pending 的歷史申請不受影響。

CREATE TABLE `factoryRevisions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `factoryId` int NOT NULL,
  `submittedBy` int NOT NULL,
  `originalData` json NOT NULL,
  `proposedData` json NOT NULL,
  `revisionReason` text,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `rejectionReason` text,
  `reviewedBy` int,
  `reviewedAt` timestamp NULL,
  `submittedAt` timestamp NOT NULL DEFAULT NOW(),
  `pendingFactoryId` int GENERATED ALWAYS AS (CASE WHEN `status` = 'pending' THEN `factoryId` ELSE NULL END) VIRTUAL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_factoryRevisions_factory` FOREIGN KEY (`factoryId`) REFERENCES `factories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_factoryRevisions_submittedBy` FOREIGN KEY (`submittedBy`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_factory_one_pending_revision` ON `factoryRevisions` (`pendingFactoryId`);
