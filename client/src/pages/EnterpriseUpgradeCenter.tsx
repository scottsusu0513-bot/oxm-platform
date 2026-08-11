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
import { Capacitor } from "@capacitor/core";
import { cn } from "@/lib/utils";
import {
  UpgradeProgramCard,
  UpgradeProgramSkeleton,
} from "@/components/upgrade/UpgradeProgramCard";
import {
  ArrowRight, CheckCircle, Building2, Users,
  ClipboardList, ClipboardCheck, FileText, Send,
  FileSearch, Loader2, Sparkles,
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

function MetricTile({ label, value, unit, accent }: { label: string; value: string; unit: string; accent: string }) {
  return (
    <div className="min-w-0 border-l border-white/10 pl-4 first:border-l-0 first:pl-0 sm:pl-6">
      <p className="text-[10px] font-semibold tracking-[.16em] text-slate-400">{label}</p>
      <div className="mt-2 flex min-w-0 items-baseline gap-1.5">
        <span className="truncate font-mono text-xl font-bold tabular-nums text-white sm:text-2xl" style={{ textShadow: `0 0 18px ${accent}40` }}>{value}</span>
        <span className="text-[10px] font-semibold" style={{ color: accent }}>{unit}</span>
      </div>
    </div>
  );
}

type UpgradeMeaning = "resources" | "stages" | "transformation";

const UPGRADE_MEANING_ITEMS: {
  kind: UpgradeMeaning;
  number: string;
  eyebrow: string;
  title: string;
  text: string;
  artClassName: string;
}[] = [
  {
    kind: "resources",
    number: "01",
    eyebrow: "資訊整理",
    title: "理解資源",
    text: "將分散的政府方案整理成可閱讀的企業語言。",
    artClassName: "border-orange-100 bg-gradient-to-br from-orange-50 via-white to-violet-50",
  },
  {
    kind: "stages",
    number: "02",
    eyebrow: "路徑辨識",
    title: "對應階段",
    text: "從研發、製程、數位到市場布局辨識方向。",
    artClassName: "border-sky-100 bg-gradient-to-br from-amber-50 via-white to-sky-50",
  },
  {
    kind: "transformation",
    number: "03",
    eyebrow: "目標推進",
    title: "推進轉型",
    text: "讓補助評估與企業真正要完成的升級目標連結。",
    artClassName: "border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-violet-50",
  },
];

function UpgradeMeaningIllustration({ kind }: { kind: UpgradeMeaning }) {
  if (kind === "resources") {
    return (
      <svg viewBox="0 0 300 150" className="h-auto w-full" aria-hidden="true">
        <defs>
          <linearGradient id="resource-folder" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff7ed" />
            <stop offset="1" stopColor="#f5f3ff" />
          </linearGradient>
          <linearGradient id="resource-flow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fb923c" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <ellipse cx="214" cy="130" rx="64" ry="8" fill="#cbd5e1" opacity=".28" />
        <g transform="rotate(-8 42 52)">
          <rect x="19" y="24" width="48" height="60" rx="8" fill="#fff" stroke="#fb923c" strokeWidth="2" />
          <path d="M29 39h27M29 50h20M29 61h24" stroke="#fdba74" strokeWidth="3" strokeLinecap="round" />
          <circle cx="55" cy="72" r="4" fill="#fb923c" />
        </g>
        <g transform="rotate(7 79 52)">
          <rect x="57" y="14" width="48" height="60" rx="8" fill="#fff" stroke="#8b5cf6" strokeWidth="2" />
          <path d="M67 30h27M67 41h18M67 52h23" stroke="#c4b5fd" strokeWidth="3" strokeLinecap="round" />
          <path d="m86 63 4 4 8-10" fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g transform="rotate(-4 67 102)">
          <rect x="39" y="76" width="52" height="58" rx="8" fill="#fff" stroke="#38bdf8" strokeWidth="2" />
          <path d="M50 92h28M50 103h21M50 114h25" stroke="#7dd3fc" strokeWidth="3" strokeLinecap="round" />
        </g>
        <path d="M108 52c25-2 35 13 49 25M104 101c23 2 34-7 50-15" fill="none" stroke="url(#resource-flow)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 6" />
        <path d="m148 72 10 7-11 5M146 82l11 4-8 9" fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M168 47h91a12 12 0 0 1 12 12v59a12 12 0 0 1-12 12h-91a12 12 0 0 1-12-12V59a12 12 0 0 1 12-12Z" fill="url(#resource-folder)" stroke="#64748b" strokeWidth="2" />
        <path d="M168 47V37h34l9 10" fill="#ffedd5" stroke="#fb923c" strokeWidth="2" strokeLinejoin="round" />
        <path d="M171 65c16-5 30-2 42 7v42c-12-9-26-12-42-7V65Zm84 0c-16-5-30-2-42 7v42c12-9 26-12 42-7V65Z" fill="#fff" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" />
        <path d="M182 78h18M182 88h21M182 98h15M226 78h18M223 88h21M229 98h15" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M213 72v42" stroke="#8b5cf6" strokeWidth="2" />
        <path d="m239 42 4 7 7 4-7 4-4 7-4-7-7-4 7-4 4-7Z" fill="#fb923c" opacity=".9" />
      </svg>
    );
  }

  if (kind === "stages") {
    return (
      <svg viewBox="0 0 300 150" className="h-auto w-full" aria-hidden="true">
        <defs>
          <linearGradient id="stage-path" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fb923c" />
            <stop offset=".48" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <path d="M30 109C63 109 67 82 101 82s38-31 71-31 45 13 92-18" fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" />
        <path d="M30 109C63 109 67 82 101 82s38-31 71-31 45 13 92-18" fill="none" stroke="url(#stage-path)" strokeWidth="4" strokeLinecap="round" />
        <path d="m253 27 15 4-8 13" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <g>
          <circle cx="39" cy="107" r="22" fill="#fff7ed" stroke="#fb923c" strokeWidth="2" />
          <path d="M39 94a9 9 0 0 0-5 16c2 1 2 3 2 5h6c0-2 0-4 2-5a9 9 0 0 0-5-16Z" fill="none" stroke="#f97316" strokeWidth="2.3" strokeLinecap="round" />
          <path d="M35 120h8M37 115h4" stroke="#f97316" strokeWidth="2" strokeLinecap="round" />
        </g>
        <g>
          <circle cx="104" cy="81" r="22" fill="#fffbeb" stroke="#f59e0b" strokeWidth="2" />
          <circle cx="104" cy="81" r="7" fill="none" stroke="#d97706" strokeWidth="2.3" />
          <path d="M104 67v4M104 91v4M90 81h4M114 81h4M94 71l3 3M111 88l3 3M114 71l-3 3M97 88l-3 3" stroke="#d97706" strokeWidth="2.3" strokeLinecap="round" />
        </g>
        <g>
          <circle cx="172" cy="51" r="22" fill="#f5f3ff" stroke="#8b5cf6" strokeWidth="2" />
          <rect x="163" y="42" width="18" height="18" rx="3" fill="none" stroke="#7c3aed" strokeWidth="2.3" />
          <path d="M167 47h10v8h-10zM158 46h5M158 52h5M181 46h5M181 52h5M167 37v5M173 37v5M167 60v5M173 60v5" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
        </g>
        <g>
          <circle cx="245" cy="43" r="24" fill="#f0f9ff" stroke="#0ea5e9" strokeWidth="2" />
          <circle cx="245" cy="43" r="12" fill="none" stroke="#0284c7" strokeWidth="2" />
          <path d="M233 43h24M245 31c4 4 6 8 6 12s-2 8-6 12c-4-4-6-8-6-12s2-8 6-12Z" fill="none" stroke="#0284c7" strokeWidth="2" />
          <circle cx="258" cy="29" r="5" fill="#fff" stroke="#0ea5e9" strokeWidth="2" />
          <path d="m256 29 2 2 4-5" fill="none" stroke="#0ea5e9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g fill="#64748b" fontFamily="ui-sans-serif,system-ui" fontSize="8" fontWeight="700" textAnchor="middle">
          <text x="39" y="143">研發</text><text x="104" y="118">製程</text><text x="172" y="88">數位</text><text x="245" y="83">市場</text>
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 300 150" className="h-auto w-full" aria-hidden="true">
      <defs>
        <linearGradient id="transform-rise" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset=".55" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="transform-building" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0fdfa" />
          <stop offset="1" stopColor="#f5f3ff" />
        </linearGradient>
      </defs>
      <ellipse cx="150" cy="132" rx="125" ry="9" fill="#cbd5e1" opacity=".3" />
      <path d="M25 126h68V78H72V58H45v20H25v48Z" fill="#fff" stroke="#64748b" strokeWidth="2" strokeLinejoin="round" />
      <path d="M45 58V43h20v15M37 91h13M64 91h13M37 105h13M64 105h13" fill="none" stroke="#fb923c" strokeWidth="3" strokeLinecap="round" />
      <path d="M93 124h25v-19h25V86h25V67h25" fill="none" stroke="#cbd5e1" strokeWidth="9" strokeLinejoin="round" />
      <path d="M94 118h25v-19h25V80h25V61h45" fill="none" stroke="url(#transform-rise)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m205 52 15 9-15 9" fill="none" stroke="#8b5cf6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="119" cy="99" r="5" fill="#14b8a6" stroke="#fff" strokeWidth="2" />
      <circle cx="169" cy="61" r="5" fill="#0ea5e9" stroke="#fff" strokeWidth="2" />
      <path d="M215 126V52h55v74" fill="url(#transform-building)" stroke="#64748b" strokeWidth="2" strokeLinejoin="round" />
      <path d="M228 126V35h30v91M235 49h16M235 64h16M235 79h16M235 94h16" fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M231 35V24h22v11" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="2" />
      <circle cx="242" cy="23" r="15" fill="#fff" stroke="#8b5cf6" strokeWidth="2" />
      <path d="m235 23 5 5 9-11" fill="none" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m278 38 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z" fill="#fb923c" />
      <path d="M19 126h265" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function EnterpriseUpgradeCenter() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showDialog, setShowDialog] = useState(false);
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [progressDialogMode, setProgressDialogMode] = useState<"query" | "duplicate">("query");

  const { data: ownedFactory, isLoading: ownedLoading } = trpc.factory.getMine.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: coManaged, isLoading: coManagedLoading } = trpc.factory.getCoManagedFactories.useQuery(undefined, {
    enabled: !!user,
  });

  // 提前載入（不等 Dialog 打開），讓 handleApplyClick 能立即判斷是否已有申請
  const { data: progressData, isLoading: progressLoading } = trpc.upgradeCenter.myApplicationProgress.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const { data: rawStats } = trpc.upgradeCenter.publicStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const {
    data: upgradePrograms = [],
    isLoading: programsLoading,
    isError: programsError,
  } = trpc.upgradePrograms.listPublic.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const upgradeStats = useMemo(() => {
    const applied = rawStats?.appliedFactories ?? 0;
    // acceptedCases：已正式立案處理案件數（非僅指政府核准案件，詳見 server/db.ts 註解）
    const accepted = rawStats?.acceptedCases ?? 0;
    // 過件率分母＝顧問已經手評估的案件數（排除尚未分派／顧問尚未查收的案件），
    // 而非全部進件數，避免短時間湧入的新案件拉低過件率
    const evaluated = rawStats?.evaluatedCases ?? 0;
    return {
      appliedFactories: applied,
      acceptedCases: accepted,
      approvalRate: evaluated > 0 ? Math.round((accepted / evaluated) * 100) : 0,
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
    // 已有進行中的申請：顯示進度 Dialog，不導向表單
    if (progressData?.applications && progressData.applications.length > 0) {
      setProgressDialogMode("duplicate");
      setShowProgressDialog(true);
      return;
    }
    navigate("/upgrade-center/apply");
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>企業升級中心｜OXM</title>
        <meta name="description" content="OXM 企業升級中心，協助台灣企業取得政府補助與轉型資源，包含 SBIR、CITD、SIIR 等計畫媒合服務。" />
      </Helmet>

      <Navbar />

      {/* ── Hero：沿用原版科技城市、光軌與資料流語彙 ────────────────── */}
      <section className="relative overflow-hidden bg-[#050a14] text-white">
        <div className="pointer-events-none absolute -left-40 top-16 h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-32 top-0 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" aria-hidden="true" />

        <div className="relative mx-auto max-w-7xl px-4 pb-8 pt-12 sm:px-6 md:pb-12 md:pt-16 lg:px-8 lg:pt-20">
          <div className="grid items-center gap-4 lg:grid-cols-[1.05fr_.95fr] lg:gap-10">
            <div className="relative z-10 max-w-2xl py-4 lg:py-10">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-semibold tracking-[.14em] text-orange-300">
                <Sparkles className="h-3.5 w-3.5" />OXM 企業升級中心
              </div>
              <h1 className="text-balance text-4xl font-black leading-[1.12] tracking-tight sm:text-5xl lg:text-6xl">
                把政府補助，<br />轉成企業升級的<span className="whitespace-nowrap bg-gradient-to-r from-orange-400 to-violet-400 bg-clip-text text-transparent">下一步</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
                從研發、製程改善到海外布局，OXM 協助台灣企業辨識合適資源，媒合專業顧問，讓轉型計畫更有方向。
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button onClick={handleApplyClick} disabled={accessChecking && !!user} className="h-12 rounded-full bg-orange-500 px-6 font-bold text-white shadow-lg shadow-orange-950/40 hover:bg-orange-600">
                  免費評估資格<ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <a href="#upgrade-programs" className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 px-6 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/[.05]">
                  查看補助方案
                </a>
              </div>
              <div className="mt-6 flex items-center gap-2 text-xs leading-5 text-slate-500">
                <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />依既有會員與工廠資格流程進行評估
              </div>
            </div>
            <div className="relative mx-auto mt-3 w-full max-w-2xl overflow-hidden lg:mt-0 lg:max-w-none">
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1/5 bg-gradient-to-r from-[#050a14] to-transparent" aria-hidden="true" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/4 bg-gradient-to-t from-[#050a14] to-transparent" aria-hidden="true" />
              <img
                src="/images/upgrade-center/hero-tech-city-v2.webp"
                alt=""
                className="aspect-[16/10] w-full object-cover object-[68%_center] opacity-95 sm:aspect-[16/9] lg:aspect-[4/3] xl:aspect-[16/11]"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 rounded-2xl border border-white/10 bg-slate-950/70 p-5 backdrop-blur-sm sm:grid-cols-5 sm:p-6">
            <MetricTile label="送出申請" value={fmt(upgradeStats.appliedFactories, 5)} unit="家" accent="#4ade80" />
            <MetricTile label="正式立案" value={fmt(upgradeStats.acceptedCases, 5)} unit="家" accent="#38bdf8" />
            <MetricTile label="評估過件率" value={fmt(upgradeStats.approvalRate, 2)} unit="%" accent="#c084fc" />
            <MetricTile label="累積補助金額" value={fmt(upgradeStats.totalGrantAmountWan, 5)} unit="萬元" accent="#fb923c" />
            <MetricTile label="已結案案件" value={fmt(upgradeStats.completedCases, 5)} unit="件" accent="#facc15" />
          </div>
          <p className="mt-3 text-right text-[10px] tracking-wider text-slate-600">平台數據正式啟動後持續更新</p>
        </div>
      </section>

      {/* ── 為什麼需要資源導覽 ───────────────────────────────────────── */}
      <section className="border-b border-slate-200 bg-white py-14 md:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[.9fr_1.1fr] lg:gap-20 lg:px-8">
          <div>
            <p className="text-xs font-bold tracking-[.2em] text-orange-500">WHY IT MATTERS</p>
            <h2 className="mt-4 text-3xl font-black leading-tight text-slate-950 md:text-4xl">補助不是終點，<br className="hidden sm:block" />而是升級路徑的一部分</h2>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-600 md:text-base md:leading-8">
              不同企業階段，對應的研發、技術與市場資源也不同。先看懂方案方向，再進入資格評估，能讓後續準備更聚焦。
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
            {UPGRADE_MEANING_ITEMS.map(({ kind, number, eyebrow, title, text, artClassName }) => (
              <div key={number} className="flex flex-col bg-white p-5 sm:min-h-[330px]">
                <div className={`overflow-hidden rounded-2xl border p-2 ${artClassName}`}>
                  <UpgradeMeaningIllustration kind={kind} />
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold tracking-[.16em] text-violet-500">{eyebrow}</span>
                  <span className="font-mono text-xs text-slate-400">{number}</span>
                </div>
                <h3 className="mt-4 text-lg font-black tracking-[-.01em] text-slate-950">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 資料庫驅動的政府補助方案 ─────────────────────────────────── */}
      <section id="upgrade-programs" className="scroll-mt-20 bg-[#f5f6f8] py-14 md:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-9 flex flex-col gap-4 md:mb-12 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-bold tracking-[.2em] text-violet-600">PROGRAM DIRECTORY</p>
              <h2 className="mt-3 text-3xl font-black text-slate-950 md:text-4xl">政府補助方案</h2>
              <p className="mt-4 text-sm leading-7 text-slate-600 md:text-base">OXM 協助媒合適合企業階段的政府計畫；實際資格與受理內容依主管機關公告及顧問評估為準。</p>
            </div>
            {!programsLoading && !programsError && (
              <div className="flex items-baseline gap-2 border-l-2 border-orange-500 pl-4">
                <span className="font-mono text-3xl font-black text-slate-900">{String(upgradePrograms.length).padStart(2, "0")}</span>
                <span className="text-xs font-semibold tracking-wider text-slate-400">項方案</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
            {programsLoading && Array.from({ length: 3 }).map((_, index) => <UpgradeProgramSkeleton key={index} />)}
            {!programsLoading && upgradePrograms.map((program, index) => (
              <UpgradeProgramCard key={program.id} program={program} index={index} />
            ))}
          </div>
          {programsError && (
            <div className="rounded-2xl border border-red-200 bg-white px-5 py-10 text-center text-sm text-red-700">方案資料暫時無法載入，請稍後再試。</div>
          )}
          {!programsLoading && !programsError && upgradePrograms.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-500">目前沒有公開中的政府補助方案。</div>
          )}
        </div>
      </section>

      {/* ── 既有六步申請流程，僅重整視覺 ─────────────────────────────── */}
      <section className="bg-white py-14 md:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-10 max-w-2xl">
            <p className="text-xs font-bold tracking-[.2em] text-orange-500">HOW IT WORKS</p>
            <h2 className="mt-3 text-3xl font-black text-slate-950 md:text-4xl">六個步驟，讓評估有跡可循</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600 md:text-base">從資料填寫、資格初審到送出申請，OXM 顧問依既有流程全程陪跑。</p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {PROCESS_STEPS.map((step) => (
              <div key={step.num} className="group relative min-h-52 bg-white p-5 transition hover:bg-slate-50">
                <span className="font-mono text-3xl font-black text-slate-100 transition group-hover:text-slate-200">{step.num}</span>
                <div className={`mt-5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${step.accent}`}>
                  <step.Icon className="h-4 w-4 text-white" />
                </div>
                <h3 className="mt-4 text-sm font-bold leading-snug text-slate-900">{step.title}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-500">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OXM 如何協助 ──────────────────────────────────────────────── */}
      <section className="bg-slate-950 py-14 text-white md:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[.75fr_1.25fr] lg:items-start lg:gap-20">
            <div>
              <p className="text-xs font-bold tracking-[.2em] text-orange-400">OXM SUPPORT</p>
              <h2 className="mt-4 text-3xl font-black leading-tight md:text-4xl">把複雜的申請路徑，整理成清楚的行動</h2>
              <p className="mt-5 text-sm leading-7 text-slate-400 md:text-base">OXM 串接企業需求與專業顧問，協助企業從初步判讀一路走到實際送件。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { Icon: FileSearch, title: "先釐清", text: "從企業現況與目標開始，聚焦適合評估的方案方向。" },
                { Icon: Users, title: "再媒合", text: "依企業類型與計畫目標，銜接合適的政府計畫顧問團隊。" },
                { Icon: ClipboardCheck, title: "持續陪跑", text: "從資料準備、計畫撰寫到送件，保留清楚的案件進度。" },
              ].map(({ Icon, title, text }) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/[.035] p-5">
                  <Icon className="h-5 w-5 text-violet-400" />
                  <h3 className="mt-7 font-bold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────── */}
      <section className="bg-[#f5f6f8] py-12 md:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-[0_24px_70px_-55px_rgba(15,23,42,.8)] md:px-10 md:py-10">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-orange-500 to-violet-500" aria-hidden="true" />
            <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-950 md:text-3xl">不確定適合哪項補助？</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600 md:text-base">讓 OXM 協助免費評估，找到適合您企業階段的計畫方向。</p>
              </div>
              <Button onClick={handleApplyClick} disabled={accessChecking && !!user} className="h-12 shrink-0 rounded-full bg-slate-950 px-7 font-bold text-white hover:bg-orange-600">
                立即免費評估<ArrowRight className="ml-2 h-4 w-4" />
              </Button>
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
      <Dialog open={showProgressDialog} onOpenChange={(open) => { setShowProgressDialog(open); if (!open) setProgressDialogMode("query"); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[82vh] flex flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-orange-500" />
              {progressDialogMode === "duplicate" ? "你已送出企業升級申請" : "申請進度查詢"}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-1">
              {progressDialogMode === "duplicate"
                ? "我們已收到你的申請，目前案件進度如下。"
                : "系統將依您目前登入帳號綁定的工廠，自動查詢企業升級案件進度。"}
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
