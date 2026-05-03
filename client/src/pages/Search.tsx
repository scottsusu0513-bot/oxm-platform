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
import { INDUSTRIES, INDUSTRY_OPTIONS, TAIWAN_REGIONS } from "@shared/constants";
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import { useState, useMemo, useEffect } from "react";
import { Search as SearchIcon, Star, MapPin, Factory, ChevronLeft, ChevronRight, Megaphone, Heart, X, Wrench, ChevronDown, Clock, ShoppingCart, Plus, Minus, Send } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";

// ── 一鍵詢價購物車 hook ───────────────────────────────────────────────────
type CartItem = { id: number; name: string };
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
      <Factory className="w-3 h-3 mr-1" />代工廠
    </Badge>
  );
}

// ── 改造重點：FavButton 不再自己查詢，改由父元件傳入狀態 ──
function FavButton({ factoryId, initialIsFav, onToggle }: {
  factoryId: number;
  initialIsFav: boolean;
  onToggle: (factoryId: number, newState: boolean) => void;
}) {
  const { isAuthenticated } = useAuth();
  const [isFav, setIsFav] = useState(initialIsFav);

  useEffect(() => {
    setIsFav(initialIsFav);
  }, [initialIsFav]);

  const toggleFav = trpc.favorite.toggle.useMutation({
    onSuccess: (data) => {
      setIsFav(data.isFavorited);
      onToggle(factoryId, data.isFavorited);
      toast.success(data.isFavorited ? "已加入收藏" : "已取消收藏");
    },
    onError: () => toast.error("操作失敗"),
  });

  const handleToggleFav = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
    toggleFav.mutate({ factoryId });
  };

  return (
    <Button size="sm" variant={isFav ? "default" : "outline"} onClick={handleToggleFav} disabled={toggleFav.isPending}>
      <Heart className={`w-4 h-4 ${isFav ? "fill-current" : ""}`} />
    </Button>
  );
}

export default function Search() {
  const [location, navigate] = useLocation();
const params = new URLSearchParams(window.location.search);
const { isAuthenticated } = useAuth();

  const [mfgMode, setMfgMode] = useState("");
  const [industry, setIndustry] = useState<string[]>([]);
  const [subIndustry, setSubIndustry] = useState<string[]>([]);
  const [region, setRegion] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [businessType, setBusinessType] = useState("all");
  const [showHistory, setShowHistory] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("rating");

  const { cart, add: cartAdd, remove: cartRemove, clear: cartClear, has: cartHas } = useInquiryCart();
  const [inquiryTitle, setInquiryTitle] = useState("");
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [cartOpen, setCartOpen] = useState(false);

  const createAndSendMut = trpc.inquiryBatch.createAndSend.useMutation({
    onSuccess: (data, vars) => {
      toast.success(`已成功送出一鍵詢價給 ${data.successCount} 間工廠`);
      cartClear();
      setInquiryTitle("");
      setInquiryMessage("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleInquirySubmit = () => {
    if (!isAuthenticated) { window.location.href = getLoginUrl(); return; }
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
    try {
      return JSON.parse(localStorage.getItem("oxm_search_history") || "[]");
    } catch {
      return [];
    }
  });

  const saveToHistory = (term: string) => {
    if (!term.trim()) return;
    const updated = [term, ...searchHistory.filter((h) => h !== term)].slice(0, 10);
    setSearchHistory(updated);
    localStorage.setItem("oxm_search_history", JSON.stringify(updated));
  };

  useEffect(() => {
    setMfgMode(params.get("mfgMode") ?? "");
    setIndustry(params.getAll("industry").filter(Boolean));
    setSubIndustry(params.getAll("subIndustry").filter(Boolean));
    setRegion(params.getAll("region").filter(Boolean));
    setKeyword(params.get("keyword") ?? "");
    setBusinessType(params.get("businessType") ?? "all");
    setPage(1);
  }, []);

  // 收藏狀態：以伺服器資料為底，toggle 後用 override 即時更新 UI
  const [favOverrides, setFavOverrides] = useState<Record<number, boolean>>({});

    const searchInput = useMemo(() => ({
    mfgMode: mfgMode || undefined,
    industry: industry.length > 0 ? industry : undefined,
    subIndustry: subIndustry.length > 0 ? subIndustry : undefined,
    region: region.length > 0 ? region : undefined,
    keyword: keyword || undefined,
    businessType: businessType && businessType !== "all" ? businessType : undefined,
    sortBy: sortBy as "rating" | "reviews" | "response" | "newest" | undefined,
    page,
    pageSize: 20,
  }), [mfgMode, industry, subIndustry, region, keyword, businessType, sortBy, page]);

  const appliedFilters = useMemo(() => {
    const filters: Array<{ key: string; label: string; value: string }> = [];
    if (mfgMode) filters.push({ key: "mfgMode", label: "代工模式", value: mfgMode });
    if (industry.length > 0) filters.push({ key: "industry", label: "產業", value: industry.join("、") });
    if (subIndustry.length > 0) filters.push({ key: "subIndustry", label: "子產業", value: subIndustry.join("、") });
    if (region.length > 0) filters.push({ key: "region", label: "地區", value: region.join("、") });
    if (keyword) filters.push({ key: "keyword", label: "關鍵字", value: keyword });
    if (businessType && businessType !== "all") filters.push({ key: "businessType", label: "類型", value: businessType === "factory" ? "代工廠" : "工作室" });
    return filters;
  }, [mfgMode, industry, subIndustry, region, keyword, businessType]);

  const removeFilter = (key: string) => {
    if (key === "businessType") setBusinessType("all");
    else if (key === "mfgMode") setMfgMode("");
    else if (key === "industry") { setIndustry([]); setSubIndustry([]); }
    else if (key === "subIndustry") setSubIndustry([]);
    else if (key === "region") setRegion([]);
    else if (key === "keyword") setKeyword("");
    setPage(1);
  };

  const { data, isLoading } = trpc.factory.search.useQuery(searchInput);
const ads = data?.ads ?? [];  // 從 search 結果直接取廣告，不另打 API

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    if (businessType === "all") return data.items;
    return data.items.filter(f => (f as any).businessType === businessType);
  }, [data?.items, businessType]);

  const sortedItems = filteredItems;

  // ── 批次查詢收藏狀態（只在登入且有結果時才打一支 API）──
  const factoryIdsInResult = useMemo(
  () => data?.items.map(f => f.id) ?? [],
  [data?.items]
);

  const { data: batchFavData } = trpc.favorite.batchIsLiked.useQuery(
    { factoryIds: factoryIdsInResult },
    { enabled: isAuthenticated && factoryIdsInResult.length > 0 }
  );

  // 伺服器資料更新時清掉本地 override
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
    setPage(1);
    const p = new URLSearchParams();
    if (mfgMode) p.set("mfgMode", mfgMode);
    industry.forEach(i => p.append("industry", i));
    subIndustry.forEach(s => p.append("subIndustry", s));
    region.forEach(r => p.append("region", r));
    if (keyword) p.set("keyword", keyword);
    if (keyword) saveToHistory(keyword);
    if (businessType && businessType !== "all") p.set("businessType", businessType);
    navigate(`/search?${p.toString()}`, { replace: true });
  };

  const clearFilters = () => {
    setMfgMode(""); setIndustry([]); setSubIndustry([]); setRegion([]);
    setKeyword(""); setBusinessType("all"); setPage(1);
    navigate("/search", { replace: true });
  };

  const totalPages = Math.ceil((data?.total ?? 0) / 20);

  const seoIndustry = industry.length > 0 ? industry[0] : null;
  const pageTitle = seoIndustry
    ? `${seoIndustry}代工｜台灣OEM ODM工廠推薦｜OXM`
    : "搜尋台灣代工廠｜OEM ODM 工廠媒合｜OXM";
  const pageDesc = seoIndustry
    ? `尋找台灣${seoIndustry}代工廠，OEM / ODM 皆可配合，快速詢價、直接聯繫廠商。`
    : "搜尋全台代工廠與工作室，可依產業、地區、資本額篩選，快速找到合適的 OEM / ODM 廠商。";

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
      </Helmet>
      <Navbar />
      <div className="container py-6">
        <Button variant="outline" onClick={() => navigate("/")} className="mb-4 flex items-center gap-2">
          <ChevronLeft className="h-4 w-4" />返回首頁
        </Button>
        <h1 className="sr-only">
          {seoIndustry ? `${seoIndustry}代工廠` : "台灣代工廠搜尋"}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 左側篩選欄 - 桌面 */}
          <div className="hidden lg:block">
            <Card className="sticky top-6">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-4 text-sm">篩選條件</h3>

                <div className="mb-4">
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">類型</label>
                  <div className="flex flex-col gap-2">
                    {[
                      { l: "全部", v: "all" },
                      { l: "代工廠", v: "factory" },
                      { l: "工作室", v: "studio" },
                    ].map(t => (
                      <Button
                        key={t.v}
                        size="sm"
                        variant={businessType === t.v ? "default" : "outline"}
                        onClick={() => { setBusinessType(t.v); setPage(1); }}
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
                    {[{ l: "ODM", v: "ODM" }, { l: "OEM", v: "OEM" }, { l: "全部", v: "" }].map(m => (
                      <Button key={m.v} size="sm" variant={mfgMode === m.v ? "default" : "outline"}
                        onClick={() => { setMfgMode(m.v); setPage(1); }} className="justify-start">
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
                    onChange={(val) => { setIndustry(val); setSubIndustry([]); setPage(1); }}
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
                        onChange={(val) => { setSubIndustry(val); setPage(1); }}
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
                    onChange={(val) => { setRegion(val); setPage(1); }}
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
                    onKeyDown={e => e.key === "Enter" && handleSearch()}
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
                          onMouseDown={() => { setKeyword(h); setShowHistory(false); }}
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
                    <p className="text-xs text-muted-foreground">將多間工廠加入清單，一次送出同一則詢價訊息。</p>
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
                          className="h-8 text-xs"
                          maxLength={50}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">詢價內容</label>
                        <Textarea
                          value={inquiryMessage}
                          onChange={e => setInquiryMessage(e.target.value)}
                          placeholder="您好，我正在尋找合適的代工廠，想詢問貴公司是否能承接以下需求，請協助提供報價、MOQ、交期與合作方式，謝謝。"
                          className="text-xs resize-none"
                          rows={4}
                          maxLength={2000}
                        />
                      </div>
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
            <Card className="mb-6 lg:hidden">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex gap-1">
                    {[{ l: "全部", v: "all" }, { l: "代工廠", v: "factory" }, { l: "工作室", v: "studio" }].map(t => (
                      <Button key={t.v} size="sm" variant={businessType === t.v ? "default" : "outline"}
                        onClick={() => { setBusinessType(t.v); setPage(1); }}>
                        {t.l}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {[{ l: "ODM", v: "ODM" }, { l: "OEM", v: "OEM" }, { l: "全部", v: "" }].map(m => (
                      <Button key={m.v} size="sm" variant={mfgMode === m.v ? "default" : "outline"}
                        onClick={() => { setMfgMode(m.v); setPage(1); }}>{m.l}
                      </Button>
                    ))}
                  </div>
                  <MultiSelect
                    options={INDUSTRY_OPTIONS}
                    value={industry}
                    onChange={(val) => { setIndustry(val); setSubIndustry([]); setPage(1); }}
                    placeholder="主產業"
                    className="w-[130px]"
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
                        onChange={(val) => { setSubIndustry(val); setPage(1); }}
                        placeholder="子產業"
                        className="w-[130px]"
                      />
                    );
                  })()}
                  <MultiSelect
                    options={TAIWAN_REGIONS}
                    value={region}
                    onChange={(val) => { setRegion(val); setPage(1); }}
                    placeholder="地區"
                    className="w-[130px]"
                    withClear
                  />
                  <Input placeholder="關鍵字..." value={keyword} onChange={e => setKeyword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSearch()} className="w-[160px]" />
                  <Button onClick={handleSearch}><SearchIcon className="w-4 h-4 mr-1" />搜尋</Button>
                  <Button variant="ghost" size="sm" onClick={clearFilters}>清除</Button>
                </div>
              </CardContent>
            </Card>

            {/* 已套用條件 */}
            {appliedFilters.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2 items-center">
                <span className="text-sm text-muted-foreground">已套用：</span>
                {appliedFilters.map((filter) => (
                  <Badge key={filter.key} variant="secondary" className="flex items-center gap-1 px-3 py-1">
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
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                {isLoading ? "搜尋中..." : `共找到 ${data?.total ?? 0} 筆結果`}
              </p>
              {!isLoading && (data?.total ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">排序：</span>
                  <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1); }}>
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
              <div className="grid md:grid-cols-2 gap-4">
                {sortedItems.map((factory) => (
                  <div key={factory.id} className="relative">
                  <Link href={`/factory/${factory.id}`}>
                    <Card className="hover:shadow-md transition-shadow cursor-pointer h-full overflow-hidden">
                      {/* 封面大圖 */}
                      <div className="relative h-36 bg-gradient-to-br from-orange-100 to-amber-50 overflow-hidden">
                        {(factory as any).avatarUrl ? (
                          <img
                            src={(factory as any).avatarUrl}
                            alt={factory.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {(factory as any).businessType === "studio"
                              ? <Wrench className="w-14 h-14 text-purple-200" />
                              : <Factory className="w-14 h-14 text-orange-200" />}
                          </div>
                        )}
                        <div className="absolute top-2 right-2" onClick={(e) => e.preventDefault()}>
                          <FavButton factoryId={factory.id} initialIsFav={getFavState(factory.id)} onToggle={handleFavToggle} />
                        </div>
                      </div>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h3 className="font-semibold text-lg">{factory.name}</h3>
                              {(factory as any).certified && (
                                <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full shrink-0">
                                  ✓ 認證工廠
                                </span>
                              )}
                              {(factory as any).operationStatus === "busy" && (
                                <span className="inline-flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />產線繁忙
                                </span>
                              )}
                              {(factory as any).operationStatus === "full" && (
                                <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />產線滿載
                                </span>
                              )}
                              {(!(factory as any).operationStatus || (factory as any).operationStatus === "normal") && (
                                <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />接單中
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <BusinessTypeBadge businessType={(factory as any).businessType} />
                              {((factory as any).industry as string[] | null)?.map(ind => (
                                <Badge key={ind}>{ind}</Badge>
                              ))}
                              {((factory as any).subIndustry as string[] | null)?.map(s => (
                                <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                              ))}
                              {(factory.mfgModes as string[]).map(m => (
                                <Badge key={m} variant="secondary">{m}</Badge>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-yellow-500 shrink-0">
                            <Star className="w-4 h-4 fill-current" />
                            <span className="font-medium text-sm">{Number(factory.avgRating).toFixed(1)}</span>
                            <span className="text-xs text-muted-foreground">({factory.reviewCount})</span>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                          {factory.description || "暫無簡介"}
                        </p>
                        <div className="mt-2 pt-2 border-t border-border/50 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" />{factory.region || "無"}</span>
                          <span className="truncate">地址：{(factory as any).address || "無"}</span>
                          <span>{factory.foundedYear ? `成立於 ${factory.foundedYear} 年` : "成立年份：無"}</span>
                          <span className="truncate">負責人：{(factory as any).ownerName || "無"}</span>
                          <span>電話：{(factory as any).phone || "無"}</span>
                          <span className="truncate">官方網站：{(factory as any).website
                            ? <a href={(factory as any).website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>連結</a>
                            : "無"
                          }</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 shrink-0" />
                            {(() => {
                              const h = parseFloat((factory as any).avgResponseHours ?? "");
                              if (isNaN(h)) return "回覆時間：未知";
                              if (h < 2) return "回覆：2hr 內";
                              if (h < 24) return "回覆：24hr 內";
                              return "回覆：較慢";
                            })()}
                          </span>
                          <span className="truncate">
                            {(factory as any).weekdayHours || (factory as any).weekendHours
                              ? [(factory as any).weekdayHours ? `平日 ${(factory as any).weekdayHours}` : null, (factory as any).weekendHours ? `假日 ${(factory as any).weekendHours}` : null].filter(Boolean).join("／")
                              : "營業時間：無"
                            }
                          </span>
                          <span className="col-span-2 text-muted-foreground/70">資本額：{factory.capitalLevel || "無"}</span>
                        </div>
                        <div className="mt-3 pt-2 border-t border-border/30" onClick={e => e.preventDefault()}>
                          <Button
                            size="sm"
                            variant={cartHas(factory.id) ? "default" : "outline"}
                            className="w-full text-xs h-7"
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (cartHas(factory.id)) {
                                cartRemove(factory.id);
                              } else {
                                cartAdd({ id: factory.id, name: factory.name });
                                setCartOpen(true);
                                toast.success(`已加入一鍵詢價：${factory.name}`);
                              }
                            }}
                          >
                            {cartHas(factory.id) ? (
                              <><Minus className="w-3 h-3 mr-1" />已加入一鍵詢價</>
                            ) : (
                              <><Plus className="w-3 h-3 mr-1" />加入一鍵詢價</>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                  </div>
                ))}
              </div>
            )}

            {/* 分頁 */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-8">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="flex items-center px-3 text-sm text-muted-foreground">
                  第 {page} / {totalPages} 頁
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}