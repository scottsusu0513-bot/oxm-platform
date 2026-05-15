-- 多 Provider OAuth + Email 驗證 migration
-- 安全設計：全部 ADD（不修改現有欄位），backfill 使用 INSERT IGNORE 確保冪等

-- 1. users 表新增 primaryEmail / primaryEmailVerifiedAt
ALTER TABLE `users`
  ADD COLUMN `primaryEmail` varchar(320) NULL AFTER `email`,
  ADD COLUMN `primaryEmailVerifiedAt` timestamp NULL AFTER `primaryEmail`;

-- 2. oauthStates 表新增 provider 欄位
ALTER TABLE `oauthStates`
  ADD COLUMN `provider` varchar(30) NOT NULL DEFAULT 'google' AFTER `source`;

-- 3. 建立 userAuthAccounts 表
CREATE TABLE `userAuthAccounts` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `provider` varchar(30) NOT NULL,
  `providerAccountId` varchar(256) NOT NULL,
  `providerEmail` varchar(320) NULL,
  `providerEmailVerified` boolean NOT NULL DEFAULT false,
  `displayName` varchar(200) NULL,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  `updatedAt` timestamp NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY `uq_provider_account` (`provider`, `providerAccountId`),
  CONSTRAINT `fk_uaa_userId` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- 4. 建立 emailVerificationTokens 表（DB 只存 SHA-256 hash，不存明文 token）
CREATE TABLE `emailVerificationTokens` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `tokenHash` varchar(128) NOT NULL UNIQUE,
  `email` varchar(320) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT `fk_evt_userId` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- 5. 回填現有 Google 用戶的 primaryEmail（Google 已驗證，視為可信）
UPDATE `users`
SET
  `primaryEmail` = `email`,
  `primaryEmailVerifiedAt` = `createdAt`
WHERE `loginMethod` = 'google'
  AND `email` IS NOT NULL
  AND `email` NOT LIKE '%@privaterelay.appleid.com'
  AND `primaryEmail` IS NULL;

-- 6. 回填 userAuthAccounts（INSERT IGNORE 確保重複執行不報錯）
INSERT IGNORE INTO `userAuthAccounts`
  (`userId`, `provider`, `providerAccountId`, `providerEmail`, `providerEmailVerified`, `displayName`)
SELECT
  `id`,
  'google',
  SUBSTRING(`openId`, 8),
  `email`,
  true,
  `name`
FROM `users`
WHERE `openId` LIKE 'google_%';
