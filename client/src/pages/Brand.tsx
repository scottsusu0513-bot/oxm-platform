import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import { ArrowRight, BadgeCheck, Camera, Clapperboard, Sparkles } from "lucide-react";

// 找形象正式服務入口：目前先開放兩項——短影音與品牌內容行銷（沿用既有
// /short-video-marketing route，本輪只是改變上層分類，不動 route／申請流程／
// 後台）與工廠形象攝影（/factory-photography，本輪新建的服務介紹頁）。
// 兩者本身都還維持既有 noindex（見 server/_core/security.ts），/brand 頁面
// 本身也維持 noindex,follow，等下一輪人工確認 UI 後再一併正式開放索引。
const BRAND_SERVICES = [
  {
    index: "01",
    title: "短影音與品牌內容行銷",
    description: "將製程、產品與企業專業轉化為容易理解的影音內容，應用於社群、品牌曝光與企業形象溝通。",
    tags: ["短影音", "品牌內容", "社群行銷"],
    cta: "了解短影音服務",
    href: "/short-video-marketing",
    Icon: Clapperboard,
    tone: {
      border: "border-orange-200",
      surface: "from-orange-50 via-white to-rose-50",
      icon: "bg-orange-500 text-white",
      accent: "text-orange-700",
      glow: "bg-orange-300/40",
    },
  },
  {
    index: "02",
    title: "工廠形象攝影",
    description: "以專業商業攝影呈現工廠環境、設備、製程、產品與團隊，建立可應用於官網、型錄與品牌宣傳的企業視覺素材。",
    tags: ["工廠攝影", "商業攝影", "企業形象"],
    cta: "了解攝影服務",
    href: "/factory-photography",
    Icon: Camera,
    tone: {
      border: "border-amber-200",
      surface: "from-amber-50 via-white to-orange-50",
      icon: "bg-amber-500 text-white",
      accent: "text-amber-700",
      glow: "bg-amber-300/40",
    },
  },
] as const;

export default function Brand() {
  useRemoveServerSeoHead();

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{PUBLIC_PAGE_SEO.brand.title}</title>
        <meta name="description" content={PUBLIC_PAGE_SEO.brand.description} />
        <link rel="canonical" href={PUBLIC_PAGE_SEO.brand.canonical} />
        <meta name="robots" content="noindex,follow" />
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/" label="返回" />

      <section className="relative overflow-hidden border-b border-amber-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 px-4 py-14 sm:py-20">
        <div className="absolute -left-28 top-20 h-80 w-80 rounded-full bg-orange-200/40 blur-3xl" aria-hidden="true" />
        <div className="absolute -right-28 -top-16 h-96 w-96 rounded-full bg-amber-200/40 blur-3xl" aria-hidden="true" />
        <div className="container relative max-w-5xl">
          <div className="mb-7 flex items-center gap-2 text-xs text-slate-500">
            <Link href="/" className="hover:text-orange-700">首頁</Link><span>/</span><span>找形象</span>
          </div>
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-100 bg-white/80 px-3 py-1.5 text-xs font-semibold tracking-[0.14em] text-orange-700 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />找形象
          </span>
          <h1 className="mb-6 max-w-2xl text-4xl font-black leading-[1.12] tracking-tight text-slate-950 sm:text-5xl">
            讓專業被看見，建立企業品牌形象
          </h1>
          <p className="mb-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
            從工廠形象攝影到短影音內容製作，協助傳統產業將設備、製程、產品與專業能力，轉化成客戶看得懂、願意認識的品牌內容。
          </p>
          <div className="flex flex-wrap gap-2">
            {["工廠形象攝影", "短影音與品牌內容"].map(label => (
              <span key={label} className="rounded-full border border-white bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
                <BadgeCheck className="mr-1.5 inline h-3.5 w-3.5 text-orange-600" />{label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:py-20">
        <div className="container max-w-5xl">
          <div className="mb-10">
            <span className="mb-3 block text-xs font-bold tracking-[0.16em] text-orange-700">SERVICES</span>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">目前提供兩項服務</h2>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            {BRAND_SERVICES.map(service => {
              const Icon = service.Icon;
              return (
                <article key={service.href} className={`group relative overflow-hidden rounded-[2rem] border bg-gradient-to-br p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:p-8 ${service.tone.border} ${service.tone.surface}`}>
                  <div className={`absolute -right-12 -top-12 h-40 w-40 rounded-full blur-3xl ${service.tone.glow}`} aria-hidden="true" />
                  <div className="relative mb-6 flex items-start justify-between gap-4">
                    <span className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg ${service.tone.icon}`}><Icon className="h-6 w-6" /></span>
                    <span className="text-4xl font-black text-slate-900/[0.06]">{service.index}</span>
                  </div>
                  <div className="relative">
                    <h3 className="mb-3 text-xl font-bold text-slate-900 sm:text-2xl">{service.title}</h3>
                    <p className="mb-5 text-sm leading-relaxed text-slate-600">{service.description}</p>
                    <div className="mb-6 flex flex-wrap gap-2">
                      {service.tags.map(tag => (
                        <span key={tag} className="rounded-full border border-white bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm">{tag}</span>
                      ))}
                    </div>
                    <Link href={service.href} className={`inline-flex items-center gap-2 text-sm font-bold ${service.tone.accent}`}>
                      {service.cta}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
