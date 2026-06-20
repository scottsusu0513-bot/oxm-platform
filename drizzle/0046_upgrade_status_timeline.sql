-- 企業升級中心：新增案件流程時間軸欄位
-- 記錄每個狀態的最新進入時間，供顧問中心案件流程 UI 使用
-- 結構: { "status": "ISO8601-timestamp" }
-- 例如: { "new": "2026-06-20T10:00:00.000Z", "evaluating": "2026-06-20T10:05:00.000Z" }
-- 注意：submitted / rejected 若循環，只保留最後一次進入時間（第一版限制）
--
-- ⚠️ 不要在 production DB 直接執行，除非管理員明確授權

ALTER TABLE `upgradeApplications`
  ADD COLUMN `statusTimeline` JSON NULL COMMENT '各階段進入時間（object: status→ISO timestamp）';
