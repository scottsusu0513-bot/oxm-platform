/**
 * 環境變數覆寫／還原的純邏輯 helper — 第九輪修正（Medium #3）。
 *
 * 刻意獨立成一個完全不 import ../db、../routers 或任何會連線資料庫／讀取
 * server/_core/env.ts 的檔案：財務優化整合測試（例如
 * server/financeOptimizationNotificationIsolation.test.ts）需要在「任何會
 * 快取 ADMIN_WHITELIST_EMAILS 的模組被動態載入之前」就先覆寫環境變數，若這
 * 支 helper 本身靜態 import 了 ../db（例如與 server/_core/financeTestFixtures.ts
 * 放在同一個檔案），單純 import 這支 helper 就會連帶把 ../db 提早載入、把
 * ADMIN_WHITELIST_EMAILS 快取成覆寫前的原始值，反而破壞這裡想保護的東西。
 * 因此這裡只做最單純的 process.env 讀寫，可以安全地用 static import 使用。
 */

export interface EnvOverrideGuard {
  /** 覆寫前的原始值；undefined 代表覆寫前這個環境變數本來就沒有設定。 */
  original: string | undefined;
  /** idempotent：呼叫幾次效果都一樣，恢復成 original（或刪除，如果原本未定義）。 */
  restore: () => void;
}

export function createEnvOverrideGuard(envVarName: string, newValue: string): EnvOverrideGuard {
  const original = process.env[envVarName];
  process.env[envVarName] = newValue;
  return {
    original,
    restore: () => {
      if (original === undefined) delete process.env[envVarName];
      else process.env[envVarName] = original;
    },
  };
}

/**
 * 執行 fn()；若 fn() 拋錯，先呼叫 restore() 還原環境變數，再重新拋出同一個
 * 錯誤。成功時直接回傳 fn() 的結果，不會呼叫 restore()（覆寫必須繼續生效到
 * 測試真正結束，由呼叫端自己的 afterAll 還原）。
 */
export async function runProtected<T>(restore: () => void, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    restore();
    throw err;
  }
}
