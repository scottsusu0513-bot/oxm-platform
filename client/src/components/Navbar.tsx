import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import {
  Factory, Mail, User, LogOut, LayoutDashboard, Menu, X,
  UserPlus, Search, Settings, Heart, UserCircle, ChevronDown,
  FileText, ScrollText, Bell, Briefcase, Lock,
  Rocket, Users, Package, BookOpen, MessageSquare, Lightbulb,
} from "lucide-react";
import UnverifiedEmailHint from "@/components/UnverifiedEmailHint";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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

/** 手機版 Accordion 用的穩定 key，六大入口各對應一個，不隨文案調整而改變 */
type MobileHubKey = "factory" | "resource" | "talent" | "brand" | "news" | "discussion";

interface HubDropdownItem {
  title: string;
  description: string;
  /** 有值才可導頁；未開放子項不設定 href */
  href?: string;
  disabled?: boolean;
  Icon: NavIcon;
}

interface HubItem {
  /** 手機版 Accordion 展開狀態用的穩定識別（見 mobileOpenHub） */
  key: MobileHubKey;
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
  /**
   * 桌面版「找資源」下拉選單的子項內容，也是手機版 Accordion 展開內容的唯一
   * 資料來源（title／description／href／disabled／Icon），桌面與手機共用同一份，
   * 不在手機 JSX 另外硬編碼六份文案。
   */
  dropdown: HubDropdownItem[];
}

const HUB_ITEMS: HubItem[] = [
  {
    key: "factory",
    label: "商機媒合中心", short: "找工廠", soon: false,
    Icon: Search, iconCls: "text-orange-500",
    card: "bg-gradient-to-br from-orange-500/10 to-purple-600/10 border-orange-300/40 text-orange-700",
    cardHover: "hover:from-orange-500/20 hover:to-purple-600/20 hover:border-orange-400/60 hover:shadow-sm hover:shadow-orange-500/10 hover:-translate-y-px",
    mCard: "from-orange-500/10 to-purple-600/10 border-orange-300/40", mText: "text-orange-700",
    dropdown: [
      { title: "搜尋工廠", description: "瀏覽台灣工廠與代工資源", href: "/search", Icon: Search },
    ],
  },
  {
    key: "resource",
    label: "企業升級中心", short: "找資源", soon: false,
    // iconCls／mCard／mText 用於手機版 Accordion 橫條與桌面「找工廠」分支；
    // 找資源桌面版 dropdown 觸發鈕的樣式是獨立硬編碼（見下方 hub.key === "resource"
    // 分支），不讀這幾個欄位，故調整這裡不會影響桌面版。找資源已是正式開放入口，
    // 這裡改用清楚可辨識的藍紫色，避免跟找人才／找形象等「即將開放」的低透明度
    // muted 樣式混淆。
    Icon: Rocket, iconCls: "text-blue-600",
    card: "bg-gradient-to-br from-blue-600/8 to-violet-600/8 border-blue-300/20 text-blue-900/30",
    cardHover: "",
    mCard: "from-blue-500/15 to-violet-600/15 border-blue-300/50", mText: "text-blue-700",
    dropdown: [
      {
        title: "政府補助專區",
        description: "SBIR、CITD、SIIR 等企業補助媒合",
        href: "/upgrade-center",
        Icon: Lightbulb,
      },
    ],
  },
  {
    key: "talent",
    label: "人才與技術中心", short: "找人才", soon: true,
    Icon: Users, iconCls: "text-teal-400/60",
    card: "bg-gradient-to-br from-teal-500/8 to-cyan-600/8 border-teal-300/20 text-teal-900/30",
    cardHover: "",
    mCard: "from-teal-500/8 to-cyan-600/8 border-teal-300/20", mText: "text-teal-600/40",
    dropdown: [
      { title: "人才與技術媒合", description: "即將開放", disabled: true, Icon: Users },
    ],
  },
  {
    key: "brand",
    label: "產業採購與資源中心", short: "找形象", soon: true,
    Icon: Package, iconCls: "text-amber-400/60",
    card: "bg-gradient-to-br from-amber-500/8 to-orange-600/8 border-amber-300/20 text-amber-900/30",
    cardHover: "",
    mCard: "from-amber-500/8 to-orange-600/8 border-amber-300/20", mText: "text-amber-600/40",
    dropdown: [
      { title: "品牌與形象升級", description: "即將開放", disabled: true, Icon: Package },
    ],
  },
  {
    key: "news",
    label: "傳產知識與情報中心", short: "找消息", soon: true,
    Icon: BookOpen, iconCls: "text-indigo-400/60",
    card: "bg-gradient-to-br from-indigo-600/8 to-purple-700/8 border-indigo-300/20 text-indigo-900/30",
    cardHover: "",
    mCard: "from-indigo-600/8 to-purple-700/8 border-indigo-300/20", mText: "text-indigo-600/40",
    dropdown: [
      { title: "產業消息與情報", description: "即將開放", disabled: true, Icon: BookOpen },
    ],
  },
  {
    key: "discussion",
    label: "產業討論區", short: "找討論", soon: true,
    Icon: MessageSquare, iconCls: "text-rose-400/60",
    card: "bg-gradient-to-br from-rose-500/8 to-pink-600/8 border-rose-300/20 text-rose-900/30",
    cardHover: "",
    mCard: "from-rose-500/8 to-pink-600/8 border-rose-300/20", mText: "text-rose-600/40",
    dropdown: [
      { title: "產業討論區", description: "即將開放", disabled: true, Icon: MessageSquare },
    ],
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

  // OXM 品牌區下拉選單（左上角）：目前僅「首頁」一個項目
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const brandMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!brandMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (brandMenuRef.current && !brandMenuRef.current.contains(e.target as Node)) {
        setBrandMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [brandMenuOpen]);

  // 桌面版「找資源」下拉選單：點擊觸發、點擊外部或 Escape 收合
  const [resourceDropOpen, setResourceDropOpen] = useState(false);
  const resourceDropRef = useRef<HTMLDivElement | null>(null);
  // 手機版六大入口 Accordion：單一 state 記錄目前展開的入口 key，一次最多展開一個；
  // 點其他入口時原本展開的自動收合，再次點擊目前展開的入口則收合。
  const [mobileOpenHub, setMobileOpenHub] = useState<MobileHubKey | null>(null);

  useEffect(() => {
    if (!resourceDropOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (resourceDropRef.current && !resourceDropRef.current.contains(e.target as Node)) {
        setResourceDropOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setResourceDropOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [resourceDropOpen]);

  // 路由切換後自動關閉下拉選單／手機主選單。手機選單內每個會導頁的連結本來就會
  // 自行呼叫 setMobileOpen(false)，這裡是防禦性保險（例如瀏覽器上一頁/下一頁），
  // 確保任何情況下路由一變就不會殘留 body scroll lock。
  useEffect(() => {
    setBrandMenuOpen(false);
    setResourceDropOpen(false);
    setMobileOpenHub(null);
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    if (mobileOpen) {
      setMenuClosing(false);
      setMenuVisible(true);
      return;
    }
    setMenuClosing(true);
    setMobileOpenHub(null);
    const t = setTimeout(() => {
      setMenuVisible(false);
      setMenuClosing(false);
    }, 200);
    return () => clearTimeout(t);
  }, [mobileOpen]);

  // 手機主選單背景 scroll lock：mobileOpen 開啟時鎖住 body 捲動，並記住開啟前的
  // scrollY；關閉（或元件 unmount）時完整還原 body 原本的 inline style 與捲動位置。
  // 只用 overflow:hidden 在部分 iOS Safari／WebView 情況下背景仍可能滑動或跳動，
  // 這裡改用「body position:fixed + 負值 top」的做法，是目前公認在 iOS Safari／
  // Android Chrome／Capacitor WebView 都可靠的做法。
  useEffect(() => {
    if (!mobileOpen) return;

    const scrollY = window.scrollY;
    const body = document.body;

    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;

      window.scrollTo(0, scrollY);
    };
  }, [mobileOpen]);

  // 手機選單內會另外開啟 LoginDialog 的兩個按鈕（註冊／登入）專用：跳過選單本身
  // 200ms 的淡出動畫、立即卸載，確保 LoginDialog 開啟當下手機選單 overlay 已經
  // 不在畫面上，不會有選單淡出過程短暫蓋住 LoginDialog 的情況。
  const closeMobileMenuForDialog = () => {
    setMobileOpen(false);
    setMenuClosing(false);
    setMenuVisible(false);
    setMobileOpenHub(null);
  };

  const openSearchDrop = () => {
    if (searchDropTimer.current) clearTimeout(searchDropTimer.current);
    setBrandMenuOpen(false);
    setResourceDropOpen(false);
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

        {/* Logo + 品牌下拉選單 */}
        <div className="relative shrink-0" ref={brandMenuRef}>
          <button
            type="button"
            onClick={() => {
              setSearchDropOpen(false);
              setResourceDropOpen(false);
              setMobileOpenHub(null);
              setBrandMenuOpen(v => !v);
            }}
            aria-haspopup="true"
            aria-expanded={brandMenuOpen}
            className="flex items-center gap-0.5 font-extrabold text-xl no-underline cursor-pointer"
          >
            <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent text-2xl tracking-tight">OXM</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground/70 transition-transform duration-150 ${brandMenuOpen ? "rotate-180" : ""}`} />
          </button>

          {brandMenuOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-[160px] bg-white border border-border rounded-xl shadow-lg z-[200] py-1.5 overflow-hidden">
              <Link href="/" onClick={() => setBrandMenuOpen(false)}>
                <div className="px-3.5 py-2 text-sm font-medium text-foreground hover:bg-orange-50 hover:text-orange-700 transition-colors cursor-pointer">
                  首頁
                </div>
              </Link>
            </div>
          )}
        </div>

        {/* ── Desktop: 六大方向入口（lg: 1024px+） ── */}
        <nav className="hidden lg:flex items-center gap-3 flex-1 justify-center min-w-0 mx-2">
          {HUB_ITEMS.map((hub) => {
            if (hub.key === "resource") {
              return (
                <div key={hub.label} className="relative" ref={resourceDropRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setBrandMenuOpen(false);
                      setSearchDropOpen(false);
                      setResourceDropOpen(v => !v);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={resourceDropOpen}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-150 whitespace-nowrap cursor-pointer bg-gradient-to-br from-blue-600/10 to-violet-600/10 border-blue-300/40 text-blue-700 hover:from-blue-600/20 hover:to-violet-600/20 hover:border-blue-400/60 hover:shadow-sm hover:shadow-blue-500/10 hover:-translate-y-px"
                  >
                    <hub.Icon className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                    {hub.short}
                    <ChevronDown className={`w-2.5 h-2.5 opacity-60 transition-transform duration-150 ${resourceDropOpen ? "rotate-180" : ""}`} />
                  </button>
                  {resourceDropOpen && (
                    <div className="absolute top-full left-0 mt-1.5 w-72 bg-white border border-border rounded-xl shadow-lg z-[200] py-1.5 overflow-hidden">
                      {hub.dropdown.filter((item) => item.href && !item.disabled).map((item) => (
                        <Link key={item.href} href={item.href!} onClick={() => setResourceDropOpen(false)}>
                          <div className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-orange-50 transition-colors cursor-pointer">
                            <item.Icon className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">{item.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
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
                  <Mail className="w-4 h-4" />
                  {(userUnread + factoryUnread) > 0 && (
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
                  <Mail className="w-4 h-4" />
                  {(userUnread + factoryUnread) > 0 && (
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

      {/* ── Mobile Menu ──
          Portal 到 document.body：脫離 <header> 自身的 stacking context，
          避免同為 z-50、但在 DOM 中排在 header 之後的頁面浮動按鈕（返回鍵、
          聯繫工廠按鈕、公告按鈕等）視覺上蓋過手機選單。外層 fixed inset-0
          從 header 高度往下鋪滿整個 viewport，作為背景 pointer-event 阻擋層；
          內層才是實際可捲動的選單內容，捲動只發生在這裡，不會傳遞到背景頁面。 */}
      {menuVisible && createPortal(
        <div
          className="lg:hidden fixed inset-0 z-[60]"
          style={{ paddingTop: "calc(4rem + env(safe-area-inset-top, 0px))" }}
        >
        <div
          className={`h-full overflow-y-auto overscroll-contain touch-pan-y border-t border-border bg-white px-4 pt-3 ${menuClosing ? "animate-menu-exit" : "animate-menu-enter"}`}
          style={{
            WebkitOverflowScrolling: "touch",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
          }}
        >
          {/* 六大方向入口 — 統一滿寬橫條 Accordion，一次最多展開一個 */}
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest px-1 pt-1 pb-2">OXM 主要入口</p>
          <div className="flex flex-col gap-2">
            {HUB_ITEMS.map((hub) => {
              const isOpen = mobileOpenHub === hub.key;
              return (
                <div key={hub.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setBrandMenuOpen(false);
                      setMobileOpenHub(current => (current === hub.key ? null : hub.key));
                    }}
                    aria-expanded={isOpen}
                    aria-controls={`mobile-hub-panel-${hub.key}`}
                    className={`w-full h-12 flex items-center justify-between gap-2 px-4 rounded-xl border bg-gradient-to-br ${hub.mCard} transition-colors active:opacity-80`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <hub.Icon className={`w-5 h-5 shrink-0 ${hub.iconCls}`} />
                      <span className={`text-sm font-semibold truncate ${hub.mText}`}>{hub.short}</span>
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""} ${hub.key === "resource" ? "text-blue-600" : "opacity-60"}`}
                    />
                  </button>

                  <div
                    id={`mobile-hub-panel-${hub.key}`}
                    aria-hidden={!isOpen}
                    inert={!isOpen}
                    style={{
                      display: "grid",
                      gridTemplateRows: isOpen ? "1fr" : "0fr",
                      transition: "grid-template-rows 200ms ease-out",
                    }}
                  >
                    <div className="overflow-hidden">
                      <div className="mt-1.5 mb-0.5 mx-1 space-y-1">
                        {hub.dropdown.map((item) =>
                          item.href && !item.disabled ? (
                            <Link
                              key={item.title}
                              href={item.href}
                              onClick={() => { setMobileOpen(false); setMobileOpenHub(null); }}
                            >
                              <div className="flex items-start gap-2 py-2 px-3 rounded-lg hover:bg-orange-50 active:opacity-70 cursor-pointer transition-colors">
                                <item.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${hub.iconCls}`} />
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-foreground">{item.title}</p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
                                </div>
                              </div>
                            </Link>
                          ) : (
                            <div
                              key={item.title}
                              aria-disabled="true"
                              className="flex items-start gap-2 py-2 px-3 rounded-lg opacity-60 cursor-not-allowed select-none"
                            >
                              <item.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${hub.iconCls}`} />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
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
              <Button type="button" variant="outline" className="w-full justify-center" onClick={(e) => { e.preventDefault(); closeMobileMenuForDialog(); setLoginDialogOpen(true); }}>
                <UserPlus className="w-4 h-4 mr-2" />
                註冊用戶
              </Button>
              <Link href="/register-factory" onClick={() => setMobileOpen(false)}>
                <Button variant="outline" className="w-full justify-center">
                  <Factory className="w-4 h-4 mr-2" />
                  註冊工廠
                </Button>
              </Link>
              <Button type="button" className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0" onClick={(e) => { e.preventDefault(); closeMobileMenuForDialog(); setLoginDialogOpen(true); }}>
                登入
              </Button>
              <p className="text-xs text-muted-foreground text-center pt-1 leading-5">
                手機建議使用 OXM APP 登入<br />避免內建瀏覽器阻擋帳號登入或綁定
              </p>
            </div>
          )}
        </div>
        </div>,
        document.body
      )}
    </header>
    <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </>
  );
}
