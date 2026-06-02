import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Home, Search, MessageCircle, Heart, User } from "lucide-react";

const TABS = [
  { path: "/",          icon: Home,          label: "首頁" },
  { path: "/search",    icon: Search,        label: "搜尋" },
  { path: "/messages",  icon: MessageCircle, label: "訊息" },
  { path: "/favorites", icon: Heart,         label: "收藏" },
  { path: "/member",    icon: User,          label: "我的" },
] as const;

export function AppBottomNav() {
  const [isNative, setIsNative] = useState(false);
  const [location, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const unreadQuery = trpc.chat.unreadCount.useQuery(undefined, {
    enabled: isNative && isAuthenticated,
    refetchInterval: 30000,
  });
  const userUnread = unreadQuery.data?.userCount ?? 0;

  useEffect(() => {
    import("@capacitor/core").then(({ Capacitor }) => {
      setIsNative(Capacitor.isNativePlatform());
    }).catch(() => {});
  }, []);

  if (!isNative) return null;

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
          {TABS.map(({ path, icon: Icon, label }) => {
            const isActive =
              path === "/" ? location === "/" : location.startsWith(path);

            return (
              <button
                key={path}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 min-w-[48px] transition-colors ${
                  isActive
                    ? "text-orange-500"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => navigate(path)}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {path === "/messages" && userUnread > 0 && (
                    <span className="pointer-events-none absolute -top-1 -right-1 h-2 w-2 rounded-full bg-orange-500" />
                  )}
                </div>
                <span className="text-[10px] font-medium leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
