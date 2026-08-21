import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import {
  Factory, Mail, User, LogOut, LayoutDashboard, Menu, X,
  UserPlus, Search, Settings, UserCircle, ChevronDown,
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

/** 手機版 Accordion 用的穩定 key，主要入口各對應一個，不隨文案調整而改變 */
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
  /** 手機版 Accordion 展開狀態用的穩定識別（見 mobileOpenHub），也是桌面版共用
   *  下拉選單狀態（openHubKey）的識別鍵，兩者共用同一個 key 空間。 */
  key: MobileHubKey;
  label: string;
  short: string;
  /**
   * 主入口本身合法的預設頁面。有值時點擊主入口一律正常導頁（例如找工廠 → "/"）；
   * 不設定時代表這個入口只是選單父層，點擊只切換下拉選單開關（例如找資源／找消息）。
   * 桌面版共用 hover dropdown（見 renderDesktopHub）依此欄位分流，不必逐一入口
   * 另外判斷。
   */
  href?: string;
  soon: boolean;
  Icon: NavIcon;
  /** 手機版 Accordion 橫條圖示顏色；鎖定入口的桌面 pill 圖示也讀這個 */
  iconCls: string;
  /** 桌面版下拉觸發鈕與選單項目圖示顏色（僅開放中入口使用，鎖定入口不會用到） */
  triggerIconCls: string;
  /** 桌面版下拉觸發鈕 focus-visible 的 ring 顏色 */
  ring: string;
  /** Desktop pill card: bg + border + text */
  card: string;
  /** Desktop pill card hover classes (active items only) */
  cardHover: string;
  /** Mobile card gradient classes */
  mCard: string;
  /** Mobile card text color */
  mText: string;
  /**
   * 桌面版下拉選單的子項內容，也是手機版 Accordion 展開內容的唯一資料來源
   * （title／description／href／disabled／Icon），桌面與手機共用同一份，不在手機
   * JSX 另外硬編碼六份文案。是否具備下拉能力（supportsDropdown）不用額外欄位
   * 手動維護，而是由 `!soon && dropdownItems 內有至少一個可導頁的項目` 直接推導
   * （見 hubHasDropdown），避免未來新增子項目時忘記同步切一個開關欄位。
   */
  dropdownItems: HubDropdownItem[];
}

/** 是否具備下拉選單能力：soon 入口一律沒有，開放中入口則看 dropdownItems 是否
 *  至少有一個可導頁且未停用的子項。未來人才／形象／討論解鎖時，只要把 soon 改
 *  false 並補上真正的 dropdownItems，這裡會自動判定為 true，桌面版就會自動套用
 *  跟找工廠／找資源／找消息完全相同的共用 hover dropdown 邏輯，不必再改互動程式。 */
function hubHasDropdown(hub: HubItem): boolean {
  return !hub.soon && hub.dropdownItems.some((item) => item.href && !item.disabled);
}

/** 桌面版下拉觸發鈕的共用基礎樣式：所有開放中入口（找工廠／找資源／找消息，
 *  以及未來解鎖的入口）都吃這一份，只有 hub.card／hub.cardHover／hub.ring 的
 *  品牌配色不同，展開速度／圓角／邊框／陰影／間距／z-index 等容器結構一律一致。 */
const HUB_TRIGGER_BASE =
  "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-150 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2";
const HUB_MENU_PANEL =
  "absolute top-full left-0 mt-1.5 w-72 bg-white border border-border rounded-xl shadow-lg z-[200] py-1.5 overflow-hidden";
const HUB_MENU_ITEM =
  "flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-orange-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-orange-50";

const HUB_ITEMS: HubItem[] = [
  {
    key: "factory",
    label: "商機媒合中心", short: "找工廠", href: "/search", soon: false,
    // 找工廠主入口直接導向 /search（真正的搜尋／篩選／列表功能頁），不再是
    // 品牌首頁 "/"——首頁與找工廠是兩個獨立角色（見 shared/seo/publicPages.ts
    // 的 home 設定、client/src/pages/Search.tsx 的自我 canonical），首頁本身
    // 仍可透過左上角 OXM 品牌 Logo 進入。dropdownItems 刻意留空：main href
    // 本身已經直接指向搜尋功能頁，不需要再放一個目的地完全相同的下拉子項
    // （桌機／手機共用的渲染邏輯已支援「有 href、無下拉」的單一直接入口，
    // 見 hubHasDropdown 與桌機／手機各自的 trigger 分支）。
    Icon: Search, iconCls: "text-orange-500", triggerIconCls: "text-orange-500", ring: "focus-visible:ring-orange-400",
    card: "bg-gradient-to-br from-orange-500/10 to-purple-600/10 border-orange-300/40 text-orange-700",
    cardHover: "hover:from-orange-500/20 hover:to-purple-600/20 hover:border-orange-400/60 hover:shadow-sm hover:shadow-orange-500/10 hover:-translate-y-px",
    mCard: "from-orange-500/10 to-purple-600/10 border-orange-300/40", mText: "text-orange-700",
    dropdownItems: [],
  },
  {
    key: "resource",
    label: "資源服務中心", short: "找資源", href: "/resources", soon: false,
    // 找資源主入口直接導向 /resources 資源總覽頁；下拉選單額外提供目前唯一
    // 已開放子服務「政府補助專區」的快速連結（模式與找工廠 href="/" +
    // 「搜尋工廠」→/search 完全相同）。/resources 頁面本身列出的另外四項
    // 服務目前是不可互動的「敬請期待」卡片（見 ResourceCenter.tsx），對應
    // route／component／API／資料庫與既有登入／工廠資格權限限制維持不變，
    // 已知網址的人仍可直接輸入進入。
    Icon: Rocket, iconCls: "text-blue-600", triggerIconCls: "text-blue-500", ring: "focus-visible:ring-blue-400",
    card: "bg-gradient-to-br from-blue-600/10 to-violet-600/10 border-blue-300/40 text-blue-700",
    cardHover: "hover:from-blue-600/20 hover:to-violet-600/20 hover:border-blue-400/60 hover:shadow-sm hover:shadow-blue-500/10 hover:-translate-y-px",
    mCard: "from-blue-500/15 to-violet-600/15 border-blue-300/50", mText: "text-blue-700",
    dropdownItems: [
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
    label: "人才與技術中心", short: "找人才", soon: false,
    // 找人才／找形象改為真正可進入的「準備開放中」Landing Page（見
    // client/src/components/SectionComingSoon.tsx），不再是鎖定、點擊沒反應
    // 的 disabled 樣式。跟找資源／找消息一樣採「不設 href、下拉單一真實項目」
    // 模式，桌機與手機共用同一份 dropdownItems，不需要另外改互動程式。
    Icon: Users, iconCls: "text-teal-600", triggerIconCls: "text-teal-600", ring: "focus-visible:ring-teal-400",
    card: "bg-gradient-to-br from-teal-500/10 to-cyan-600/10 border-teal-300/40 text-teal-700",
    cardHover: "hover:from-teal-500/20 hover:to-cyan-600/20 hover:border-teal-400/60 hover:shadow-sm hover:shadow-teal-500/10 hover:-translate-y-px",
    mCard: "from-teal-500/15 to-cyan-600/15 border-teal-300/50", mText: "text-teal-700",
    dropdownItems: [
      { title: "找人才", description: "傳統產業專業人才與企業需求的媒合入口", href: "/talent", Icon: Users },
    ],
  },
  {
    key: "brand",
    label: "產業採購與資源中心", short: "找形象", soon: false,
    // 說明同找人才：改為真正可進入的 Coming Soon 頁，不再鎖定。
    Icon: Package, iconCls: "text-amber-600", triggerIconCls: "text-amber-600", ring: "focus-visible:ring-amber-400",
    card: "bg-gradient-to-br from-amber-500/10 to-orange-600/10 border-amber-300/40 text-amber-700",
    cardHover: "hover:from-amber-500/20 hover:to-orange-600/20 hover:border-amber-400/60 hover:shadow-sm hover:shadow-amber-500/10 hover:-translate-y-px",
    mCard: "from-amber-500/15 to-orange-600/15 border-amber-300/50", mText: "text-amber-700",
    dropdownItems: [
      { title: "找形象", description: "企業品牌、內容與數位形象資源入口", href: "/brand", Icon: Package },
    ],
  },
  {
    key: "news",
    label: "傳產知識與情報中心", short: "找消息", soon: false,
    // 找消息已正式開放，桌面版下拉觸發鈕與找資源共用同一套 renderDesktopHub，讀
    // card／cardHover／ring／triggerIconCls，改用清楚可辨識的靛紫色，避免跟找人才／
    // 找形象等仍在「即將開放」的低透明度 muted 樣式混淆。
    Icon: BookOpen, iconCls: "text-indigo-600", triggerIconCls: "text-indigo-500", ring: "focus-visible:ring-indigo-400",
    card: "bg-gradient-to-br from-indigo-600/10 to-purple-600/10 border-indigo-300/40 text-indigo-700",
    cardHover: "hover:from-indigo-600/20 hover:to-purple-600/20 hover:border-indigo-400/60 hover:shadow-sm hover:shadow-indigo-500/10 hover:-translate-y-px",
    mCard: "from-indigo-500/15 to-purple-600/15 border-indigo-300/50", mText: "text-indigo-700",
    dropdownItems: [
      { title: "產業情報中心", description: "整合產業動態、競賽資訊、展覽活動與重要消息", href: "/news", Icon: BookOpen },
    ],
  },
  {
    key: "discussion",
    label: "產業討論區", short: "找討論", soon: false,
    // 找討論正式納入七大主入口，改為真正可進入的「準備開放中」Coming Soon
    // Landing Page，不再鎖定。沿用既有 /community route（該路由已有
    // COMMUNITY_FEATURE_STATUS 開關與 canAccessCommunity 權限判斷，見
    // client/src/pages/Community.tsx／client/src/components/community/
    // CommunityComingSoon.tsx），不建立第二條概念重複的 route。跟找資源／
    // 找消息一樣採「不設 href、下拉單一真實項目」模式，桌機與手機共用同一份
    // dropdownItems，不需要另外改互動程式。
    Icon: MessageSquare, iconCls: "text-rose-600", triggerIconCls: "text-rose-600", ring: "focus-visible:ring-rose-400",
    card: "bg-gradient-to-br from-rose-500/10 to-pink-600/10 border-rose-300/40 text-rose-700",
    cardHover: "hover:from-rose-500/20 hover:to-pink-600/20 hover:border-rose-400/60 hover:shadow-sm hover:shadow-rose-500/10 hover:-translate-y-px",
    mCard: "from-rose-500/15 to-pink-600/15 border-rose-300/50", mText: "text-rose-700",
    dropdownItems: [
      { title: "找討論", description: "讓傳統產業經驗、問題與合作需求有地方交流", href: "/community", Icon: MessageSquare },
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

  // OXM 品牌區下拉選單（左上角）：目前有「首頁」／「關於 OXM」／「FAQ」三個項目，桌機／
  // 手機共用同一份 DOM（沒有 breakpoint 拆兩套），不需要另外處理手機版。
  // Content 透過 createPortal 掛到 document.body、用 position:fixed + 手動算好的
  // 座標定位（brandMenuPos），而不是原本「absolute 相對 brandMenuRef 父層」的寫法：
  // <header> 本身是 position:sticky + z-50，會建立自己的 stacking context，裡面的
  // 子元素無論 z-index 開多高都只在這個 context 內部比較，出不去、贏不了手機選單
  // Portal（掛在 document.body、z-[60]）。所以手機選單開著時點「首頁 OXM」，這個
  // 下拉選單即使有 z-[200] 也還是會被手機選單蓋住。改成也 portal 到 document.body
  // 之後，才是跟手機選單在同一層比較 z-index，z-[70] 才真的贏得過 z-[60]。
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [brandMenuPos, setBrandMenuPos] = useState<{ top: number; left: number } | null>(null);
  const brandMenuRef = useRef<HTMLDivElement | null>(null);
  const brandMenuContentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!brandMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = !!brandMenuRef.current?.contains(target);
      const insideContent = !!brandMenuContentRef.current?.contains(target);
      if (!insideTrigger && !insideContent) {
        setBrandMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [brandMenuOpen]);

  // 桌面版六大入口共用下拉選單邏輯：找工廠／找資源／找消息目前都吃這一套（見
  // hubHasDropdown、renderDesktopHub），未來人才／形象／討論解鎖後沿用同一份
  // state／handler，不必再各自重做互動。單一 openHubKey 保證同時間只會有一個
  // 展開；hover 進入立即開啟、離開後帶 180ms 緩衝關閉（滑鼠移動到子選單途中經過
  // 間隙不會中途關閉，因為子選單自己的 onMouseEnter 也會呼叫 openHub 取消計時器）；
  // 外部點擊／Escape／路由切換都會關閉；Escape 額外把焦點還給觸發鈕。
  const [openHubKey, setOpenHubKey] = useState<MobileHubKey | null>(null);
  const hubCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hubTriggerRefs = useRef<Partial<Record<MobileHubKey, HTMLButtonElement | null>>>({});
  const hubContainerRefs = useRef<Partial<Record<MobileHubKey, HTMLDivElement | null>>>({});
  // 手機版六大入口 Accordion：單一 state 記錄目前展開的入口 key，一次最多展開一個；
  // 點其他入口時原本展開的自動收合，再次點擊目前展開的入口則收合。
  const [mobileOpenHub, setMobileOpenHub] = useState<MobileHubKey | null>(null);

  const clearHubCloseTimer = () => {
    if (hubCloseTimer.current) { clearTimeout(hubCloseTimer.current); hubCloseTimer.current = null; }
  };
  const openHub = (key: MobileHubKey) => {
    clearHubCloseTimer();
    setBrandMenuOpen(false);
    setOpenHubKey(key);
  };
  const scheduleCloseHub = () => {
    clearHubCloseTimer();
    hubCloseTimer.current = setTimeout(() => setOpenHubKey(null), 180);
  };
  const toggleHub = (key: MobileHubKey) => {
    clearHubCloseTimer();
    setBrandMenuOpen(false);
    setOpenHubKey((current) => (current === key ? null : key));
  };
  const closeHub = () => {
    clearHubCloseTimer();
    setOpenHubKey(null);
  };

  useEffect(() => clearHubCloseTimer, []);

  useEffect(() => {
    if (!openHubKey) return;
    const key = openHubKey;
    const handleClickOutside = (e: MouseEvent) => {
      const container = hubContainerRefs.current[key];
      if (container && !container.contains(e.target as Node)) {
        setOpenHubKey(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenHubKey(null);
        hubTriggerRefs.current[key]?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openHubKey]);

  // 路由切換後自動關閉下拉選單／手機主選單。手機選單內每個會導頁的連結本來就會
  // 自行呼叫 setMobileOpen(false)，這裡是防禦性保險（例如瀏覽器上一頁/下一頁），
  // 確保任何情況下路由一變就不會殘留 body scroll lock。
  useEffect(() => {
    setBrandMenuOpen(false);
    setOpenHubKey(null);
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
  // 財務優化顧問身份：與企業補助顧問完全獨立的查詢／快取，任一方有效都會顯示
  // 「顧問中心」入口，兩者皆有效或為管理員時導向分流頁（/consultant-center）。
  const financeConsultantProfilesQuery = trpc.financeConsultant.myProfiles.useQuery(undefined, {
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

  // 財務優化顧問身份快取，與上方企業補助顧問快取用同一套手法、獨立的 key。
  const [financeConsultantActiveCache, setFinanceConsultantActiveCache] = useState(false);
  useEffect(() => {
    if (!isAuthenticated || !userId) {
      setFinanceConsultantActiveCache(false);
      return;
    }
    const userKey = `oxm_finance_consultant_active_${userId}`;
    if (financeConsultantProfilesQuery.data !== undefined) {
      const active = financeConsultantProfilesQuery.data.some(p => p.isActive);
      try { localStorage.setItem(userKey, active ? "1" : "0"); } catch {}
      setFinanceConsultantActiveCache(active);
      return;
    }
    try { setFinanceConsultantActiveCache(localStorage.getItem(userKey) === "1"); } catch {}
  }, [isAuthenticated, userId, financeConsultantProfilesQuery.data]);

  const showConsultantCenter = isAdmin || consultantActiveCache;
  const showFinanceConsultantCenter = isAdmin || financeConsultantActiveCache;
  const showAnyConsultantCenter = showConsultantCenter || showFinanceConsultantCenter;
  // 導頁目標：兩種顧問身份都有效（或管理員）時進入分流頁，只有單一身份時
  // 直接導向原本的案件頁——保留既有企業補助顧問「顧問中心」入口的原有行為，
  // 不因新增財務優化顧問而多一層點擊。
  const consultantCenterHref =
    isAdmin || (consultantActiveCache && financeConsultantActiveCache)
      ? "/consultant-center"
      : financeConsultantActiveCache
      ? "/finance-consultant/cases"
      : "/upgrade-consultant/cases";

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
              closeHub();
              setMobileOpenHub(null);
              const next = !brandMenuOpen;
              if (next && brandMenuRef.current) {
                const rect = brandMenuRef.current.getBoundingClientRect();
                setBrandMenuPos({ top: rect.bottom + 6, left: rect.left });
              }
              setBrandMenuOpen(next);
            }}
            aria-haspopup="true"
            aria-expanded={brandMenuOpen}
            className="flex items-center gap-1 no-underline cursor-pointer"
          >
            <img src="/logo-oxm.png" alt="OXM" className="h-7 w-auto shrink-0" />
            <ChevronDown className={`w-4 h-4 text-muted-foreground/70 transition-transform duration-150 ${brandMenuOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* 品牌下拉選單 content：portal 到 document.body，逃離 <header> 的 sticky+z-50
            stacking context，這樣 z-[70] 才會真的跟手機選單 Portal（z-[60]）在同一層
            比較、贏得過它。用 brandMenuPos（開啟當下量測 brandMenuRef 的位置）換算
            fixed 座標，視覺位置與原本 absolute 版本完全相同。 */}
        {brandMenuOpen && brandMenuPos && createPortal(
          <div
            ref={brandMenuContentRef}
            className="fixed w-[160px] bg-white border border-border rounded-xl shadow-lg z-[70] py-1.5 overflow-hidden"
            style={{ top: brandMenuPos.top, left: brandMenuPos.left }}
          >
            <Link href="/" onClick={() => setBrandMenuOpen(false)}>
              <div className="px-3.5 py-2 text-sm font-medium text-foreground hover:bg-orange-50 hover:text-orange-700 transition-colors cursor-pointer">
                首頁
              </div>
            </Link>
            <Link href="/about" onClick={() => setBrandMenuOpen(false)}>
              <div className="px-3.5 py-2 text-sm font-medium text-foreground hover:bg-orange-50 hover:text-orange-700 transition-colors cursor-pointer">
                關於 OXM
              </div>
            </Link>
            <Link href="/faq" onClick={() => setBrandMenuOpen(false)}>
              <div className="px-3.5 py-2 text-sm font-medium text-foreground hover:bg-orange-50 hover:text-orange-700 transition-colors cursor-pointer">
                常見問答 FAQ
              </div>
            </Link>
          </div>,
          document.body
        )}

        {/* ── Desktop: 六大方向入口（lg: 1024px+） ── */}
        <nav data-onboarding="services-nav" className="hidden lg:flex items-center gap-3 flex-1 justify-center min-w-0 mx-2">
          {HUB_ITEMS.map((hub) => {
            if (hub.soon) {
              // 即將開放 — 不可互動，不顯示任何下拉選單（既有「即將開放」提示維持原樣）
              return (
                <span
                  key={hub.key}
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
            }

            // 開放中入口共用同一套 hover dropdown 互動邏輯：找工廠／找資源／找消息
            // 目前都走這裡，未來人才／形象／討論解鎖後（soon 改 false、補上真正的
            // dropdownItems）也會自動走到這裡，不必再修改互動程式。
            const items = hub.dropdownItems.filter((item) => item.href && !item.disabled);
            const hasDropdown = items.length > 0;
            const isOpen = hasDropdown && openHubKey === hub.key;
            const contentId = `hub-dropdown-${hub.key}`;
            const triggerClassName = `${HUB_TRIGGER_BASE} ${hub.ring} ${hub.card} ${hub.cardHover}`;

            const triggerInner = (
              <>
                <hub.Icon className={`w-3.5 h-3.5 shrink-0 ${hub.triggerIconCls}`} />
                {hub.short}
                {hasDropdown && (
                  <ChevronDown className={`w-2.5 h-2.5 opacity-60 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
                )}
              </>
            );

            const trigger = hub.href ? (
              // 有合法預設頁面：整顆 pill 用 Link 包住，點擊一律正常導頁；hover 仍可
              // 額外開啟下拉選單（例如找工廠：點擊導向首頁，hover 顯示「搜尋工廠」）。
              <Link href={hub.href}>
                <button
                  type="button"
                  ref={(el) => { hubTriggerRefs.current[hub.key] = el; }}
                  aria-haspopup={hasDropdown ? "menu" : undefined}
                  aria-expanded={hasDropdown ? isOpen : undefined}
                  aria-controls={hasDropdown ? contentId : undefined}
                  onClick={() => setBrandMenuOpen(false)}
                  className={triggerClassName}
                >
                  {triggerInner}
                </button>
              </Link>
            ) : (
              // 只是選單父層，沒有自己的頁面：點擊切換下拉選單開關
              <button
                type="button"
                ref={(el) => { hubTriggerRefs.current[hub.key] = el; }}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-controls={contentId}
                onClick={() => toggleHub(hub.key)}
                className={triggerClassName}
              >
                {triggerInner}
              </button>
            );

            return (
              <div
                key={hub.key}
                className="relative"
                ref={(el) => { hubContainerRefs.current[hub.key] = el; }}
                onMouseEnter={hasDropdown ? () => openHub(hub.key) : undefined}
                onMouseLeave={hasDropdown ? scheduleCloseHub : undefined}
              >
                {trigger}
                {hasDropdown && isOpen && (
                  <div
                    id={contentId}
                    role="menu"
                    className={HUB_MENU_PANEL}
                    onMouseEnter={() => openHub(hub.key)}
                    onMouseLeave={scheduleCloseHub}
                  >
                    {items.map((item) => (
                      <Link key={item.href} href={item.href!} onClick={closeHub}>
                        <div role="menuitem" className={HUB_MENU_ITEM}>
                          <item.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${hub.triggerIconCls}`} />
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
                {showAnyConsultantCenter && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href={consultantCenterHref} className="flex items-center gap-2 cursor-pointer text-orange-600 focus:text-orange-600">
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
          <Button data-onboarding="services-menu" variant="ghost" size="sm" className="relative" onClick={() => setMobileOpen(!mobileOpen)}>
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
          聯繫工廠按鈕、公告按鈕等）視覺上蓋過手機選單。
          外層容器的框必須從 header 底部才開始（用 `top: calc(...)`），不能用
          `inset-0` + `paddingTop` 讓框從 y=0 就整個蓋住 viewport——那樣即使
          padding 區塊沒有畫任何東西，這個 z-[60] 的框仍然會蓋在 z-50 的
          <header> 正上方，把 header 自己的 X／通知／信件／品牌選單按鈕的
          點擊全部攔截掉（視覺上看起來像按鈕有按壓效果，是因為 CSS active
          pseudo-class 本身不需要事件真的送達；但 click 永遠不會觸發到那個
          按鈕，因為在同一個螢幕座標上，z-index 更高的這層才是實際命中目標）。
          改用 `top` 之後這層的框本身就從 header 下緣開始，畫面呈現完全相同，
          但不會再遮住 header。內層才是實際可捲動的選單內容，捲動只發生在
          這裡，不會傳遞到背景頁面。 */}
      {menuVisible && createPortal(
        <div
          className="lg:hidden fixed inset-x-0 bottom-0 z-[60]"
          style={{ top: "calc(4rem + env(safe-area-inset-top, 0px))" }}
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
              // 有 href 但沒有真正下拉子項（例如找工廠 href="/search"、
              // dropdownItems=[]）：直接用 <Link> 導頁，不渲染手風琴／
              // chevron——手機版原本的 accordion 觸發鈕不看 hub.href、一律
              // 只切換展開狀態，若 dropdownItems 是空陣列會展開出一個空白
              // 面板、使用者永遠點不到目的地，所以這種「純直接連結」入口要
              // 走獨立分支，不能沿用共用的 accordion 觸發鈕。
              const hasDropdown = hubHasDropdown(hub);
              if (!hasDropdown && hub.href) {
                return (
                  <Link
                    key={hub.key}
                    href={hub.href}
                    onClick={() => { setBrandMenuOpen(false); setMobileOpen(false); }}
                  >
                    <div className={`w-full h-12 flex items-center gap-3 px-4 rounded-xl border bg-gradient-to-br ${hub.mCard} transition-colors active:opacity-80 cursor-pointer`}>
                      <hub.Icon className={`w-5 h-5 shrink-0 ${hub.iconCls}`} />
                      <span className={`text-sm font-semibold truncate ${hub.mText}`}>{hub.short}</span>
                    </div>
                  </Link>
                );
              }
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
                      className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""} ${hub.soon ? "opacity-60" : hub.mText}`}
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
                        {hub.dropdownItems.map((item) =>
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

              {showAnyConsultantCenter && (
                <Link href={consultantCenterHref} onClick={() => setMobileOpen(false)}>
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
