import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { lazy, Suspense, useEffect, useState, useMemo, useRef } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { HelmetProvider } from "react-helmet-async";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { setBadgeCount, clearBadge } from "@/lib/appBadge";
import { consumePendingNavigatePath, initPushNotifications } from "@/lib/pushNotifications";
import { AppLoading } from "@/components/AppLoading";
import { AppBottomNav } from "@/components/AppBottomNav";
import NetworkStatusOverlay from "@/components/NetworkStatusOverlay";
import { AiShellProvider } from "@/contexts/AiShellContext";
import { GlobalAiShell } from "@/components/ai/GlobalAiShell";
import { FloatingActionStack } from "@/components/FloatingActionStack";
import { isAiShellExcludedPath } from "@/lib/aiShellRoutes";
import { isFooterExcludedPath } from "@/lib/footerRoutes";
import { decideScrollNavigationAction, hasExplicitScrollTarget, isHomeNavigationIntentState } from "@/lib/scrollRestoration";
import { ConsentGate } from "@/components/ConsentGate";
import { OnboardingTour } from "@/components/OnboardingTour";
import { Footer } from "@/components/Footer";

// ── 公開頁面 ──────────────────────────────────────────────────────────────
const Home                  = lazy(() => import("./pages/Home"));
const Search                = lazy(() => import("./pages/Search"));
const FactoryDetail         = lazy(() => import("./pages/FactoryDetail"));
const IndustryPage          = lazy(() => import("./pages/IndustryPage"));
const RegionIndustryPage    = lazy(() => import("./pages/RegionIndustryPage"));
const FactoryRegister       = lazy(() => import("./pages/FactoryRegister"));
const FactoryDashboard      = lazy(() => import("./pages/FactoryDashboard"));
const ChatPage              = lazy(() => import("./pages/ChatPage"));
const MyMessages            = lazy(() => import("./pages/MyMessages"));
const MyFavorites           = lazy(() => import("./pages/MyFavorites"));
const MemberCenter          = lazy(() => import("./pages/MemberCenter"));
const Announcements         = lazy(() => import("./pages/Announcements"));
const AboutOXM              = lazy(() => import("./pages/AboutOXM"));
const FAQ                   = lazy(() => import("./pages/FAQ"));
const ResourceCenter        = lazy(() => import("./pages/ResourceCenter"));
const Talent                = lazy(() => import("./pages/Talent"));
const Brand                 = lazy(() => import("./pages/Brand"));
const FactoryPhotography    = lazy(() => import("./pages/FactoryPhotography"));
const PrivacyPolicyPage     = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsPage             = lazy(() => import("./pages/TermsPage"));
const VerifyEmailPage       = lazy(() => import("./pages/VerifyEmailPage"));
const UserManual            = lazy(() => import("./pages/UserManual"));
const Community             = lazy(() => import("./pages/Community"));
const Notifications         = lazy(() => import("./pages/Notifications"));
const EnterpriseUpgradeCenter = lazy(() => import("./pages/EnterpriseUpgradeCenter"));
const EnterpriseUpgradeApply  = lazy(() => import("./pages/EnterpriseUpgradeApply"));
const FinanceOptimization      = lazy(() => import("./pages/FinanceOptimization"));
const FinanceOptimizationApply = lazy(() => import("./pages/FinanceOptimizationApply"));
const ConsultantHub            = lazy(() => import("./pages/ConsultantHub"));
const FinanceConsultantCases   = lazy(() => import("./pages/FinanceConsultantCases"));
const NotFound              = lazy(() => import("./pages/NotFound"));
const OrderDetail           = lazy(() => import("./pages/OrderDetail"));
// ISO 與低碳認證專區：目前僅由 /resources 資源總覽提供受控入口，仍不列入
// Navbar 直達項目、首頁、Footer、APP 導覽、sitemap 或 prerender；頁面的
// noindex／noarchive 保護維持不變，待正式上線授權後再另行調整。
const CertificationCenter   = lazy(() => import("./pages/CertificationCenter"));
const CertificationCenterApply = lazy(() => import("./pages/CertificationCenterApply"));
// ISO 顧問案件看板：需登入且具顧問身份，不算公開隱藏預覽頁（同
// /finance-consultant/cases 慣例，不在 NOINDEX_EXACT_PATHS 內單獨列出）。
const CertificationConsultantCases = lazy(() => import("./pages/CertificationConsultantCases"));
// ERP 與產線優化專區：同上，僅由 /resources 提供受控入口，搜尋引擎保護與
// 其他主要導覽位置的限制維持不變。
const ErpOptimization       = lazy(() => import("./pages/ErpOptimization"));
const ErpOptimizationApply  = lazy(() => import("./pages/ErpOptimizationApply"));
const ErpConsultantCases    = lazy(() => import("./pages/ErpConsultantCases"));
// 短影音與品牌內容行銷專區：同上，僅由 /resources 提供受控入口，搜尋引擎
// 保護與其他主要導覽位置的限制維持不變。申請表為真正可送出的表單，因此拆成
// 兩個路由，與企業財務優化 /finance-optimization 的內容頁＋申請頁架構一致。
const ShortVideoMarketing      = lazy(() => import("./pages/ShortVideoMarketing"));
const ShortVideoMarketingApply = lazy(() => import("./pages/ShortVideoMarketingApply"));
// 短影音顧問案件看板：需登入且具短影音顧問身份才能查看，不算公開隱藏預覽頁
// （同 /finance-consultant/cases 慣例，不在 NOINDEX_EXACT_PATHS 內單獨列出）。
const ShortVideoConsultantCases = lazy(() => import("./pages/ShortVideoConsultantCases"));

// ── Admin 頁面（獨立 chunk，一般使用者不會載入）──────────────────────────
const AdminDashboard        = lazy(() => import("./pages/AdminDashboard"));
const AdminConversationDetail = lazy(() => import("./pages/AdminConversationDetail"));
const ConversationsList     = lazy(() => import("./pages/ConversationsList"));
const UsersList             = lazy(() => import("./pages/UsersList"));
const FactoriesList         = lazy(() => import("./pages/FactoriesList"));
const ProductsList          = lazy(() => import("./pages/ProductsList"));
const ReviewsList           = lazy(() => import("./pages/ReviewsList"));
const AdsList               = lazy(() => import("./pages/AdsList"));
const FactoryReviewDetail   = lazy(() => import("./pages/FactoryReviewDetail"));
const PendingFactoriesList  = lazy(() => import("./pages/PendingFactoriesList"));
const AdminSupportCenter    = lazy(() => import("./pages/AdminSupportCenter"));
const AdminUpgradeApplications = lazy(() => import("./pages/AdminUpgradeApplications"));
const AdminUpgradePrograms    = lazy(() => import("./pages/AdminUpgradePrograms"));
const ConsultantCases        = lazy(() => import("./pages/ConsultantCases"));
const AdminFinanceApplications = lazy(() => import("./pages/FinanceConsultantCases"));
const AdminAnnouncements    = lazy(() => import("./pages/AdminAnnouncements"));
const AdminNews             = lazy(() => import("./pages/AdminNews"));
const News                  = lazy(() => import("./pages/News"));
const NewsDetail            = lazy(() => import("./pages/NewsDetail"));
const AdminMessages         = lazy(() => import("./pages/AdminMessages"));
const AdminMessageDetail    = lazy(() => import("./pages/AdminMessageDetail"));
const AdminCertificationServices = lazy(() => import("./pages/AdminCertificationServices"));
const AdminConsultantManagement = lazy(() => import("./pages/AdminConsultantManagement"));
const AdminAiManagement = lazy(() => import("./pages/AdminAiManagement"));

// ── App badge count syncer ────────────────────────────────────────────────────
// 只在 Capacitor native app 執行，沿用 Navbar 相同紅點邏輯計算 badge 數字
function AppBadgeSyncer() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    import("@capacitor/core").then(({ Capacitor }) => {
      setIsNative(Capacitor.isNativePlatform());
    }).catch(() => {});
  }, []);

  const reviewSince = useMemo(() => {
    try { return parseInt(localStorage.getItem('oxm_reviews_seen') ?? '0', 10); } catch { return 0; }
  }, []);

  const badgeQuery = trpc.notification.getAppBadgeCount.useQuery(
    { reviewSince: reviewSince > 0 ? reviewSince : undefined },
    { enabled: !!user && isNative, refetchInterval: 60000 }
  );

  // Badge count 變動時同步到 App icon
  useEffect(() => {
    if (badgeQuery.data?.total === undefined) return;
    setBadgeCount(badgeQuery.data.total).catch(() => {});
  }, [badgeQuery.data?.total]);

  // 登出時清除 badge
  useEffect(() => {
    if (user || !isNative) return;
    clearBadge().catch(() => {});
  }, [user, isNative]);

  // App 回到前景時重新同步所有通知相關 cache
  useEffect(() => {
    if (!isNative) return;
    let cleanup: (() => void) | undefined;
    import("@capacitor/app").then(async ({ App: CapApp }) => {
      const handle = await CapApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        utils.notification.getAppBadgeCount.invalidate();
        utils.chat.unreadCount.invalidate();
        utils.chat.myConversations.invalidate();
        utils.review.unreadCount.invalidate();
        // Admin queries are enabled-gated, safe to call unconditionally
        utils.admin.getPendingCount.invalidate();
        utils.admin.getAdminNotifications.invalidate();
      });
      cleanup = () => handle.remove();
    }).catch(() => {});
    return () => { cleanup?.(); };
  }, [isNative, utils]);

  // 收到前景 FCM 通知時重新同步訊息相關 cache
  useEffect(() => {
    if (!isNative) return;
    let cleanup: (() => void) | undefined;
    import("@capacitor-firebase/messaging").then(async ({ FirebaseMessaging }) => {
      const handle = await FirebaseMessaging.addListener("notificationReceived", (notification) => {
        const type = (notification?.notification?.data as any)?.type ?? '';
        // Always: sync badge + unread + conversations (covers chat_message and any unknown type)
        utils.notification.getAppBadgeCount.invalidate();
        utils.chat.unreadCount.invalidate();
        utils.chat.myConversations.invalidate();
        if (type === 'factory_approved' || type === 'factory_rejected') {
          utils.factory.getMine.invalidate();
          utils.factory.getCoManagedFactories.invalidate();
        }
        if (type === 'revision_approved' || type === 'revision_rejected') {
          utils.factory.getMine.invalidate();
          utils.admin.getPendingCount.invalidate();
          utils.admin.getAdminNotifications.invalidate();
        }
        if (type === 'inquiry_batch') {
          utils.inquiryBatch.listMine.invalidate();
        }
        if (type === 'review_reply') {
          utils.review.unreadCount.invalidate();
          utils.review.myReviews.invalidate();
        }
        if (type === 'admin_announcement') {
          utils.admin.getPendingCount.invalidate();
          utils.admin.getAdminNotifications.invalidate();
        }
      });
      cleanup = () => handle.remove();
    }).catch(() => {});
    return () => { cleanup?.(); };
  }, [isNative, utils]);

  return null;
}

// Handles oxm://oauth/callback?ticket=... deep links on iOS and Android
function AppDeepLinkHandler() {
  const utils = trpc.useUtils();

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const { App: CapApp } = await import("@capacitor/app");
      const { Browser } = await import("@capacitor/browser");

      console.log("[AppDeepLinkHandler] mounted, listening for appUrlOpen");

      const handle = await CapApp.addListener("appUrlOpen", async ({ url }) => {
        console.log("[AppDeepLinkHandler] appUrlOpen:", url.slice(0, 60));

        if (!url.startsWith("oxm://oauth/callback")) return;

        let ticket: string | null = null;
        try {
          ticket = new URL(url).searchParams.get("ticket");
        } catch {
          console.warn("[AppDeepLinkHandler] failed to parse url");
          return;
        }
        if (!ticket) {
          console.warn("[AppDeepLinkHandler] no ticket in url");
          return;
        }

        console.log("[AppDeepLinkHandler] ticket parsed (first 8):", ticket.slice(0, 8));
        await Browser.close();
        console.log("[AppDeepLinkHandler] Browser.close called");

        try {
          const res = await fetch("/api/oauth/app-complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ ticket }),
          });
          console.log("[AppDeepLinkHandler] app-complete status:", res.status);
          if (res.ok) {
            console.log("[AppDeepLinkHandler] success — refetching auth.me");
            await utils.auth.me.invalidate();
            window.location.href = "/";
          } else {
            const body = await res.json().catch(() => ({}));
            console.warn("[AppDeepLinkHandler] app-complete failed:", body);
            toast.error("登入失敗，請重試");
          }
        } catch (err) {
          console.error("[AppDeepLinkHandler] fetch error:", err);
          toast.error("網路錯誤，請重試");
        }
      });

      cleanup = () => { handle.remove(); };
    })();

    return () => { cleanup?.(); };
  }, [utils]);

  return null;
}

// Module-level guard so only one silent init attempt happens across the entire session
let globalPushInitAttempted = false;

// Resets on page refresh (JS memory cleared) — used by RouteTracker to detect fresh loads
let _routeTrackerReady = false;
const OXM_PREV_PATH = "oxm.previousPath";
const OXM_CUR_PATH = "oxm.currentPath";

// Silently initialises push notifications once the user is logged in on a native app.
// MemberCenter handles the "enable push" UX; this component handles the token refresh
// so users don't need to visit MemberCenter after a reinstall / token rotation.
function PushAutoInitializer() {
  const { user } = useAuth();
  const [isNative, setIsNative] = useState(false);
  const registerPushToken = trpc.notification.registerPushToken.useMutation();

  useEffect(() => {
    import("@capacitor/core")
      .then(({ Capacitor }) => setIsNative(Capacitor.isNativePlatform()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      globalPushInitAttempted = false; // reset on logout so next login re-inits
      return;
    }
    if (!isNative) return;
    if (globalPushInitAttempted) return;

    // Always init on native login — token registration is independent of pushEnabled preference.
    // pushEnabled only controls whether the backend sends notifications, not whether we register.
    globalPushInitAttempted = true;
    initPushNotifications(async (input) => {
      await registerPushToken.mutateAsync(input);
    }).then((result) => {
      if (result === "denied") console.log("[Push] auto-init: permission denied by user");
      else if (result !== "success" && result !== "not_native") console.warn("[Push] auto-init result:", result);
    }).catch((e) => console.warn("[Push] global auto-init failed:", e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isNative]);

  return null;
}

// Handles push notification tap navigation (background, cold-start, foreground)
function PushNavigationHandler() {
  const [, navigate] = useLocation();

  useEffect(() => {
    // Consume path stored before React mounted (cold-start tap)
    const pending = consumePendingNavigatePath();
    if (pending) navigate(pending);

    const handler = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path && typeof path === "string" && path.startsWith("/")) {
        navigate(path);
      }
    };
    window.addEventListener("oxm-push-navigate", handler);
    return () => window.removeEventListener("oxm-push-navigate", handler);
  }, [navigate]);

  return null;
}

function PageFallback() {
  return <AppLoading />;
}

function AiShellGate() {
  const [pathname] = useLocation();
  if (isAiShellExcludedPath(pathname)) return null;
  return <GlobalAiShell />;
}

// Global Footer：App 全域掛載 + route gate，比照上面 AiShellGate 的寫法。
// 排除清單獨立維護在 client/src/lib/footerRoutes.ts（isFooterExcludedPath），
// 刻意不共用 isAiShellExcludedPath——兩者排除的路由集合雖然重疊，但語意不同
// （AI 面板 vs 頁尾），合併會讓其中一份未來調整時互相牽動。
//
// 這個元件實際 render 的位置在下面 Router() 的 <Suspense> 之內（跟 <Switch>
// 同一層），不是直接掛在 App() 裡——刻意讓它跟著頁面一起被 Suspense 接管：
// 路由切換到尚未載入過的 lazy page 時，Suspense fallback 期間 Footer 也必須
// 一起消失，只留 AppLoading 全螢幕載入畫面，不能讓 Footer 在頁面內容還沒
// ready 時就先閃出來（過去掛在 Suspense 外面時，就是這個問題的根因）。
function FooterGate() {
  const [pathname] = useLocation();
  if (isFooterExcludedPath(pathname)) return null;
  return <Footer />;
}

function Router() {
  return (
    <Suspense fallback={<PageFallback />}>
      {/* BUG 2 loading-shell 修正：不論個別頁面自己內部的資料還在載入、還是
          內容本來就短，這層 min-h-screen 保證「頁面內容區」至少佔滿一個
          視窗高度，Footer（下面同一層的 <FooterGate/>）永遠不會在頁面主要
          內容還沒 ready 前被瀏覽器往上推進可視範圍。真正撐滿高度後（頁面
          內容 > 一個視窗）這層 min-height 不會有任何視覺影響，只在內容還
          矮的短暫期間生效。 */}
      <div className="min-h-screen">
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/search" component={Search} />
        <Route path="/industry/:slug/:sub" component={IndustryPage} />
        <Route path="/industry/:slug" component={IndustryPage} />
        <Route path="/factories/:region/:industry" component={RegionIndustryPage} />
        <Route path="/factory/:id" component={FactoryDetail} />
        <Route path="/register-factory" component={FactoryRegister} />
        <Route path="/dashboard" component={FactoryDashboard} />
        <Route path="/chat/new" component={ChatPage} />
        <Route path="/chat/:conversationId" component={ChatPage} />
        <Route path="/messages" component={MyMessages} />
        <Route path="/favorites" component={MyFavorites} />
        <Route path="/member" component={MemberCenter} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/conversations/:id" component={AdminConversationDetail} />
        <Route path="/admin/conversations" component={ConversationsList} />
        <Route path="/admin/users" component={UsersList} />
        <Route path="/admin/factories" component={FactoriesList} />
        <Route path="/admin/products" component={ProductsList} />
        <Route path="/admin/reviews" component={ReviewsList} />
        <Route path="/admin/ads" component={AdsList} />
        <Route path="/admin/factory-review" component={FactoryReviewDetail} />
        <Route path="/admin/pending-factories" component={PendingFactoriesList} />
        <Route path="/admin/support" component={AdminSupportCenter} />
        <Route path="/admin/upgrade-applications" component={AdminUpgradeApplications} />
        <Route path="/admin/upgrade-programs" component={AdminUpgradePrograms} />
        <Route path="/admin/announcements" component={AdminAnnouncements} />
        <Route path="/admin/news" component={AdminNews} />
        <Route path="/admin/messages/:campaignId" component={AdminMessages} />
        <Route path="/admin/messages" component={AdminMessages} />
        <Route path="/admin-message/:id" component={AdminMessageDetail} />
        {/* /news、/news/:slug：目前不對外開放入口（Navbar「找消息」維持鎖定），
            但路由本身必須完整存在，讓管理員／測試者可以直接輸入網址瀏覽。 */}
        <Route path="/news/:slug" component={NewsDetail} />
        <Route path="/news" component={News} />
        {/* ISO 與低碳認證專區：/resources 是唯一受控的公開導覽入口；頁面仍
            維持 noindex／nofollow（Helmet 與 X-Robots-Tag），也不加入 sitemap
            或 prerender，直到另行授權正式公開。 */}
        <Route path="/certification-center/apply" component={CertificationCenterApply} />
        <Route path="/certification-center" component={CertificationCenter} />
        <Route path="/certification-consultant/cases" component={CertificationConsultantCases} />
        <Route path="/admin/certification-services" component={AdminCertificationServices} />
        <Route path="/admin/consultant-management" component={AdminConsultantManagement} />
        <Route path="/admin/ai-management" component={AdminAiManagement} />
        {/* ERP 與產線優化專區：同上，僅由 /resources 提供受控入口；
            noindex／nofollow、sitemap 與 prerender 限制維持不變。
            /apply 為真正可送出的申請表單，同樣隱藏、同樣 noindex；
            /erp-consultant/cases 需登入且具顧問身份，不算公開隱藏預覽頁。 */}
        <Route path="/erp-optimization/apply" component={ErpOptimizationApply} />
        <Route path="/erp-optimization" component={ErpOptimization} />
        <Route path="/erp-consultant/cases" component={ErpConsultantCases} />
        {/* 短影音與品牌內容行銷專區：正式改分類至找形象（/brand 提供受控入口，
            見 client/src/pages/Brand.tsx 的服務卡連結），不再由 /resources
            連結；noindex／nofollow、sitemap 與 prerender 限制維持不變。
            /apply 為真正可送出的申請表單，同樣隱藏、同樣 noindex。
            /short-video-consultant/cases 需登入且具顧問身份，不算公開隱藏
            預覽頁，故不在 NOINDEX_EXACT_PATHS 內（同 /finance-consultant/cases 慣例）。 */}
        <Route path="/short-video-marketing/apply" component={ShortVideoMarketingApply} />
        <Route path="/short-video-marketing" component={ShortVideoMarketing} />
        <Route path="/short-video-consultant/cases" component={ShortVideoConsultantCases} />
        <Route path="/announcements" component={Announcements} />
        <Route path="/manual" component={UserManual} />
        <Route path="/about" component={AboutOXM} />
        <Route path="/faq" component={FAQ} />
        <Route path="/resources" component={ResourceCenter} />
        <Route path="/talent" component={Talent} />
        {/* 找形象正式 Hub：/brand 兩張服務卡分別連到 /short-video-marketing
            （隱藏預覽頁，noindex／nofollow 不變）與 /factory-photography
            （新建服務介紹頁，noindex,follow）。/brand 本身維持既有
            noindex,follow gate，等下一輪人工確認 UI 後再正式開放索引。 */}
        <Route path="/brand" component={Brand} />
        <Route path="/factory-photography" component={FactoryPhotography} />
        <Route path="/privacy" component={PrivacyPolicyPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/community/*?" component={Community} />
        <Route path="/orders/:orderId" component={OrderDetail} />
        <Route path="/upgrade-center/apply" component={EnterpriseUpgradeApply} />
        <Route path="/upgrade-center" component={EnterpriseUpgradeCenter} />
        <Route path="/upgrade-consultant/cases" component={ConsultantCases} />
        <Route path="/finance-optimization/apply" component={FinanceOptimizationApply} />
        <Route path="/finance-optimization" component={FinanceOptimization} />
        <Route path="/consultant-center" component={ConsultantHub} />
        <Route path="/finance-consultant/cases" component={FinanceConsultantCases} />
        <Route path="/admin/finance-applications" component={AdminFinanceApplications} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
      </div>
      <FooterGate />
    </Suspense>
  );
}

function safeVisitorId(): string {
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

// Tracks SPA pathname changes so FloatingBackButton can safely navigate back within the site.
// Uses a module-level flag to distinguish fresh loads / refreshes (flag = false) from
// in-session SPA navigation (flag = true). On fresh load we clear previousPath so the
// back button falls through to fallbackHref instead of returning to a stale path.
function RouteTracker() {
  const [pathname] = useLocation();
  useEffect(() => {
    try {
      if (!_routeTrackerReady) {
        _routeTrackerReady = true;
        sessionStorage.removeItem(OXM_PREV_PATH);
        sessionStorage.setItem(OXM_CUR_PATH, pathname);
        return;
      }
      const stored = sessionStorage.getItem(OXM_CUR_PATH) ?? "";
      if (stored === pathname) return;
      sessionStorage.setItem(OXM_PREV_PATH, stored);
      sessionStorage.setItem(OXM_CUR_PATH, pathname);
    } catch { /* sessionStorage unavailable */ }
  }, [pathname]);
  return null;
}

// BUG 2 — 「新頁面偶發先看到 Footer、最後卡在頁尾」的全域修正（見對話「BUG
// 2」Audit、client/src/lib/scrollRestoration.ts 的完整說明）。決策邏輯本身
// 抽成純函式 decideScrollNavigationAction，這裡只負責：
// 1. 用一個不觸發 re-render 的 ref 記錄「這次 pathname 變化是不是由瀏覽器
//    原生 popstate（上一頁／下一頁）觸發」——popstate 監聽器與 pathname 變化
//    的 effect 都是同一輪 event loop 內同步／依序處理，ref 寫入不需要等
//    re-render，能可靠地在 effect 讀取到當下這次導航的真實來源。
// 2. 只有「新導航」才 window.scrollTo(0, 0)；popstate（返回／前進）與
//    reload 後的第一次判斷一律不動 scroll，交給瀏覽器原生行為與各頁面
//    既有的還原邏輯（例如 FactoryDetail.tsx 自己對 factoryId 變化的處理），
//    避免蓋掉「搜尋結果→工廠頁→返回搜尋結果」這類既有保留位置的體驗。
// 3. explicit-target navigation（URL 帶 hash 或 `?highlight=<id>`，例如首頁
//    公告卡片導到 /announcements 指定那一則）：不強制捲頂，交給目標頁自己的
//    scrollIntoView 定位（見 scrollRestoration.ts 的 hasExplicitScrollTarget）。
// 4. home-navigation intent（使用者主動點擊 App 內建首頁入口，見
//    scrollRestoration.ts 的 HOME_NAV_INTENT_STATE／isHomeNavigationIntentState）：
//    無論其餘規則怎麼判斷，一律強制捲頂；但永遠排在 popstate 判斷之後，不會
//    誤判瀏覽器返回鍵回首頁這筆 history entry。
let _scrollManagerMounted = false; // resets on page refresh，用來判斷「這次掛載後的第一次」

function ScrollRestorationManager() {
  const [pathname] = useLocation();
  const isPopStateRef = useRef(false);
  const previousPathnameRef = useRef<string | null>(null);
  const isFirstRunRef = useRef(!_scrollManagerMounted);

  useEffect(() => {
    const handlePopState = () => { isPopStateRef.current = true; };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const action = decideScrollNavigationAction({
      previousPathname: previousPathnameRef.current,
      nextPathname: pathname,
      isPopStateNavigation: isPopStateRef.current,
      isInitialMount: isFirstRunRef.current,
      hasExplicitTarget: hasExplicitScrollTarget(window.location.search, window.location.hash),
      isHomeNavigationIntent: isHomeNavigationIntentState(window.history.state),
    });
    if (action === "reset-to-top") {
      window.scrollTo(0, 0);
    }
    isPopStateRef.current = false;
    isFirstRunRef.current = false;
    _scrollManagerMounted = true;
    previousPathnameRef.current = pathname;
  }, [pathname]);

  return null;
}

function PageViewTracker() {
  const record = trpc.analytics.record.useMutation();
  useEffect(() => {
    const run = () => {
      try {
        const visitorId = safeVisitorId();
        record.mutate({ visitorId });
      } catch {
        // never let analytics crash the app
      }
    };
    setTimeout(run, 1500);
  }, []);
  return null;
}

function App() {
  return (
    <HelmetProvider>
      <ErrorBoundary>
        <ThemeProvider defaultTheme="light">
          <TooltipProvider>
            <AiShellProvider>
              <Toaster />
              <PageViewTracker />
              <AppBadgeSyncer />
              <AppDeepLinkHandler />
              <PushAutoInitializer />
              <PushNavigationHandler />
              <RouteTracker />
              <ScrollRestorationManager />
              <NetworkStatusOverlay />
              <Router />
              <AppBottomNav />
              <AiShellGate />
              <FloatingActionStack />
              <ConsentGate />
              <OnboardingTour />
            </AiShellProvider>
          </TooltipProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </HelmetProvider>
  );
}

export default App;
