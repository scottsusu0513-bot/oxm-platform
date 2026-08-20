-- Phase 8.1：Factory-based AI Entitlement / 每日額度 / Usage Logging（見
-- drizzle/schema.ts factoryAiDailyUsage／aiUsageTurns／aiModelCalls 上方註解）。
-- 只套用到 local oxm / oxm_test，不套 production。

CREATE TABLE `factoryAiDailyUsage` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factoryId` int NOT NULL,
  `quotaDate` varchar(10) NOT NULL,
  `usedTurns` int NOT NULL DEFAULT 0,
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `factoryAiDailyUsage_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX `fadu_factory_date_uq` ON `factoryAiDailyUsage` (`factoryId`, `quotaDate`);

CREATE TABLE `aiUsageTurns` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factoryId` int NULL,
  `actorUserId` int NOT NULL,
  `conversationId` int NULL,
  `clientTurnId` varchar(64) NOT NULL,
  `quotaDate` varchar(10) NOT NULL,
  `intent` varchar(40) NULL,
  `resourceTarget` varchar(40) NULL,
  `status` enum('started','completed','failed') NOT NULL DEFAULT 'started',
  `quotaCharged` boolean NOT NULL DEFAULT false,
  `attemptCount` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `completedAt` timestamp NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `aiUsageTurns_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE CASCADE,
  CONSTRAINT `aiUsageTurns_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `aiUsageTurns_conversationId_aiConversations_id_fk` FOREIGN KEY (`conversationId`) REFERENCES `aiConversations`(`id`) ON DELETE SET NULL
);

CREATE UNIQUE INDEX `aiut_factory_client_turn_uq` ON `aiUsageTurns` (`factoryId`, `clientTurnId`);
CREATE INDEX `aiut_factory_quota_date_idx` ON `aiUsageTurns` (`factoryId`, `quotaDate`);
CREATE INDEX `aiut_actor_idx` ON `aiUsageTurns` (`actorUserId`);

CREATE TABLE `aiModelCalls` (
  `id` int AUTO_INCREMENT NOT NULL,
  `turnId` int NULL,
  `factoryId` int NULL,
  `actorUserId` int NULL,
  `layer` varchar(40) NOT NULL,
  `model` varchar(100) NOT NULL,
  `provider` varchar(40) NOT NULL,
  `inputTokens` int NULL,
  `outputTokens` int NULL,
  `totalTokens` int NULL,
  `cachedInputTokens` int NULL,
  `reasoningTokens` int NULL,
  `latencyMs` int NOT NULL,
  `success` boolean NOT NULL,
  `errorCategory` varchar(60) NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `aiModelCalls_turnId_aiUsageTurns_id_fk` FOREIGN KEY (`turnId`) REFERENCES `aiUsageTurns`(`id`) ON DELETE SET NULL,
  CONSTRAINT `aiModelCalls_factoryId_factories_id_fk` FOREIGN KEY (`factoryId`) REFERENCES `factories`(`id`) ON DELETE SET NULL,
  CONSTRAINT `aiModelCalls_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL
);

CREATE INDEX `aimc_turn_idx` ON `aiModelCalls` (`turnId`);
CREATE INDEX `aimc_factory_idx` ON `aiModelCalls` (`factoryId`);
CREATE INDEX `aimc_created_at_idx` ON `aiModelCalls` (`createdAt`);
