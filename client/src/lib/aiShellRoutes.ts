/**
 * Phase 7.4（見對話中「Floating UI Stack Consolidation」）：從 App.tsx 抽出來
 * 的單一 source of truth——原本只有 App.tsx 內部的 AiShellGate 用這份判斷，
 * 現在 FloatingActionStack.tsx 也需要同一份邏輯決定要不要 render AI
 * launcher，抽成獨立檔案避免兩處各自維護一份容易漂移的路由清單（App.tsx
 * 不能被 FloatingActionStack.tsx 直接 import，會造成循環依賴）。
 *
 * 排除規則本身完全未變動，原始說明見 App.tsx 舊版 isAiShellExcludedPath 的
 * 註解：
 * - /admin、/admin/*、/admin-message/*：內部管理後台工具。
 * - /verify-email：短暫的驗證流程頁，不適合疊加聊天面板。
 * - /consultant-center 與所有以 "-consultant/cases" 結尾的路徑：顧問身份
 *   專用的內部工作頁面。
 * 其餘所有一般公開頁面都正常顯示。
 */
export function isAiShellExcludedPath(pathname: string): boolean {
  if (pathname.startsWith("/admin")) return true;
  if (pathname === "/verify-email") return true;
  if (pathname === "/consultant-center") return true;
  if (pathname.endsWith("-consultant/cases")) return true;
  return false;
}
