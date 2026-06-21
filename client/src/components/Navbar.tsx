import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import {
  Factory, MessageCircle, User, LogOut, LayoutDashboard, Menu, X,
  UserPlus, Search, Settings, Heart, UserCircle, ChevronDown,
  FileText, ScrollText, Bell, Briefcase, Lock,
} from "lucide-react";
import UnverifiedEmailHint from "@/components/UnverifiedEmailHint";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import LoginDialog from "@/components/LoginDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const COMING_SOON = [
  "人才與技術中心",
  "產業採購與資源中心",
  "傳產知識與情報中心",
  "產業討論區",
] as const;

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
  const consultantProfilesQuery = trpc.upgradeConsultant.myProfiles.useQuery(undefined, {
    enabled: isAuthenticated && !isAdmin,
    staleTime: 120000,
  });
  const showConsultantCenter = isAdmin || (consultantProfilesQuery.data?.some(p => p.isActive) ?? false);

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
        <nav className="hidden lg:flex items-center gap-0.5 flex-1 justify-center min-w-0 mx-1">

          {/* 1. 商機媒合中心 — hover + click dropdown */}
          <div
            className="relative"
            onMouseEnter={openSearchDrop}
            onMouseLeave={closeSearchDropDelayed}
          >
            <Button
              variant={location.startsWith("/search") ? "secondary" : "ghost"}
              size="sm"
              className="text-[11px] px-2 h-8 gap-0.5 whitespace-nowrap"
              onClick={() => setSearchDropOpen(v => !v)}
            >
              商機媒合中心
              <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${searchDropOpen ? "rotate-180" : ""}`} />
            </Button>
            {searchDropOpen && (
              <div
                className="absolute top-full left-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-[200] min-w-[130px] py-1"
                onMouseEnter={openSearchDrop}
                onMouseLeave={closeSearchDropDelayed}
              >
                <Link href="/search" onClick={() => setSearchDropOpen(false)}>
                  <div className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded cursor-pointer whitespace-nowrap">
                    <Search className="w-3.5 h-3.5 text-muted-foreground" />
                    搜尋工廠
                  </div>
                </Link>
              </div>
            )}
          </div>

          {/* 2. 企業升級中心 — 已開放 */}
          <Link href="/upgrade-center">
            <Button
              variant={location.startsWith("/upgrade-center") || location.startsWith("/upgrade-consultant") ? "secondary" : "ghost"}
              size="sm"
              className="text-[11px] px-2 h-8 whitespace-nowrap"
            >
              企業升級中心
            </Button>
          </Link>

          {/* 3–6. 即將開放（不可互動） */}
          {COMING_SOON.map(label => (
            <span
              key={label}
              className="inline-flex items-center gap-0.5 px-2 h-8 text-[11px] font-medium text-muted-foreground/40 cursor-not-allowed rounded-md select-none whitespace-nowrap"
              title="即將開放"
              aria-disabled="true"
            >
              <Lock className="w-2.5 h-2.5 shrink-0" />
              {label}
            </span>
          ))}
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

              {/* 鈴鐺 icon（管理員才顯示） */}
              {isAdmin && (
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
              )}
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
                      工廠工作室
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
              {isAdmin && (
                <Link href="/notifications">
                  <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0">
                    <Bell className="w-4 h-4" />
                    {communityUnread > 0 && (
                      <span className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-background" />
                    )}
                  </Button>
                </Link>
              )}
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
          className={`lg:hidden border-t border-border bg-white px-4 pt-3 space-y-1 ${menuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
        >
          {/* 六大方向入口 */}
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-2 pt-1 pb-0.5">OXM 主要入口</p>

          <Link href="/search" onClick={() => setMobileOpen(false)}>
            <Button variant="ghost" className="w-full justify-start text-sm">
              <Search className="w-4 h-4 mr-2 text-orange-500" />
              商機媒合中心
              <span className="ml-2 text-xs text-muted-foreground">搜尋工廠</span>
            </Button>
          </Link>

          <Link href="/upgrade-center" onClick={() => setMobileOpen(false)}>
            <Button variant="ghost" className="w-full justify-start text-sm">
              <Briefcase className="w-4 h-4 mr-2 text-orange-500" />
              企業升級中心
            </Button>
          </Link>

          {COMING_SOON.map(label => (
            <div
              key={label}
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground/40 cursor-not-allowed select-none rounded-md"
              aria-disabled="true"
            >
              <Lock className="w-4 h-4 shrink-0" />
              <span>{label}</span>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 whitespace-nowrap">即將開放</span>
            </div>
          ))}

          {/* 個人功能 */}
          {isAuthenticated && (
            <div className="border-t border-border/50 pt-2 mt-2 space-y-1">
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
            <div className="border-t border-border/50 pt-2 mt-2 space-y-2">
              <Button type="button" variant="outline" className="w-full justify-start" onClick={(e) => { e.preventDefault(); setMobileOpen(false); setLoginDialogOpen(true); }}>
                <UserPlus className="w-4 h-4 mr-2" />
                註冊用戶
              </Button>
              <Link href="/register-factory" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" className="w-full justify-start">
                  <Factory className="w-4 h-4 mr-2" />
                  註冊工廠
                </Button>
              </Link>
              <Button type="button" className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0" onClick={(e) => { e.preventDefault(); setMobileOpen(false); setLoginDialogOpen(true); }}>
                登入
              </Button>
              <p className="text-xs text-muted-foreground text-center pt-1">
                手機請使用 Chrome 或 Safari 登入
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
