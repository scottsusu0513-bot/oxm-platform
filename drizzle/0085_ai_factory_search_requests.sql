-- Phase 6A.1：Factory Search 人工協尋（不是顧問 Handoff，見 drizzle/schema.ts
-- aiFactorySearchRequests 上方註解）。只套用到 local oxm / oxm_test，不套 production。
CREATE TABLE `aiFactorySearchRequests` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `factoryId` int NULL,
  `conversationId` int NULL,
  `status` enum('pending','cancelled','notifying','notified','notification_failed') NOT NULL DEFAULT 'pending',
  `hardFiltersJson` json NOT NULL,
  `rankingSignalsJson` json NOT NULL,
  `coreCapabilitiesJson` json NOT NULL,
  `requestSummary` varchar(500) NOT NULL,
  `candidateCount` int NOT NULL DEFAULT 0,
  `directCapabilityMatchCount` int NOT NULL DEFAULT 0,
  `requestedMatchCount` int NULL,
  `notifiedAt` timestamp NULL,
  `cancelledAt` timestamp NULL,
  `notificationClaimedAt` timestamp NULL,
  `notificationRetryCount` int NOT NULL DEFAULT 0,
  `lastNotificationError` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `aiFactorySearchRequests_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `aiFactorySearchRequests_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL
);

CREATE INDEX `afsr_user_id_idx` ON `aiFactorySearchRequests` (`userId`);
CREATE INDEX `afsr_conversation_id_idx` ON `aiFactorySearchRequests` (`conversationId`);
CREATE INDEX `afsr_status_idx` ON `aiFactorySearchRequests` (`status`);
