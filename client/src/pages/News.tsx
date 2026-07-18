import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toMarkdownPreviewText } from "@/components/MarkdownContent";
import { INDUSTRIES } from "@shared/constants";
import {
  Newspaper, Star, Trophy, Building2, Factory, FileText,
  Shirt, Hammer, Cpu, Boxes, Layers, Trees, Package, Utensils, FlaskConical, ShoppingBasket, Printer, Cog,
} from "lucide-react";

const BASE = "https://www.oxmmatch.com";
const pageTitle = "找消息｜OXM 傳產知識與情報中心";
const pageDesc = "整合產業動態、競賽資訊、展覽活動與重要消息，讓台灣傳產更快掌握市場機會。";

type CategoryValue = "all" | "important" | "competition" | "exhibition" | `industry:${string}`;

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
  if (category === "important" || category === "competition" || category === "exhibition") return category;
  return "all";
}

type ApiCategory = "all" | "important" | "competition" | "exhibition" | "industry";

function categoryToQueryParams(cat: CategoryValue): { category: ApiCategory; industryName?: string } {
  if (cat.startsWith("industry:")) return { category: "industry", industryName: cat.slice("industry:".length) };
  return { category: cat as Exclude<CategoryValue, `industry:${string}`> };
}

// NEW 徽章一律看 firstPublishedAt（第一次正式發布的時間，永久不變），不能用
// publishedAt（每次下架重發都會更新）或 updatedAt（編輯標題/摘要/內文就會變）
// ——否則舊消息下架後重新發布、或單純編輯錯字，都會被誤判成「三天內新消息」。
function isNew(firstPublishedAt: string | Date | null): boolean {
  if (!firstPublishedAt) return false;
  const ms = new Date(firstPublishedAt).getTime();
  return Date.now() - ms < 72 * 60 * 60 * 1000;
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function categoryLabel(cat: CategoryValue): string {
  if (cat === "all") return "全部最新";
  if (cat === "important") return "重要消息";
  if (cat === "competition") return "競賽消息";
  if (cat === "exhibition") return "展覽消息";
  return cat.slice("industry:".length);
}

// 分類標題區的大標題／說明文字，依目前選擇動態產生。
function getCategoryMeta(cat: CategoryValue): { title: string; description: string } {
  if (cat === "all") return { title: "全部最新消息", description: "掌握 OXM 最新整理的產業動態與重要資訊" };
  if (cat === "important") return { title: "重要消息", description: "OXM 為傳產會員整理的重要政策與產業資訊" };
  if (cat === "competition") return { title: "競賽消息", description: "掌握適合企業與產業參與的創新競賽資訊" };
  if (cat === "exhibition") return { title: "展覽消息", description: "掌握國內外產業展覽、活動與參展機會" };
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
}

// 消息列——主列表與「最近更新」共用同一種呈現：只有大標題、摘要、日期與
// NEW，不顯示分類/產業標籤、不顯示「查看完整內容」，整列是真正的 Link。
// 卡片用接近白色的半透明底（bg-white/85）跟有色背景拉開層次，不是純白厚重
// 方塊；hover 邊框/陰影轉為橘紫色調並微幅上移，不做大幅動畫。
function NewsListItem({ item }: { item: NewsListItemData }) {
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
                {isNew(item.firstPublishedAt) && (
                  <span className="shrink-0 text-[10px] font-bold text-white bg-gradient-to-r from-orange-500 to-red-500 rounded px-1.5 py-0.5">NEW</span>
                )}
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
  const [category, setCategory] = useState<CategoryValue>(() => parseCategoryFromSearch());
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<NewsListItemData[]>([]);

  const queryParams = useMemo(() => ({ ...categoryToQueryParams(category), offset, limit: 20 }), [category, offset]);
  const { data, isLoading, isFetching, error } = trpc.news.list.useQuery(queryParams);

  // 換分類時重置捲動列表與 offset，避免舊分類的資料殘留混進新分類。
  function selectCategory(next: CategoryValue) {
    setCategory(next);
    setOffset(0);
    setItems([]);
    const q = categoryToQueryParams(next);
    const params = new URLSearchParams();
    params.set("category", q.category);
    if (q.industryName) params.set("industry", q.industryName);
    navigate(`/news?${params.toString()}`, { replace: true });
  }

  useEffect(() => {
    if (!data) return;
    setItems(prev => (offset === 0 ? data.items : [...prev, ...data.items]));
  }, [data, offset]);

  const total = data?.total ?? 0;
  const hasMore = items.length < total;
  const isEmpty = !isLoading && !error && items.length === 0;

  // 空分類下方的「最近更新」：只在目前分類不是「全部最新」、且目前分類確定
  // 為空（已載入完成、不是還在轉圈）時才發查詢；用 limit=3 直接向後端要
  // 最新 3 則，不是抓大量資料再由前端截斷。
  const shouldFetchRecent = category !== "all" && isEmpty;
  const { data: recentData } = trpc.news.list.useQuery(
    { category: "all", offset: 0, limit: 3 },
    { enabled: shouldFetchRecent },
  );
  const showRecent = shouldFetchRecent && (recentData?.items.length ?? 0) > 0;

  const categoryMeta = getCategoryMeta(category);
  const industrySectionActive = category.startsWith("industry:");

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
          {/* 手機版：分類選單移到列表上方 */}
          <div className="lg:hidden mb-4">
            <Select
              value={category}
              onValueChange={(v) => selectCategory(v as CategoryValue)}
            >
              <SelectTrigger className="w-full border-purple-200/60 bg-white/70">
                <SelectValue>{categoryLabel(category)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FIXED_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
                {INDUSTRIES.map(ind => (
                  <SelectItem key={ind.name} value={`industry:${ind.name}`}>產業消息：{ind.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                      {c.label}
                    </button>
                  );
                })}

                {/* 「產業消息」是分類區段標題，不是可展開/收合的按鈕——下方產業清單
                    永遠展開顯示，不需要互動就能看到全部產業。選中任一產業時文字／
                    icon 同步變成深紫，回到其他分類時只是恢復一般文字色，清單本身
                    不會收起。 */}
                <div
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium ${
                    industrySectionActive ? "text-purple-700" : "text-foreground/75"
                  }`}
                >
                  <Factory className={`w-4 h-4 shrink-0 ${industrySectionActive ? "" : "text-violet-400/70"}`} />
                  產業消息
                </div>
                <div className="relative pl-4 space-y-1 ml-4">
                  {/* 產業清單左側垂直線：橘→紫細漸層，從第一個產業連續延伸到最後一個，
                      獨立於各按鈕背景之外，選中底色不會覆蓋或切斷它。 */}
                  <span
                    className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full opacity-60"
                    style={{ background: "linear-gradient(to bottom, #fb923c, #a855f7)" }}
                    aria-hidden="true"
                  />
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
                        {ind.name}
                      </button>
                    );
                  })}
                </div>
              </nav>
            </aside>

            {/* 右側：分類標題區＋目前分類的消息列表 */}
            <div className="flex-1 min-w-0">
              <div className="mb-5 pb-4 border-b border-purple-100/60 flex items-end justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 w-1 h-6 sm:h-7 rounded-full bg-gradient-to-b from-orange-400 to-purple-500 shrink-0" aria-hidden="true" />
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold">{categoryMeta.title}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{categoryMeta.description}</p>
                  </div>
                </div>
                {data && (
                  <span className="shrink-0 text-xs font-medium text-purple-700 bg-gradient-to-r from-orange-50 to-purple-50 border border-purple-100/70 rounded-full px-3 py-1">
                    共 {total} 則消息
                  </span>
                )}
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
                <>
                  <Card className="border-purple-100/60 bg-gradient-to-br from-orange-50/60 via-white to-purple-50/60">
                    <CardContent className="flex flex-col items-center justify-center text-center py-8 min-h-[160px] sm:min-h-[180px]">
                      <FileText className="w-8 h-8 mb-2.5 text-purple-300" />
                      <p className="font-semibold text-foreground">{getEmptyTitle(category)}</p>
                      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                        OXM 將持續整理最新產業動態，有新消息時也會通知相關產業會員。
                      </p>
                    </CardContent>
                  </Card>

                  {showRecent && (
                    <div className="mt-8">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-br from-orange-400 to-purple-500" aria-hidden="true" />
                        <h3 className="text-base font-semibold">最近更新</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5 mb-3">以下是 OXM 近期整理的其他消息</p>
                      <div className="space-y-3">
                        {recentData!.items.map(item => (
                          <NewsListItem key={item.id} item={item} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="space-y-3">
                    {items.map(item => (
                      <NewsListItem key={item.id} item={item} />
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
    </div>
  );
}
