import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Home, Search, MessageCircle, Bell, User } from "lucide-react";

type Tab = {
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Returns true when this tab should be highlighted for the given location. */
  isActive: (loc: string) => boolean;
};

const TABS: Tab[] = [
  {
    path: "/",
    icon: Home,
    label: "首頁",
    isActive: (loc) => loc === "/",
  },
  {
    path: "/search",
    icon: Search,
    label: "搜尋",
    isActive: (loc) => loc.startsWith("/search"),
  },
  {
    path: "/messages",
    icon: MessageCircle,
    label: "訊息",
    // /messages, /messages/*, and /chat/:conversationId all belong to the chat tab
    isActive: (loc) => loc.startsWith("/messages") || loc.startsWith("/chat/"),
  },
  {
    path: "/notifications",
    icon: Bell,
    label: "通知",
    isActive: (loc) => loc.startsWith("/notifications"),
  },
  {
    path: "/member",
    icon: User,
    label: "會員中心",
    isActive: (loc) => loc.startsWith("/member"),
  },
];

export function AppBottomNav() {
  const [isNative, setIsNative] = useState(false);
  const [location, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const chatUnreadQuery = trpc.chat.unreadCount.useQuery(undefined, {
    enabled: isNative && isAuthenticated,
    refetchInterval: 30000,
  });
  const userUnread = chatUnreadQuery.data?.userCount ?? 0;

  const notifUnreadQuery = trpc.community.notificationUnreadCount.useQuery(undefined, {
    enabled: isNative && isAuthenticated,
    refetchInterval: 60000,
  });
  const notifUnread = notifUnreadQuery.data?.count ?? 0;

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
          {TABS.map(({ path, icon: Icon, label, isActive: checkActive }) => {
            const isActive = checkActive(location);

            return (
              <button
                key={path}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-[48px] flex-1 transition-colors ${
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
                  {path === "/notifications" && notifUnread > 0 && (
                    <span className="pointer-events-none absolute -top-1 -right-1 h-2 w-2 rounded-full bg-orange-500" />
                  )}
                </div>
                <span className="text-[9px] font-medium leading-none whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
