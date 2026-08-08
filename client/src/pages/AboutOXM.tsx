import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import { ABOUT_CONTENT } from "@shared/content/about";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { AboutServiceArtwork, type AboutArtworkKind } from "@/components/about/AboutServiceArtwork";
import {
  ArrowRight,
  Briefcase,
  Camera,
  CheckCircle2,
  CircleDot,
  Factory,
  GraduationCap,
  Layers3,
  Link2,
  Lock,
  MessageSquare,
  Network,
  Newspaper,
  Rocket,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Waypoints,
} from "lucide-react";

function scrollToServiceBanners() {
  document.getElementById("oxm-service-banners")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

type ServiceTheme = {
  section: string;
  icon: string;
  badge: string;
  line: string;
  glow: string;
};

type AboutService = {
  icon: typeof Search;
  artwork: AboutArtworkKind;
  eyebrow: string;
  title: string;
  description: string;
  statusLabel: string;
  action?: { label: string; href: string };
  disabledLabel?: string;
  theme: ServiceTheme;
};

const SERVICES: AboutService[] = [
  {
    icon: Search,
    artwork: "factory",
    eyebrow: "製造媒合",
    title: ABOUT_CONTENT.serviceNames[0],
    description: "依產業、地區、OEM、ODM 等條件\n快速搜尋少量製造與打樣工廠\n查看實際能力並直接提出詢價",
    statusLabel: "已開放",
    action: { label: "前往搜尋工廠", href: "/search" },
    theme: {
      section: "bg-gradient-to-br from-orange-50/80 via-white to-amber-50",
      icon: "bg-orange-100 text-orange-700",
      badge: "border-orange-200 bg-orange-50 text-orange-700",
      line: "bg-orange-500",
      glow: "bg-orange-200/60",
    },
  },
  {
    icon: TrendingUp,
    artwork: "resources",
    eyebrow: "資源導航",
    title: ABOUT_CONTENT.serviceNames[1],
    description: "從資金、認證、系統到品牌行銷\n依企業目前問題選擇專業服務\n在同一入口找到清楚的改善方向",
    statusLabel: "已開放",
    action: { label: "前往找資源", href: "/resources" },
    theme: {
      section: "bg-gradient-to-br from-purple-50/80 via-white to-indigo-50",
      icon: "bg-purple-100 text-purple-700",
      badge: "border-purple-200 bg-purple-50 text-purple-700",
      line: "bg-purple-600",
      glow: "bg-purple-200/60",
    },
  },
  {
    icon: GraduationCap,
    artwork: "talent",
    eyebrow: "技能銜接",
    title: ABOUT_CONTENT.serviceNames[2],
    description: "串聯缺工需求、職業訓練、證照課程\n讓培訓內容更貼近產業實際需求\n協助學員取得技能後更快銜接工作",
    statusLabel: "規劃中",
    disabledLabel: "即將推出",
    theme: {
      section: "bg-gradient-to-br from-emerald-50/80 via-white to-teal-50",
      icon: "bg-emerald-100 text-emerald-700",
      badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
      line: "bg-emerald-600",
      glow: "bg-emerald-200/60",
    },
  },
  {
    icon: Camera,
    artwork: "brand",
    eyebrow: "數位形象",
    title: ABOUT_CONTENT.serviceNames[3],
    description: "媒合商業攝影、產品攝影、影音製作\n串聯 LOGO、品牌識別、視覺設計團隊\n協助傳統產業建立完整數位形象",
    statusLabel: "規劃中",
    disabledLabel: "即將推出",
    theme: {
      section: "bg-gradient-to-br from-amber-50/80 via-white to-rose-50",
      icon: "bg-rose-100 text-rose-700",
      badge: "border-rose-200 bg-rose-50 text-rose-700",
      line: "bg-rose-500",
      glow: "bg-rose-200/60",
    },
  },
  {
    icon: Newspaper,
    artwork: "news",
    eyebrow: "產業情報",
    title: ABOUT_CONTENT.serviceNames[4],
    description: "彙整政府政策、補助公告、法規異動\n整理產業活動、展覽等重要資訊\n讓工廠更容易掌握第一手產業消息",
    statusLabel: "規劃中",
    disabledLabel: "即將推出",
    theme: {
      section: "bg-gradient-to-br from-blue-50/80 via-white to-indigo-50",
      icon: "bg-blue-100 text-blue-700",
      badge: "border-blue-200 bg-blue-50 text-blue-700",
      line: "bg-blue-600",
      glow: "bg-blue-200/60",
    },
  },
  {
    icon: MessageSquare,
    artwork: "discussion",
    eyebrow: "商務交流",
    title: ABOUT_CONTENT.serviceNames[5],
    description: "提供產業交流、需求發布、公開競標\n建立合作討論與商務交流的空間\n讓工廠與產業夥伴發現更多合作機會",
    statusLabel: "準備中",
    disabledLabel: "準備中",
    theme: {
      section: "bg-gradient-to-br from-violet-50/80 via-white to-slate-100",
      icon: "bg-violet-100 text-violet-700",
      badge: "border-violet-200 bg-violet-50 text-violet-700",
      line: "bg-violet-600",
      glow: "bg-violet-200/60",
    },
  },
];

const ECOSYSTEM_TOP = [
  { icon: Factory, label: "工廠", tone: "text-orange-600 bg-orange-50 border-orange-100" },
  { icon: Briefcase, label: "專業顧問", tone: "text-purple-600 bg-purple-50 border-purple-100" },
  { icon: Users, label: "技術人才", tone: "text-teal-600 bg-teal-50 border-teal-100" },
];

const ECOSYSTEM_BOTTOM = [
  { icon: Camera, label: "品牌形象", tone: "text-rose-600 bg-rose-50 border-rose-100" },
  { icon: Newspaper, label: "產業資訊", tone: "text-blue-600 bg-blue-50 border-blue-100" },
  { icon: MessageSquare, label: "交流合作", tone: "text-violet-600 bg-violet-50 border-violet-100" },
];

const AUDIENCE_ROLE_ICONS = [Search, Rocket, Factory, Briefcase, Users];
const AUDIENCE_ROLES = ABOUT_CONTENT.audienceRoles.map((role, index) => ({
  ...role,
  icon: AUDIENCE_ROLE_ICONS[index],
  number: String(index + 1).padStart(2, "0"),
}));

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-purple-100 bg-white/80 px-3 py-1.5 text-xs font-semibold tracking-[0.16em] text-purple-700 shadow-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />{children}
    </span>
  );
}

function HeroEcosystem() {
  return (
    <div className="relative min-h-[27rem] overflow-hidden rounded-[2rem] border border-white/90 bg-white/75 p-5 shadow-[0_35px_90px_-42px_rgba(88,28,135,0.55)] backdrop-blur-xl sm:p-7">
      <div className="absolute inset-0 opacity-[0.09]" style={{ backgroundImage: "radial-gradient(circle, #7c3aed 1px, transparent 1.4px)", backgroundSize: "22px 22px" }} aria-hidden="true" />
      <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-purple-200/60 blur-3xl" aria-hidden="true" />
      <div className="absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-orange-200/60 blur-3xl" aria-hidden="true" />

      <div className="relative grid grid-cols-3 gap-3">
        {ECOSYSTEM_TOP.map(item => (
          <div key={item.label} className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border bg-white/90 px-2 text-center shadow-sm ${item.tone}`}>
            <item.icon className="h-6 w-6" />
            <span className="text-xs font-semibold leading-tight text-slate-700">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="relative my-5 flex items-center justify-center">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-orange-300 to-purple-300" />
        <div className="relative mx-4 flex h-28 w-28 shrink-0 items-center justify-center rounded-[2rem] bg-gradient-to-br from-orange-500 via-fuchsia-500 to-purple-700 text-white shadow-2xl shadow-purple-500/30 ring-8 ring-white/80">
          <Network className="absolute h-16 w-16 opacity-15" />
          <span className="text-xl font-black tracking-tight">OXM</span>
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-purple-300 via-orange-300 to-transparent" />
      </div>

      <div className="relative grid grid-cols-3 gap-3">
        {ECOSYSTEM_BOTTOM.map(item => (
          <div key={item.label} className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border bg-white/90 px-2 text-center shadow-sm ${item.tone}`}>
            <item.icon className="h-6 w-6" />
            <span className="text-xs font-semibold leading-tight text-slate-700">{item.label}</span>
          </div>
        ))}
      </div>
      <p className="relative mt-5 text-center text-xs font-semibold text-slate-600">讓分散的需求、能力與資源，在同一個入口建立連結</p>
    </div>
  );
}

function ServiceShowcase({ service, index }: { service: AboutService; index: number }) {
  const Icon = service.icon;
  const reverse = index % 2 === 1;
  return (
    <article className={`relative overflow-hidden rounded-[2.25rem] border border-slate-200/70 px-5 py-7 shadow-sm sm:px-8 sm:py-9 lg:px-10 ${service.theme.section}`}>
      <div className={`absolute h-56 w-56 rounded-full blur-3xl ${service.theme.glow} ${reverse ? "-left-20 -top-24" : "-right-20 -top-24"}`} aria-hidden="true" />
      <div className="relative grid items-center gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:gap-12">
        <div className={reverse ? "lg:order-2" : undefined}>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${service.theme.badge}`}><CircleDot className="h-3.5 w-3.5" />{service.statusLabel}</span>
            <span className="text-xs font-medium tracking-[0.14em] text-slate-500">{service.eyebrow}</span>
          </div>
          <div className="mb-5 flex items-center gap-4">
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${service.theme.icon}`}><Icon className="h-6 w-6" /></span>
            <div>
              <span className="text-xs font-semibold text-slate-400">SERVICE {String(index + 1).padStart(2, "0")}</span>
              <h3 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{service.title}</h3>
            </div>
          </div>
          <div className="space-y-3">
            {service.description.split("\n").map(line => (
              <div key={line} className="flex items-start gap-3 text-sm leading-relaxed text-slate-600 sm:text-base">
                <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${service.theme.line}`} />
                <span>{line}</span>
              </div>
            ))}
          </div>
          <div className="mt-7">
            {service.action ? (
              <Link href={service.action.href}>
                <Button className="bg-slate-900 text-white shadow-lg shadow-slate-900/15 hover:bg-slate-800">
                  {service.action.label}<ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <span aria-disabled="true" className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-2 text-sm font-medium text-slate-500">
                <Lock className="h-3.5 w-3.5" />{service.disabledLabel}
              </span>
            )}
          </div>
        </div>
        <AboutServiceArtwork kind={service.artwork} className={reverse ? "lg:order-1" : undefined} />
      </div>
    </article>
  );
}

export default function AboutOXM() {
  useRemoveServerSeoHead();

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{PUBLIC_PAGE_SEO.about.title}</title>
        <meta name="description" content={PUBLIC_PAGE_SEO.about.description} />
        <link rel="canonical" href={PUBLIC_PAGE_SEO.about.canonical} />
        <meta property="og:type" content={PUBLIC_PAGE_SEO.about.ogType} />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={PUBLIC_PAGE_SEO.about.canonical} />
        <meta property="og:title" content={PUBLIC_PAGE_SEO.about.title} />
        <meta property="og:description" content={PUBLIC_PAGE_SEO.about.description} />
        <meta property="og:image" content={PUBLIC_PAGE_SEO.about.ogImage} />
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/" label="返回" />

      {/* Hero：不再以寫實合成圖鋪底，改用品牌網格、柔和光暈與資源生態系圖解。 */}
      <section className="relative overflow-hidden border-b border-orange-100 bg-gradient-to-br from-orange-50 via-white to-purple-50 px-4 py-14 sm:py-20 lg:py-24">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(#7c3aed 1px, transparent 1px), linear-gradient(90deg, #7c3aed 1px, transparent 1px)", backgroundSize: "64px 64px" }} aria-hidden="true" />
        <div className="absolute -left-32 top-20 h-96 w-96 rounded-full bg-orange-200/50 blur-3xl" aria-hidden="true" />
        <div className="absolute -right-28 -top-16 h-[28rem] w-[28rem] rounded-full bg-purple-200/50 blur-3xl" aria-hidden="true" />

        <div className="container relative">
          <div className="grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
            <div>
              <div className="mb-7 flex items-center gap-2 text-xs text-slate-500">
                <Link href="/" className="transition-colors hover:text-orange-600">首頁</Link><span>/</span><span>關於 OXM</span>
              </div>
              <SectionEyebrow>ABOUT OXM</SectionEyebrow>
              <h1 className="mb-6 max-w-2xl text-4xl font-black leading-[1.12] tracking-tight text-slate-950 sm:text-5xl lg:text-[3.65rem]">
                {ABOUT_CONTENT.heroH1}
              </h1>
              <p className="mb-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">{ABOUT_CONTENT.heroLead}</p>
              <p className="mb-8 flex max-w-xl items-center gap-3 text-sm font-medium text-slate-500 sm:text-base"><Waypoints className="h-5 w-5 shrink-0 text-purple-600" />{ABOUT_CONTENT.heroSub}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/search"><Button size="lg" className="w-full border-0 bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/20 hover:from-orange-600 hover:to-amber-600 sm:w-auto"><Search className="mr-2 h-4 w-4" />搜尋台灣工廠</Button></Link>
                <Button size="lg" variant="outline" className="w-full border-purple-200 bg-white/80 text-purple-700 hover:bg-purple-50 sm:w-auto" onClick={scrollToServiceBanners}>了解 OXM 服務<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </div>
            <HeroEcosystem />
          </div>
        </div>
      </section>

      {/* 品牌定義與成立原因：同一章節中的兩種敘事卡，不再只靠中線分隔大段文字。 */}
      <section className="relative overflow-hidden px-4 py-16 sm:py-20">
        <div className="container max-w-6xl">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <SectionEyebrow>品牌使命</SectionEyebrow>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">把看不見的能力，連到正在發生的需求</h2>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <article className="relative overflow-hidden rounded-[2rem] border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-7 sm:p-9">
              <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-orange-200/50 blur-2xl" aria-hidden="true" />
              <div className="relative mb-7 flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/20"><Link2 className="h-6 w-6" /></span>
                <span className="text-5xl font-black text-orange-100">01</span>
              </div>
              <h2 className="relative mb-5 text-2xl font-bold text-slate-900 sm:text-3xl">{ABOUT_CONTENT.whatIsTitle}</h2>
              <div className="relative space-y-4 text-sm leading-relaxed text-slate-600 sm:text-base">
                {ABOUT_CONTENT.whatIsParagraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
              </div>
              <div className="relative mt-7 flex items-center gap-2 rounded-2xl border border-orange-100 bg-white/80 p-4 text-sm font-semibold text-orange-800"><Network className="h-5 w-5" />搜尋、聯繫、交流與媒合的產業生態系</div>
            </article>

            <article className="relative overflow-hidden rounded-[2rem] border border-purple-100 bg-gradient-to-br from-purple-50 to-white p-7 sm:p-9">
              <div className="absolute -left-16 -bottom-16 h-44 w-44 rounded-full bg-purple-200/50 blur-2xl" aria-hidden="true" />
              <div className="relative mb-7 flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600 text-white shadow-lg shadow-purple-500/20"><Sparkles className="h-6 w-6" /></span>
                <span className="text-5xl font-black text-purple-100">02</span>
              </div>
              <h2 className="relative mb-5 text-2xl font-bold text-slate-900 sm:text-3xl">{ABOUT_CONTENT.whyTitle}</h2>
              <div className="relative space-y-4 text-sm leading-relaxed text-slate-600 sm:text-base">
                {ABOUT_CONTENT.whyParagraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
              </div>
              <div className="relative mt-7 border-l-4 border-orange-500 bg-white/80 px-5 py-4 text-base font-bold leading-relaxed sm:text-lg">
                <span className="block bg-gradient-to-r from-orange-600 to-purple-600 bg-clip-text text-transparent">{ABOUT_CONTENT.brandStatementLines[0]}</span>
                <span className="mt-1 block bg-gradient-to-r from-orange-600 to-purple-600 bg-clip-text text-transparent">{ABOUT_CONTENT.brandStatementLines[1]}</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* 六大服務：每個服務各自擁有量身設計圖解，並以交錯節奏呈現。 */}
      <section id="oxm-service-banners" className="scroll-mt-24 border-y border-slate-100 bg-slate-50/70 px-4 py-16 sm:py-20">
        <div className="container max-w-6xl">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <SectionEyebrow>服務版圖</SectionEyebrow>
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{ABOUT_CONTENT.servicesTitle}</h2>
            <p className="text-sm leading-relaxed text-slate-500 sm:text-base">從製造媒合出發，逐步串聯企業經營與升級所需要的完整資源。</p>
          </div>
          <div className="space-y-7">
            {SERVICES.map((service, index) => <ServiceShowcase key={service.title} service={service} index={index} />)}
          </div>
        </div>
      </section>

      {/* 適用對象：編號式角色卡建立掃讀節奏。 */}
      <section className="relative overflow-hidden px-4 py-16 sm:py-20">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 via-white to-purple-50/50" aria-hidden="true" />
        <div className="container relative max-w-6xl">
          <div className="mb-11 flex flex-col items-center justify-between gap-5 text-center lg:flex-row lg:text-left">
            <div><SectionEyebrow>使用者角色</SectionEyebrow><h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{ABOUT_CONTENT.audienceTitle}</h2></div>
            <p className="max-w-md text-sm leading-relaxed text-slate-500">不論你正在尋找製造能力、曝光機會、專業資源或產業合作，都能從對應入口開始。</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {AUDIENCE_ROLES.map((role, index) => (
              <article key={role.title} className={`group relative overflow-hidden rounded-3xl border border-white bg-white/80 p-6 shadow-sm transition-transform duration-300 hover:-translate-y-1 ${index < 2 ? "lg:col-span-3" : "lg:col-span-2"}`}>
                <span className="absolute right-4 top-3 text-4xl font-black text-slate-100">{role.number}</span>
                <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-100 to-purple-100 text-purple-700"><role.icon className="h-5 w-5" /></span>
                <h3 className="mb-2 font-bold text-slate-900">{role.title}</h3>
                <p className="text-sm leading-relaxed text-slate-500">{role.content}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 名錄比較：用「資料清單 → OXM 連結能力」的流向取代兩張同質卡片。 */}
      <section className="relative overflow-hidden border-y border-slate-100 bg-slate-950 px-4 py-16 text-white sm:py-20">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1.4px)", backgroundSize: "24px 24px" }} aria-hidden="true" />
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-purple-600/25 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl" aria-hidden="true" />
        <div className="container relative max-w-6xl">
          <div className="mx-auto mb-11 max-w-2xl text-center">
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-[0.14em] text-orange-300"><Layers3 className="h-3.5 w-3.5" />平台差異</span>
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">OXM 不只是一份工廠名錄</h2>
            <p className="text-sm leading-relaxed text-slate-300 sm:text-base">我們希望使用者不只是找到一個名字，而是能真正了解、聯繫並建立合作。</p>
          </div>

          <div className="grid items-stretch gap-5 lg:grid-cols-[0.82fr_auto_1.18fr]">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-7">
              <h3 className="mb-5 text-lg font-bold text-slate-300">一般名錄通常提供</h3>
              <ul className="space-y-3">
                {["公司名稱", "電話", "地址", "基本產業分類"].map(item => <li key={item} className="flex items-center gap-3 text-sm text-slate-400"><span className="h-2 w-2 rounded-full bg-slate-600" />{item}</li>)}
              </ul>
            </div>
            <div className="flex items-center justify-center"><span className="flex h-12 w-12 rotate-90 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-purple-600 shadow-lg shadow-purple-950/50 lg:rotate-0"><ArrowRight className="h-5 w-5" /></span></div>
            <div className="rounded-[2rem] border border-orange-400/30 bg-gradient-to-br from-orange-500/10 to-purple-600/15 p-7">
              <h3 className="mb-5 flex items-center gap-2 text-lg font-bold text-orange-300"><Waypoints className="h-5 w-5" />OXM 希望提供</h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                {["主產業與子產業分類", "OEM／ODM 能力", "少量與打樣條件", "工廠與產品資訊", "一鍵詢價與站內訊息", "政府補助與專業資源", "人才與訓練服務", "品牌形象升級", "產業消息", "討論、需求與商務交流"].map(item => <li key={item} className="flex items-start gap-2.5 text-sm text-slate-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />{item}</li>)}
              </ul>
            </div>
          </div>
          <p className="mt-8 text-center text-sm font-medium text-slate-300 sm:text-base">從查詢資料，走向實際聯繫；從單次媒合，走向完整的產業資源串聯。</p>
        </div>
      </section>

      {/* 最終 CTA：以品牌舞台收束整頁。 */}
      <section className="relative overflow-hidden px-4 py-16 sm:py-24">
        <div className="container max-w-5xl">
          <div className="relative overflow-hidden rounded-[2.5rem] border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-purple-100 px-6 py-12 text-center shadow-[0_30px_90px_-50px_rgba(88,28,135,0.5)] sm:px-12 sm:py-16">
            <div className="absolute -left-16 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full border-[28px] border-orange-200/40" aria-hidden="true" />
            <div className="absolute -right-14 top-1/2 h-44 w-44 -translate-y-1/2 rounded-full border-[26px] border-purple-200/40" aria-hidden="true" />
            <div className="relative mx-auto max-w-2xl">
              <span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-orange-500 to-purple-600 text-white shadow-xl shadow-purple-500/25"><Network className="h-8 w-8" /></span>
              <h2 className="mb-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{ABOUT_CONTENT.ctaTitle}</h2>
              <p className="mb-8 text-sm leading-relaxed text-slate-600 sm:text-base">{ABOUT_CONTENT.ctaDescription}</p>
              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <Link href={ABOUT_CONTENT.ctaButtons[0].href}><Button size="lg" className="w-full border-0 bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/20 hover:from-orange-600 hover:to-amber-600 sm:w-auto"><Search className="mr-2 h-4 w-4" />{ABOUT_CONTENT.ctaButtons[0].label}</Button></Link>
                <Link href={ABOUT_CONTENT.ctaButtons[1].href}><Button size="lg" variant="outline" className="w-full border-purple-200 bg-white/80 text-purple-700 hover:bg-purple-50 sm:w-auto">{ABOUT_CONTENT.ctaButtons[1].label}<ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <p className="pb-5 text-center text-xs text-slate-400">關於 OXM 內容最後更新：{ABOUT_CONTENT.lastUpdated}</p>
    </div>
  );
}
