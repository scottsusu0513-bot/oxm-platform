import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { INDUSTRIES, INDUSTRY_OPTIONS, TAIWAN_REGIONS } from "@shared/constants";
import { buildSearchPageMeta } from "@shared/seo/searchPage";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import { useState, useMemo, useEffect, useRef } from "react";
import { Search as SearchIcon, Star, MapPin, Factory, ChevronLeft, ChevronRight, Megaphone, X, Wrench, ChevronDown, ShoppingCart, Send, Loader2, Share2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { performLogin } from "@/const";
import { toast } from "sonner";
import { shareContent } from "@/lib/share";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { FactoryCard, type CartItem } from "@/components/FactoryResultCard";

// ── 一鍵詢價購物車 hook ───────────────────────────────────────────────────
const CART_KEY = "oxm_inquiry_cart";

function useInquiryCart() {
  const [cart, setCart] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) ?? "[]"); } catch { return []; }
  });

  const save = (items: CartItem[]) => {
    setCart(items);
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  };

  const add = (item: CartItem) => {
    setCart(prev => {
      if (prev.find(i => i.id === item.id)) return prev;
      const next = [...prev, item];
      localStorage.setItem(CART_KEY, JSON.stringify(next));
      return next;
    });
  };

  const remove = (id: number) => {
    setCart(prev => {
      const next = prev.filter(i => i.id !== id);
      localStorage.setItem(CART_KEY, JSON.stringify(next));
      return next;
    });
  };

  const clear = () => save([]);
  const has = (id: number) => cart.some(i => i.id === id);

  return { cart, add, remove, clear, has };
}

function MultiSelect({ options, value, onChange, placeholder, className, withClear }: {
  options: readonly string[];
  value: string[];
  onChange: (val: string[]) => void;
  placeholder: string;
  className?: string;
  withClear?: boolean;
}) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  const label = value.length === 0 ? placeholder : value.join("、");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={`justify-between font-normal truncate ${className ?? ""}`}>
          <span className="truncate text-sm">{label}</span>
          <ChevronDown className="w-3 h-3 shrink-0 opacity-50 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <div className="max-h-60 overflow-y-auto space-y-1">
          {withClear && (
            <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
              <Checkbox checked={value.length === 0} onCheckedChange={() => onChange([])} />
              不限
            </label>
          )}
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
              <Checkbox checked={value.includes(opt)} onCheckedChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BusinessTypeBadge({ businessType }: { businessType?: string }) {
  if (businessType === "studio") {
    return (
      <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-0 text-xs">
        <Wrench className="w-3 h-3 mr-1" />工作室
      </Badge>
    );
  }
  return (
    <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-0 text-xs">
      <Factory className="w-3 h-3 mr-1" />工廠
    </Badge>
  );
}

// ── URL ↔ filter state 轉換 ───────────────────────────────────────────────
function buildParams(vals: {
  mfgMode: string;
  industry: string[];
  subIndustry: string[];
  region: string[];
  keyword: string;
  businessType: string;
  sortBy: string;
  // Optional: omit entirely (e.g. when building a shareable URL) to leave
  // pagination out of the query string altogether.
  page?: number;
}) {
  const p = new URLSearchParams();
  if (vals.mfgMode) p.set("mfgMode", vals.mfgMode);
  vals.industry.forEach(i => p.append("industry", i));
  vals.subIndustry.forEach(s => p.append("subIndustry", s));
  vals.region.forEach(r => p.append("region", r));
  if (vals.keyword) p.set("keyword", vals.keyword);
  if (vals.businessType && vals.businessType !== "all") p.set("businessType", vals.businessType);
  if (vals.sortBy && vals.sortBy !== "rating") p.set("sortBy", vals.sortBy);
  if (vals.page && vals.page > 1) p.set("page", String(vals.page));
  return p;
}

// ── 分享搜尋結果：組出人類看得懂的條件摘要（不含 sortBy／enum 值）──────────
function buildSearchShareSummary(vals: {
  keyword: string;
  region: string[];
  industry: string[];
  subIndustry: string[];
  businessType: string;
  mfgMode: string;
}): string {
  const parts: string[] = [];
  if (vals.keyword) parts.push(`搜尋「${vals.keyword}」`);
  if (vals.region.length > 0) parts.push(vals.region.join("、"));
  if (vals.industry.length > 0) parts.push(vals.industry.join("、"));
  if (vals.subIndustry.length > 0) parts.push(vals.subIndustry.join("、"));
  if (vals.businessType === "factory") parts.push("工廠");
  else if (vals.businessType === "studio") parts.push("工作室");
  if (vals.mfgMode) parts.push(vals.mfgMode);

  if (parts.length === 0) return "台灣工廠搜尋結果｜OXM";
  return `${parts.join("・")}｜OXM 工廠搜尋結果`;
}

export default function Search() {
  const [, navigate] = useLocation();
  // Parsed once per mount — lazy initialisers below read from this snapshot.
  const params = new URLSearchParams(window.location.search);
  const { isAuthenticated } = useAuth();

  // All filter state is initialised directly from the URL so that a browser
  // back-navigation restores the exact conditions without a double-fetch.
  const [mfgMode, setMfgMode] = useState(() => params.get("mfgMode") ?? "");
  const [industry, setIndustry] = useState<string[]>(() => params.getAll("industry").filter(Boolean));
  const [subIndustry, setSubIndustry] = useState<string[]>(() => params.getAll("subIndustry").filter(Boolean));
  const [region, setRegion] = useState<string[]>(() => params.getAll("region").filter(Boolean));
  const [keyword, setKeyword] = useState(() => params.get("keyword") ?? "");
  const [committedKeyword, setCommittedKeyword] = useState(() => params.get("keyword") ?? "");
  const [businessType, setBusinessType] = useState(() => params.get("businessType") ?? "all");
  const isComposing = useRef(false);
  const [showHistory, setShowHistory] = useState(false);
  // page is transient UI/pagination state, intentionally not read from or
  // synced to the URL — a stray ?page= from an old link should not affect
  // the initial render.
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState(() => params.get("sortBy") ?? "rating");

  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const pageSize = isMobile ? 12 : 20;

  const { cart, add: cartAdd, remove: cartRemove, clear: cartClear, has: cartHas } = useInquiryCart();
  const [inquiryTitle, setInquiryTitle] = useState("");
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const createAndSendMut = trpc.inquiryBatch.createAndSend.useMutation({
    onSuccess: (data) => {
      toast.success(`已成功送出一鍵詢價給 ${data.successCount} 間工廠`);
      cartClear();
      setInquiryTitle("");
      setInquiryMessage("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleInquirySubmit = () => {
    if (!isAuthenticated) { performLogin(); return; }
    if (cart.length === 0) { toast.error("請先加入工廠"); return; }
    if (!inquiryTitle.trim()) { toast.error("請輸入詢價分類名稱"); return; }
    if (!inquiryMessage.trim()) { toast.error("請輸入詢價內容"); return; }
    createAndSendMut.mutate({
      title: inquiryTitle.trim(),
      message: inquiryMessage.trim(),
      factoryIds: cart.map(i => i.id),
    });
  };

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("oxm_search_history") || "[]"); } catch { return []; }
  });

  const saveToHistory = (term: string) => {
    if (!term.trim()) return;
    const updated = [term, ...searchHistory.filter(h => h !== term)].slice(0, 10);
    setSearchHistory(updated);
    localStorage.setItem("oxm_search_history", JSON.stringify(updated));
  };

  const [favOverrides, setFavOverrides] = useState<Record<number, boolean>>({});

  // ── URL 同步 helper（每次 filter 變更都呼叫，使用 replace 避免塞滿 history）
  // overrides 提供本次變更的新值；其餘欄位取自當前 render 的 state closure。
  const syncURL = (overrides: Partial<{
    mfgMode: string; industry: string[]; subIndustry: string[];
    region: string[]; keyword: string; businessType: string;
    sortBy: string; page: number;
  }> = {}) => {
    const vals = {
      mfgMode, industry, subIndustry, region,
      keyword: committedKeyword, businessType, sortBy, page,
      ...overrides,
    };
    const qs = buildParams(vals).toString();
    navigate(qs ? `/search?${qs}` : "/search", { replace: true });
  };

  // ── 共用 filter handlers（桌面側欄 + 手機篩選欄共用）──────────────────
  const onBusinessTypeChange = (v: string) => {
    setBusinessType(v); setPage(1);
    syncURL({ businessType: v, page: 1 });
  };

  const onMfgModeChange = (v: string) => {
    setMfgMode(v); setPage(1);
    syncURL({ mfgMode: v, page: 1 });
  };

  const onIndustryChange = (val: string[]) => {
    setIndustry(val); setSubIndustry([]); setPage(1);
    syncURL({ industry: val, subIndustry: [], page: 1 });
  };

  const onSubIndustryChange = (val: string[]) => {
    setSubIndustry(val); setPage(1);
    syncURL({ subIndustry: val, page: 1 });
  };

  const onRegionChange = (val: string[]) => {
    setRegion(val); setPage(1);
    syncURL({ region: val, page: 1 });
  };

  const onSortByChange = (v: string) => {
    setSortBy(v); setPage(1);
    syncURL({ sortBy: v, page: 1 });
  };

  const onPageChange = (newPage: number) => {
    // Intentionally does not touch the URL — pagination is local UI state,
    // and syncing it via navigate() was what caused the scroll-to-top jump
    // on mobile "load more".
    setPage(newPage);
  };
  // ─────────────────────────────────────────────────────────────────────────

  const searchInput = useMemo(() => ({
    mfgMode: mfgMode || undefined,
    industry: industry.length > 0 ? industry : undefined,
    subIndustry: subIndustry.length > 0 ? subIndustry : undefined,
    region: region.length > 0 ? region : undefined,
    keyword: committedKeyword || undefined,
    businessType: businessType && businessType !== "all" ? businessType : undefined,
    sortBy: sortBy as "rating" | "reviews" | "response" | "newest" | undefined,
    page,
    pageSize,
  }), [mfgMode, industry, subIndustry, region, committedKeyword, businessType, sortBy, page, pageSize]);

  const appliedFilters = useMemo(() => {
    const filters: Array<{ key: string; label: string; value: string }> = [];
    if (mfgMode) filters.push({ key: "mfgMode", label: "代工模式", value: mfgMode });
    if (industry.length > 0) filters.push({ key: "industry", label: "產業", value: industry.join("、") });
    if (subIndustry.length > 0) filters.push({ key: "subIndustry", label: "子產業", value: subIndustry.join("、") });
    if (region.length > 0) filters.push({ key: "region", label: "地區", value: region.join("、") });
    if (committedKeyword) filters.push({ key: "keyword", label: "關鍵字", value: committedKeyword });
    if (businessType && businessType !== "all") filters.push({ key: "businessType", label: "類型", value: businessType === "factory" ? "工廠" : "工作室" });
    return filters;
  }, [mfgMode, industry, subIndustry, region, committedKeyword, businessType]);

  const removeFilter = (key: string) => {
    let nMfgMode = mfgMode, nIndustry = industry, nSubIndustry = subIndustry;
    let nRegion = region, nKeyword = committedKeyword, nBT = businessType;
    if (key === "businessType") { setBusinessType("all"); nBT = "all"; }
    else if (key === "mfgMode") { setMfgMode(""); nMfgMode = ""; }
    else if (key === "industry") { setIndustry([]); setSubIndustry([]); nIndustry = []; nSubIndustry = []; }
    else if (key === "subIndustry") { setSubIndustry([]); nSubIndustry = []; }
    else if (key === "region") { setRegion([]); nRegion = []; }
    else if (key === "keyword") { setKeyword(""); setCommittedKeyword(""); nKeyword = ""; }
    setPage(1);
    const qs = buildParams({ mfgMode: nMfgMode, industry: nIndustry, subIndustry: nSubIndustry, region: nRegion, keyword: nKeyword, businessType: nBT, sortBy, page: 1 }).toString();
    navigate(qs ? `/search?${qs}` : "/search", { replace: true });
  };

  // page is part of searchInput (the query key), so bumping it for "load
  // more" would otherwise be treated as a brand-new, never-fetched query —
  // isLoading would flip true again and swap the whole results grid (and the
  // load-more button) out for the skeleton placeholder mid-scroll, which is
  // what was actually causing the jump back to the top. Keeping the previous
  // page's data visible while the next page loads keeps isLoading false for
  // every fetch after the very first one.
  const { data, isLoading, isFetching } = trpc.factory.search.useQuery(searchInput, {
    placeholderData: (prev) => prev,
  });
  const ads = data?.ads ?? [];

  // filterFingerprint detects when search conditions change (excluding page) to reset mobile accumulated list
  const filterFingerprint = useMemo(() =>
    JSON.stringify({ mfgMode, industry, subIndustry, region, committedKeyword, businessType, sortBy }),
    [mfgMode, industry, subIndustry, region, committedKeyword, businessType, sortBy]
  );
  const [displayedItems, setDisplayedItems] = useState<any[]>([]);
  const prevFingerprintRef = useRef(filterFingerprint);
  useEffect(() => {
    if (!data?.items) return;
    const filterChanged = prevFingerprintRef.current !== filterFingerprint;
    prevFingerprintRef.current = filterFingerprint;
    if (isMobile && page > 1 && !filterChanged) {
      setDisplayedItems(prev => [...prev, ...data.items]);
    } else {
      setDisplayedItems(data.items);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedItems = useMemo(() => {
    const items = isMobile ? displayedItems : (data?.items ?? []);
    if (businessType === "all") return items;
    return items.filter(f => (f as any).businessType === businessType);
  }, [isMobile, displayedItems, data?.items, businessType]);

  const factoryIdsInResult = useMemo(
    () => sortedItems.map((f: any) => f.id),
    [sortedItems]
  );

  const { data: batchFavData } = trpc.favorite.batchIsLiked.useQuery(
    { factoryIds: factoryIdsInResult },
    { enabled: isAuthenticated && factoryIdsInResult.length > 0 }
  );

  useEffect(() => {
    if (batchFavData) setFavOverrides({});
  }, [batchFavData]);

  const getFavState = (factoryId: number): boolean => {
    if (factoryId in favOverrides) return favOverrides[factoryId];
    return batchFavData?.[factoryId] ?? false;
  };

  const handleFavToggle = (factoryId: number, newState: boolean) => {
    setFavOverrides(prev => ({ ...prev, [factoryId]: newState }));
  };

  const handleSearch = () => {
    if (isComposing.current) return;
    setPage(1);
    setCommittedKeyword(keyword);
    if (keyword) saveToHistory(keyword);
    const qs = buildParams({ mfgMode, industry, subIndustry, region, keyword, businessType, sortBy, page: 1 }).toString();
    navigate(qs ? `/search?${qs}` : "/search", { replace: true });
  };

  const clearFilters = () => {
    setMfgMode(""); setIndustry([]); setSubIndustry([]); setRegion([]);
    setKeyword(""); setCommittedKeyword(""); setBusinessType("all"); setPage(1);
    navigate("/search", { replace: true });
  };

  // 分享目前有效的搜尋條件（不含 page／捲動位置等暫時性 UI state）
  const handleShareSearch = () => {
    const qs = buildParams({
      mfgMode, industry, subIndustry, region,
      keyword: committedKeyword, businessType, sortBy,
    }).toString();
    const url = `${window.location.origin}/search${qs ? `?${qs}` : ""}`;
    const shareTitle = "OXM 工廠搜尋結果";
    const shareText = buildSearchShareSummary({
      keyword: committedKeyword, region, industry, subIndustry, businessType, mfgMode,
    });
    void shareContent({ title: shareTitle, text: shareText, url }, { copySuccessMessage: "搜尋結果連結已複製" });
  };

  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  const seoIndustry = industry.length > 0 ? industry[0] : null;
  // title／description／noindex／canonical 公式與 server 端初始 HTML 注入
  // （server/_core/vite.ts + shared/seo/searchPage.ts）共用同一份實作，不在
  // 這裡各自重複一份。qs 用與「分享搜尋結果」相同的 buildParams（不含
  // page，純 UI 分頁狀態不算內容變化），確保這裡看到的「有沒有查詢參數」
  // 跟使用者當下實際生效的篩選條件同步，而不是只看瀏覽器第一次載入時的
  // 網址快照。
  const canonicalQs = buildParams({
    mfgMode, industry, subIndustry, region,
    keyword: committedKeyword, businessType, sortBy,
  }).toString();
  const searchMeta = buildSearchPageMeta(canonicalQs);

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{searchMeta.title}</title>
        <meta name="description" content={searchMeta.description} />
        <link rel="canonical" href={searchMeta.canonical} />
        {searchMeta.noindex && <meta name="robots" content="noindex,follow" />}
      </Helmet>
      <Navbar />
      <FloatingBackButton fallbackHref="/" />
      <div className={`container py-6 ${cart.length > 0 ? "pb-20 lg:pb-6" : ""}`}>
        <h1 className="sr-only">
          {seoIndustry ? `${seoIndustry}工廠` : "台灣工廠搜尋"}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 左側篩選欄 - 桌面 */}
          <div className="hidden lg:block">
            <Card className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-4 text-sm">篩選條件</h3>

                <div className="mb-4">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">類型</label>
                  <div className="flex flex-col gap-2">
                    {[
                      { l: "全部", v: "all" },
                      { l: "工廠", v: "factory" },
                      { l: "工作室", v: "studio" },
                    ].map(t => (
                      <Button
                        key={t.v}
                        size="sm"
                        variant={businessType === t.v ? "default" : "outline"}
                        onClick={() => onBusinessTypeChange(t.v)}
                        className="justify-start"
                      >
                        {t.v === "factory" && <Factory className="w-3 h-3 mr-1" />}
                        {t.v === "studio" && <Wrench className="w-3 h-3 mr-1" />}
                        {t.l}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">代工模式</label>
                  <div className="flex flex-col gap-2">
                    {[{ l: "ODM", v: "ODM" }, { l: "OEM", v: "OEM" }, { l: "OBM", v: "OBM" }, { l: "全部", v: "" }].map(m => (
                      <Button key={m.v} size="sm" variant={mfgMode === m.v ? "default" : "outline"}
                        onClick={() => onMfgModeChange(m.v)} className="justify-start">
                        {m.l}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">主產業</label>
                  <MultiSelect
                    options={INDUSTRY_OPTIONS}
                    value={industry}
                    onChange={onIndustryChange}
                    placeholder="不限"
                    className="h-9 w-full"
                    withClear
                  />
                </div>

                {industry.length > 0 && (() => {
                  const subOptions = Array.from(new Set(industry.flatMap(ind => {
                    const found = INDUSTRIES.find(i => i.name === ind);
                    return found ? found.sub as unknown as string[] : [];
                  })));
                  if (subOptions.length === 0) return null;
                  return (
                    <div className="mb-4">
                      <label className="text-xs font-medium text-muted-foreground mb-2 block">子產業</label>
                      <MultiSelect
                        options={subOptions}
                        value={subIndustry}
                        onChange={onSubIndustryChange}
                        placeholder="不限"
                        className="h-9 w-full"
                      />
                    </div>
                  );
                })()}

                <div className="mb-4">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">地區</label>
                  <MultiSelect
                    options={TAIWAN_REGIONS}
                    value={region}
                    onChange={onRegionChange}
                    placeholder="不限"
                    className="h-9 w-full"
                    withClear
                  />
                </div>

                <div className="relative">
                  <Input
                    placeholder="名稱或產品..."
                    value={keyword}
                    onChange={e => setKeyword(e.target.value)}
                    onCompositionStart={() => { isComposing.current = true; }}
                    onCompositionEnd={() => { isComposing.current = false; }}
                    onKeyDown={e => { if (e.key === "Enter" && !isComposing.current) handleSearch(); }}
                    onFocus={() => setShowHistory(true)}
                    onBlur={() => setTimeout(() => setShowHistory(false), 150)}
                    className="h-9 text-sm"
                  />
                  {showHistory && searchHistory.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-md">
                      {searchHistory.map((h, i) => (
                        <div
                          key={i}
                          className="px-3 py-2 text-sm hover:bg-muted cursor-pointer flex items-center gap-2"
                          onMouseDown={() => { setKeyword(h); setCommittedKeyword(h); setShowHistory(false); }}
                        >
                          <SearchIcon className="w-3 h-3 text-muted-foreground" />
                          {h}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSearch} size="sm" className="flex-1"><SearchIcon className="w-3 h-3 mr-1" />搜尋</Button>
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="flex-1">清除</Button>
                </div>

                {/* 一鍵詢價區塊 */}
                <div className="mt-4 border-t pt-4">
                  <button
                    className="flex items-center justify-between w-full text-sm font-semibold mb-2"
                    onClick={() => setCartOpen(v => !v)}
                  >
                    <span className="flex items-center gap-1.5">
                      <ShoppingCart className="w-4 h-4 text-orange-500" />
                      一鍵詢價
                      {cart.length > 0 && (
                        <span className="bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{cart.length}</span>
                      )}
                    </span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${cartOpen ? "rotate-180" : ""}`} />
                  </button>
                  {!cartOpen && (
                    <>
                      <p className="text-xs text-muted-foreground">將多間工廠加入清單，一次送出同一則詢價訊息。</p>
                      <p className="text-xs text-muted-foreground/70 leading-relaxed">實際報價、規格、付款、交期與售後服務，請與工廠確認；若發現資料不實或交易異常，可向 OXM 通報。</p>
                    </>
                  )}
                  {cartOpen && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">已加入 {cart.length} 間工廠</p>
                      {cart.length > 0 && (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {cart.map(item => (
                            <div key={item.id} className="flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1.5">
                              <span className="truncate flex-1 mr-1">{item.name}</span>
                              <button onClick={() => cartRemove(item.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">詢價分類名稱</label>
                        <Input
                          value={inquiryTitle}
                          onChange={e => setInquiryTitle(e.target.value)}
                          placeholder="例如：0503 詢問紡織"
                          className="h-8 text-xs placeholder:text-gray-300"
                          maxLength={50}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">詢價內容</label>
                        <Textarea
                          value={inquiryMessage}
                          onChange={e => setInquiryMessage(e.target.value)}
                          placeholder="您好，我正在尋找合適的工廠，想詢問貴公司是否能承接以下需求，請協助提供報價、MOQ、交期與合作方式，謝謝。"
                          className="text-xs resize-none"
                          rows={4}
                          maxLength={2000}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground/70 leading-relaxed">實際報價、規格、付款與交期，請與工廠確認；若發現異常可向 OXM 通報。</p>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={handleInquirySubmit}
                        disabled={createAndSendMut.isPending || cart.length === 0}
                      >
                        <Send className="w-3 h-3 mr-1" />
                        {createAndSendMut.isPending ? "送出中…" : "送出一鍵詢價"}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 主要內容 */}
          <div className="lg:col-span-3">
            {/* 手機篩選欄 */}
            <Card className="mb-3 lg:hidden">
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex gap-1">
                    {[{ l: "全部", v: "all" }, { l: "工廠", v: "factory" }, { l: "工作室", v: "studio" }].map(t => (
                      <Button key={t.v} size="sm" variant={businessType === t.v ? "default" : "outline"}
                        className="h-8 text-xs px-2"
                        onClick={() => onBusinessTypeChange(t.v)}>
                        {t.l}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {[{ l: "ODM", v: "ODM" }, { l: "OEM", v: "OEM" }, { l: "OBM", v: "OBM" }, { l: "全部", v: "" }].map(m => (
                      <Button key={m.v} size="sm" variant={mfgMode === m.v ? "default" : "outline"}
                        className="h-8 text-xs px-2"
                        onClick={() => onMfgModeChange(m.v)}>{m.l}
                      </Button>
                    ))}
                  </div>
                  <MultiSelect
                    options={INDUSTRY_OPTIONS}
                    value={industry}
                    onChange={onIndustryChange}
                    placeholder="主產業"
                    className="w-[120px] h-8 text-xs"
                    withClear
                  />
                  {industry.length > 0 && (() => {
                    const subOptions = Array.from(new Set(industry.flatMap(ind => {
                      const found = INDUSTRIES.find(i => i.name === ind);
                      return found ? found.sub as unknown as string[] : [];
                    })));
                    if (subOptions.length === 0) return null;
                    return (
                      <MultiSelect
                        options={subOptions}
                        value={subIndustry}
                        onChange={onSubIndustryChange}
                        placeholder="子產業"
                        className="w-[120px] h-8 text-xs"
                      />
                    );
                  })()}
                  <MultiSelect
                    options={TAIWAN_REGIONS}
                    value={region}
                    onChange={onRegionChange}
                    placeholder="地區"
                    className="w-[120px] h-8 text-xs"
                    withClear
                  />
                  <Input placeholder="關鍵字..." value={keyword} onChange={e => setKeyword(e.target.value)}
                    onCompositionStart={() => { isComposing.current = true; }}
                    onCompositionEnd={() => { isComposing.current = false; }}
                    onKeyDown={e => { if (e.key === "Enter" && !isComposing.current) handleSearch(); }}
                    className="w-[140px] h-8 text-xs" />
                  <Button size="sm" className="h-8 text-xs px-3" onClick={handleSearch}><SearchIcon className="w-3.5 h-3.5 mr-1" />搜尋</Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>清除</Button>
                </div>
              </CardContent>
            </Card>

            {/* 手機版一鍵詢價送出入口 */}
            <div className="lg:hidden mb-3 rounded-xl border border-orange-200 bg-orange-50/70 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-orange-900">
                    <ShoppingCart className="w-4 h-4 text-orange-500 shrink-0" />
                    一鍵詢價
                    {cart.length > 0 && (
                      <span className="bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{cart.length}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cart.length === 0
                      ? "從下方工廠卡片加入後，可一次送出詢價"
                      : `已選 ${cart.length} 間，點右側按鈕送出`}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0 h-9 text-sm"
                  disabled={cart.length === 0}
                  onClick={() => {
                    if (!isAuthenticated) { performLogin(); return; }
                    setMobileCartOpen(true);
                  }}
                >
                  {cart.length === 0 ? "請先加入" : "送出詢價"}
                </Button>
              </div>
            </div>

            {/* 已套用條件 */}
            {appliedFilters.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground">已套用：</span>
                {appliedFilters.map((filter) => (
                  <Badge key={filter.key} variant="secondary" className="flex items-center gap-1 px-2 py-0.5">
                    <span className="text-xs">{filter.label}: {filter.value}</span>
                    <button onClick={() => removeFilter(filter.key)} className="ml-1 hover:opacity-70">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground">
                  一鍵清除
                </Button>
              </div>
            )}

            {/* 廣告輪播 */}
            {ads && ads.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Megaphone className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-muted-foreground">精選推薦</span>
                </div>
                <Carousel opts={{ loop: true, align: "start" }} className="w-full">
                  <CarouselContent className="-ml-3">
                    {ads.map((ad) => ad.factory && (
                      <CarouselItem key={ad.id} className="pl-3 basis-full sm:basis-1/2 lg:basis-1/3">
                        <Link href={`/factory/${ad.factory.id}`}>
                          <Card className="border-primary/20 bg-primary/5 hover:shadow-md transition-shadow cursor-pointer h-full">
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between mb-2">
                                <h3 className="font-semibold text-base">{ad.factory.name}</h3>
                                <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">推薦</Badge>
                              </div>
                              <div className="flex flex-wrap gap-1 mb-2">
                                <BusinessTypeBadge businessType={(ad.factory as any).businessType} />
                                {((ad.factory as any).industry as string[] | null)?.map(ind => (
                                  <Badge key={ind} variant="outline" className="text-xs">{ind}</Badge>
                                ))}
                                {(ad.factory.mfgModes as string[]).map(m => (
                                  <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                                ))}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{ad.factory.region}</span>
                                <span className="flex items-center gap-1"><Star className="w-3 h-3 text-yellow-500" />{Number(ad.factory.avgRating).toFixed(1)}</span>
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious className="-left-3" />
                  <CarouselNext className="-right-3" />
                </Carousel>
              </div>
            )}

            {/* 結果標頭 */}
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <p className="text-sm text-muted-foreground">
                {isLoading ? "搜尋中..." : `共找到 ${data?.total ?? 0} 筆結果`}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs px-3" onClick={handleShareSearch}>
                  <Share2 className="w-3.5 h-3.5 mr-1" />分享搜尋結果
                </Button>
                {!isLoading && (data?.total ?? 0) > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">排序：</span>
                    <Select value={sortBy} onValueChange={onSortByChange}>
                      <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rating">評分最高</SelectItem>
                        <SelectItem value="reviews">評價最多</SelectItem>
                        <SelectItem value="response">回覆最快</SelectItem>
                        <SelectItem value="newest">最新建立</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {isLoading ? (
              <div className="grid md:grid-cols-2 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4"><Skeleton className="h-32" /></CardContent></Card>
                ))}
              </div>
            ) : sortedItems.length === 0 ? (
              <Card><CardContent className="p-12 text-center text-muted-foreground">
                <Factory className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>沒有找到符合條件的結果</p>
                <Button variant="link" onClick={clearFilters}>清除篩選條件重新搜尋</Button>
              </CardContent></Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-4 items-stretch">
                {sortedItems.map((factory) => (
                  <FactoryCard
                    key={factory.id}
                    factory={factory}
                    getFavState={getFavState}
                    handleFavToggle={handleFavToggle}
                    cartHas={cartHas}
                    cartAdd={cartAdd}
                    cartRemove={cartRemove}
                    setCartOpen={setCartOpen}
                    isMobile={isMobile}
                  />
                ))}
              </div>
            )}

            {/* 手機：載入更多；桌機：分頁按鈕 */}
            {isMobile ? (
              !isLoading && page < totalPages && (
                <div className="flex justify-center mt-8">
                  <Button
                    type="button"
                    variant="outline"
                    className="px-8 h-11 text-sm"
                    onClick={() => onPageChange(page + 1)}
                    disabled={isFetching}
                  >
                    {isFetching ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />載入中…</>
                    ) : (
                      `載入更多（還有 ${(data?.total ?? 0) - displayedItems.length} 間）`
                    )}
                  </Button>
                </div>
              )
            ) : (
              totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-8">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="flex items-center px-3 text-sm text-muted-foreground">
                    第 {page} / {totalPages} 頁
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* 手機版底部一鍵詢價 bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-4 py-3 bg-white border-t shadow-lg lg:hidden">
          <Button
            className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
            onClick={() => {
              if (!isAuthenticated) { performLogin(); return; }
              setMobileCartOpen(true);
            }}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            已選 {cart.length} 間・前往詢價
          </Button>
        </div>
      )}

      {/* 手機版一鍵詢價 Dialog */}
      <Dialog open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-orange-500" />
              一鍵詢價（已選 {cart.length} 間）
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {cart.length > 0 && (
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm bg-muted/40 rounded px-3 py-1.5">
                    <span className="truncate flex-1 mr-2">{item.name}</span>
                    <button onClick={() => cartRemove(item.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">詢價分類名稱</label>
              <Input
                value={inquiryTitle}
                onChange={e => setInquiryTitle(e.target.value)}
                placeholder="例如：0503 詢問紡織"
                className="h-9 text-sm placeholder:text-gray-300"
                maxLength={50}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">詢價內容</label>
              <Textarea
                value={inquiryMessage}
                onChange={e => setInquiryMessage(e.target.value)}
                placeholder="您好，我正在尋找合適的工廠，想詢問貴公司是否能承接以下需求，請協助提供報價、MOQ、交期與合作方式，謝謝。"
                className="text-sm resize-none"
                rows={5}
                maxLength={2000}
              />
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              實際報價、規格、付款與交期，請與工廠確認；若發現異常可向 OXM 通報。
            </p>
            <Button
              className="w-full"
              onClick={() => {
                handleInquirySubmit();
                if (!createAndSendMut.isPending) setMobileCartOpen(false);
              }}
              disabled={createAndSendMut.isPending || cart.length === 0}
            >
              <Send className="w-4 h-4 mr-2" />
              {createAndSendMut.isPending ? "送出中…" : "送出一鍵詢價"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
