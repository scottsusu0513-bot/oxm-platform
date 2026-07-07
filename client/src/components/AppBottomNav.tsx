import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Home, Search, Mail, User, Factory } from "lucide-react";

export function AppBottomNav() {
  const [isNative, setIsNative] = useState(false);
  const [location, navigate] = useLocation();
  const { isAuthenticated, user } = useAuth();

  // Chat unread badge
  const chatUnreadQuery = trpc.chat.unreadCount.useQuery(undefined, {
    enabled: isNative && isAuthenticated,
    refetchInterval: 30000,
  });
  const userUnread = chatUnreadQuery.data?.userCount ?? 0;
  const factoryUnread = chatUnreadQuery.data?.factoryCount ?? 0;

  // Factory ownership check (mirrors Navbar logic)
  const coManagedQuery = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: isNative && isAuthenticated && !user?.isFactoryOwner,
    staleTime: 60000,
  });
  const showDashboard =
    user?.isFactoryOwner ||
    (!coManagedQuery.isLoading && (coManagedQuery.data?.length ?? 0) > 0);

  useEffect(() => {
    import("@capacitor/core").then(({ Capacitor }) => {
      setIsNative(Capacitor.isNativePlatform());
    }).catch(() => {});
  }, []);

  if (!isNative) return null;

  const handleFactoryTap = () => {
    if (!isAuthenticated) {
      // 未登入：回首頁，讓使用者透過 Navbar 登入
      navigate("/");
      return;
    }
    navigate(showDashboard ? "/dashboard" : "/register-factory");
  };

  const isFactoryActive =
    location.startsWith("/dashboard") || location.startsWith("/register-factory");

  const staticTabs = [
    {
      path: "/",
      Icon: Home,
      label: "首頁",
      isActive: location === "/",
      badge: false,
      onClick: () => navigate("/"),
    },
    {
      path: "/search",
      Icon: Search,
      label: "搜尋",
      isActive: location.startsWith("/search"),
      badge: false,
      onClick: () => navigate("/search"),
    },
    {
      path: "/messages",
      Icon: Mail,
      label: "訊息",
      isActive: location.startsWith("/messages") || location.startsWith("/chat/"),
      badge: (userUnread + factoryUnread) > 0,
      onClick: () => navigate("/messages"),
    },
  ];

  return (
    <>
      {/* Height placeholder so fixed nav doesn't cover page content */}
      <div
        style={{ height: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
        aria-hidden="true"
      />

      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="主要導航"
      >
        <div className="flex items-center justify-around h-14">
          {/* 靜態入口：首頁、搜尋、訊息 */}
          {staticTabs.map(({ path, Icon, label, isActive, badge, onClick }) => (
            <button
              key={path}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-[48px] flex-1 transition-colors ${
                isActive ? "text-orange-500" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={onClick}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge && (
                  <span className="pointer-events-none absolute -top-1 -right-1 h-2 w-2 rounded-full bg-orange-500" />
                )}
              </div>
              <span className="text-[9px] font-medium leading-none whitespace-nowrap">{label}</span>
            </button>
          ))}

          {/* 工廠管理（動態：有工廠→/dashboard，無工廠→/register-factory，未登入→/） */}
          <button
            className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-[48px] flex-1 transition-colors ${
              isFactoryActive ? "text-orange-500" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={handleFactoryTap}
            aria-label="工廠管理"
            aria-current={isFactoryActive ? "page" : undefined}
          >
            <Factory className="w-5 h-5" />
            <span className="text-[9px] font-medium leading-none whitespace-nowrap">工廠管理</span>
          </button>

          {/* 會員中心 */}
          <button
            className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-[48px] flex-1 transition-colors ${
              location.startsWith("/member") ? "text-orange-500" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => navigate("/member")}
            aria-label="會員中心"
            aria-current={location.startsWith("/member") ? "page" : undefined}
          >
            <User className="w-5 h-5" />
            <span className="text-[9px] font-medium leading-none whitespace-nowrap">會員中心</span>
          </button>
        </div>
      </nav>
    </>
  );
}
