import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import {
  Factory, MessageCircle, User, LogOut, LayoutDashboard, Menu, X,
  UserPlus, Search, Settings, Heart, UserCircle, ChevronDown,
  FileText, ScrollText, Bell, Briefcase, Lock,
  Rocket, Users, Package, BookOpen, MessageSquare,
} from "lucide-react";
import UnverifiedEmailHint from "@/components/UnverifiedEmailHint";
import { useState, useEffect, useRef } from "react";
import type { ComponentType, SVGProps } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import LoginDialog from "@/components/LoginDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

interface HubItem {
  label: string;
  short: string;
  soon: boolean;
  Icon: NavIcon;
  iconCls: string;
  /** Desktop pill card: bg + border + text */
  card: string;
  /** Desktop pill card hover classes (active items only) */
  cardHover: string;
  /** Mobile card gradient classes */
  mCard: string;
  /** Mobile card text color */
  mText: string;
}

const HUB_ITEMS: HubItem[] = [
  {
    label: "商機媒合中心", short: "找工廠", soon: false,
    Icon: Search, iconCls: "text-orange-500",
    card: "bg-gradient-to-br from-orange-500/10 to-purple-600/10 border-orange-300/40 text-orange-700",
    cardHover: "hover:from-orange-500/20 hover:to-purple-600/20 hover:border-orange-400/60 hover:shadow-sm hover:shadow-orange-500/10 hover:-translate-y-px",
    mCard: "from-orange-500/10 to-purple-600/10 border-orange-300/40", mText: "text-orange-700",
  },
  {
    label: "企業升級中心", short: "找補助", soon: true,
    Icon: Rocket, iconCls: "text-blue-400/60",
    card: "bg-gradient-to-br from-blue-600/8 to-violet-600/8 border-blue-300/20 text-blue-900/30",
    cardHover: "",
    mCard: "from-blue-600/8 to-violet-600/8 border-blue-300/20", mText: "text-blue-600/40",
  },
  {
    label: "人才與技術中心", short: "找人才", soon: true,
    Icon: Users, iconCls: "text-teal-400/60",
    card: "bg-gradient-to-br from-teal-500/8 to-cyan-600/8 border-teal-300/20 text-teal-900/30",
    cardHover: "",
    mCard: "from-teal-500/8 to-cyan-600/8 border-teal-300/20", mText: "text-teal-600/40",
  },
  {
    label: "產業採購與資源中心", short: "找採購", soon: true,
    Icon: Package, iconCls: "text-amber-400/60",
    card: "bg-gradient-to-br from-amber-500/8 to-orange-600/8 border-amber-300/20 text-amber-900/30",
    cardHover: "",
    mCard: "from-amber-500/8 to-orange-600/8 border-amber-300/20", mText: "text-amber-600/40",
  },
  {
    label: "傳產知識與情報中心", short: "找消息", soon: true,
    Icon: BookOpen, iconCls: "text-indigo-400/60",
    card: "bg-gradient-to-br from-indigo-600/8 to-purple-700/8 border-indigo-300/20 text-indigo-900/30",
    cardHover: "",
    mCard: "from-indigo-600/8 to-purple-700/8 border-indigo-300/20", mText: "text-indigo-600/40",
  },
  {
    label: "產業討論區", short: "找討論", soon: true,
    Icon: MessageSquare, iconCls: "text-rose-400/60",
    card: "bg-gradient-to-br from-rose-500/8 to-pink-600/8 border-rose-300/20 text-rose-900/30",
    cardHover: "",
    mCard: "from-rose-500/8 to-pink-600/8 border-rose-300/20", mText: "text-rose-600/40",
  },
];

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [searchDropOpen, setSearchDropOpen] = useState(false);
  const searchDropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mobileOpen) {
      setMenuClosing(false);
      setMenuVisible(true);
      return;
    }
    setMenuClosing(true);
    const t = setTimeout(() => {
      setMenuVisible(false);
      setMenuClosing(false);
    }, 200);
    return () => clearTimeout(t);
  }, [mobileOpen]);

  const openSearchDrop = () => {
    if (searchDropTimer.current) clearTimeout(searchDropTimer.current);
    setSearchDropOpen(true);
  };
  const closeSearchDropDelayed = () => {
    searchDropTimer.current = setTimeout(() => setSearchDropOpen(false), 200);
  };

  const unreadQuery = trpc.chat.unreadCount.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 30000 });
  const pendingCountQuery = trpc.admin.getPendingCount.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
    refetchInterval: 120000,
  });
  const adminNotifQuery = trpc.admin.getAdminNotifications.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
    refetchInterval: 60000,
  });
  const [reviewSeenAt, setReviewSeenAt] = useState<number>(() => {
    try { return parseInt(localStorage.getItem("oxm_reviews_seen") ?? "0", 10); } catch { return 0; }
  });
  useEffect(() => {
    const handler = () => {
      try { setReviewSeenAt(parseInt(localStorage.getItem("oxm_reviews_seen") ?? "0", 10)); } catch {}
    };
    window.addEventListener("oxm-reviews-viewed", handler);
    return () => window.removeEventListener("oxm-reviews-viewed", handler);
  }, []);
  const reviewUnreadQuery = trpc.review.unreadCount.useQuery(
    { since: reviewSeenAt > 0 ? reviewSeenAt : undefined },
    { enabled: isAuthenticated && !!user?.isFactoryOwner, refetchInterval: 60000 }
  );
  const reviewUnread = reviewUnreadQuery.data?.count ?? 0;

  const communityNotifQuery = trpc.community.notificationUnreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 60000,
  });
  const communityUnread = communityNotifQuery.data?.count ?? 0;

  const coManagedQuery = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: isAuthenticated && !user?.isFactoryOwner,
    staleTime: 60000,
  });
  const showDashboardBtn = user?.isFactoryOwner || (!coManagedQuery.isLoading && (coManagedQuery.data?.length ?? 0) > 0);

  const isAdmin = user?.role === "admin";
  const userId = user?.id;
  const consultantProfilesQuery = trpc.upgradeConsultant.myProfiles.useQuery(undefined, {
    enabled: isAuthenticated && !isAdmin,
    staleTime: 120000,
    refetchOnMount: "always",
  });

  // 用 localStorage 快取顧問身份（key 依 user id 區分，避免 App WebView 跨帳號快取污染）
  // 初始值設 false；useEffect 在 userId 與 query 資料都就位後正確更新
  const [consultantActiveCache, setConsultantActiveCache] = useState(false);
  useEffect(() => {
    if (!isAuthenticated || !userId) {
      try { localStorage.removeItem("oxm_consultant_active"); } catch {}   // 清除舊版全域 key
      setConsultantActiveCache(false);
      return;
    }
    const userKey = `oxm_consultant_active_${userId}`;
    if (consultantProfilesQuery.data !== undefined) {
      // Query 已回傳：以伺服器結果為準，更新此 user 的快取
      const active = consultantProfilesQuery.data.some(p => p.isActive);
      try { localStorage.setItem(userKey, active ? "1" : "0"); } catch {}
      try { localStorage.removeItem("oxm_consultant_active"); } catch {}   // 清除舊版全域 key
      setConsultantActiveCache(active);
      return;
    }
    // Query 尚未回傳：先讀此 user 的快取值作為初始顯示，避免閃爍
    try { setConsultantActiveCache(localStorage.getItem(userKey) === "1"); } catch {}
  }, [isAuthenticated, userId, consultantProfilesQuery.data]);

  const showConsultantCenter = isAdmin || consultantActiveCache;

  const pendingCount = pendingCountQuery.data?.count ?? 0;
  const hasAdminNotification = !!(adminNotifQuery.data?.hasMessageReplies || adminNotifQuery.data?.hasSupportPending);
  const userUnread = unreadQuery.data?.userCount ?? 0;
  const factoryUnread = unreadQuery.data?.factoryCount ?? 0;
  const factoryBadgeCount = factoryUnread + reviewUnread;
  const showFactoryBadge = factoryBadgeCount > 0;

  const showEmailHint = isAuthenticated && user && !user.primaryEmailVerifiedAt;
  const hasAnyNotification = isAuthenticated && (userUnread > 0 || showFactoryBadge || pendingCount > 0 || hasAdminNotification || communityUnread > 0);

  return (
    <>
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-border" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="container flex items-center justify-between h-16 gap-2">

        {/* Logo */}
        <Link href="/" className="flex items-center font-extrabold text-xl no-underline shrink-0">
          <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent text-2xl tracking-tight">OXM</span>
        </Link>

        {/* ── Desktop: 六大方向入口（lg: 1024px+） ── */}
        <nav className="hidden lg:flex items-center gap-3 flex-1 justify-center min-w-0 mx-2">
          {HUB_ITEMS.map((hub) => {
            if (hub.label === "企業升級中心") {
              return (
                <Link key={hub.label} href="/upgrade-center">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-150 whitespace-nowrap cursor-pointer bg-gradient-to-br from-blue-600/10 to-violet-600/10 border-blue-300/40 text-blue-700 hover:from-blue-600/20 hover:to-violet-600/20 hover:border-blue-400/60 hover:shadow-sm hover:shadow-blue-500/10 hover:-translate-y-px"
                  >
                    <hub.Icon className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                    {hub.short}
                  </button>
                </Link>
              );
            }

            if (!hub.soon) {
              // 商機媒合中心 — click 導向媒合首頁，hover 顯示下拉
              return (
                <div
                  key={hub.label}
                  className="relative"
                  onMouseEnter={openSearchDrop}
                  onMouseLeave={closeSearchDropDelayed}
                >
                  <Link href="/">
                    <button
                      type="button"
                      aria-label={hub.label}
                      title={hub.label}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-150 whitespace-nowrap cursor-pointer ${hub.card} ${hub.cardHover}`}
                    >
                      <hub.Icon className={`w-3.5 h-3.5 shrink-0 ${hub.iconCls}`} />
                      {hub.short}
                      <ChevronDown className={`w-2.5 h-2.5 opacity-50 transition-transform duration-150 ${searchDropOpen ? "rotate-180" : ""}`} />
                    </button>
                  </Link>
                  {searchDropOpen && (
                    <div
                      className="absolute top-full left-0 mt-1.5 bg-white border border-border rounded-xl shadow-lg z-[200] min-w-[140px] py-1.5 overflow-hidden"
                      onMouseEnter={openSearchDrop}
                      onMouseLeave={closeSearchDropDelayed}
                    >
                      <Link href="/search" onClick={() => setSearchDropOpen(false)}>
                        <div className="flex items-center gap-2.5 px-3 py-2 text-sm font-medium hover:bg-orange-50 hover:text-orange-700 transition-colors cursor-pointer whitespace-nowrap">
                          <Search className="w-3.5 h-3.5 text-orange-500" />
                          搜尋工廠
                        </div>
                      </Link>
                    </div>
                  )}
                </div>
              );
            }

            // 即將開放 — 不可互動
            return (
              <span
                key={hub.label}
                aria-disabled="true"
                aria-label={`${hub.label}（即將開放）`}
                title="即將開放"
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap cursor-not-allowed select-none ${hub.card}`}
              >
                <hub.Icon className={`w-3.5 h-3.5 shrink-0 ${hub.iconCls}`} />
                {hub.short}
                <Lock className="w-2.5 h-2.5 shrink-0 opacity-40" />
              </span>
            );
          })}
        </nav>

        {/* ── Desktop Right: 信件｜鈴鐺｜使用者 ── */}
        <div className="hidden lg:flex items-center gap-1 shrink-0">
          {showEmailHint && <UnverifiedEmailHint />}

          {isAuthenticated && (
            <>
              {/* 信件 icon */}
              <Link href="/messages">
                <Button
                  variant={location === "/messages" ? "secondary" : "ghost"}
                  size="sm"
                  className="relative h-8 w-8 p-0"
                  title="我的訊息"
                >
                  <MessageCircle className="w-4 h-4" />
                  {userUnread > 0 && (
                    <span className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-background" />
                  )}
                </Button>
              </Link>

              {/* 鈴鐺 icon（已登入即顯示） */}
              <Link href="/notifications">
                <Button
                  variant={location.startsWith("/notifications") ? "secondary" : "ghost"}
                  size="sm"
                  className="relative h-8 w-8 p-0"
                  title="通知中心"
                >
                  <Bell className="w-4 h-4" />
                  {communityUnread > 0 && (
                    <span className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-background" />
                  )}
                </Button>
              </Link>
            </>
          )}

          {/* 使用者下拉 */}
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 max-w-[140px]">
                  <User className="w-4 h-4 shrink-0" />
                  <span className="text-sm truncate">{user?.name ?? "使用者"}</span>
                  <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href="/member" className="flex items-center gap-2 cursor-pointer">
                    <UserCircle className="w-4 h-4" />
                    會員中心
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/favorites" className="flex items-center gap-2 cursor-pointer">
                    <Heart className="w-4 h-4" />
                    我的收藏
                  </Link>
                </DropdownMenuItem>
                {showDashboardBtn ? (
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard" className="flex items-center gap-2 cursor-pointer">
                      <LayoutDashboard className="w-4 h-4" />
                      工廠管理
                      {showFactoryBadge && (
                        <span className="ml-auto h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                      )}
                    </Link>
                  </DropdownMenuItem>
                ) : !coManagedQuery.isLoading ? (
                  <DropdownMenuItem asChild>
                    <Link href="/register-factory" className="flex items-center gap-2 cursor-pointer">
                      <Factory className="w-4 h-4" />
                      註冊工廠
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {showConsultantCenter && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/upgrade-consultant/cases" className="flex items-center gap-2 cursor-pointer text-orange-600 focus:text-orange-600">
                        <Briefcase className="w-4 h-4" />
                        顧問中心
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/admin" className="flex items-center gap-2 cursor-pointer">
                        <Settings className="w-4 h-4" />
                        管理員
                        {(pendingCount > 0 || hasAdminNotification) && (
                          <span className="ml-auto h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                        )}
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/privacy" className="flex items-center gap-2 cursor-pointer">
                    <FileText className="w-4 h-4" />
                    隱私權政策
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/terms" className="flex items-center gap-2 cursor-pointer">
                    <ScrollText className="w-4 h-4" />
                    服務條款
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive gap-2 cursor-pointer">
                  <LogOut className="w-4 h-4" />
                  登出
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={(e) => { e.preventDefault(); setLoginDialogOpen(true); }}>
                <UserPlus className="w-4 h-4 mr-1" />
                註冊
              </Button>
              <Link href="/register-factory">
                <Button variant="outline" size="sm">
                  <Factory className="w-4 h-4 mr-1" />
                  工廠
                </Button>
              </Link>
              <Button type="button" size="sm" className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0" onClick={(e) => { e.preventDefault(); setLoginDialogOpen(true); }}>
                登入
              </Button>
            </div>
          )}
        </div>

        {/* ── Mobile / Tablet（< lg）: 信件｜鈴鐺｜漢堡 ── */}
        <div className="lg:hidden flex items-center gap-1">
          {showEmailHint && <UnverifiedEmailHint />}
          {isAuthenticated && (
            <>
              <Link href="/messages">
                <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0">
                  <MessageCircle className="w-4 h-4" />
                  {userUnread > 0 && (
                    <span className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-background" />
                  )}
                </Button>
              </Link>
              <Link href="/notifications">
                <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0">
                  <Bell className="w-4 h-4" />
                  {communityUnread > 0 && (
                    <span className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-background" />
                  )}
                </Button>
              </Link>
            </>
          )}
          <Button variant="ghost" size="sm" className="relative" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            {hasAnyNotification && !mobileOpen && (
              <span className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-background" />
            )}
          </Button>
        </div>
      </div>

      {/* ── Mobile Menu ── */}
      {menuVisible && (
        <div
          className={`lg:hidden border-t border-border bg-white px-4 pt-3 ${menuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          {/* 六大方向入口 — 2 欄卡片 */}
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-1 pt-1 pb-2">OXM 主要入口</p>
          <div className="grid grid-cols-2 gap-2">
            {HUB_ITEMS.map((hub) => {
              const cardBase = `flex flex-col items-center gap-2 p-3 rounded-xl border bg-gradient-to-br ${hub.mCard} transition-colors`;

              if (hub.label === "企業升級中心") {
                return (
                  <Link key={hub.label} href="/upgrade-center" onClick={() => setMobileOpen(false)}>
                    <div className={`${cardBase} active:opacity-80`}>
                      <hub.Icon className="w-5 h-5 text-blue-500" />
                      <span className="text-xs font-semibold text-center text-blue-700">{hub.short}</span>
                      <span className="text-[9px] text-blue-500/70">進入中心 →</span>
                    </div>
                  </Link>
                );
              }

              if (!hub.soon) {
                return (
                  <Link key={hub.label} href="/" onClick={() => setMobileOpen(false)}>
                    <div className={`${cardBase} active:opacity-80`}>
                      <hub.Icon className={`w-5 h-5 ${hub.iconCls}`} />
                      <span className={`text-xs font-semibold text-center ${hub.mText}`}>{hub.short}</span>
                      <span className="text-[9px] text-orange-500/70">進入首頁 →</span>
                    </div>
                  </Link>
                );
              }

              return (
                <div
                  key={hub.label}
                  aria-disabled="true"
                  className={`${cardBase} cursor-not-allowed select-none opacity-60`}
                >
                  <hub.Icon className={`w-5 h-5 ${hub.iconCls}`} />
                  <span className={`text-xs font-semibold text-center ${hub.mText}`}>{hub.short}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 leading-none">即將開放</span>
                </div>
              );
            })}
          </div>

          {/* 個人功能 */}
          {isAuthenticated && (
            <div className="border-t border-border/50 pt-2 mt-3 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 pb-0.5">我的帳戶</p>

              {showDashboardBtn ? (
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start relative">
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    工廠管理
                    {showFactoryBadge && (
                      <span className="ml-auto h-2.5 w-2.5 rounded-full bg-orange-500 shrink-0" />
                    )}
                  </Button>
                </Link>
              ) : !coManagedQuery.isLoading ? (
                <Link href="/register-factory" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">
                    <Factory className="w-4 h-4 mr-2" />
                    註冊工廠
                  </Button>
                </Link>
              ) : null}

              {showConsultantCenter && (
                <Link href="/upgrade-consultant/cases" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start text-orange-600">
                    <Briefcase className="w-4 h-4 mr-2" />
                    顧問中心
                  </Button>
                </Link>
              )}

              {isAdmin && (
                <Link href="/admin" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start relative">
                    <Settings className="w-4 h-4 mr-2" />
                    管理員
                    {(pendingCount > 0 || hasAdminNotification) && (
                      <span className="ml-auto h-2.5 w-2.5 rounded-full bg-orange-500 shrink-0" />
                    )}
                  </Button>
                </Link>
              )}

              <Link href="/favorites" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full justify-start">
                  <Heart className="w-4 h-4 mr-2" />
                  我的收藏
                </Button>
              </Link>

              <Link href="/member" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full justify-start">
                  <UserCircle className="w-4 h-4 mr-2" />
                  會員中心
                </Button>
              </Link>

              <Button
                variant="ghost"
                className="w-full justify-start text-destructive"
                onClick={() => { logout(); setMobileOpen(false); }}
              >
                <LogOut className="w-4 h-4 mr-2" />
                登出
              </Button>
            </div>
          )}

          {!isAuthenticated && (
            <div className="border-t border-border/50 pt-2 mt-3 space-y-2">
              <Button type="button" variant="outline" className="w-full justify-center" onClick={(e) => { e.preventDefault(); setMobileOpen(false); setLoginDialogOpen(true); }}>
                <UserPlus className="w-4 h-4 mr-2" />
                註冊用戶
              </Button>
              <Link href="/register-factory" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" className="w-full justify-center">
                  <Factory className="w-4 h-4 mr-2" />
                  註冊工廠
                </Button>
              </Link>
              <Button type="button" className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0" onClick={(e) => { e.preventDefault(); setMobileOpen(false); setLoginDialogOpen(true); }}>
                登入
              </Button>
              <p className="text-xs text-muted-foreground text-center pt-1 leading-5">
                手機建議使用 OXM APP 登入<br />避免內建瀏覽器阻擋帳號登入或綁定
              </p>
            </div>
          )}
        </div>
      )}
    </header>
    <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </>
  );
}
