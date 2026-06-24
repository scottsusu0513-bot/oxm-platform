import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { Fragment } from "react";
import { Capacitor } from "@capacitor/core";
import { cn } from "@/lib/utils";
import {
  ArrowRight, CheckCircle, Building2, Users,
  ClipboardList, ClipboardCheck, FileText, Send,
  TrendingUp, FileSearch, Loader2,
} from "lucide-react";

// ── 查詢進度：狀態 Badge 對照 ─────────────────────────────────────────────────

const PROGRESS_STATUS_INFO: Record<string, { label: string; color: string }> = {
  new:         { label: "等待顧問查收",     color: "bg-blue-100 text-blue-700" },
  evaluating:  { label: "顧問評估中",       color: "bg-cyan-100 text-cyan-700" },
  ineligible:  { label: "資格不符",         color: "bg-red-100 text-red-700" },
  accepted:    { label: "已立案處理",       color: "bg-violet-100 text-violet-700" },
  submitted:   { label: "已送出審核",       color: "bg-amber-100 text-amber-700" },
  rejected:    { label: "政府駁回",         color: "bg-rose-100 text-rose-700" },
  approved:    { label: "企業轉型中",       color: "bg-teal-100 text-teal-700" },
  transforming:{ label: "企業轉型中",       color: "bg-teal-100 text-teal-700" },
  completed:   { label: "案件結案",         color: "bg-emerald-100 text-emerald-700" },
  unassigned:  { label: "等待顧問中心分派", color: "bg-yellow-100 text-yellow-700" },
  archived:    { label: "已封存",           color: "bg-gray-100 text-gray-500" },
  viewed:      { label: "顧問評估中",       color: "bg-cyan-100 text-cyan-700" },
  contacted:   { label: "顧問評估中",       color: "bg-cyan-100 text-cyan-700" },
  consulting:  { label: "已立案處理",       color: "bg-violet-100 text-violet-700" },
};

function progressStatusInfo(status: string) {
  return PROGRESS_STATUS_INFO[status] ?? { label: status, color: "bg-gray-100 text-gray-700" };
}

// ── 查詢進度：Timeline 邏輯 ───────────────────────────────────────────────────

// 每個 status key 對應到 Timeline 的哪個「顯示階段」
const STATUS_TO_STAGE: Record<string, string> = {
  new:          "new",
  unassigned:   "new",
  viewed:       "evaluating",
  contacted:    "evaluating",
  evaluating:   "evaluating",
  consulting:   "accepted",
  ineligible:   "ineligible",
  accepted:     "accepted",
  submitted:    "submitted",
  rejected:     "rejected",
  approved:     "transforming",
  transforming: "transforming",
  completed:    "completed",
  archived:     "completed",
};

function fmtTimestamp(s: string): string {
  const d = new Date(s);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function buildProgressTimeline(app: {
  status: string;
  statusTimeline?: Record<string, string> | null;
  viewedAt?: Date | string | null;
  createdAt: Date | string;
}) {
  const tl = (app.statusTimeline as Record<string, string | undefined>) ?? {};
  const currentStageKey = STATUS_TO_STAGE[app.status] ?? app.status;
  const hasIneligible = app.status === "ineligible" || !!tl.ineligible;
  const hasRejected = app.status === "rejected" || !!tl.rejected;

  // 決定要顯示的流程節點
  let stages: { key: string; label: string }[];
  if (hasIneligible) {
    stages = [
      { key: "new",        label: "送出申請" },
      { key: "evaluating", label: "顧問評估中" },
      { key: "ineligible", label: "資格不符" },
    ];
  } else {
    stages = [
      { key: "new",          label: "送出申請" },
      { key: "evaluating",   label: "顧問評估中" },
      { key: "accepted",     label: "已立案處理" },
      { key: "submitted",    label: "已送出審核" },
    ];
    if (hasRejected) stages.push({ key: "rejected",    label: "政府駁回" });
    stages.push({ key: "transforming", label: "企業轉型中" });
    stages.push({ key: "completed",    label: "案件結案" });
  }

  // 第一步：取得每個 stage 的時間戳
  const withTimestamps = stages.map(stage => {
    let timestamp: string | null = null;
    switch (stage.key) {
      case "new":
        timestamp = tl.new ?? (app.createdAt instanceof Date
          ? app.createdAt.toISOString()
          : String(app.createdAt));
        break;
      case "evaluating":
        timestamp = tl.evaluating ?? tl.viewed ?? tl.contacted ?? (
          app.viewedAt
            ? (app.viewedAt instanceof Date ? app.viewedAt.toISOString() : String(app.viewedAt))
            : null
        );
        break;
      case "accepted":
        timestamp = tl.accepted ?? tl.consulting ?? null;
        break;
      case "transforming":
        timestamp = tl.transforming ?? tl.approved ?? null;
        break;
      default:
        timestamp = tl[stage.key] ?? null;
    }
    return { key: stage.key, label: stage.label, timestamp };
  });

  // 第二步：找到目前階段的 index，判斷每個 stage 的狀態
  const currentStageIdx = withTimestamps.findIndex(s => s.key === currentStageKey);

  return withTimestamps.map(({ key, label, timestamp }, idx) => {
    const isCurrent = key === currentStageKey;
    const isCompleted = !!timestamp && !isCurrent;
    // 已走過但 statusTimeline 無記錄（舊案件缺紀錄，或被跳躍的中間階段）
    const isPastNoRecord = !timestamp && !isCurrent && currentStageIdx >= 0 && idx < currentStageIdx;

    return { key, label, timestamp, isCurrent, isCompleted, isPastNoRecord };
  });
}

const isNativePlatform = Capacitor.isNativePlatform();
const floatingBtnBottom = isNativePlatform
  ? "calc(56px + 1.5rem + env(safe-area-inset-bottom, 0px))"
  : "calc(1.5rem + env(safe-area-inset-bottom, 0px))";

// ── 補助方案 ──────────────────────────────────────────────────────────────────

const SUBSIDY_PLANS = [
  {
    code: "SBIR",
    title: "小型企業創新研發計畫",
    desc: "針對中小企業創新研發活動提供補助，涵蓋前期研究、可行性評估及研發計畫三個階段。",
    tags: ["研發費用補助", "可分期申請", "最廣適用"],
    max: "3,000 萬元",
    topBar: "from-orange-500 to-amber-500",
    badgeCls: "bg-orange-100 text-orange-700",
    maxCls: "from-orange-500 to-amber-500",
  },
  {
    code: "CITD",
    title: "協助傳統產業技術開發",
    desc: "專為傳統製造業設計，補助技術升級、製程改善及智慧化轉型所需研發費用。",
    tags: ["傳統產業適用", "製程技術升級", "智慧化補助"],
    max: "1,000 萬元",
    topBar: "from-amber-500 to-yellow-500",
    badgeCls: "bg-amber-100 text-amber-700",
    maxCls: "from-amber-500 to-yellow-500",
  },
  {
    code: "SIIR",
    title: "服務業創新研發計畫",
    desc: "鼓勵服務業廠商投入創新研發，提升服務模式與數位轉型能力。",
    tags: ["服務業適用", "數位轉型", "商業模式創新"],
    max: "1,000 萬元",
    topBar: "from-violet-500 to-indigo-500",
    badgeCls: "bg-violet-100 text-violet-700",
    maxCls: "from-violet-500 to-indigo-500",
  },
  {
    code: "研發轉型補助",
    title: "企業研發轉型與升級計畫",
    desc: "協助企業投入產品開發、技術升級、研發流程優化與轉型布局，強化長期競爭力。",
    tags: ["產品開發", "技術升級", "轉型布局"],
    max: "4,000 萬元",
    topBar: "from-teal-500 to-cyan-500",
    badgeCls: "bg-teal-100 text-teal-700",
    maxCls: "from-teal-500 to-cyan-500",
  },
  {
    code: "海外通路計畫",
    title: "海外市場拓展與通路布局",
    desc: "協助企業布建海外展示據點、發貨倉庫、服務維修中心、海外分公司、子公司或代理經銷通路，強化海外市場落地能力。",
    tags: ["海外據點", "通路布建", "代理經銷"],
    max: "2,000 萬元",
    topBar: "from-sky-500 to-blue-500",
    badgeCls: "bg-sky-100 text-sky-700",
    maxCls: "from-sky-500 to-blue-500",
  },
];

// ── 申請流程 ──────────────────────────────────────────────────────────────────

const PROCESS_STEPS = [
  {
    Icon: ClipboardList,
    num: "01",
    title: "填寫評估資料",
    desc: "提供企業基本資訊、研發能力與財務狀況，5 分鐘完成初步評估表單",
    accent: "from-orange-500 to-amber-500",
    stepCls: "text-orange-500",
  },
  {
    Icon: ClipboardCheck,
    num: "02",
    title: "OXM 資格初審",
    desc: "OXM 專業團隊審查資料，確認符合政府補助基本申請資格",
    accent: "from-amber-500 to-yellow-500",
    stepCls: "text-amber-500",
  },
  {
    Icon: Users,
    num: "03",
    title: "媒合合作顧問",
    desc: "依企業類型與目標計畫，媒合最適合的政府計畫顧問團隊",
    accent: "from-teal-500 to-green-500",
    stepCls: "text-teal-500",
  },
  {
    Icon: Building2,
    num: "04",
    title: "專人到廠評估",
    desc: "顧問親赴貴廠進行深度訪查，全面評估申請條件與優化方向",
    accent: "from-sky-500 to-cyan-500",
    stepCls: "text-sky-500",
  },
  {
    Icon: FileText,
    num: "05",
    title: "撰寫計畫",
    desc: "顧問協助撰寫完整政府計畫書，確保內容符合審查標準",
    accent: "from-indigo-500 to-violet-500",
    stepCls: "text-indigo-500",
  },
  {
    Icon: Send,
    num: "06",
    title: "送出申請",
    desc: "提交完整計畫書至主管機關，OXM 全程追蹤審查進度",
    accent: "from-violet-500 to-purple-600",
    stepCls: "text-violet-500",
  },
];

const fmt = (n: number, digits: number) => String(n).padStart(digits, "0");

// ── 七段數碼管數字 ────────────────────────────────────────────────────────────

function SevenSegmentNumber({
  value,
  color,
  size = "large",
}: {
  value: string;
  color: string;
  size?: "small" | "medium" | "large";
}) {
  const sizeClass = size === "large"
    ? "text-3xl md:text-5xl"
    : size === "medium"
    ? "text-lg md:text-2xl"
    : "text-base md:text-xl";
  const glow = `0 0 6px ${color}, 0 0 14px ${color}99, 0 0 28px ${color}44`;
  return (
    <span
      className={`relative inline-block ${sizeClass} leading-none`}
      style={{
        fontFamily:
          '"DSEG7 Classic","DS-Digital","Digital-7","Orbitron","Share Tech Mono","Courier New",ui-monospace,monospace',
        fontWeight: 700,
        letterSpacing: "0.10em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* Dim ghost "8888…" simulates unlit segments */}
      <span
        aria-hidden
        className="absolute top-0 left-0 select-none pointer-events-none"
        style={{ color: `${color}15` }}
      >
        {"8".repeat(value.length)}
      </span>
      {/* Lit digits */}
      <span className="relative" style={{ color, textShadow: glow }}>
        {value}
      </span>
    </span>
  );
}

// ── 平台數據卡片 ────────────────────────────────────────────────────────────

function StatCard({
  title,
  icon: Icon,
  color,
  rows,
  bar,
}: {
  title: string;
  icon: React.ElementType;
  color: string;
  rows: { label: string; value: string; unit: string }[];
  bar?: number;
}) {
  return (
    <div
      className="rounded-xl flex flex-col overflow-hidden shadow-lg"
      style={{
        background: "#07111f",
        border: `1px solid ${color}22`,
        boxShadow: `0 4px 20px rgba(0,0,0,0.45), 0 0 24px ${color}06`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 pt-3 pb-2 md:px-5 md:pt-4 md:pb-3"
        style={{ borderBottom: `1px solid ${color}10` }}
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-40" style={{ backgroundColor: color }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
          </span>
          <span className="text-[10px] font-mono tracking-[0.20em] uppercase font-semibold" style={{ color: `${color}90` }}>{title}</span>
        </div>
        <Icon className="w-3.5 h-3.5" style={{ color: `${color}50` }} />
      </div>

      {/* Body — 3-col for multi-row, big single for solo */}
      {rows.length > 1 ? (
        <div className="flex-1 flex">
          {rows.map(({ label, value, unit }, idx) => (
            <div
              key={label}
              className="flex-1 min-w-0 flex flex-col items-center justify-center text-center px-1 py-2.5 md:px-2 md:py-5"
              style={idx > 0 ? { borderLeft: "1px solid rgba(148,163,184,0.18)" } : {}}
            >
              <div className="text-[8px] font-mono tracking-widest uppercase mb-2" style={{ color: "rgba(148,163,184,0.35)" }}>{label}</div>
              <SevenSegmentNumber value={value} color={color} size="medium" />
              <div className="text-[10px] font-mono mt-1.5 font-semibold" style={{ color: `${color}60` }}>{unit}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col justify-center px-3 py-3 md:px-5 md:py-5">
          <div className="text-[8px] font-mono tracking-widest uppercase mb-2.5" style={{ color: "rgba(148,163,184,0.35)" }}>{rows[0].label}</div>
          <div className="flex items-baseline gap-2.5">
            <SevenSegmentNumber value={rows[0].value} color={color} size="large" />
            <span className="font-mono font-bold text-sm" style={{ color: `${color}60` }}>{rows[0].unit}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-3 pb-3 pt-1.5 space-y-1.5 md:px-5 md:pb-4 md:pt-2 md:space-y-2">
        {bar !== undefined && (
          <div className="h-1.5 rounded-full" style={{ background: "rgba(30,41,59,0.8)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${bar}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
            />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ boxShadow: "0 0 4px #4ade80" }} />
          <span className="text-[7px] font-mono tracking-widest uppercase" style={{ color: "rgba(148,163,184,0.20)" }}>DATA PENDING LAUNCH</span>
        </div>
      </div>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function EnterpriseUpgradeCenter() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showDialog, setShowDialog] = useState(false);
  const [showProgressDialog, setShowProgressDialog] = useState(false);

  const { data: ownedFactory, isLoading: ownedLoading } = trpc.factory.getMine.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: coManaged, isLoading: coManagedLoading } = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: !!user,
  });

  const { data: progressData, isLoading: progressLoading } = trpc.upgradeCenter.myApplicationProgress.useQuery(undefined, {
    enabled: showProgressDialog && !!user,
  });
  const { data: rawStats } = trpc.upgradeCenter.publicStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const upgradeStats = useMemo(() => {
    const applied = rawStats?.appliedFactories ?? 0;
    const approved = rawStats?.approvedCases ?? 0;
    return {
      appliedFactories: applied,
      approvedCases: approved,
      approvalRate: applied > 0 ? Math.round((approved / applied) * 100) : 0,
      totalGrantAmountWan: Math.floor((rawStats?.totalGrantAmountYen ?? 0) / 10000),
      completedCases: rawStats?.completedCases ?? 0,
    };
  }, [rawStats]);

  const hasFactoryAccess = useMemo(() => {
    if (!user) return false;
    if (ownedFactory) return true;
    if (coManaged && coManaged.length > 0) return true;
    return false;
  }, [user, ownedFactory, coManaged]);

  const accessChecking = ownedLoading || coManagedLoading;

  const handleApplyClick = () => {
    if (!user) { setShowDialog(true); return; }
    if (accessChecking) return;
    if (!hasFactoryAccess) { setShowDialog(true); return; }
    navigate("/upgrade-center/apply");
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>企業升級中心｜OXM</title>
        <meta name="description" content="OXM 企業升級中心，協助台灣企業取得政府補助與轉型資源，包含 SBIR、CITD、SIIR 等計畫媒合服務。" />
      </Helmet>

      <Navbar />

      {/* ── Hero Banner Card ───────────────────────────────────────────────── */}
      <section className="py-4 md:py-6" style={{ backgroundColor: "#06090f" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="sr-only">企業升級中心</h1>
          <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
            <img
              src="/images/upgrade-center/hero-bg.png"
              alt="企業升級中心"
              style={{
                width: "100%",
                height: "clamp(160px, 27vw, 400px)",
                objectFit: "cover",
                objectPosition: "center 30%",
                display: "block",
              }}
            />
            {/* Overlay CTA — x≈65% y≈85%: below UPGRADE card, above road trail */}
            <div
              className="absolute hidden sm:flex"
              style={{ left: "65%", top: "85%", transform: "translate(-50%, -50%)" }}
            >
              <Button
                size="default"
                onClick={handleApplyClick}
                disabled={accessChecking && !!user}
                className="bg-orange-500 hover:bg-orange-600 text-white border-0 px-5 rounded-lg shadow-lg shadow-orange-500/40"
              >
                免費評估資格
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
          {/* Mobile-only CTA — overlaid at bottom of image */}
          <div className="sm:hidden pt-3">
            <Button
              size="default"
              onClick={handleApplyClick}
              disabled={accessChecking && !!user}
              className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white border-0 rounded-lg shadow-lg shadow-orange-500/30 font-semibold"
            >
              免費評估資格
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── 平台數據 ────────────────────────────────────────────────────── */}
      <section className="bg-slate-50 py-5 md:py-8 lg:py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-4 md:p-6 lg:p-8">
            <div className="flex flex-col md:flex-row gap-4 md:gap-8 items-start md:items-center">
              {/* Left: title */}
              <div className="md:w-44 shrink-0 flex flex-row md:flex-col items-center md:items-start gap-3 md:space-y-3">
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">平台數據</h2>
                <div className="flex items-start gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-400 mt-0.5 shrink-0" style={{ boxShadow: "0 0 6px #4ade80" }} />
                  <p className="text-xs md:text-sm text-slate-500 leading-relaxed">數據正式啟動後持續更新</p>
                </div>
              </div>
              {/* Right: 3 stat cards
                  Mobile:  row1 = 申請廠商 (full width); row2 = 總申請金額 + 已結案數量
                  sm+   :  3 cols equal */}
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
                {/* 申請廠商：手機佔滿整排，sm+ 正常 1/3 */}
                <div className="col-span-2 sm:col-span-1">
                  <StatCard
                    title="申請廠商"
                    icon={Building2}
                    color="#4ade80"
                    rows={[
                      { label: "有送出申請", value: fmt(upgradeStats.appliedFactories, 5), unit: "家" },
                      { label: "有過件",     value: fmt(upgradeStats.approvedCases, 5),    unit: "家" },
                      { label: "過件率",     value: fmt(upgradeStats.approvalRate, 2),     unit: "%" },
                    ]}
                    bar={upgradeStats.approvalRate}
                  />
                </div>
                {/* 總申請金額：手機 1/2 欄，sm+ 正常 1/3 */}
                <StatCard
                  title="總申請金額"
                  icon={TrendingUp}
                  color="#fb923c"
                  rows={[{ label: "累積補助金額", value: fmt(upgradeStats.totalGrantAmountWan, 5), unit: "萬元" }]}
                  bar={0}
                />
                {/* 已結案數量：手機 1/2 欄，sm+ 正常 1/3 */}
                <StatCard
                  title="已結案數量"
                  icon={CheckCircle}
                  color="#c084fc"
                  rows={[{ label: "已結案案件數", value: fmt(upgradeStats.completedCases, 5), unit: "件" }]}
                  bar={0}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 多項政府補助方案 ───────────────────────────────────────────────── */}
      <section className="py-8 md:py-14 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 md:space-y-10">
          <div className="text-center space-y-1.5 md:space-y-2">
            <h2 className="text-xl md:text-2xl lg:text-3xl font-bold">多項政府補助方案</h2>
            <div className="w-10 h-1 bg-gradient-to-r from-orange-500 to-amber-500 mx-auto rounded-full" />
            <p className="text-sm md:text-base text-muted-foreground mt-2 md:mt-3">OXM 協助媒合適合企業階段的政府計畫</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-6 items-stretch">
            {SUBSIDY_PLANS.map((plan, idx) => {
              // 手機 2 欄時，若總數為奇數，最後一張滿版
              const isLastOdd = idx === SUBSIDY_PLANS.length - 1 && SUBSIDY_PLANS.length % 2 === 1;
              return (
                <div
                  key={plan.code}
                  className={`rounded-xl md:rounded-2xl border border-border bg-background flex flex-col overflow-hidden shadow-sm hover:shadow-md transition-shadow${isLastOdd ? " col-span-2 md:col-span-1" : ""}`}
                >
                  <div className={`h-1 md:h-1.5 bg-gradient-to-r ${plan.topBar}`} />
                  <div className="p-3 md:p-6 flex flex-col gap-2 md:gap-4 flex-1">
                    {/* code badge row */}
                    <div className="flex items-center justify-between gap-1">
                      <span className={`px-2 py-0.5 md:px-3 md:py-1 rounded-full text-[10px] md:text-sm font-extrabold tracking-wide leading-tight ${plan.badgeCls}`}>{plan.code}</span>
                      <span className="hidden md:block text-xs text-muted-foreground shrink-0">政府補助計畫</span>
                    </div>
                    {/* title — mobile 2 lines max */}
                    <div className="flex-1">
                      <h3 className="font-bold text-[11px] md:text-lg leading-snug line-clamp-2">{plan.title}</h3>
                      {/* desc — hidden on mobile */}
                      <p className="hidden md:block text-sm text-muted-foreground leading-relaxed mt-1">{plan.desc}</p>
                    </div>
                    {/* tags — hidden on mobile */}
                    <div className="hidden md:flex flex-wrap gap-1">
                      {plan.tags.map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground font-medium">{tag}</span>
                      ))}
                    </div>
                    {/* max amount */}
                    <div className="flex items-center justify-between pt-2 md:pt-4 border-t border-border">
                      <span className="text-[9px] md:text-xs text-muted-foreground font-medium leading-tight">最高<br className="md:hidden" />補助</span>
                      <span className={`text-sm md:text-xl font-extrabold bg-gradient-to-r ${plan.maxCls} bg-clip-text text-transparent`}>{plan.max}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 申請流程 ──────────────────────────────────────────────────────── */}
      <section className="py-8 md:py-14 lg:py-20 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 md:space-y-10">
          <div className="text-center space-y-1.5 md:space-y-2">
            <h2 className="text-xl md:text-2xl lg:text-3xl font-bold">申請流程</h2>
            <p className="text-sm md:text-base text-muted-foreground">六個步驟，OXM 顧問全程陪跑</p>
          </div>
          {/* Desktop: horizontal */}
          <div className="hidden lg:flex items-start">
            {PROCESS_STEPS.map((step, i) => (
              <Fragment key={step.num}>
                <div className="flex-1 flex flex-col items-center text-center gap-3 min-w-0 px-2">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${step.accent} flex items-center justify-center shadow-md shrink-0`}>
                    <step.Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="space-y-1 w-full">
                    <span className={`text-[10px] font-extrabold tracking-widest opacity-60 block ${step.stepCls}`}>STEP {step.num}</span>
                    <p className="font-semibold text-sm leading-snug">{step.title}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{step.desc}</p>
                  </div>
                </div>
                {i < PROCESS_STEPS.length - 1 && (
                  <div className="flex items-start pt-4 shrink-0">
                    <ArrowRight className="w-4 h-4 text-muted-foreground/30" />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
          {/* Mobile / Tablet: compact 2-col vertical stepper */}
          <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PROCESS_STEPS.map((step) => (
              <div key={step.num} className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${step.accent} flex items-center justify-center shadow-md shrink-0`}>
                  <step.Icon className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="space-y-0.5 pt-0.5">
                  <span className={`text-[9px] font-extrabold tracking-widest opacity-60 block ${step.stepCls}`}>STEP {step.num}</span>
                  <p className="font-semibold text-xs">{step.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="py-8 md:py-14 lg:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-gradient-to-br from-orange-500 via-amber-500 to-violet-600 p-6 md:p-10 lg:p-16 text-white text-center space-y-4 md:space-y-6 shadow-xl shadow-orange-500/20">
            <div
              className="absolute inset-0 pointer-events-none opacity-10"
              aria-hidden="true"
              style={{ backgroundImage: "radial-gradient(circle,white 1px,transparent 1px)", backgroundSize: "24px 24px" }}
            />
            <div className="relative space-y-2.5 md:space-y-4">
              <h2 className="text-xl md:text-2xl lg:text-3xl font-extrabold">不確定適合哪項補助？</h2>
              <p className="text-white/80 text-sm md:text-base lg:text-lg">讓 OXM 協助免費評估，找到最適合您企業的計畫</p>
              <div className="pt-1 md:pt-2">
                <Button
                  size="default"
                  onClick={handleApplyClick}
                  disabled={accessChecking && !!user}
                  className="h-11 bg-white text-orange-600 hover:bg-orange-50 border-0 text-sm md:text-base px-6 md:px-8 font-bold shadow-lg"
                >
                  立即免費評估
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 權限不足 Dialog ───────────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>此功能僅提供 OXM 工廠會員</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-1">
              企業升級中心評估服務目前僅提供給 OXM 工廠會員與工作室會員使用。
              <br /><br />
              如需申請政府補助評估，請先於 OXM 完成工廠或工作室註冊。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <Link href="/register-factory" onClick={() => setShowDialog(false)}>
              <Button className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
                立即註冊工廠
              </Button>
            </Link>
            <Button variant="outline" className="w-full" onClick={() => setShowDialog(false)}>
              我知道了
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── 查詢進度浮動按鈕 ─────────────────────────────────────────────── */}
      <div
        className="fixed right-5 z-40"
        style={{ bottom: floatingBtnBottom }}
      >
        <button
          onClick={() => setShowProgressDialog(true)}
          aria-label="查詢申請進度"
          className="flex items-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-medium rounded-full shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 select-none"
        >
          <FileSearch className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span className="text-xs sm:text-sm">查詢進度</span>
        </button>
      </div>

      {/* ── 申請進度查詢 Dialog ──────────────────────────────────────────── */}
      <Dialog open={showProgressDialog} onOpenChange={setShowProgressDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[82vh] flex flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-orange-500" />
              申請進度查詢
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-1">
              系統將依您目前登入帳號綁定的工廠，自動查詢企業升級案件進度。
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 mt-2">
            {/* 未登入 */}
            {!user && (
              <div className="text-center py-8 space-y-3">
                <p className="text-sm text-muted-foreground">請先登入後查詢申請進度</p>
                <Link href="/login" onClick={() => setShowProgressDialog(false)}>
                  <Button className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0">
                    前往登入
                  </Button>
                </Link>
              </div>
            )}

            {/* 已登入 — 載入中 */}
            {user && progressLoading && (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                <p className="text-sm text-muted-foreground">正在查詢您的申請進度...</p>
              </div>
            )}

            {/* 已登入 — 無綁定工廠 */}
            {user && !progressLoading && progressData && !progressData.hasFactory && (
              <div className="text-center py-8 space-y-3">
                <Building2 className="w-10 h-10 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  目前查無綁定工廠，請先上架工廠後再申請企業升級服務。
                </p>
                <Link href="/register-factory" onClick={() => setShowProgressDialog(false)}>
                  <Button variant="outline" size="sm">
                    前往上架工廠
                  </Button>
                </Link>
              </div>
            )}

            {/* 已登入 — 有工廠但無申請 */}
            {user && !progressLoading && progressData?.hasFactory && progressData.applications.length === 0 && (
              <div className="text-center py-8 space-y-3">
                <FileSearch className="w-10 h-10 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">目前尚未查到企業升級申請紀錄。</p>
                <Button
                  size="sm"
                  onClick={() => { setShowProgressDialog(false); navigate("/upgrade-center/apply"); }}
                  className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white border-0"
                >
                  開始免費資格評估
                </Button>
              </div>
            )}

            {/* 已登入 — 有申請紀錄 */}
            {user && !progressLoading && progressData?.applications && progressData.applications.length > 0 && (
              <div className="space-y-3">
                {progressData.applications.map((app) => {
                  const si = progressStatusInfo(app.status);
                  const timelineStages = buildProgressTimeline(app);
                  return (
                    <div key={app.id} className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                      {/* 公司名稱 + 狀態 Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm leading-snug break-all min-w-0">{app.companyName}</p>
                        <Badge className={`${si.color} border-0 text-xs shrink-0`}>{si.label}</Badge>
                      </div>

                      {/* 案件進度 Timeline */}
                      <div className="pt-0.5">
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">案件進度</p>
                        <div className="relative pl-4 space-y-1.5">
                          {/* 垂直連線 */}
                          <div className="absolute left-1 top-1.5 bottom-1.5 w-px bg-border" />
                          {timelineStages.map(stage => {
                            const isFuture = !stage.timestamp && !stage.isCurrent && !stage.isPastNoRecord;
                            return (
                              <div key={stage.key} className="relative flex gap-2 items-start">
                                {/* 圓點 */}
                                <div className={cn(
                                  "absolute -left-[14px] mt-[3px] w-2.5 h-2.5 rounded-full border-2 shrink-0",
                                  stage.isCurrent
                                    ? "bg-orange-500 border-orange-500 shadow-sm shadow-orange-300"
                                    : stage.isCompleted
                                    ? "bg-green-500 border-green-500"
                                    : stage.isPastNoRecord
                                    ? "bg-green-500/20 border-green-500/40"
                                    : "bg-background border-gray-300"
                                )} />
                                {/* 內容 */}
                                <div className={cn("min-w-0 flex-1", isFuture && "opacity-40")}>
                                  <span className={cn(
                                    "text-xs font-medium leading-snug",
                                    stage.isCurrent
                                      ? "text-orange-500"
                                      : stage.isCompleted
                                      ? "text-foreground"
                                      : stage.isPastNoRecord
                                      ? "text-muted-foreground"
                                      : "text-muted-foreground"
                                  )}>
                                    {stage.label}
                                    {stage.isCurrent && (
                                      <span className="ml-1 text-[10px] font-normal text-orange-400">← 目前進度</span>
                                    )}
                                  </span>
                                  {stage.timestamp ? (
                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                      {fmtTimestamp(stage.timestamp)}
                                    </div>
                                  ) : stage.isPastNoRecord ? (
                                    <div className="text-[10px] text-muted-foreground/50 mt-0.5">尚未記錄時間</div>
                                  ) : stage.isCurrent ? (
                                    <div className="text-[10px] text-muted-foreground mt-0.5">處理中</div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 顧問備註 */}
                      {app.notes && (
                        <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                          <p className="font-medium text-foreground mb-0.5">顧問備註</p>
                          <p className="whitespace-pre-wrap">{app.notes}</p>
                        </div>
                      )}

                      {/* 實際過案金額 */}
                      {app.approvedSubsidyAmount != null && (
                        <div className="text-xs">
                          <span className="text-muted-foreground">實際過案金額：</span>
                          <span className="font-semibold text-green-700">
                            NT$ {app.approvedSubsidyAmount.toLocaleString("zh-TW")}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
