-- 註冊條款 Consent Gate（見 shared/consent.ts）：服務條款與隱私權政策各自
-- 獨立記錄同意時間與版本。四個欄位全部 nullable、無 default——套用這支
-- migration 後，所有既有 users row 這四欄都會是 NULL，這是刻意的：不得幫
-- 既有會員捏造一個「已同意」的時間戳，這些會員實際上沒有完成這一版
-- Consent Gate。是否需要顯示 Consent Gate，由 shared/consent.ts 的
-- userNeedsConsent() 依 users.createdAt 是否早於 CONSENT_GATE_LAUNCH_AT
-- 判斷（rollout 只影響這個常數上線之後才建立的新會員），不是單純看這幾欄
-- 是否為 NULL——因此舊會員即使這四欄是 NULL，也不會被 Consent Gate 攔住。
--
-- 只套用到 local oxm / oxm_test，不套 production。

ALTER TABLE `users`
  ADD COLUMN `termsAcceptedAt` timestamp NULL,
  ADD COLUMN `termsVersion` varchar(20) NULL,
  ADD COLUMN `privacyAcceptedAt` timestamp NULL,
  ADD COLUMN `privacyVersion` varchar(20) NULL;
