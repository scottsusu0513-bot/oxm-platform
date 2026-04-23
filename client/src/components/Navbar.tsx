import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { Factory, MessageCircle, User, LogOut, LayoutDashboard, Menu, X, UserPlus, Search, Settings, Heart, UserCircle, ChevronDown, FileText, ScrollText } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
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

  const unreadQuery = trpc.chat.unreadCount.useQuery(undefined, { enabled: isAuthenticated, refetchInterval: 30000 });
  const pendingCountQuery = trpc.admin.getPendingCount.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === 'admin',
    refetchInterval: 120000,
  });
  const reviewUnreadQuery = trpc.review.unreadCount.useQuery(
    undefined,
    { enabled: isAuthenticated && !!user?.isFactoryOwner, refetchInterval: 60000 }
  );
  const reviewUnread = reviewUnreadQuery.data?.count ?? 0;

  const pendingCount = pendingCountQuery.data?.count ?? 0;
  // userUnread：買家收到工廠回覆 → 顯示在「我的訊息」
  // factoryUnread：工廠收到買家詢問 → 顯示在「工廠後台」按鈕
  const userUnread = unreadQuery.data?.userCount ?? 0;
  const factoryUnread = unreadQuery.data?.factoryCount ?? 0;
  const factoryBadgeCount = factoryUnread + reviewUnread;
  const showFactoryBadge = factoryBadgeCount > 0;

  return (
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
              {user?.isFactoryOwner && (
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
              {!user?.isFactoryOwner && (
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
              <a href={getLoginUrl()}>
                <Button variant="outline" size="sm">
                  <UserPlus className="w-4 h-4 mr-1" />
                  註冊用戶
                </Button>
              </a>
              <Link href="/register-factory">
                <Button variant="outline" size="sm">
                  <Factory className="w-4 h-4 mr-1" />
                  註冊工廠
                </Button>
              </Link>
              <a href={getLoginUrl()}>
                <Button size="sm" className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">登入</Button>
              </a>
            </div>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
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
              {user?.isFactoryOwner ? (
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
              ) : (
                <Link href="/register-factory" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start"><Factory className="w-4 h-4 mr-2" />註冊工廠</Button>
                </Link>
              )}
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
              <a href={getLoginUrl()} onClick={() => setMobileOpen(false)}>
                <Button variant="outline" className="w-full justify-start"><UserPlus className="w-4 h-4 mr-2" />註冊用戶</Button>
              </a>
              <Link href="/register-factory" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" className="w-full justify-start"><Factory className="w-4 h-4 mr-2" />註冊工廠</Button>
              </Link>
              <a href={getLoginUrl()} onClick={() => setMobileOpen(false)}>
                <Button className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0">登入</Button>
              </a>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
