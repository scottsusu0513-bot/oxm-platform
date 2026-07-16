-- 登入彈窗管理：綁定既有「平台消息」公告的登入曝光入口（不是獨立公告系統）。
-- 純新增兩張表，不修改任何既有表，無資料回填風險。

CREATE TABLE `loginPopups` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `title` varchar(200) NOT NULL,
  `summary` varchar(500) NOT NULL,
  -- 綁定的平台公告；公告被刪除時只把這欄設為 NULL（不連帶刪除本筆紀錄），
  -- 後台會依此顯示「綁定公告已失效」並禁止啟用，直到重新綁定。
  `announcementId` int NULL,
  -- 顯示控制只有啟用/停用，沒有額外的時間區間欄位。
  `isActive` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_login_popups_announcement` FOREIGN KEY (`announcementId`) REFERENCES `announcements` (`id`) ON DELETE SET NULL
);

-- 每日一次的判定紀錄：userId + 台灣時間日期唯一，跨裝置／瀏覽器／清快取／
-- 登出再登入都視為同一天，只在使用者實際點擊「我知道了」或「點擊進入完整
-- 公告」時才寫入（見後端 markViewed 邏輯），不是彈窗一出現就寫入。
CREATE TABLE `loginPopupViews` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `date` varchar(10) NOT NULL,
  `loginPopupId` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_login_popup_views_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_login_popup_views_popup` FOREIGN KEY (`loginPopupId`) REFERENCES `loginPopups` (`id`) ON DELETE SET NULL,
  UNIQUE INDEX `login_popup_view_user_date_idx` (`userId`, `date`)
);
