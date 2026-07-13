import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import {
  Search, Factory, Users, Briefcase, Camera, Newspaper, MessageSquare,
  Rocket, TrendingUp, GraduationCap, ArrowRight, CheckCircle2, Lock,
} from "lucide-react";

const BASE = "https://www.oxmmatch.com";
const CANONICAL = `${BASE}/about`;

// ── 卡片樣式共用 class（圓角、淡陰影、白底，符合全站風格）──────────────────
const CARD_CLASS = "rounded-2xl border border-border bg-white p-6 shadow-sm";

function scrollToServiceBanners() {
  document.getElementById("oxm-service-banners")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── 雙橫幅服務資料 ───────────────────────────────────────────────────────
// imageSrc 指向 client/public/about-assets/ 底下的正式圖片；圖片放入前該路徑會 404，
// 但因為一律以 CSS background-image 呈現（非 <img>），載入失敗時瀏覽器只會
// 靜默不繪製該層，不會出現破圖 icon，既有漸層與 icon 會維持原本顯示效果。
type BannerService = {
  icon: typeof Search;
  title: string;
  description: string;
  statusLabel: string;
  action?: { label: string; href: string };
  disabledLabel?: string;
  gradient: string;
  imageSrc: string;
  imageAlt: string;
  desktopPosition: string;
  mobilePosition: string;
};

const FACTORY_SERVICE: BannerService = {
  icon: Search,
  title: "找工廠",
  description: "依產業、地區、OEM、ODM 等條件\n快速搜尋少量製造與打樣工廠\n查看實際能力並直接提出詢價",
  statusLabel: "已開放",
  action: { label: "前往搜尋工廠", href: "/search" },
  gradient: "from-orange-500 to-amber-600",
  imageSrc: "/about-assets/service-factory.webp",
  imageAlt: "台灣中小型工廠現場，技師操作機台進行製造作業",
  desktopPosition: "center",
  mobilePosition: "center",
};

const SUBSIDY_SERVICE: BannerService = {
  icon: TrendingUp,
  title: "找資源",
  description: "透過 OXM 找資源入口\n了解企業升級所需專業服務\n逐步整合法律顧問與產業資源",
  statusLabel: "已開放",
  action: { label: "了解企業升級中心", href: "/upgrade-center" },
  gradient: "from-purple-600 to-indigo-700",
  imageSrc: "/about-assets/service-subsidy.webp",
  imageAlt: "工廠負責人與顧問討論升級規劃，桌上有文件與平板",
  desktopPosition: "center",
  mobilePosition: "center",
};

const TALENT_SERVICE: BannerService = {
  icon: GraduationCap,
  title: "找人才",
  description: "串聯缺工需求、職業訓練、證照課程\n讓培訓內容更貼近產業實際需求\n協助學員取得技能後更快銜接工作",
  statusLabel: "規劃中",
  disabledLabel: "即將推出",
  gradient: "from-teal-500 to-emerald-700",
  imageSrc: "/about-assets/service-talent.webp",
  imageAlt: "職業訓練現場，講師指導學員進行機台實習",
  desktopPosition: "center",
  mobilePosition: "center",
};

const IMAGE_SERVICE: BannerService = {
  icon: Camera,
  title: "找形象",
  description: "媒合商業攝影、產品攝影、影音製作\n串聯 LOGO、品牌識別、視覺設計團隊\n協助傳統產業建立完整數位形象",
  statusLabel: "規劃中",
  disabledLabel: "即將推出",
  gradient: "from-amber-500 to-rose-600",
  imageSrc: "/about-assets/service-brand.webp",
  imageAlt: "商業攝影團隊為工廠產品拍攝，現場有燈光與相機設備",
  desktopPosition: "72% center",
  mobilePosition: "center",
};

const NEWS_SERVICE: BannerService = {
  icon: Newspaper,
  title: "找消息",
  description: "彙整政府政策、補助公告、法規異動\n整理產業活動、展覽等重要資訊\n讓工廠更容易掌握第一手產業消息",
  statusLabel: "規劃中",
  disabledLabel: "即將推出",
  gradient: "from-blue-600 to-indigo-800",
  imageSrc: "/about-assets/service-news.webp",
  imageAlt: "產業政策文件、活動日曆與平板資訊整理畫面",
  desktopPosition: "35% center",
  mobilePosition: "center",
};

const DISCUSSION_SERVICE: BannerService = {
  icon: MessageSquare,
  title: "找討論",
  description: "提供產業交流、需求發布、公開競標\n建立合作討論與商務交流的空間\n讓工廠與產業夥伴發現更多合作機會",
  statusLabel: "準備中",
  disabledLabel: "準備中",
  gradient: "from-violet-700 to-slate-900",
  imageSrc: "/about-assets/service-discussion.webp",
  imageAlt: "工廠、業務與採購人士多方交流討論的畫面",
  desktopPosition: "72% center",
  mobilePosition: "72% center",
};

// ── 區塊 1：Hero 生態系示意圖資料 ────────────────────────────────────────────
const HERO_IMAGE_SRC = "/about-assets/hero-oxm-ecosystem.webp";

const ECOSYSTEM_TOP = [
  { icon: Factory, label: "工廠" },
  { icon: Briefcase, label: "專業顧問" },
  { icon: Users, label: "技術人才" },
];
const ECOSYSTEM_BOTTOM = [
  { icon: Camera, label: "攝影與設計團隊" },
  { icon: Newspaper, label: "政府與產業資訊" },
  { icon: MessageSquare, label: "產業交流社群" },
];

// ── 誰適合使用 OXM ──────────────────────────────────────────────────────
const AUDIENCE_ROLES = [
  { icon: Search, title: "品牌商與採購人員", content: "尋找製造、加工、零件、包裝及產品開發資源。" },
  { icon: Rocket, title: "創業者與設計師", content: "尋找少量製造、打樣、OEM、ODM 與設計協作夥伴。" },
  { icon: Factory, title: "台灣工廠與工作室", content: "建立數位曝光、取得詢價、尋找人才與經營升級資源。" },
  { icon: Briefcase, title: "專業顧問與服務團隊", content: "接觸有補助、法律、品牌及企業升級需求的工廠。" },
  { icon: Users, title: "職業訓練單位與學員", content: "了解產業用人需求、開設適合課程並銜接就業機會。" },
];

// Hero 整體背景圖：鋪在整個 Hero section 之下（非右側卡片內）。<img> 若 404 會顯示
// 破圖 icon（不像 CSS background-image 會靜默失敗），因此用 onError 監聽載入失敗，
// 失敗時整個背景層（圖片＋遮罩）都不渲染，Hero 會退回原本純白背景，文字/CTA/右側卡片不受影響。
function HeroBackground() {
  const [imgFailed, setImgFailed] = useState(false);
  if (imgFailed) return null;

  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <img
        src={HERO_IMAGE_SRC}
        alt=""
        width={1600}
        height={1200}
        style={{ aspectRatio: "4 / 3" }}
        className="absolute inset-0 h-full w-full object-cover object-[30%_center] lg:object-left opacity-35 lg:opacity-70 pointer-events-none select-none"
        loading="eager"
        fetchPriority="high"
        onError={() => setImgFailed(true)}
      />
      {/* 桌面版：加深的水平白色遮罩，往右側逐漸透明，避免蓋過右側卡片 */}
      <div
        className="absolute inset-0 hidden lg:block"
        style={{
          background: "linear-gradient(to right, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.58) 42%, rgba(255,255,255,0.38) 70%, rgba(255,255,255,0.24) 100%)",
        }}
      />
      {/* 手機版：整體較重的白色遮罩，確保標題與段落在單欄版面中清楚可讀 */}
      <div className="absolute inset-0 bg-white/75 lg:hidden" />
    </div>
  );
}

// 右側 OXM 生態系卡片：一律顯示，不再因 Hero 背景圖成功與否而被覆蓋或替換。
function HeroVisual() {
  return (
    <div className={`relative ${CARD_CLASS} bg-gradient-to-br from-orange-50/60 to-purple-50/60`}>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {ECOSYSTEM_TOP.map(item => (
          <div key={item.label} className="flex flex-col items-center gap-3 rounded-xl bg-white border border-border/70 px-2 py-4 text-center shadow-sm">
            <item.icon className="w-7 h-7 text-purple-500 shrink-0" />
            <span className="text-base font-medium text-muted-foreground leading-tight">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-orange-300" />
        <div className="shrink-0 flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-orange-500 to-purple-600 shadow-lg shadow-orange-500/20">
          <span className="text-white font-extrabold text-lg tracking-tight">OXM</span>
        </div>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-purple-300" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {ECOSYSTEM_BOTTOM.map(item => (
          <div key={item.label} className="flex flex-col items-center gap-3 rounded-xl bg-white border border-border/70 px-2 py-4 text-center shadow-sm">
            <item.icon className="w-7 h-7 text-orange-500 shrink-0" />
            <span className="text-base font-medium text-muted-foreground leading-tight">{item.label}</span>
          </div>
        ))}
      </div>
      <p className="text-sm md:text-base font-semibold text-center bg-gradient-to-r from-orange-500 to-purple-600 bg-clip-text text-transparent mt-5">
        OXM 將不同產業角色與資源連結在一起
      </p>
    </div>
  );
}

// ── 雙橫幅共用元件 ───────────────────────────────────────────────────────

// maskDirection 依文字位置決定可讀性遮罩方向：桌面版左側服務用 "left"（左深右淺）、
// 右側服務用 "right"（右深左淺），兩者都朝中間斜切線淡出避免接縫；手機版固定用
// "vertical"（由下往上），因為手機版文字一律置左置頂、不需要水平方向的遮罩。
function ServiceBannerBackground({
  service,
  maskDirection,
  position,
}: {
  service: BannerService;
  maskDirection: "left" | "right" | "vertical";
  position: string;
}) {
  const Icon = service.icon;
  const maskClass =
    maskDirection === "left"
      ? "bg-gradient-to-r from-black/55 via-black/15 to-transparent"
      : maskDirection === "right"
        ? "bg-gradient-to-l from-black/55 via-black/15 to-transparent"
        : "bg-gradient-to-t from-black/60 via-black/25 to-black/10";

  return (
    <div className={`absolute inset-0 bg-gradient-to-br ${service.gradient}`} aria-hidden="true">
      {/* 背景照片層：CSS background-image，圖片不存在時瀏覽器靜默不繪製，不會出現破圖 icon，
          下方的品牌漸層（本層的父層背景）會維持原本顯示 */}
      <div
        className="absolute inset-0 bg-cover bg-no-repeat opacity-60"
        style={{ backgroundImage: `url(${service.imageSrc})`, backgroundPosition: position }}
      />
      <div className={`absolute inset-0 ${maskClass}`} />
      <Icon className="absolute -right-6 -bottom-10 h-44 w-44 text-white/10 rotate-[-8deg]" />
      <Icon className="absolute -left-6 -top-8 h-24 w-24 text-white/10 rotate-[12deg]" />
    </div>
  );
}

function ServiceBannerContent({ service, align, flat }: { service: BannerService; align: "left" | "right"; flat?: boolean }) {
  const Icon = service.icon;
  // 容器改用較窄的固定安全區（約橫幅寬度 36%，上限 440px），並用較小的固定外距
  // （ml-8／mr-8）貼齊該側邊緣＋mr-auto／ml-auto，讓文字群組中心落在整張橫幅
  // 約 20% ／ 80% 附近，明顯偏向左／右側、遠離中間斜切線；容器「內部」再用
  // items-center + text-center 讓圖示、標題、說明文字、按鈕彼此置中對齊。
  // （w-1/2 會讓文字群組中心停在該半區正中央、即整體 25%／75%，仍偏靠近中央
  // 斜切線，故改用較窄的固定寬度容器。）
  const containerClass = flat
    ? "w-full px-6 sm:px-8"
    : align === "left"
      ? "w-[36%] max-w-[440px] ml-8 mr-auto"
      : "w-[36%] max-w-[440px] mr-8 ml-auto";

  return (
    <div className={`relative z-10 flex h-full flex-col items-center justify-center text-center gap-2.5 py-7 text-white ${containerClass}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white/20 text-white">
          {service.statusLabel}
        </span>
      </div>
      <h3 className="text-xl sm:text-2xl font-bold tracking-tight">{service.title}</h3>
      <p className="max-w-sm text-sm text-white/85 leading-relaxed text-center whitespace-pre-line break-keep">
        {service.description}
      </p>
      {service.action ? (
        <Link href={service.action.href}>
          <Button
            size="sm"
            variant="secondary"
            className="mt-1 bg-white text-slate-900 hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            {service.action.label}
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </Link>
      ) : (
        <span
          aria-disabled="true"
          tabIndex={-1}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-white/30 px-3 py-1.5 text-xs font-medium text-white/70 cursor-not-allowed select-none"
        >
          <Lock className="w-3 h-3" />
          {service.disabledLabel}
        </span>
      )}
    </div>
  );
}

// 桌面版斜切幾何：以整體容器 50% 為中心對稱，上下切點各偏移 115px
// （400px 高度 × tan(30°) ÷ 2 ≈ 115.47px），確保斜線通過正中央、左右可視面積相等
const DIAGONAL_HALF_OFFSET_PX = 115;

function DesktopDiagonalHalf({ service, side }: { service: BannerService; side: "left" | "right" }) {
  const clip = side === "left"
    ? `polygon(0 0, calc(50% + ${DIAGONAL_HALF_OFFSET_PX}px) 0, calc(50% - ${DIAGONAL_HALF_OFFSET_PX}px) 100%, 0 100%)`
    : `polygon(calc(50% + ${DIAGONAL_HALF_OFFSET_PX}px) 0, 100% 0, 100% 100%, calc(50% - ${DIAGONAL_HALF_OFFSET_PX}px) 100%)`;
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ clipPath: clip }}>
      <ServiceBannerBackground service={service} maskDirection={side} position={service.desktopPosition} />
      <ServiceBannerContent service={service} align={side} />
    </div>
  );
}

function ServiceBannerSection({ id, left, right }: { id?: string; left: BannerService; right: BannerService }) {
  return (
    <div id={id} className={id ? "scroll-mt-24" : undefined}>
      {/* 桌面版：中間 30 度斜切雙橫幅（左右各為滿版全寬區塊，共用同一組 calc(50% ± 115px) 切點） */}
      <div className="hidden lg:block relative h-[400px] rounded-[28px] shadow-lg overflow-hidden">
        <DesktopDiagonalHalf service={left} side="left" />
        <DesktopDiagonalHalf service={right} side="right" />
      </div>

      {/* 手機版：改為上下兩個獨立圓角橫幅，不使用斜切 */}
      <div className="flex flex-col gap-4 lg:hidden">
        <div className="relative h-[300px] rounded-2xl shadow-md overflow-hidden">
          <ServiceBannerBackground service={left} maskDirection="vertical" position={left.mobilePosition} />
          <ServiceBannerContent service={left} align="left" flat />
        </div>
        <div className="relative h-[300px] rounded-2xl shadow-md overflow-hidden">
          <ServiceBannerBackground service={right} maskDirection="vertical" position={right.mobilePosition} />
          <ServiceBannerContent service={right} align="left" flat />
        </div>
      </div>
    </div>
  );
}

export default function AboutOXM() {
  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>關於 OXM｜台灣傳統產業數位資源媒合平台</title>
        <meta
          name="description"
          content="OXM 是以台灣傳統產業為核心的數位資源媒合平台，整合工廠媒合、專業服務、人才培訓、品牌形象、產業資訊與商務交流。"
        />
        <link rel="canonical" href={CANONICAL} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="OXM" />
        <meta property="og:url" content={CANONICAL} />
        <meta property="og:title" content="關於 OXM｜台灣傳統產業數位資源媒合平台" />
        <meta
          property="og:description"
          content="OXM 是以台灣傳統產業為核心的數位資源媒合平台，整合工廠媒合、專業服務、人才培訓、品牌形象、產業資訊與商務交流。"
        />
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          "name": "OXM",
          "url": BASE,
          "description": "OXM 是以台灣傳統產業為核心的數位資源媒合平台，整合工廠媒合、專業服務、人才培訓、品牌形象、產業資訊與商務交流。",
        })}</script>
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/" label="返回" />

      {/* ── 區塊 1：Hero 品牌主視覺 ── */}
      <section className="relative overflow-hidden pt-10 pb-14 md:pt-16 md:pb-20">
        <HeroBackground />
        <div className="container relative z-10">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* 左側文字 + CTA（手機版：文字在上、CTA 在中） */}
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 mb-4">
                <Link href="/" className="hover:text-orange-600 transition-colors">首頁</Link>
                <span aria-hidden="true">/</span>
                <span className="text-muted-foreground/90">關於 OXM</span>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold leading-tight tracking-tight mb-5">
                台灣傳統產業的數位資源入口
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-4">
                OXM 整合台灣工廠、專業服務、人才培訓、品牌形象、產業資訊與交流合作，讓工廠在經營、接單、缺工與升級的每一個階段，都能更快找到所需要的資源。
              </p>
              <p className="text-sm sm:text-base text-muted-foreground/80 leading-relaxed mb-8">
                從找工廠開始，串聯台灣傳統產業需要的每一項資源。
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/search">
                  <Button
                    size="lg"
                    className="w-full sm:w-auto bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 shadow-lg shadow-orange-500/20"
                  >
                    <Search className="w-4 h-4 mr-2" />
                    搜尋台灣工廠
                  </Button>
                </Link>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto bg-white border-purple-300 text-purple-700 hover:bg-purple-50"
                  onClick={scrollToServiceBanners}
                >
                  了解 OXM 服務
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>

            {/* 右側／手機版最下方：OXM 生態系示意卡片，一律顯示（Hero 背景圖獨立於整個 section） */}
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ── 區塊 2：OXM 是什麼？ + 為什麼會有 OXM？ ── */}
      <section className="py-12 md:py-16 border-t border-border/60">
        <div className="container max-w-5xl">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-0">
            <div className="lg:pr-10 flex flex-col items-center text-center">
              <div className="max-w-[520px] mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold mb-4">OXM 是什麼？</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  OXM 是以台灣傳統產業為核心的數位資源媒合平台，協助企業、品牌商、創業者、設計師與採購人員尋找適合的台灣工廠，也協助工廠取得經營、人才、法律、品牌、政府資源與產業資訊。
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  OXM 不只提供工廠搜尋，也希望逐步整合台灣傳統產業需要的各類服務，讓原本分散的資源可以在同一個入口被找到、被理解並建立合作。
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  平台最終目標不是只建立一份工廠名錄，而是形成一個能夠實際搜尋、聯繫、交流與媒合的產業生態系。
                </p>
              </div>
            </div>
            <div className="lg:pl-10 lg:border-l lg:border-border/60 flex flex-col items-center text-center">
              <div className="max-w-[520px] mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold mb-4">為什麼會有 OXM？</h2>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  台灣有許多具備成熟技術、設備與製造經驗的工廠，但因為缺少數位曝光、資料分散或沒有專業行銷團隊，優秀的能力不一定能被外界看見。
                </p>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  同時，需求方也常常不知道該從哪裡找工廠、如何判斷加工能力，或該向誰詢問人才、補助、法律與品牌升級等問題。
                </p>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  OXM 因此建立，希望把傳統產業需要的工廠、人才、專業服務、資訊與交流空間整合起來，降低尋找資源與建立合作的門檻。
                </p>
                <p className="text-lg sm:text-xl font-bold border-l-4 border-orange-400 pl-4 py-1 bg-gradient-to-r from-orange-600 to-purple-600 bg-clip-text text-transparent mx-auto">
                  好技術，不應該因為缺乏曝光而被忽略；真正的需求，也不該因為資訊分散而找不到出口。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 區塊 3～5：三組雙橫幅服務入口 ── */}
      <section className="py-12 md:py-16 border-t border-border/60 bg-slate-50">
        <div className="container space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-2">OXM 六大服務入口</h2>
          <ServiceBannerSection id="oxm-service-banners" left={FACTORY_SERVICE} right={SUBSIDY_SERVICE} />
          <ServiceBannerSection left={TALENT_SERVICE} right={IMAGE_SERVICE} />
          <ServiceBannerSection left={NEWS_SERVICE} right={DISCUSSION_SERVICE} />
        </div>
      </section>

      {/* ── 區塊 6：誰適合使用 OXM ── */}
      <section className="relative overflow-hidden py-12 md:py-16 border-t border-border/60">
        {/* 背景裝飾：極淡品牌漸層 + 低透明度大型 icon，皆為裝飾用，不影響版面與可讀性 */}
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 via-white to-purple-50/50 pointer-events-none" aria-hidden="true" />
        <Search className="absolute -left-8 top-6 h-56 w-56 text-orange-500 opacity-[0.05] rotate-[-12deg] pointer-events-none hidden sm:block" aria-hidden="true" />
        <Factory className="absolute -right-10 top-1/3 h-64 w-64 text-purple-500 opacity-[0.04] rotate-[8deg] pointer-events-none hidden sm:block" aria-hidden="true" />
        <Briefcase className="absolute left-1/4 -bottom-10 h-48 w-48 text-orange-400 opacity-[0.05] rotate-[15deg] pointer-events-none hidden sm:block" aria-hidden="true" />
        <Users className="absolute -right-6 -bottom-6 h-52 w-52 text-purple-400 opacity-[0.04] rotate-[-10deg] pointer-events-none hidden sm:block" aria-hidden="true" />

        <div className="container relative z-10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-10 text-center">誰適合使用 OXM？</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {AUDIENCE_ROLES.map(role => (
              <div key={role.title} className="flex flex-col items-center text-center gap-2 sm:items-start sm:text-left">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                  <role.icon className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="font-bold text-base">{role.title}</h3>
                <p className="text-[13px] text-muted-foreground leading-loose">{role.content}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 區塊 7：OXM 不只是一份工廠名錄 ── */}
      <section className="relative overflow-hidden py-12 md:py-16 border-t border-border/60 bg-slate-50">
        {/* 背景裝飾：極淡品牌漸層、兩個角落光暈、低透明度大型 icon，皆為裝飾用，
            刻意避開中間比較卡片文字下方，不影響版面與可讀性 */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 via-slate-50 to-orange-50/50 pointer-events-none" aria-hidden="true" />
        <div
          className="absolute -top-24 -left-24 h-72 w-72 rounded-full pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(circle, rgba(147,51,234,0.08) 0%, rgba(147,51,234,0) 70%)" }}
        />
        <div
          className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(circle, rgba(249,115,22,0.08) 0%, rgba(249,115,22,0) 70%)" }}
        />
        <Factory className="absolute left-2 top-4 h-40 w-40 text-purple-500 opacity-[0.05] rotate-[-10deg] pointer-events-none hidden md:block" aria-hidden="true" />
        <Search className="absolute right-2 top-8 h-32 w-32 text-orange-500 opacity-[0.05] rotate-[10deg] pointer-events-none hidden md:block" aria-hidden="true" />
        <MessageSquare className="absolute left-6 bottom-6 h-36 w-36 text-orange-400 opacity-[0.04] rotate-[8deg] pointer-events-none hidden md:block" aria-hidden="true" />
        <TrendingUp className="absolute right-6 bottom-10 h-32 w-32 text-purple-400 opacity-[0.04] rotate-[-8deg] pointer-events-none hidden md:block" aria-hidden="true" />

        <div className="container max-w-5xl relative z-10">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">OXM 不只是一份工廠名錄</h2>
            <p className="text-muted-foreground">我們希望使用者不只是找到一個名字，而是能真正了解、聯繫並建立合作。</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className={`${CARD_CLASS} bg-white/70 backdrop-blur-sm`}>
              <h3 className="font-bold mb-4 text-lg text-muted-foreground">一般名錄通常提供</h3>
              <ul className="space-y-3">
                {["公司名稱", "電話", "地址", "基本產業分類"].map(item => (
                  <li key={item} className="flex items-center gap-2 text-[15px] leading-relaxed text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${CARD_CLASS} border-orange-200 bg-white/70 backdrop-blur-sm`}>
              <h3 className="font-bold mb-4 text-lg text-orange-600">OXM 希望提供</h3>
              <ul className="space-y-3">
                {[
                  "主產業與子產業分類", "OEM／ODM 能力", "少量與打樣條件", "工廠與產品資訊",
                  "一鍵詢價與站內訊息", "政府補助與專業資源", "人才與訓練服務", "品牌形象升級",
                  "產業消息", "討論、需求與商務交流",
                ].map(item => (
                  <li key={item} className="flex items-center gap-2 text-[15px] leading-relaxed text-foreground">
                    <CheckCircle2 className="w-5 h-5 text-orange-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-center text-base font-medium mt-8 text-foreground">
            從查詢資料，走向實際聯繫；從單次媒合，走向完整的產業資源串聯。
          </p>
        </div>
      </section>

      {/* ── 區塊 8：最終 CTA ── */}
      <section className="py-12 md:py-16 border-t border-border/60">
        <div className="container max-w-2xl text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">從 OXM，開始找到適合你的台灣產業資源</h2>
          <p className="text-muted-foreground mb-8">
            從找工廠開始，逐步連結補助、人才、品牌、資訊與合作機會。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/search">
              <Button
                size="lg"
                className="w-full sm:w-auto bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0 shadow-lg shadow-orange-500/20"
              >
                <Search className="w-4 h-4 mr-2" />
                搜尋台灣工廠
              </Button>
            </Link>
            <Link href="/upgrade-center">
              <Button size="lg" variant="outline" className="w-full sm:w-auto border-purple-300 text-purple-700 hover:bg-purple-50">
                了解企業升級中心
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
