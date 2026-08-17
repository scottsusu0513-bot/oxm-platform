-- OXM AI Enterprise Memory 修正：每次對話摘要不得直接 blind overwrite 長期
-- 記憶（會把之前真正重要的企業資訊洗掉）。改成：
--   1. summaryText / hasMeaningfulBusinessInfo 代表「目前最新、合併後」的
--      長期狀態，由 server/ai/memory.ts 的 mergeEnterpriseMemory() 產生。
--   2. 新增 lastInteractionAt / lastInteractionHadMeaningfulInfo，獨立描述
--      「最近一次互動」本身有沒有新資訊，即使沒有也不會清空上面的長期狀態。
--
-- 遷移編號說明：0080_ai_enterprise_memory.sql 已經套用在本機 dev DB（oxm）與
-- 本機測試 DB（oxm_test），依專案慣例不回頭改寫已套用的歷史 migration。
-- 只對本機兩個 DB 執行，不碰 production。

ALTER TABLE `aiEnterpriseMemories`
  ADD COLUMN `lastInteractionAt` timestamp NOT NULL DEFAULT (now()) AFTER `hasMeaningfulBusinessInfo`,
  ADD COLUMN `lastInteractionHadMeaningfulInfo` boolean NOT NULL DEFAULT false AFTER `lastInteractionAt`;
