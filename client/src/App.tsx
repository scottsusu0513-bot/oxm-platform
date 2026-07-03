import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { lazy, Suspense, useEffect, useState, useMemo } from "react";
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

// ── 公開頁面 ──────────────────────────────────────────────────────────────
const Home                  = lazy(() => import("./pages/Home"));
const Search                = lazy(() => import("./pages/Search"));
const FactoryDetail         = lazy(() => import("./pages/FactoryDetail"));
const IndustryPage          = lazy(() => import("./pages/IndustryPage"));
const FactoryRegister       = lazy(() => import("./pages/FactoryRegister"));
const FactoryDashboard      = lazy(() => import("./pages/FactoryDashboard"));
const ChatPage              = lazy(() => import("./pages/ChatPage"));
const MyMessages            = lazy(() => import("./pages/MyMessages"));
const MyFavorites           = lazy(() => import("./pages/MyFavorites"));
const MemberCenter          = lazy(() => import("./pages/MemberCenter"));
const Announcements         = lazy(() => import("./pages/Announcements"));
const BlogList              = lazy(() => import("./pages/BlogList"));
const BlogPost              = lazy(() => import("./pages/BlogPost"));
const PrivacyPolicyPage     = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsPage             = lazy(() => import("./pages/TermsPage"));
const VerifyEmailPage       = lazy(() => import("./pages/VerifyEmailPage"));
const UserManual            = lazy(() => import("./pages/UserManual"));
const Community             = lazy(() => import("./pages/Community"));
const Notifications         = lazy(() => import("./pages/Notifications"));
const EnterpriseUpgradeCenter = lazy(() => import("./pages/EnterpriseUpgradeCenter"));
const EnterpriseUpgradeApply  = lazy(() => import("./pages/EnterpriseUpgradeApply"));
const NotFound              = lazy(() => import("./pages/NotFound"));
const OrderDetail           = lazy(() => import("./pages/OrderDetail"));

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
const ConsultantCases        = lazy(() => import("./pages/ConsultantCases"));
const AdminAnnouncements    = lazy(() => import("./pages/AdminAnnouncements"));
const AdminMessages         = lazy(() => import("./pages/AdminMessages"));
const AdminMessageDetail    = lazy(() => import("./pages/AdminMessageDetail"));

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

function Router() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/search" component={Search} />
        <Route path="/industry/:slug/:sub" component={IndustryPage} />
        <Route path="/industry/:slug" component={IndustryPage} />
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
        <Route path="/admin/announcements" component={AdminAnnouncements} />
        <Route path="/admin/messages/:campaignId" component={AdminMessages} />
        <Route path="/admin/messages" component={AdminMessages} />
        <Route path="/admin-message/:id" component={AdminMessageDetail} />
        <Route path="/blog/:slug" component={BlogPost} />
        <Route path="/blog" component={BlogList} />
        <Route path="/announcements" component={Announcements} />
        <Route path="/manual" component={UserManual} />
        <Route path="/privacy" component={PrivacyPolicyPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/community/*?" component={Community} />
        <Route path="/orders/:orderId" component={OrderDetail} />
        <Route path="/upgrade-center/apply" component={EnterpriseUpgradeApply} />
        <Route path="/upgrade-center" component={EnterpriseUpgradeCenter} />
        <Route path="/upgrade-consultant/cases" component={ConsultantCases} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
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
            <Toaster />
            <PageViewTracker />
            <AppBadgeSyncer />
            <AppDeepLinkHandler />
            <PushAutoInitializer />
            <PushNavigationHandler />
            <NetworkStatusOverlay />
            <Router />
            <AppBottomNav />
          </TooltipProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </HelmetProvider>
  );
}

export default App;
