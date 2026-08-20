# AI Governance Background Jobs — Production Scheduling

Phase 11.1 Audit 發現：這個目錄下的所有 job 都「已實作、有測試、可以在本機手動執行」，但**沒有任何一個在生產環境被實際排程執行過**——`pnpm dev`／`pnpm build` 都不會自動啟動它們，只能靠人手動跑 `pnpm run <job>:dev`。這是「30 分鐘 inactivity 收尾」「失敗摘要重試」等 lifecycle 設計實際上從未被 enforce 的根本原因。

Phase 11.2 只做到「準備好可以被排程執行的產物」，**沒有建立任何正式 Render 資源，也沒有部署**。以下記錄 production 上線時需要做的事。

## 為什麼是 Render Cron Job（而不是 user-request 觸發）

這些 job 的正確性依賴「不管有沒有人在用網站，都會定期執行」——如果改成掛在某個 HTTP request 的路徑上「順便」觸發，會退化回目前這種「使用者剛好回來才會被動觸發」的 lazy-only 行為，等於沒修。優先選擇跟主站 web process 完全獨立的排程機制。

OXM Web 正式站是 **Render**。Render 原生支援 **Cron Job**（一種獨立的 Render service 類型，設定一個 shell 指令 + cron 排程字串，由 Render 平台本身按時觸發執行，跟 web service 的 request/response 生命週期完全無關，也不需要 web process 保持啟動）——這正是「優先：獨立 background job，不要靠 user request 觸發」的最佳匹配。

PM2（`ecosystem.config.cjs`）目前只用來跑 web service 本身（cluster mode），支援 `cron_restart` 之類的排程能力，但那是設計來「定期重啟一個常駐 process」，不是「定期執行一個一次性 batch 腳本並讓它自然結束」，語意不合，這裡不採用。

## 已準備好的產物（本輪完成）

`pnpm build` 現在會額外把以下 job 編譯進 `dist/jobs/`（原本只有 `cleanupExpiredNewsAttachments.ts`）：

| Job | 產物 | 用途 |
|---|---|---|
| `finalizeInactiveAiConversations.ts` | `dist/jobs/finalizeInactiveAiConversations.js` | 主動收尾超過 30 分鐘沒有新訊息的 active 對話 |
| `retryFailedAiSummaries.ts` | `dist/jobs/retryFailedAiSummaries.js` | 重試收尾摘要失敗的對話（達 `MAX_SUMMARY_RETRY_COUNT` 上限後轉 `permanently_failed`，停止自動重試但保留原文） |
| `cleanupExpiredAiHandoffContexts.ts` | `dist/jobs/cleanupExpiredAiHandoffContexts.js` | 清除已過期、從未被使用者送出過的 handoff context |
| `retryPendingFactorySearchNotifications.ts` | `dist/jobs/retryPendingFactorySearchNotifications.js` | 重試人工協尋通知失敗／卡住的 request |
| `retryFailedAiCaseAssessments.ts` | `dist/jobs/retryFailedAiCaseAssessments.js` | 重試 AI 案件初判失敗／卡住的 assessment，含 missing-assessment recovery |

對應的 `package.json` script（production 用 `node dist/jobs/*.js`，本機開發用 `*:dev` 的 `tsx` 版本）：

```
pnpm run finalize:inactive-ai-conversations
pnpm run retry:failed-ai-summaries
pnpm run cleanup:expired-ai-handoff-contexts
pnpm run retry:pending-factory-search-notifications
pnpm run retry:failed-ai-case-assessments
```

`reconcileEnterpriseMemoryFactoryScope.ts`（Phase 11.2 的一次性資料遷移腳本，見 `drizzle/0087`／`0088`）刻意不加入這份排程清單——那是一次性工具，不是週期性 job，只保留 `pnpm run reconcile:enterprise-memory-factory-scope:dev`。

## Enterprise Memory migration order（Phase 13.2C）

`aiEnterpriseMemories` 從 user-scoped 改成 factory-scoped 這一段，正確的 production 執行順序是：

1. `0087_ai_enterprise_memory_quarantine.sql` — 建立 `aiEnterpriseMemoriesLegacyQuarantine` 隔離表。
2. `0088_ai_enterprise_memory_factory_scope.sql` — schema cutover：`userId` 改名為 `lastActorUserId`，`factoryId` 改成 `NOT NULL` + `UNIQUE`。
3. `reconcileEnterpriseMemoryFactoryScope.ts` — 分類／合併／隔離既有 legacy 資料。
4. `0089_ai_conversation_permanently_failed.sql` — `aiConversations.status` 加入 `permanently_failed`。

**不要照著 `0088_ai_enterprise_memory_factory_scope.sql` 檔案內那段舊註解操作**——那段註解寫著 reconciliation 應該在 0088 之前執行，但那是已確認過期、跟腳本實際可執行行為相反的敘述（見 Phase 13.2B/13.2B.1 稽核）：腳本的 `SELECT` 直接讀取 `lastActorUserId` 這個欄位名稱，這個欄位只有 0088 執行後才存在，在 0088 之前執行這支腳本會直接因為「未知欄位」失敗。`0088` SQL 檔案本身已經 production-applied、不能再修改，正確順序以本節與 `reconcileEnterpriseMemoryFactoryScope.ts` 檔案開頭的註解為準。

Production 已於 Phase 13.2B/13.2B.1 依此順序（0087 → 0088 → reconciliation → 0089）完整套用並驗證：reconciliation 在空表上執行得到 `totalRowsExamined: 0` 的 no-op 結果，10 張 OXM AI table 全部存在且 row count 皆為 0，`SHOW CREATE TABLE` 逐一核對與 `drizzle/schema.ts` 一致。

## Production 上線時需要建立的 Render Cron Job（本輪未建立，僅記錄）

每個 job 各自一個獨立的 Render Cron Job resource，`buildCommand` 沿用主站的 `pnpm build`（或指向同一個已建置的 image/repo），`command` 用上面對應的 `pnpm run <job>` 指令，環境變數（`DATABASE_URL`／`OPENAI_API_KEY` 等）比照主站 web service。

| Job | 建議排程頻率 | 理由 |
|---|---|---|
| `finalize:inactive-ai-conversations` | 每 10 分鐘 | 門檻本身是 30 分鐘，10 分鐘檢查一次讓「真正超過門檻」到「被收尾」的延遲控制在合理範圍，不會讓 raw conversation 多留太久 |
| `retry:failed-ai-summaries` | 每 30 分鐘 | 失敗多半是暫時性 LLM／DB 抖動，30 分鐘夠讓暫時性問題自己恢復，也不會讓永久性問題卡太久才被發現（見 `MAX_SUMMARY_RETRY_COUNT`） |
| `cleanup:expired-ai-handoff-contexts` | 每小時 | TTL 本身是 45 分鐘，一小時清一次足夠及時，且這只是清理未使用的過期資料，沒有即時性壓力 |
| `retry:pending-factory-search-notifications` | 每 10-15 分鐘 | Admin 需要盡快收到人工協尋通知，這條延遲比較敏感 |
| `retry:failed-ai-case-assessments` | 每 30 分鐘 | 跟摘要重試同一種「給暫時性問題時間自己恢復」的考量，AI 初判不是使用者當下等待的路徑 |

以上頻率僅為建議，實際上線時應依平台方案的 Cron Job 執行頻率下限與資源成本重新評估，但不應低於平台允許範圍。

## Logging

所有 job 的 CLI 輸出統一使用 `[OXM-AI][background][layer:<jobName>]` 前綴（沿用 Phase 10.2 的 `server/ai/aiCallContext.ts::formatAiLogContext` 同一套慣例），只印統計數字，不印任何逐字對話內容、企業摘要內容或使用者個資。
