/**
 * client/src/App.tsx <Switch> 內所有 <Route path> 的完整清單（不含最後的
 * catch-all <Route component={NotFound} />）。
 *
 * 用途：server 端 SPA fallback 判斷「這個網址在 React 端到底有沒有對應的頁面」
 * ——完全對不上任何 pattern 的網址（例如 /this-page-does-not-exist）回真正的
 * HTTP 404 + noindex，不再是 200 的 soft 404。
 *
 * 這份清單必須與 App.tsx 完全一致：server/clientRoutes.test.ts 會直接解析
 * App.tsx 原始碼的 <Route path="..."> 做集合比對，新增／刪除路由卻沒同步這裡
 * 會讓測試失敗（寧可測試擋下，也不能讓正常網址被誤判成 404）。
 */
export const CLIENT_ROUTE_PATTERNS = [
  "/",
  "/search",
  "/industry/:slug/:sub",
  "/industry/:slug",
  "/factories/:region/:industry",
  "/factories/:slug",
  "/factory/:id",
  "/register-factory",
  "/dashboard",
  "/chat/new",
  "/chat/:conversationId",
  "/messages",
  "/favorites",
  "/member",
  "/admin",
  "/admin/analytics",
  "/admin/conversations/:id",
  "/admin/conversations",
  "/admin/users",
  "/admin/factories",
  "/admin/products",
  "/admin/reviews",
  "/admin/ads",
  "/admin/factory-review",
  "/admin/pending-factories",
  "/admin/support",
  "/admin/upgrade-applications",
  "/admin/upgrade-programs",
  "/admin/announcements",
  "/admin/news",
  "/admin/messages/:campaignId",
  "/admin/messages",
  "/admin-message/:id",
  "/news/:slug",
  "/news",
  "/library/:slug",
  "/library",
  "/certification-center/apply",
  "/certification-center",
  "/certification-consultant/cases",
  "/admin/certification-services",
  "/admin/consultant-management",
  "/admin/ai-management",
  "/erp-optimization/apply",
  "/erp-optimization",
  "/erp-consultant/cases",
  "/short-video-marketing/apply",
  "/short-video-marketing",
  "/short-video-consultant/cases",
  "/announcements",
  "/manual",
  "/about",
  "/faq",
  "/resources",
  "/talent",
  "/brand",
  "/factory-photography",
  "/privacy",
  "/terms",
  "/verify-email",
  "/notifications",
  "/community/*?",
  "/orders/:orderId",
  "/upgrade-center/apply",
  "/upgrade-center",
  "/upgrade-consultant/cases",
  "/finance-optimization/apply",
  "/finance-optimization",
  "/consultant-center",
  "/finance-consultant/cases",
  "/admin/finance-applications",
  "/404",
] as const;

/** App.tsx 裡明確渲染 NotFound 的路由：網址本身就代表「找不到」，HTTP 也應該是 404。 */
export const CLIENT_NOT_FOUND_ROUTE = "/404";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 與 wouter 預設 parser（regexparam `parse(pattern)`，非 loose 模式）相同的
 * 比對語意：`:param` 對應單一非空路徑段、`*?` 對應可有可無的剩餘路徑、結尾
 * 斜線可有可無、不分大小寫。刻意不在 server 直接 import regexparam——它只是
 * wouter 的間接相依，pnpm 嚴格 node_modules＋esbuild --packages=external 下
 * 正式環境不保證能解析到。
 */
export function compileClientRoutePattern(pattern: string): RegExp {
  let source = "";
  for (const segment of pattern.split("/").filter(Boolean)) {
    if (segment === "*?") source += "(?:/(.*))?";
    else if (segment === "*") source += "/(.*)";
    else if (segment.startsWith(":")) source += "/([^/]+?)";
    else source += `/${escapeRegExp(segment)}`;
  }
  return new RegExp(`^${source}/?$`, "i");
}

const COMPILED = CLIENT_ROUTE_PATTERNS.map(compileClientRoutePattern);

/** 這個 pathname（不含 query string）是否對應 App.tsx 裡任何一個真正的頁面。 */
export function matchesClientRoute(pathname: string): boolean {
  if (pathname.replace(/\/+$/, "").toLowerCase() === CLIENT_NOT_FOUND_ROUTE) return false;
  let decoded = pathname;
  try {
    decoded = decodeURI(pathname);
  } catch {
    // 無法解碼的網址就只用原始字串比對
  }
  return COMPILED.some(re => re.test(pathname) || re.test(decoded));
}
