-- 徽章系統：公開 badge id 清單 + 私密證明資料
-- 尚未執行 —— 僅建立 migration 檔，依作業指示不可執行 migration/db:push。
--
-- certificationBadges：string[]，公開徽章 id（見 shared/badges.ts CERTIFICATION_BADGE_IDS）
-- certificationEvidence：Array<{ badgeId, description, imageUrls }>，私密證明資料，
--   只供 owner／有效共管者／admin 審核使用，不得出現在任何公開 API 回應中。

ALTER TABLE `factories`
  ADD COLUMN `certificationBadges` json NULL,
  ADD COLUMN `certificationEvidence` json NULL;
