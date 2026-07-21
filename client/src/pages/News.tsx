import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { toMarkdownPreviewText } from "@/components/MarkdownContent";
import { NewsNewBadge } from "@/components/NewsNewBadge";
import { INDUSTRIES } from "@shared/constants";
import { NEWS_NEW_WINDOW_MS } from "@shared/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { getGuestReadIds, isGuestNewsRead } from "@/lib/newsReadTracking";
import LoginDialog from "@/components/LoginDialog";
import { toast } from "sonner";
import {
  Newspaper, Star, Trophy, Building2, Globe, Factory, FileText, BellPlus, BellRing, Loader2, Check, ChevronDown,
  Shirt, Hammer, Cpu, Boxes, Layers, Trees, Package, Utensils, FlaskConical, ShoppingBasket, Printer, Cog,
} from "lucide-react";

const BASE = "https://www.oxmmatch.com";
const pageTitle = "找消息｜OXM 傳產知識與情報中心";
const pageDesc = "整合產業動態、競賽資訊、展覽活動與重要消息，讓台灣傳產更快掌握市場機會。";

// 「跨產業資訊」是獨立固定看板（boardKey="cross-industry"，跟 important／
// competition／exhibition 同一層級），不是 `industry:${string}` 這個由
// shared/constants.ts INDUSTRIES 動態產生的真實產業命名空間——它刻意不放進
// INDUSTRIES，不能成為工廠註冊時可選的產業，見 drizzle/schema.ts 的
// news.isCrossIndustry 欄位註解。
type CategoryValue = "all" | "important" | "competition" | "exhibition" | "cross-industry" | `industry:${string}`;

const FIXED_CATEGORIES: { value: "all" | "important" | "competition" | "exhibition"; label: string; Icon: typeof Newspaper }[] = [
  { value: "all", label: "全部最新", Icon: Newspaper },
  { value: "important", label: "重要消息", Icon: Star },
  { value: "competition", label: "競賽消息", Icon: Trophy },
  { value: "exhibition", label: "展覽消息", Icon: Building2 },
];

// 純視覺用的產業 icon 對照表——key 是 shared/constants.ts INDUSTRIES 目前的
// 真實名稱字串，不是另一份產業資料來源。清單本身仍完全由 INDUSTRIES 動態
// 產生（見下方 <aside> 內的 INDUSTRIES.map），這裡只負責「這個名稱配哪個
// icon」；名稱不在表裡時一律 fallback 成 Factory，之後 constants.ts 新增
// 產業不會因為忘記加 icon 而報錯或整頁壞掉。
const INDUSTRY_ICON_MAP: Record<string, typeof Factory> = {
  "紡織": Shirt,
  "金屬加工": Hammer,
  "電子零件": Cpu,
  "塑膠": Boxes,
  "橡膠 / 矽膠": Layers,
  "木工": Trees,
  "包裝": Package,
  "食品": Utensils,
  "化工製造": FlaskConical,
  "生活用品": ShoppingBasket,
  "印刷": Printer,
  "工業設備／機械": Cog,
};

function getIndustryIcon(name: string): typeof Factory {
  return INDUSTRY_ICON_MAP[name] ?? Factory;
}

// 手機版「產業」分頁記住的選擇，除了 12 個真實產業名稱，也可能是特殊值
// "cross-industry"（跨產業資訊）。這三個 helper 把「選擇值 → 顯示文字／icon／
// 對應的 CategoryValue」的轉換邏輯集中在一處，避免桌面／手機兩處各自寫一份
// 容易不同步的 if-else。
function industrySelectionLabel(selection: string): string {
  return selection === "cross-industry" ? "跨產業資訊" : selection;
}
function industrySelectionIcon(selection: string): typeof Factory {
  return selection === "cross-industry" ? Globe : getIndustryIcon(selection);
}
function industrySelectionToCategory(selection: string): CategoryValue {
  return selection === "cross-industry" ? "cross-industry" : `industry:${selection}`;
}

// 左側分類項目共用的樣式：選中＝橘→紫淡漸層底＋深紫文字；未選中＝中性深灰
// 文字＋低飽和紫灰 icon，hover 才稍微加深，不讓整片側欄一次全部變紫。
function sidebarItemClass(active: boolean): string {
  return `group relative w-full flex items-center gap-2.5 rounded-lg text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
    active
      ? "bg-gradient-to-r from-orange-50 to-purple-50 text-purple-700"
      : "text-foreground/75 hover:bg-orange-50/60 hover:text-foreground"
  }`;
}
function sidebarIconClass(active: boolean): string {
  return active ? "w-4 h-4 shrink-0" : "w-4 h-4 shrink-0 text-violet-400/70 group-hover:text-violet-600";
}

function parseCategoryFromSearch(): CategoryValue {
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category");
  const industry = params.get("industry");
  if (category === "industry" && industry) return `industry:${industry}`;
  if (category === "cross-industry") return "cross-industry";
  if (category === "important" || category === "competition" || category === "exhibition") return category;
  return "all";
}

type ApiCategory = "all" | "important" | "competition" | "exhibition" | "cross-industry" | "industry";

function categoryToQueryParams(cat: CategoryValue): { category: ApiCategory; industryName?: string } {
  if (cat.startsWith("industry:")) return { category: "industry", industryName: cat.slice("industry:".length) };
  return { category: cat as Exclude<CategoryValue, `industry:${string}`> };
}

// NEW 徽章的時間條件一律看 firstPublishedAt（第一次正式發布的時間，永久不變），
// 不能用 publishedAt（每次下架重發都會更新）或 updatedAt（編輯標題/摘要/內文
// 就會變）——否則舊消息下架後重新發布、或單純編輯錯字，都會被誤判成新消息。
// 有效期限固定讀 shared/const.ts 的 NEWS_NEW_WINDOW_MS，不得在這裡另外寫死
// 小時數字，否則前後端很容易改一邊漏一邊、造成期限不一致。
function isNew(firstPublishedAt: string | Date | null): boolean {
  if (!firstPublishedAt) return false;
  const ms = new Date(firstPublishedAt).getTime();
  return Date.now() - ms < NEWS_NEW_WINDOW_MS;
}

// NEW 顯示＝時間未過期 AND 尚未讀過，兩者是 AND；只要任一條件不成立（已讀
// 或已過期）NEW 就消失，是 OR 消失邏輯。登入會員的已讀狀態來自後端
// news.list 回傳的 item.isRead（查 newsReads 表）；訪客沒有 session，改查
// 瀏覽器 localStorage（見 @/lib/newsReadTracking）。
function isUnreadNew(item: { firstPublishedAt: string | Date | null; id: number; isRead: boolean }, isAuthenticated: boolean): boolean {
  if (!isNew(item.firstPublishedAt)) return false;
  if (isAuthenticated) return !item.isRead;
  return !isGuestNewsRead(item.id);
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

interface NewCategorySummaryData {
  all: boolean;
  important: boolean;
  competition: boolean;
  exhibition: boolean;
  crossIndustry: boolean;
  industry: boolean;
  industries: Record<string, boolean>;
}

// 分類側欄／手機 Select 的 NEW 判斷：一律看後端一次回傳的 getNewCategorySummary
// 彙總結果（同樣以 firstPublishedAt + NEWS_NEW_WINDOW_MS 為準，且已經排除該
// 使用者讀過的消息），不是看目前分類已載入的第一頁資料——切到別的分類時，
// 其他分類的 NEW 狀態也要能正確顯示。
function categoryHasNew(cat: CategoryValue, summary: NewCategorySummaryData | undefined): boolean {
  if (!summary) return false;
  if (cat === "all") return summary.all;
  if (cat === "important") return summary.important;
  if (cat === "competition") return summary.competition;
  if (cat === "exhibition") return summary.exhibition;
  if (cat === "cross-industry") return summary.crossIndustry;
  return summary.industries[cat.slice("industry:".length)] ?? false;
}

// 手機版五個分頁：不是 CategoryValue 本身——「產業」是一個聚合分頁，實際
// 選中的產業由 lastIndustryName（見 News() 內）另外記住，這裡只負責分頁
// 本身的 label／icon／NEW 判斷。
type MobileTabValue = "all" | "important" | "competition" | "exhibition" | "industry";
const MOBILE_TABS: { value: MobileTabValue; label: string; Icon: typeof Newspaper }[] = [
  { value: "all", label: "全部", Icon: Newspaper },
  { value: "important", label: "重要", Icon: Star },
  { value: "competition", label: "競賽", Icon: Trophy },
  { value: "exhibition", label: "展覽", Icon: Building2 },
  { value: "industry", label: "產業", Icon: Factory },
];

// 看板訂閱按鈕：boardKey 直接沿用目前選中的 category 字串（"all" / "important" /
// "competition" / "exhibition" / `industry:${name}`），跟後端 boardKey 格式
// 完全一致，不需要另外轉換。有效訂閱狀態一律由後端 news.getBoardSubscriptionState
// 計算（明確覆寫優先於動態預設），前端不自行猜測預設值。未登入訪客永遠顯示
// 「訂閱」（isSubscribed 一律 false），點擊只開現有 LoginDialog，不寫入任何
// localStorage 假裝已訂閱。
function SubscribeButton({ boardKey, isAuthenticated, onRequireLogin }: {
  boardKey: CategoryValue;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}) {
  const utils = trpc.useUtils();
  const { data } = trpc.news.getBoardSubscriptionState.useQuery({ boardKey });
  const mutation = trpc.news.setBoardSubscription.useMutation({
    onSuccess: () => {
      utils.news.getBoardSubscriptionState.invalidate({ boardKey });
    },
    onError: (e) => {
      // mutation 失敗：不做樂觀更新，畫面本來就還是 invalidate 前的狀態，這裡
      // 重新查一次只是保險（例如伺服器端狀態其實有變但這次請求失敗的情境）。
      utils.news.getBoardSubscriptionState.invalidate({ boardKey });
      toast.error(e.message || "訂閱設定失敗，請稍後再試");
    },
  });

  const isSubscribed = data?.isSubscribed ?? false;
  const pending = mutation.isPending;

  const handleClick = () => {
    if (pending) return; // 防連點：mutation 進行中直接忽略，不送出第二次請求
    if (!isAuthenticated) { onRequireLogin(); return; }
    mutation.mutate({ boardKey, isSubscribed: !isSubscribed });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={isSubscribed ? "default" : "outline"}
      aria-pressed={isSubscribed}
      disabled={pending}
      onClick={handleClick}
      className={
        isSubscribed
          ? "gap-1.5 border-0 bg-gradient-to-r from-orange-500/90 to-purple-500/90 text-white shadow-sm hover:from-orange-500 hover:to-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-70"
          : "gap-1.5 border-purple-200 text-foreground/80 bg-white/70 hover:bg-orange-50/60 hover:border-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-70"
      }
    >
      {pending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
      ) : isSubscribed ? (
        <BellRing className="w-3.5 h-3.5" aria-hidden="true" />
      ) : (
        <BellPlus className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      {isSubscribed ? "已訂閱" : "訂閱"}
    </Button>
  );
}

// "cross-industry" 本身不是 `industry:${string}` 格式（沒有 "industry:" 前綴），
// 所以必須在「未命中固定分類」的 fallback（cat.slice("industry:".length)）
// 之前明確攔截，否則會被錯誤地當成 industry: 前綴字串去 slice，得到殘缺字串。
function categoryLabel(cat: CategoryValue): string {
  if (cat === "all") return "全部最新";
  if (cat === "important") return "重要消息";
  if (cat === "competition") return "競賽消息";
  if (cat === "exhibition") return "展覽消息";
  if (cat === "cross-industry") return "跨產業資訊";
  return cat.slice("industry:".length);
}

// 分類標題區的大標題／說明文字，依目前選擇動態產生。
function getCategoryMeta(cat: CategoryValue): { title: string; description: string } {
  if (cat === "all") return { title: "全部最新消息", description: "掌握 OXM 最新整理的產業動態與重要資訊" };
  if (cat === "important") return { title: "重要消息", description: "OXM 為傳產會員整理的重要政策與產業資訊" };
  if (cat === "competition") return { title: "競賽消息", description: "掌握適合企業與產業參與的創新競賽資訊" };
  if (cat === "exhibition") return { title: "展覽消息", description: "掌握國內外產業展覽、活動與參展機會" };
  if (cat === "cross-industry") return { title: "跨產業資訊", description: "適用所有產業的通用消息，例如政府補助方案與跨產業課程" };
  const name = cat.slice("industry:".length);
  return { title: `${name}消息`, description: `掌握${name}產業的市場動態、競賽及展覽資訊` };
}

// 空狀態標題：分類標籤本身若已經以「消息」結尾（重要消息／競賽消息／展覽消息），
// 直接接在「目前還沒有」後面即可；產業名稱沒有這個字尾，才補上「相關消息」，
// 避免「目前還沒有重要消息相關消息」這種語意重複。「全部最新」另外特殊處理
// 成「目前還沒有最新消息」，理由相同。
function getEmptyTitle(cat: CategoryValue): string {
  if (cat === "all") return "目前還沒有最新消息";
  const label = categoryLabel(cat);
  return label.endsWith("消息") ? `目前還沒有${label}` : `目前還沒有${label}相關消息`;
}

interface NewsListItemData {
  id: number;
  slug: string;
  title: string;
  summary: string;
  publishedAt: string | Date | null;
  firstPublishedAt: string | Date | null;
  /** 登入會員才由後端計算（查 newsReads 表）；訪客一律是 false，實際已讀狀態由呼叫端另外查 localStorage。 */
  isRead: boolean;
}

// 消息列：只有大標題、摘要、日期與 NEW，不顯示分類/產業標籤、不顯示
// 「查看完整內容」，整列是真正的 Link。
// 卡片用接近白色的半透明底（bg-white/85）跟有色背景拉開層次，不是純白厚重
// 方塊；hover 邊框/陰影轉為橘紫色調並微幅上移，不做大幅動畫。
function NewsListItem({ item, isAuthenticated }: { item: NewsListItemData; isAuthenticated: boolean }) {
  return (
    <Link
      href={`/news/${item.slug}`}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
    >
      <Card className="bg-white/85 border-purple-100/60 transition-all duration-150 hover:shadow-md hover:shadow-purple-200/40 hover:border-orange-200 hover:-translate-y-0.5 cursor-pointer">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <h3 className="text-base sm:text-lg font-bold truncate sm:whitespace-normal sm:line-clamp-1">{item.title}</h3>
                {isUnreadNew(item, isAuthenticated) && <NewsNewBadge />}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 sm:line-clamp-3">
                {toMarkdownPreviewText(item.summary, 140)}
              </p>
            </div>
            <span className="hidden sm:block shrink-0 text-xs text-muted-foreground whitespace-nowrap pt-1">
              {item.publishedAt ? formatDate(item.publishedAt) : ""}
            </span>
          </div>
          <p className="sm:hidden text-xs text-muted-foreground mt-2 text-right">
            {item.publishedAt ? formatDate(item.publishedAt) : ""}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

// Hero 右側低調抽象視覺：純線稿（文件／工廠輪廓／趨勢折線／通知圓點／資料
// 節點），橘→靛→紫的淡漸層（與 Hero 背景、icon 方塊同一組 OXM 品牌色），
// 整體不透明度控制在 10~24% 之間，刻意不做成寫實插畫，只是安靜的背景
// 裝飾——aria-hidden，不承載任何資訊，視覺強度仍明顯低於標題文字。
function NewsHeroArt() {
  return (
    <div className="hidden lg:flex relative w-[34%] shrink-0 items-center justify-center" aria-hidden="true">
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full blur-3xl opacity-[0.12]"
        style={{ background: "radial-gradient(closest-side, #fb923c, #a855f7, transparent)" }}
      />
      {/* 固定較小的實際尺寸（非撐滿 34% 版位），維持低調、不搶過標題文字的高度 */}
      <svg viewBox="0 0 300 160" className="relative w-auto h-20 xl:h-24" fill="none">
        <defs>
          <linearGradient id="newsHeroGrad" x1="0" y1="0" x2="300" y2="160" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f97316" />
            <stop offset="0.5" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>

        {/* 文件／新聞頁面線稿 */}
        <g opacity="0.16" stroke="url(#newsHeroGrad)" strokeWidth="2" strokeLinecap="round">
          <rect x="24" y="20" width="86" height="112" rx="8" />
          <line x1="40" y1="46" x2="94" y2="46" />
          <line x1="40" y1="62" x2="94" y2="62" />
          <line x1="40" y1="78" x2="78" y2="78" />
          <line x1="40" y1="100" x2="94" y2="100" />
          <line x1="40" y1="116" x2="70" y2="116" />
        </g>

        {/* 通知圓點 */}
        <circle cx="100" cy="28" r="6" fill="url(#newsHeroGrad)" opacity="0.18" />

        {/* 工廠輪廓 */}
        <g opacity="0.14" stroke="url(#newsHeroGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M150 132 V96 l20 14 V96 l20 14 V96 l24 18 V132 Z" />
          <line x1="176" y1="96" x2="176" y2="80" />
          <circle cx="176" cy="76" r="3.5" />
        </g>

        {/* 趨勢折線 */}
        <polyline
          points="140,120 168,104 190,112 214,84 236,92 262,58"
          opacity="0.20"
          stroke="url(#newsHeroGrad)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="262" cy="58" r="4" fill="url(#newsHeroGrad)" opacity="0.24" />

        {/* 資料節點／放大鏡：情報搜集意象 */}
        <g opacity="0.15" stroke="url(#newsHeroGrad)" strokeWidth="2" strokeLinecap="round">
          <circle cx="238" cy="128" r="16" />
          <line x1="249" y1="139" x2="262" y2="152" />
        </g>
        <g opacity="0.12" fill="url(#newsHeroGrad)">
          <circle cx="120" cy="140" r="3" />
          <circle cx="222" cy="30" r="3" />
          <circle cx="270" cy="110" r="2.5" />
        </g>
      </svg>
    </div>
  );
}

export default function News() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const [category, setCategory] = useState<CategoryValue>(() => parseCategoryFromSearch());
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<NewsListItemData[]>([]);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  // 手機版「產業」分頁記住的選擇：可能是某個真實產業名稱，也可能是特殊值
  // "cross-industry"（跨產業資訊）。URL 一開始就是某個產業或跨產業資訊就直接
  // 沿用；否則 fallback 成 INDUSTRIES 第一個，確保這個值永遠合法，絕對不會是
  // undefined／空字串，之後切到「產業」分頁組出來的 query 一定完整
  // （?category=industry&industry=<name> 或 ?category=cross-industry），
  // 不會出現 industry=undefined。
  const [lastIndustrySelection, setLastIndustrySelection] = useState<string>(() => {
    const initial = parseCategoryFromSearch();
    if (initial === "cross-industry") return "cross-industry";
    return initial.startsWith("industry:") ? initial.slice("industry:".length) : INDUSTRIES[0].name;
  });
  const [industryPickerOpen, setIndustryPickerOpen] = useState(false);

  const queryParams = useMemo(() => ({ ...categoryToQueryParams(category), offset, limit: 20 }), [category, offset]);
  const { data, isLoading, isFetching, error } = trpc.news.list.useQuery(queryParams);

  // 所有分類的 NEW 徽章：單一彙總查詢，不是 15 個分類各自查一次；5 分鐘內
  // 視為新鮮不重打，也不加輪詢——最新狀態在使用者重新整理頁面時就會拿到。
  // 已讀排除：登入會員由後端查 newsReads 表（不需要前端傳任何東西）；訪客
  // 沒有 session，只能把 localStorage 裡的已讀清單當 excludeIds 傳給後端。
  const { data: newSummary } = trpc.news.getNewCategorySummary.useQuery(
    { excludeIds: isAuthenticated ? undefined : getGuestReadIds() },
    { staleTime: 5 * 60 * 1000 },
  );

  // 換分類時重置捲動列表與 offset，避免舊分類的資料殘留混進新分類。
  function selectCategory(next: CategoryValue) {
    setCategory(next);
    if (next === "cross-industry") setLastIndustrySelection("cross-industry");
    else if (next.startsWith("industry:")) setLastIndustrySelection(next.slice("industry:".length));
    setOffset(0);
    setItems([]);
    const q = categoryToQueryParams(next);
    const params = new URLSearchParams();
    params.set("category", q.category);
    if (q.industryName) params.set("industry", q.industryName);
    navigate(`/news?${params.toString()}`, { replace: true });
  }

  // 手機版五分頁點擊：「產業」分頁本身不是一個實際看板，點下去要嘛維持
  // 目前已經選中的產業／跨產業資訊（URL 已經是其中之一時不做任何事），要嘛
  // 恢復上次選過的選擇／預設第一個產業——絕對不會產生沒有 industry 的中繼狀態。
  function selectMobileTab(tab: MobileTabValue) {
    if (tab === "industry") {
      if (category.startsWith("industry:") || category === "cross-industry") return;
      selectCategory(industrySelectionToCategory(lastIndustrySelection));
      return;
    }
    selectCategory(tab);
  }

  useEffect(() => {
    if (!data) return;
    setItems(prev => (offset === 0 ? data.items : [...prev, ...data.items]));
  }, [data, offset]);

  const total = data?.total ?? 0;
  const hasMore = items.length < total;
  const isEmpty = !isLoading && !error && items.length === 0;

  const categoryMeta = getCategoryMeta(category);
  const industrySectionActive = category.startsWith("industry:") || category === "cross-industry";
  const mobileActiveTab: MobileTabValue = industrySectionActive ? "industry" : (category as MobileTabValue);
  const currentIndustrySelection = category === "cross-industry"
    ? "cross-industry"
    : category.startsWith("industry:")
      ? category.slice("industry:".length)
      : lastIndustrySelection;

  return (
    <div className="min-h-screen relative overflow-x-hidden bg-gradient-to-b from-orange-50/50 via-background to-purple-50/40 animate-page-enter">
      {/* 背景品牌暈染：兩個透明度很低的 radial gradient 光暈，純裝飾、不承載
          資訊、不擋點擊——讓 Hero 以下到頁尾都不再是大面積純白，同時維持
          安靜、不影響文字對比。overflow-x-hidden 只擋水平溢出，不影響左側
          側欄的 sticky 垂直定位。 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-16 -left-24 w-[380px] h-[380px] rounded-full blur-3xl opacity-[0.10]"
          style={{ background: "radial-gradient(closest-side, #fb923c, transparent)" }}
        />
        <div
          className="absolute top-[520px] -right-28 w-[440px] h-[440px] rounded-full blur-3xl opacity-[0.09]"
          style={{ background: "radial-gradient(closest-side, #a855f7, transparent)" }}
        />
      </div>

      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
        <link rel="canonical" href={`${BASE}/news`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={`${BASE}/news`} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDesc} />
      </Helmet>

      <div className="relative z-10">
        <Navbar />

        {/* Hero：左側文字＋右側低調抽象視覺，刻意壓低高度，避免消息列表被擠到第一屏以下 */}
        <div className="relative bg-gradient-to-br from-orange-50 via-background to-purple-50 overflow-hidden">
          <div className="container py-8 sm:py-10 flex items-center gap-6">
            <div className="flex-1 min-w-0">
              {/* Eyebrow／小標籤：純文字識別，不取代主要標題，橘紫漸層沿用 OXM 品牌色 */}
              <p className="text-xs sm:text-sm font-bold tracking-wide bg-gradient-to-r from-orange-500 to-purple-500 bg-clip-text text-transparent mb-1.5">
                產業情報中心
              </p>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-purple-500 flex items-center justify-center shadow shrink-0">
                  <Newspaper className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold">OXM，給你傳產需要的第一手消息</h1>
              </div>
              <p className="text-sm sm:text-base text-muted-foreground max-w-2xl">{pageDesc}</p>
            </div>
            <NewsHeroArt />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-orange-200/10 via-purple-300/50 to-purple-200/10" aria-hidden="true" />
        </div>

        <div className="container py-6 sm:py-8">
          {/* 手機版分類導覽：兩層架構，取代原本把全部分類＋12 個產業塞進同一個
              大型下拉選單的做法（下拉過長、NEW 只能用純文字接在 label 後面）。
              第一層是固定 5 個分頁（全部/重要/競賽/展覽/產業），grid-cols-5
              平分寬度，390px／430px 都不會有水平捲軸。「產業」分頁點下去才
              在下方展開產業選擇器（第二層），不是分頁本身就要塞 12 個產業。 */}
          <div className="lg:hidden mb-4">
            <div role="tablist" aria-label="找消息分類" className="grid grid-cols-5 gap-1 rounded-xl border border-purple-100/60 bg-white/70 p-1">
              {MOBILE_TABS.map(tab => {
                const active = mobileActiveTab === tab.value;
                const hasNew = tab.value === "industry" ? !!newSummary?.industry : categoryHasNew(tab.value, newSummary);
                const Icon = tab.Icon;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => selectMobileTab(tab.value)}
                    className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 px-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                      active ? "bg-gradient-to-r from-orange-50 to-purple-50 text-purple-700" : "text-foreground/70 hover:bg-orange-50/50"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${active ? "" : "text-violet-400/70"}`} />
                    <span className="flex items-center gap-1 leading-none">
                      {tab.label}
                      {hasNew && <NewsNewBadge size="compact" />}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 第二層：只有「產業」分頁選中時才顯示，只列 12 個產業，不含
                全部最新／重要消息／競賽消息／展覽消息。用 Popover 而不是原生
                <select>，才能在選項裡穩定放 icon／NEW／已選中的 check icon，
                並且天生就有點外關閉、Escape 關閉、正確 z-index（不會蓋住整個
                APP）。max-h-[50vh] + overflow-y-auto：選單本身內容過長只在
                選單內垂直捲動，不會延伸到頁面底部遮住底部導覽。 */}
            {mobileActiveTab === "industry" && (
              <div className="mt-2">
                <Popover open={industryPickerOpen} onOpenChange={setIndustryPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 rounded-lg border border-purple-200/60 bg-white/70 px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                    >
                      {(() => {
                        const CurrentIcon = industrySelectionIcon(currentIndustrySelection);
                        return <CurrentIcon className="w-4 h-4 text-violet-500 shrink-0" aria-hidden="true" />;
                      })()}
                      <span className="flex-1 min-w-0 truncate text-left font-medium">{industrySelectionLabel(currentIndustrySelection)}</span>
                      {categoryHasNew(category, newSummary) && <NewsNewBadge size="compact" />}
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[calc(100vw-2.5rem)] max-w-[380px] p-1 max-h-[50vh] overflow-y-auto">
                    {/* 跨產業資訊固定排在第一個選項，不是 INDUSTRIES.map 的一部分
                        ——它不是真實產業，見 industrySelectionToCategory 的說明。 */}
                    <button
                      type="button"
                      onClick={() => { selectCategory("cross-industry"); setIndustryPickerOpen(false); }}
                      className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                        category === "cross-industry" ? "bg-gradient-to-r from-orange-50 to-purple-50 text-purple-700 font-medium" : "text-foreground/80 hover:bg-orange-50/60"
                      }`}
                    >
                      <Globe className={`w-4 h-4 shrink-0 ${category === "cross-industry" ? "" : "text-violet-400/70"}`} />
                      <span className="flex-1 min-w-0 truncate">跨產業資訊</span>
                      {categoryHasNew("cross-industry", newSummary) && <NewsNewBadge size="compact" />}
                      {category === "cross-industry" && <Check className="w-4 h-4 shrink-0 text-purple-600" aria-hidden="true" />}
                    </button>
                    {INDUSTRIES.map(ind => {
                      const Icon = getIndustryIcon(ind.name);
                      const isSelected = category === `industry:${ind.name}`;
                      return (
                        <button
                          key={ind.name}
                          type="button"
                          onClick={() => { selectCategory(`industry:${ind.name}`); setIndustryPickerOpen(false); }}
                          className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                            isSelected ? "bg-gradient-to-r from-orange-50 to-purple-50 text-purple-700 font-medium" : "text-foreground/80 hover:bg-orange-50/60"
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${isSelected ? "" : "text-violet-400/70"}`} />
                          <span className="flex-1 min-w-0 truncate">{ind.name}</span>
                          {categoryHasNew(`industry:${ind.name}`, newSummary) && <NewsNewBadge size="compact" />}
                          {isSelected && <Check className="w-4 h-4 shrink-0 text-purple-600" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>

          <div className="flex gap-8">
            {/* 桌面版：左側分類側欄，半透明暖白面板，sticky 但保留 Navbar 高度不被蓋住 */}
            <aside className="hidden lg:block w-[260px] shrink-0">
              <nav className="sticky top-20 rounded-[20px] border border-orange-100/60 bg-white/70 backdrop-blur-sm shadow-sm p-3 space-y-1.5">
                {FIXED_CATEGORIES.map(c => {
                  const active = category === c.value;
                  const Icon = c.Icon;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => selectCategory(c.value)}
                      className={`${sidebarItemClass(active)} px-3 py-2.5 font-medium`}
                    >
                      {active && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-gradient-to-b from-orange-400 to-purple-500" aria-hidden="true" />
                      )}
                      <Icon className={sidebarIconClass(active)} />
                      <span className="flex-1 min-w-0 truncate text-left">{c.label}</span>
                      {categoryHasNew(c.value, newSummary) && <NewsNewBadge />}
                    </button>
                  );
                })}

                {/* 「產業消息」是分類區段標題，不是可展開/收合的按鈕——下方產業清單
                    永遠展開顯示，不需要互動就能看到全部產業。選中任一產業時文字／
                    icon 同步變成深紫，回到其他分類時只是恢復一般文字色，清單本身
                    不會收起。父層的 NEW 只要「任一產業」有新消息就顯示，跟個別
                    產業項目自己的 NEW 是獨立判斷、可以同時出現。 */}
                <div
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium ${
                    industrySectionActive ? "text-purple-700" : "text-foreground/75"
                  }`}
                >
                  <Factory className={`w-4 h-4 shrink-0 ${industrySectionActive ? "" : "text-violet-400/70"}`} />
                  <span className="flex-1 min-w-0 truncate">產業消息</span>
                  {newSummary?.industry && <NewsNewBadge />}
                </div>
                <div className="relative pl-4 space-y-1 ml-4">
                  {/* 產業清單左側垂直線：橘→紫細漸層，從第一個產業連續延伸到最後一個，
                      獨立於各按鈕背景之外，選中底色不會覆蓋或切斷它。跨產業資訊固定
                      排在紡織上方、共用同一條垂直線與按鈕樣式，不是另外獨立的區塊
                      ——它不是真實產業，見 industrySelectionToCategory 的說明。 */}
                  <span
                    className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full opacity-60"
                    style={{ background: "linear-gradient(to bottom, #fb923c, #a855f7)" }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => selectCategory("cross-industry")}
                    className={`${sidebarItemClass(category === "cross-industry")} px-3 py-2 ${category === "cross-industry" ? "font-medium" : ""}`}
                  >
                    <Globe className={sidebarIconClass(category === "cross-industry")} />
                    <span className="flex-1 min-w-0 truncate text-left">跨產業資訊</span>
                    {categoryHasNew("cross-industry", newSummary) && <NewsNewBadge />}
                  </button>
                  {INDUSTRIES.map(ind => {
                    const active = category === `industry:${ind.name}`;
                    const Icon = getIndustryIcon(ind.name);
                    return (
                      <button
                        key={ind.name}
                        type="button"
                        onClick={() => selectCategory(`industry:${ind.name}`)}
                        className={`${sidebarItemClass(active)} px-3 py-2 ${active ? "font-medium" : ""}`}
                      >
                        <Icon className={sidebarIconClass(active)} />
                        <span className="flex-1 min-w-0 truncate text-left">{ind.name}</span>
                        {categoryHasNew(`industry:${ind.name}`, newSummary) && <NewsNewBadge />}
                      </button>
                    );
                  })}
                </div>
              </nav>
            </aside>

            {/* 右側：分類標題區＋目前分類的消息列表 */}
            <div className="flex-1 min-w-0">
              {/* 訂閱按鈕＋消息數量：桌面版跟標題同一列靠右（按鈕在數量左側）；
                  手機版另起一行放在標題／說明下方，避免跟標題擠在同一行造成
                  換行或水平溢出。row 本身不加 overflow，兩個子元素都是
                  shrink-0 的固定寬度小元件，不會撐出水平捲軸。 */}
              <div className="mb-5 pb-4 border-b border-purple-100/60">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5 w-1 h-6 sm:h-7 rounded-full bg-gradient-to-b from-orange-400 to-purple-500 shrink-0" aria-hidden="true" />
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold">{categoryMeta.title}</h2>
                      <p className="text-sm text-muted-foreground mt-1">{categoryMeta.description}</p>
                    </div>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    <SubscribeButton boardKey={category} isAuthenticated={isAuthenticated} onRequireLogin={() => setLoginDialogOpen(true)} />
                    {data && (
                      <span className="shrink-0 text-xs font-medium text-purple-700 bg-gradient-to-r from-orange-50 to-purple-50 border border-purple-100/70 rounded-full px-3 py-1">
                        共 {total} 則消息
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex sm:hidden items-center gap-2 mt-3">
                  <SubscribeButton boardKey={category} isAuthenticated={isAuthenticated} onRequireLogin={() => setLoginDialogOpen(true)} />
                  {data && (
                    <span className="shrink-0 text-xs font-medium text-purple-700 bg-gradient-to-r from-orange-50 to-purple-50 border border-purple-100/70 rounded-full px-3 py-1">
                      共 {total} 則消息
                    </span>
                  )}
                </div>
              </div>

              {isLoading && offset === 0 ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map(i => (
                    <Card key={i} className="bg-white/70"><CardContent className="p-5 h-20 animate-pulse bg-muted/40" /></Card>
                  ))}
                </div>
              ) : error ? (
                <Card className="bg-white/80">
                  <CardContent className="p-12 text-center text-muted-foreground">
                    <p>消息載入失敗，請稍後再試。</p>
                  </CardContent>
                </Card>
              ) : isEmpty ? (
                <Card className="border-purple-100/60 bg-gradient-to-br from-orange-50/60 via-white to-purple-50/60">
                  <CardContent className="flex flex-col items-center justify-center text-center py-8 min-h-[160px] sm:min-h-[180px]">
                    <FileText className="w-8 h-8 mb-2.5 text-purple-300" />
                    <p className="font-semibold text-foreground">{getEmptyTitle(category)}</p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                      OXM 將持續整理最新產業動態，有新消息時也會通知相關產業會員。
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="space-y-3">
                    {items.map(item => (
                      <NewsListItem key={item.id} item={item} isAuthenticated={isAuthenticated} />
                    ))}
                  </div>

                  {hasMore && (
                    <div className="flex justify-center mt-6">
                      <Button
                        variant="outline"
                        disabled={isFetching}
                        onClick={() => setOffset(items.length)}
                      >
                        {isFetching ? "載入中…" : "載入更多"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <LoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </div>
  );
}
