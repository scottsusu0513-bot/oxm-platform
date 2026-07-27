-- 徽章系統：拆開「擁有權」與「公開顯示」
-- 尚未執行 —— 僅建立 migration 檔，依作業指示不可執行 migration/db:push 到正式資料庫。
--
-- certificationBadges（既有欄位）：工廠「已獲得」的徽章 id 清單，只能透過工廠審核／
--   修改申請審核（approveFactory／approveRevisionAtomic）新增，一般更新／修改申請不得移除。
-- certificationBadgesVisible（新欄位）：certificationBadges 的子集合，工廠可自由切換是否
--   顯示於公開頁面／搜尋卡片，不需任何審核。伺服器端寫入時一律驗證為 certificationBadges 的子集合。

ALTER TABLE `factories`
  ADD COLUMN `certificationBadgesVisible` json NULL;

-- 現有已核准徽章預設維持公開顯示：只處理 status='approved' 且 certificationBadges
-- 非空的工廠——系統設計上從未有更細顆粒度的單一徽章審核紀錄
-- （approveFactory／approveRevisionAtomic 是唯一授予管道），因此把目前
-- certificationBadges 整組回填為 certificationBadgesVisible 是唯一安全、不需
-- 猜測的規則，且等同於現況（backfill 前這些徽章本來就已經在公開頁面顯示）。
-- NULL／空陣列／非 approved 狀態一律不觸發（WHERE 條件天然排除，不需要另外
-- 判斷），也完全不涉及 factoryRevisions 表，proposedData 不會被誤授予。
UPDATE `factories`
SET `certificationBadgesVisible` = `certificationBadges`
WHERE `status` = 'approved'
  AND `certificationBadges` IS NOT NULL
  AND JSON_LENGTH(`certificationBadges`) > 0;
