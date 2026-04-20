import Navbar from "@/components/Navbar";
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
  Megaphone, Newspaper, Pin
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";

const ANNOUNCEMENT_TYPE_CONFIG: Record<string, { label: string; className: string; Icon: any }> = {
  update:      { label: "版本更新", className: "bg-blue-100 text-blue-700",  Icon: Zap },
  maintenance: { label: "停機維護", className: "bg-red-100 text-red-700",   Icon: Wrench },
  news:        { label: "平台消息", className: "bg-green-100 text-green-700", Icon: Newspaper },
};

function AnnouncementsSection({ navigate }: { navigate: (path: string) => void }) {
  const { data: items = [] } = trpc.announcement.list.useQuery({ limit: 3 });
  if (items.length === 0) return null;
  return (
    <section className="py-12 bg-white border-t border-border/50">
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

const BUSINESS_TYPE_TABS = [
  { label: "工廠", value: "factory" },
  { label: "工作室", value: "studio" },
  { label: "我都要", value: "" },
];

const INDUSTRY_ICONS: Record<string, any> = {
  "紡織": Shirt, "金屬加工": Wrench, "電子零件": Cpu,
  "塑膠 / 橡膠": Box, "木工": TreePine, "包裝": Package,
  "食品": UtensilsCrossed, "化工製造": Heart, "生活用品": Lamp, "印刷": Layers,
};

const INDUSTRY_COLORS: Record<string, string> = {
  "紡織": "from-pink-500 to-rose-400", "金屬加工": "from-slate-500 to-zinc-400",
  "電子零件": "from-blue-500 to-cyan-400", "塑膠 / 橡膠": "from-green-500 to-emerald-400",
  "木工": "from-amber-600 to-yellow-500", "包裝": "from-purple-500 to-violet-400",
  "食品": "from-orange-500 to-amber-400", "化工製造": "from-teal-500 to-green-400",
  "生活用品": "from-indigo-500 to-blue-400", "印刷": "from-fuchsia-500 to-pink-400",
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
        <Button variant="outline" disabled={disabled} className="h-12 w-full justify-between text-base font-normal truncate">
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
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden py-16 md:py-24">
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
          <div className="max-w-3xl mx-auto text-center mb-10">
            <div className="inline-flex items-center gap-2 bg-gradient-to-r from-orange-100 to-purple-100 text-orange-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
              <Zap className="w-4 h-4" />
              全台最大代工媒合平台
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold text-foreground mb-5 leading-tight tracking-tight">
              用最低價格<br />
              找到<span className="bg-gradient-to-r from-orange-500 via-amber-500 to-purple-500 bg-clip-text text-transparent">最優質夥伴</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-xl mx-auto">
              一鍵搜尋全台
              <span className="text-orange-500 font-semibold">代工廠</span>
              與
              <span className="text-purple-500 font-semibold">設計工作室</span>
              ，直接聯繫、即時報價、安心合作。
            </p>
          </div>

          {/* Mode Tabs + Search */}
          <div className="max-w-4xl mx-auto">
            <div className="flex justify-center gap-3 mb-6">
 {[
  { label: "工廠", value: "factory", icon: <Factory className="w-4 h-4" /> },
  { label: "工作室", value: "studio", icon: <Wrench className="w-4 h-4" /> },
  { label: "我都要", value: "", icon: null },
].map((tab) => (
  <button
    key={tab.value}
    className={`flex items-center gap-2 px-6 py-3 rounded-xl text-base font-semibold transition-all ${
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
              <CardContent className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  {/* 代工模式 */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="h-12 w-full justify-between text-base font-normal truncate">
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
                      <Button variant="outline" className="h-12 w-full justify-between text-base font-normal truncate">
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

                <div className="mb-4">
                  <Input
                    className="w-full h-12 text-base"
                    placeholder="輸入關鍵字搜尋代工廠或工作室..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>

                <Button
                  className="w-full h-12 text-base font-semibold bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 shadow-lg shadow-orange-200/50"
                  size="lg"
                  onClick={handleSearch}
                >
                  <Search className="w-5 h-5 mr-2" />
                  搜尋代工廠 & 工作室
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* 代工廠 vs 工作室 介紹區（純展示，不可點擊）*/}
      <section className="py-16 bg-white">
        <div className="container">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">
              <span className="text-orange-500">代工廠</span>
              <span className="text-muted-foreground mx-2">&</span>
              <span className="text-purple-500">工作室</span>
              ，一次找齊
            </h2>
            <p className="text-muted-foreground">不同需求，找到最合適的合作夥伴</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* 代工廠 */}
            <Card className="border-2 border-orange-100 shadow-sm">
              <CardContent className="p-8">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-400 flex items-center justify-center shadow-lg">
                    <Factory className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-orange-500">代工廠</h3>
                    <p className="text-sm text-muted-foreground">ODM / OEM 製造</p>
                  </div>
                </div>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  專業大規模生產，擁有完整設備與生產線。適合需要量產的品牌商與電商賣家，提供 ODM 設計代工與 OEM 純製造服務。
                </p>
                <ul className="space-y-2 text-sm">
                  {["大量生產，成本更低", "完整設備與品管流程", "ODM/OEM 彈性選擇"].map(item => (
                    <li key={item} className="flex items-center gap-2 text-muted-foreground">
                      <CheckCircle className="w-4 h-4 text-orange-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* 工作室 */}
            <Card className="border-2 border-purple-100 shadow-sm">
              <CardContent className="p-8">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-400 flex items-center justify-center shadow-lg">
                    <Wrench className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-purple-500">設計工作室</h3>
                    <p className="text-sm text-muted-foreground">少量訂製・創意設計</p>
                  </div>
                </div>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  靈活接受少量訂單與特殊訂製需求。適合個人創作者、新創品牌與設計師，提供打樣服務與個性化製作。
                </p>
                <ul className="space-y-2 text-sm">
                  {["少量接單，門檻低", "個性化訂製服務", "提供打樣與設計協助"].map(item => (
                    <li key={item} className="flex items-center gap-2 text-muted-foreground">
                      <CheckCircle className="w-4 h-4 text-purple-500 shrink-0" />
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
      <section className="py-16 bg-gray-50">
        <div className="container">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">熱門產業分類</h2>
            <p className="text-muted-foreground">涵蓋十大產業，快速找到您需要的合作夥伴</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {INDUSTRY_OPTIONS.map((ind) => {
              const Icon = INDUSTRY_ICONS[ind] || Box;
              const colorClass = INDUSTRY_COLORS[ind] || "from-gray-500 to-gray-400";
              return (
                <Card
                  key={ind}
                  className="hover:shadow-lg transition-all cursor-pointer group border-0 shadow-sm hover:-translate-y-1"
                  onClick={() => navigate(`/search?industry=${encodeURIComponent(ind)}`)}
                >
                  <CardContent className="p-5 text-center">
                    <div className={`w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br ${colorClass} flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform`}>
                      <Icon className="w-7 h-7 text-white" />
                    </div>
                    <p className="font-semibold text-sm">{ind}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Stats - 橘紫漸層 */}
      <section className="py-12 bg-gradient-to-r from-orange-500 via-amber-400 to-purple-500 text-white">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { icon: Factory, num: "500+", label: "代工廠" },
              { icon: Sparkles, num: "300+", label: "設計工作室" },
              { icon: Star, num: "4.8", label: "平均評分" },
              { icon: CheckCircle, num: "10", label: "產業類別" },
            ].map(s => (
              <div key={s.label}>
                <s.icon className="w-8 h-8 mx-auto mb-2 opacity-90" />
                <p className="text-3xl font-extrabold">{s.num}</p>
                <p className="text-sm opacity-80">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 bg-white">
        <div className="container">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3">為什麼選擇 OXM？</h2>
            <p className="text-muted-foreground">最完整的代工媒合服務，工廠與工作室都在這裡</p>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              { icon: Search, title: "精準搜尋", desc: "依產業、地區、資本額等多維度篩選，快速鎖定目標夥伴", color: "text-blue-500 bg-blue-50" },
              { icon: MessageCircle, title: "即時詢問", desc: "直接與工廠或工作室業主線上溝通，即時取得報價", color: "text-green-500 bg-green-50" },
              { icon: Star, title: "評價系統", desc: "真實客戶回饋與星等評分，讓你選擇更有信心", color: "text-yellow-500 bg-yellow-50" },
              { icon: Shield, title: "資訊透明", desc: "完整資料、產品規格、價格區間一目了然", color: "text-purple-500 bg-purple-50" },
            ].map((feat) => (
              <Card key={feat.title} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6 text-center">
                  <div className={`w-14 h-14 mx-auto mb-4 rounded-2xl ${feat.color} flex items-center justify-center`}>
                    <feat.icon className="w-7 h-7" />
                  </div>
                  <h3 className="font-bold mb-2 text-lg">{feat.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-gray-50">
        <div className="container text-center">
          <h2 className="text-3xl font-bold mb-4">準備好開始了嗎？</h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
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

      {/* Footer */}
      <footer className="py-8 bg-gray-900 text-gray-400">
        <div className="container text-center text-sm">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Factory className="w-5 h-5 text-orange-400" />
            <p className="font-bold text-white text-lg">OXM</p>
            <Wrench className="w-5 h-5 text-purple-400" />
          </div>
          <p>全台代工廠與設計工作室媒合平台</p>
          <p className="mt-2">&copy; {new Date().getFullYear()} OXM. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}