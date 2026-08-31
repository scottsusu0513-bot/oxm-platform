import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import { RESOURCES_CONTENT } from "@shared/content/resources";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Clapperboard,
  Clock,
  Compass,
  Factory,
  FileCheck2,
  Lightbulb,
  Network,
  Route,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

type ResourceCategory = "all" | "funding" | "operations" | "brand";

type ResourceService = {
  title: string;
  subtitle: string;
  description: string;
  href: string;
  /** 目前是否已正式開放並可點擊進入；false 時卡片顯示「敬請期待」，不可互動。
   *  對應的 route／component 仍完整保留，已知網址的人可以直接輸入進入。 */
  available: boolean;
  category: Exclude<ResourceCategory, "all">;
  icon: typeof Lightbulb;
  tags: string[];
  tone: {
    border: string;
    surface: string;
    icon: string;
    accent: string;
    glow: string;
  };
};

const CATEGORY_OPTIONS: { key: ResourceCategory; label: string; description: string }[] = [
  { key: "all", label: "全部服務", description: "查看所有資源" },
  { key: "funding", label: "資金與補助", description: "補助申請、財務體質" },
  { key: "operations", label: "營運與制度", description: "認證、系統、產線" },
  { key: "brand", label: "品牌與市場", description: "內容、曝光、行銷" },
];

// UI-only（分類 key／icon／配色）依 RESOURCES_CONTENT.services 相同順序對應，
// 可見文字（title/subtitle/description/tags/href/available）皆來自共用內容
// 檔，避免與 prerender 腳本各自維護兩份文案。
const RESOURCE_SERVICE_UI: { category: Exclude<ResourceCategory, "all">; icon: typeof Lightbulb; tone: ResourceService["tone"] }[] = [
  {
    category: "funding",
    icon: Lightbulb,
    tone: {
      border: "border-amber-200",
      surface: "from-amber-50 via-white to-orange-50",
      icon: "bg-amber-500 text-white",
      accent: "text-amber-700",
      glow: "bg-amber-300/40",
    },
  },
  {
    category: "funding",
    icon: BarChart3,
    tone: {
      border: "border-blue-200",
      surface: "from-blue-50 via-white to-indigo-50",
      icon: "bg-blue-600 text-white",
      accent: "text-blue-700",
      glow: "bg-blue-300/40",
    },
  },
  {
    category: "operations",
    icon: ShieldCheck,
    tone: {
      border: "border-emerald-200",
      surface: "from-emerald-50 via-white to-teal-50",
      icon: "bg-emerald-600 text-white",
      accent: "text-emerald-700",
      glow: "bg-emerald-300/40",
    },
  },
  {
    category: "operations",
    icon: Factory,
    tone: {
      border: "border-violet-200",
      surface: "from-violet-50 via-white to-purple-50",
      icon: "bg-violet-600 text-white",
      accent: "text-violet-700",
      glow: "bg-violet-300/40",
    },
  },
  {
    category: "brand",
    icon: Clapperboard,
    tone: {
      border: "border-rose-200",
      surface: "from-rose-50 via-white to-orange-50",
      icon: "bg-rose-500 text-white",
      accent: "text-rose-700",
      glow: "bg-rose-300/40",
    },
  },
];

const RESOURCE_SERVICES: ResourceService[] = RESOURCES_CONTENT.services.map((service, index) => ({
  ...service,
  ...RESOURCE_SERVICE_UI[index],
}));

function ResourceCompassArtwork() {
  const nodes = [
    { icon: Banknote, label: "資金", className: "left-1 top-3 text-amber-700" },
    { icon: FileCheck2, label: "認證", className: "right-1 top-5 text-emerald-700" },
    { icon: Route, label: "流程", className: "left-4 bottom-4 text-violet-700" },
    { icon: TrendingUp, label: "市場", className: "right-3 bottom-3 text-rose-700" },
  ];

  return (
    <div className="relative min-h-[24rem] overflow-hidden rounded-[2rem] border border-white/90 bg-white/75 shadow-[0_35px_90px_-45px_rgba(88,28,135,0.55)] backdrop-blur-xl" aria-hidden="true">
      <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: "radial-gradient(circle, #7c3aed 1px, transparent 1.4px)", backgroundSize: "20px 20px" }} />
      <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-purple-200" />
      <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-orange-300" />
      <svg viewBox="0 0 460 360" className="absolute inset-0 h-full w-full" fill="none">
        <path d="M230 180L84 67M230 180L373 75M230 180L91 292M230 180L375 289" stroke="#c4b5fd" strokeWidth="2.5" strokeDasharray="7 9" />
      </svg>
      {nodes.map(item => {
        const Icon = item.icon;
        return (
          <div key={item.label} className={`absolute flex w-24 flex-col items-center gap-1 rounded-2xl border border-white bg-white/95 p-3 text-center shadow-lg ${item.className}`}>
            <Icon className="h-6 w-6" /><span className="text-xs font-bold">{item.label}</span>
          </div>
        );
      })}
      <div className="absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-[2.25rem] bg-gradient-to-br from-orange-500 via-fuchsia-500 to-purple-700 text-white shadow-2xl shadow-purple-500/30 ring-8 ring-white/80">
        <Compass className="mb-2 h-10 w-10" /><span className="text-sm font-black">找資源</span>
      </div>
    </div>
  );
}

export default function ResourceCenter() {
  useRemoveServerSeoHead();
  const [activeCategory, setActiveCategory] = useState<ResourceCategory>("all");
  const visibleServices = useMemo(
    () => activeCategory === "all" ? RESOURCE_SERVICES : RESOURCE_SERVICES.filter(service => service.category === activeCategory),
    [activeCategory],
  );

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{PUBLIC_PAGE_SEO.resources.title}</title>
        <meta name="description" content={PUBLIC_PAGE_SEO.resources.description} />
        <link rel="canonical" href={PUBLIC_PAGE_SEO.resources.canonical} />
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/" label="返回" />

      <section className="relative overflow-hidden border-b border-purple-100 bg-gradient-to-br from-blue-50 via-white to-purple-50 px-4 py-14 sm:py-20">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(#7c3aed 1px, transparent 1px), linear-gradient(90deg, #7c3aed 1px, transparent 1px)", backgroundSize: "64px 64px" }} aria-hidden="true" />
        <div className="absolute -left-28 top-20 h-80 w-80 rounded-full bg-blue-200/50 blur-3xl" aria-hidden="true" />
        <div className="absolute -right-28 -top-16 h-96 w-96 rounded-full bg-purple-200/50 blur-3xl" aria-hidden="true" />
        <div className="container relative max-w-6xl">
          <div className="grid items-center gap-12 lg:grid-cols-[0.94fr_1.06fr] lg:gap-16">
            <div>
              <div className="mb-7 flex items-center gap-2 text-xs text-slate-500"><Link href="/" className="hover:text-purple-700">首頁</Link><span>/</span><span>找資源</span></div>
              <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-purple-100 bg-white/80 px-3 py-1.5 text-xs font-semibold tracking-[0.14em] text-purple-700 shadow-sm"><Sparkles className="h-3.5 w-3.5 text-orange-500" />RESOURCE CENTER</span>
              <h1 className="mb-6 text-4xl font-black leading-[1.12] tracking-tight text-slate-950 sm:text-5xl lg:text-[3.55rem]">先找到問題，<br className="hidden sm:block" />再選擇適合的資源</h1>
              <p className="mb-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">{RESOURCES_CONTENT.heroIntro}</p>
              <div className="flex flex-wrap gap-2">
                {["資金與補助", "營運與制度", "品牌與市場"].map(label => <span key={label} className="rounded-full border border-white bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm"><BadgeCheck className="mr-1.5 inline h-3.5 w-3.5 text-purple-600" />{label}</span>)}
              </div>
            </div>
            <ResourceCompassArtwork />
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:py-20">
        <div className="container max-w-6xl">
          <div className="mb-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <span className="mb-3 block text-xs font-bold tracking-[0.16em] text-purple-700">CHOOSE A DIRECTION</span>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">你現在最想解決哪一類問題？</h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-slate-500">先用分類縮小範圍，再進入服務介紹頁了解內容、流程與申請方式。</p>
          </div>

          <div className="mb-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="tablist" aria-label="資源服務分類">
            {CATEGORY_OPTIONS.map(option => {
              const active = activeCategory === option.key;
              return (
                <button key={option.key} type="button" role="tab" aria-selected={active} onClick={() => setActiveCategory(option.key)} className={`rounded-2xl border p-4 text-left transition-all ${active ? "border-purple-500 bg-purple-600 text-white shadow-lg shadow-purple-500/20" : "border-slate-200 bg-white text-slate-700 hover:border-purple-200 hover:bg-purple-50/50"}`}>
                  <span className="block text-sm font-bold">{option.label}</span><span className={`mt-1 block text-xs ${active ? "text-purple-100" : "text-slate-400"}`}>{option.description}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {visibleServices.map((service, index) => {
              const Icon = service.icon;
              return (
                <article key={service.title} className={`group relative overflow-hidden rounded-[2rem] border bg-gradient-to-br p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:p-8 ${visibleServices.length % 2 === 1 && index === visibleServices.length - 1 ? "lg:col-span-2" : ""} ${service.tone.border} ${service.tone.surface}`}>
                  <div className={`absolute -right-12 -top-12 h-40 w-40 rounded-full blur-3xl ${service.tone.glow}`} aria-hidden="true" />
                  <div className="relative mb-6 flex items-start justify-between gap-4">
                    <span className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg ${service.tone.icon}`}><Icon className="h-6 w-6" /></span>
                    <span className="text-4xl font-black text-slate-900/[0.06]">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="relative">
                    <p className={`mb-2 text-xs font-bold tracking-[0.1em] ${service.tone.accent}`}>{service.subtitle}</p>
                    <h3 className="mb-3 text-xl font-bold text-slate-900 sm:text-2xl">{service.title}</h3>
                    <p className="mb-5 text-sm leading-relaxed text-slate-600">{service.description}</p>
                    <div className="mb-6 flex flex-wrap gap-2">{service.tags.map(tag => <span key={tag} className="rounded-full border border-white bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">{tag}</span>)}</div>
                    {service.available ? (
                      <Link href={service.href} className={`inline-flex items-center gap-2 text-sm font-bold ${service.tone.accent}`}>查看服務內容<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></Link>
                    ) : (
                      <span aria-disabled="true" className="inline-flex cursor-not-allowed items-center gap-2 text-sm font-bold text-slate-400">
                        <Clock className="h-4 w-4" />敬請期待
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-100 bg-slate-950 px-4 py-14 text-white">
        <div className="container max-w-5xl">
          <div className="grid items-center gap-8 rounded-[2rem] border border-white/10 bg-white/5 p-7 sm:p-9 lg:grid-cols-[auto_1fr]">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-purple-600 shadow-lg shadow-purple-950/50"><Network className="h-7 w-7" /></span>
            <div><h2 className="mb-2 text-xl font-bold sm:text-2xl">每一項服務，都先從理解企業現況開始</h2><p className="text-sm leading-relaxed text-slate-300">各服務的實際範圍、資格與執行方式，仍會依企業需求與初步評估結果確認。</p></div>
          </div>
        </div>
      </section>
    </div>
  );
}
