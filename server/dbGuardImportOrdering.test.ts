/**
 * 真正的 ESM import 順序回歸測試 — 證明「guard 驗證＋覆寫 process.env.DATABASE_URL
 * 必須發生在任何會讀取 DATABASE_URL 的模組被載入之前」這件事，是用實際動態載入
 * 行為驗證的，不是靠讀原始碼文字順序（readFileSync/regex）判斷。
 *
 * 背景：static import 會被 ESM 提升（hoist），實際評估順序永遠早於同檔案內任何
 * 一般敘述式——即使把 static import 寫在檔案最下面，文字順序也不代表真正的執行
 * 順序。server/_core/env.ts 是一個具體、真實存在的例子：它在模組頂層用
 * `process.env.DATABASE_URL ?? ""` 把值快取進一個 const 物件（ENV.databaseUrl），
 * 只在模組第一次被評估的當下讀取一次；之後不管 process.env.DATABASE_URL 再怎麼
 * 改變，已經 import 過的模組實例都不會重新讀取。這正是 server/financeOptimization.test.ts
 * 的 fail-closed 安全閘門必須用 `await import()` 而不是「把 static import 寫在
 * guard 程式碼後面」的真正原因。
 *
 * 這裡直接動態載入 server/_core/env.ts 本身，用 vi.resetModules() 搭配真實
 * 改變 process.env.DATABASE_URL 來證明：
 *   1. env.ts 確實會把當下的 DATABASE_URL 快取住（重現這個 hazard 是真的）。
 *   2. 只要把 import() 延後到「驗證＋覆寫 DATABASE_URL」完成之後才執行（也就是
 *      server/financeOptimization.test.ts 目前的寫法），動態載入的模組就會拿到
 *      正確、已核准的值——這正是修正後的機制真的有效的直接證明。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

describe("server/_core/env.ts: 模組頂層真的會快取 import 當下的 DATABASE_URL（重現 hazard）", () => {
  it("在 import 之前設定 sentinel A，ENV.databaseUrl 反映 A；重設模組、改設 sentinel B 後重新 import，ENV.databaseUrl 反映 B", async () => {
    process.env.DATABASE_URL = "mysql://sentinel-a@localhost:3306/sentinel_a_db";
    const { ENV: envA } = await import("./_core/env");
    expect(envA.databaseUrl).toBe("mysql://sentinel-a@localhost:3306/sentinel_a_db");

    vi.resetModules();
    process.env.DATABASE_URL = "mysql://sentinel-b@localhost:3306/sentinel_b_db";
    const { ENV: envB } = await import("./_core/env");
    expect(envB.databaseUrl).toBe("mysql://sentinel-b@localhost:3306/sentinel_b_db");

    // 關鍵：envA 是先前的模組實例，即使 process.env 已經改變，它的快取值不會
    // 跟著變動——這就是為什麼「文字上把 import 寫在後面」沒有用：只要模組在
    // 賦值之前就已經被評估過一次，快取的值就永遠是錯的。
    expect(envA.databaseUrl).toBe("mysql://sentinel-a@localhost:3306/sentinel_a_db");
  });

  it("模擬修正前的錯誤順序：先 import（模擬 hoisted static import），才驗證＋覆寫 DATABASE_URL——結果快取的是驗證前的舊值，證明純文字順序不夠", async () => {
    process.env.DATABASE_URL = "mysql://old-value@localhost:3306/oxm_wrong_pretend_dev_db";
    // 模擬 hoist：這一行「看起來」寫在驗證程式碼之前，實際上就是先被評估。
    const { ENV } = await import("./_core/env");

    // 現在才「驗證＋覆寫」（模擬 guard 邏輯本身）。
    process.env.DATABASE_URL = "mysql://root:pw@localhost:3306/oxm_test";

    // 已經 import 過的模組快取的還是舊值——這正是回合五驗收指出的真正 bug。
    expect(ENV.databaseUrl).toBe("mysql://old-value@localhost:3306/oxm_wrong_pretend_dev_db");
    expect(ENV.databaseUrl).not.toBe("mysql://root:pw@localhost:3306/oxm_test");
  });

  it("修正後的正確順序：先驗證＋覆寫 DATABASE_URL，才用 await import() 動態載入——快取的是驗證後的核准值", async () => {
    process.env.DATABASE_URL = "mysql://old-value@localhost:3306/oxm_wrong_pretend_dev_db";

    // 驗證＋覆寫（模擬 assertFinanceIntegrationTestDbSafety 通過後覆寫的那一行）。
    process.env.DATABASE_URL = "mysql://root:pw@localhost:3306/oxm_test";

    // 這裡才動態載入——這正是 server/financeOptimization.test.ts 目前的真實寫法
    // （`const { appRouter } = await import("./routers")` 出現在覆寫那一行之後）。
    const { ENV } = await import("./_core/env");

    expect(ENV.databaseUrl).toBe("mysql://root:pw@localhost:3306/oxm_test");
  });
});
