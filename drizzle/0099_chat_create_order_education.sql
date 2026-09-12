-- 聊天室「建立訂單」功能教育提示（Spotlight／買方端提醒／20 則 Bubble）。
-- 見 shared/chatEducation.ts、server/db.ts 的 claimChatEducationTip、
-- client/src/pages/ChatPage.tsx 的教育提示 hook。
--
-- 背景：聊天室左下角「建立合作確認單」入口目前只有工廠端（owner／
-- co-manager）看得到、點得到，買方（詢價人）完全沒有這個按鈕。因此拆成三層
-- 提示，各自獨立記錄「這個 conversation 是否已顯示過」：
--   conversations.factorySpotlightShownAt — 工廠端第一次進入 conversation
--     的 Spotlight 強提醒（凸顯真正的建立訂單入口）。
--   conversations.buyerTipShownAt — 買方在新 conversation 成功送出第一則
--     訊息後的一般提醒（買方端沒有按鈕可挖洞，改用一般 modal）。
--   conversations.orderTipBubbleShownAt — 雙方有效聊天訊息達 20 則（且雙方
--     都至少各 1 則）後，給工廠端看的小提醒 Bubble。
-- 三欄皆 nullable、無 default，套用後所有既有 conversation 這三欄都是
-- NULL——這是「尚未顯示過」的自然狀態，不需要、也不應該 backfill。
--
-- users.chatFactorySpotlightTipCount / chatBuyerOrderTipCount — 帳號
-- lifetime 計數器，工廠端 Spotlight 與買方端提醒各自獨立累計，各自上限 5
-- 個不同 conversation（20 則 Bubble 不受此上限限制，只受「同一 conversation
-- 最多一次」限制，靠上面的 orderTipBubbleShownAt 就足夠，不需要額外計數器）。
-- 皆 default 0，既有帳號套用後從 0 開始計算，不影響既有行為。
--
-- 只新增欄位，不 UPDATE、不 backfill、不 DROP、不 RENAME 任何既有欄位。
-- 只套用到 local oxm / oxm_test，不套 production。

ALTER TABLE `conversations`
  ADD COLUMN `factorySpotlightShownAt` timestamp NULL,
  ADD COLUMN `buyerTipShownAt` timestamp NULL,
  ADD COLUMN `orderTipBubbleShownAt` timestamp NULL;

ALTER TABLE `users`
  ADD COLUMN `chatFactorySpotlightTipCount` int NOT NULL DEFAULT 0,
  ADD COLUMN `chatBuyerOrderTipCount` int NOT NULL DEFAULT 0;
