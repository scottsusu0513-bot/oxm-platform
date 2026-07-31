/**
 * 財務整合測試 fail-closed DB 安全閘門 — 純邏輯單元測試。
 *
 * 這裡完全不連線任何資料庫（不 import ./db、不呼叫 getDb()），只驗證
 * server/_core/financeIntegrationTestDbGuard.ts 的判斷邏輯本身：
 * 正確環境放行、production／Railway host 拒絕、非測試 DB 名稱拒絕、
 * 缺少 opt-in 拒絕、缺少 NODE_ENV=test 拒絕、錯誤訊息不外洩帳密。
 */
import { describe, expect, it } from "vitest";
import {
  checkFinanceIntegrationTestDbSafety,
  assertFinanceIntegrationTestDbSafety,
  isLoopbackHost,
} from "./_core/financeIntegrationTestDbGuard";

const VALID_URL = "mysql://root:supersecretpassword@localhost:3306/oxm_test";

function validInput(overrides?: Partial<Parameters<typeof checkFinanceIntegrationTestDbSafety>[0]>) {
  return {
    nodeEnv: "test",
    optInFlag: "1",
    databaseUrl: VALID_URL,
    ...overrides,
  };
}

describe("checkFinanceIntegrationTestDbSafety: 正確環境放行", () => {
  it("NODE_ENV=test + opt-in=1 + localhost + oxm_test：全部通過", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput());
    expect(result.ok).toBe(true);
    expect(result.host).toBe("localhost");
    expect(result.database).toBe("oxm_test");
  });

  it("127.0.0.1 與 ::1 也視為合法 loopback host", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
  });

  it("允許透過 allowedTestDatabaseNames 客製其他明確核准的測試資料庫名稱", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({
      databaseUrl: "mysql://root:pw@127.0.0.1:3306/oxm_test_ci",
      allowedTestDatabaseNames: ["oxm_test", "oxm_test_ci"],
    }));
    expect(result.ok).toBe(true);
    expect(result.database).toBe("oxm_test_ci");
  });
});

describe("checkFinanceIntegrationTestDbSafety: production／Railway host 一律拒絕", () => {
  it("Railway 對外網域（非 loopback）被拒絕，即使資料庫名稱是 oxm_test", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({
      databaseUrl: "mysql://root:pw@containers-us-west-1.railway.app:6543/oxm_test",
    }));
    expect(result.ok).toBe(false);
    expect(result.host).toBe("containers-us-west-1.railway.app");
    expect(result.reason).toMatch(/not an approved loopback host/);
  });

  it("任意公開網域（例如公司內網主機名稱）一律拒絕", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({
      databaseUrl: "mysql://root:pw@db.internal.company.com:3306/oxm_test",
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not an approved loopback host/);
  });

  it("localhost tunnel 情境：host 顯示 localhost 但資料庫名稱是正式 oxm 時仍被拒絕（不能只信任 host）", () => {
    // 模擬 SSH/port-forward tunnel：本地連線埠看起來是 localhost，
    // 但實際轉發到正式資料庫（資料庫名稱是 production 的 "oxm"）。
    const result = checkFinanceIntegrationTestDbSafety(validInput({
      databaseUrl: "mysql://root:pw@localhost:3306/oxm",
    }));
    expect(result.ok).toBe(false);
    expect(result.host).toBe("localhost");
    expect(result.database).toBe("oxm");
    expect(result.reason).toMatch(/not an approved test database name/);
  });
});

describe("checkFinanceIntegrationTestDbSafety: 非測試 DB 名稱拒絕", () => {
  it("資料庫名稱是 oxm_test2（相似但不精確相符）被拒絕", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({
      databaseUrl: "mysql://root:pw@localhost:3306/oxm_test2",
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not an approved test database name/);
  });

  it("資料庫名稱為空字串被拒絕", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({
      databaseUrl: "mysql://root:pw@localhost:3306/",
    }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not an approved test database name/);
  });
});

describe("checkFinanceIntegrationTestDbSafety: 缺少 opt-in 旗標拒絕", () => {
  it("optInFlag 未設定（undefined）被拒絕", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({ optInFlag: undefined }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/FINANCE_INTEGRATION_TESTS_CONFIRMED/);
  });

  it("optInFlag 為 \"true\" 或 \"yes\" 等非精確 \"1\" 值一律拒絕（避免寬鬆解析造成誤放行）", () => {
    expect(checkFinanceIntegrationTestDbSafety(validInput({ optInFlag: "true" })).ok).toBe(false);
    expect(checkFinanceIntegrationTestDbSafety(validInput({ optInFlag: "yes" })).ok).toBe(false);
    expect(checkFinanceIntegrationTestDbSafety(validInput({ optInFlag: "0" })).ok).toBe(false);
  });
});

describe("checkFinanceIntegrationTestDbSafety: 缺少 NODE_ENV=test 拒絕", () => {
  it("NODE_ENV=development 被拒絕", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({ nodeEnv: "development" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/NODE_ENV/);
  });

  it("NODE_ENV=production 被拒絕", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({ nodeEnv: "production" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/NODE_ENV/);
  });

  it("NODE_ENV 未設定（undefined）被拒絕", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({ nodeEnv: undefined }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/NODE_ENV/);
  });
});

describe("checkFinanceIntegrationTestDbSafety: 缺少 database URL 拒絕", () => {
  it("databaseUrl 未設定被拒絕，且不會拋出例外", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({ databaseUrl: undefined }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/FINANCE_TEST_DATABASE_URL/);
  });

  it("databaseUrl 不是合法 URI 時安全地回傳失敗，不拋出例外", () => {
    const result = checkFinanceIntegrationTestDbSafety(validInput({ databaseUrl: "not a valid url" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/could not be parsed/);
  });
});

describe("assertFinanceIntegrationTestDbSafety: 拒絕發生在任何 DB 連線嘗試之前（不是靠原始碼順序判斷）", () => {
  it("用 localhost:1（保證沒有服務在監聽）組成的假網址：資料庫名稱錯誤時同步 throw，且 throw 之後緊接的敘述式（模擬 await import(\"./db\")）完全不會執行到", () => {
    // localhost:1 這個組合本身就足以證明：如果程式碼真的嘗試連線，會是非同步的
    // ECONNREFUSED；但這裡的拒絕是同步、立即發生的，代表判斷邏輯根本沒有走到
    // 任何網路連線，純粹是字串／URL 解析。
    let laterImportWouldHaveRun = false;
    expect(() => {
      assertFinanceIntegrationTestDbSafety({
        nodeEnv: "test",
        optInFlag: "1",
        databaseUrl: "mysql://root:pw@localhost:1/wrong_db_name",
      });
      // 這一行文字上緊接在 guard 呼叫之後，代表 server/financeOptimization.test.ts
      // 裡緊接著的 `await import("./routers")` / `await import("./db")`。
      laterImportWouldHaveRun = true;
    }).toThrow(/must be exactly "oxm_test"|not an approved test database name/);
    expect(laterImportWouldHaveRun).toBe(false);
  });

  it("用 localhost:1 組成的假網址：缺少 opt-in 旗標時同樣同步 throw，緊接的敘述式不會執行到", () => {
    let laterImportWouldHaveRun = false;
    expect(() => {
      assertFinanceIntegrationTestDbSafety({
        nodeEnv: "test",
        optInFlag: undefined,
        databaseUrl: "mysql://root:pw@localhost:1/oxm_test",
      });
      laterImportWouldHaveRun = true;
    }).toThrow(/FINANCE_INTEGRATION_TESTS_CONFIRMED/);
    expect(laterImportWouldHaveRun).toBe(false);
  });

  it("正確環境（NODE_ENV=test、opt-in=1、localhost、oxm_test）：不 throw，緊接的敘述式（模擬 dynamic import）正常繼續執行", () => {
    let laterImportRan = false;
    expect(() => {
      assertFinanceIntegrationTestDbSafety({
        nodeEnv: "test",
        optInFlag: "1",
        databaseUrl: "mysql://root:pw@localhost:3306/oxm_test",
      });
      laterImportRan = true;
    }).not.toThrow();
    expect(laterImportRan).toBe(true);
  });
});

describe("assertFinanceIntegrationTestDbSafety: 錯誤訊息不外洩帳密", () => {
  it("成功時回傳 host／database，不包含密碼", () => {
    const result = assertFinanceIntegrationTestDbSafety(validInput());
    expect(result).toEqual({ host: "localhost", database: "oxm_test" });
  });

  it("失敗時拋出的錯誤訊息只包含 host／database，絕不包含密碼字串本身", () => {
    const secretPassword = "supersecretpassword";
    try {
      assertFinanceIntegrationTestDbSafety(validInput({
        databaseUrl: `mysql://root:${secretPassword}@evil-prod-host.example.com:3306/oxm`,
      }));
      expect.fail("should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(secretPassword);
      expect(message).not.toContain("root:");
      expect(message).toMatch(/evil-prod-host\.example\.com/);
    }
  });

  it("放行時回傳的物件型別正確（host、database 皆為 string）", () => {
    const result = assertFinanceIntegrationTestDbSafety(validInput());
    expect(typeof result.host).toBe("string");
    expect(typeof result.database).toBe("string");
  });
});
