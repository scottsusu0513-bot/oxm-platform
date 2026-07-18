-- 公告「相關內容連結」：只有 type="news"（平台消息）可以設定，由
-- server/db.ts 的 normalizeAnnouncementActionUrl() 在資料層強制保證，
-- 其他類型一律存 NULL。純新增一個 nullable 欄位，不修改其他表/欄位，
-- 舊公告自然為 NULL，不需要資料回填。
ALTER TABLE `announcements` ADD COLUMN `actionUrl` varchar(500);
