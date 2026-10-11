import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { getVisitorId } from "@/lib/analyticsVisitor";
import { getAnalyticsPlatform } from "@/lib/platform";
import { isExcludedAnalyticsPath } from "@shared/analyticsPolicy";
import { classifyPathname } from "@shared/analyticsPageType";

// Analytics 2.0 SPA route tracking（見對話「八、SPA Route Tracking」）：舊
// PageViewTracker 只在 App mount 時打一次 analytics.record，完全不知道使用者
// 在站內的後續導覽（例如首頁→搜尋→工廠A→工廠B 應該是 1 visitor / 1 session /
// 4 pageviews，見對話中的具體範例）。這裡改成每次「有效」pathname 變化都送
// 一筆 pageview event；是否要開新 session（30 分鐘無活動）完全交給後端
// getOrCreateSession 判斷，前端不需要、也不應該自己算 session。
//
// referrer／UTM 只在「這次瀏覽器工作階段的第一個 pageview」（isLandingPage）
// 附帶：後續站內 SPA 導覽的 document.referrer 仍然是使用者當初進站的來源，
// 重複帶送只會誤導「這個 pageview 的流量來源」，實際上真正有意義的是
// prevPathname（站內上一頁）。isLandingPage 用模組層級旗標判斷（沿用
// _routeTrackerReady 同一種「reset on page refresh」模式，跟 RouteTracker
// 分開各自一份，避免耦合到別的功能的旗標語意）。
let _analyticsLandingSent = false;

export function AnalyticsRouteTracker() {
  const [pathname] = useLocation();
  const searchStr = useSearch();
  const trackEvent = trpc.analyticsV2.trackEvent.useMutation({ retry: false });
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (isExcludedAnalyticsPath(pathname)) {
      lastTrackedPath.current = null;
      return;
    }
    // Query changes are search/filter interactions; only pathname navigation is a pageview.
    // A -> B -> A and refresh still count; repeated effects on the same route do not.
    if (lastTrackedPath.current === pathname) return;
    try {
      const search = searchStr ? `?${searchStr}` : "";
      const isLandingPage = !_analyticsLandingSent;

      let prevPathname: string | undefined;
      try {
        prevPathname = sessionStorage.getItem("oxm.currentPath") ?? undefined;
      } catch {
        prevPathname = undefined;
      }
      // 站內導覽時 prevPathname 若跟這次 pathname 相同（例如同頁 query
      // 變化），不算是「換頁」的上一頁，維持 undefined。
      if (prevPathname === pathname) prevPathname = undefined;

      const { pageType, factoryId } = classifyPathname(pathname);

      const payload: Record<string, unknown> = {
        visitorId: getVisitorId(),
        eventType: "pageview" as const,
        pathname,
        queryString: search || undefined,
        pageType,
        factoryId: factoryId ?? undefined,
        prevPathname,
        isLandingPage,
        platform: getAnalyticsPlatform(),
      };

      if (isLandingPage) {
        _analyticsLandingSent = true;
        try {
          if (document.referrer) payload.referrer = document.referrer;
          const params = new URLSearchParams(search);
          const utmSource = params.get("utm_source");
          const utmMedium = params.get("utm_medium");
          const utmCampaign = params.get("utm_campaign");
          const utmContent = params.get("utm_content");
          const utmTerm = params.get("utm_term");
          if (utmSource) payload.utmSource = utmSource;
          if (utmMedium) payload.utmMedium = utmMedium;
          if (utmCampaign) payload.utmCampaign = utmCampaign;
          if (utmContent) payload.utmContent = utmContent;
          if (utmTerm) payload.utmTerm = utmTerm;
        } catch {
          // referrer/UTM is best-effort only
        }
      }

      trackEvent.mutate(payload as Parameters<typeof trackEvent.mutate>[0]);
      lastTrackedPath.current = pathname;
    } catch {
      // tracking 失敗絕對不能影響頁面（見對話中「tracking failure 不可以讓
      // 頁面 error」）
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchStr]);

  return null;
}
