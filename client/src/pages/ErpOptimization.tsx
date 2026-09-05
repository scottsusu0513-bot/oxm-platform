import { Link, useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import Navbar from "@/components/Navbar";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { useRemoveServerSeoHead } from "@/hooks/useRemoveServerSeoHead";
import { PUBLIC_PAGE_SEO } from "@/lib/publicPageSeo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ConveyorRoute,
  FactorySilhouette,
  GaugeArcs,
  GridTexture,
  HubSpokes,
} from "@/components/PageArtwork";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import {
  ArrowRight, ClipboardList, FileSearch, Boxes, Factory, Workflow, Gauge,
  ClipboardCheck, Handshake, Users2, ArrowDown, PackageSearch, Route as RouteIcon,
  Ruler, Clock3, Repeat, ShoppingCart, Warehouse, CalendarClock, FileBarChart2,
  FileSpreadsheet, Unlink2, HelpCircle, PackageX, TrendingDown, AlertTriangle,
} from "lucide-react";

// CTA 統一導向 /erp-optimization/apply 正式申請表單。與另一個隱藏預覽專區
// 彼此獨立，不互相導流。

// 語意配色對照表：顏色依卡片文案的實際含義分組，不是機械式輪替。每個 tone
// 提供淡色卡片底、邊框、圖示底色／圖示色與左側色條，讓四個主要內容區塊
// （工廠常見困境／三條需求路徑／ERP,MES,產線改善差異／可協助盤點的改善範圍）
// 產生層次，同時保留 OXM 橘紫品牌色給主要 CTA、共用諮詢入口與需要表現 OXM
// 角色的位置，不整頁機械式套用橘紫。色階統一使用 Tailwind 內建的 50/100/200/700
// 淡色階，避免大面積深色或過重飽和度。
// 每個欄位都存放完整、獨立的 Tailwind class 字串（不做動態字串拼接產生新的
// class，例如不會寫 `${tone.bg}/40` 這種片段組合），確保建置時 Tailwind 的
// content 掃描器能在原始碼中直接找到每個完整 class 名稱並產生對應樣式。
const TONE_STYLES: Record<string, { bg: string; border: string; iconBg: string; iconColor: string; topBorder: string }> = {
  green:  { bg: "bg-green-50",  border: "border-green-200",  iconBg: "bg-green-100",  iconColor: "text-green-700",  topBorder: "border-green-400" },
  blue:   { bg: "bg-blue-50",   border: "border-blue-200",   iconBg: "bg-blue-100",   iconColor: "text-blue-700",   topBorder: "border-blue-400" },
  indigo: { bg: "bg-indigo-50", border: "border-indigo-200", iconBg: "bg-indigo-100", iconColor: "text-indigo-700", topBorder: "border-indigo-400" },
  teal:   { bg: "bg-teal-50",   border: "border-teal-200",   iconBg: "bg-teal-100",   iconColor: "text-teal-700",   topBorder: "border-teal-400" },
  amber:  { bg: "bg-amber-50",  border: "border-amber-200",  iconBg: "bg-amber-100",  iconColor: "text-amber-700",  topBorder: "border-amber-400" },
  rose:   { bg: "bg-rose-50",   border: "border-rose-200",   iconBg: "bg-rose-100",   iconColor: "text-rose-700",   topBorder: "border-rose-400" },
  purple: { bg: "bg-purple-50", border: "border-purple-200", iconBg: "bg-purple-100", iconColor: "text-purple-700", topBorder: "border-purple-400" },
};

// 工廠常見困境：Excel／紙本重複輸入屬「表單整理」→綠色；資訊斷裂／不同步／
// 詢問現場屬「資料與資訊」→藍色；成本利潤難掌握屬「卡關／損耗」→低飽和珊瑚
// 紅；搬運等待瓶頸屬「產線效率」→暖色琥珀。不需要六種強烈顏色，同類困境
// 共用同一色系分組。
const PAIN_POINTS = [
  { text: "同一份資料在紙本、Excel 及不同系統重複輸入", tone: "green", icon: FileSpreadsheet },
  { text: "訂單、採購、庫存與生產資訊無法互相連動", tone: "blue", icon: Unlink2 },
  { text: "排程與生產進度只能一直詢問現場", tone: "blue", icon: HelpCircle },
  { text: "帳面庫存與實際庫存經常不一致", tone: "blue", icon: PackageX },
  { text: "產品成本、損耗與利潤難以及時掌握", tone: "rose", icon: TrendingDown },
  { text: "現場存在搬運、等待、回流、在製品堆積或瓶頸", tone: "amber", icon: AlertTriangle },
];

// 三條需求路徑：ERP 導入＝企業管理制度建立→靛藍；產線與動線優化＝現場效率
// →暖色琥珀；整合改善＝跨部門診斷規劃→紫色系（與下方共用諮詢入口的 OXM
// 品牌色相呼應，因為「整合改善」本質就是 OXM 扮演診斷／整合角色）。
const NEED_PATHS = [
  {
    icon: Boxes,
    title: "ERP 導入",
    desc: "適合仍以紙本、Excel、分散系統或舊系統管理，希望整理訂單、採購、庫存、生產與成本資訊的工廠。",
    tone: "indigo",
  },
  {
    icon: RouteIcon,
    title: "產線與動線優化",
    desc: "適合現場存在搬運距離長、等待、回流、在製品堆積、瓶頸、空間利用或安全問題的工廠。",
    tone: "amber",
  },
  {
    icon: Workflow,
    title: "整合改善",
    desc: "適合管理資訊與生產現場互相卡住，需要先診斷，再決定 ERP、MES、倉儲或產線調整順序的工廠。",
    tone: "purple",
  },
];

// ERP／MES／產線改善的差異：ERP→靛藍（企業管理），MES／現場報工→青綠（生產
// 執行與現場資訊，介於資料與現場之間），產線優化→暖色琥珀（實體製程與動線）。
const COMPARISON = [
  {
    icon: ClipboardList,
    title: "ERP",
    subtitle: "企業資源與跨部門資訊",
    desc: "整理訂單、採購、庫存、生產、財務與成本等跨部門管理資訊，讓不同部門看到一致的資料。",
    tone: "indigo",
  },
  {
    icon: Factory,
    title: "MES／現場報工",
    subtitle: "生產執行與現場資訊",
    desc: "連接管理系統與生產現場，處理工單執行、報工、在製品、品質、設備與追溯等即時現場資訊。",
    tone: "teal",
  },
  {
    icon: RouteIcon,
    title: "產線優化",
    subtitle: "實體製程、動線與作業方法",
    desc: "處理製程順序、瓶頸、等待、物料搬運、設備佈置、空間、安全與人因等現場實體條件。",
    tone: "amber",
  },
];

// 可協助盤點的改善範圍：訂單／採購／成本報表屬「系統與資料」→藍色；生產
// 排程、工單報工與現場動線屬「流程與產線」→暖色琥珀；品質紀錄與追溯介於
// 資料與現場之間→青綠。
const ASSESSMENT_SCOPE = [
  { icon: ShoppingCart, label: "訂單與報價", tone: "blue" },
  { icon: Boxes, label: "採購與庫存", tone: "blue" },
  { icon: CalendarClock, label: "生產排程、工單與報工", tone: "amber" },
  { icon: ClipboardCheck, label: "品質紀錄與追溯", tone: "teal" },
  { icon: FileBarChart2, label: "成本與管理報表", tone: "blue" },
  { icon: Warehouse, label: "物料流、設備佈置與現場動線", tone: "amber" },
];

const FREE_STEPS = ["了解工廠目前問題", "初步判斷需求方向", "媒合適合的顧問或系統整合資源"];
const FORMAL_STEPS = [
  "現場診斷",
  "現況流程／動線盤點",
  "問題優先順序與改善藍圖",
  "系統設定、資料移轉或現場調整",
  "試行、測試與教育訓練",
  "驗收與後續追蹤",
];

const DELIVERABLES = [
  "現況流程與問題清單",
  "改善優先順序",
  "系統需求與模組規劃",
  "資料移轉及系統整合規劃",
  "未來流程、物料流或產線佈置建議",
  "試行、教育訓練與驗收規劃",
  "可追蹤指標與改善前基準",
];

const METRICS = [
  { icon: PackageSearch, label: "庫存準確率" },
  { icon: Clock3, label: "交期達成率" },
  { icon: Boxes, label: "在製品數量" },
  { icon: Ruler, label: "搬運距離" },
  { icon: Clock3, label: "等待時間" },
  { icon: Repeat, label: "生產週期" },
  { icon: FileSearch, label: "人工重複輸入時間" },
];

const FAQ_ITEMS: { q: string; a: string }[] = [
  { q: "已經有 ERP，還需要全部更換嗎？", a: "不一定。初步諮詢會先了解現有系統的使用狀況與痛點，再判斷是調整既有系統、擴充模組，還是需要更換，不會預設一定要全部換掉。" },
  { q: "ERP 與 MES 有什麼不同？", a: "ERP 整理訂單、採購、庫存、生產與財務等跨部門管理資訊；MES 則連接管理系統與生產現場，處理工單執行、報工、在製品與品質追溯等即時現場資訊，兩者可以整合，但不是同一套服務。" },
  { q: "導入期間是否一定會停工？", a: "不一定。是否影響產線運作、影響程度與時間，會依現況、導入範圍與方式而不同，實際評估會在現場診斷後說明，這裡不做一定或保證的承諾。" },
  { q: "可以只改善產線，不導入 ERP 嗎？", a: "可以。三條需求路徑中的「產線與動線優化」就是先處理現場動線、搬運、瓶頸等問題，不需要同時導入 ERP。" },
  { q: "目前只用紙本或 Excel，也適合諮詢嗎？", a: "適合。初步諮詢的目的就是協助釐清目前用紙本或 Excel 管理時遇到的問題，再判斷後續方向。" },
  { q: "舊資料可以移轉嗎？", a: "多數情況可以評估移轉，但實際可行性、範圍與方式，需視舊資料的格式、完整度與新系統需求，於正式診斷階段確認。" },
  { q: "導入需要多久？", a: "所需時間依工廠規模、現況、導入範圍與方式而異，無法一概而論，實際時程會於現況盤點與改善藍圖階段說明。" },
  { q: "正式費用如何計算？", a: "正式費用會依診斷結果、導入範圍與所需資源另行提出方案與報價，本頁不預先寫死金額或承諾。" },
  { q: "是否可能申請政府補助？", a: "是否符合相關政府輔導或補助資源，需視工廠條件及當年度計畫規定而定。" },
  { q: "初步諮詢是否收費？", a: "初步諮詢免費，包含需求了解、初步分流及顧問媒合；正式診斷、系統建置、現場調整等執行費用，將依工廠需求另行提出方案與報價。" },
];

export default function ErpOptimization() {
  useRemoveServerSeoHead();
  const [, navigate] = useLocation();
  const openConsultPreview = () => navigate("/erp-optimization/apply");

  return (
    <div className="min-h-screen bg-background">
      {/* 正式開放服務 Landing Page：Final Public Index Release 已移除
          server/_core/security.ts NOINDEX_EXACT_PATHS 裡的隱藏 gate，
          title/description/canonical 改引用 shared/seo/publicPages.ts，
          與伺服器端初始 HTML head 注入共用同一份資料。
          /erp-optimization/apply 是申請表單，非內容型 Landing Page，仍維持
          noindex，不受本次開放影響。 */}
      <Helmet>
        <title>{PUBLIC_PAGE_SEO.erpOptimization.title}</title>
        <meta name="description" content={PUBLIC_PAGE_SEO.erpOptimization.description} />
        <link rel="canonical" href={PUBLIC_PAGE_SEO.erpOptimization.canonical} />
      </Helmet>

      <Navbar />
      <FloatingBackButton fallbackHref="/resources" />

      {/* breadcrumb：讓使用者與爬蟲理解上層是「找資源」，pt-16 避開
          FloatingBackButton，說明同 ShortVideoMarketing.tsx／
          CertificationCenter.tsx。 */}
      <div className="max-w-4xl mx-auto px-4 pt-16">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-indigo-700">首頁</Link><span>/</span>
          <Link href="/resources" className="hover:text-indigo-700">找資源</Link><span>/</span>
          <span>ERP、MES 與產線優化</span>
        </div>
      </div>

      {/* ── 1. 首屏：雙軌流程視覺（資訊流／實體生產流） ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-50/70 via-white to-orange-50/40 py-16 px-4">
        {/* 裝飾光暈：靛藍／科技藍呼應系統整合主題，橘紫維持既有 CTA 品牌色
            呼應，純視覺、不可互動、不影響版面。 */}
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="absolute -top-20 -right-16 w-80 h-80 rounded-full bg-indigo-200/40 blur-3xl" />
          <div className="absolute top-16 -left-20 w-72 h-72 rounded-full bg-blue-100/40 blur-3xl" />
          <div className="absolute bottom-[-3rem] right-1/4 w-64 h-64 rounded-full bg-purple-100/30 blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-4">
            先理順流程，再導入真正適合工廠的系統。
          </h1>
          <p className="text-muted-foreground text-sm md:text-base mb-8 max-w-2xl mx-auto leading-relaxed">
            從訂單、採購、庫存、生產到成本資訊，搭配現場動線與物料流診斷，協助工廠把管理和產線一起理順。
          </p>

          {/* 雙軌流程：資訊流 + 實體生產流。放寬 max-width、節點列改
              flex-nowrap + shrink-0 + whitespace-nowrap，讓每條流程的五個
              節點固定同一行，不會有「成本」「出貨」孤立掉到第二行；桌機
              兩欄並排，手機改上下堆疊但每條流程內部仍不換行。 */}
          <div className="grid sm:grid-cols-2 gap-4 mb-8 text-left max-w-4xl mx-auto">
            <div className="flex min-h-28 min-w-0 flex-col items-center justify-center rounded-lg border border-orange-200 bg-white/70 p-4 text-center">
              <p className="mb-3 text-xs font-semibold text-orange-700">管理資訊流</p>
              <div className="flex flex-nowrap items-center justify-center gap-1 text-xs text-muted-foreground">
                <span className="px-1.5 py-1 rounded bg-orange-50 whitespace-nowrap shrink-0">訂單</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="px-1.5 py-1 rounded bg-orange-50 whitespace-nowrap shrink-0">採購</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="px-1.5 py-1 rounded bg-orange-50 whitespace-nowrap shrink-0">庫存</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="px-1.5 py-1 rounded bg-orange-50 whitespace-nowrap shrink-0">生產</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="px-1.5 py-1 rounded bg-orange-50 whitespace-nowrap shrink-0">成本</span>
              </div>
            </div>
            <div className="flex min-h-28 min-w-0 flex-col items-center justify-center rounded-lg border border-purple-200 bg-white/70 p-4 text-center">
              <p className="mb-3 text-xs font-semibold text-purple-700">實體生產流</p>
              <div className="flex flex-nowrap items-center justify-center gap-1 text-xs text-muted-foreground">
                <span className="px-1.5 py-1 rounded bg-purple-50 whitespace-nowrap shrink-0">物料</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="px-1.5 py-1 rounded bg-purple-50 whitespace-nowrap shrink-0">工站</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="px-1.5 py-1 rounded bg-purple-50 whitespace-nowrap shrink-0">設備</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="px-1.5 py-1 rounded bg-purple-50 whitespace-nowrap shrink-0">品檢</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="px-1.5 py-1 rounded bg-purple-50 whitespace-nowrap shrink-0">出貨</span>
              </div>
            </div>
          </div>

          <Badge className="bg-orange-100 text-orange-700 border-orange-200 border mb-6">初步諮詢免費</Badge>
          <div>
            <Button
              size="lg"
              className="bg-gradient-to-r from-orange-500 to-purple-600 hover:opacity-90 text-white border-0 gap-2"
              onClick={openConsultPreview}
            >
              申請免費初步諮詢 <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Hero 插畫：原料／訂單→產線工站→資料整合→倉儲→出貨的橫向流程
            示意，純裝飾，不連結、不可點擊。 */}
        <div className="relative max-w-4xl mx-auto mt-10 md:mt-12">
          <div className="rounded-3xl border border-indigo-100 bg-white/60 shadow-sm shadow-indigo-900/5 p-2 sm:p-3">
            <img
              src="/hero/erp-optimization-hero.webp"
              alt="訂單、產線與倉儲整合流程示意圖"
              width={1536}
              height={1024}
              className="w-full h-auto rounded-2xl"
            />
          </div>
        </div>
      </section>

      {/* ── 2. 工廠常見困境：整合式問題清單面板，不是六張獨立 PPT 式色塊卡片。
          外層單一面板，內部用細分隔線＋小型圖示底色建立辨識，避免每格各自
          擁有完整外框與大片色底。非互動內容，刻意不加 hover／cursor 效果。 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-blue-100 bg-gradient-to-br from-slate-100 via-blue-50 to-stone-50">
        <div className="absolute inset-0 text-slate-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.065} size={54} />
          <FactorySilhouette className="absolute -bottom-10 -right-24 w-[40rem] h-60 opacity-[0.1]" />
          <ConveyorRoute className="absolute left-0 right-0 bottom-5 h-28 w-full text-blue-600 opacity-25" nodes={6} />
        </div>
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-orange-500" />工廠常見困境
          </h2>
          <div className="relative rounded-3xl border border-blue-200/80 bg-white/90 overflow-hidden shadow-lg shadow-blue-900/5">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-green-400 via-blue-500 to-amber-400" aria-hidden="true" />
            <div className="absolute right-8 top-6 flex items-center gap-3 opacity-45" aria-hidden="true">
              <span className="h-3 w-3 rounded-full bg-blue-500" />
              <span className="w-14 border-t-2 border-dashed border-blue-400" />
              <span className="h-3 w-3 rounded-full border-2 border-rose-400 bg-white" />
              <span className="w-10 border-t-2 border-dashed border-amber-400" />
              <span className="h-4 w-4 rounded-sm bg-amber-400" />
            </div>
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

      {/* ── 3. 三條需求路徑（只說明差異，不各自帶 CTA）── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-indigo-100 bg-indigo-50/70">
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Workflow className="w-5 h-5 text-purple-500" />三條需求路徑
          </h2>
          <p className="text-xs text-muted-foreground mb-5">先理解目前最卡在哪裡，三張卡片只協助判斷方向，實際申請請透過頁面上的諮詢入口提出。</p>
          {/* 精緻 B2B 服務卡：白色表面＋hairline 邊框＋語意色僅集中在圖示底與
              頂部細色條，不再整圈飽和色底／色框。非互動卡片，不加 hover 浮起
              或 cursor pointer。 */}
          <div className="relative grid gap-4 pt-3 sm:grid-cols-3">
            {NEED_PATHS.map(path => {
              const Icon = path.icon;
              const tone = TONE_STYLES[path.tone];
              return (
                <Card key={path.title} className={`relative flex flex-col border border-border border-t-2 ${tone.topBorder} bg-white/95 shadow-md`}>
                  <CardContent className="p-6 flex flex-col flex-1">
                    <span className={`inline-flex items-center justify-center w-11 h-11 rounded-full ${tone.iconBg} shrink-0 mb-4`}>
                      <Icon className={`w-5 h-5 ${tone.iconColor}`} />
                    </span>
                    <h3 className="font-semibold text-base mb-2">{path.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed flex-1">{path.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 4. ERP、MES 與產線改善的差異 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-indigo-100 bg-gradient-to-br from-white via-slate-50 to-teal-50/70">
        <div className="absolute -left-28 top-8 h-72 w-72 rounded-full border-[46px] border-indigo-100/70" aria-hidden="true" />
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-orange-500" />ERP、MES 與產線改善的差異
          </h2>
          <div className="mb-7 rounded-3xl border border-indigo-100 bg-white/80 p-5 shadow-sm" aria-hidden="true">
            <p className="mb-4 text-center text-xs font-semibold tracking-wide text-slate-700">三種工具，各自處理不同層面的問題</p>
            <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
              <div className="flex flex-col items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm"><ClipboardList className="h-6 w-6" /></span>
                <span className="text-sm font-bold text-indigo-900">ERP</span>
                <span className="mt-1 text-[11px] leading-snug text-indigo-700">跨部門管理資料</span>
              </div>
              <ArrowRight className="mx-auto h-5 w-5 rotate-90 self-center text-slate-400 md:rotate-0" />
              <div className="flex flex-col items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 p-4 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm"><Factory className="h-6 w-6" /></span>
                <span className="text-sm font-bold text-teal-900">MES／現場報工</span>
                <span className="mt-1 text-[11px] leading-snug text-teal-700">現場執行資訊</span>
              </div>
              <ArrowRight className="mx-auto h-5 w-5 rotate-90 self-center text-slate-400 md:rotate-0" />
              <div className="flex flex-col items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm"><RouteIcon className="h-6 w-6" /></span>
                <span className="text-sm font-bold text-amber-900">產線優化</span>
                <span className="mt-1 text-[11px] leading-snug text-amber-700">實體流程與動線</span>
              </div>
            </div>
          </div>
          {/* 手機版直向卡片，桌機版三欄並排；刻意不用需要水平拖動的寬表格 */}
          <div className="grid sm:grid-cols-3 gap-4">
            {COMPARISON.map(item => {
              const Icon = item.icon;
              const tone = TONE_STYLES[item.tone];
              return (
                <Card key={item.title} className={`border-t-4 ${tone.topBorder} ${tone.bg}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${tone.iconBg} shrink-0`}>
                        <Icon className={`w-3.5 h-3.5 ${tone.iconColor}`} />
                      </span>
                      <span className="font-semibold text-sm">{item.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-2">{item.subtitle}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            三者可以整合搭配，但分別解決不同層面的問題，不是同一套服務，也不代表每間工廠都要三個一起導入。
          </p>
        </div>
      </section>

      {/* ── 5. 可協助盤點的改善範圍 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-blue-100 bg-[#edf4f8]">
        <div className="absolute inset-0 text-blue-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.06} size={44} />
          <ConveyorRoute className="absolute bottom-0 left-0 h-36 w-full opacity-25" nodes={7} />
        </div>
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-lg font-semibold mb-5 flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-purple-500" />可協助盤點的改善範圍
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ASSESSMENT_SCOPE.map(item => {
              const Icon = item.icon;
              const tone = TONE_STYLES[item.tone];
              return (
                <div key={item.label} className={`flex items-center gap-2 text-sm text-foreground/80 rounded-xl border border-white border-l-4 ${tone.border} ${tone.bg} p-3 shadow-sm`}>
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${tone.iconBg} shrink-0`}>
                    <Icon className={`w-3.5 h-3.5 ${tone.iconColor}`} />
                  </span>
                  {item.label}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            實際盤點、評估、規劃與依方案執行的範圍，會依工廠現況與需求確認，不代表每個案件都必然包含以上全部項目。
          </p>
        </div>
      </section>

      {/* ── 6. 執行流程（整個區塊共用同一條中央軸線，從標題到說明都置中）── */}
      <section className="relative overflow-hidden py-16 px-4 border-b border-indigo-800 bg-slate-950 text-white">
        <div className="absolute inset-0 text-blue-300" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.11} size={60} />
          <FactorySilhouette className="absolute -bottom-8 -right-20 h-56 w-[38rem] opacity-[0.13]" />
          <ConveyorRoute className="absolute left-0 top-10 h-36 w-full opacity-25" nodes={6} />
        </div>
        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className="text-lg font-semibold mb-6 flex items-center justify-center gap-2">
            <RouteIcon className="w-5 h-5 text-orange-500" />執行流程
          </h2>

          {/* 淡色漸層流程主卡：把免費／正式兩段流程收在同一張卡片內，減少
              大面積留白，同時避免大面積深色背景。 */}
          <div className="rounded-3xl border border-white/20 bg-white/95 p-6 text-foreground shadow-2xl shadow-black/20 md:p-8">
            <div className="mb-8">
              <p className="text-xs font-semibold text-orange-700 mb-3">免費初步階段</p>
              <div className="flex flex-col items-center sm:flex-row sm:justify-center gap-2">
                {FREE_STEPS.map((step, i) => (
                  <div key={step} className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-sm bg-orange-100/80 text-orange-700 px-3 py-2 rounded-full font-medium">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-200 text-[11px] shrink-0">{i + 1}</span>
                      {step}
                    </div>
                    {i < FREE_STEPS.length - 1 && (
                      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
                    )}
                    {i < FREE_STEPS.length - 1 && (
                      <ArrowDown className="w-4 h-4 text-muted-foreground shrink-0 sm:hidden" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-purple-700 mb-4">正式服務（需確認方案與報價後才進行）</p>
              {/* inline-flex 讓這個窄欄本身在 text-center 的父層中完整置中，
                  欄內用 items-start 維持「編號＋文字」靠左閱讀。 */}
              <div className="relative inline-flex flex-col items-start gap-3 pl-10">
                <span className="absolute bottom-3 left-3 top-3 w-0.5 rounded-full bg-gradient-to-b from-purple-400 via-purple-500 to-purple-600" aria-hidden="true" />
                {FORMAL_STEPS.map((step, i) => (
                  <div key={step} className="relative flex items-center gap-2.5">
                    <span className="absolute -left-[2.15rem] h-3 w-3 rounded-full bg-purple-600 ring-4 ring-purple-100" aria-hidden="true" />
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold shrink-0">{i + 1}</span>
                    <span className="text-sm text-muted-foreground">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            實際步驟會依服務範圍調整，不代表每個案件都包含全部項目。
          </p>
        </div>
      </section>

      {/* ── 7. 可能交付內容：標題、清單、說明全部共用中央軸線；7 個項目用
          flex-wrap + justify-center，最後一項不會孤零零靠左 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-blue-100 bg-gradient-to-b from-blue-50 to-white">
        <div className="absolute inset-0 text-blue-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.05} size={48} />
          <FactorySilhouette className="absolute -bottom-8 -left-20 h-48 w-[32rem] opacity-[0.1]" />
          <ConveyorRoute className="absolute inset-x-12 bottom-10 h-32 w-auto opacity-30" nodes={7} />
        </div>
        <div className="relative max-w-5xl mx-auto text-center">
          <h2 className="text-lg font-semibold mb-5 flex items-center justify-center gap-2">
            <FileBarChart2 className="w-5 h-5 text-orange-500" />可能交付內容
          </h2>
          <div className="relative flex flex-wrap justify-center gap-3 rounded-3xl border border-blue-100 bg-white/70 p-5 shadow-sm md:p-7">
            {DELIVERABLES.map(item => (
              <div key={item} className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-100 bg-white/90 px-3 py-3 text-sm text-muted-foreground shadow-sm sm:w-48 lg:w-52 xl:w-56">
                <ClipboardCheck className="w-4 h-4 text-green-600 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            依正式合作範圍提供，不代表所有方案都固定附贈以上全部內容。
          </p>
        </div>
      </section>

      {/* ── 8. 可衡量成果：標題、標籤群組與說明全部共用中央軸線 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-purple-100 bg-gradient-to-br from-white via-purple-50/60 to-orange-50/50">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full border-[54px] border-purple-200/30" aria-hidden="true" />
        <div className="relative max-w-5xl mx-auto text-center">
          <h2 className="text-lg font-semibold mb-5 flex items-center justify-center gap-2">
            <Gauge className="w-5 h-5 text-purple-500" />可衡量成果
          </h2>
          <div className="mx-auto mb-6 grid max-w-3xl gap-5 rounded-3xl border border-purple-100 bg-white/85 p-5 shadow-sm md:grid-cols-[17rem_1fr] md:items-center" aria-hidden="true">
            <div className="rounded-2xl bg-purple-50/80 p-3 text-center">
              <p className="mb-1 text-xs font-semibold text-purple-800">改善追蹤儀表</p>
              <GaugeArcs className="h-36 w-full" />
              <div className="-mt-3 flex justify-between px-4 text-[10px] font-medium text-slate-500">
                <span>現況基準</span><span>持續改善</span>
              </div>
            </div>
            <div className="rounded-2xl bg-white p-3">
              <p className="mb-3 text-center text-xs font-semibold text-slate-700">前後基準趨勢</p>
              <div className="relative flex h-28 items-end gap-3 border-b border-l border-purple-200 px-4 pb-2">
                <span className="absolute left-2 right-2 top-8 border-t border-dashed border-orange-300" />
                {[34, 50, 44, 66, 58, 80].map((height, index) => (
                  <span key={height} className={`flex-1 rounded-t ${index > 3 ? "bg-orange-400" : "bg-purple-300"}`} style={{ height }} />
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 text-center text-[10px] font-medium text-slate-500">
                <span>改善前基準</span><span>追蹤中</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {METRICS.map(item => {
              const Icon = item.icon;
              return (
                <span key={item.label} className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-purple-50 text-purple-700">
                  <Icon className="w-3.5 h-3.5 shrink-0" />{item.label}
                </span>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            以上為可建立前後基準的參考指標方向，實際指標項目與數值須由顧問依工廠現況及專案範圍確認，本頁不提供固定百分比或保證數字。
          </p>
        </div>
      </section>

      {/* ── 9. OXM 可以提供的協助 + 重要聲明 ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-amber-100 bg-[#f8f5ee]">
        <div className="absolute inset-0 text-amber-950" aria-hidden="true">
          <FactorySilhouette className="absolute -bottom-12 -left-24 h-52 w-[34rem] opacity-[0.09]" />
          <ConveyorRoute className="absolute right-0 top-8 h-28 w-2/3 opacity-20" nodes={4} />
        </div>
        <div className="relative max-w-3xl mx-auto grid gap-4 md:grid-cols-2">
          <Card className="border-border">
            <CardContent className="p-5">
              <p className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                <Handshake className="w-4 h-4 text-orange-600" />OXM 可以提供的協助
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                OXM 負責需求初步整理、顧問／系統整合夥伴媒合與案件追蹤。實際診斷、軟體方案、系統建置、資料移轉、現場調整、報價與驗收，由承辦專業團隊依個案範圍確認。
              </p>
            </CardContent>
          </Card>

          <Card className="border-border bg-white">
            <CardContent className="p-5">
              <p className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                <Users2 className="w-4 h-4 text-muted-foreground" />重要聲明
              </p>
              <ul className="text-xs text-muted-foreground leading-relaxed list-disc list-inside space-y-1">
                <li>OXM 不是 ERP 或 MES 產品品牌。</li>
                <li>OXM 不預設工廠一定要更換現有系統。</li>
                <li>OXM 不保證固定改善幅度或導入時程。</li>
                <li>OXM 不保證完全不影響生產。</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── 11. FAQ ── */}
      <section className="relative overflow-hidden py-14 px-4 border-b border-border bg-gradient-to-b from-white to-slate-100">
        <div className="absolute inset-0 text-slate-800" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.035} size={64} />
        </div>
        <div className="relative max-w-3xl mx-auto">
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

      {/* ── 12. 最終 CTA ── */}
      <section className="relative overflow-hidden py-20 px-4 bg-gradient-to-br from-blue-100 via-white to-purple-100">
        <div className="absolute inset-0 text-blue-900" aria-hidden="true">
          <GridTexture className="absolute inset-0" opacity={0.055} size={52} />
          <FactorySilhouette className="absolute -bottom-4 -left-20 h-48 w-[34rem] opacity-[0.15] hidden sm:block" />
          <ConveyorRoute className="absolute inset-x-16 bottom-10 h-32 w-auto opacity-35" nodes={6} />
          <HubSpokes className="absolute -right-16 top-4 h-52 w-96 text-purple-800 opacity-20 hidden md:block" />
        </div>
        <div className="relative max-w-2xl mx-auto rounded-[2rem] border border-white/80 bg-white/75 px-6 py-10 text-center shadow-xl shadow-blue-900/10 backdrop-blur-sm">
          <Badge className="bg-orange-100 text-orange-700 border-orange-200 border mb-4">初步諮詢免費</Badge>
          <p className="text-sm text-muted-foreground mb-6">由 OXM 協助需求整理、顧問媒合與後續案件追蹤</p>
          <Button
            size="lg"
            className="bg-gradient-to-r from-orange-500 to-purple-600 hover:opacity-90 text-white border-0 gap-2"
            onClick={openConsultPreview}
          >
            申請免費初步諮詢 <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
