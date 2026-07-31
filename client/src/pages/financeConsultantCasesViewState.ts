/**
 * 財務優化顧問案件看板的畫面狀態判斷 — 刻意抽成不依賴 React／DOM 的純函式，
 * 讓 server/*.test.ts 可以直接 import 並用一般 vitest 單元測試驗證實際行為，
 * 不需要 jsdom／@testing-library（本專案未安裝，也不在本輪允許新增套件的
 * 範圍內），也不必用 readFileSync 搜尋原始碼字串宣稱通過。
 *
 * 呼叫端（FinanceConsultantCases.tsx）負責把 useAuth()／trpc 查詢的原始狀態
 * 轉成這裡要的乾淨布林值，這支函式只做「畫面該顯示什麼」的決策本身。
 */

export type FinanceCasesViewState = "loading" | "login-required" | "no-permission" | "board";

export interface ResolveFinanceCasesViewStateInput {
  /** useAuth() 的 loading：使用者登入狀態本身還在確認中。 */
  authLoading: boolean;
  /** useAuth() 解析完成後，是否為已登入使用者。 */
  isAuthenticated: boolean;
  /**
   * 案件查詢是否仍在載入中。呼叫端必須自行處理「未登入時 query 被
   * enabled:false 停用、react-query 可能永遠停在 isLoading=true」的情況——
   * 只在 isAuthenticated 為 true 時才把真正的 casesQuery.isLoading 傳進來，
   * 未登入時應傳 false（因為此時應該由 isAuthenticated=false 決定畫面，
   * 不该被一個永遠不會變成功的查詢卡住）。
   */
  casesLoading: boolean;
  /** 案件查詢是否回傳錯誤（例如 FORBIDDEN：不是 admin 也不是啟用中財務顧問）。 */
  casesError: boolean;
}

/**
 * 狀態優先序：
 * 1. authLoading             → "loading"　（登入狀態本身還沒確認）
 * 2. !isAuthenticated        → "login-required"　（明確引導登入，不顯示空看板）
 * 3. casesLoading            → "loading"　（已登入，案件查詢進行中）
 * 4. casesError              → "no-permission"　（已登入但不是 admin／啟用中財務顧問）
 * 5. 其餘                     → "board"　（正常顯示五看板）
 */
export function resolveFinanceCasesViewState(
  input: ResolveFinanceCasesViewStateInput,
): FinanceCasesViewState {
  if (input.authLoading) return "loading";
  if (!input.isAuthenticated) return "login-required";
  if (input.casesLoading) return "loading";
  if (input.casesError) return "no-permission";
  return "board";
}

export interface AssignableConsultantLike {
  isActive: boolean;
  userId: number | null;
}

/**
 * 承辦顧問指派選單只列出「啟用中且已綁定使用者帳號」的顧問——停用中或尚未
 * 綁定帳號的顧問無法實際登入查看案件，指派給它們等同於指派給沒有人能存取
 * 的黑洞（server 端 financeConsultant.adminAssignConsultant／
 * db.adminAssignFinanceConsultant 也會拒絕這類指派，這裡只是前端選單本身
 * 就不提供這種選項）。抽成純函式讓行為可以直接用 vitest 驗證，不必用
 * readFileSync 比對元件原始碼裡的 filter 條件字串。
 */
export function selectAssignableConsultants<T extends AssignableConsultantLike>(
  consultants: T[] | undefined,
): T[] {
  return (consultants ?? []).filter(c => c.isActive && c.userId != null);
}
