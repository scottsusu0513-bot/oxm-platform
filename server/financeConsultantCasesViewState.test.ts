/**
 * client/src/pages/financeConsultantCasesViewState.ts 的行為測試。
 *
 * 這是純函式（無 React／DOM／trpc 依賴），因此可以直接 import 並用一般
 * vitest 驗證真實邏輯行為（輸入 → 輸出），不是 readFileSync 字串比對。
 * 對應第三輪驗收「修正未登入及無權限看板畫面」需求：
 *   - Auth 尚在載入 → loading
 *   - 未登入 → 明確登入引導，不得顯示空五看板
 *   - 已登入但非 admin／啟用中財務顧問 → 無權限畫面
 *   - admin 或啟用中財務顧問 → 正常五看板
 */
import { describe, expect, it } from "vitest";
import { resolveFinanceCasesViewState, selectAssignableConsultants } from "../client/src/pages/financeConsultantCasesViewState";

describe("resolveFinanceCasesViewState", () => {
  it("authLoading=true 時一律回傳 loading，不論其他欄位為何", () => {
    expect(resolveFinanceCasesViewState({
      authLoading: true, isAuthenticated: false, casesLoading: false, casesError: false,
    })).toBe("loading");
    expect(resolveFinanceCasesViewState({
      authLoading: true, isAuthenticated: true, casesLoading: true, casesError: true,
    })).toBe("loading");
  });

  it("未登入（isAuthenticated=false）回傳 login-required，即使案件查詢已經有資料或已出錯", () => {
    expect(resolveFinanceCasesViewState({
      authLoading: false, isAuthenticated: false, casesLoading: false, casesError: false,
    })).toBe("login-required");
    expect(resolveFinanceCasesViewState({
      authLoading: false, isAuthenticated: false, casesLoading: false, casesError: true,
    })).toBe("login-required");
  });

  it("已登入、案件查詢仍在載入中 → loading（不會提早顯示空五看板或無權限畫面）", () => {
    expect(resolveFinanceCasesViewState({
      authLoading: false, isAuthenticated: true, casesLoading: true, casesError: false,
    })).toBe("loading");
  });

  it("已登入、案件查詢回傳錯誤（非 admin 也非啟用中財務顧問）→ no-permission", () => {
    expect(resolveFinanceCasesViewState({
      authLoading: false, isAuthenticated: true, casesLoading: false, casesError: true,
    })).toBe("no-permission");
  });

  it("已登入、案件查詢成功（admin 或啟用中財務顧問）→ board", () => {
    expect(resolveFinanceCasesViewState({
      authLoading: false, isAuthenticated: true, casesLoading: false, casesError: false,
    })).toBe("board");
  });

  it("優先序驗證：casesError 只在已登入且非 loading 時才生效", () => {
    // 未登入 + casesError=true → 仍然是 login-required，不是 no-permission
    expect(resolveFinanceCasesViewState({
      authLoading: false, isAuthenticated: false, casesLoading: false, casesError: true,
    })).toBe("login-required");
    // 已登入但還在 loading + casesError=true（理論上不會同時發生，但驗證優先序穩固）
    expect(resolveFinanceCasesViewState({
      authLoading: false, isAuthenticated: true, casesLoading: true, casesError: true,
    })).toBe("loading");
  });
});

describe("selectAssignableConsultants", () => {
  it("只保留 isActive=true 且 userId 非 null 的顧問", () => {
    const consultants = [
      { id: 1, isActive: true, userId: 10 },
      { id: 2, isActive: false, userId: 20 },
      { id: 3, isActive: true, userId: null },
      { id: 4, isActive: false, userId: null },
    ];
    expect(selectAssignableConsultants(consultants).map(c => c.id)).toEqual([1]);
  });

  it("consultants 為 undefined 時回傳空陣列，不拋例外", () => {
    expect(selectAssignableConsultants(undefined)).toEqual([]);
  });

  it("全部顧問都符合資格時，順序保持不變（只過濾不排序）", () => {
    const consultants = [
      { id: 3, isActive: true, userId: 30 },
      { id: 1, isActive: true, userId: 10 },
    ];
    expect(selectAssignableConsultants(consultants).map(c => c.id)).toEqual([3, 1]);
  });
});
