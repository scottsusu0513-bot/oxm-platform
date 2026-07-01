-- Phase 4C: 訂單日期逾期 Email 通知防重複紀錄
-- 每個 orderId + dateField 只會寄一次逾期通知

CREATE TABLE `collaborationOrderOverdueNotifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orderId` int NOT NULL,
  `dateField` varchar(50) NOT NULL,
  `dueDate` varchar(10) NOT NULL,
  `notifiedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orderId_dateField_unique` (`orderId`, `dateField`),
  CONSTRAINT `coon_orderId_fk` FOREIGN KEY (`orderId`) REFERENCES `collaborationOrders` (`id`) ON DELETE CASCADE
);
