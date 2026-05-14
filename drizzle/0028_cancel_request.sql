-- 申請取消合作確認單 migration

ALTER TABLE `collaborationOrders`
  MODIFY COLUMN `status` enum('pending','accepted','rejected','in_progress','shipped','completed','cancelled','cancel_requested') NOT NULL DEFAULT 'pending',
  ADD COLUMN `cancelRequestedByUserId` int NULL,
  ADD COLUMN `cancelRequestedAt` timestamp NULL,
  ADD COLUMN `cancelRequestReason` text NULL,
  ADD COLUMN `cancelRequestedFromStatus` varchar(30) NULL;
