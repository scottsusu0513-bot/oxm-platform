/**
 * Analytics 2.0 的 visitorId 產生／讀取邏輯——原本只存在於 App.tsx 內部
 * （給 PageViewTracker／AnalyticsRouteTracker 用），Search.tsx 的搜尋事件
 * 追蹤也需要同一個 visitorId，抽成共用小工具避免兩處各自維護一份
 * localStorage 邏輯。
 */
export function getVisitorId(): string {
  try {
    let id = localStorage.getItem("oxm_visitor_id");
    if (!id) {
      id = typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("oxm_visitor_id", id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2)}`;
  }
}
