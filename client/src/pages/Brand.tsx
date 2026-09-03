import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import { ArrowRight, Camera, Clapperboard, Clock, Scan, Video } from "lucide-react";

const BRAND_HEADLINE = "讓專業被看見，建立企業品牌形象";

// 找形象正式服務入口：短影音與品牌內容行銷已正式提供（沿用既有
// /short-video-marketing route，不動 route／申請流程／後台），工廠形象攝影
// （/factory-photography，本輪新建的服務介紹頁）則尚未正式開放——卡片保留
// 呈現，讓使用者知道找形象未來會有動態影像＋平面攝影兩種服務，但 CTA 改為
// 非互動的「即將開放」狀態，不得再導向 /factory-photography（見
// server/_core/security.ts 的 NOINDEX_FOLLOW_EXACT_PATHS，該頁維持
// noindex，也刻意不再從 /brand 提供公開連結入口）。available: false 時
// 沿用 client/src/pages/ResourceCenter.tsx 已驗收的「敬請期待」pattern：
// 非 <a>、無 href、aria-disabled，鍵盤不會 focus 到一個實際不能操作的假連結。
// /brand 頁面本身仍維持既有 noindex,follow，索引狀態留待下一輪統一處理。
const BRAND_SERVICES = [
  {
    index: "01",
    title: "短影音與品牌內容行銷",
    description: "將製程、產品與企業專業轉化為容易理解的影音內容，應用於社群、品牌曝光與企業形象溝通。",
    tags: ["短影音", "品牌內容", "社群行銷"],
    cta: "了解短影音服務",
    href: "/short-video-marketing",
    available: true,
    kind: "motion",
    medium: "動態影像",
    label: "MOTION",
    Icon: Clapperboard,
    tone: {
      border: "border-orange-200/80 hover:border-orange-300",
      surface: "from-orange-50 to-amber-50/40",
      accent: "text-orange-700",
      cta: "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100 focus-visible:ring-orange-600",
    },
  },
  {
    index: "02",
    title: "工廠形象攝影",
    description: "以專業商業攝影呈現工廠環境、設備、製程、產品與團隊，建立可應用於官網、型錄與品牌宣傳的企業視覺素材。",
    tags: ["工廠攝影", "商業攝影", "企業形象"],
    cta: "了解攝影服務",
    href: "/factory-photography",
    available: false,
    kind: "still",
    medium: "平面影像",
    label: "STILL",
    Icon: Camera,
    tone: {
      border: "border-purple-200/80 hover:border-purple-300",
      surface: "from-purple-50 to-slate-50",
      accent: "text-purple-700",
      cta: "border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100 focus-visible:ring-purple-600",
    },
  },
] as const;

// Brand-only orange/purple illustrations. The reserved frame keeps layout
// stable while the small transparent WebP assets load.
function ServiceArtwork({ kind }: { kind: "motion" | "still" }) {
  return (
    <div className="aspect-[16/7] w-full" aria-hidden="true">
      <img
        src={kind === "motion"
          ? "/images/brand/motion-oxm-v2.webp"
          : "/images/brand/photography-oxm-v2.webp"}
        alt=""
        width={840}
        height={560}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
      />
    </div>
  );
}

function BrandHeroArtwork() {
  return (
    <div className="pointer-events-none hidden aspect-[4/3] w-full items-center lg:flex" aria-hidden="true">
      <img
        src="/images/brand/hero-oxm-v2.webp"
        alt=""
        width={840}
        height={560}
        decoding="async"
        className="h-full w-full object-contain"
      />
    </div>
  );
}

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

      <main>
        <section aria-labelledby="brand-heading" className="relative isolate overflow-hidden border-b border-orange-100/80 bg-gradient-to-br from-orange-50/80 via-white to-purple-50/70">
          <div className="pointer-events-none absolute -left-32 -top-40 -z-10 h-96 w-96 rounded-full bg-orange-100/70 blur-3xl" aria-hidden="true" />
          <div className="mx-auto max-w-6xl px-6 pb-10 pt-14 sm:px-8 sm:pb-12 sm:pt-12 lg:px-12">
            <nav aria-label="麵包屑" className="mb-7 flex items-center gap-2 text-xs text-slate-600">
              <Link href="/" className="rounded-sm hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-4">首頁</Link>
              <span aria-hidden="true">/</span><span aria-current="page">找形象</span>
            </nav>
            <div className="grid items-center gap-8 lg:grid-cols-[1.65fr_1fr] lg:gap-10">
              <div>
                <span className="mb-4 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-orange-800">
                  <Scan className="h-4 w-4" aria-hidden="true" />找形象
                  <span className="ml-1 h-3 w-px bg-orange-200" aria-hidden="true" />
                  <span className="tracking-wider text-slate-600">OXM 品牌視覺服務</span>
                </span>
                <h1 id="brand-heading" aria-label={BRAND_HEADLINE} className="mb-5 text-[2rem] font-black leading-[1.35] tracking-tight text-slate-950 sm:text-[2.75rem] lg:text-5xl">
                  {BRAND_HEADLINE.split("，").map((line, index) => (
                    <span key={line} className="block">{line}{index === 0 ? "，" : ""}</span>
                  ))}
                </h1>
                <p className="max-w-xl text-pretty text-sm leading-7 text-slate-600 sm:text-base sm:leading-8">
                  從工廠形象攝影到短影音內容製作，協助傳統產業將設備、製程、產品與專業能力，轉化成客戶看得懂、願意認識的品牌內容。
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3 text-xs font-medium sm:gap-4">
                  <span className="inline-flex items-center gap-2 text-orange-800"><Video className="h-4 w-4" aria-hidden="true" />動態影像</span>
                  <span className="text-slate-400" aria-hidden="true">×</span>
                  <span className="inline-flex items-center gap-2 text-purple-800"><Camera className="h-4 w-4" aria-hidden="true" />平面影像</span>
                </div>
              </div>
              <BrandHeroArtwork />
            </div>
          </div>
        </section>

        <section aria-labelledby="brand-services-heading" className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-12 lg:px-12">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-7">
            <div>
              <span className="mb-2 block text-[11px] font-bold tracking-[0.18em] text-orange-700">SERVICES</span>
              <h2 id="brand-services-heading" className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">目前提供兩項服務</h2>
            </div>
            <p className="text-sm leading-6 text-slate-500">用不同的影像語言，呈現同樣的專業。</p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {BRAND_SERVICES.map(service => {
              const Icon = service.Icon;
              return (
                <article key={service.href} className={`group flex min-w-0 flex-col overflow-hidden rounded-[2rem] border bg-white shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:shadow-lg motion-safe:hover:-translate-y-1 motion-reduce:transition-none ${service.tone.border}`}>
                  <div className={`border-b border-inherit bg-gradient-to-br px-3 pb-1 pt-5 sm:px-4 sm:pt-6 ${service.tone.surface}`}>
                    <div className="mx-3 mb-2 flex items-center justify-between gap-3 sm:mx-4">
                      <span className={`inline-flex items-center gap-2 text-xs font-semibold ${service.tone.accent}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />{service.medium}
                      </span>
                      <span className="font-mono text-[10px] tracking-[0.14em] text-slate-600" aria-hidden="true">{service.index} / {service.label}</span>
                    </div>
                    <ServiceArtwork kind={service.kind} />
                  </div>
                  <div className="flex flex-1 flex-col p-6 lg:p-8">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-bold leading-snug tracking-tight text-slate-900 lg:text-2xl">{service.title}</h3>
                      {!service.available && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                          <Clock className="h-3 w-3" aria-hidden="true" />即將開放
                        </span>
                      )}
                    </div>
                    <p className="mb-5 text-pretty text-sm leading-7 text-slate-600">{service.description}</p>
                    <div className="mb-6 mt-auto flex flex-wrap gap-2">
                      {service.tags.map(tag => (
                        <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">{tag}</span>
                      ))}
                    </div>
                    {service.available ? (
                      <Link href={service.href} className={`inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-4 motion-reduce:transition-none ${service.tone.cta}`}>
                        {service.cta}<ArrowRight className="h-4 w-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span aria-disabled="true" className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-400">
                        即將開放<Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mt-8 text-center text-xs leading-6 text-slate-500 sm:mt-10 sm:text-sm">工廠本來就有專業，我們只是讓它被看見。</p>
        </section>
      </main>
    </div>
  );
}
