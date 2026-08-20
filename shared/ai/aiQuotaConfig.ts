/**
 * Phase 8.1：OXM AI 每日額度唯一來源。前端／後端／測試都必須從這裡取值，
 * 不得各自硬寫 20（見對話中「十二」）。額度是以「工廠」為單位（owner／
 * co-manager 共用），不是以使用者為單位——見 server/ai/entitlement.ts。
 */
export const AI_FACTORY_DAILY_TURN_LIMIT = 20;

/**
 * Phase 12.2（見對話「六」）：同一 concurrency key（工廠成員：factoryId；
 * Admin 無工廠語境：actorUserId，見 server/ai/aiQuota.ts）同時最多允許幾筆
 * user-visible AI turn 處於 'started'。OXM AI 是企業顧問式對話、非高併發
 * API，上一輪還在跑時讓下一輪同時執行容易造成 conversation state race，
 * 第一版刻意設 1（見「六」）。
 */
export const MAX_CONCURRENT_AI_TURNS_PER_FACTORY = 1;

/**
 * Phase 12.2（見對話「十」）：跟 concurrency guard 綁在一起判斷「這筆
 * started 是不是還算真的在跑」的門檻——刻意跟 Phase 10.2
 * getStaleStartedTurns 的 10 分鐘門檻用同一個數字（同樣的「一輪 AI turn
 * 正常應該在同一次 request 內同步完成」前提），但兩處分別維護各自的常數、
 * 不共用同一個 import，避免這輪改動牽動到已經上線驗證過的 Admin Dashboard
 * 稽核邏輯。
 */
export const AI_CONCURRENT_TURN_STALE_THRESHOLD_MINUTES = 10;
