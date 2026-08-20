import type { PoolConnection } from "mysql2/promise";
import { getRawPool } from "../db";
import { getTaipeiQuotaDate } from "./taipeiTime";
import {
  AI_FACTORY_DAILY_TURN_LIMIT,
  MAX_CONCURRENT_AI_TURNS_PER_FACTORY,
  AI_CONCURRENT_TURN_STALE_THRESHOLD_MINUTES,
} from "../../shared/ai/aiQuotaConfig";

/**
 * Phase 8.1：quota enforcement 唯一權威是 factoryAiDailyUsage（atomic
 * counter），aiUsageTurns 是 audit log／retry 去重鍵，兩者在同一個 FOR
 * UPDATE transaction 內一起變更，避免「兩個 co-manager 同時送出第 20 筆」
 * 這種 race（見對話中「六：P0 race condition safety」）。
 */
export interface FactoryAiQuotaStatus {
  limit: number;
  used: number;
  remaining: number;
  exhausted: boolean;
  quotaDate: string;
}

/** 唯讀查詢，給 UX 顯示「13/20」或 entitlement query endpoint 用，不做任何鎖定／變更。 */
export async function checkFactoryAiQuota(factoryId: number, at: Date = new Date()): Promise<FactoryAiQuotaStatus> {
  const quotaDate = getTaipeiQuotaDate(at);
  const pool = await getRawPool();
  const [rows]: any = await pool.execute(
    "SELECT usedTurns FROM factoryAiDailyUsage WHERE factoryId = ? AND quotaDate = ?",
    [factoryId, quotaDate]
  );
  const used = rows[0]?.usedTurns ?? 0;
  return {
    limit: AI_FACTORY_DAILY_TURN_LIMIT,
    used,
    remaining: Math.max(0, AI_FACTORY_DAILY_TURN_LIMIT - used),
    exhausted: used >= AI_FACTORY_DAILY_TURN_LIMIT,
    quotaDate,
  };
}

export interface ReserveAiTurnParams {
  /** admin 無工廠語境時為 null（見 entitlement.ts），此時完全不觸碰 factoryAiDailyUsage。 */
  factoryId: number | null;
  actorUserId: number;
  conversationId: number | null;
  /** 同一個 user-visible turn 的第一次送出與所有 retry 共用同一個值（server-authoritative 去重鍵）。 */
  clientTurnId: string;
  /** admin bypass：即使有 factoryId 也不檢查／不扣每日額度，但仍建立 audit row。 */
  bypassQuota: boolean;
}

export type ReserveAiTurnResult =
  | { ok: true; turnId: number; quotaCharged: boolean; isRetry: boolean }
  | { ok: false; reason: "quota_exhausted"; status: FactoryAiQuotaStatus }
  | { ok: false; reason: "ai_busy" };

/**
 * Phase 12.2（見對話「十一」）：concurrency 判斷跟 quota／retry 去重共用
 * 同一個 transaction，鎖點是「一定已經存在的 parent row」（factories.id 或
 * users.id），而不是對還沒有任何列的 aiUsageTurns 做 SELECT...FOR UPDATE——
 * 後者是純粹的 phantom/gap lock、鎖不到任何東西，兩個同時發生的新
 * clientTurnId 請求會同時看到「目前沒有 started」而一起放行，等於没鎖（這
 * 正是 Phase 8.2 對 aiConversations 採用同樣手法要避開的那類 race，見對話
 * 歷史「applyFactorySourcingDecision 用一定存在的 conversation parent row
 * 上鎖」）。鎖住 factories/users 的既有列之後，同一個 key 底下的所有
 * reserveAiTurn 呼叫（不管是不是同一個 clientTurnId）會被序列化，之後再做
 * 的「掃描目前是否有其他 started 且未過 10 分鐘」查詢才是真正原子的。
 */
async function lockConcurrencyKeyRow(
  conn: PoolConnection,
  factoryId: number | null,
  actorUserId: number
): Promise<void> {
  if (factoryId !== null) {
    await conn.execute("SELECT id FROM factories WHERE id = ? FOR UPDATE", [factoryId]);
  } else {
    await conn.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [actorUserId]);
  }
}

/** 鎖定 concurrency key 之後，判斷目前是否已有其他（不同 clientTurnId 的）turn 正在跑。 */
async function hasOtherActiveTurnLocked(
  conn: PoolConnection,
  factoryId: number | null,
  actorUserId: number
): Promise<boolean> {
  const [rows]: any = await conn.execute(
    factoryId !== null
      ? `SELECT COUNT(*) as cnt FROM aiUsageTurns
          WHERE factoryId = ? AND status = 'started'
            AND createdAt > (NOW() - INTERVAL ${AI_CONCURRENT_TURN_STALE_THRESHOLD_MINUTES} MINUTE)`
      : `SELECT COUNT(*) as cnt FROM aiUsageTurns
          WHERE factoryId IS NULL AND actorUserId = ? AND status = 'started'
            AND createdAt > (NOW() - INTERVAL ${AI_CONCURRENT_TURN_STALE_THRESHOLD_MINUTES} MINUTE)`,
    [factoryId !== null ? factoryId : actorUserId]
  );
  const cnt = rows[0]?.cnt ?? 0;
  return cnt >= MAX_CONCURRENT_AI_TURNS_PER_FACTORY;
}

/** 在同一個 transaction／connection 內做「quota 是否還有額度、有的話 +1」，回傳是否成功扣到。 */
async function tryChargeQuotaLocked(
  conn: PoolConnection,
  factoryId: number,
  quotaDate: string
): Promise<{ charged: boolean; status: FactoryAiQuotaStatus }> {
  // 先確保這個 (factoryId, quotaDate) 的計數列存在（不存在就以 0 建立）。
  // Phase 8.2（見對話中「四：原子性」P0 稽核）：這裡原本用
  // `ON DUPLICATE KEY UPDATE id = id`，實測在「當天第一筆請求、兩個
  // transaction 同時搶著建立同一個 (factoryId, quotaDate) 計數列」這個情境
  // 下會真的觸發 MySQL InnoDB deadlock（`ON DUPLICATE KEY UPDATE` 偵測到
  // 重複鍵之後還要走一次 update 路徑，需要把 insert intention lock 升級成
  // next-key lock，兩個同時搶進來的 transaction 互相等對方釋放就會死鎖）。
  // 改成 `INSERT IGNORE`：偵測到重複鍵時單純跳過、不需要升級鎖，是 MySQL
  // 官方文件推薦處理「並發 insert 同一個 unique key」的寫法，行為對這裡的
  // 需求（只要保證列存在）完全等價，且不會有這個死鎖路徑。
  await conn.execute(
    "INSERT IGNORE INTO factoryAiDailyUsage (factoryId, quotaDate, usedTurns) VALUES (?, ?, 0)",
    [factoryId, quotaDate]
  );
  // 這次 SELECT ... FOR UPDATE 保證能鎖到剛剛已確保存在的那一列，鎖住到
  // commit／rollback 為止，讓同時發生的另一個 transaction 必須排隊等待——
  // 這是防止「第 20／21 筆同時送出」race 的關鍵鎖點。
  const [rows]: any = await conn.execute(
    "SELECT usedTurns FROM factoryAiDailyUsage WHERE factoryId = ? AND quotaDate = ? FOR UPDATE",
    [factoryId, quotaDate]
  );
  const used = rows[0]?.usedTurns ?? 0;
  const status: FactoryAiQuotaStatus = {
    limit: AI_FACTORY_DAILY_TURN_LIMIT,
    used,
    remaining: Math.max(0, AI_FACTORY_DAILY_TURN_LIMIT - used),
    exhausted: used >= AI_FACTORY_DAILY_TURN_LIMIT,
    quotaDate,
  };
  if (status.exhausted) return { charged: false, status };

  await conn.execute(
    "UPDATE factoryAiDailyUsage SET usedTurns = usedTurns + 1 WHERE factoryId = ? AND quotaDate = ?",
    [factoryId, quotaDate]
  );
  return {
    charged: true,
    status: { ...status, used: used + 1, remaining: Math.max(0, AI_FACTORY_DAILY_TURN_LIMIT - (used + 1)), exhausted: used + 1 >= AI_FACTORY_DAILY_TURN_LIMIT },
  };
}

/**
 * Server-authoritative 的「這一輪能不能開始」判斷 + 原子扣額度。見對話中
 * 「三、四、五、六、十」：
 * - 同一個 (factoryId, clientTurnId) 最多只會有一筆 aiUsageTurns row，重複
 *   呼叫（前端 retry）一律沿用同一筆、只累加 attemptCount。
 * - factoryId 為 null 時（admin 無工廠語境）MySQL 唯一索引不會擋重複值，
 *   改用 actorUserId+clientTurnId 找既有 row，涵蓋這個邊界情況（見
 *   schema.ts aiUsageTurns.factoryId 上方註解）。
 * - 只有「這筆 row 之前從未被扣過額度」（quotaCharged=false，包含全新 row
 *   與被 failAiTurn 退款過的 row 兩種情況）才會真的走 quota 檢查／扣款；
 *   已經扣過的 retry 不會重新檢查，也不會重複扣。
 */
/**
 * Phase 8.2（見對話中「四：原子性」P0 稽核）：InnoDB 在「同一個 factoryId
 * 底下，兩個 transaction 幾乎同時對不存在的 (factoryId, clientTurnId) 做
 * SELECT ... FOR UPDATE、接著都要 INSERT」這個情境下，即使已經改用
 * INSERT IGNORE，兩邊的 gap lock 仍可能互相卡住觸發真實 deadlock（實測用
 * H3／H4 兩個測試重現過）——這是 InnoDB 對「並發 insert 進同一段 gap」的
 * 已知、正常行為，不是程式邏輯錯誤，MySQL 官方文件本身就建議應用層對
 * deadlock 做重試，不是想辦法完全避免（避免通常需要犧牲其他正確性保證，
 * 例如降低 isolation level）。deadlock 發生時 InnoDB 保證兩個 transaction
 * 中一定有一個被安全 rollback（不會有一半寫入的髒狀態），重試整個
 * reserveAiTurn 是安全的（同一組參數重跑一次，不會重複扣款——見上方去重
 * 邏輯本身就是 idempotent 的）。
 */
const DEADLOCK_ERROR_CODE = "ER_LOCK_DEADLOCK";
const MAX_DEADLOCK_RETRIES = 3;

function isDeadlockError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === DEADLOCK_ERROR_CODE;
}

export async function reserveAiTurn(params: ReserveAiTurnParams): Promise<ReserveAiTurnResult> {
  for (let attempt = 1; attempt <= MAX_DEADLOCK_RETRIES; attempt++) {
    try {
      return await reserveAiTurnAttempt(params);
    } catch (err) {
      if (isDeadlockError(err) && attempt < MAX_DEADLOCK_RETRIES) continue;
      throw err;
    }
  }
  // 理論上跑不到這裡（迴圈最後一次 iteration 一定 return 或 throw），只是滿足 TS 的回傳型別檢查。
  throw new Error("reserveAiTurn: unreachable retry loop exit");
}

async function reserveAiTurnAttempt(params: ReserveAiTurnParams): Promise<ReserveAiTurnResult> {
  const { factoryId, actorUserId, conversationId, clientTurnId, bypassQuota } = params;
  const quotaDate = getTaipeiQuotaDate();
  const pool = await getRawPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Phase 12.2（見對話「十一」）：concurrency 鎖必須在「判斷是不是同一個
    // clientTurnId 的 retry」之前就序列化整個 key，否則兩個同時發生的新
    // clientTurnId 請求會各自在鎖之外做完「查不到既有 row」的判斷，等鎖到
    // 手才發現對方已經插入——這時已經太晚（quota 可能都已經算過）。
    await lockConcurrencyKeyRow(conn, factoryId, actorUserId);

    const [existingRows]: any = await conn.execute(
      factoryId === null
        ? "SELECT * FROM aiUsageTurns WHERE factoryId IS NULL AND actorUserId = ? AND clientTurnId = ? FOR UPDATE"
        : "SELECT * FROM aiUsageTurns WHERE factoryId = ? AND clientTurnId = ? FOR UPDATE",
      factoryId === null ? [actorUserId, clientTurnId] : [factoryId, clientTurnId]
    );
    const existing = existingRows[0];

    if (existing) {
      if (existing.quotaCharged || bypassQuota || factoryId === null) {
        // 已扣過額度，或本來就不需要扣（admin bypass／無工廠語境）：純粹是
        // 同一筆 turn 的 retry，只累加 attemptCount，不重新檢查／扣 quota。
        await conn.execute("UPDATE aiUsageTurns SET attemptCount = attemptCount + 1, status = 'started' WHERE id = ?", [existing.id]);
        await conn.commit();
        return { ok: true, turnId: existing.id, quotaCharged: !!existing.quotaCharged, isRetry: true };
      }

      // 前一次嘗試在真正呼叫 provider 之前就失敗、已被 failAiTurn 退款
      // （quotaCharged=false）——這次 retry 視同全新的 quota 檢查，重用同一
      // 筆 row，不會另外新增 audit row（見對話中「十」）。
      const charge = await tryChargeQuotaLocked(conn, factoryId, quotaDate);
      if (!charge.charged) {
        await conn.rollback();
        return { ok: false, reason: "quota_exhausted", status: charge.status };
      }
      await conn.execute(
        "UPDATE aiUsageTurns SET attemptCount = attemptCount + 1, status = 'started', quotaCharged = TRUE WHERE id = ?",
        [existing.id]
      );
      await conn.commit();
      return { ok: true, turnId: existing.id, quotaCharged: true, isRetry: true };
    }

    // Phase 12.2（見對話「十二」）：只有「這是一個全新的 clientTurnId」才需要
    // busy 判斷——同一筆 turn 的 retry 已經在上面的 `existing` 分支處理完並
    // return 掉了，不會走到這裡，所以這裡找到的任何一筆 started row 一定是
    // 別的 turn，不需要另外排除自己。busy 不扣 quota、不建立任何 row（見
    // 「八」）。
    if (await hasOtherActiveTurnLocked(conn, factoryId, actorUserId)) {
      await conn.rollback();
      return { ok: false, reason: "ai_busy" };
    }

    let quotaCharged = false;
    if (factoryId !== null && !bypassQuota) {
      const charge = await tryChargeQuotaLocked(conn, factoryId, quotaDate);
      if (!charge.charged) {
        await conn.rollback();
        return { ok: false, reason: "quota_exhausted", status: charge.status };
      }
      quotaCharged = true;
    }

    const [insertResult]: any = await conn.execute(
      `INSERT INTO aiUsageTurns
        (factoryId, actorUserId, conversationId, clientTurnId, quotaDate, status, quotaCharged, attemptCount, createdAt)
       VALUES (?, ?, ?, ?, ?, 'started', ?, 1, NOW())`,
      [factoryId, actorUserId, conversationId, clientTurnId, quotaDate, quotaCharged]
    );

    await conn.commit();
    return { ok: true, turnId: insertResult.insertId, quotaCharged, isRetry: false };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 這一輪成功完成——記錄最終分類結果，不影響 quotaCharged／counter。
 * conversationId 可選：reserveAiTurn 當下這段對話可能還沒被
 * resolveConversationForTurn 解析／建立出來，這裡讓呼叫端在拿到真正的
 * conversation.id 後補寫回去（純 audit 用途，不影響 quota 正確性）。
 */
export async function completeAiTurn(
  turnId: number,
  details: { intent?: string | null; resourceTarget?: string | null; conversationId?: number | null } = {}
): Promise<void> {
  const pool = await getRawPool();
  if (details.conversationId !== undefined) {
    await pool.execute(
      "UPDATE aiUsageTurns SET status = 'completed', intent = ?, resourceTarget = ?, conversationId = ?, completedAt = NOW() WHERE id = ?",
      [details.intent ?? null, details.resourceTarget ?? null, details.conversationId, turnId]
    );
  } else {
    await pool.execute(
      "UPDATE aiUsageTurns SET status = 'completed', intent = ?, resourceTarget = ?, completedAt = NOW() WHERE id = ?",
      [details.intent ?? null, details.resourceTarget ?? null, turnId]
    );
  }
}

/**
 * 這一輪失敗。只有「當初真的扣過額度」且「完全沒有發生過任何 provider
 * 呼叫」（用 aiModelCalls 是否有這個 turnId 的 row 來判斷，是可驗證的事實，
 * 不是猜測）才退款；只要有一次 provider 呼叫發生過，即使那次呼叫本身失敗，
 * 也代表已經產生真實成本，不退（見對話中「四：Failure/退款政策」）。
 */
export async function failAiTurn(turnId: number): Promise<void> {
  const pool = await getRawPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [turnRows]: any = await conn.execute("SELECT * FROM aiUsageTurns WHERE id = ? FOR UPDATE", [turnId]);
    const turn = turnRows[0];
    if (!turn) {
      await conn.rollback();
      return;
    }

    const [callRows]: any = await conn.execute("SELECT COUNT(*) as cnt FROM aiModelCalls WHERE turnId = ?", [turnId]);
    const hadProviderCall = (callRows[0]?.cnt ?? 0) > 0;

    if (turn.quotaCharged && !hadProviderCall && turn.factoryId !== null) {
      await conn.execute(
        "UPDATE factoryAiDailyUsage SET usedTurns = GREATEST(usedTurns - 1, 0) WHERE factoryId = ? AND quotaDate = ?",
        [turn.factoryId, turn.quotaDate]
      );
      await conn.execute("UPDATE aiUsageTurns SET status = 'failed', quotaCharged = FALSE, completedAt = NOW() WHERE id = ?", [turnId]);
    } else {
      await conn.execute("UPDATE aiUsageTurns SET status = 'failed', completedAt = NOW() WHERE id = ?", [turnId]);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
