-- Migration 0019: status history for reports and support tickets

CREATE TABLE `reportStatusHistory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reportId` int NOT NULL,
  `status` enum('pending','received','reviewing','processing','resolved') NOT NULL,
  `adminNote` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `reportStatusHistory_reportId_fk` FOREIGN KEY (`reportId`) REFERENCES `reports`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ticketStatusHistory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticketId` int NOT NULL,
  `status` enum('pending','received','reviewing','processing','resolved') NOT NULL,
  `adminNote` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `ticketStatusHistory_ticketId_fk` FOREIGN KEY (`ticketId`) REFERENCES `supportTickets`(`id`) ON DELETE CASCADE
);
