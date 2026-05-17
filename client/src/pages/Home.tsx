import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import FloatingAnnouncementButton from "@/components/FloatingAnnouncementButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { INDUSTRIES, INDUSTRY_OPTIONS, TAIWAN_REGIONS } from "@shared/constants";
import {
  Search, ArrowRight, Star, Shield, MessageCircle, Zap,
  Shirt, Wrench, Cpu, Box, TreePine, Package, UtensilsCrossed,
  Heart, Flower2, Lamp, Users, CheckCircle, Factory, Sparkles, Cog, Layers, ChevronDown,
  Megaphone, Newspaper, Pin, Instagram, Facebook, AtSign, Gauge,
  ChevronLeft, ChevronRight
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { allPosts } from "@/lib/blog";

const ANNOUNCEMENT_TYPE_CONFIG: Record<string, { label: string; className: string; Icon: any }> = {
  update:      { label: "版本更新", className: "bg-blue-100 text-blue-700",  Icon: Zap },
  maintenance: { label: "停機維護", className: "bg-red-100 text-red-700",   Icon: Wrench },
  news:        { label: "平台消息", className: "bg-green-100 text-green-700", Icon: Newspaper },
};

function AnnouncementsSection({ navigate }: { navigate: (path: string) => void }) {
  const { data: items = [] } = trpc.announcement.list.useQuery({ limit: 3 });
  if (items.length === 0) return null;
  return (
    <section id="announcements" className="py-12 bg-white border-t border-border/50">
      <div className="container max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-orange-500" />
            <h2 className="text-xl font-bold">平台公告</h2>
          </div>
          <button
            onClick={() => navigate("/announcements")}
            className="text-sm text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1"
          >
            查看全部 <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-3">
          {items.map(item => {
            const cfg = ANNOUNCEMENT_TYPE_CONFIG[item.type] ?? ANNOUNCEMENT_TYPE_CONFIG.news;
            const Icon = cfg.Icon;
            return (
              <div
                key={item.id}
                className={`flex items-start gap-4 p-4 rounded-xl border cursor-pointer hover:shadow-sm transition-shadow ${item.isPinned ? "border-orange-200 bg-orange-50/40" : "border-border bg-muted/20"}`}
                onClick={() => navigate("/announcements")}
              >
                <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${cfg.className}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {item.isPinned && <Pin className="w-3 h-3 text-orange-500 shrink-0" />}
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cfg.className}`}>{cfg.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-sm font-semibold truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{item.content}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const CAROUSEL_EXTS = [".jpg", ".png", ".jpeg", ".webp"] as const;

const carouselImages = [
  { id: "01", alt: "OXM 首頁輪播圖片 1" },
  { id: "02", alt: "OXM 首頁輪播圖片 2" },
  { id: "03", alt: "OXM 首頁輪播圖片 3" },
  { id: "04", alt: "OXM 首頁輪播圖片 4" },
  { id: "05", alt: "OXM 首頁輪播圖片 5" },
];

type ResolvedImage = { id: string; src: string; alt: string };

function HeroImageCarousel() {
  const [resolved, setResolved] = useState<ResolvedImage[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [slideKey, setSlideKey] = useState(0);
  const [slideDir, setSlideDir] = useState<"right" | "left">("right");

  // Pre-resolve every image's actual URL (no broken image ever shown)
  useEffect(() => {
    let cancelled = false;
    const tryLoad = (id: string, extIdx: number): Promise<string | null> =>
      new Promise(resolve => {
        if (extIdx >= CAROUSEL_EXTS.length) return resolve(null);
        const img = new window.Image();
        const src = `/marquee/${id}${CAROUSEL_EXTS[extIdx]}`;
        img.onload = () => resolve(src);
        img.onerror = () => tryLoad(id, extIdx + 1).then(resolve);
        img.src = src;
      });

    Promise.all(
      carouselImages.map(img =>
        tryLoad(img.id, 0).then(src => (src ? { ...img, src } : null))
      )
    ).then(results => {
      if (!cancelled)
        setResolved(results.filter((r): r is ResolvedImage => r !== null));
    });

    return () => { cancelled = true; };
  }, []);

  const total = resolved?.length ?? 0;

  // Auto-advance every 10 s; pauses on hover
  useEffect(() => {
    if (!resolved || total < 2 || paused) return;
    const timer = setInterval(() => {
      setSlideDir("right");
      setSlideKey(k => k + 1);
      setCurrent(c => (c + 1) % total);
    }, 10000);
    return () => clearInterval(timer);
  }, [resolved, total, paused]);

  const goTo = (idx: number, dir: "right" | "left" = "right") => {
    setSlideDir(dir);
    setSlideKey(k => k + 1);
    setCurrent(idx);
  };

  if (resolved === null || total === 0) return null;

  const img = resolved[current];

  return (
    <div className="max-w-5xl mx-auto mb-5 md:mb-8">
      {/* Main image frame */}
      <div
        className="relative overflow-hidden rounded-2xl md:rounded-3xl border border-border/40 shadow-lg bg-white/70"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="h-[170px] md:h-[260px] w-full">
          <img
            key={slideKey}
            src={img.src}
            alt={img.alt}
            className={`w-full h-full object-contain ${slideDir === "right" ? "carousel-slide-right" : "carousel-slide-left"}`}
          />
        </div>

        {/* Arrows */}
        {total > 1 && (
          <>
            <button
              onClick={() => goTo((current - 1 + total) % total, "left")}
              className="absolute left-2 md:left-3 top-1/2 -translate-y-1/2 w-8 h-8 md:w-10 md:h-10 rounded-full bg-white/60 hover:bg-white/90 flex items-center justify-center shadow-sm transition-colors z-10"
              aria-label="上一張"
            >
              <ChevronLeft className="w-4 h-4 md:w-5 md:h-5 text-foreground/70" />
            </button>
            <button
              onClick={() => goTo((current + 1) % total, "right")}
              className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 w-8 h-8 md:w-10 md:h-10 rounded-full bg-white/60 hover:bg-white/90 flex items-center justify-center shadow-sm transition-colors z-10"
              aria-label="下一張"
            >
              <ChevronRight className="w-4 h-4 md:w-5 md:h-5 text-foreground/70" />
            </button>
          </>
        )}
      </div>

      {/* Dot indicators */}
      {total > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-2.5">
          {resolved.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i, i > current ? "right" : "left")}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === current ? "w-5 bg-orange-500" : "w-1.5 bg-black/20 hover:bg-black/35"
              }`}
              aria-label={`切換到第 ${i + 1} 張`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const BUSINESS_TYPE_TABS = [
  { label: "工廠", value: "factory" },
  { label: "工作室", value: "studio" },
  { label: "我都要", value: "" },
];

const INDUSTRY_ICONS: Record<string, any> = {
  "紡織": Shirt, "金屬加工": Wrench, "電子零件": Cpu,
  "塑膠": Box, "橡膠 / 矽膠": Cog, "木工": TreePine, "包裝": Package,
  "食品": UtensilsCrossed, "化工製造": Heart, "生活用品": Lamp, "印刷": Layers,
  "工業設備／機械": Gauge,
};

const INDUSTRY_COLORS: Record<string, string> = {
  "紡織": "from-pink-500 to-rose-400", "金屬加工": "from-slate-500 to-zinc-400",
  "電子零件": "from-blue-500 to-cyan-400", "塑膠": "from-green-500 to-emerald-400",
  "橡膠 / 矽膠": "from-cyan-500 to-sky-400", "木工": "from-amber-600 to-yellow-500",
  "包裝": "from-purple-500 to-violet-400", "食品": "from-orange-500 to-amber-400",
  "化工製造": "from-teal-500 to-green-400", "生活用品": "from-indigo-500 to-blue-400",
  "印刷": "from-fuchsia-500 to-pink-400", "工業設備／機械": "from-gray-600 to-slate-500",
};

function MultiSelect({ options, value, onChange, placeholder, disabled, withClear }: {
  options: readonly string[];
  value: string[];
  onChange: (val: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  withClear?: boolean;
}) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  const label = value.length === 0 ? placeholder : value.join("、");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} className="h-10 md:h-12 w-full justify-between text-sm md:text-base font-normal truncate">
          <span className="truncate">{label}</span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-50 ml-1" />
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

export default function Home() {
  const [, navigate] = useLocation();
  const [activeMode, setActiveMode] = useState("");
  const [industry, setIndustry] = useState("");
  const [subIndustry, setSubIndustry] = useState<string[]>([]);
  const [region, setRegion] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [businessType, setBusinessType] = useState("");

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (activeMode && activeMode !== "all") params.set("mfgMode", activeMode);
    if (industry) params.set("industry", industry);
    subIndustry.forEach(s => params.append("subIndustry", s));
    region.forEach(r => params.append("region", r));
    if (keyword) params.set("keyword", keyword);
    if (businessType) params.set("businessType", businessType);
    navigate(`/search?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>OXM｜台灣傳統產業資源媒合平台｜工廠、設備與供應鏈服務</title>
        <meta name="description" content="OXM 整合台灣傳統產業商家與供應鏈資源，協助使用者快速找到工廠、OEM/ODM 代工、工業設備、材料、包裝印刷與產業服務，讓找廠商、找資源、送詢價更有效率。" />
      </Helmet>
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden py-8 md:py-24">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50 via-amber-50/50 to-purple-50/40" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-orange-200/30 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-gradient-to-tr from-purple-200/25 to-transparent rounded-full blur-3xl" />

        {/* 裝飾圖示 */}
        <div className="absolute top-12 left-8 opacity-10 hidden md:block">
          <Factory className="w-24 h-24 text-orange-500" />
        </div>
        <div className="absolute top-16 right-10 opacity-10 hidden md:block">
          <Wrench className="w-20 h-20 text-purple-500" />
        </div>
        <div className="absolute bottom-12 right-20 opacity-10 hidden md:block">
          <Cog className="w-16 h-16 text-orange-400" />
        </div>
        <div className="absolute bottom-16 left-20 opacity-10 hidden md:block">
          <Layers className="w-16 h-16 text-purple-400" />
        </div>

        <div className="container relative">
          {/* Hero Image Carousel */}
          <HeroImageCarousel />

          <div className="max-w-3xl mx-auto text-center mb-4 md:mb-10 relative">
            {/* 測試招募貼紙 — desktop */}
            <div className="hidden lg:block absolute top-14 right-0 rotate-[2deg] z-10 select-none pointer-events-none">
              <div className="relative bg-[#fdf9f2] border border-orange-200/80 rounded-2xl px-4 py-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.07)] w-[172px] text-left">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-10 h-3 rounded-sm bg-amber-200/60 shadow-sm" />
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                  <span className="text-[10px] font-bold text-orange-500 tracking-widest uppercase">Beta</span>
                </div>
                <p className="text-sm font-bold text-stone-800 leading-snug mb-2">第一階段測試招募中</p>
                <p className="text-[11px] text-stone-500 leading-relaxed">工廠與設計工作室免費上架</p>
                <p className="text-[11px] text-stone-400 mt-1">專注做好產品，曝光交給 OXM</p>
              </div>
            </div>

            <h1 className="sr-only">台灣傳統產業資源媒合平台</h1>
            <div className="inline-flex items-center gap-2 bg-gradient-to-r from-orange-100 to-purple-100 text-orange-700 px-3 py-1 rounded-full text-xs md:text-sm font-medium mb-3 md:mb-6">
              <Zap className="w-3 h-3 md:w-4 md:h-4" />
              台灣傳產資源媒合平台
            </div>
            <p className="text-3xl md:text-6xl font-extrabold text-foreground mb-3 md:mb-5 leading-tight tracking-tight">
              找到適合你的<br />
              <span className="bg-gradient-to-r from-orange-500 via-amber-500 to-purple-500 bg-clip-text text-transparent">台灣傳產資源</span>
            </p>

            {/* 測試招募貼紙 — mobile */}
            <div className="lg:hidden flex justify-center mb-2 select-none">
              <div className="relative bg-[#fdf9f2] border border-orange-200/80 rounded-xl px-4 py-2.5 shadow-sm rotate-[-1deg]">
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-8 h-2.5 rounded-sm bg-amber-200/60" />
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                  <span className="text-[10px] font-bold text-orange-500 tracking-widest uppercase">Beta</span>
                  <span className="text-xs font-bold text-stone-800">第一階段測試招募中</span>
                </div>
                <p className="text-[11px] text-stone-500 text-center leading-relaxed">
                  工廠與設計工作室免費上架・專注做好產品，曝光交給 OXM
                </p>
              </div>
            </div>

            <p className="text-xs md:text-xl text-muted-foreground mb-4 md:mb-8 max-w-xl mx-auto">
              整合全台工廠、OEM/ODM 代工、
              <span className="text-orange-500 font-semibold">設備商</span>
              、材料商與
              <span className="text-purple-500 font-semibold">產業服務</span>
              ，讓品牌、企業、採購者與一般使用者
              <br className="hidden md:block" />
              都能更快找到合適的合作對象
            </p>
          </div>

          {/* Mode Tabs + Search */}
          <div className="max-w-4xl mx-auto">
            <div className="grid grid-cols-3 gap-1.5 mb-2 md:mb-6 w-full">
              {[
                { label: "工廠", value: "factory", icon: <Factory className="w-4 h-4 shrink-0" /> },
                { label: "工作室", value: "studio", icon: <Wrench className="w-4 h-4 shrink-0" /> },
                { label: "我都要", value: "", icon: null },
              ].map((tab) => (
                <button
                  key={tab.value}
                  className={`flex items-center justify-center gap-1.5 px-2 py-2 sm:px-6 sm:py-3 rounded-lg sm:rounded-xl text-sm sm:text-base font-semibold transition-all whitespace-nowrap w-full ${
                    businessType === tab.value
                      ? tab.value === "factory"
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-200"
                        : tab.value === "studio"
                        ? "bg-gradient-to-r from-purple-500 to-violet-500 text-white shadow-lg shadow-purple-200"
                        : "bg-gradient-to-r from-amber-400 to-purple-500 text-white shadow-lg"
                      : "bg-white text-foreground border border-border hover:border-orange-300 hover:shadow-sm"
                  }`}
                  onClick={() => setBusinessType(tab.value)}
                >
                  {tab.icon}{tab.label}
                </button>
              ))}
            </div>

            <Card className="shadow-xl border-0 bg-white/80 backdrop-blur">
              <CardContent className="p-3 md:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4 mb-2 md:mb-4">
                  {/* 代工模式 */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-10 md:h-12 w-full justify-between text-sm md:text-base font-normal truncate">
                        <span className="truncate">
                          {activeMode === "" ? "代工模式" : activeMode === "ODM" ? "ODM 設計代工" : "OEM 製造代工"}
                        </span>
                        <ChevronDown className="w-4 h-4 shrink-0 opacity-50 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48 p-2" align="start">
                      {[{ label: "不限模式", value: "" }, { label: "ODM 設計代工", value: "ODM" }, { label: "OEM 製造代工", value: "OEM" }].map(opt => (
                        <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                          <Checkbox checked={activeMode === opt.value} onCheckedChange={() => setActiveMode(opt.value)} />
                          {opt.label}
                        </label>
                      ))}
                    </PopoverContent>
                  </Popover>

                  {/* 選擇產業 */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-10 md:h-12 w-full justify-between text-sm md:text-base font-normal truncate">
                        <span className="truncate flex items-center gap-2">
                          {industry ? (
                            <>
                              {(() => { const Icon = INDUSTRY_ICONS[industry] || Box; return <Icon className="w-4 h-4 shrink-0" />; })()}
                              {industry}
                            </>
                          ) : "選擇產業"}
                        </span>
                        <ChevronDown className="w-4 h-4 shrink-0 opacity-50 ml-1" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-2" align="start">
                      <div className="max-h-72 overflow-y-auto space-y-1">
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                          <Checkbox checked={industry === ""} onCheckedChange={() => { setIndustry(""); setSubIndustry([]); }} />
                          不限產業
                        </label>
                        {INDUSTRY_OPTIONS.map(opt => {
                          const Icon = INDUSTRY_ICONS[opt] || Box;
                          return (
                            <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                              <Checkbox checked={industry === opt} onCheckedChange={() => { setIndustry(opt); setSubIndustry([]); }} />
                              <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />{opt}
                            </label>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* 選擇子產業 */}
                  <MultiSelect
                    options={industry ? (INDUSTRIES.find(i => i.name === industry)?.sub as unknown as string[] ?? []) : []}
                    value={subIndustry}
                    onChange={setSubIndustry}
                    placeholder={industry ? "選擇子產業" : "請先選擇產業"}
                    disabled={!industry}
                  />

                  {/* 選擇地區 */}
                  <MultiSelect
                    options={TAIWAN_REGIONS}
                    value={region}
                    onChange={setRegion}
                    placeholder="選擇地區"
                    withClear
                  />
                </div>

                <div className="mb-2 md:mb-4">
                  <Input
                    className="w-full h-10 md:h-12 text-sm md:text-base"
                    placeholder="輸入關鍵字搜尋代工廠或工作室..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>

                <Button
                  className="w-full h-10 md:h-12 text-sm md:text-base font-semibold bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 shadow-lg shadow-orange-200/50"
                  onClick={handleSearch}
                >
                  <Search className="w-4 h-4 md:w-5 md:h-5 mr-2" />
                  搜尋代工廠 & 工作室
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* 代工廠 vs 工作室 介紹區（純展示，不可點擊）*/}
      <section className="py-5 md:py-16 bg-white">
        <div className="container">
          <div className="text-center mb-4 md:mb-10">
            <h2 className="text-xl md:text-3xl font-bold mb-2">
              <span className="text-orange-500">代工廠</span>
              <span className="text-muted-foreground mx-2">&</span>
              <span className="text-purple-500">工作室</span>
              ，一次找齊
            </h2>
            <p className="text-sm text-muted-foreground">不同需求，找到最合適的合作夥伴</p>
          </div>
          <div className="grid md:grid-cols-2 gap-3 md:gap-6 max-w-4xl mx-auto">
            {/* 代工廠 */}
            <Card className="border-2 border-orange-100 shadow-sm">
              <CardContent className="p-3 md:p-8">
                <div className="flex items-center gap-2 md:gap-4 mb-2 md:mb-4">
                  <div className="w-9 h-9 md:w-16 md:h-16 rounded-lg md:rounded-2xl bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center shadow-md shrink-0">
                    <Factory className="w-5 h-5 md:w-8 md:h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base md:text-xl font-bold text-orange-500">代工廠</h3>
                    <p className="text-xs md:text-sm text-muted-foreground">ODM / OEM 製造</p>
                  </div>
                </div>
                <p className="text-xs md:text-sm text-muted-foreground mb-2 md:mb-4 leading-normal md:leading-relaxed">
                  專業大規模生產，擁有完整設備與生產線。適合需要量產的品牌商，提供 ODM 設計代工與 OEM 純製造服務。
                </p>
                <ul className="space-y-1 md:space-y-2 text-xs md:text-sm">
                  {["大量生產，成本更低", "完整設備與品管流程", "ODM/OEM 彈性選擇"].map(item => (
                    <li key={item} className="flex items-center gap-1.5 md:gap-2 text-muted-foreground">
                      <CheckCircle className="w-3 h-3 md:w-4 md:h-4 text-orange-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* 工作室 */}
            <Card className="border-2 border-purple-100 shadow-sm">
              <CardContent className="p-3 md:p-8">
                <div className="flex items-center gap-2 md:gap-4 mb-2 md:mb-4">
                  <div className="w-9 h-9 md:w-16 md:h-16 rounded-lg md:rounded-2xl bg-gradient-to-br from-purple-500 to-violet-400 flex items-center justify-center shadow-md shrink-0">
                    <Wrench className="w-5 h-5 md:w-8 md:h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base md:text-xl font-bold text-purple-500">設計工作室</h3>
                    <p className="text-xs md:text-sm text-muted-foreground">少量訂製・創意設計</p>
                  </div>
                </div>
                <p className="text-xs md:text-sm text-muted-foreground mb-2 md:mb-4 leading-normal md:leading-relaxed">
                  靈活接受少量訂單與特殊訂製需求。適合個人創作者、新創品牌與設計師，提供打樣服務與個性化製作。
                </p>
                <ul className="space-y-1 md:space-y-2 text-xs md:text-sm">
                  {["少量接單，門檻低", "個性化訂製服務", "提供打樣與設計協助"].map(item => (
                    <li key={item} className="flex items-center gap-1.5 md:gap-2 text-muted-foreground">
                      <CheckCircle className="w-3 h-3 md:w-4 md:h-4 text-purple-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Industry Grid */}
      <section className="py-8 md:py-16 bg-gray-50">
        <div className="container">
          <div className="text-center mb-6 md:mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">熱門產業分類</h2>
            <p className="text-muted-foreground text-sm sm:text-base">涵蓋十大產業，快速找到您需要的合作夥伴</p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {INDUSTRY_OPTIONS.map((ind) => {
              const Icon = INDUSTRY_ICONS[ind] || Box;
              const colorClass = INDUSTRY_COLORS[ind] || "from-gray-500 to-gray-400";
              return (
                <Card
                  key={ind}
                  className="hover:shadow-lg transition-all cursor-pointer group border-0 shadow-sm hover:-translate-y-1"
                  onClick={() => navigate(`/search?industry=${encodeURIComponent(ind)}`)}
                >
                  <CardContent className="p-3 sm:p-5 text-center">
                    <div className={`w-10 h-10 sm:w-14 sm:h-14 mx-auto mb-2 sm:mb-3 rounded-xl sm:rounded-2xl bg-gradient-to-br ${colorClass} flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform`}>
                      <Icon className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                    </div>
                    <p className="font-semibold text-xs sm:text-sm leading-tight">{ind}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Stats - 橘紫漸層 */}
      <section className="py-5 md:py-12 bg-gradient-to-r from-orange-500 via-amber-400 to-purple-500 text-white">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 text-center">
            {[
              { icon: Factory, num: "500+", label: "代工廠" },
              { icon: Sparkles, num: "300+", label: "設計工作室" },
              { icon: Star, num: "4.8", label: "平均評分" },
              { icon: CheckCircle, num: "10+", label: "產業類別" },
            ].map(s => (
              <div key={s.label}>
                <s.icon className="w-6 h-6 md:w-8 md:h-8 mx-auto mb-1 md:mb-2 opacity-90" />
                <p className="text-2xl md:text-3xl font-extrabold">{s.num}</p>
                <p className="text-xs md:text-sm opacity-80">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-5 md:py-16 bg-white">
        <div className="container">
          <div className="text-center mb-4 md:mb-10">
            <h2 className="text-xl md:text-3xl font-bold mb-2">為什麼選擇 OXM？</h2>
            <p className="text-xs md:text-base text-muted-foreground">最完整的代工媒合服務，工廠與工作室都在這裡</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-6">
            {[
              { icon: Search, title: "精準搜尋", desc: "依產業、地區、資本額篩選，快速鎖定夥伴", color: "text-blue-500 bg-blue-50" },
              { icon: MessageCircle, title: "即時詢問", desc: "直接與業主線上溝通，即時取得報價", color: "text-green-500 bg-green-50" },
              { icon: Star, title: "評價系統", desc: "真實評分讓你選擇更有信心", color: "text-yellow-500 bg-yellow-50" },
              { icon: Shield, title: "資訊透明", desc: "規格、價格區間一目了然", color: "text-purple-500 bg-purple-50" },
            ].map((feat) => (
              <Card key={feat.title} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3 md:p-6 text-center">
                  <div className={`w-8 h-8 md:w-14 md:h-14 mx-auto mb-2 md:mb-4 rounded-lg md:rounded-2xl ${feat.color} flex items-center justify-center`}>
                    <feat.icon className="w-4 h-4 md:w-7 md:h-7" />
                  </div>
                  <h3 className="font-bold mb-1 text-xs md:text-lg">{feat.title}</h3>
                  <p className="text-xs md:text-sm text-muted-foreground leading-snug md:leading-relaxed">{feat.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* 找代工指南 */}
      <section id="guides" className="py-5 md:py-16 bg-gray-50">
        <div className="container">
          <div className="flex items-end justify-between mb-4 md:mb-8">
            <div>
              <h2 className="text-xl md:text-3xl font-bold mb-1">找代工指南</h2>
              <p className="text-xs md:text-base text-muted-foreground">第一次找 OEM / ODM 工廠？從這裡開始</p>
            </div>
            <Link href="/blog">
              <Button variant="ghost" className="text-orange-500 hover:text-orange-600 gap-1 hidden sm:flex">
                查看更多指南 <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-6">
            {allPosts.slice(0, 3).map((post) => (
              <Link key={post.slug} href={`/blog/${post.slug}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full border-0 shadow-sm">
                  <CardContent className="p-3 md:p-6">
                    <p className="text-xs text-muted-foreground mb-1">{post.date}</p>
                    <h3 className="font-bold text-sm md:text-base mb-1 leading-snug hover:text-orange-500 transition-colors">{post.title}</h3>
                    <p className="text-xs md:text-sm text-muted-foreground line-clamp-2 leading-normal md:leading-relaxed">{post.description}</p>
                    <div className="flex items-center gap-1 mt-2 md:mt-4 text-xs md:text-sm text-orange-500 font-medium">
                      閱讀全文 <ArrowRight className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <div className="text-center sm:hidden">
            <Link href="/blog">
              <Button variant="outline" size="sm" className="border-orange-300 text-orange-600 hover:bg-orange-50 gap-1">
                查看更多指南 <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-5 md:py-16 bg-white">
        <div className="container text-center">
          <h2 className="text-xl md:text-3xl font-bold mb-3">準備好開始了嗎？</h2>
          <p className="text-sm md:text-base text-muted-foreground mb-5 md:mb-8 max-w-lg mx-auto">
            不論你是尋找合作夥伴的品牌商，還是想要曝光的
            <span className="text-orange-500 font-medium">工廠</span>
            或
            <span className="text-purple-500 font-medium">工作室</span>
            業主，OXM 都是你最佳的選擇！
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 text-base px-8 shadow-lg"
              onClick={() => navigate("/search")}
            >
              <Search className="w-5 h-5 mr-2" />
              開始搜尋
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-base px-8 border-orange-300 text-orange-600 hover:bg-orange-50"
              onClick={() => navigate("/register-factory")}
            >
              <ArrowRight className="w-5 h-5 mr-2" />
              免費刊登工廠／工作室
            </Button>
          </div>
        </div>
      </section>

      {/* 平台公告 */}
      <AnnouncementsSection navigate={navigate} />

      <FloatingAnnouncementButton />

      {/* Footer */}
      <footer className="py-10 bg-gray-900 text-gray-400">
        <div className="container text-center text-sm space-y-6">
          {/* Brand */}
          <div>
            <div className="flex items-center justify-center gap-3 mb-2">
              <Factory className="w-5 h-5 text-orange-400" />
              <p className="font-bold text-white text-lg">OXM</p>
              <Wrench className="w-5 h-5 text-purple-400" />
            </div>
            <p>全台代工廠與設計工作室媒合平台</p>
          </div>

          {/* Social */}
          <div>
            <p className="text-xs text-gray-500 mb-3 uppercase tracking-widest">追蹤 OXM</p>
            <div className="flex items-center justify-center gap-5">
              <a href="https://www.instagram.com/oxmmatch_tw/?hl=zh-tw" target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-orange-400 transition-colors" aria-label="Instagram">
                <Instagram className="w-6 h-6" />
              </a>
              <a href="https://www.threads.com/@oxmmatch_tw" target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-purple-400 transition-colors" aria-label="Threads">
                <AtSign className="w-6 h-6" />
              </a>
              <a href="https://www.facebook.com/profile.php?id=61564590907055" target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-orange-400 transition-colors" aria-label="Facebook">
                <Facebook className="w-6 h-6" />
              </a>
              <a href="https://line.me/ti/p/@785bsmsr" target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-green-400 transition-colors" aria-label="LINE">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.105.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
              </a>
            </div>
          </div>

          {/* Contact */}
          <div>
            <p className="text-xs text-gray-500 mb-1">聯絡信箱</p>
            <p>scottsusu@oxmmatch.com</p>
          </div>

          {/* Legal links */}
          <div className="flex items-center justify-center gap-4 text-xs">
            <a href="/terms" className="hover:text-gray-300 transition-colors">服務條款</a>
            <span className="text-gray-700">·</span>
            <a href="/privacy" className="hover:text-gray-300 transition-colors">隱私政策</a>
            <span className="text-gray-700">·</span>
            <a href="/terms#account-deletion" className="hover:text-gray-300 transition-colors">帳號刪除</a>
          </div>

          {/* Copyright */}
          <p className="text-xs text-gray-600">&copy; {new Date().getFullYear()} OXM. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}