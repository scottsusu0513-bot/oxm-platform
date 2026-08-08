-- 顧問中心三項新服務（ISO／低碳認證、ERP／產線優化、短影音／品牌內容）補上
-- 各自專屬的案件狀態流程。三張表彼此仍完全獨立、狀態值不互通。
--
-- 本檔案為 additive、向後相容 migration，疊加在已正式套用的
-- 0070_certification_service_catalog.sql／0073_short_video_marketing.sql／
-- 0074_iso_erp_marketing.sql 之上，不修改這三個檔案本身。
--
-- 正式站已於 2026-08-06 完成備份並套用 0070/0073/0074（8 張新表、正式庫總表數
-- 62→70，17 項結構與 13 個外鍵已驗證），本檔案不重跑上述任何一支 migration。
--
-- 向後相容設計（與第一版最大差異）：
--   - status enum 採「保留舊九態 + 新增各服務專屬細分狀態」的疊加方式，
--     不刪除任何現有列舉值（包含各服務目前程式已不再主動寫入的 'evaluating'）。
--     部署切換期間，尚未更新的舊版程式碼仍可正常讀寫舊狀態值；新版程式碼
--     上線後才會開始使用新增的細分狀態。舊狀態的正式清理另外開一支
--     migration，不在本次一併移除。
--   - statusHistory／statusReason／claimedAt 維持 additive 新增欄位。
--   - openFactoryId 產生欄位改為同時辨識「舊九態的未結案狀態」與「新增細分
--     狀態中的未結案狀態」聯集，新舊資料都能正確算出未結案工廠 id，不影響
--     現有「同工廠最多一筆未結案案件」的唯一性保護。
--
-- 執行前置條件（已用唯讀 SQL 對正式庫核對，見驗收報告）：三張案件表在正式
-- 庫目前均為 0 筆資料，因此本檔案不需要任何資料重新映射（UPDATE ... SET
-- status = ...）就能安全疊加新列舉值——即使未來執行前已有資料，只新增列舉
-- 值、不刪除既有值的 ALTER 對既有資料列一律相容，無截斷風險。

-- ===== certificationCases =====
-- 新流程：new → needs_interview(需求訪談) → scope_assessment(適用性與範圍評估)
-- → proposal → in_progress → [pre_review(可跳過)] → verification → completed。
-- 例外：deferred／no_interest／not_applicable／archived。

ALTER TABLE `certificationCases` DROP INDEX `ccase_open_factory_uq`;
ALTER TABLE `certificationCases` DROP COLUMN `openFactoryId`;

ALTER TABLE `certificationCases`
  MODIFY COLUMN `status` enum(
    'new','evaluating','proposal','in_progress','completed','deferred','no_interest','archived','unassigned',
    'needs_interview','scope_assessment','pre_review','verification','not_applicable'
  ) NOT NULL DEFAULT 'new';

ALTER TABLE `certificationCases` ADD COLUMN `statusHistory` json;
ALTER TABLE `certificationCases` ADD COLUMN `statusReason` varchar(500);
ALTER TABLE `certificationCases` ADD COLUMN `claimedAt` timestamp;

ALTER TABLE `certificationCases` ADD COLUMN `openFactoryId` int GENERATED ALWAYS AS (
  CASE WHEN `status` IN (
    'new','evaluating','proposal','in_progress','deferred','unassigned',
    'needs_interview','scope_assessment','pre_review','verification'
  ) THEN `factoryId` ELSE NULL END
) VIRTUAL;
ALTER TABLE `certificationCases` ADD CONSTRAINT `ccase_open_factory_uq` UNIQUE(`openFactoryId`);

-- ===== erpCases =====
-- 新流程：new → needs_triage(需求分流) → diagnosis(現場診斷／流程盤點)
-- → solution_design(改善方案設計) → proposal → in_progress → pilot_adjustment(試行與調整)
-- → acceptance(驗收中) → completed。例外：deferred／no_interest／not_applicable／archived。

ALTER TABLE `erpCases` DROP INDEX `ecase_open_factory_uq`;
ALTER TABLE `erpCases` DROP COLUMN `openFactoryId`;

ALTER TABLE `erpCases`
  MODIFY COLUMN `status` enum(
    'new','evaluating','proposal','in_progress','completed','deferred','no_interest','archived','unassigned',
    'needs_triage','diagnosis','solution_design','pilot_adjustment','acceptance','not_applicable'
  ) NOT NULL DEFAULT 'new';

ALTER TABLE `erpCases` ADD COLUMN `statusHistory` json;
ALTER TABLE `erpCases` ADD COLUMN `statusReason` varchar(500);
ALTER TABLE `erpCases` ADD COLUMN `claimedAt` timestamp;

ALTER TABLE `erpCases` ADD COLUMN `openFactoryId` int GENERATED ALWAYS AS (
  CASE WHEN `status` IN (
    'new','evaluating','proposal','in_progress','deferred','unassigned',
    'needs_triage','diagnosis','solution_design','pilot_adjustment','acceptance'
  ) THEN `factoryId` ELSE NULL END
) VIRTUAL;
ALTER TABLE `erpCases` ADD CONSTRAINT `ecase_open_factory_uq` UNIQUE(`openFactoryId`);

-- ===== shortVideoCases =====
-- 新流程：new → needs_interview(需求訪談) → proposal(方案確認) → pre_production(前期企劃)
-- → script_review(腳本待確認) → in_progress(拍攝／製作中) → draft_review(初稿審核／修改)
-- → delivered(已交付) → [ongoing_operation(持續代營運，長期方案分支)] → completed。
-- 例外：deferred／no_interest／not_applicable(不適合承接)／archived。

ALTER TABLE `shortVideoCases` DROP INDEX `svcase_open_factory_uq`;
ALTER TABLE `shortVideoCases` DROP COLUMN `openFactoryId`;

ALTER TABLE `shortVideoCases`
  MODIFY COLUMN `status` enum(
    'new','evaluating','proposal','in_progress','completed','deferred','no_interest','archived','unassigned',
    'needs_interview','pre_production','script_review','draft_review','delivered','ongoing_operation','not_applicable'
  ) NOT NULL DEFAULT 'new';

ALTER TABLE `shortVideoCases` ADD COLUMN `statusHistory` json;
ALTER TABLE `shortVideoCases` ADD COLUMN `statusReason` varchar(500);
ALTER TABLE `shortVideoCases` ADD COLUMN `claimedAt` timestamp;

ALTER TABLE `shortVideoCases` ADD COLUMN `openFactoryId` int GENERATED ALWAYS AS (
  CASE WHEN `status` IN (
    'new','evaluating','proposal','in_progress','deferred','unassigned',
    'needs_interview','pre_production','script_review','draft_review','delivered','ongoing_operation'
  ) THEN `factoryId` ELSE NULL END
) VIRTUAL;
ALTER TABLE `shortVideoCases` ADD CONSTRAINT `svcase_open_factory_uq` UNIQUE(`openFactoryId`);
