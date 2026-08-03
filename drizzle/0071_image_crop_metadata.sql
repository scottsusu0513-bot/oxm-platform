-- 工廠頭貼／Logo、封面、相簿照片、商品圖片的「圖片顯示範圍」中繼資料欄位。
-- 所有新欄位皆為 nullable JSON，向下相容：既有資料一律為 NULL，前台 fallback
-- 成置中顯示（與目前既有 object-fit: cover 置中行為相同，外觀不變）；
-- 既有圖片仍可進入編輯器重新設定顯示範圍。
-- 本檔案本輪僅撰寫，不套用至任何資料庫（含 oxm_test），詳見任務指示。
ALTER TABLE `factories`
  ADD COLUMN `avatarCrop` json NULL AFTER `avatarUrl`,
  ADD COLUMN `coverCrop` json NULL AFTER `coverImageUrl`;

ALTER TABLE `factoryPhotos`
  ADD COLUMN `crop` json NULL AFTER `sortOrder`;

ALTER TABLE `products`
  ADD COLUMN `imageCrops` json NULL AFTER `images`;
