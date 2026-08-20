import { describe, expect, it } from "vitest";
import { isAiShellExcludedPath } from "./aiShellRoutes";

/**
 * Phase 7.4（見對話中「Floating UI Stack Consolidation」）：這份規則本身在
 * Phase 6/7.1-7.3 就已經存在（原本內嵌在 App.tsx 的 AiShellGate），這裡只是
 * 把它搬到獨立檔案供 FloatingActionStack.tsx 共用，之前從未有專屬測試——
 * 這輪順便補上，同時也是「F2：AI 依路由 conditional hidden」這個決策本身的
 * deterministic 驗證。
 */
describe("isAiShellExcludedPath", () => {
  it("/admin 與所有 /admin/* 都排除", () => {
    expect(isAiShellExcludedPath("/admin")).toBe(true);
    expect(isAiShellExcludedPath("/admin/factories")).toBe(true);
    expect(isAiShellExcludedPath("/admin-message/123")).toBe(true);
  });

  it("/verify-email 排除", () => {
    expect(isAiShellExcludedPath("/verify-email")).toBe(true);
  });

  it("/consultant-center 排除", () => {
    expect(isAiShellExcludedPath("/consultant-center")).toBe(true);
  });

  it("所有以 -consultant/cases 結尾的路徑都排除", () => {
    expect(isAiShellExcludedPath("/erp-consultant/cases")).toBe(true);
    expect(isAiShellExcludedPath("/finance-consultant/cases")).toBe(true);
    expect(isAiShellExcludedPath("/certification-consultant/cases")).toBe(true);
  });

  it("一般公開頁面（首頁／搜尋／工廠頁／會員中心）都不排除", () => {
    expect(isAiShellExcludedPath("/")).toBe(false);
    expect(isAiShellExcludedPath("/search")).toBe(false);
    expect(isAiShellExcludedPath("/factory/123")).toBe(false);
    expect(isAiShellExcludedPath("/member")).toBe(false);
  });
});
