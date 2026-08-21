/**
 * Global Footer 的路徑排除規則——獨立於 client/src/lib/aiShellRoutes.ts（見該
 * 檔案說明），兩者判斷的對象語意不同（AI 面板 vs 頁尾），即使排除清單有重疊
 * 也刻意不合併，避免其中一份未來調整時誤動到另一個功能。
 *
 * 排除規則：
 * - /admin、/admin/*、/admin-message/*：內部管理後台工具（"/admin-message"
 *   本身就是以 "/admin" 開頭的字串，同一個 startsWith 一併涵蓋，不需要另外判斷）。
 * - /consultant-center 與所有以 "-consultant/cases" 結尾的路徑：顧問身份
 *   專用的內部工作頁面（certification/erp/short-video/upgrade/finance 五種）。
 * - /dashboard、/member、/notifications、/orders/*：會員／工廠內部管理工具，
 *   不是公開行銷頁面。
 * - /chat/*：訊息頁採 h-screen + overflow-hidden 的固定高度版面，插入 Footer
 *   會破壞版面（不是一般可捲動頁面）。
 * - /verify-email：短暫的驗證流程過場頁。
 *
 * /manual 刻意不排除：雖然頁面本身不 render Navbar（noNavbar），但它是公開的
 * 使用手冊內容頁，不是內部工作頁，仍應顯示 Footer。
 */
export function isFooterExcludedPath(pathname: string): boolean {
  if (pathname.startsWith("/admin")) return true;
  if (pathname === "/consultant-center") return true;
  if (pathname.endsWith("-consultant/cases")) return true;
  if (pathname === "/dashboard") return true;
  if (pathname === "/member") return true;
  if (pathname === "/notifications") return true;
  if (pathname.startsWith("/orders/")) return true;
  if (pathname.startsWith("/chat/")) return true;
  if (pathname === "/verify-email") return true;
  return false;
}
