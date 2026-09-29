-- Production Hardening Batch 2.8：Verified Account Linking 的 App OTP 挑戰表。
--
-- 用途：Capacitor App 的 LINE 登入在系統瀏覽器進行，無法滿足 Web magic link
-- 的「同一瀏覽器 cookie」綁定，改用寄到既有帳號可信 primaryEmail 的 6 位數
-- 驗證碼。這張表保存每一組驗證碼挑戰：綁定的目標帳號與 provider identity、
-- HMAC-SHA256 雜湊（不存原文、也不存單純 SHA-256）、到期時間、錯誤次數
-- （上限 5 次，以 DB 原子性 UPDATE 累加）、單次使用與作廢狀態。
--
-- 純新增（additive）：只有 CREATE TABLE＋CREATE INDEX，不 ALTER／不 DROP／
-- 不 RENAME 任何既有表或欄位，不改寫任何既有資料。provider identity 的最終
-- 唯一性仍由既有 userAuthAccounts.uq_provider_account 保證。
--
-- 手寫（不是 drizzle-kit generate 產生，理由同 0101：local DB 與 production
-- schema 不同步，自動產生會誤判），欄位定義與 drizzle/schema.ts 的
-- accountLinkChallenges 逐一核對一致。
--
-- Rollback：DROP TABLE `accountLinkChallenges`;（表內只有短效驗證挑戰，
-- 無其他表參照它）

CREATE TABLE `accountLinkChallenges` (
  `id` int AUTO_INCREMENT NOT NULL,
  `challengeId` varchar(64) NOT NULL,
  `targetUserId` int NOT NULL,
  `provider` varchar(30) NOT NULL,
  `providerAccountId` varchar(256) NOT NULL,
  `displayName` varchar(200),
  `targetEmail` varchar(320) NOT NULL,
  `channel` varchar(20) NOT NULL,
  `secretHash` varchar(128) NOT NULL,
  `failedAttempts` int NOT NULL DEFAULT 0,
  `maxAttempts` int NOT NULL DEFAULT 5,
  `expiresAt` timestamp NOT NULL,
  `consumedAt` timestamp,
  `invalidatedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `accountLinkChallenges_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uq_account_link_challenge` (`challengeId`),
  CONSTRAINT `accountLinkChallenges_targetUserId_fk` FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `alc_target_created_idx` ON `accountLinkChallenges` (`targetUserId`, `createdAt`);
