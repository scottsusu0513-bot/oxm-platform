import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { Factory, MessageCircle, User, LogOut, LayoutDashboard, Menu, X, UserPlus, Search, Settings, Heart, UserCircle, ChevronDown, FileText, ScrollText } from "lucide-react";
import UnverifiedEmailHint from "@/components/UnverifiedEmailHint";
import { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import LoginDialog from "@/components/LoginDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  const unreadQuery = trpc.chat.unreadCount.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 30000 });
  const pendingCountQuery = trpc.admin.getPendingCount.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === 'admin',
    refetchInterval: 120000,
  });
  const [reviewSeenAt, setReviewSeenAt] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('oxm_reviews_seen') ?? '0', 10); } catch { return 0; }
  });
  useEffect(() => {
    const handler = () => {
      try { setReviewSeenAt(parseInt(localStorage.getItem('oxm_reviews_seen') ?? '0', 10)); } catch {}
    };
    window.addEventListener('oxm-reviews-viewed', handler);
    return () => window.removeEventListener('oxm-reviews-viewed', handler);
  }, []);
  const reviewUnreadQuery = trpc.review.unreadCount.useQuery(
    { since: reviewSeenAt > 0 ? reviewSeenAt : undefined },
    { enabled: isAuthenticated && !!user?.isFactoryOwner, refetchInterval: 60000 }
  );
  const reviewUnread = reviewUnreadQuery.data?.count ?? 0;

  // 次管理者：無 isFactoryOwner 但有 co-managed factories → 也顯示工廠後台按鈕
  const coManagedQuery = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: isAuthenticated && !user?.isFactoryOwner,
    staleTime: 60000,
  });
  const showDashboardBtn = user?.isFactoryOwner || (!coManagedQuery.isLoading && (coManagedQuery.data?.length ?? 0) > 0);

  const pendingCount = pendingCountQuery.data?.count ?? 0;
  // userUnread：買家收到工廠回覆 → 顯示在「我的訊息」
  // factoryUnread：工廠收到買家詢問 → 顯示在「工廠後台」按鈕
  const userUnread = unreadQuery.data?.userCount ?? 0;
  const factoryUnread = unreadQuery.data?.factoryCount ?? 0;
  const factoryBadgeCount = factoryUnread + reviewUnread;
  const showFactoryBadge = factoryBadgeCount > 0;

  const showEmailHint = isAuthenticated && user && !user.primaryEmailVerifiedAt;
  // 手機版漢堡按鈕紅點：選單內任一項目有未讀通知時顯示
  const hasAnyNotification = isAuthenticated && (userUnread > 0 || showFactoryBadge || pendingCount > 0);

  return (
    <>
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-border">
      <div className="container flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-extrabold text-xl no-underline">
          <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent text-2xl tracking-tight">OXM</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          <Link href="/search">
            <Button variant={location.startsWith("/search") ? "secondary" : "ghost"} size="sm">
              <Search className="w-4 h-4 mr-1" />
              搜尋工廠
            </Button>
          </Link>
          {isAuthenticated && (
            <>
              <Link href="/messages">
                <Button variant={location === "/messages" ? "secondary" : "ghost"} size="sm" className="relative">
                  <MessageCircle className="w-4 h-4 mr-1" />
                  我的訊息
                  {userUnread > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                      {userUnread}
                    </span>
                  )}
                </Button>
              </Link>
              <Link href="/favorites">
                <Button variant={location === "/favorites" ? "secondary" : "ghost"} size="sm">
                  <Heart className="w-4 h-4 mr-1" />
                  我的收藏
                </Button>
              </Link>
              {showDashboardBtn && (
                <Link href="/dashboard">
                  <Button variant={location === "/dashboard" ? "secondary" : "ghost"} size="sm" className="relative">
                    <LayoutDashboard className="w-4 h-4 mr-1" />
                    工廠/工作室
                    {showFactoryBadge && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                        {factoryBadgeCount}
                      </span>
                    )}
                  </Button>
                </Link>
              )}
              {!showDashboardBtn && !coManagedQuery.isLoading && (
                <Link href="/register-factory">
                  <Button variant="ghost" size="sm">
                    <Factory className="w-4 h-4 mr-1" />
                    註冊工廠
                  </Button>
                </Link>
              )}
              {user?.role === "admin" && (
                <Link href="/admin">
                  <Button variant={location === "/admin" ? "secondary" : "ghost"} size="sm" className="relative">
  <Settings className="w-4 h-4 mr-1" />
  管理員
  {pendingCount > 0 && (
    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
      {pendingCount}
    </span>
  )}
</Button>
                </Link>
              )}
            </>
          )}
        </nav>

        {/* Auth */}
        <div className="hidden md:flex items-center gap-2">
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              {showEmailHint && <UnverifiedEmailHint />}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5">
                    <User className="w-4 h-4" />
                    <span className="text-sm">{user?.name ?? "使用者"}</span>
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem asChild>
                    <Link href="/member" className="flex items-center gap-2 cursor-pointer">
                      <UserCircle className="w-4 h-4" />
                      會員中心
                    </Link>
                  </DropdownMenuItem>
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
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={(e) => { e.preventDefault(); setLoginDialogOpen(true); }}>
                <UserPlus className="w-4 h-4 mr-1" />
                註冊用戶
              </Button>
              <Link href="/register-factory">
                <Button variant="outline" size="sm">
                  <Factory className="w-4 h-4 mr-1" />
                  註冊工廠
                </Button>
              </Link>
              <Button type="button" size="sm" className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0" onClick={(e) => { e.preventDefault(); setLoginDialogOpen(true); }}>登入</Button>
            </div>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <div className="md:hidden flex items-center gap-1">
          {showEmailHint && <UnverifiedEmailHint />}
          <Button variant="ghost" size="sm" className="relative" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            {hasAnyNotification && !mobileOpen && (
              <span className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-background" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-white p-4 space-y-2">
          <Link href="/search" onClick={() => setMobileOpen(false)}>
            <Button variant="ghost" className="w-full justify-start"><Search className="w-4 h-4 mr-2" />搜尋工廠</Button>
          </Link>
          {isAuthenticated && (
            <>
              <Link href="/messages" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full justify-start relative">
                  <MessageCircle className="w-4 h-4 mr-2" />
                  我的訊息
                  {userUnread > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                      {userUnread}
                    </span>
                  )}
                </Button>
              </Link>
              {showDashboardBtn ? (
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start relative">
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    工廠管理
                    {showFactoryBadge && (
                      <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
                        {factoryBadgeCount}
                      </span>
                    )}
                  </Button>
                </Link>
              ) : !coManagedQuery.isLoading ? (
                <Link href="/register-factory" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start"><Factory className="w-4 h-4 mr-2" />註冊工廠</Button>
                </Link>
              ) : null}
              {user?.role === "admin" && (
  <Link href="/admin" onClick={() => setMobileOpen(false)}>
    <Button variant="ghost" className="w-full justify-start relative">
      <Settings className="w-4 h-4 mr-2" />
      管理員
      {pendingCount > 0 && (
        <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center">
          {pendingCount}
        </span>
      )}
    </Button>
  </Link>
)}
              <Link href="/member" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full justify-start"><UserCircle className="w-4 h-4 mr-2" />會員中心</Button>
              </Link>
              <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => { logout(); setMobileOpen(false); }}>
                <LogOut className="w-4 h-4 mr-2" />登出
              </Button>
            </>
          )}
          {!isAuthenticated && (
            <div className="space-y-2">
              <Button type="button" variant="outline" className="w-full justify-start" onClick={(e) => { e.preventDefault(); setMobileOpen(false); setLoginDialogOpen(true); }}><UserPlus className="w-4 h-4 mr-2" />註冊用戶</Button>
              <Link href="/register-factory" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" className="w-full justify-start"><Factory className="w-4 h-4 mr-2" />註冊工廠</Button>
              </Link>
              <Button type="button" className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0" onClick={(e) => { e.preventDefault(); setMobileOpen(false); setLoginDialogOpen(true); }}>登入</Button>
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
