import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import { trpc } from "@/lib/trpc";
import { lazy, Suspense, useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { HelmetProvider } from "react-helmet-async";
import { toast } from "sonner";

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
const NotFound              = lazy(() => import("./pages/NotFound"));

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
const AdminAnnouncements    = lazy(() => import("./pages/AdminAnnouncements"));
const AdminMessages         = lazy(() => import("./pages/AdminMessages"));
const AdminMessageDetail    = lazy(() => import("./pages/AdminMessageDetail"));

// Handles oxm://oauth/callback?ticket=... deep links on Android
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

function PageFallback() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <span className="text-2xl font-bold tracking-widest text-orange-500">OXM</span>
      <span className="text-sm text-muted-foreground">載入中...</span>
    </div>
  );
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
        <Route path="/admin/announcements" component={AdminAnnouncements} />
        <Route path="/admin/messages/:campaignId" component={AdminMessages} />
        <Route path="/admin/messages" component={AdminMessages} />
        <Route path="/admin-message/:id" component={AdminMessageDetail} />
        <Route path="/blog/:slug" component={BlogPost} />
        <Route path="/blog" component={BlogList} />
        <Route path="/announcements" component={Announcements} />
        <Route path="/privacy" component={PrivacyPolicyPage} />
        <Route path="/terms" component={TermsPage} />
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
            <AppDeepLinkHandler />
            <Router />
          </TooltipProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </HelmetProvider>
  );
}

export default App;
