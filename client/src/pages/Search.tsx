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
import { trpc } from "@/lib/trpc";
import { useLocation, Link } from "wouter";
import { useState, useMemo, useEffect, useRef } from "react";
import { Search as SearchIcon, Star, MapPin, Factory, ChevronLeft, ChevronRight, Megaphone, Heart, X, Wrench, ChevronDown, ShoppingCart, Plus, Minus, Send, Loader2 } from "lucide-react";
import { isNativeApp } from "@/lib/platform";
import { useAuth } from "@/_core/hooks/useAuth";
import { performLogin } from "@/const";
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
    if (!isAuthenticated) { performLogin(); return; }
    toggleFav.mutate({ factoryId });
  };

  return (
    <Button size="sm" variant={isFav ? "default" : "outline"} onClick={handleToggleFav} disabled={toggleFav.isPending}>
      <Heart className={`w-4 h-4 ${isFav ? "fill-current" : ""}`} />
    </Button>
  );
}

function useImageAspectRatio(url: string | null | undefined): number | null {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    if (!url) { setRatio(null); return; }
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalHeight > 0) setRatio(img.naturalWidth / img.naturalHeight);
    };
    img.onerror = () => setRatio(null);
    img.src = url;
  }, [url]);
  return ratio;
}

type FactoryCardProps = {
  factory: any;
  getFavState: (id: number) => boolean;
  handleFavToggle: (id: number, newState: boolean) => void;
  cartHas: (id: number) => boolean;
  cartAdd: (item: CartItem) => void;
  cartRemove: (id: number) => void;
  setCartOpen: (open: boolean) => void;
  isMobile: boolean;
};

function FactoryCard({ factory, getFavState, handleFavToggle, cartHas, cartAdd, cartRemove, setCartOpen, isMobile }: FactoryCardProps) {
  const avatarUrl = factory.avatarUrl as string | null | undefined;
  const ratio = useImageAspectRatio(avatarUrl);
  const isWide = avatarUrl && ratio !== null && ratio >= 2.2;

  return (
    <div className="h-full">
      <Link href={`/factory/${factory.id}`} className="block h-full">
        <Card className="hover:shadow-md transition-shadow cursor-pointer h-full overflow-hidden">
          {isWide ? (
            <div className="flex flex-col h-full">
              <div className="relative h-28 shrink-0 bg-orange-50/40 flex items-center justify-center p-3 overflow-hidden">
                <img src={avatarUrl!} alt={factory.name} className="w-full h-full object-contain" loading="lazy" />
                <div className="absolute top-2 right-2" onClick={(e) => e.preventDefault()}>
                  <FavButton factoryId={factory.id} initialIsFav={getFavState(factory.id)} onToggle={handleFavToggle} />
                </div>
              </div>
              <CardContent className="p-4 flex flex-col min-w-0 flex-1">
                <FactoryCardContent factory={factory} cartHas={cartHas} cartAdd={cartAdd} cartRemove={cartRemove} setCartOpen={setCartOpen} isMobile={isMobile} />
              </CardContent>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row h-full">
              <div className="relative h-36 md:h-auto md:w-40 shrink-0 bg-orange-50/40 flex items-center justify-center p-4 overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={factory.name} className="w-full h-full object-contain" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {factory.businessType === "studio"
                      ? <Wrench className="w-14 h-14 text-purple-200" />
                      : <Factory className="w-14 h-14 text-orange-200" />}
                  </div>
                )}
                <div className="absolute top-2 right-2" onClick={(e) => e.preventDefault()}>
                  <FavButton factoryId={factory.id} initialIsFav={getFavState(factory.id)} onToggle={handleFavToggle} />
                </div>
              </div>
              <div className="flex-1 p-4 flex flex-col min-w-0">
                <FactoryCardContent factory={factory} cartHas={cartHas} cartAdd={cartAdd} cartRemove={cartRemove} setCartOpen={setCartOpen} isMobile={isMobile} />
              </div>
            </div>
          )}
        </Card>
      </Link>
    </div>
  );
}

function FactoryCardContent({ factory, cartHas, cartAdd, cartRemove, setCartOpen, isMobile }: Omit<FactoryCardProps, "getFavState" | "handleFavToggle">) {
  const phoneClickable = isMobile || isNativeApp();
  const displayContact =
    (factory.contactPersonName as string | null)?.trim() ||
    (factory.ownerName as string | null)?.trim() ||
    "無";
  const mfgModes: string[] = Array.isArray(factory.mfgModes) ? factory.mfgModes : [];
  const serviceType = mfgModes.length > 0 ? mfgModes.join("、") : "無";
  const hoursStr =
    factory.weekdayHours || factory.weekendHours
      ? [
          factory.weekdayHours ? `平日 ${factory.weekdayHours}` : null,
          factory.weekendHours ? `假日 ${factory.weekendHours}` : null,
        ].filter(Boolean).join("／")
      : "無";

  return (
    <>
      {/* 標題區 */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0 mr-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-lg leading-tight">{factory.name}</h3>
            {factory.certified && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full shrink-0">
                ✓ 認證工廠
              </span>
            )}
            {factory.operationStatus === "busy" && (
              <span className="inline-flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />產線繁忙
              </span>
            )}
            {factory.operationStatus === "full" && (
              <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />產線滿載
              </span>
            )}
            {(!factory.operationStatus || factory.operationStatus === "normal") && (
              <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />接單中
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 text-yellow-500 shrink-0">
          <Star className="w-4 h-4 fill-current" />
          <span className="font-medium text-sm">{Number(factory.avgRating).toFixed(1)}</span>
          <span className="text-xs text-muted-foreground">({factory.reviewCount})</span>
        </div>
      </div>

      {/* 自我介紹區 - 固定高度 */}
      <p className="text-sm text-muted-foreground line-clamp-2 min-h-[3rem] mb-3">
        {(factory.description as string | null) ?? ""}
      </p>

      {/* 基本資料區 - 固定 5 列 */}
      <div className="pt-2 border-t border-border/50 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {/* 列1：位置 | 成立年份 */}
        <span className="flex items-center gap-1 min-w-0">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">位置：{factory.region || "無"}</span>
        </span>
        <span className="min-w-0 truncate">成立年份：{factory.foundedYear ? `${factory.foundedYear} 年` : "無"}</span>

        {/* 列2：地址（整行，完整顯示） */}
        <span className="sm:col-span-2 min-w-0 whitespace-normal break-words">
          地址：{factory.address || "無"}
        </span>

        {/* 列3：聯絡人 | 聯絡電話 */}
        <span className="min-w-0 truncate">聯絡人：{displayContact}</span>
        <span className="min-w-0">
          聯絡電話：{factory.phone
            ? (phoneClickable
              ? <a href={`tel:${(factory.phone as string).replace(/[\s\-\(\)]/g, "")}`} onClick={e => e.stopPropagation()} className="underline underline-offset-2">{factory.phone}</a>
              : <span>{factory.phone}</span>)
            : "無"
          }
        </span>

        {/* 列4：服務類型 | 上班時間 */}
        <span className="min-w-0">服務類型：{serviceType}</span>
        <span className="min-w-0 whitespace-normal break-words">上班時間：{hoursStr}</span>

        {/* 列5：官方網站 | 資本額 */}
        <span className="min-w-0">
          官方網站：{factory.website
            ? <a href={factory.website as string} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline" onClick={e => e.stopPropagation()}>連結</a>
            : "無"
          }
        </span>
        <span className="min-w-0 truncate">資本額：{factory.capitalLevel || "無"}</span>
      </div>

      {/* 一鍵詢價按鈕 - 貼底 */}
      <div className="mt-auto pt-4" onClick={e => e.preventDefault()}>
        <Button
          size="sm"
          variant={cartHas(factory.id) ? "default" : "outline"}
          className="w-full text-sm h-9"
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
            <><Minus className="w-3.5 h-3.5 mr-1" />已加入詢價</>
          ) : (
            <><Plus className="w-3.5 h-3.5 mr-1" />加入一鍵詢價</>
          )}
        </Button>
      </div>
    </>
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
  page: number;
}) {
  const p = new URLSearchParams();
  if (vals.mfgMode) p.set("mfgMode", vals.mfgMode);
  vals.industry.forEach(i => p.append("industry", i));
  vals.subIndustry.forEach(s => p.append("subIndustry", s));
  vals.region.forEach(r => p.append("region", r));
  if (vals.keyword) p.set("keyword", vals.keyword);
  if (vals.businessType && vals.businessType !== "all") p.set("businessType", vals.businessType);
  if (vals.sortBy && vals.sortBy !== "rating") p.set("sortBy", vals.sortBy);
  if (vals.page > 1) p.set("page", String(vals.page));
  return p;
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
  const [page, setPage] = useState(() => Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1));
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
    setPage(newPage);
    syncURL({ page: newPage });
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
    if (businessType && businessType !== "all") filters.push({ key: "businessType", label: "類型", value: businessType === "factory" ? "代工廠" : "工作室" });
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

  const { data, isLoading, isFetching } = trpc.factory.search.useQuery(searchInput);
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

  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);

  const seoIndustry = industry.length > 0 ? industry[0] : null;
  const pageTitle = seoIndustry
    ? `${seoIndustry}｜台灣傳產供應商與工廠資源｜OXM`
    : "搜尋台灣傳產廠商與資源｜OXM";
  const pageDesc = seoIndustry
    ? `在 OXM 尋找台灣${seoIndustry}相關廠商與供應鏈資源，包含工廠、OEM/ODM 代工、材料、設備與產業服務，快速比較並送出詢價。`
    : "在 OXM 搜尋全台傳統產業廠商，涵蓋工廠、OEM/ODM 代工、工業設備、材料商、包裝印刷與設計工作室，可依產業、地區篩選，快速找到合適的合作對象。";

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
      </Helmet>
      <Navbar />
      <div className={`container py-6 ${cart.length > 0 ? "pb-20 lg:pb-6" : ""}`}>
        <Button variant="outline" onClick={() => navigate("/")} className="mb-4 flex items-center gap-2">
          <ChevronLeft className="h-4 w-4" />返回首頁
        </Button>
        <h1 className="sr-only">
          {seoIndustry ? `${seoIndustry}代工廠` : "台灣代工廠搜尋"}
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
                      { l: "代工廠", v: "factory" },
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
                    {[{ l: "ODM", v: "ODM" }, { l: "OEM", v: "OEM" }, { l: "全部", v: "" }].map(m => (
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
                          placeholder="您好，我正在尋找合適的代工廠，想詢問貴公司是否能承接以下需求，請協助提供報價、MOQ、交期與合作方式，謝謝。"
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
                    {[{ l: "全部", v: "all" }, { l: "代工廠", v: "factory" }, { l: "工作室", v: "studio" }].map(t => (
                      <Button key={t.v} size="sm" variant={businessType === t.v ? "default" : "outline"}
                        className="h-8 text-xs px-2"
                        onClick={() => onBusinessTypeChange(t.v)}>
                        {t.l}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    {[{ l: "ODM", v: "ODM" }, { l: "OEM", v: "OEM" }, { l: "全部", v: "" }].map(m => (
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
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                {isLoading ? "搜尋中..." : `共找到 ${data?.total ?? 0} 筆結果`}
              </p>
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
                placeholder="您好，我正在尋找合適的代工廠，想詢問貴公司是否能承接以下需求，請協助提供報價、MOQ、交期與合作方式，謝謝。"
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
