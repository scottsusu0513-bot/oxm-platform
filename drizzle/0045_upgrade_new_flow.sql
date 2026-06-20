-- 企業升級中心流程重構（Phase 2）
-- 新增狀態：evaluating / accepted / rejected / approved / transforming
-- 新增欄位：plannedSubsidyAmount / approvedSubsidyAmount
-- 保留舊狀態：viewed / contacted / consulting（留待資料轉換授權後移除）
--
-- 資料轉換建議（待管理員授權後執行）：
--   UPDATE upgradeApplications SET status='evaluating' WHERE status IN ('viewed','contacted');
--   UPDATE upgradeApplications SET status='accepted'   WHERE status='consulting';
--
-- 注意：不要在 production DB 執行此 migration，除非管理員明確授權

ALTER TABLE `upgradeApplications`
  MODIFY COLUMN `status`
  ENUM('new','evaluating','ineligible','accepted','submitted','rejected','approved','transforming','completed','unassigned','archived','viewed','contacted','consulting')
  NOT NULL DEFAULT 'new';

ALTER TABLE `upgradeApplications`
  ADD COLUMN `plannedSubsidyAmount` INT NULL COMMENT '本次案件預計送審金額（新台幣元）',
  ADD COLUMN `approvedSubsidyAmount` INT NULL COMMENT '實際過案金額（新台幣元）';
