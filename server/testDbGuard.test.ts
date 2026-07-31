/**
 * 全域 server/test-db-guard.ts（套用到所有 server/**\/*.test.ts 的 vitest
 * setupFiles）fail-closed 邏輯 — 純邏輯單元測試。
 *
 * 這裡只 import server/test-db-guard.ts 匯出的純函式（checkTestDbSafety／
 * assertTestDbSafety），完全不重新觸發模組頂層的 resolveTestDbUrl() 副作用
 * 之外的任何額外連線行為——這些函式本身不 import mysql2、不 import ./db、
 * 不讀寫網路，純粹是字串／URL 解析與比對。
 *
 * 用一個埠號 1（localhost:1，保證沒有任何服務在監聽、连接一定會被拒絕）組成
 * 的假網址驗證：資料庫名稱錯誤／缺少必要條件時，拒絕來自 checkTestDbSafety
 * 本身同步回傳的判斷結果，而不是任何實際嘗試連線後才出現的 ECONNREFUSED —
 * 因為函式從頭到尾都不曾建立任何 TCP 連線，光是這一點就直接證明「驗證發生在
 * 任何 DB 連線嘗試之前」，不需要靠原始碼文字順序（readFileSync/regex）判斷。
 */
import { describe, expect, it } from "vitest";
import {
  checkTestDbSafety,
  assertTestDbSafety,
  isLoopbackHost,
  APPROVED_TEST_DATABASE_NAME,
  REQUIRED_NODE_ENV,
} from "./test-db-guard";

const UNREACHABLE_LOOPBACK_PORT_URL = "mysql://root:pw@localhost:1/oxm_test";

function validInput(overrides?: Partial<Parameters<typeof checkTestDbSafety>[0]>) {
  return {
    nodeEnv: "test",
    testDatabaseUrl: undefined,
    databaseUrl: "mysql://root:supersecretpassword@localhost:3306/oxm_test",
    ...overrides,
  };
}

describe("checkTestDbSafety: 正確環境放行", () => {
  it("NODE_ENV=test + DATABASE_URL=localhost/oxm_test：通過", () => {
    const result = checkTestDbSafety(validInput());
    expect(result.ok).toBe(true);
    expect(result.host).toBe("localhost");
    expect(result.database).toBe(APPROVED_TEST_DATABASE_NAME);
    expect(result.label).toBe("DATABASE_URL");
  });

  it("TEST_DATABASE_URL 存在時優先於 DATABASE_URL fallback", () => {
    const result = checkTestDbSafety(validInput({
      testDatabaseUrl: "mysql://root:pw@127.0.0.1:3306/oxm_test",
      databaseUrl: "mysql://root:pw@localhost:3306/oxm", // 就算 fallback 是正式 DB 也不會被用到
    }));
    expect(result.ok).toBe(true);
    expect(result.label).toBe("TEST_DATABASE_URL");
    expect(result.host).toBe("127.0.0.1");
  });

  it("127.0.0.1 與 ::1 也視為合法 loopback host", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });
});

describe("checkTestDbSafety: 資料庫名稱必須精確等於 oxm_test，不能用環境變數覆蓋", () => {
  it("DATABASE_URL 指向真正的正式/開發資料庫 oxm（非 oxm_test）：拒絕", () => {
    const result = checkTestDbSafety(validInput({ databaseUrl: "mysql://root:pw@localhost:3306/oxm" }));
    expect(result.ok).toBe(false);
    expect(result.host).toBe("localhost");
    expect(result.database).toBe("oxm");
    expect(result.reason).toMatch(/must be exactly "oxm_test"/);
  });

  it("TEST_DATABASE_URL 指向相似但不精確相符的資料庫名稱：拒絕", () => {
    const result = checkTestDbSafety(validInput({ testDatabaseUrl: "mysql://root:pw@localhost:3306/oxm_test2" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must be exactly "oxm_test"/);
  });

  it("用假的 localhost:1（保證沒有服務在監聽、連線必定被拒絕）驗證：拒絕的是資料庫名稱檢查本身，而不是任何連線嘗試——" +
    "函式同步回傳結果、從未建立過任何 TCP 連線，證明驗證發生在 DB 連線之前", () => {
    const result = checkTestDbSafety(validInput({ databaseUrl: UNREACHABLE_LOOPBACK_PORT_URL.replace("oxm_test", "wrong_db") }));
    expect(result.ok).toBe(false);
    expect(result.host).toBe("localhost");
    expect(result.reason).toMatch(/must be exactly "oxm_test"/);
  });

  it("即使 host 看起來是 localhost（例如 tunnel 情境），資料庫名稱不是 oxm_test 一樣拒絕，不能只信任 host", () => {
    const result = checkTestDbSafety(validInput({ databaseUrl: "mysql://root:pw@localhost:3306/oxm_production_snapshot" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must be exactly "oxm_test"/);
  });
});

describe("checkTestDbSafety: 非 loopback host 一律拒絕", () => {
  it("遠端/Railway host 被拒絕，即使資料庫名稱剛好是 oxm_test", () => {
    const result = checkTestDbSafety(validInput({ databaseUrl: "mysql://root:pw@containers-us-west-1.railway.app:6543/oxm_test" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not an approved loopback host/);
  });
});

describe("checkTestDbSafety: NODE_ENV 必須精確是 test", () => {
  it("NODE_ENV=development 被拒絕（即使 URL 正確）", () => {
    const result = checkTestDbSafety(validInput({ nodeEnv: "development" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/NODE_ENV/);
  });

  it("NODE_ENV 未設定被拒絕", () => {
    const result = checkTestDbSafety(validInput({ nodeEnv: undefined }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/NODE_ENV/);
  });
});

describe("checkTestDbSafety: 缺少任何候選網址時安全拒絕，不拋例外", () => {
  it("TEST_DATABASE_URL 與 DATABASE_URL 都未設定：拒絕", () => {
    const result = checkTestDbSafety({ nodeEnv: REQUIRED_NODE_ENV, testDatabaseUrl: undefined, databaseUrl: undefined });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no TEST_DATABASE_URL or DATABASE_URL/);
  });

  it("網址不是合法 URI 時安全回傳失敗，不拋例外", () => {
    const result = checkTestDbSafety(validInput({ databaseUrl: "not a valid url" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/could not be parsed/);
  });
});

describe("assertTestDbSafety: 錯誤訊息不外洩帳密／完整網址", () => {
  it("成功時回傳 url／host／database", () => {
    const result = assertTestDbSafety(validInput());
    expect(result.host).toBe("localhost");
    expect(result.database).toBe(APPROVED_TEST_DATABASE_NAME);
  });

  it("失敗時拋出的錯誤訊息不包含密碼字串本身", () => {
    const secretPassword = "supersecretpassword";
    try {
      assertTestDbSafety(validInput({ databaseUrl: `mysql://root:${secretPassword}@evil-prod-host.example.com:3306/oxm` }));
      expect.fail("should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(secretPassword);
      expect(message).not.toContain("root:");
    }
  });
});
