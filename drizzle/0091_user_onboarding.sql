-- 新會員 Spotlight 新手導引（見 shared/onboarding.ts）：只記錄「是否已完成或
-- 略過」，不記錄每一步進度。欄位 nullable、無 default——套用這支 migration
-- 後，所有既有 users row 這欄都會是 NULL，這是刻意的：不得幫既有會員捏造
-- 一個「已完成導覽」的時間戳。是否需要顯示導覽，由 shared/onboarding.ts 的
-- userNeedsOnboarding() 依 users.createdAt 是否早於 ONBOARDING_LAUNCH_AT
-- 判斷（rollout 只影響這個常數上線之後才建立的新會員），不是單純看這欄是否
-- 為 NULL——因此舊會員即使這欄是 NULL，也不會被導覽攔住。
--
-- 這是獨立於 0090_user_consent.sql 的新 migration（0090 已進入既有 commit，
-- 不得回頭修改），只新增這一個欄位，不 UPDATE、不 backfill、不 DROP、不
-- RENAME 任何既有欄位。
--
-- 只套用到 local oxm / oxm_test，不套 production。

ALTER TABLE `users`
  ADD COLUMN `onboardingCompletedAt` timestamp NULL;
