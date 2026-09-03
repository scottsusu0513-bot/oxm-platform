import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  BadgeCheck,
  Banknote,
  BarChart3,
  Briefcase,
  CalendarCheck,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Compass,
  FileText,
  Handshake,
  Landmark,
  LockKeyhole,
  MessagesSquare,
  Percent,
  PiggyBank,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

const PAIN_POINTS = [
  {
    Icon: Percent,
    title: "稅務負擔偏高",
    desc: "不確定目前的稅務安排是否合理",
    iconClass:
      "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
    glowClass:
      "from-orange-100/80 via-orange-50/20 to-transparent dark:from-orange-950/20",
  },
  {
    Icon: Landmark,
    title: "貸款條件不理想",
    desc: "利率、額度或還款結構需要調整",
    iconClass:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    glowClass:
      "from-blue-100/80 via-blue-50/20 to-transparent dark:from-blue-950/20",
  },
  {
    Icon: Wallet,
    title: "有營收卻缺現金",
    desc: "公司資金進出與調度不夠順暢",
    iconClass:
      "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    glowClass:
      "from-violet-100/80 via-violet-50/20 to-transparent dark:from-violet-950/20",
  },
  {
    Icon: MessagesSquare,
    title: "銀行溝通困難",
    desc: "不知道如何準備授信資料與爭取條件",
    iconClass:
      "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
    glowClass:
      "from-cyan-100/80 via-cyan-50/20 to-transparent dark:from-cyan-950/20",
  },
];

const SERVICES = [
  {
    Icon: ShieldCheck,
    eyebrow: "TAX REVIEW",
    title: "合法節稅",
    desc: "檢視稅務與帳務結構，降低不必要的稅務成本及風險。",
    tags: ["稅務現況", "帳務結構", "風險檢視"],
  },
  {
    Icon: Landmark,
    eyebrow: "FINANCING",
    title: "融資優化",
    desc: "規劃適合企業的貸款額度、期限與還款結構，並協助銀行對接。",
    tags: ["貸款額度", "期限規劃", "還款結構"],
  },
  {
    Icon: RefreshCw,
    eyebrow: "CASH FLOW",
    title: "財務結構優化",
    desc: "改善負債與現金流配置，讓營運資金調度更有彈性。",
    tags: ["負債配置", "現金流", "資金彈性"],
  },
];

const CONSULTANT_HIGHLIGHTS = [
  { Icon: Briefcase, title: "10+年", desc: "金融實務經驗" },
  { Icon: Award, title: "RFC 國際認證", desc: "專業財務顧問資格" },
  { Icon: Scale, title: "跨領域整合", desc: "金融、會計、稅務與法律資源" },
  { Icon: Users, title: "理解企業經營", desc: "從企業主角度規劃可執行方案" },
];

const STEPS = [
  {
    Icon: CalendarCheck,
    num: "01",
    title: "預約免費體檢",
    desc: "填寫聯絡資料，安排顧問初次諮詢。",
  },
  {
    Icon: ClipboardList,
    num: "02",
    title: "顧問全面健檢",
    desc: "從稅務、融資、負債與現金流全面了解公司體質。",
  },
  {
    Icon: Compass,
    num: "03",
    title: "提出優化方向",
    desc: "依企業整體狀況提出改善建議，並協助專業資源對接。",
  },
];

const TRUST_POINTS = [
  { Icon: CheckCircle2, text: "初次諮詢與企業財務體檢免費" },
  { Icon: Handshake, text: "先了解企業狀況，再討論適合方向" },
  { Icon: LockKeyhole, text: "企業資料僅供顧問評估與聯繫使用" },
];

const CTA_BUTTON_CLASS =
  "h-12 w-full rounded-xl border-0 bg-gradient-to-r from-blue-600 to-violet-600 px-6 text-white shadow-lg shadow-blue-600/20 hover:from-blue-700 hover:to-violet-700 sm:w-auto";

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={
        align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"
      }
    >
      <p className="mb-3 text-xs font-bold tracking-[0.2em] text-blue-700 dark:text-blue-300">
        {eyebrow}
      </p>
      <h2 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">
          {description}
        </p>
      )}
    </div>
  );
}

function ApplyButton({ className = "" }: { className?: string }) {
  return (
    <Button asChild size="lg" className={`${CTA_BUTTON_CLASS} ${className}`}>
      <Link href="/finance-optimization/apply">
        免費申請企業財務健檢
        <ArrowRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function FinanceIllustration() {
  return (
    <div
      className="relative mx-auto w-full max-w-[34rem] lg:ml-auto"
      aria-hidden="true"
    >
      <div className="absolute -left-8 top-16 h-40 w-40 rounded-full bg-blue-400/20 blur-3xl" />
      <div className="absolute -right-6 bottom-8 h-44 w-44 rounded-full bg-violet-400/20 blur-3xl" />

      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/85 p-4 shadow-2xl shadow-blue-950/15 backdrop-blur sm:p-6 dark:border-white/10 dark:bg-slate-900/85">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/20">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                企業財務體質
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                整體評估面向
              </p>
            </div>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
            FINANCE CHECK
          </span>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-violet-50 p-4 dark:border-blue-900/50 dark:from-blue-950/30 dark:via-slate-900 dark:to-violet-950/30 sm:p-5">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-slate-500 dark:text-slate-400">
                資金流向檢視
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                讓財務結構更清楚
              </p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>

          <div className="relative h-32">
            <div className="absolute inset-0 flex flex-col justify-between">
              {[0, 1, 2, 3].map(line => (
                <span
                  key={line}
                  className="block h-px w-full bg-blue-900/[0.07] dark:bg-blue-100/10"
                />
              ))}
            </div>
            <svg
              viewBox="0 0 440 128"
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              <defs>
                <linearGradient id="financeLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2563eb" />
                  <stop offset="100%" stopColor="#7c3aed" />
                </linearGradient>
                <linearGradient id="financeArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M4 112 C52 102, 58 77, 104 84 S171 110, 214 70 S276 60, 313 70 S377 35, 436 20 L436 128 L4 128 Z"
                fill="url(#financeArea)"
              />
              <path
                d="M4 112 C52 102, 58 77, 104 84 S171 110, 214 70 S276 60, 313 70 S377 35, 436 20"
                fill="none"
                stroke="url(#financeLine)"
                strokeWidth="4"
                strokeLinecap="round"
              />
              {[
                { x: 104, y: 84 },
                { x: 214, y: 70 },
                { x: 313, y: 70 },
                { x: 436, y: 20 },
              ].map(dot => (
                <circle
                  key={`${dot.x}-${dot.y}`}
                  cx={dot.x}
                  cy={dot.y}
                  r="5"
                  fill="white"
                  stroke="#4f46e5"
                  strokeWidth="3"
                />
              ))}
            </svg>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            {
              Icon: Percent,
              label: "稅務",
              tone: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
            },
            {
              Icon: Landmark,
              label: "融資",
              tone: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
            },
            {
              Icon: Wallet,
              label: "現金流",
              tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
            },
          ].map(item => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-100 bg-white p-2.5 text-center shadow-sm dark:border-slate-800 dark:bg-slate-950/50 sm:p-3"
            >
              <span
                className={`mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${item.tone}`}
              >
                <item.Icon className="h-4 w-4" />
              </span>
              <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 sm:text-xs">
                {item.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute -left-4 bottom-40 hidden items-center gap-3 rounded-2xl border border-white/90 bg-white/95 px-4 py-3 shadow-xl shadow-slate-900/10 sm:flex dark:border-white/10 dark:bg-slate-900/95">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
          <Banknote className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            資金運用
          </p>
          <p className="text-xs font-bold text-slate-800 dark:text-white">
            看見調整方向
          </p>
        </div>
      </div>

      <div className="absolute -right-3 top-32 hidden items-center gap-2 rounded-2xl border border-white/90 bg-white/95 px-3 py-2.5 shadow-xl shadow-slate-900/10 sm:flex dark:border-white/10 dark:bg-slate-900/95">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          <ArrowUpRight className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          結構優化
        </span>
      </div>
    </div>
  );
}

const SERVICE_CYCLE_STYLES = [
  {
    position: "left-1/2 top-[20%] -translate-x-1/2 -translate-y-1/2",
    node: "border-orange-200 from-orange-50 via-white to-blue-50 dark:border-orange-900/50 dark:from-orange-950/30 dark:via-slate-900 dark:to-blue-950/30",
    icon: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
    eyebrow: "text-orange-700 dark:text-orange-300",
  },
  {
    position: "left-[76%] top-[65%] -translate-x-1/2 -translate-y-1/2",
    node: "border-blue-200 from-blue-50 via-white to-cyan-50 dark:border-blue-900/50 dark:from-blue-950/30 dark:via-slate-900 dark:to-cyan-950/30",
    icon: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
    eyebrow: "text-blue-700 dark:text-blue-300",
  },
  {
    position: "left-[24%] top-[65%] -translate-x-1/2 -translate-y-1/2",
    node: "border-violet-200 from-violet-50 via-white to-fuchsia-50 dark:border-violet-900/50 dark:from-violet-950/30 dark:via-slate-900 dark:to-fuchsia-950/30",
    icon: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
    eyebrow: "text-violet-700 dark:text-violet-300",
  },
];

function ServicesCycle() {
  return (
    <div className="mt-10">
      <div className="relative mx-auto -mb-10 h-[340px] w-[340px] max-w-full sm:-mb-16 sm:h-[620px] sm:w-[620px] lg:-mb-20 lg:h-[680px] lg:w-[680px]">
        <svg
          viewBox="0 0 700 700"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="serviceCycleStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="55%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
            <marker
              id="serviceCycleArrow"
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="9"
              markerHeight="9"
              orient="auto-start-reverse"
            >
              <path d="M 1 1 L 11 6 L 1 11 Z" fill="#6366f1" />
            </marker>
          </defs>
          <circle
            cx="350"
            cy="350"
            r="210"
            fill="none"
            stroke="#c7d2fe"
            strokeWidth="2"
            strokeDasharray="5 12"
            opacity="0.55"
          />
          <path
            d="M 470.5 178 A 210 210 0 0 1 559.2 331.7"
            fill="none"
            stroke="url(#serviceCycleStroke)"
            strokeWidth="5"
            strokeLinecap="round"
            markerEnd="url(#serviceCycleArrow)"
          />
          <path
            d="M 438.7 540.3 A 210 210 0 0 1 261.3 540.3"
            fill="none"
            stroke="url(#serviceCycleStroke)"
            strokeWidth="5"
            strokeLinecap="round"
            markerEnd="url(#serviceCycleArrow)"
          />
          <path
            d="M 140.8 331.7 A 210 210 0 0 1 229.5 178"
            fill="none"
            stroke="url(#serviceCycleStroke)"
            strokeWidth="5"
            strokeLinecap="round"
            markerEnd="url(#serviceCycleArrow)"
          />
        </svg>

        <div className="absolute left-1/2 top-1/2 hidden h-36 w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-blue-200 bg-white/90 text-center shadow-xl shadow-blue-950/10 backdrop-blur sm:flex dark:border-blue-800 dark:bg-slate-900/90">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/20">
            <CircleDollarSign className="h-5 w-5" />
          </span>
          <p className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
            整體財務體質
          </p>
        </div>

        {SERVICES.map((service, index) => {
          const style = SERVICE_CYCLE_STYLES[index];
          return (
            <article
              key={service.title}
              className={`absolute z-10 flex h-32 w-32 flex-col items-center justify-center rounded-full border bg-gradient-to-br px-2.5 text-center shadow-xl shadow-blue-950/10 transition duration-300 hover:shadow-2xl sm:h-[190px] sm:w-[190px] sm:px-4 lg:h-[220px] lg:w-[220px] lg:px-5 ${style.position} ${style.node}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-12 sm:w-12 sm:rounded-2xl ${style.icon}`}
              >
                <service.Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </span>
              <p
                className={`mt-2 hidden text-[9px] font-bold tracking-[0.16em] sm:block ${style.eyebrow}`}
              >
                {service.eyebrow}
              </p>
              <h3 className="mt-2 text-sm font-bold leading-tight text-slate-900 dark:text-white sm:text-xl">
                {service.title}
              </h3>
              <p className="mt-2 hidden text-xs leading-5 text-slate-600 dark:text-slate-300 sm:block">
                {service.desc}
              </p>
              <div className="mt-3 hidden flex-wrap justify-center gap-1.5 lg:flex">
                {service.tags.slice(0, 2).map(tag => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/80 bg-white/75 px-2 py-1 text-[10px] font-medium text-slate-600 shadow-sm dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3 sm:hidden">
        {SERVICES.map((service, index) => {
          const style = SERVICE_CYCLE_STYLES[index];
          return (
            <div
              key={service.title}
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.icon}`}
              >
                <service.Icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {service.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {service.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FinanceOptimization() {
  useRemoveServerSeoHead();

  return (
    <div className="min-h-screen overflow-x-hidden bg-white dark:bg-background">
      {/* 正式開放服務 Landing Page：Final Public Index Release 已移除
          server/_core/security.ts NOINDEX_EXACT_PATHS 裡的隱藏 gate，
          title/description/canonical 改引用 shared/seo/publicPages.ts，
          與伺服器端初始 HTML head 注入共用同一份資料。
          /finance-optimization/apply 是申請表單，非內容型 Landing Page，
          仍維持 noindex，不受本次開放影響。 */}
      <Helmet>
        <title>{PUBLIC_PAGE_SEO.financeOptimization.title}</title>
        <meta name="description" content={PUBLIC_PAGE_SEO.financeOptimization.description} />
        <link rel="canonical" href={PUBLIC_PAGE_SEO.financeOptimization.canonical} />
      </Helmet>
      <Navbar />

      {/* breadcrumb：讓使用者與爬蟲理解上層是「找資源」，沿用
          ShortVideoMarketing.tsx／Brand.tsx 同一種輕量 breadcrumb 樣式。這頁
          沒有 FloatingBackButton，不需要額外的 pt-16 間距處理。 */}
      <div className="max-w-7xl mx-auto px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-blue-700">首頁</Link><span>/</span>
          <Link href="/resources" className="hover:text-blue-700">找資源</Link><span>/</span>
          <span>企業財務優化</span>
        </div>
      </div>

      <main>
        <section className="relative overflow-hidden border-b border-blue-100 bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_48%,#f5f3ff_100%)] dark:border-blue-950 dark:bg-[linear-gradient(135deg,#071326_0%,#09090b_52%,#17102b_100%)]">
          <div
            className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(37,99,235,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(37,99,235,0.07)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]"
            aria-hidden="true"
          />
          <div
            className="absolute -left-32 top-20 h-72 w-72 rounded-full bg-blue-300/20 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="absolute -right-24 -top-16 h-80 w-80 rounded-full bg-violet-300/20 blur-3xl"
            aria-hidden="true"
          />

          <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-24 xl:gap-20">
            <div className="max-w-2xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3.5 py-2 text-xs font-semibold text-blue-800 shadow-sm backdrop-blur dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
                <span className="h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_0_4px_rgba(249,115,22,0.12)]" />
                初次諮詢・企業財務體檢免費
              </div>

              <p className="mb-3 text-sm font-bold tracking-[0.18em] text-blue-700 dark:text-blue-300">
                OXM BUSINESS FINANCE
              </p>
              <h1 className="text-4xl font-black tracking-tight text-slate-950 dark:text-white sm:text-5xl lg:text-6xl lg:leading-[1.08]">
                企業財務優化
              </h1>
              <p className="mt-4 bg-gradient-to-r from-blue-700 to-violet-700 bg-clip-text text-lg font-bold text-transparent dark:from-blue-300 dark:to-violet-300 sm:text-xl">
                合法節稅｜融資優化｜資金更靈活
              </p>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-600 dark:text-slate-300 sm:text-lg">
                專業顧問從稅務、融資、負債與現金流等面向檢視企業體質，協助改善財務結構，讓資金運用更健康、更順暢。
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
                <ApplyButton />
                <span className="flex items-center justify-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 sm:justify-start">
                  <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  先了解企業狀況，再討論適合方向
                </span>
              </div>

              <div className="mt-8 grid max-w-xl grid-cols-3 gap-2 border-t border-slate-200/80 pt-5 dark:border-slate-800 sm:gap-4">
                {[
                  { Icon: PiggyBank, label: "財務體質檢視" },
                  { Icon: BadgeCheck, label: "專業顧問評估" },
                  { Icon: LockKeyhole, label: "企業資料保密" },
                ].map(item => (
                  <div
                    key={item.label}
                    className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left"
                  >
                    <item.Icon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="text-[11px] font-medium leading-4 text-slate-600 dark:text-slate-300 sm:text-xs">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <FinanceIllustration />
          </div>
        </section>

        <section className="relative py-16 sm:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="常見企業財務卡點"
              title="企業是否遇到這些狀況？"
              description="當稅務、融資與現金流彼此牽動，單看一個數字往往找不到真正原因。先從企業正在面對的問題開始辨識。"
            />

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PAIN_POINTS.map((point, index) => (
                <article
                  key={point.title}
                  className="group relative min-h-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-950/[0.07] dark:border-slate-800 dark:bg-slate-950/50 dark:hover:border-blue-800"
                >
                  <div
                    className={`absolute inset-0 bg-gradient-to-br opacity-70 transition-opacity group-hover:opacity-100 ${point.glowClass}`}
                    aria-hidden="true"
                  />
                  <div className="relative">
                    <div className="mb-7 flex items-start justify-between gap-4">
                      <span
                        className={`flex h-12 w-12 items-center justify-center rounded-2xl ${point.iconClass}`}
                      >
                        <point.Icon className="h-5 w-5" />
                      </span>
                      <span className="rounded-full border border-slate-200/80 bg-white/70 px-2.5 py-1 text-[10px] font-bold tracking-wider text-slate-400 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-500">
                        PAIN {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      {point.title}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {point.desc}
                    </p>
                    <div
                      className="mt-6 h-1 w-10 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 transition-all duration-300 group-hover:w-16"
                      aria-hidden="true"
                    />
                  </div>
                </article>
              ))}
            </div>

            <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-5 py-5 text-center dark:border-blue-900/60 dark:bg-blue-950/20 sm:flex-row sm:justify-center sm:text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-md shadow-blue-600/20">
                <ArrowRight className="h-4 w-4" />
              </span>
              <p className="text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200 sm:text-base">
                看見問題後，下一步是從整體財務結構找出可調整的方向。
              </p>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-y border-blue-100 bg-slate-50 py-12 dark:border-blue-950 dark:bg-slate-950/40 sm:py-14">
          <div
            className="absolute -right-24 top-8 h-80 w-80 rounded-full bg-violet-200/30 blur-3xl dark:bg-violet-900/10"
            aria-hidden="true"
          />
          <div
            className="absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-blue-200/35 blur-3xl dark:bg-blue-900/10"
            aria-hidden="true"
          />

          <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              eyebrow="OXM 如何協助"
              title="從單一問題，回到整體財務體質"
              description="依企業目前狀況，從稅務、融資、負債與現金流等面向進行檢視，整理出更清楚的改善方向。"
              align="left"
            />

            <ServicesCycle />
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-16 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-violet-50 p-7 shadow-lg shadow-blue-950/[0.06] dark:border-blue-900/50 dark:from-blue-950/30 dark:via-slate-900 dark:to-violet-950/30 sm:p-9">
              <div
                className="absolute -right-16 -top-16 h-52 w-52 rounded-full border-[36px] border-violet-200/30 dark:border-violet-800/10"
                aria-hidden="true"
              />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/20">
                <BadgeCheck className="h-7 w-7" />
              </span>
              <div className="relative mt-7">
                <p className="text-xs font-bold tracking-[0.2em] text-blue-700 dark:text-blue-300">
                  專業與信任
                </p>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                  先理解企業，再提出方向
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">
                  財務優化不是套用單一答案。顧問會先了解企業的實際狀況，再從可執行的角度討論後續方向。
                </p>
              </div>
              <div className="relative mt-7 space-y-3">
                {TRUST_POINTS.map(point => (
                  <div
                    key={point.text}
                    className="flex items-start gap-3 rounded-xl border border-white/80 bg-white/75 p-3.5 shadow-sm dark:border-white/10 dark:bg-slate-950/40"
                  >
                    <point.Icon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium leading-5 text-slate-700 dark:text-slate-200">
                      {point.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SectionHeading
                eyebrow="專業顧問團隊"
                title="用企業經營的角度，看懂財務全貌"
                description="結合金融實務與跨領域專業，協助企業把複雜的財務問題整理成更清楚、可理解的方向。"
                align="left"
              />
              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {CONSULTANT_HIGHLIGHTS.map(highlight => (
                  <div
                    key={highlight.title}
                    className="flex min-h-32 items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/50"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                      <highlight.Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        {highlight.title}
                      </p>
                      <p className="mt-1.5 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        {highlight.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden border-y border-slate-200 bg-slate-950 py-16 text-white dark:border-slate-800 sm:py-20">
          <div
            className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(96,165,250,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(96,165,250,0.12)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_right,transparent,black_25%,black_75%,transparent)]"
            aria-hidden="true"
          />
          <div
            className="absolute -left-20 top-0 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl"
            aria-hidden="true"
          />

          <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="mb-3 text-xs font-bold tracking-[0.2em] text-blue-300">
                申請後會發生什麼？
              </p>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                三步驟完成企業健檢
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
                流程清楚、先了解再評估，讓企業在送出申請前就知道下一步。
              </p>
            </div>

            <div className="relative mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
              <div
                className="absolute bottom-8 left-[1.55rem] top-8 w-px bg-gradient-to-b from-blue-500 via-violet-500 to-transparent md:hidden"
                aria-hidden="true"
              />
              <div
                className="absolute left-[16%] right-[16%] top-7 hidden h-px bg-gradient-to-r from-blue-500 via-violet-500 to-blue-500 md:block"
                aria-hidden="true"
              />

              {STEPS.map(step => (
                <article key={step.num} className="relative pl-16 md:pl-0">
                  <div className="absolute left-0 top-0 z-10 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-xl shadow-blue-950/40 md:relative md:mb-6 md:h-14 md:w-14">
                    <step.Icon className="h-5 w-5 md:h-6 md:w-6" />
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur-sm md:min-h-48 md:p-6">
                    <p className="text-[11px] font-bold tracking-[0.18em] text-blue-300">
                      STEP {step.num}
                    </p>
                    <h3 className="mt-3 text-lg font-bold">{step.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {step.desc}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div
            className="absolute left-1/2 top-1/2 h-72 w-[42rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-200/25 blur-3xl dark:bg-blue-900/10"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-violet-100 px-6 py-10 shadow-2xl shadow-blue-950/[0.08] dark:border-blue-900/60 dark:from-blue-950/40 dark:via-slate-900 dark:to-violet-950/40 sm:px-10 sm:py-12 lg:px-14">
            <div
              className="absolute -right-14 -top-14 h-48 w-48 rounded-full border-[34px] border-violet-300/20"
              aria-hidden="true"
            />
            <div
              className="absolute -bottom-20 -left-16 h-56 w-56 rounded-full border-[40px] border-blue-300/20"
              aria-hidden="true"
            />
            <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  免費企業財務健檢
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-3xl lg:text-4xl">
                  不知道目前公司的財務結構，有沒有改善空間？
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">
                  先讓專業顧問協助您做初步了解，再決定是否需要進一步規劃。
                </p>
              </div>
              <ApplyButton className="lg:min-w-60" />
            </div>
            <div className="relative mt-8 flex items-start gap-2.5 border-t border-blue-200/70 pt-5 text-xs leading-5 text-slate-500 dark:border-blue-900/50 dark:text-slate-400">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <p>
                企業資料僅供顧問評估與聯繫使用，將採保密方式處理。後續服務內容及費用將於評估後另行說明。
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
