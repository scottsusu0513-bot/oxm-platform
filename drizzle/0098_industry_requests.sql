-- 產業新增需求（industryRequests）：會員向 OXM 提出「找不到適合的產業分類，
-- 希望新增」的需求。沿用專案既有「案件 + statusHistory + adminNote」模式
-- （見 supportTickets / ticketStatusHistory、reports / reportStatusHistory）。
--
-- status 四值：
--   pending / reviewing  → active（同一會員同時最多一筆）
--   resolved / rejected  → 終態，會員之後可再提新的一筆
--
-- 「同一 user 同時最多一筆 active」由 DB 保證：
--   `activeFlag` 是 generated stored column（active 時 = 1、否則 NULL），
--   只依 status 推導、不以 userId 為 base column——這樣才能與 userId 的
--   ON DELETE CASCADE 外鍵並存（MySQL InnoDB 不允許「stored generated column
--   的 base column 帶 CASCADE/SET NULL 外鍵」）。搭配 UNIQUE(`userId`,`activeFlag`)：
--   MySQL unique index 視 NULL 互不相等，故已結案(resolved/rejected)的舊案件
--   activeFlag=NULL、不佔名額；並發／double-click／API 重送造成的第二筆 active
--   insert 會被這個 unique key 擋下（app 層另有 SELECT ... FOR UPDATE 事務先擋一層）。
--
-- `adminMessageCampaignId`：管理員在「產業要求」案件點「私訊會員」時，
--   建立/綁定的站內信 campaign（messageCampaigns.targetType='single'）。
--   NULL = 尚未建立；綁定後管理員再點「私訊會員」直接開同一 thread，不重建。
--
-- 只新增這兩張表，不 UPDATE / backfill / DROP / RENAME 任何既有表或欄位。
-- 只套用到 local oxm / oxm_test，不套 production。

CREATE TABLE `industryRequests` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `userId` int NOT NULL,
  `name` varchar(200) NOT NULL,
  `email` varchar(320) NOT NULL,
  `phone` varchar(30),
  `description` text NOT NULL,
  `status` enum('pending','reviewing','resolved','rejected') NOT NULL DEFAULT 'pending',
  `adminNote` text,
  `adminMessageCampaignId` int,
  `activeFlag` int GENERATED ALWAYS AS (
    (CASE WHEN `status` IN ('pending','reviewing') THEN 1 ELSE NULL END)
  ) STORED,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE now(),
  CONSTRAINT `uq_industry_request_active_user` UNIQUE(`userId`, `activeFlag`),
  CONSTRAINT `fk_industry_request_user` FOREIGN KEY (`userId`)
    REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_industry_request_campaign` FOREIGN KEY (`adminMessageCampaignId`)
    REFERENCES `messageCampaigns`(`id`) ON DELETE SET NULL
);

CREATE TABLE `industryRequestStatusHistory` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `requestId` int NOT NULL,
  `status` enum('pending','reviewing','resolved','rejected') NOT NULL,
  `adminNote` text,
  `createdAt` timestamp NOT NULL DEFAULT (now())
);

CREATE INDEX `idx_industry_request_history_request`
  ON `industryRequestStatusHistory` (`requestId`);
