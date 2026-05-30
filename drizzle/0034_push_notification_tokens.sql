-- Migration: 0034_push_notification_tokens
-- 新增 pushNotificationTokens 資料表，用於儲存裝置推播 token
--
-- token   varchar(512)：儲存原始 FCM/APNs token
-- tokenHash varchar(64)：SHA-256(token) hex，作為 unique index key
-- UNIQUE(userId, tokenHash)：完整 token 碰撞機率等同 SHA-256，遠優於 prefix index

CREATE TABLE `pushNotificationTokens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `token` varchar(512) NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `platform` varchar(20) NOT NULL,
  `deviceId` varchar(100),
  `appVersion` varchar(50),
  `enabled` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  `lastSeenAt` timestamp,
  CONSTRAINT `pushNotificationTokens_pk` PRIMARY KEY (`id`)
);

CREATE UNIQUE INDEX `pnt_user_token_hash_unique` ON `pushNotificationTokens` (`userId`, `tokenHash`);
CREATE INDEX `pnt_user_id_idx` ON `pushNotificationTokens` (`userId`);
CREATE INDEX `pnt_enabled_idx` ON `pushNotificationTokens` (`enabled`);
