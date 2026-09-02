import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import {
  ArrowRight, Clapperboard, Users, MessageSquare, Newspaper, Mic,
  Layers, Video, Target, HelpCircle, CheckCircle2, XCircle, Instagram, Facebook, Youtube, Music4,
  Factory, Wrench, FlaskConical, UserCircle2, Rocket, GraduationCap, ClipboardList, PhoneCall,
  FileEdit, Camera, PackageCheck, Sparkles,
} from "lucide-react";
import { SHORT_VIDEO_SERVICES, SHORT_VIDEO_GOALS } from "@shared/shortVideoMarketing";
import {
  GridTexture, FactorySilhouette, ViewfinderCorners, FilmStripBand, PhoneWaveform, SpotlightBeam, NodePath,
} from "@/components/PageArtwork";

// 語意配色對照表，沿用 ERP／ISO 專區「每個欄位存放完整 Tailwind class 字串」
// 的慣例，避免動態字串拼接讓 build 時的 content 掃描器抓不到 class。這裡刻意
// 不重用 ErpOptimization 的橘紫單軸配色分組，改以暖灰／淡橘／淡紫三層區塊
// 底色交錯建立層次，構圖不與 ERP 頁相同。
const TONE_STYLES: Record<string, { bg: string; border: string; iconBg: string; iconColor: string; topBorder: string }> = {
  orange: { bg: "bg-orange-50", border: "border-orange-200", iconBg: "bg-orange-100", iconColor: "text-orange-700", topBorder: "border-orange-400" },
  purple: { bg: "bg-purple-50", border: "border-purple-200", iconBg: "bg-purple-100", iconColor: "text-purple-700", topBorder: "border-purple-400" },
  rose:   { bg: "bg-rose-50",   border: "border-rose-200",   iconBg: "bg-rose-100",   iconColor: "text-rose-700",   topBorder: "border-rose-400" },
  amber:  { bg: "bg-amber-50",  border: "border-amber-200",  iconBg: "bg-amber-100",  iconColor: "text-amber-700",  topBorder: "border-amber-400" },
  teal:   { bg: "bg-teal-50",   border: "border-teal-200",   iconBg: "bg-teal-100",   iconColor: "text-teal-700",   topBorder: "border-teal-400" },
};

const SERVICE_ICONS: Record<string, typeof Clapperboard> = {
  shooting: Clapperboard,
  kol: Users,
  social: MessageSquare,
  media: Newspaper,
  interview: Mic,
};

const SERVICE_TONE: Record<string, string> = {
  shooting: "orange",
  kol: "rose",
  social: "amber",
  media: "teal",
  interview: "purple",
};

const PAIN_POINTS = [
  { text: "技術與製程很多，但外行人看不懂差異", icon: Layers, tone: "orange" },
  { text: "偶爾拍過影片，卻沒有持續的內容方向", icon: Video, tone: "amber" },
  { text: "有觀看或曝光，卻沒有清楚的下一步", icon: Target, tone: "teal" },
  { text: "老闆與技術人員很會講，面對鏡頭卻難以表達", icon: Mic, tone: "purple" },
];

const GOAL_ICONS: Record<string, typeof Clapperboard> = {
  quick_intro: Clapperboard,
  brand_content: MessageSquare,
  audience_kol: Users,
  pr_visibility: Newspaper,
  founder_story: Mic,
  unsure: HelpCircle,
};

const USE_CASES = ["新品上市", "展覽活動", "招募", "企業形象"];

const SERVICE_DETAILS: Record<string, string[]> = {
  shooting: ["需求與受眾盤點", "主題及腳本規劃", "現場拍攝與出鏡引導", "剪輯、字幕與直式格式製作", "實際支數、長度及修改範圍依提案確認"],
  kol: ["依受眾與目標評估合作人選", "規劃開箱、體驗、訪談或情境內容", "確認合作檔期、內容規範與使用授權", "KOL 費用、數量及廣告使用權不得暗示為基本方案內含", "不得宣稱粉絲數等於訂單或保證轉換"],
  social: ["帳號與內容方向盤點", "主題排程、文案及發布節奏", "依平台調整內容形式", "成效回顧與後續內容調整", "發布頻率、留言回覆、廣告投放必須依個別方案確認，不得默認包含"],
  media: ["品牌議題整理", "新聞稿、採訪內容或媒體合作規劃", "依議題選擇適合的露出形式", "實際媒體名單、篇數、刊登形式及時程以提案為準", "明確說明媒體露出不等於第三方獨立推薦，也不等於銷售保證"],
  interview: ["創辦人、技術人員、客戶案例或品牌故事訪談", "背景研究與訪綱設計", "現場訪談引導、拍攝及後製", "可依需求規劃完整訪談與短版精華", "片長、機位及衍生素材依方案確認，不得暗示全部內含"],
};

const COMPARISON_ROWS: { service: string; bestFor: string; notIncluded: string }[] = [
  { service: "短影音企劃與拍攝", bestFor: "快速說明產品、設備或製程", notIncluded: "不等於持續性的社群代操經營" },
  { service: "KOL 合作方案", bestFor: "接觸特定受眾與創作者社群", notIncluded: "不等於保證訂單或成交" },
  { service: "社群內容代操", bestFor: "穩定累積品牌內容", notIncluded: "不等於廣告投放，發布頻率與留言回覆需個別確認" },
  { service: "新聞媒體露出", bestFor: "建立企業議題與公開能見度", notIncluded: "不等於第三方獨立新聞背書" },
  { service: "訪談製作", bestFor: "深入呈現創辦人、技術與品牌故事", notIncluded: "不等於高頻率的短影音經營" },
];

const ADVANTAGES = [
  "用畫面快速說明產品、製程與使用情境",
  "有機會接觸原本未追蹤品牌的受眾",
  "真人、現場與實際操作有助於建立理解與信任",
  "素材可依授權延伸至不同社群及行銷場景",
  "可透過觀看、停留與互動資料持續調整內容",
];

const LIMITS = [
  "觀看數不等於詢問或成交",
  "演算法與自然流量會變動，不能保證爆紅",
  "穩定經營通常需要持續產出與測試",
  "複雜的 B2B 採購仍需官網、案例、業務跟進或深度內容承接",
  "音樂、肖像、KOL、媒體及廣告使用權必須事前確認",
  "工廠機密區域、客戶資料與未公開製程需先確認拍攝邊界",
];

const PLATFORMS = [
  { key: "instagram", label: "Instagram Reels", desc: "品牌視覺、既有社群與互動內容", icon: Instagram, tone: "rose" },
  { key: "facebook", label: "Facebook Reels", desc: "粉絲專頁、在地社群及既有受眾延伸", icon: Facebook, tone: "teal" },
  { key: "tiktok", label: "TikTok", desc: "原生短影音、快速測試與興趣型觸及", icon: Music4, tone: "orange" },
  { key: "youtube", label: "YouTube Shorts", desc: "與頻道、搜尋內容及長影片搭配", icon: Youtube, tone: "purple" },
];

const TRADITIONAL_IDEAS = [
  { text: "工廠與產線走訪", icon: Factory },
  { text: "製程、設備與技術解說", icon: Wrench },
  { text: "產品測試及應用情境", icon: FlaskConical },
  { text: "創辦人或技術人員訪談", icon: UserCircle2 },
  { text: "新品、參展與企業里程碑", icon: Rocket },
  { text: "員工故事、招募及企業文化", icon: GraduationCap },
];

const PROCESS_STEPS = [
  { title: "免費初步諮詢", desc: "了解需求與現況，說明可行方向", icon: PhoneCall },
  { title: "確認目標與受眾", desc: "對齊本次希望達成的目標", icon: Target },
  { title: "選擇服務組合及確認報價範圍", desc: "依需求組合服務，正式報價另行提出", icon: ClipboardList },
  { title: "企劃、腳本或訪綱準備", desc: "依選定服務規劃對應的準備文件", icon: FileEdit },
  { title: "拍攝、合作、發布或媒體執行", desc: "依服務組合實際執行", icon: Camera },
  { title: "成果整理與下一階段建議", desc: "回顧成果，僅選擇社群代操時才進入持續發布；選擇 KOL 或媒體服務時才進入對應流程", icon: PackageCheck },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  { q: "只拍一支影片可以嗎？", a: "可以。短影音企劃與拍攝可以單獨執行，支數、長度與修改範圍會依提案確認，不強制搭配其他服務。" },
  { q: "一定要老闆本人出鏡嗎？", a: "不一定。可以是老闆、技術人員或適合的團隊成員出鏡，實際安排會依內容主題與受訪者意願規劃，現場也會協助出鏡引導。" },
  { q: "短影音能保證流量或訂單嗎？", a: "不能。觀看數不等於詢問或成交，演算法與自然流量會變動，本頁及任何提案都不會承諾保證爆紅、保證流量或保證成交。" },
  { q: "拍攝與社群代操有什麼不同？", a: "短影音企劃與拍攝是產出內容成品；社群內容代操則是持續性的帳號經營，包含排程、文案與發布節奏，兩者是不同服務，可以單獨選擇也可以組合。" },
  { q: "KOL、媒體露出及廣告費是否包含？", a: "不包含。KOL 合作費用、媒體露出的實際安排，以及廣告投放費用，都需要依個別方案另行確認，不會默認包含在基本服務內。" },
  { q: "影片、音樂及 KOL 素材可以永久使用嗎？", a: "需視個別授權範圍而定。音樂、肖像、KOL 及媒體素材的使用範圍與期限，會在合作前確認清楚，不會預設為永久或無限制使用。" },
  { q: "工廠有機密製程時如何拍攝？", a: "會在拍攝前先確認機密區域、客戶資料與未公開製程的邊界，依現場情況調整拍攝角度或範圍，避免揭露不應公開的內容。" },
];

export default function ShortVideoMarketing() {
  return (
    <div className="min-h-screen bg-background">
      {/* 隱藏預覽頁：頁面 meta robots 是第一層防線，Express 端 X-Robots-Tag
          （server/_core/security.ts setupNoIndexRoutes）是第二層，即使爬蟲
          不執行 JS 也能看到。禁止移除或放寬這兩層任何一層。
          正式產品決策更新：本頁上層分類已從「找資源」改為「找形象」，現在由
          /brand Hub 的服務卡提供真正 crawlable 的連結入口（見
          client/src/pages/Brand.tsx）；除了 /brand 之外，網站內其他位置
          （Navbar／手機選單／找資源／Footer／推薦區／搜尋捷徑／sitemap）仍不
          得加入連結入口。noindex,nofollow 維持不變，即使被 /brand 連結也不會
          被索引，只是不再是「只能直接輸入網址」的完全隱藏頁。 */}
      <Helmet>
        <title>短影音與品牌內容行銷｜OXM</title>
        <meta
          name="description"
          content="把工廠裡的專業，拍成市場看得懂的內容。短影音企劃與拍攝、KOL 合作、社群內容代操、新聞媒體露出、訪談製作，可單獨選擇也可依目標組合。初步諮詢免費。"
        />
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/brand" />

      {/* breadcrumb：讓使用者與爬蟲理解上層是「找形象」，不做大型 routing
          refactor，沿用 ResourceCenter.tsx／Brand.tsx 同一種輕量 breadcrumb 樣式。
          pt-16（而非較小的 pt-6）是必要值，不是隨意留白：FloatingBackButton
          是 fixed 定位、top 落在 Navbar 高度（h-16＝64px）+0.75rem 處，實測
          （390px 寬度）pt-6 會讓「返回」按鈕蓋住breadcrumb「首頁」字樣；pt-16
          讓總間距對齊 Brand.tsx／FactoryPhotography.tsx 這兩個新頁面 Hero 區塊
          自己的頂部留白量級，兩者都沒有這個重疊問題。 */}
      <div className="max-w-6xl mx-auto px-4 pt-16">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-orange-700">首頁</Link><span>/</span>
          <Link href="/brand" className="hover:text-orange-700">找形象</Link><span>/</span>
          <span>短影音與品牌內容行銷</span>
        </div>
      </div>

      {/* ── 1. Hero：左側文案＋五個服務標籤＋單一 CTA，右側 code-native 直式
          影片／分鏡工作台視覺（純 CSS／div 呈現四個內容類型段落，不使用任何
          圖片、假觀看數、假客戶或假媒體 Logo）。 ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-stone-50 via-white to-purple-50 py-16 px-4 border-b border-border">
        {/* 裝飾光暈：橘紫為主，加入珊瑚呼應短影音主題，純視覺、不可互動、
            不影響版面。 */}
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <div className="absolute top-10 -right-24 w-80 h-80 rounded-full bg-orange-100/40 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-purple-100/40 blur-3xl" />
          <div className="absolute top-1/2 right-1/3 w-56 h-56 rounded-full bg-rose-100/30 blur-3xl" />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-semibold tracking-wide text-orange-700 mb-3">OXM｜企業品牌內容服務</p>
            <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-4 leading-tight">
              把工廠裡的專業，拍成市場看得懂的內容
            </h1>
            <p className="text-muted-foreground text-sm md:text-base mb-6 leading-relaxed">
              短影音不是把畫面剪快而已。從內容企劃與拍攝，到 KOL 合作、社群內容代操、新聞媒體露出與訪談製作，依照品牌真正想達成的目標，組合適合的內容路徑。
            </p>
            <div className="flex flex-wrap gap-2 mb-7">
              {SHORT_VIDEO_SERVICES.map(s => (
                <Badge key={s.key} variant="outline" className="bg-white/70 border-border text-foreground/80 font-normal">
                  {s.shortLabel}
                </Badge>
              ))}
            </div>
            <Link href="/short-video-marketing/apply">
              <Button size="lg" className="bg-gradient-to-r from-orange-500 to-purple-600 hover:opacity-90 text-white border-0 gap-2">
                申請免費初步諮詢 <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>

          {/* 直式分鏡工作台視覺：模擬手機直式畫框，內部四段時間軸代表四種
              內容類型，純資料驅動、無任何數字或社群互動假數據。 */}
          <div className="flex justify-center lg:justify-end">
            <div className="w-56 rounded-[2rem] border-4 border-foreground/10 bg-white shadow-lg overflow-hidden">
              <div className="bg-foreground/5 px-3 py-2 flex items-center gap-1.5 border-b border-border">
                <span className="w-2 h-2 rounded-full bg-rose-300" />
                <span className="w-2 h-2 rounded-full bg-amber-300" />
                <span className="w-2 h-2 rounded-full bg-teal-300" />
                <span className="ml-auto text-[10px] text-muted-foreground">分鏡工作台</span>
              </div>
              <div className="p-3 space-y-2">
                {[
                  { label: "製程現場", tone: "orange" },
                  { label: "技術解說", tone: "teal" },
                  { label: "品牌訪談", tone: "purple" },
                  { label: "社群發布", tone: "rose" },
                ].map((seg, i) => {
                  const tone = TONE_STYLES[seg.tone];
                  return (
                    <div key={seg.label} className={`rounded-lg border ${tone.border} ${tone.bg} p-2.5 flex items-center gap-2`}>
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${tone.iconBg} text-[11px] font-semibold ${tone.iconColor} shrink-0`}>
                        {i + 1}
                      </span>
                      <span className="text-xs text-foreground/80">{seg.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Hero 插畫：不對稱、略為傾斜呈現拍攝→手機內容→剪輯時間軸／波形→
            曝光，純裝飾，不連結、不可點擊。 */}
        <div className="relative z-10 max-w-5xl mx-auto mt-10 md:mt-14 px-2">
          <div className="rounded-3xl border border-purple-100 bg-white/60 shadow-sm shadow-purple-900/5 p-2 sm:p-3 -rotate-1 md:-rotate-2">
            <img
              src="/hero/short-video-marketing-hero.webp"
              alt="工廠產品拍攝與短影音剪輯示意圖"
              width={1536}
              height={1024}
              className="w-full h-auto rounded-2xl"
            />
          </div>
        </div>
      </section>

      {/* ── 2. 企業常見困境：大型取景框＋補光束代表「產品存在但市場還看不懂」，
          純裝飾置於面板外圍，不遮擋文字。 ── */}
      <section className="relative overflow-hidden py-12 px-4 border-b border-border bg-stone-50">
        <div className="absolute inset-0 z-0 text-orange-900" aria-hidden="true">
          <SpotlightBeam className="absolute -top-10 right-1/4 w-72 h-72 opacity-[0.10]" />
        </div>
        <ViewfinderCorners className="inset-6 md:inset-10 text-purple-900 opacity-[0.12] z-0" size="lg" />
        <div className="relative z-10 max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-2">你不是沒有內容，而是專業還沒被轉成觀眾聽得懂的語言</h2>
          <div className="rounded-2xl border border-border bg-white overflow-hidden mt-5">
            <div className="grid sm:grid-cols-2">
              {PAIN_POINTS.map((point, i) => {
                const tone = TONE_STYLES[point.tone];
                const Icon = point.icon;
                const isLastOverall = i === PAIN_POINTS.length - 1;
                const isBottomRowDesktop = i >= PAIN_POINTS.length - 2;
                const isLeftColDesktop = i % 2 === 0;
                return (
                  <div
                    key={point.text}
                    className={[
                      "flex items-center gap-3 px-5 py-3.5",
                      isLastOverall ? "" : "border-b border-border",
                      isBottomRowDesktop ? "sm:border-b-0" : "",
                      isLeftColDesktop ? "sm:border-r sm:border-border" : "",
                    ].join(" ")}
                  >
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${tone.iconBg} shrink-0`}>
                      <Icon className={`w-4 h-4 ${tone.iconColor}`} />
                    </span>
                    <p className="text-sm text-foreground/80 leading-snug">{point.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. 先決定目的，再選服務 ── */}
      <section className="relative overflow-hidden py-12 px-4 border-b border-border">
        <div className="absolute inset-0 z-0 text-orange-900 flex items-center justify-end pr-4" aria-hidden="true">
          <FilmStripBand frames={5} className="opacity-[0.08] scale-125" />
        </div>
        <div className="relative z-10 max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5">先決定目的，再選服務</h2>
          <div className="relative rounded-2xl border border-border bg-white overflow-hidden">
            {SHORT_VIDEO_GOALS.filter(g => g.key !== "unsure").map((goal, i, arr) => {
              const GoalIcon = GOAL_ICONS[goal.key];
              const service = SHORT_VIDEO_SERVICES.find(s => s.key === goal.suggestedService);
              const ServiceIcon = service ? SERVICE_ICONS[service.key] : HelpCircle;
              return (
                <div
                  key={goal.key}
                  className={`flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 ${i < arr.length - 1 ? "border-b border-border" : ""}`}
                >
                  <div className="flex items-center gap-2.5 sm:w-1/2">
                    <GoalIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground/80">{goal.label}</span>
                  </div>
                  <div className="flex items-center gap-2 sm:w-1/2">
                    <ArrowRight className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                    <ServiceIcon className="w-4 h-4 text-orange-600 shrink-0" />
                    <span className="text-sm font-medium text-foreground">{service?.label ?? "由顧問協助判斷"}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            不確定適合哪一項服務也沒關係，可勾選「不確定，希望由顧問協助判斷」。也適用於新品上市、展覽活動、招募、企業形象等使用情境——
            {USE_CASES.join("、")}皆可依上述目標對照選擇服務。
          </p>
        </div>
      </section>

      {/* ── 4. 五大服務內容：2+3 不對稱編排，五張卡片內容深度不同、視覺不完全
          相同，避免規格式三卡片重複套版。 ── */}
      <section className="relative overflow-hidden py-12 px-4 border-b border-border bg-purple-50/40">
        <div className="absolute inset-0 z-0 text-purple-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.04} />
        </div>
        <ViewfinderCorners className="inset-4 md:inset-8 text-orange-900 opacity-[0.10] z-0" />
        <div className="relative z-10 max-w-6xl mx-auto">
          <h2 className="text-lg font-semibold mb-2">五大服務內容</h2>
          <p className="text-xs text-muted-foreground mb-5">五項服務可單獨選擇，也可以依目標組合，不代表每個方案都包含全部項目。</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-4">
            {SHORT_VIDEO_SERVICES.map((service, i) => {
              const Icon = SERVICE_ICONS[service.key];
              const tone = TONE_STYLES[SERVICE_TONE[service.key]];
              const isFirstRow = i < 2;
              return (
                <Card
                  key={service.key}
                  className={`flex flex-col border border-border border-t-2 ${tone.topBorder} bg-white shadow-sm ${isFirstRow ? "lg:col-span-3" : "lg:col-span-2"}`}
                >
                  <CardContent className="p-6 flex flex-col flex-1">
                    <span className={`inline-flex items-center justify-center w-11 h-11 rounded-full ${tone.iconBg} shrink-0 mb-4`}>
                      <Icon className={`w-5 h-5 ${tone.iconColor}`} />
                    </span>
                    <h3 className="font-semibold text-base mb-1">{service.label}</h3>
                    <p className="text-xs text-muted-foreground mb-4">{service.summary}</p>
                    <ul className="text-xs text-muted-foreground leading-relaxed space-y-1.5 flex-1">
                      {SERVICE_DETAILS[service.key].map(d => (
                        <li key={d} className="flex items-start gap-1.5">
                          <span className={`mt-1 w-1 h-1 rounded-full ${tone.iconColor.replace("text-", "bg-")} shrink-0`} />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="mt-8 text-center max-w-xl mx-auto">
            <Link href="/short-video-marketing/apply">
              <Button size="lg" className="bg-gradient-to-r from-orange-500 to-purple-600 hover:opacity-90 text-white border-0 gap-2">
                申請免費初步諮詢 <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── 5. 服務差異一次說清楚：桌機表格／手機卡片版 ── */}
      <section className="py-12 px-4 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5">服務差異一次說清楚</h2>

          {/* 桌機：可橫向捲動的表格，避免寬表格在窄視窗被截斷 */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="text-left font-semibold px-5 py-3 whitespace-nowrap">服務</th>
                  <th className="text-left font-semibold px-5 py-3">最適合解決什麼</th>
                  <th className="text-left font-semibold px-5 py-3">不會自動包含什麼</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr key={row.service} className={i < COMPARISON_ROWS.length - 1 ? "border-t border-border" : ""}>
                    <td className="px-5 py-3.5 font-medium whitespace-nowrap">{row.service}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{row.bestFor}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{row.notIncluded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 手機：卡片版，避免表格橫向溢出或欄位截斷 */}
          <div className="md:hidden space-y-3">
            {COMPARISON_ROWS.map(row => (
              <Card key={row.service} className="border-border">
                <CardContent className="p-4">
                  <p className="font-semibold text-sm mb-2 break-words">{row.service}</p>
                  <p className="text-xs text-muted-foreground mb-1"><span className="font-medium text-foreground/70">最適合：</span>{row.bestFor}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/70">不含：</span>{row.notIncluded}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            服務可以單獨執行，也可以依目標組合；正式執行前會將平台、數量、授權、發布方式與交付內容逐項說明。
          </p>
        </div>
      </section>

      {/* ── 6. 短影音的優勢與限制 ── */}
      <section className="relative overflow-hidden py-12 px-4 border-b border-border bg-orange-50/40">
        <div className="absolute inset-0 z-0 flex items-start justify-center" aria-hidden="true">
          <SpotlightBeam className="w-96 h-96 text-orange-900 opacity-[0.09]" />
        </div>
        <div className="relative z-10 max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5">把期待說清楚，才不會花了預算卻買錯服務</h2>
          <div className="grid sm:grid-cols-2 gap-5">
            <div className="rounded-2xl border border-teal-200 bg-white p-5">
              <p className="text-sm font-semibold mb-3 flex items-center gap-1.5 text-teal-700">
                <CheckCircle2 className="w-4 h-4" />優勢
              </p>
              <ul className="text-sm text-muted-foreground leading-relaxed space-y-2">
                {ADVANTAGES.map(a => (
                  <li key={a} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-white p-5">
              <p className="text-sm font-semibold mb-3 flex items-center gap-1.5 text-foreground/70">
                <XCircle className="w-4 h-4" />限制
              </p>
              <ul className="text-sm text-muted-foreground leading-relaxed space-y-2">
                {LIMITS.map(l => (
                  <li key={l} className="flex items-start gap-2">
                    <XCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. 平台差異：直式手機＋聲音波形代表跨平台內容承載，純裝飾，
          不含任何真實社群 Logo 或觀看數字。 ── */}
      <section className="relative overflow-hidden py-12 px-4 border-b border-border">
        <div className="absolute inset-0 z-0 text-teal-900 flex items-center justify-end pr-6 md:pr-16" aria-hidden="true">
          <PhoneWaveform className="opacity-[0.10]" />
        </div>
        <div className="relative z-10 max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5">平台差異</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLATFORMS.map(p => {
              const tone = TONE_STYLES[p.tone];
              const Icon = p.icon;
              return (
                <div key={p.key} className={`rounded-xl border ${tone.border} ${tone.bg} p-4`}>
                  <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${tone.iconBg} mb-3`}>
                    <Icon className={`w-4 h-4 ${tone.iconColor}`} />
                  </span>
                  <p className="font-semibold text-sm mb-1">{p.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{p.desc}</p>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            平台不是越多越好，會依目標受眾、既有帳號與內容能力選擇；同一素材跨平台使用時，也可能需要調整長度、字幕、節奏與音樂。
          </p>
        </div>
      </section>

      {/* ── 8. 傳統產業可以拍什麼：工廠線稿置於取景框內，呼應「鏡頭對準工廠
          現場」的主題。 ── */}
      <section className="relative overflow-hidden py-12 px-4 border-b border-border bg-stone-50">
        <div className="absolute inset-0 z-0 text-orange-900" aria-hidden="true">
          <FactorySilhouette className="absolute -bottom-4 -left-8 w-80 h-40 opacity-[0.08] hidden sm:block" />
        </div>
        <ViewfinderCorners className="inset-8 md:inset-12 text-purple-900 opacity-[0.10] z-0 hidden sm:block" />
        <div className="relative z-10 max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5">傳統產業可以拍什麼</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TRADITIONAL_IDEAS.map(item => {
              const Icon = item.icon;
              return (
                <div key={item.text} className="flex items-center gap-2.5 text-sm text-foreground/80 rounded-lg border border-border bg-white p-3.5">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 shrink-0">
                    <Icon className="w-4 h-4 text-orange-700" />
                  </span>
                  {item.text}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 9. 合作流程 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-purple-100 bg-gradient-to-b from-white to-purple-50/50">
        <div className="absolute inset-0 text-purple-800" aria-hidden="true">
          <FilmStripBand frames={7} className="absolute left-1/2 top-12 -translate-x-1/2 opacity-[0.08]" />
        </div>
        <div className="relative z-10 max-w-3xl mx-auto">
          <h2 className="text-lg font-semibold mb-6 text-center">合作流程</h2>
          <div className="rounded-2xl border border-border bg-gradient-to-br from-orange-50/60 via-white to-purple-50/60 p-6 md:p-8">
            {/* 貫穿六個步驟的淡色垂直導引線，強化「拍攝路徑」從諮詢到成果的
                連續感，位置對齊編號圓點左緣，純裝飾不影響文字排版。 */}
            <div className="relative space-y-4">
              <NodePath
                count={PROCESS_STEPS.length}
                orientation="vertical"
                className="absolute left-[12px] top-0 bottom-0 w-3 text-orange-700 opacity-40 z-0"
              />
              {PROCESS_STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border border-border text-xs font-semibold text-orange-700 shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{step.title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── 10. FAQ ── */}
      <section className="relative overflow-hidden py-12 px-4 border-b border-border bg-muted/20">
        <div className="absolute inset-0 z-0 text-purple-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.04} />
        </div>
        <div className="relative z-10 max-w-3xl mx-auto">
          <h2 className="text-lg font-semibold mb-5">常見問題</h2>
          <Accordion type="single" collapsible>
            {FAQ_ITEMS.map((item, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-sm text-left">{item.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── 最終 CTA：取景框、工廠產品、手機內容與播放路徑匯聚成完整收尾場景 ── */}
      <section className="relative overflow-hidden py-20 px-4 bg-gradient-to-br from-orange-100 via-rose-50 to-purple-100">
        <div className="absolute inset-0 z-0 text-orange-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.05} size={54} />
          <FactorySilhouette className="absolute -bottom-4 left-4 w-72 h-40 opacity-[0.16] hidden sm:block" />
          <SpotlightBeam className="absolute -top-16 left-[28%] h-96 w-80 text-amber-400 opacity-35" />
        </div>
        <ViewfinderCorners className="inset-6 md:inset-10 text-purple-900 opacity-25 z-0" size="lg" />
        <div className="absolute right-8 bottom-5 z-0 text-purple-800 hidden md:block" aria-hidden="true">
          <PhoneWaveform className="opacity-30" />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto rounded-[2rem] border border-white/80 bg-white/75 px-6 py-10 text-center shadow-xl shadow-purple-900/10 backdrop-blur-sm">
          <Badge className="bg-orange-100 text-orange-700 border-orange-200 border mb-4 gap-1">
            <Sparkles className="w-3 h-3" />初步諮詢免費
          </Badge>
          <p className="text-sm text-muted-foreground mb-6">由 OXM 協助需求整理、服務組合建議與後續案件追蹤</p>
          <Link href="/short-video-marketing/apply">
            <Button size="lg" className="bg-gradient-to-r from-orange-500 to-purple-600 hover:opacity-90 text-white border-0 gap-2">
              申請免費初步諮詢 <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
