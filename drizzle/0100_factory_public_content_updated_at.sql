-- 工廠公開頁「資料最近維護時間」：新增 publicContentUpdatedAt，代表「這間
-- 工廠對外公開的資料最近一次被工廠端主動維護／儲存的時間」，與既有
-- factories.updatedAt 語意完全分離。
--
-- Root cause（已 audit）：updatedAt 在 schema 裡是
-- `.defaultNow().onUpdateNow()`（ON UPDATE CURRENT_TIMESTAMP），MySQL 對
-- 同一張表的任何一次 UPDATE（只要有欄位值真的改變）都會讓它跳動——包含
-- CRM contactStatus／adminNote（管理員專用備註）、審核狀態變更
-- （draft/pending/approved/rejected）、下架（delisted）、軟刪除
-- （deletedAt）、avgRating／reviewCount／avgResponseHours 等系統自動計算
-- 欄位，全部共用 server/db.ts 的 updateFactory() 或直接對 factories 表下
-- UPDATE。因此 updatedAt 不能拿來當「公開資料最近維護時間」顯示給使用者看。
--
-- 新欄位不掛 ON UPDATE CURRENT_TIMESTAMP，改成完全由應用層在偵測到白名單
-- 內的公開欄位（見 server/db.ts 的 PUBLIC_CONTENT_FACTORY_FIELDS）被工廠端
-- 主動送出儲存、或關聯的商品／工廠圖片實際新增／修改／刪除時，才明確 SET
-- 這個欄位——產品定義是「工廠近期仍有主動維護自己的公開資料」，只要工廠端
-- 執行公開資料的儲存／維護動作就可以刷新，不要求新值與舊值一定不同（例如
-- 工廠重新進後台確認資料後原封不動再存一次，仍視為一次主動維護）。
--
-- Backfill 策略：factories 只有單一 updatedAt，沒有任何 per-field 的異動
-- 歷史可回溯，無法精準重建「公開欄位上一次維護是哪一天」。採用使用者
-- 本人指定的第一優先策略——拿既有 updatedAt 當初始值：它雖然也會被前述
-- 非公開操作觸碰而不完全精準，但仍是唯一有歷史紀錄可查、且各工廠分散在
-- 建立以來不同日期的欄位，不會讓所有工廠 backfill 後一律變成「今天更新」
-- （這正是本次要避免的情況）。backfill 之後，往後所有工廠的
-- publicContentUpdatedAt 只會被應用層明確偵測到的公開內容維護動作觸發，
-- 不再依賴 updatedAt。
--
-- 新建立的工廠：欄位有 DEFAULT CURRENT_TIMESTAMP，INSERT 當下自動帶入
-- 建立時間，一開始就有合理初始值，不會是空值或 "—"。
--
-- Migration Safety（第二輪 release audit 修正）：MySQL 的 ALTER TABLE 一律
-- 隱性 COMMIT，不可能跟後續 UPDATE 合併成一個不可分割的交易——這是
-- MySQL/InnoDB 的固有限制，不是這個專案 runner 的問題。原本的兩步式寫法
-- （ADD COLUMN 當下就帶 NOT NULL DEFAULT CURRENT_TIMESTAMP，緊接著才
-- UPDATE backfill）有一個真實但短暫的風險窗口：ALTER TABLE 一旦執行完成，
-- MySQL 會立刻把「執行 ALTER 當下的時間」套用到所有既有列，若這時候剛好
-- 有人讀取、或後續 UPDATE 因故延遲／失敗，既有工廠會短暫顯示「今天維護」
-- ——這正是要避免的情況。改成三步式：
--   1. ADD COLUMN 時先不帶 NOT NULL、不帶 DEFAULT，既有列一律先是 NULL
--      （不是任何「現在」的隱含值；UI 端 formatPublicContentUpdatedAt 對
--      NULL 回傳 null、整行不顯示，不會顯示「今天」或壞字串）。
--   2. 明確 backfill 每一列。
--   3. 全部 backfill 完成後才 MODIFY COLUMN 鎖上 NOT NULL DEFAULT
--      CURRENT_TIMESTAMP——這一步本身也順便當一次自動驗證：如果 backfill
--      沒做完整、還有 NULL 列殘留，這一步會直接報錯擋下來，不會悄悄放行。
--
-- 只新增欄位＋一次性 backfill UPDATE，不 DROP、不 RENAME、不改動
-- updatedAt 的欄位定義或其他既有欄位的定義或既有資料。
--
-- Backfill 陳述式的第二個已知風險（已在正式站實際發生過一次，這裡修正
-- 是為了未來新環境／其他 DB 執行這支 migration 不會重蹈覆轍，不是要重跑
-- production）：只 `SET publicContentUpdatedAt = updatedAt` 而完全不提到
-- `updatedAt` 這個欄位本身，仍然會讓 `updatedAt` 被 MySQL 的
-- ON UPDATE CURRENT_TIMESTAMP 自動刷新成執行 migration 當下的時間——因為
-- MySQL 對這種欄位的規則是「這一列裡任何欄位值真的改變，且這個
-- ON UPDATE 欄位本身沒有在同一句 SET 裡被明確指定新值」就會自動套用目前
-- 時間；`publicContentUpdatedAt` 從 NULL 變成有值就已經算「這一列改變
-- 了」，於是連帶讓完全沒被提到的 `updatedAt` 也被刷新。
--
-- 解法（已在本機 MySQL 實際驗證，不是只憑文件推論）：backfill 這句
-- SET 子句裡明確也帶上 `updatedAt` = `updatedAt`（設成它自己原本的值）
-- ——只要一個欄位在 SET 子句裡被明確賦值，MySQL 就會直接採用你給的值，
-- 不會再套用 ON UPDATE CURRENT_TIMESTAMP 的自動時間。實測結果：
--   - `updatedAt` 維持原值，沒有被刷新成現在時間。
--   - `publicContentUpdatedAt` 正確 backfill 成 `updatedAt` 原值，不受影響。
--
-- 只套用到 local oxm / oxm_test，production 已用舊版（沒有這個修正）的
-- 兩段式 UPDATE 執行過，造成 production 47 筆 `updatedAt` 全部被刷新成
-- migration 當下時間（`publicContentUpdatedAt` 本身沒有受影響，已逐筆比對
-- 確認正確）；是否要對 production 額外執行
-- `UPDATE factories SET updatedAt = publicContentUpdatedAt;` 把
-- `updatedAt` 還原成原始歷史值，是後續另一個獨立決定，不包含在這支
-- migration 檔案裡。

ALTER TABLE `factories`
  ADD COLUMN `publicContentUpdatedAt` timestamp NULL;

UPDATE `factories`
SET
  `publicContentUpdatedAt` = `updatedAt`,
  `updatedAt` = `updatedAt`;

ALTER TABLE `factories`
  MODIFY COLUMN `publicContentUpdatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;
