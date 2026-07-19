-- 找消息（News）原始消息來源欄位。純新增：
--   news 表新增 sourceName／sourceUrl 兩個選填欄位。
-- 不修改 0059 已建立的欄位或表，不含任何 DROP／TRUNCATE／DELETE／UPDATE／RENAME。

ALTER TABLE `news` ADD COLUMN `sourceName` varchar(200);
--> statement-breakpoint
ALTER TABLE `news` ADD COLUMN `sourceUrl` varchar(1000);
